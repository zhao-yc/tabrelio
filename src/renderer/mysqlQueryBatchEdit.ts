import { mysqlQueryBatchLimits } from '../shared/mysqlQueryRelation';
import type { DataRow, TableInfo } from '../shared/contracts';
import { isBinaryCell } from './binaryCell';
import { collectChanges, type DraftRow } from './dataChanges';
import { cellClipboardType, decodeClipboard, pasteCells, type ClipboardCell } from './gridClipboard';
import { gridRangeFillSource, type GridRangeFillInput } from './gridRangeFill';
import { fitGridRangePaste, type GridPasteShape } from './gridRangePaste';
import { ownCell } from './lib';
import { gridRangeFillZh as rangeText } from './locales/gridRangeFill.zh-CN';
import { mysqlQueryBatchEditZh as text } from './locales/mysqlQueryBatchEdit.zh-CN';
import { batchFillColumns, prepareBatchFill, prepareBatchFillAcross, prepareBatchFillFromRow } from './recordBatchFill';
import { recordBatchCellBytes } from './recordDuplicateBatch';
import type { RecordContext } from './recordViews';

export type MysqlQueryBatchInput = { kind: 'paste'; matrix: ClipboardCell[][] } | { kind: 'fill'; input: GridRangeFillInput };

/** 原生粘贴的内容必须在事件内同步捕获；等尺寸选区也可重复一个值。 */
export function mysqlQueryPasteMatrix(data: Pick<DataTransfer, 'types' | 'getData'>, shape?: GridPasteShape): ClipboardCell[][] {
  const typed = data.types.includes(cellClipboardType) ? data.getData(cellClipboardType) : undefined;
  if (typed === '' || typed === undefined && !data.types.includes('text/plain')) throw Error(text.clipboard);
  const decoded = decodeClipboard(typed ?? '', data.getData('text/plain'), { maximum: mysqlQueryBatchLimits.rows, message: rangeText.limit });
  const width = decoded[0]?.length ?? 0;
  if (!width || decoded.some(row => row.length !== width)) throw Error(text.rectangle);
  return fitGridRangePaste(decoded, shape ?? { rows: decoded.length, columns: width }, mysqlQueryBatchLimits);
}

/** 使用数据库返回的完整值作为草稿基线，方向填充也从同一已核对快照取值。 */
export function mysqlQueryBatchChanges(info: TableInfo, originals: DataRow[], columns: string[], operation: MysqlQueryBatchInput) {
  const context: RecordContext = { target: { connectionId: '', database: info.database, table: info.name }, generation: 0,
    connectionVersion: 0, info, loaded: true, stale: false, busy: false };
  const rows = originals.map((data, index): DraftRow => ({ id: String(index), data, original: data, inserted: false, deleted: false }));
  const permitted = new Map(batchFillColumns(context).map(column => [column.name, column]));
  if (!rows.length || !columns.length || columns.some(name => !permitted.has(name))) throw Error(rangeText.target);
  let next: DraftRow[];
  if (operation.kind === 'paste') {
    const { matrix } = operation;
    let bytes = 0;
    if (matrix.length !== rows.length || matrix.some(row => row.length !== columns.length)) throw Error(text.rectangle);
    for (const [row, values] of matrix.entries()) for (const [index, value] of values.entries()) {
      const name = columns[index], column = permitted.get(name)!;
      if (value === undefined || value === null && !column.nullable || typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value))
        throw Error(rangeText.incompatible(name));
      if (value !== null && (typeof value === 'object') !== isBinaryCell(ownCell(rows[row].data, name), column.type))
        throw Error(rangeText.incompatible(name));
      bytes += recordBatchCellBytes(value);
      if (bytes > mysqlQueryBatchLimits.bytes) throw Error(rangeText.limit);
    }
    next = pasteCells(rows, columns, rows[0].id, columns[0], matrix, new Set());
  } else {
    const { kind, value } = operation.input;
    const range = { rows, keys: columns, startRow: 0 };
    if (kind === 'left' || kind === 'right') next = prepareBatchFillAcross(range, kind, rows, context);
    else if (kind === 'up' || kind === 'down') {
      const source = gridRangeFillSource(range, kind, () => false);
      next = prepareBatchFillFromRow(columns, source.source, rows, new Set(source.rows.map(row => row.id)), context);
    } else {
      if (kind !== 'text' && kind !== 'null') throw Error(rangeText.target);
      next = prepareBatchFill(columns.map(column => ({ column, input: { mode: kind, text: value } })),
        rows, new Set(rows.map(row => row.id)), context);
    }
  }
  const changes = collectChanges(next);
  if (!changes.length) throw Error(text.noChange);
  return changes;
}
