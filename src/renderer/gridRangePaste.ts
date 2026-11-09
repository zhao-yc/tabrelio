import { maxClipboardCells } from './gridClipboard';
import { gridRangePasteZh as text } from './locales/gridRangePaste.zh-CN';

export interface GridPasteShape { rows: number; columns: number; }

/** 保留原矩阵的类型；选区只接受等尺寸内容或可重复的单格。 */
export function fitGridRangePaste<Value>(matrix: Value[][], shape: GridPasteShape, limits = { rows: maxClipboardCells, cells: maxClipboardCells }): Value[][] {
  if (!Number.isSafeInteger(shape.rows) || !Number.isSafeInteger(shape.columns) || shape.rows < 1 || shape.columns < 1 ||
      shape.rows > limits.rows || shape.rows * shape.columns > limits.cells) throw Error(text.limit);
  if (matrix.length === shape.rows && matrix.every(row => row.length === shape.columns)) return matrix;
  if (matrix.length === 1 && matrix[0].length === 1)
    return Array.from({ length: shape.rows }, () => Array<Value>(shape.columns).fill(matrix[0][0]));
  throw Error(text.shape(shape.rows, shape.columns));
}
