import { tableSelectedFilterZh as text } from './locales/tableSelectedFilter.zh-CN';
import type { GridCellRectangle, GridRangeTarget } from './useGridCellRange';

export type TableRangeFilter<Row> = (range: GridRangeTarget<Row>, exclude: boolean, current: () => boolean) => void;

/** 只给单列选区生成菜单动作；触发后仍须持有原网格和原矩形。 */
export function tableRangeFilterActions<Row>(rectangle: GridCellRectangle, capture: () => GridRangeTarget<Row> | undefined,
  current: () => boolean, apply: TableRangeFilter<Row>) {
  if (rectangle.left !== rectangle.right) return [];
  const run = (exclude: boolean) => {
    if (!current()) return;
    const range = capture();
    if (range && current()) apply(range, exclude, current);
  };
  return [
    { label: text.rangeEntry, run: () => run(false) },
    { label: text.rangeExclude, run: () => run(true) },
  ];
}
