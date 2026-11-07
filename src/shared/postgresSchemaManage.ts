import { z } from 'zod';
import { postgresCreateTableApplySchema, postgresCreateTableSchemasSchema, postgresDdlText, postgresNewIdentifier } from './postgresCreateTable';

const existingName = z.string().min(1).max(512).refine(value => !/[\u0000\uD800-\uDFFF]/u.test(value));
const newName = postgresNewIdentifier.refine(value => !value.startsWith('pg_') && value !== 'information_schema', '请选择普通 Schema 名称');
const existing = postgresCreateTableSchemasSchema.extend({ schema: existingName, stamp: z.string().regex(/^[0-9a-f]{64}$/) });
export const postgresSchemaReadSchema = postgresCreateTableSchemasSchema;
export const postgresSchemaPreviewSchema = z.discriminatedUnion('action', [
  postgresCreateTableSchemasSchema.extend({ action: z.literal('create'), name: newName,
    newOwner: existingName.optional(), comment: postgresDdlText.nullable() }).strict(),
  existing.extend({ action: z.literal('rename'), name: newName }).strict(),
  existing.extend({ action: z.literal('comment'), comment: postgresDdlText.nullable() }).strict(),
  existing.extend({ action: z.literal('owner'), newOwner: existingName }).strict(),
  existing.extend({ action: z.literal('drop') }).strict(),
]);
export const postgresSchemaApplySchema = postgresCreateTableApplySchema.extend({ confirmed: z.literal(true) }).strict();
export type PostgresSchemaPreviewInput = z.infer<typeof postgresSchemaPreviewSchema>;
export interface PostgresSchemaCatalog {
  database: string;
  canCreate: boolean;
  schemas: { name: string; owner: string; comment: string | null; usage: boolean; create: boolean; manageable: boolean; stamp: string }[];
}
