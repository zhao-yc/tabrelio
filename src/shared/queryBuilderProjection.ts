import { z } from 'zod';

export const queryBuilderAliasBytes = 63;
const aliasName = z.string().min(1).max(queryBuilderAliasBytes).refine(name =>
  name.trim().length > 0 && !/[\u0000-\u001f\u007f\uD800-\uDFFF]/u.test(name) &&
  new TextEncoder().encode(name).length <= queryBuilderAliasBytes, '输出别名须为 1～63 个 UTF-8 字节，且不能包含控制字符。');
export const queryBuilderColumnAliasesSchema = z.array(z.object({
  column: z.string().min(1).max(515),
  alias: aliasName,
}).strict()).max(1600);
export type QueryBuilderColumnAlias = z.infer<typeof queryBuilderColumnAliasesSchema>[number];

/** 别名只附着到已选来源字段；不同来源即使同名也不能串用别名。 */
export function queryBuilderAliasMap(columns: readonly string[], aliases: readonly QueryBuilderColumnAlias[] = []) {
  const available = new Set(columns), mapped = new Map<string, string>();
  for (const { column, alias } of aliases) {
    if (!available.has(column) || mapped.has(column)) throw Error('每个输出别名必须对应一个已选字段，且同一字段只能设置一次。');
    mapped.set(column, alias);
  }
  return mapped;
}

/** 显式别名也要避开未改名输出。旧设计在未提供别名时沿用原输出规则。 */
export function queryBuilderOutputAliases(columns: readonly string[], aliases: readonly QueryBuilderColumnAlias[] | undefined,
  defaultName: (column: string) => string, normalize: (name: string) => string = name => name) {
  const mapped = queryBuilderAliasMap(columns, aliases);
  if (mapped.size) {
    const names = columns.map(column => normalize(mapped.get(column) ?? defaultName(column)));
    if (new Set(names).size !== names.length) throw Error('输出别名不能与其他输出列同名。');
  }
  return mapped;
}
