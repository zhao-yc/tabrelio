import { z } from 'zod';

const id = z.string().min(1).max(200);
export const mysqlQueryRelationSchema = z.object({
  connectionId: id, sessionId: id, executionId: id, taskId: id, rowIndex: z.number().int().min(0).max(99999),
}).strict();
export type MysqlQueryRelationInput = z.infer<typeof mysqlQueryRelationSchema>;
const columnIndex = z.number().int().min(0).max(65535);
export const mysqlQueryRecordEditSchema = mysqlQueryRelationSchema.extend({ columnIndex: columnIndex.optional() });
export type MysqlQueryRecordEditInput = z.infer<typeof mysqlQueryRecordEditSchema>;
export const mysqlQueryBatchLimits = { rows: 100, cells: 5000, bytes: 4 * 1024 * 1024 } as const;
const queryBatchScope = mysqlQueryRelationSchema.omit({ rowIndex: true }).extend({
  rowIndices: z.array(mysqlQueryRelationSchema.shape.rowIndex).min(1).max(mysqlQueryBatchLimits.rows)
    .refine(indices => new Set(indices).size === indices.length, '查询选区包含重复行'),
});
export const mysqlQueryBatchEditSchema = z.union([
  queryBatchScope.extend({ columnIndices: z.array(columnIndex).min(1).max(1024) })
    .refine(value => value.rowIndices.length * value.columnIndices.length <= mysqlQueryBatchLimits.cells &&
      new Set(value.columnIndices).size === value.columnIndices.length, '查询编辑选区重复或超过预算'),
  queryBatchScope.extend({ operation: z.literal('delete') }),
]);
export type MysqlQueryBatchEditInput = z.infer<typeof mysqlQueryBatchEditSchema>;
export const mysqlQueryRecordRefSchema = z.object({ sessionId: id, token: z.uuid(), operation: z.literal('delete').optional() }).strict();
export type MysqlQueryRecordRef = z.infer<typeof mysqlQueryRecordRefSchema>;
