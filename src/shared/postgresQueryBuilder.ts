import { z } from 'zod';
import { sortRulesSchema } from './filtering';
import { postgresDdlLiteral } from './postgresCreateTable';
import { parsePostgresCatalogName, postgresIdentifier } from './postgresSql';
import { postgresAdvancedTableFilterSchema, postgresTableTargetSchema } from './postgresTable';
import { postgresTableCondition } from './postgresTableReadSql';
import { compileQueryBuilderSummary, queryBuilderSummarySchema } from './queryBuilderSummary';

export const postgresQueryBuilderCatalogueSchema = postgresTableTargetSchema.pick({ connectionId: true, database: true });
export const postgresQueryBuilderTargetSchema = postgresQueryBuilderCatalogueSchema.extend({
  table: z.string().min(1).max(512).refine(value => {
    const parts = parsePostgresCatalogName(value);
    return !!parts?.schema && !!parts.name && !/[\0\r\n\uD800-\uDFFF]/u.test(value);
  }, '请选择目录中带 schema 的 PostgreSQL 表或视图'),
});
export type PostgresQueryBuilderTarget = z.infer<typeof postgresQueryBuilderTargetSchema>;
export interface PostgresQueryBuilderSource {
  target: PostgresQueryBuilderTarget;
  fingerprint: string;
  columns: { name: string; type: string }[];
}

export const postgresQueryBuilderLimits = { columns: 1600, rows: 100, rowLimit: 1000000, sqlUnits: 1024 * 1024 };
const designFields = postgresQueryBuilderTargetSchema.extend({
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  columns: z.array(z.string().min(1).max(256)).max(postgresQueryBuilderLimits.columns),
  filter: postgresAdvancedTableFilterSchema.optional(),
  sort: sortRulesSchema.refine(rules => new Set(rules.map(rule => rule.column)).size === rules.length, '排序字段不能重复'),
  distinct: z.boolean(),
  summary: queryBuilderSummarySchema.optional(),
  rowLimit: z.number().int().min(1).max(postgresQueryBuilderLimits.rowLimit).optional(),
});
export const postgresQueryBuilderInspectSchema = designFields.extend({ inspect: z.enum(['rows', 'explain']) });
export type PostgresQueryBuilderDesign = z.infer<typeof designFields>;
export type PostgresQueryBuilderInspectInput = z.infer<typeof postgresQueryBuilderInspectSchema>;

/** 只从同一连接、数据库和目录修订编译；值用 E 字符串，跨会话保留反斜杠和换行。 */
export function buildPostgresQueryBuilderSql(design: PostgresQueryBuilderDesign, source: PostgresQueryBuilderSource): string {
  const { connectionId, database, table, fingerprint, columns, filter, sort, distinct, rowLimit, summary } = designFields.parse(design);
  if (source.target.connectionId !== connectionId || source.target.database !== database || source.target.table !== table ||
      source.fingerprint !== fingerprint) throw Error('PostgreSQL 查询来源已变化，请重新读取结构。');
  const names = new Set(source.columns.map(column => column.name)), selected = new Set(columns);
  const field = (name: string) => {
    if (!names.has(name)) throw Error('PostgreSQL 查询字段已变化，请重新读取结构。');
    if (/[\0\r\n\uD800-\uDFFF]/u.test(name)) throw Error('查询草稿暂不支持含换行的字段名。');
    return postgresIdentifier(name);
  };
  if (selected.size !== columns.length) throw Error('输出字段不能重复。');
  if (summary ? columns.length || sort.length || distinct : !columns.length) throw Error('请明确配置汇总或明细输出。');
  if (distinct && sort.some(rule => !selected.has(rule.column))) throw Error('去重查询只能按已选的输出字段排序。');
  for (const rule of filter?.rules ?? []) field(rule.column);
  const where = postgresTableCondition(filter, field, value => postgresDdlLiteral(value).replaceAll('\r', '\\r').replaceAll('\n', '\\n'));
  const grouped = summary && compileQueryBuilderSummary(summary, field, postgresIdentifier, 'pg_catalog.');
  const order = grouped?.order ?? sort.map(rule => field(rule.column) + ' ' + rule.direction + (rule.nulls ? ' NULLS ' + rule.nulls : ''));
  const { schema, name } = parsePostgresCatalogName(table)!;
  const sql = (distinct ? 'SELECT DISTINCT ' : 'SELECT ') + (grouped?.projection ?? columns.map(field).join(', ')) +
    ' FROM ' + postgresIdentifier(schema) + '.' + postgresIdentifier(name) +
    (where ? ' WHERE ' + where : '') + (grouped?.groupBy ?? '') + (order.length ? ' ORDER BY ' + order.join(', ') : '') +
    (rowLimit === undefined ? '' : ' LIMIT ' + rowLimit);
  if (sql.length > postgresQueryBuilderLimits.sqlUnits) throw Error('PostgreSQL 查询草稿超过文本预算，请减少字段或条件。');
  return sql;
}
