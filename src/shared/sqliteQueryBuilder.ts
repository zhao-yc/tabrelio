import { z } from 'zod';
import { sqliteSchemaScriptSchema } from './sqliteSchemaScript';
import { sqliteQueryBuilderColumnSchema, sqliteQueryBuilderPageSchema, sqliteTableBrowseLimits, type SqliteTableColumn } from './sqliteTableBrowse';
import { buildSqliteFilteredSelect, quoteSqliteIdentifier, sqliteReadSqlLimits } from './sqliteReadSql';
import { queryBuilderSummarySchema } from './queryBuilderSummary';
import { queryBuilderColumnAliasesSchema, queryBuilderOutputAliases } from './queryBuilderProjection';
import { sqliteQueryBuilderGroupSchema, validateSqliteBuilderGroup } from './sqliteQueryBuilderGroups';
import { queryBuilderOffsetSchema } from './queryBuilderOffset';
import { sqliteRelationshipName } from './sqliteRelationships';
import { compileQueryBuilderOn, queryBuilderAlias, queryBuilderColumnKey, queryBuilderForeignKeyRevisions, queryBuilderJoinLimits,
  queryBuilderJoinSchema, validateQueryBuilderJoin } from './queryBuilderJoin';

export const sqliteQueryBuilderTargetSchema = sqliteSchemaScriptSchema;
export type SqliteQueryBuilderTarget = z.infer<typeof sqliteQueryBuilderTargetSchema>;
export interface SqliteQueryBuilderSource { target: SqliteQueryBuilderTarget; schemaKey: string; columns: SqliteTableColumn[] }
export const sqliteQueryBuilderSampleRows = 100;

const joinTarget = sqliteQueryBuilderTargetSchema.pick({ table: true, kind: true });
const joinDraft = queryBuilderJoinSchema(sqliteQueryBuilderColumnSchema, sqliteQueryBuilderColumnSchema).extend({ target: joinTarget });
const schemaKeyField = z.string().regex(/^[a-f0-9]{64}$/);
export const sqliteBuilderJoinDraftSchema = z.array(joinDraft.superRefine(validateQueryBuilderJoin)).min(1).max(queryBuilderJoinLimits.steps);
const joinStep = joinDraft.extend({ schemaKey: schemaKeyField }).superRefine(validateQueryBuilderJoin);
export type SqliteBuilderJoin = z.infer<typeof joinStep>;
export const sqliteQueryBuilderDescribeJoinSchema = sqliteQueryBuilderTargetSchema.extend({
  joinTargets: z.array(joinTarget).min(1).max(queryBuilderJoinLimits.steps),
});
export type SqliteQueryBuilderDescribeJoinInput = z.infer<typeof sqliteQueryBuilderDescribeJoinSchema>;
export const sqliteQueryBuilderJoinKeysSchema = sqliteQueryBuilderTargetSchema.extend({
  priorTargets: z.array(joinTarget).max(queryBuilderJoinLimits.steps - 1),
  priorRevisions: queryBuilderForeignKeyRevisions, nextTarget: joinTarget,
}).refine(value => value.priorRevisions.length === value.priorTargets.length + 1, '已加入的 SQLite 来源修订不完整');
export type SqliteQueryBuilderJoinKeysInput = z.infer<typeof sqliteQueryBuilderJoinKeysSchema>;

const { mode, filters, sort } = sqliteQueryBuilderPageSchema.shape;
const designFields = sqliteQueryBuilderTargetSchema.extend({
  schemaKey: schemaKeyField,
  columns: z.array(sqliteQueryBuilderColumnSchema).max(sqliteTableBrowseLimits.columns),
  columnAliases: queryBuilderColumnAliasesSchema.optional(),
  mode, filters, sort,
  filterGroup: sqliteQueryBuilderGroupSchema.optional(),
  distinct: z.boolean(), rowLimit: z.number().int().min(1).max(sqliteReadSqlLimits.limit).optional(),
  rowOffset: queryBuilderOffsetSchema.optional(),
  summary: queryBuilderSummarySchema.extend({
    having: z.object({ mode, filters, group: sqliteQueryBuilderGroupSchema.optional() }).strict().optional(),
  }).optional(),
  joins: z.array(joinStep).min(1).max(queryBuilderJoinLimits.steps).optional(),
}).superRefine((design, context) => {
  try {
    validateSqliteBuilderGroup(design.filters.length, design.mode, design.filterGroup);
    const having = design.summary?.having;
    if (having) validateSqliteBuilderGroup(having.filters.length, having.mode, having.group);
  } catch (reason) {
    context.addIssue({ code: 'custom', message: reason instanceof Error ? reason.message : 'SQLite 查询条件分组无效。' });
  }
});
export const sqliteQueryBuilderInspectSchema = designFields.safeExtend({ inspect: z.enum(['rows', 'explain']) });
export type SqliteQueryBuilderDesign = z.infer<typeof designFields>;
export type SqliteQueryBuilderInspectInput = z.infer<typeof sqliteQueryBuilderInspectSchema>;

