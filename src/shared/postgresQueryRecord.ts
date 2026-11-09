import { z } from 'zod';

const id = z.string().min(1).max(200);
export const postgresQueryRecordPageSchema = z.object({
  connectionId: id, database: id, sessionId: id, executionId: id, tabId: id,
  rowIndex: z.number().int().min(0).max(99999),
}).strict();
export type PostgresQueryRecordPageInput = z.infer<typeof postgresQueryRecordPageSchema>;
