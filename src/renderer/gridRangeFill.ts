import { gridRangeFillZh as text } from './locales/gridRangeFill.zh-CN';
import type { GridRangeTarget } from './useGridCellRange';

export type GridRangeFillDirection = 'down' | 'up';
export type GridRangeFillSide = 'left' | 'right';
export type GridRangeFillKind = 'text' | 'null' | 'integer' | 'real' | GridRangeFillDirection | GridRangeFillSide;
export interface GridRangeFillInput { kind: GridRangeFillKind; value: string; }

/** 取显示顺序的首行或末行作为源。源行保持原引用，待删除行不能作为源或目标。 */
export function gridRangeFillSource<Row>(range: GridRangeTarget<Row>, direction: GridRangeFillDirection,
  deleted: (row: Row, index: number) => boolean) {
  if (range.rows.length < 2 || range.rows.some((row, index) => deleted(row, range.startRow + index))) throw Error(text.target);
  const down = direction === 'down';
  return {
    source: range.rows[down ? 0 : range.rows.length - 1],
    sourceIndex: range.startRow + (down ? 0 : range.rows.length - 1),
    rows: down ? range.rows.slice(1) : range.rows.slice(0, -1),
    startRow: range.startRow + (down ? 1 : 0),
  };
}

/** 横向填充从每行的边缘列取值，原列从目标列中移除。 */
export function gridRangeFillColumns<Key>(keys: readonly Key[], side: GridRangeFillSide) {
  if (keys.length < 2) throw Error(text.target);
  return side === 'right' ? { source: keys[0], targets: keys.slice(1) }
    : { source: keys[keys.length - 1], targets: keys.slice(0, -1) };
}
