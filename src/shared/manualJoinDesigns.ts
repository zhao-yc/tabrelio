import { queryBuilderOffsetDraftSchema } from './queryBuilderOffset';
import { z } from 'zod';
import { FILTER_LIMITS, filterGroupSchema, tableFilterOperators, validateFilterGroup } from './filtering';

export const manualJoinDesignLimits = { designs: 200, perTable: 30, bytes: 1024 * 1024, totalBytes: 16 * 1024 * 1024 } as const;
export const manualJoinOperators = ['=', '<>', '<', '<=', '>', '>='] as const;
const id = z.string().min(1).max(128);
const validUnicode = (value: string) => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
const identifier = z.string().min(1).max(64).refine(value => !value.includes('\0') && validUnicode(value));
const title = z.string().trim().min(1).max(80).refine(value => !/[\u0000-\u001f]/.test(value) && validUnicode(value));
const side = z.enum(['child', 'parent', 't3', 't4', 't5', 't6', 't7', 't8']);
const mode = z.enum(['all', 'any']);
const onSchema = z.object({ mode, group: filterGroupSchema.optional() }).strict();
export type ManualJoinOn = z.infer<typeof onSchema>;

/** ON 的叶子索引复用现有分组合同，不将字段比较转换成值筛选。 */
export function manualJoinOnRules(count: number) {
  return Array.from({ length: count }, (_, index) => ({ column: String(index + 1), operator: 'IS NULL' as const }));
}

export function manualJoinOnGroup(on: ManualJoinOn | undefined, count: number) {
  if (on?.group === undefined) return undefined;
  return validateFilterGroup(manualJoinOnRules(count), on.mode, on.group);
}
const kind = z.enum(['LEFT', 'RIGHT', 'INNER']);
const target = z.object({ database: identifier, table: identifier }).strict();
const pair = z.object({ child: identifier, parent: identifier, operator: z.enum(manualJoinOperators).optional() }).strict();
const pairs = z.array(pair).min(1).max(64);
const source = z.number().int().min(0).max(6);
const additionalPairs = z.array(pair.extend({ source: source.optional() })).min(1).max(64);
const columns = z.array(identifier).max(4096);
const filterDraft = z.object({
  column: z.string().max(256), operator: z.enum(tableFilterOperators),
  value: z.string().max(FILTER_LIMITS.valueLength), upperValue: z.string().max(FILTER_LIMITS.valueLength),
  valuesText: z.string().max(FILTER_LIMITS.totalCharacters), includeEmptyString: z.boolean(), valuesJson: z.literal(true).optional(),
}).strict();
const sorts = z.array(z.object({
  id, rule: z.object({ side: z.union([side, z.literal('aggregate')]), column: identifier, direction: z.enum(['ASC', 'DESC']), nulls: z.enum(['FIRST', 'LAST']).optional() }).strict(),
}).strict()).max(20);

/** 本地设计只保存可编辑输入，不保存查询正文、服务器目录回包或连接认证信息。 */
const queryDesignFields = z.object({
  version: z.literal(1),
  distinct: z.boolean(), child: columns, limit: z.string().regex(/^[1-9]\d{0,5}$/),
  offset: queryBuilderOffsetDraftSchema.optional(),
  filters: z.array(z.object({ id, side, enabled: z.boolean(), draft: filterDraft }).strict()).max(FILTER_LIMITS.conditions),
  filterMode: mode, filterGroup: filterGroupSchema.optional(),
  sort: sorts, summarySort: sorts,
  summaryEnabled: z.boolean(),
  summaryGroups: z.array(z.object({ id, side, column: identifier }).strict()).max(20),
  aggregates: z.array(z.object({
    id, side, column: identifier, fn: z.enum(['COUNT_ALL', 'COUNT', 'COUNT_DISTINCT', 'SUM', 'AVG', 'MIN', 'MAX']), alias: z.string().max(128),
  }).strict()).max(32),
  having: z.array(z.object({ id, enabled: z.boolean(), targetLabel: z.string().max(512), draft: filterDraft }).strict()).max(FILTER_LIMITS.conditions),
  havingMode: mode, havingGroup: filterGroupSchema.optional(),
}).strict();

/** 两种设计使用同一草稿编号和字节预算，防止恢复时条件或聚合引用串到另一项。 */
function validateDesignDraft(design: z.infer<typeof queryDesignFields>, context: z.RefinementCtx) {
  for (const entries of [design.filters, design.having, design.sort, design.summarySort, design.summaryGroups, design.aggregates]) {
    if (new Set(entries.map(entry => entry.id)).size !== entries.length) context.addIssue({ code: 'custom', message: '查询设计包含重复编辑项。' });
  }
  if (new TextEncoder().encode(JSON.stringify(design)).length > manualJoinDesignLimits.bytes)
    context.addIssue({ code: 'custom', message: '查询设计超过 1 MiB。' });
}

export const manualJoinDesignSchema = queryDesignFields.extend({
  first: target.extend({ pairs, on: onSchema.optional() }).strict(),
  additional: z.array(target.extend({ source, kind: z.enum(['INNER', 'LEFT']), pairs: additionalPairs, on: onSchema.optional(), columns }).strict()).max(6),
  kind, unmatchedOnly: z.boolean(), parent: columns,
}).superRefine((design, context) => {
  const invalid = (message: string) => context.addIssue({ code: 'custom', message });
  if (design.additional.some((step, index) => step.source >= index + 2 || step.pairs.some(pair => (pair.source ?? step.source) >= index + 2))) invalid('JOIN 设计不能引用尚未加入的表。');
  for (const step of [design.first, ...design.additional]) {
    try { manualJoinOnGroup(step.on, step.pairs.length); }
    catch { invalid('ON 分组必须恰好包含每条比较条件一次。'); }
  }
  validateDesignDraft(design, context);
});
export type ManualJoinDesign = z.infer<typeof manualJoinDesignSchema>;
export const singleTableQueryDesignSchema = queryDesignFields.extend({ single: z.literal(true) }).superRefine((design, context) => {
  validateDesignDraft(design, context);
  if ([...design.filters, ...design.summaryGroups, ...design.aggregates].some(entry => entry.side !== 'child') ||
      design.sort.some(entry => entry.rule.side !== 'child') ||
      design.summarySort.some(entry => entry.rule.side !== 'child' && entry.rule.side !== 'aggregate'))
    context.addIssue({ code: 'custom', message: '单表设计只能引用起始表和它的聚合输出。' });
});
export const queryBuilderDesignSchema = z.union([manualJoinDesignSchema, singleTableQueryDesignSchema]);
export type QueryBuilderDesign = z.infer<typeof queryBuilderDesignSchema>;
export const manualJoinDesignScopeSchema = target.extend({ connectionId: id, single: z.literal(true).optional() }).strict();
export const manualJoinDesignSelectSchema = manualJoinDesignScopeSchema.extend({ id }).strict();
export const manualJoinDesignSaveSchema = manualJoinDesignScopeSchema.extend({ name: title, replaceId: id.optional(), design: queryBuilderDesignSchema }).superRefine((input, context) => {
  if ((input.single === true) !== ('single' in input.design)) context.addIssue({ code: 'custom', message: '查询设计与所选模式不符。' });
});
export type ManualJoinDesignScope = z.infer<typeof manualJoinDesignScopeSchema>;
export type ManualJoinDesignSelect = z.infer<typeof manualJoinDesignSelectSchema>;
export type ManualJoinDesignSave = z.infer<typeof manualJoinDesignSaveSchema>;
export interface ManualJoinDesignSummary { id: string; name: string }
