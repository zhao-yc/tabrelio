import { mysqlQueryBatchLimits, mysqlQueryReplaceableColumn } from '../shared/mysqlQueryRelation';
import type { DataRow, ResultColumn, TableInfo } from '../shared/contracts';
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
import type { PageTextPatch } from './pageFindReplace';

type ReplacePatch = { row: number; column: number; before: string; after: string };
export type MysqlQueryBatchInput = { kind: 'paste'; matrix: ClipboardCell[][] } | { kind: 'fill'; input: GridRangeFillInput } |
  { kind: 'replace'; patches: ReplacePatch[] } | { kind: 'delete' } | { kind: 'insert' } | { kind: 'new' };

/** 重复投影按原字段去重，显示行号和列名只用于复核。 */
export function planMysqlQueryReplace(rows: readonly DataRow[], visible: readonly ResultColumn[], fields: ReadonlyMap<string, string>, input: readonly PageTextPatch[]) {
  const columns = new Map(visible.map(column => [column.key, column]));
  const patches = new Map<string, { row: number; column: ResultColumn; field: string; before: string; after: string }>();
  const targets = new Map<string, string>();
  for (const { rowId, key, before, after } of input) {
    const row = Number(rowId), field = fields.get(key), column = columns.get(key);
    if (!Number.isSafeInteger(row) || String(row) !== rowId || !rows[row] || !field || !column ||
        ownCell(rows[row], key) !== before || /[\u0000\uD800-\uDFFF]/u.test(after)) throw Error(text.stale);
    if (before === after) continue;
    const identity = JSON.stringify([row, field]), previous = patches.get(identity);
    if (previous && (previous.before !== before || previous.after !== after)) throw Error(text.stale);
    if (!previous) patches.set(identity, { row, column, field, before, after });
    if (!targets.has(field)) targets.set(field, key);
  }
  if (!patches.size) throw Error(text.noChange);
  const positions = [...new Set([...patches.values()].map(patch => patch.row))].sort((a, b) => a - b);
  if (positions.length > mysqlQueryBatchLimits.rows || positions.length * targets.size > mysqlQueryBatchLimits.cells)
    throw Error(rangeText.limit);
  const rowIndex = new Map(positions.map((row, index) => [row, index]));
  const columnIndex = new Map([...targets.keys()].map((field, index) => [field, index]));
  return { patches: [...patches.values()], positions, keys: [...targets.values()],
    changes: [...patches.values()].map(({ row, field, before, after }) => ({
      row: rowIndex.get(row)!, column: columnIndex.get(field)!, before, after,
    })) };
}

/** 每个补丁都要与重新读回的原字段值一致，仅为真正命中的单元格生成写入。 */
function mysqlQueryReplaceChanges(info: TableInfo, originals: DataRow[], columns: string[], patches: ReplacePatch[]) {
  const permitted = new Set(info.columns.filter(column => mysqlQueryReplaceableColumn(info, column)).map(column => column.name));
  const byRow = originals.map(() => new Map<string, string>());
  let bytes = 0;
  for (const { row, column, before, after } of patches) {
    const name = columns[column], draft = byRow[row];
    if (!draft || !name || !permitted.has(name) || draft.has(name) ||
        ownCell(originals[row], name) !== before || before === after || /[\u0000\uD800-\uDFFF]/u.test(after)) throw Error(text.stale);
    bytes += recordBatchCellBytes(after);
    if (bytes > mysqlQueryBatchLimits.bytes) throw Error(rangeText.limit);
    draft.set(name, after);
  }
  if (!byRow.length || byRow.some(draft => !draft.size)) throw Error(text.noChange);
  return byRow.map((draft, row) => ({ kind: 'update' as const, before: originals[row], values: Object.fromEntries(draft) }));
}

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
export function mysqlQueryBatchChanges(info: TableInfo, originals: DataRow[], columns: string[], operation: Exclude<MysqlQueryBatchInput, { kind: 'insert' | 'new' }>) {
  if (operation.kind === 'delete') return originals.map(before => ({ kind: 'delete' as const, before }));
  if (operation.kind === 'replace') return mysqlQueryReplaceChanges(info, originals, columns, operation.patches);
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
