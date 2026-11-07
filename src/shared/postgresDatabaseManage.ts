import { z } from 'zod';
import { postgresCreateTableApplySchema, postgresCreateTableSchemasSchema, postgresDdlText, postgresNewIdentifier } from './postgresCreateTable';

const name = z.string().min(1).max(512).refine(value => !/[\u0000\uD800-\uDFFF]/u.test(value));
export const postgresDatabaseManageName = postgresNewIdentifier.refine(
  value => !['postgres', 'template0', 'template1'].includes(value), '请输入普通数据库名称');
export const postgresDatabaseConnectionLimit = z.number().int().min(-1).max(2147483647);
const existing = postgresCreateTableSchemasSchema.extend({ targetName: name, stamp: z.string().regex(/^[0-9a-f]{64}$/) });
export const postgresDatabaseManagePreviewSchema = z.discriminatedUnion('action', [
  postgresCreateTableSchemasSchema.extend({ action: z.literal('create'), name: postgresDatabaseManageName,
    newOwner: name.optional(), template: z.enum(['template0', 'template1']), connectionLimit: postgresDatabaseConnectionLimit }).strict(),
  existing.extend({ action: z.literal('rename'), name: postgresDatabaseManageName }).strict(),
  existing.extend({ action: z.literal('comment'), comment: postgresDdlText.nullable() }).strict(),
  existing.extend({ action: z.literal('owner'), newOwner: name }).strict(),
  existing.extend({ action: z.literal('settings'), allowConnections: z.boolean(), connectionLimit: postgresDatabaseConnectionLimit }).strict(),
]);
export const postgresDatabaseManageApplySchema = postgresCreateTableApplySchema.extend({ confirmed: z.literal(true) }).strict();
export type PostgresDatabaseManageInput = z.infer<typeof postgresDatabaseManagePreviewSchema>;
export type PostgresDatabaseManageApply = z.infer<typeof postgresDatabaseManageApplySchema>;
export interface PostgresDatabaseCatalog {
  database: string;
  canCreate: boolean;
  templates: { name: 'template0' | 'template1'; encoding: string; collation: string }[];
  databases: { name: string; owner: string; comment: string | null; encoding: string; collation: string;
    allowConnections: boolean; connectionLimit: number; template: boolean; manageable: boolean; stamp: string }[];
}
