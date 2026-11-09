import { gridRangeFillZh as text } from './locales/gridRangeFill.zh-CN';
import type { GridCellRectangle, GridRangeTarget } from './useGridCellRange';

export type GridRangeFillDirection = 'down' | 'up';
export type GridRangeFillSide = 'left' | 'right';
export type GridRangeFillKind = 'text' | 'null' | 'integer' | 'real' | 'sequence' | GridRangeFillDirection | GridRangeFillSide;
export interface GridRangeFillInput { kind: GridRangeFillKind; value: string; step?: string; }

/** 等差序列的极值必在端点，先检查字段范围，再按显示行号生成精确整数。 */
export function gridRangeIntegerSequence(input: GridRangeFillInput, count: number, bits = 64, unsigned = false) {
  if (!Number.isSafeInteger(count) || count < 2) throw Error(text.sequenceShape);
  const startText = input.value.trim(), stepText = input.step?.trim() ?? '';
  if (!/^[+-]?\d{1,20}$/.test(startText) || !/^[+-]?\d{1,20}$/.test(stepText)) throw Error(text.sequenceInput);
  const start = BigInt(startText), step = BigInt(stepText);
  if (step === 0n) throw Error(text.sequenceInput);
  const boundary = 1n << BigInt(bits - (unsigned ? 0 : 1));
  const lower = unsigned ? 0n : -boundary, last = start + step * BigInt(count - 1);
  if (start < lower || start >= boundary || last < lower || last >= boundary) throw Error(text.sequenceOverflow);
  return (index: number) => (start + step * BigInt(index)).toString();
}

/** 只给当前选区提供有目标的方向，所有菜单项沿用原批量填充入口。 */
export function gridRangeFillActions(rectangle: GridCellRectangle, apply: (kind: GridRangeFillKind) => void) {
  const actions: { label: string; run(): void }[] = [{ label: text.clear, run: () => apply('null') }];
  const add = (kind: GridRangeFillDirection | GridRangeFillSide) => actions.push({ label: text[kind], run: () => apply(kind) });
  if (rectangle.top < rectangle.bottom) { add('down'); add('up'); }
  if (rectangle.left < rectangle.right) { add('right'); add('left'); }
  return actions;
}

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
