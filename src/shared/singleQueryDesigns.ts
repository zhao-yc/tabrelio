import { z } from 'zod';
import { FILTER_LIMITS, filterRuleSchema, filterGroupSchema, sortRulesSchema, validateFilterGroup } from './filtering';
import { manualJoinDesignLimits } from './manualJoinDesigns';
import { sqliteQueryBuilderTargetSchema } from './sqliteQueryBuilder';
import { postgresQueryBuilderTargetSchema } from './postgresQueryBuilder';
import { sqliteTableBrowseLimits, sqliteTableFilterSchema, sqliteFilterSelectionSchema } from './sqliteTableBrowse';
import { foreignKeyJoinAggregateFunctions, foreignKeyJoinSummaryLimits } from './tableForeignKeyJoinSummary';

const id = z.string().min(1).max(128);
const field = z.string().min(1).max(530).refine(value => !/[\0\r\n\uD800-\uDFFF]/u.test(value));
const mode = z.enum(['all', 'any']);
const sqliteMode = z.enum(['and', 'or']);
const draftSort = z.object({ column: field, direction: z.enum(['ASC', 'DESC']), nulls: z.enum(['FIRST', 'LAST']).optional() }).strict();
const summary = z.object({
  groups: z.array(field).max(foreignKeyJoinSummaryLimits.groups),
  aggregates: z.array(z.object({ id, fn: z.enum(foreignKeyJoinAggregateFunctions), column: field, alias: z.string().max(63) }).strict())
    .max(foreignKeyJoinSummaryLimits.aggregates),
  sort: z.array(draftSort).max(20),
}).strict();
const sqliteFilter = z.object({
  id, column: field, operator: sqliteTableFilterSchema.shape.operator,
  kind: z.enum(['text', 'integer', 'real', 'blob']), value: z.string().max(sqliteTableBrowseLimits.valueUnits),
  secondValue: z.string().max(sqliteTableBrowseLimits.valueUnits).optional(),
  values: z.array(z.string().max(sqliteTableBrowseLimits.valueUnits)).max(sqliteTableBrowseLimits.listValues).optional(),
  selectedValues: z.array(sqliteFilterSelectionSchema).max(sqliteTableBrowseLimits.listValues).optional(),
  enabled: z.boolean().optional(),
}).strict();
const base = z.object({
  version: z.literal(1), selected: z.array(field).max(1600), distinct: z.boolean(),
  limit: z.string().regex(/^(?:[1-9]\d{0,5}|1000000)?$/),
  summaryEnabled: z.boolean(), summary,
}).strict();
const sqliteDraft = base.extend({
  dialect: z.literal('sqlite'), mode: sqliteMode, havingMode: sqliteMode,
  filters: z.array(sqliteFilter).max(sqliteTableBrowseLimits.filters),
  havingFilters: z.array(sqliteFilter).max(sqliteTableBrowseLimits.filters),
  sort: z.array(z.object({ id, column: field, direction: z.enum(['asc', 'desc']) }).strict()).max(sqliteTableBrowseLimits.sorts),
});
const postgresDraft = base.extend({
  dialect: z.literal('postgresql'), mode, havingMode: mode,
  rules: z.array(filterRuleSchema).max(FILTER_LIMITS.conditions), group: filterGroupSchema.optional(),
  havingRules: z.array(filterRuleSchema).max(FILTER_LIMITS.conditions), havingGroup: filterGroupSchema.optional(),
  sort: sortRulesSchema,
});

/** 保存的是可编辑字段和值，包含另一种输出模式的草稿，不包含查询正文或数据库回包。 */
export const singleQueryDraftSchema = z.discriminatedUnion('dialect', [sqliteDraft, postgresDraft]).superRefine((draft, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  const unique = (values: string[]) => new Set(values).size === values.length;
  if (!unique(draft.selected) || !unique(draft.summary.groups) || !unique(draft.summary.aggregates.map(item => item.id)) ||
      !unique(draft.summary.sort.map(item => item.column)) || !unique(draft.sort.map(item => item.column))) issue('查询设计包含重复编辑项。');
  if (draft.dialect === 'sqlite') {
    if ([draft.filters, draft.havingFilters, draft.sort].some(items => !unique(items.map(item => item.id)))) issue('查询设计包含重复编辑项。');
  } else {
    try {
      validateFilterGroup(draft.rules, draft.mode, draft.group);
      validateFilterGroup(draft.havingRules, draft.havingMode, draft.havingGroup);
    } catch (reason) { issue(reason instanceof Error ? reason.message : '查询设计条件分组无效。'); }
  }
  if (new TextEncoder().encode(JSON.stringify(draft)).length > manualJoinDesignLimits.bytes) issue('查询设计超过 1 MiB。');
});
export type SingleQueryDraft = z.infer<typeof singleQueryDraftSchema>;
export type SqliteSingleQueryDraft = Extract<SingleQueryDraft, { dialect: 'sqlite' }>;
export type PostgresSingleQueryDraft = Extract<SingleQueryDraft, { dialect: 'postgresql' }>;

const sqliteScope = sqliteQueryBuilderTargetSchema.extend({ dialect: z.literal('sqlite') });
const postgresScope = postgresQueryBuilderTargetSchema.extend({ dialect: z.literal('postgresql') });
export const singleQueryDesignScopeSchema = z.discriminatedUnion('dialect', [sqliteScope, postgresScope]);
export const singleQueryDesignSelectSchema = z.discriminatedUnion('dialect', [sqliteScope.extend({ id }), postgresScope.extend({ id })]);
const saved = { name: z.string().trim().min(1).max(80).refine(value => !/[\u0000-\u001f\uD800-\uDFFF]/u.test(value)),
  replaceId: id.optional(), design: singleQueryDraftSchema };
export const singleQueryDesignSaveSchema = z.discriminatedUnion('dialect', [sqliteScope.extend(saved), postgresScope.extend(saved)])
  .refine(input => input.dialect === input.design.dialect, '查询设计与所选连接类型不符。');
export type SingleQueryDesignScope = z.infer<typeof singleQueryDesignScopeSchema>;
export type SingleQueryDesignSelect = z.infer<typeof singleQueryDesignSelectSchema>;
export type SingleQueryDesignSave = z.infer<typeof singleQueryDesignSaveSchema>;

/** 即使另一种输出模式当前隐藏，也核对保存的真实字段，避免恢复出部分有效的设计。 */
export function assertSingleQueryDraftColumns(draft: SingleQueryDraft, names: readonly string[]) {
  const where = draft.dialect === 'sqlite' ? draft.filters : draft.rules;
  const columns = [...draft.selected, ...draft.sort.map(item => item.column), ...where.map(item => item.column),
    ...draft.summary.groups, ...draft.summary.aggregates.filter(item => item.fn !== 'COUNT_ALL').map(item => item.column)];
  const available = new Set(names);
  if (columns.some(column => !available.has(column))) throw Error('查询设计引用的来源字段已变化。');
}
