/** 把当前可见冻结列和新列放到实际布局开头，恢复隐藏列时也不会把它们加入冻结区。 */
export function appendGridFrozenColumn(order: readonly string[], visible: ReadonlySet<string>, boundary: string | undefined, key: string): string[] | undefined {
  const shown = order.filter(column => visible.has(column));
  const index = shown.indexOf(key);
  const end = boundary === undefined ? -1 : shown.indexOf(boundary);
  if (index < 0 || index <= end) return;
  const frozen = [...shown.slice(0, end + 1), key];
  const frozenKeys = new Set(frozen);
  return [...frozen, ...order.filter(column => !frozenKeys.has(column))];
}
