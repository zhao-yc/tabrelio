import { z } from 'zod';
import type { FilterGroup } from './contracts';
import { filterGroupSchema } from './filtering';
import { manualJoinOnGroup } from './manualJoinDesigns';

export const queryBuilderJoinLimits = { steps: 7, pairs: 20 } as const;
export const queryBuilderJoinKinds = ['INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS'] as const;
export const queryBuilderJoinOperators = ['=', '<>', '<', '<=', '>', '>=', 'IS NOT DISTINCT FROM'] as const;
const joinShape = {
  kind: z.enum(queryBuilderJoinKinds),
  mode: z.enum(['all', 'any']),
  group: filterGroupSchema.optional(),
};
export function queryBuilderJoinSchema(left: z.ZodType<string>, right: z.ZodType<string>) {
  return z.object({
    ...joinShape,
    pairs: z.array(z.object({ left, right, operator: z.enum(queryBuilderJoinOperators) }).strict())
      .max(queryBuilderJoinLimits.pairs),
  }).strict();
}
export type QueryBuilderJoinConditions = z.infer<ReturnType<typeof queryBuilderJoinSchema>>;
export const queryBuilderAlias = (index: number) => 't' + (index + 1);
export const queryBuilderColumnKey = (index: number, name: string) => queryBuilderAlias(index) + '.' + name;

const revision = z.string().regex(/^[a-f0-9]{64}$/);
export const queryBuilderForeignKeyRevisions = z.array(revision).min(1).max(queryBuilderJoinLimits.steps);
export const queryBuilderForeignKeyLimit = 128;
const keyField = z.string().min(1).max(512).refine(value => !/[\0\r\n\uD800-\uDFFF]/u.test(value));
export const queryBuilderForeignKeyChoiceSchema = z.object({
  source: z.number().int().min(0).max(queryBuilderJoinLimits.steps - 1),
  direction: z.enum(['outgoing', 'incoming']),
  key: z.string().min(1).max(128),
  label: z.string().min(1).max(512),
  pairs: z.array(z.object({ left: keyField, right: keyField }).strict()).min(1).max(queryBuilderJoinLimits.pairs),
}).strict().refine(value => new Set(value.pairs.map(pair => JSON.stringify([pair.left, pair.right]))).size === value.pairs.length,
  '外键包含重复字段比较。');
export type QueryBuilderForeignKeyChoice = z.infer<typeof queryBuilderForeignKeyChoiceSchema>;
export interface QueryBuilderForeignKeys<Source> { source: Source; choices: QueryBuilderForeignKeyChoice[] }

/** 复读目录后必须仍有同一目标修订、约束和完整字段映射，再生成可编辑的等号条件。 */
export function queryBuilderForeignKeyPairs(selected: QueryBuilderForeignKeyChoice, fresh: readonly QueryBuilderForeignKeyChoice[]) {
  const choice = fresh.find(item => item.key === selected.key);
  if (!choice || JSON.stringify(choice) !== JSON.stringify(selected)) throw Error('外键或字段映射已变化，请重新读取匹配外键。');
  return choice.pairs.map(({ left, right }) => ({ left: queryBuilderColumnKey(choice.source, left), right, operator: '=' as const }));
}

/** 每条比较必须在括号树中恰好出现一次。 */
export function validateQueryBuilderJoin({ kind, mode, group, pairs }: QueryBuilderJoinConditions, context: z.RefinementCtx) {
  if (kind === 'CROSS') {
    if (pairs.length || group !== undefined || mode !== 'all')
      context.addIssue({ code: 'custom', path: ['pairs'], message: 'CROSS JOIN 不能带 ON 条件。' });
    return;
  }
  if (!pairs.length) context.addIssue({ code: 'custom', path: ['pairs'], message: '此连接方式至少需要一条 ON 条件。' });
  try { manualJoinOnGroup({ mode, group }, pairs.length); }
  catch { context.addIssue({ code: 'custom', path: ['group'], message: 'ON 分组必须与根模式一致，并恰好包含每条比较一次。' }); }
}

/** 仅组合已通过目录校验的字段比较。 */
export function compileQueryBuilderOn(step: QueryBuilderJoinConditions, resolve: (pair: QueryBuilderJoinConditions['pairs'][number]) => string) {
  if (step.kind === 'CROSS') return '';
  const used = new Set<string>();
  const leaves = step.pairs.map(pair => {
    const key = JSON.stringify([pair.left, pair.right, pair.operator]);
    if (used.has(key)) throw Error('关联条件必须引用已加入的表，且不能重复。');
    used.add(key);
    return resolve(pair);
  });
  function grouped(node: FilterGroup): string {
    return '(' + node.children.map(child => typeof child === 'number' ? leaves[child] : grouped(child))
      .join(node.mode === 'all' ? ' AND ' : ' OR ') + ')';
  }
  return ' ON ' + grouped(step.group ?? { mode: step.mode, children: leaves.map((_, i) => i) });
}
