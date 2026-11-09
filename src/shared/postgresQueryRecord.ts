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
  source.extend({ rowIndices, operation: z.literal('delete') }).strict(),
]);
export type PostgresQueryRecordPageInput = z.infer<typeof postgresQueryRecordPageSchema>;
