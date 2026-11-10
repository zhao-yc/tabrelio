export type ForeignKeyJoinSide = 'child' | 'parent' | `t${number}`;

/** SQL 别名只由已校验的表位置生成。 */
export function foreignKeyJoinSqlAlias(side: ForeignKeyJoinSide): string {
  return side === 'child' ? 'c' : side === 'parent' ? 'p' : side;
}

/** 条件中的来源必须属于当前 JOIN，旧别名和任意 SQL 片段都不能解析为字段。 */
export function foreignKeyJoinSide<T>(sources: ReadonlyMap<ForeignKeyJoinSide, T>, value: unknown): ForeignKeyJoinSide | undefined {
  if (typeof value !== 'string') return undefined;
  const side = value as ForeignKeyJoinSide;
  return sources.has(side) ? side : undefined;
}
