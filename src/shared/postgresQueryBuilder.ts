import { z } from 'zod';
import { sortRulesSchema } from './filtering';
import { compileQueryBuilderOn, queryBuilderForeignKeyRevisions, queryBuilderAlias as postgresBuilderAlias, queryBuilderColumnKey as postgresBuilderColumnKey,
  queryBuilderJoinLimits as postgresBuilderJoinLimits, queryBuilderJoinSchema, validateQueryBuilderJoin } from './queryBuilderJoin';
import { postgresDdlLiteral } from './postgresCreateTable';
import { parsePostgresCatalogName, postgresIdentifier } from './postgresSql';
import { postgresAdvancedTableFilterSchema, postgresTableTargetSchema } from './postgresTable';
import { postgresTableCondition } from './postgresTableReadSql';
import { compileQueryBuilderSummary, queryBuilderSummarySchema } from './queryBuilderSummary';
import { queryBuilderColumnAliasesSchema, queryBuilderOutputAliases } from './queryBuilderProjection';
import { queryBuilderOffsetSchema } from './queryBuilderOffset';

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
export { postgresBuilderAlias, postgresBuilderColumnKey, postgresBuilderJoinLimits };
const joinTable = postgresQueryBuilderTargetSchema.shape.table;
const joinColumn = z.string().min(1).max(256);
const joinStepFields = queryBuilderJoinSchema(joinColumn, joinColumn).extend({ table: joinTable });
const joinDraftStep = joinStepFields.superRefine(validateQueryBuilderJoin);
export const postgresBuilderJoinDraftSchema = z.array(joinDraftStep).min(1).max(postgresBuilderJoinLimits.steps);
const joinStep = joinStepFields.extend({ fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).superRefine(validateQueryBuilderJoin);
export const postgresQueryBuilderDescribeJoinSchema = postgresQueryBuilderTargetSchema.extend({
  joinTables: z.array(joinTable).min(1).max(postgresBuilderJoinLimits.steps),
});
export type PostgresQueryBuilderDescribeJoinInput = z.infer<typeof postgresQueryBuilderDescribeJoinSchema>;
export const postgresQueryBuilderJoinKeysSchema = postgresQueryBuilderTargetSchema.extend({
  priorTables: z.array(joinTable).max(postgresBuilderJoinLimits.steps - 1),
  priorRevisions: queryBuilderForeignKeyRevisions, nextTable: joinTable,
}).strict().refine(value => value.priorRevisions.length === value.priorTables.length + 1, '已加入的 PostgreSQL 来源修订不完整');
export type PostgresQueryBuilderJoinKeysInput = z.infer<typeof postgresQueryBuilderJoinKeysSchema>;
export type PostgresBuilderJoin = z.infer<typeof joinStep>;
const designFields = postgresQueryBuilderTargetSchema.extend({
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  columns: z.array(z.string().min(1).max(256)).max(postgresQueryBuilderLimits.columns),
  columnAliases: queryBuilderColumnAliasesSchema.optional(),
  filter: postgresAdvancedTableFilterSchema.optional(),
  sort: sortRulesSchema.refine(rules => new Set(rules.map(rule => rule.column)).size === rules.length, '排序字段不能重复'),
  distinct: z.boolean(),
  summary: queryBuilderSummarySchema.extend({ having: postgresAdvancedTableFilterSchema.optional() }).optional(),
  rowLimit: z.number().int().min(1).max(postgresQueryBuilderLimits.rowLimit).optional(),
  rowOffset: queryBuilderOffsetSchema.optional(),
  joins: z.array(joinStep).min(1).max(postgresBuilderJoinLimits.steps).optional(),
});
export const postgresQueryBuilderInspectSchema = designFields.extend({ inspect: z.enum(['rows', 'explain', 'validate']) });
export type PostgresQueryBuilderDesign = z.infer<typeof designFields>;
export type PostgresQueryBuilderInspectInput = z.infer<typeof postgresQueryBuilderInspectSchema>;

/** 只从同一连接、数据库和目录修订编译；值用 E 字符串，跨会话保留反斜杠和换行。 */
export function buildPostgresQueryBuilderSql(design: PostgresQueryBuilderDesign, source: PostgresQueryBuilderSource,
  joinedSources: readonly PostgresQueryBuilderSource[] = []): string {
  const { connectionId, database, table, fingerprint, columns, columnAliases, filter, sort, distinct, rowLimit, rowOffset, summary, joins = [] } = designFields.parse(design);
  if (source.target.connectionId !== connectionId || source.target.database !== database || source.target.table !== table ||
      source.fingerprint !== fingerprint) throw Error('PostgreSQL 查询来源已变化，请重新读取结构。');
  if (joins.length !== joinedSources.length) throw Error('PostgreSQL 关联来源不完整。');
  const references = new Map<string, { name: string; source: number; alias: string }>();
  [source, ...joinedSources].forEach((relation, index) => relation.columns.forEach(({ name }, ordinal) => {
    const key = joins.length ? postgresBuilderColumnKey(index, name) : name;
    const alias = joins.length && new TextEncoder().encode(key).length > 63 ? postgresBuilderAlias(index) + '#' + (ordinal + 1) : key;
    references.set(key, { name, source: index, alias });
  }));
  const selected = new Set(columns);
  const field = (name: string) => {
    const reference = references.get(name);
    if (!reference) throw Error('PostgreSQL 查询字段已变化，请重新读取结构。');
    if (/[\0\r\n\uD800-\uDFFF]/u.test(reference.name)) throw Error('查询草稿暂不支持含换行的字段名。');
    return (joins.length ? postgresBuilderAlias(reference.source) + '.' : '') + postgresIdentifier(reference.name);
  };
  const qualified = (name: string) => {
    const target = parsePostgresCatalogName(name)!;
    return postgresIdentifier(target.schema) + '.' + postgresIdentifier(target.name);
  };
  const defaultOutput = (name: string) => references.get(name)?.alias ?? name;
  const aliases = queryBuilderOutputAliases(columns, columnAliases, defaultOutput);
  const alias = joins.length ? defaultOutput : undefined;
  const joinSql = joins.map((step, index) => {
    const right = joinedSources[index], position = index + 1;
    if (right.target.connectionId !== connectionId || right.target.database !== database || right.target.table !== step.table ||
        right.fingerprint !== step.fingerprint) throw Error('PostgreSQL 关联来源已变化，请重新读取结构。');
    const on = compileQueryBuilderOn(step, pair => {
      const previous = references.get(pair.left);
      if (!previous || previous.source >= position) throw Error('关联条件必须引用已加入的表，且不能重复。');
      return field(pair.left) + ' ' + pair.operator + ' ' + field(postgresBuilderColumnKey(position, pair.right));
    });
    return ' ' + step.kind + ' JOIN ' + qualified(step.table) + ' AS ' + postgresBuilderAlias(position) + ' ON ' + on;
  }).join('');
  if (selected.size !== columns.length) throw Error('输出字段不能重复。');
  if (summary ? columns.length || sort.length || distinct : !columns.length) throw Error('请明确配置汇总或明细输出。');
  if (distinct && sort.some(rule => !selected.has(rule.column))) throw Error('去重查询只能按已选的输出字段排序。');
  for (const rule of filter?.rules ?? []) field(rule.column);
  const literal = (value: string) => postgresDdlLiteral(value).replaceAll('\r', '\\r').replaceAll('\n', '\\n');
  const where = postgresTableCondition(filter, field, literal);
  const grouped = summary && compileQueryBuilderSummary(summary, field, postgresIdentifier, 'pg_catalog.', alias);
  if (grouped) for (const rule of summary?.having?.rules ?? []) grouped.havingField(rule.column);
  const having = grouped ? postgresTableCondition(summary?.having, grouped.havingField, literal) : '';
  // 单表显式别名可能遮住另一原字段，排序使用限定名保持绑定。
  const order = grouped?.order ?? sort.map(rule => (aliases.size && !joins.length ? qualified(table) + '.' : '') +
    field(rule.column) + ' ' + rule.direction + (rule.nulls ? ' NULLS ' + rule.nulls : ''));
  const sql = (distinct ? 'SELECT DISTINCT ' : 'SELECT ') + (grouped?.projection ??
      columns.map(name => {
        const output = aliases.get(name) ?? alias?.(name);
        return field(name) + (output === undefined ? '' : ' AS ' + postgresIdentifier(output));
      }).join(', ')) +
    ' FROM ' + qualified(table) + (joins.length ? ' AS t1' : '') + joinSql +
    (where ? ' WHERE ' + where : '') + (grouped?.groupBy ?? '') + (having ? ' HAVING ' + having : '') +
    (order.length ? ' ORDER BY ' + order.join(', ') : '') +
    (rowLimit === undefined ? '' : ' LIMIT ' + rowLimit) + (rowOffset ? ' OFFSET ' + rowOffset : '');
  if (sql.length > postgresQueryBuilderLimits.sqlUnits) throw Error('PostgreSQL 查询草稿超过文本预算，请减少字段或条件。');
  return sql;
}
