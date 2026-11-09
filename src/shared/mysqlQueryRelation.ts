import { z } from 'zod';
import type { ColumnInfo, TableInfo } from './contracts';

const id = z.string().min(1).max(200);
export const mysqlQueryRelationSchema = z.object({
  connectionId: id, sessionId: id, executionId: id, taskId: id, rowIndex: z.number().int().min(0).max(99999),
}).strict();
export type MysqlQueryRelationInput = z.infer<typeof mysqlQueryRelationSchema>;
const columnIndex = z.number().int().min(0).max(65535);
export const mysqlQueryRecordEditSchema = mysqlQueryRelationSchema.extend({ columnIndex: columnIndex.optional() });
export type MysqlQueryRecordEditInput = z.infer<typeof mysqlQueryRecordEditSchema>;
export const mysqlQueryBatchLimits = { rows: 100, cells: 5000, bytes: 4 * 1024 * 1024 } as const;
const querySourceScope = mysqlQueryRelationSchema.omit({ rowIndex: true });
export const mysqlQueryReplaceColumnsSchema = querySourceScope;
export type MysqlQueryReplaceColumnsInput = z.infer<typeof mysqlQueryReplaceColumnsSchema>;
export interface MysqlQueryReplaceColumn { index: number; field: string }

/** 文本替换只针对普通文本字段，定位键、生成列和自增列不能纳入。 */
export function mysqlQueryReplaceableColumn(info: Pick<TableInfo, 'editableKey' | 'primaryKey'>, column: ColumnInfo): boolean {
  return !info.primaryKey.includes(column.name) && !info.editableKey.includes(column.name) && !column.generated &&
    !/\bauto_increment\b/i.test(column.extra) && /^(?:CHAR|VARCHAR|TINYTEXT|TEXT|MEDIUMTEXT|LONGTEXT)\b/i.test(column.type);
}

const queryBatchScope = querySourceScope.extend({
  rowIndices: z.array(mysqlQueryRelationSchema.shape.rowIndex).min(1).max(mysqlQueryBatchLimits.rows)
    .refine(indices => new Set(indices).size === indices.length, '查询选区包含重复行'),
});
export const mysqlQueryBatchEditSchema = z.union([
  queryBatchScope.extend({ columnIndices: z.array(columnIndex).min(1).max(1024) })
    .refine(value => value.rowIndices.length * value.columnIndices.length <= mysqlQueryBatchLimits.cells &&
      new Set(value.columnIndices).size === value.columnIndices.length, '查询编辑选区重复或超过预算'),
  queryBatchScope.extend({ operation: z.enum(['delete', 'insert']) }),
  querySourceScope.extend({ operation: z.literal('new') }),
]);
export type MysqlQueryBatchEditInput = z.infer<typeof mysqlQueryBatchEditSchema>;
export const mysqlQueryRecordRefSchema = z.object({ sessionId: id, token: z.uuid(), operation: z.enum(['delete', 'insert', 'new']).optional() }).strict();
export type MysqlQueryRecordRef = z.infer<typeof mysqlQueryRecordRefSchema>;
