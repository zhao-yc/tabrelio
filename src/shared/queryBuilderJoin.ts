import { z } from 'zod';
import type { FilterGroup } from './contracts';
import { filterGroupSchema } from './filtering';
import { manualJoinOnGroup } from './manualJoinDesigns';

export const queryBuilderJoinLimits = { steps: 7, pairs: 20 } as const;
export const queryBuilderJoinKinds = ['INNER', 'LEFT', 'RIGHT', 'FULL'] as const;
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
      .min(1).max(queryBuilderJoinLimits.pairs),
  }).strict();
}
export type QueryBuilderJoinConditions = z.infer<ReturnType<typeof queryBuilderJoinSchema>>;
export const queryBuilderAlias = (index: number) => 't' + (index + 1);
export const queryBuilderColumnKey = (index: number, name: string) => queryBuilderAlias(index) + '.' + name;

/** 每条比较必须在括号树中恰好出现一次。 */
export function validateQueryBuilderJoin({ mode, group, pairs }: QueryBuilderJoinConditions, context: z.RefinementCtx) {
  try { manualJoinOnGroup({ mode, group }, pairs.length); }
  catch { context.addIssue({ code: 'custom', path: ['group'], message: 'ON 分组必须与根模式一致，并恰好包含每条比较一次。' }); }
}

/** 仅组合已通过目录校验的字段比较。 */
export function compileQueryBuilderOn(step: QueryBuilderJoinConditions, resolve: (pair: QueryBuilderJoinConditions['pairs'][number]) => string) {
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
  return grouped(step.group ?? { mode: step.mode, children: leaves.map((_, i) => i) });
}
