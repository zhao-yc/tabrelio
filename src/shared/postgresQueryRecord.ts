import { z } from 'zod';
import { postgresTableLimits } from './postgresTableLimits';

const id = z.string().min(1).max(200);
const rowIndex = z.number().int().min(0).max(99999);
const rowIndices = z.array(rowIndex).min(1).max(postgresTableLimits.changes)
  .refine(indices => new Set(indices).size === indices.length);
const source = z.object({
  connectionId: id, database: id, sessionId: id, executionId: id, tabId: id,
});
export const postgresQueryRecordPageSchema = z.union([
  source.extend({ rowIndex }).strict(),
  source.extend({ rowIndices }).strict(),
  source.extend({ rowIndices, operation: z.enum(['delete', 'insert']) }).strict(),
  source.extend({ operation: z.literal('new') }).strict(),
]);
export type PostgresQueryRecordPageInput = z.infer<typeof postgresQueryRecordPageSchema>;

/** 只描述原执行中实际返回的原表字段，不包含表页令牌或执行权限。 */
export interface PostgresQueryRowSql {
  table: string;
  columns: { position: number; name: string; primary: boolean; generated: boolean; identityAlways: boolean; sequenceDefault: boolean }[];
  primaryKey?: string[];
}
