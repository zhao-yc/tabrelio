import { z } from 'zod';
import { postgresIdentifier } from './postgresSql';

const identity = z.string().min(1).max(200).refine(value => !value.includes('\0'));
export const postgresDatabaseBackupTitle = 'PostgreSQL 数据库备份';
export const postgresDatabaseBackupPickToolTitle = '选择 PostgreSQL pg_dump';
export const postgresDatabaseBackupToolSchema = z.object({}).strict();
export const postgresNativeBackupScopeLimit = 64;
const stamp = z.string().regex(/^[a-f0-9]{64}$/);
const relationSelection = z.object({ schema: identity, name: identity, stamp }).strict();
const options = z.object({
  connectionId: identity, database: identity, portable: z.boolean(), toolToken: z.uuid(),
  format: z.enum(['sql', 'custom']).optional(),
  content: z.enum(['all', 'schema', 'data']).optional(),
  schemas: z.array(z.object({ name: identity, stamp }).strict()).min(1).max(postgresNativeBackupScopeLimit)
    .refine(value => new Set(value.map(item => item.name)).size === value.length, '备份 Schema 不能重复').optional(),
  relations: z.array(relationSelection).min(1).max(postgresNativeBackupScopeLimit)
    .refine(value => new Set(value.map(item => JSON.stringify([item.schema, item.name]))).size === value.length, '备份对象不能重复').optional(),
}).strict();
const preservesArchiveOwners = (input: z.infer<typeof options>) => input.format !== 'custom' || !input.portable;
const singleScope = (input: z.infer<typeof options>) => !input.schemas || !input.relations;
export const postgresDatabaseBackupChooseSchema = options.refine(preservesArchiveOwners, '归档会保留所有者和授权，请在转换 SQL 时选择是否省略')
  .refine(singleScope, '请选择一种 PostgreSQL 备份范围');
export const postgresDatabaseBackupExecuteSchema = options.extend({
  fileToken: z.uuid(), taskId: identity,
}).strict().refine(preservesArchiveOwners, '归档会保留所有者和授权，请在转换 SQL 时选择是否省略')
  .refine(singleScope, '请选择一种 PostgreSQL 备份范围');
export const postgresCustomArchiveExtensions = ['dump', 'backup'] as const;
export const isPostgresCustomArchiveDestination = (path: string) => /\.(?:dump|backup)$/i.test(path);
export type PostgresDatabaseBackupChooseInput = z.infer<typeof postgresDatabaseBackupChooseSchema>;
export type PostgresDatabaseBackupInput = z.infer<typeof postgresDatabaseBackupExecuteSchema>;
export type PostgresNativeBackupRelationSelection = z.infer<typeof relationSelection>;
export const postgresNativeBackupRelationKinds = ['r', 'p', 'v', 'm', 'f', 'S'] as const;
export interface PostgresNativeBackupRelation extends PostgresNativeBackupRelationSelection {
  kind: typeof postgresNativeBackupRelationKinds[number];
  partition: boolean;
}

export function postgresBackupRelationName(item: Pick<PostgresNativeBackupRelationSelection, 'schema' | 'name'>) {
  return postgresIdentifier(item.schema) + '.' + postgresIdentifier(item.name);
}

export const postgresBackupRelationHasData = (kind: PostgresNativeBackupRelation['kind']) => kind === 'r' || kind === 'S';

/** pg_dump 的 --schema 和 --table 参数都是模式。分别引用每段名称，精确匹配点号及通配符。 */
export function postgresDumpSelection(input: Pick<PostgresDatabaseBackupChooseInput, 'content' | 'schemas' | 'relations'>): string[] {
  const args = input.content === 'schema' ? ['--schema-only'] : input.content === 'data' ? ['--data-only'] : [];
  if (input.schemas) {
    args.push('--strict-names');
    for (const { name } of input.schemas) args.push('--schema=' + postgresIdentifier(name));
  }
  if (input.relations) {
    args.push('--strict-names');
    for (const relation of input.relations) args.push('--table=' + postgresBackupRelationName(relation));
  }
  return args;
}

export interface PostgresDatabaseBackupResult {
  bytes: number;
  toolVersion: string;
  warning?: string;
}
