import { tableSelectedFilterZh as text } from './locales/tableSelectedFilter.zh-CN';
import type { GridCellRectangle, GridRangeTarget } from './useGridCellRange';

export interface TableRangeFilter<Row> {
  members(range: GridRangeTarget<Row>, exclude: boolean, current: () => boolean): void;
  bounds?(range: GridRangeTarget<Row>, current: () => boolean): ((outside: boolean) => void) | undefined;
}

/** 只在两个端点当前可用时提供操作；执行前重读同一范围，避免用到已变化的值。 */
export function captureTableRangeBounds<Bounds>(read: () => Bounds, current: () => boolean,
  stage: (bounds: Bounds, outside: boolean) => void): ((outside: boolean) => void) | undefined {
  if (!current()) return;
  try {
    const fingerprint = JSON.stringify(read());
    return outside => {
      if (!current()) return;
      let bounds: Bounds;
      try { bounds = read(); } catch { return; }
      if (current() && JSON.stringify(bounds) === fingerprint) stage(bounds, outside);
    };
  } catch { /* 无准确双端原值时保留普通选区操作。 */ }
}

/** 只给单列选区生成菜单动作；触发后仍须持有原网格和原矩形。 */
export function tableRangeFilterActions<Row>(rectangle: GridCellRectangle, capture: () => GridRangeTarget<Row> | undefined,
  current: () => boolean, apply: TableRangeFilter<Row>) {
  if (rectangle.left !== rectangle.right) return [];
  const run = (exclude: boolean) => {
    if (!current()) return;
    const range = capture();
    if (range && current()) apply.members(range, exclude, current);
  };
  const range = rectangle.bottom - rectangle.top === 1 && apply.bounds ? capture() : undefined;
  const bounds = range && apply.bounds?.(range, current);
  return [
    ...(bounds ? [
      { label: text.rangeBetween, run: () => bounds(false) },
      { label: text.rangeNotBetween, run: () => bounds(true) },
    ] : []),
    { label: text.rangeEntry, run: () => run(false) },
    { label: text.rangeExclude, run: () => run(true) },
  ];
}
