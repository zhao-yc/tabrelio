import { z } from 'zod';
import { foreignKeyJoinAggregateFunctions, foreignKeyJoinSummaryLimits } from './tableForeignKeyJoinSummary';

const fieldName = z.string().min(1).max(515).refine(value => !/[\0\r\n\uD800-\uDFFF]/u.test(value), '汇总字段名不能含换行、空字符或无效 Unicode');
const alias = fieldName.refine(value => value.trim().length > 0 && new TextEncoder().encode(value).length <= 63, '聚合别名须为 1～63 个 UTF-8 字节');
const aggregate = z.discriminatedUnion('fn', [
  z.object({ fn: z.literal('COUNT_ALL'), alias }).strict(),
  z.object({ fn: z.enum(foreignKeyJoinAggregateFunctions).exclude(['COUNT_ALL']), column: fieldName, alias }).strict(),
]);

export const queryBuilderSummarySchema = z.object({
  groups: z.array(fieldName).max(foreignKeyJoinSummaryLimits.groups),
  aggregates: z.array(aggregate).max(foreignKeyJoinSummaryLimits.aggregates),
  sort: z.array(z.object({ column: fieldName, direction: z.enum(['ASC', 'DESC']), nulls: z.enum(['FIRST', 'LAST']).optional() }).strict()).max(20),
}).strict();
export type QueryBuilderSummary = z.infer<typeof queryBuilderSummarySchema>;

/** 两种引擎只共享表达式形状。函数的类型、比较规则和空值由对应数据库决定。 */
export function compileQueryBuilderSummary(summary: QueryBuilderSummary, field: (name: string) => string,
  quote: (name: string) => string, functionPrefix = '', groupAlias?: (name: string) => string) {
  const { groups, aggregates, sort } = summary;
  const outputs = new Map<string, { position: number; expression: string }>(), folded = new Set<string>();
  function addOutput(name: string, expression: string, alias = name) {
    const key = alias.toLowerCase();
    if (folded.has(key) || outputs.has(name)) throw Error('分组字段和聚合别名必须唯一。');
    folded.add(key);
    outputs.set(name, { position: outputs.size + 1, expression });
  }
  const grouping = groups.map(field);
  const groupOutputs = groups.map((name, index) => {
    const expression = grouping[index], alias = groupAlias?.(name);
    addOutput(name, expression, alias);
    return alias === undefined ? expression : expression + ' AS ' + quote(alias);
  });
  const expressions = aggregates.map(item => {
    const fn = item.fn === 'COUNT_ALL' || item.fn === 'COUNT_DISTINCT' ? 'COUNT' : item.fn;
    const operand = item.fn === 'COUNT_ALL' ? '*' : (item.fn === 'COUNT_DISTINCT' ? 'DISTINCT ' : '') + field(item.column);
    const expression = functionPrefix + fn + '(' + operand + ')';
    addOutput(item.alias, expression);
    return expression + ' AS ' + quote(item.alias);
  });
  if (!outputs.size) throw Error('请添加分组字段或聚合项。');
  const used = new Set<string>();
  const order = sort.map(rule => {
    const output = outputs.get(rule.column);
    if (!output || used.has(rule.column)) throw Error('汇总排序必须引用不重复的当前输出。');
    used.add(rule.column);
    // 位置由当前输出推导，避免别名与未投影的来源列同名时产生歧义。
    return output.position + ' ' + rule.direction + (rule.nulls ? ' NULLS ' + rule.nulls : '');
  });
  // HAVING 使用原表达式，避免 PostgreSQL 拒绝输出别名或 SQLite 优先匹配同名原列。
  function havingField(name: string) {
    const output = outputs.get(name);
    if (!output) throw Error('HAVING 条件引用的汇总输出已移除，请重选或删除该条件。');
    return output.expression;
  }
  return { projection: [...groupOutputs, ...expressions].join(', '),
    groupBy: grouping.length ? ' GROUP BY ' + grouping.join(', ') : '', order, havingField };
}
