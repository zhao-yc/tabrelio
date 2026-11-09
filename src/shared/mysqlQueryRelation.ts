import { z } from 'zod';

const id = z.string().min(1).max(200);
export const mysqlQueryRelationSchema = z.object({
  connectionId: id, sessionId: id, executionId: id, taskId: id, rowIndex: z.number().int().min(0).max(99999),
}).strict();
export type MysqlQueryRelationInput = z.infer<typeof mysqlQueryRelationSchema>;
export const mysqlQueryRecordEditSchema = mysqlQueryRelationSchema.extend({ columnIndex: z.number().int().min(0).max(65535).optional() });
export type MysqlQueryRecordEditInput = z.infer<typeof mysqlQueryRecordEditSchema>;
export const mysqlQueryRecordRefSchema = z.object({ sessionId: id, token: z.uuid() }).strict();
export type MysqlQueryRecordRef = z.infer<typeof mysqlQueryRecordRefSchema>;
