import { z } from 'zod';
import { postgresCreateTableApplySchema, postgresCreateTableSchemasSchema } from './postgresCreateTable';

const catalogText = z.string().min(1).max(512).refine(value => !/[\u0000\uD800-\uDFFF]/u.test(value));
const selection = postgresCreateTableSchemasSchema.extend({
  name: catalogText, stamp: z.string().regex(/^[0-9a-f]{64}$/),
});
export const postgresExtensionPreviewSchema = z.discriminatedUnion('action', [
  selection.extend({ action: z.literal('install'), schema: catalogText, version: catalogText }).strict(),
  selection.extend({ action: z.literal('update'), version: catalogText }).strict(),
  selection.extend({ action: z.literal('move'), schema: catalogText }).strict(),
  selection.extend({ action: z.literal('drop') }).strict(),
]);
export const postgresExtensionApplySchema = postgresCreateTableApplySchema.extend({
  confirmed: z.literal(true), dropName: catalogText.optional(),
}).strict();
export type PostgresExtensionPreviewInput = z.infer<typeof postgresExtensionPreviewSchema>;
export type PostgresExtensionApplyInput = z.infer<typeof postgresExtensionApplySchema>;
export interface PostgresExtensionCatalog {
  schemas: string[];
  extensions: {
    name: string; stamp: string; description: string | null; defaultVersion: string | null;
    installed: { version: string; schema: string; owner: string; manageable: boolean; relocatable: boolean } | null;
    versions: { version: string; schema: string | null; requires: string[]; installable: boolean }[];
    updates: { version: string; path: string }[];
  }[];
}