/** 同一编译器用于草稿与独立只读预览，数据类型与表页筛选保持一致。 */
export function buildSqliteQueryBuilderSql(design: SqliteQueryBuilderDesign, source: SqliteQueryBuilderSource,
  related: readonly SqliteQueryBuilderSource[] = []): string {
  const { connectionId, database, table, kind, schemaKey, columns, columnAliases, mode, filters, filterGroup, sort, distinct, rowLimit, rowOffset, summary, joins = [] } = designFields.parse(design);
  if (source.target.connectionId !== connectionId || source.target.database !== database || source.target.table !== table ||
      source.target.kind !== kind || source.schemaKey !== schemaKey) throw Error('SQLite 查询来源已变化，请重新读取结构。');
  if ([table, ...columns, ...filters.map(filter => filter.column), ...sort.map(item => item.column)].some(name => /[\r\n]/.test(name)))
    throw Error('SQLite 查询草稿暂不支持带换行的表名或字段名。');
  if (summary ? columns.length || sort.length || distinct : !columns.length) throw Error('请明确配置汇总或明细输出。');
  if (distinct && sort.some(item => !columns.includes(item.column))) throw Error('去重查询只能按已选的输出字段排序。');
  if (joins.length !== related.length) throw Error('SQLite 关联来源不完整。');
  const projection = joins.length ? compileSources(source, joins, related) : undefined;
  const aliases = queryBuilderOutputAliases(columns, columnAliases, name => name, sqliteRelationshipName);
  return buildSqliteFilteredSelect({ connectionId, database, table, taskId: 'sqlite-query-builder', offset: 0, limit: 1, mode, filters, sort },
    source.columns, columns, rowLimit, distinct, summary, projection, aliases, filterGroup, rowOffset);
}

/** 来源、别名和字段只能从同一快照的目录生成，ON 左侧不能引用本步或未来来源。 */
function compileSources(source: SqliteQueryBuilderSource, joins: readonly SqliteBuilderJoin[], related: readonly SqliteQueryBuilderSource[]) {
  const references = new Map<string, { position: number; name: string }>();
  [source, ...related].forEach((relation, position) => {
    for (const { name } of relation.columns) references.set(queryBuilderColumnKey(position, name), { position, name });
  });
  const field = (key: string) => {
    const reference = references.get(key);
    if (!reference) throw Error('SQLite 查询字段已变化，请重新读取结构。');
    sqliteQueryBuilderColumnSchema.parse(reference.name);
    return queryBuilderAlias(reference.position) + '.' + quoteSqliteIdentifier(reference.name);
  };
  const relationSql = (table: string, position: number) => {
    if (/[\r\n]/.test(table)) throw Error('SQLite 查询草稿暂不支持带换行的表名。');
    return '"main".' + quoteSqliteIdentifier(table) + ' AS ' + queryBuilderAlias(position);
  };
  const joinSql = joins.map((step, index) => {
    const { target, schemaKey } = related[index], position = index + 1;
    if (target.connectionId !== source.target.connectionId || target.database !== source.target.database ||
        target.table !== step.target.table || target.kind !== step.target.kind || schemaKey !== step.schemaKey)
      throw Error('SQLite 关联来源已变化，请重新读取结构。');
    const on = compileQueryBuilderOn(step, pair => {
      const previous = references.get(pair.left);
      if (!previous || previous.position >= position) throw Error('关联条件必须引用已加入的表，且不能重复。');
      return field(pair.left) + ' ' + pair.operator + ' ' + field(queryBuilderColumnKey(position, pair.right));
    });
    return ' ' + step.kind + ' JOIN ' + relationSql(target.table, position) + on;
  });
  return { from: relationSql(source.target.table, 0) + joinSql.join(''), field };
}
