import { z } from 'zod';
import { postgresCreateTableSchemasSchema } from './postgresCreateTable';
import { postgresStructureInputSchema } from './postgresStructure';

export const postgresStorageSort = z.enum(['total', 'data', 'indexes', 'live', 'name']);
export const postgresStorageKind = z.enum(['table', 'partition', 'materialized']);
const schemaName = z.string().min(1).max(512).refine(value => !value.includes('\0'));
export const postgresStorageReadSchema = postgresCreateTableSchemasSchema.extend({
  schema: schemaName.optional(), query: z.string().max(256).refine(value => !value.includes('\0')),
  kind: postgresStorageKind.optional(), sort: postgresStorageSort, direction: z.enum(['asc', 'desc']),
  page: z.number().int().min(1).max(80),
}).strict();
export const postgresStorageDetailSchema = postgresStructureInputSchema.extend({
  identity: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type PostgresStorageRead = z.infer<typeof postgresStorageReadSchema>;
export type PostgresStorageDetailInput = z.infer<typeof postgresStorageDetailSchema>;

const bytes = z.string().regex(/^\d+$/);
const estimate = bytes.nullable();
const size = z.object({ data: bytes, indexes: bytes, total: bytes }).strict();
const stats = z.object({ live: estimate, dead: estimate, scans: estimate }).strict();
export const postgresStorageRowSchema = size.extend({
  schema: schemaName, name: schemaName, kind: postgresStorageKind, identity: z.string().regex(/^[a-f0-9]{64}$/),
  parent: z.object({ schema: schemaName, name: schemaName }).strict().nullable(), stats,
}).strict();
const summary = size.extend({ count: z.number().int().min(0).max(4001) }).strict();
export const postgresStorageReportSchema = z.object({
  database: schemaName, schemas: z.array(schemaName).max(2000), page: z.number().int().min(1).max(80),
  tooBroad: z.boolean(), summary, bySchema: z.array(summary.extend({ schema: schemaName })).max(2000),
  rows: z.array(postgresStorageRowSchema).max(50),
}).strict();
export const postgresStorageDetailResultSchema = z.object({
  row: postgresStorageRowSchema,
  indexes: z.array(z.object({ name: schemaName, bytes, scans: estimate, valid: z.boolean() }).strict()).max(2000),
}).strict();
export type PostgresStorageReport = z.infer<typeof postgresStorageReportSchema>;
export type PostgresStorageDetail = z.infer<typeof postgresStorageDetailResultSchema>;
export type PostgresStorageRow = z.infer<typeof postgresStorageRowSchema>;
export const postgresStoragePageSize = 50;

/** 精确字节始终以十进制字符串承载，显示单位只使用 BigInt 做四舍五入。 */
export function formatPostgresStorageBytes(raw: string): string {
  const value = BigInt(raw);
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB'] as const;
  let scale = 1n, index = 0;
  while (index < units.length - 1 && value >= scale * 1024n) { scale *= 1024n; index++; }
  if (index === 0) return raw + ' B';
  const tenths = (value * 10n + scale / 2n) / scale;
  return String(tenths / 10n) + '.' + String(tenths % 10n) + ' ' + units[index];
}
