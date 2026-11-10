import { z } from 'zod';
import { sqliteSchemaScriptSchema } from './sqliteSchemaScript';
import { sqliteTableBrowseLimits, sqliteTablePageSchema, type SqliteTableColumn } from './sqliteTableBrowse';
import { buildSqliteFilteredSelect, sqliteReadSqlLimits } from './sqliteReadSql';
import { queryBuilderSummarySchema } from './queryBuilderSummary';

export const sqliteQueryBuilderTargetSchema = sqliteSchemaScriptSchema;
export type SqliteQueryBuilderTarget = z.infer<typeof sqliteQueryBuilderTargetSchema>;
export interface SqliteQueryBuilderSource { target: SqliteQueryBuilderTarget; schemaKey: string; columns: SqliteTableColumn[] }
export const sqliteQueryBuilderSampleRows = 100;

const designFields = sqliteQueryBuilderTargetSchema.extend({
  schemaKey: z.string().regex(/^[a-f0-9]{64}$/),
  columns: z.array(sqliteTablePageSchema.shape.table).max(sqliteTableBrowseLimits.columns),
  mode: sqliteTablePageSchema.shape.mode, filters: sqliteTablePageSchema.shape.filters, sort: sqliteTablePageSchema.shape.sort,
  distinct: z.boolean(), rowLimit: z.number().int().min(1).max(sqliteReadSqlLimits.limit).optional(), summary: queryBuilderSummarySchema.optional(),
});
export const sqliteQueryBuilderInspectSchema = designFields.extend({ inspect: z.enum(['rows', 'explain']) });
export type SqliteQueryBuilderDesign = z.infer<typeof designFields>;
export type SqliteQueryBuilderInspectInput = z.infer<typeof sqliteQueryBuilderInspectSchema>;

/** 同一编译器用于草稿与独立只读预览，数据类型与表页筛选保持一致。 */
export function buildSqliteQueryBuilderSql(design: SqliteQueryBuilderDesign, source: SqliteQueryBuilderSource): string {
  const { connectionId, database, table, kind, schemaKey, columns, mode, filters, sort, distinct, rowLimit, summary } = designFields.parse(design);
  if (source.target.connectionId !== connectionId || source.target.database !== database || source.target.table !== table ||
      source.target.kind !== kind || source.schemaKey !== schemaKey) throw Error('SQLite 查询来源已变化，请重新读取结构。');
  if ([table, ...columns, ...filters.map(filter => filter.column), ...sort.map(item => item.column)].some(name => /[\r\n]/.test(name)))
    throw Error('SQLite 查询草稿暂不支持带换行的表名或字段名。');
  if (summary ? columns.length || sort.length || distinct : !columns.length) throw Error('请明确配置汇总或明细输出。');
  if (distinct && sort.some(item => !columns.includes(item.column))) throw Error('去重查询只能按已选的输出字段排序。');
  return buildSqliteFilteredSelect({ connectionId, database, table, taskId: 'sqlite-query-builder', offset: 0, limit: 1, mode, filters, sort },
    source.columns, columns, rowLimit, distinct, summary);
}
