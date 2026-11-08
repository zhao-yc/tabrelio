import { z } from 'zod';

const identity = z.string().min(1).max(200).refine(value => !value.includes('\0'));
export const postgresDatabaseBackupTitle = 'PostgreSQL 数据库备份';
export const postgresDatabaseBackupPickToolTitle = '选择 PostgreSQL pg_dump';
export const postgresDatabaseBackupToolSchema = z.object({}).strict();
const options = z.object({
  connectionId: identity, database: identity, portable: z.boolean(), toolToken: z.uuid(),
  format: z.enum(['sql', 'custom']).optional(),
  content: z.enum(['all', 'schema', 'data']).optional(),
  schemas: z.array(z.object({ name: identity, stamp: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).min(1).max(64)
    .refine(value => new Set(value.map(item => item.name)).size === value.length, '备份 Schema 不能重复').optional(),
}).strict();
const preservesArchiveOwners = (input: z.infer<typeof options>) => input.format !== 'custom' || !input.portable;
export const postgresDatabaseBackupChooseSchema = options.refine(preservesArchiveOwners, '归档会保留所有者和授权，请在转换 SQL 时选择是否省略');
export const postgresDatabaseBackupExecuteSchema = options.extend({
  fileToken: z.uuid(), taskId: identity,
}).strict().refine(preservesArchiveOwners, '归档会保留所有者和授权，请在转换 SQL 时选择是否省略');
export const postgresCustomArchiveExtensions = ['dump', 'backup'] as const;
export const isPostgresCustomArchiveDestination = (path: string) => /\.(?:dump|backup)$/i.test(path);
export type PostgresDatabaseBackupChooseInput = z.infer<typeof postgresDatabaseBackupChooseSchema>;
export type PostgresDatabaseBackupInput = z.infer<typeof postgresDatabaseBackupExecuteSchema>;

/** pg_dump 的 --schema 参数是模式。双引号使名称按 PostgreSQL 模式语法逐字匹配。 */
export function postgresDumpSelection(input: Pick<PostgresDatabaseBackupChooseInput, 'content' | 'schemas'>): string[] {
  const args = input.content === 'schema' ? ['--schema-only'] : input.content === 'data' ? ['--data-only'] : [];
  if (input.schemas) {
    args.push('--strict-names');
    for (const { name } of input.schemas) args.push('--schema="' + name.replaceAll('"', '""') + '"');
  }
  return args;
}

export interface PostgresDatabaseBackupResult {
  bytes: number;
  toolVersion: string;
  warning?: string;
}
