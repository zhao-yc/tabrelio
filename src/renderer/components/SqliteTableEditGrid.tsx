import { isGridContextKey, useGridCellActionMenu, type GridCellAction } from './GridCellActionMenu';
import { sqliteRowIdColumn, sqliteRowIdKey } from './SqliteRowIdColumn';
import { useGridHeaderMenu, type GridHeaderColumnVisibility, type GridHeaderFreeze } from './GridHeaderMenu';
import { gridRowSqlActions } from '../gridRowSqlActions';
import { gridQuickValueKinds, sqliteQuickValueAllowed, type GridQuickValue } from '../gridQuickValue';
import { gridQuickValueZh as quickValueText } from '../locales/gridQuickValue.zh-CN';
import { GridHeaderDetails } from './GridHeaderDetails';
import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type MouseEvent, type Ref, type CSSProperties } from 'react';
import { gridCellRangeClass, useGridCellRange, type GridCellRectangle, type GridRangeTarget } from '../useGridCellRange';
import { copyGridRangeNames, copyGridRangeText, gridHeaderDataCopyActions, gridRangeCopyActions } from '../gridRangeCopy';
import { snapshotGridRangeExport, type GridRangeExportData } from '../gridRangeExport';
import { gridRangeExportZh as rangeExportText } from '../locales/gridRangeExport.zh-CN';
import { sqliteBinaryOriginalCell } from '../sqliteBinaryInput';
import { GridRangeFill } from './GridRangeFill';
import { gridRangeFillActions, type GridRangeFillInput, type GridRangeFillKind } from '../gridRangeFill';
import { gridRangeFillZh as rangeFillText } from '../locales/gridRangeFill.zh-CN';
import { tableRangeFilterActions, type TableRangeFilter } from '../tableRangeFilter';
import { errorMessage } from '../lib';
import { DataGrid, SelectColumn, renderCheckbox, renderHeaderCell, type Column, type DataGridHandle, type SortColumn } from 'react-data-grid';
import type { SqliteDraftRow } from '../sqliteTableEditor';
import type { SqliteTablePage } from '../../shared/sqliteTableBrowse';
import { sqliteTableEditZh as text } from '../locales/sqliteTableEdit.zh-CN';
import { sqliteTableClipboardZh as clipboardText } from '../locales/sqliteTableClipboard.zh-CN';
import { encodeSqliteClipboard, sqliteClipboardProtocolCell, writeSqliteClipboardData } from '../sqliteTableClipboard';
import { sqliteTableRangePasteZh as rangeText } from '../locales/sqliteTableRangePaste.zh-CN';
import type { SqlitePasteAnchor } from '../sqliteTableRangePaste';
import type { SqliteCheckedRows } from '../sqliteTableSelection';
import '../sqliteTableClipboard.css';
import { sqliteTableBrowseZh as browseText } from '../locales/sqliteTableBrowse.zh-CN';
import { GridRowSelectionActions, mergeGridMatchSelection, type GridMatchRowsAction, gridRowKeys, handleGridSelectAllKey } from './GridRowSelectionActions';
import { GridRowJump } from './GridRowJump';
import { focusGridColumn, GridColumnJump } from './GridColumnJump';
import { readGridRowHeight, type GridRowHeight } from '../../shared/gridRowHeight';
import { copyGridColumnNames, encodeGridCsv, encodeGridJson, writeTableClipboardEvent } from '../gridClipboard';
import { gridJsonClipboardZh as jsonCopyText } from '../locales/gridJsonClipboard.zh-CN';
import { gridCsvClipboardZh as csvCopyText } from '../locales/gridCsvClipboard.zh-CN';
import { CopyInsertSqlButtons } from './CopyInsertSqlButtons';
import { copyInsertSqlZh as insertCopyText } from '../../shared/copyInsertSql.zh-CN';
import { primaryKeyCopyZh as keyCopyText } from '../locales/primaryKeyCopy.zh-CN';
import { sqliteCopyDeleteDraftRows, sqliteCopyInsertDraftRows, sqliteCopyPrimaryKeyDraftRows, sqliteCopyUpdateDraftRows } from '../sqliteCopyInsertSql';
import { saveGridCell } from '../gridCellFile';
import { gridCellFileZh } from '../locales/gridCellFile.zh-CN';
import { updateSqlCopyZh } from '../locales/updateSqlCopy.zh-CN';
import { deleteSqlCopyZh } from '../locales/deleteSqlCopy.zh-CN';
import type { RowSqlKind } from '../openRowSqlDraft';
import { useWorkspace } from '../store';
import { fitGridColumnWidths, gridResizeHandleColumn, type GridColumnFitSource } from '../gridColumnFit';
import { gridColumnWidthBatchZh } from '../locales/gridColumnWidthBatch.zh-CN';
import { GridCellImage } from './GridCellImage';
import { tableFieldFindClass, type TableFieldFindDisplay } from './TableFieldFind';
import { tableHeaderCopyZh as headerCopyText } from '../locales/tableHeaderCopy.zh-CN';

export interface SqliteTableFindGridHit { id: string; page: SqliteTablePage; rows: readonly SqliteDraftRow[]; row: SqliteDraftRow; column: number; focus: boolean; range?: { start: number; end: number }; }
interface Props { showGridImages?: boolean; onFindColumn?(key: string): void; showFieldType?: boolean; showRowId?: boolean; onShowFieldTypeChange?(show: boolean): void; page: SqliteTablePage; rows: SqliteDraftRow[]; disabled: boolean; selected?: string; initialCheckedRows?: ReadonlySet<string>; matchRowsRef?: Ref<GridMatchRowsAction<string>>; isCurrent(): boolean; onOpenRowSql?(kind: RowSqlKind, sql: string): void; onSelect(row: SqliteDraftRow): void; onEdit(row: SqliteDraftRow, column: number): void; onPaste?(data: Pick<DataTransfer, 'types' | 'getData'>, anchor?: SqlitePasteAnchor, range?: GridRangeTarget<SqliteDraftRow>): void; onActiveCell?(anchor: SqlitePasteAnchor | undefined): void; onQuickValue?(anchor: SqlitePasteAnchor, kind: GridQuickValue): void; onFillRange?(range: GridRangeTarget<SqliteDraftRow>, input: GridRangeFillInput): void; onExportRange?(result: GridRangeExportData): void; onFilterTableRange?: TableRangeFilter<SqliteDraftRow>; onFilterCell?(anchor: SqlitePasteAnchor | undefined): void; cellMenuFilters?(row: SqliteDraftRow, column: number): { actions: GridCellAction[] } | undefined; onCheckedRows?(selection: SqliteCheckedRows): void; findHit?: SqliteTableFindGridHit; fieldFind?: TableFieldFindDisplay; findHighlights?: ReadonlyMap<string, ReadonlySet<number>>; rowHeight?: GridRowHeight; onRowHeightChange?(height: number): void; sort?: readonly SortColumn[]; onSortChange?(next: readonly SortColumn[]): void; projection?: readonly { index: number; width?: number; frozen: boolean }[]; onColumnResize?(key: string, width: number): void; freezeColumns?: GridHeaderFreeze; columnVisibility?: GridHeaderColumnVisibility; onColumnReorder?(source: string, target: string): void; fitSource?(): GridColumnFitSource | undefined; }
/** 仅SQLite编辑快照使用此虚拟网格；任意查询的ResultsGrid继续保持只读。 */
export function SqliteTableEditGrid({ showGridImages, onFindColumn, showFieldType, showRowId, onShowFieldTypeChange, page, rows, disabled, selected, initialCheckedRows, matchRowsRef, isCurrent, onOpenRowSql, onSelect, onEdit, onPaste, onActiveCell, onQuickValue, onFillRange, onExportRange, onFilterTableRange, onFilterCell, cellMenuFilters, onCheckedRows, findHit, fieldFind, findHighlights, sort, onSortChange, projection, onColumnResize, freezeColumns, columnVisibility, onColumnReorder, fitSource, rowHeight, onRowHeightChange }: Props) {
  const height = readGridRowHeight(rowHeight);
  const display: readonly { index: number; width?: number; frozen: boolean }[] = projection ?? page.columns.map((_, index) => ({ index, frozen: false }));
  if (!display.length || new Set(display.map(column => column.index)).size !== display.length || display.some(column => !Number.isInteger(column.index) || column.index < 0 || column.index >= page.columns.length || column.width !== undefined && (!Number.isInteger(column.width) || column.width < 64 || column.width > 2000))) throw Error('SQLite显示列映射无效');
  const orderKey = JSON.stringify(display.map(column => column.index)), orderRef = useRef<{ key: string; indices: readonly number[] }>({ key: orderKey, indices: Object.freeze(display.map(column => column.index)) });
  if (orderRef.current.key !== orderKey) orderRef.current = { key: orderKey, indices: Object.freeze(display.map(column => column.index)) };
  const order = orderRef.current.indices, naturalOrder = order.length === page.columns.length && order.every((column, index) => column === index);
  const ticket = {}, committed = useRef<object | undefined>(undefined);
  const grid = useRef<DataGridHandle | null>(null), handledFind = useRef<string | undefined>(undefined);
  const source = useRef({ page, rows, identity: {} }); if (source.current.page !== page || source.current.rows !== rows) source.current = { page, rows, identity: {} };
  const owner = source.current, [, selectionChanged] = useState(0), [error, setError] = useState('');
  const rangeKeys = useMemo(() => order.map(index => 'c' + index), [order]);
  const rangeRowIndex = useMemo(() => new Map(rows.map((row, index) => [row, index])), [rows]);
  const rangeCurrent = () => !disabled && current() && noModal();
  const cellRange = useGridCellRange(rows, rangeKeys, owner, 2, grid, rangeCurrent);
  const selection = useRef<{ owner: typeof owner; ids: ReadonlySet<string>; revision: object }>({ owner, ids: initialCheckedRows ?? new Set(), revision: {} });
  // 返回同一个缓存页时恢复准确行数组的勾选。新草稿数组不会继承原选择。
  if (selection.current?.owner !== owner) selection.current = { owner, ids: new Set(initialCheckedRows), revision: {} };
  const selectedRows = selection.current.ids, selectionTicket = selection.current.revision;
  // capture只读最新已提交上下文，父接纳selection引发重渲染不会撤销同源勾选。
  const checkedContext = useRef<{ owner: typeof owner; disabled: boolean; isCurrent(): boolean } | undefined>(undefined);
  const checkedProof = useRef<{ owner: typeof owner; revision: object; capture: SqliteCheckedRows; canRenew(): boolean; invalidate(recoverable?: boolean): void } | undefined>(undefined), checkedNotified = useRef<SqliteCheckedRows | undefined>(undefined), checkedNotify = useRef(onCheckedRows); checkedNotify.current = onCheckedRows;
  if (checkedProof.current?.owner !== owner) checkedProof.current?.invalidate();
  else if (disabled) checkedProof.current?.invalidate(true);
  useLayoutEffect(() => { const context = { owner, disabled, isCurrent }; checkedContext.current = context; return () => { if (checkedContext.current === context) checkedContext.current = undefined; }; });
  /** 每个checkbox修订绑定完整非删除原行，临时失效后只能签新token，旧token永久拒绝。 */
  function checkedCapture(force = false): SqliteCheckedRows | undefined {
    if (source.current !== owner || selection.current.owner !== owner) return;
    const revision = selection.current.revision, previous = checkedProof.current;
    if (!force && previous?.owner === owner && previous.revision === revision) return previous.capture;
    previous?.invalidate();
    const originalRows = [...rows], targetSignature = JSON.stringify([page.target, page.schemaKey, page.columns, page.edit?.kind === 'editable' ? [page.edit.snapshotId, page.edit.columns] : page.edit]);
    const selected = Object.freeze(rows.filter(row => selection.current.ids.has(row.id) && !row.deleted)), original = selected.map(row => ({ row, id: row.id, index: row.index, values: row.values }));
    let valid = true, sourceValid = true, renewable = false;
    /** 来源失败留下独立墓碑，不能借临时disabled或Modal恢复重签到已变化的行。 */
    const sourceCurrent = () => {
      try {
        const actual = rows.filter(row => selection.current.ids.has(row.id) && !row.deleted);
        if (!sourceValid || source.current !== owner || selection.current.owner !== owner || selection.current.revision !== revision || rows.length !== originalRows.length || rows.some((row, index) => row !== originalRows[index]) || JSON.stringify([page.target, page.schemaKey, page.columns, page.edit?.kind === 'editable' ? [page.edit.snapshotId, page.edit.columns] : page.edit]) !== targetSignature || new Set(selected.map(row => row.id)).size !== selected.length || original.some(item => !rows.includes(item.row) || item.row.deleted || item.row.id !== item.id || item.row.index !== item.index || item.row.values !== item.values) || actual.length !== selected.length || actual.some((row, index) => row !== selected[index])) sourceValid = false;
      } catch { sourceValid = false; }
      if (!sourceValid) { valid = false; renewable = false; } return sourceValid;
    };
    const capture: SqliteCheckedRows = Object.freeze({ page, rows, selected, selectionCurrent: sourceCurrent, current() {
      if (!sourceCurrent() || !valid) return false;
      const context = checkedContext.current;
      try { if (!context || context.owner !== owner || context.disabled || !context.isCurrent() || !noModal()) { valid = false; renewable = true; } }
      catch { valid = false; renewable = true; }
      return valid;
    } });
    checkedProof.current = { owner, revision, capture, canRenew: () => sourceCurrent() && renewable, invalidate: (recoverable = false) => { valid = false; renewable = recoverable && sourceValid; } }; return capture;
  }
  /** 只在事件或准确新owner提交后通知；卸载不发无目标清空，避免覆盖继任capture。 */
  function notifyChecked(force = false): void { const capture = checkedCapture(force); if (!capture || checkedNotified.current === capture) return; checkedNotified.current = capture; try { checkedNotify.current?.(capture); } catch { checkedProof.current?.invalidate(); setError(rangeText.stale); } }
  useEffect(() => {
    const context = checkedContext.current; if (source.current !== owner || context?.owner !== owner) return;
    const previous = checkedProof.current;
    if (!previous || previous.owner !== owner || previous.revision !== selection.current.revision) { notifyChecked(); return; }
    if (previous.capture.current() || !previous.canRenew()) return;
    // 父layout与当前DOM均已提交，恢复时只签一次fresh token，不让旧授权复活。
    try { if (!context.disabled && context.isCurrent() && noModal()) notifyChecked(true); } catch { /* 当前门无法确认时保留旧墓碑。 */ }
  });
  const activeCell = useRef<{ owner: typeof owner; value?: SqlitePasteAnchor; position?: { row: SqliteDraftRow; key: string }; reason: string; revision: object }>({ owner, reason: rangeText.anchorRequired, revision: {} });
  if (activeCell.current.owner !== owner) activeCell.current = { owner, reason: rangeText.anchorRequired, revision: {} };
  const anchorTicket = activeCell.current.revision, notified = useRef<SqlitePasteAnchor | undefined>(undefined), notifyRef = useRef(onActiveCell); notifyRef.current = onActiveCell;
  const sameAnchor = (left: SqlitePasteAnchor | undefined, right: SqlitePasteAnchor | undefined) => left?.row === right?.row && left?.column === right?.column && left?.columns === right?.columns;
  /** 真正的cell事件同步通知，避免子layout先于父页渲染票据提交而丢掉准确起点。 */
  function notifyAnchor(value: SqlitePasteAnchor | undefined): void { if (sameAnchor(notified.current, value)) return; notified.current = value; try { notifyRef.current?.(value); } catch { setError(rangeText.stale); } }
  // 源page/rows重绑后的清空只在提交后通知；自己的disabled或Modal不改变真实活动位置。
  useEffect(() => { notifyAnchor(activeCell.current.value); });
  // 布局窗口关闭后重新签当前物理格的可见列顺序；隐藏的原格不再提供粘贴资格。
  useEffect(() => { const cell = activeCell.current; if (cell.position && (naturalOrder ? cell.value?.columns !== undefined : cell.value?.columns !== order)) captureCell(cell.position.row, cell.position.key); });
  useEffect(() => () => { if (notified.current !== undefined) { notified.current = undefined; try { notifyRef.current?.(undefined); } catch { /* 旧组件卸载不得向其它目标补发动作。 */ } } }, []);
  useLayoutEffect(() => { committed.current = ticket; return () => { if (committed.current === ticket) committed.current = undefined; }; });
  /** 父layout提交票据后才导航；一次token只滚动一次，焦点请求走RDG真实活动格API。 */
  useEffect(() => {
    const hit = findHit, handle = grid.current;
    if (!hit || handledFind.current === hit.id + orderKey || hit.page !== page || hit.rows !== rows || !rows.includes(hit.row) || hit.row.deleted || !Number.isInteger(hit.column) || hit.column < 0 || hit.column >= page.columns.length || disabled || !baseCurrent(hit.row) || !noModal() || !handle?.element || !handle.element.ownerDocument.contains(handle.element)) return;
    const displayed = order.indexOf(hit.column); if (displayed < 0) return;
    handledFind.current = hit.id + orderKey;
    const position = { rowIdx: rows.indexOf(hit.row), idx: displayed + 2 };
    handle.scrollToCell(position);
    if (hit.focus && baseCurrent(hit.row) && !disabled && noModal() && grid.current?.element === handle.element) handle.setActivePosition(position, { shouldFocus: true });
  }, [findHit, owner, disabled, orderKey]);
  const fieldFindTarget = fieldFind?.current;
  // 与数据命中一样，等父页提交当前渲染凭据后再定位标题。
  useEffect(() => {
    const handle = grid.current;
    if (!fieldFindTarget || disabled || !baseCurrent() || !noModal() || !handle?.element?.isConnected) return;
    const displayed = order.findIndex(index => page.result.columns[index].key === fieldFindTarget.key);
    if (displayed < 0) return;
    const idx = displayed + 2;
    handle.scrollToCell({ idx });
    if (fieldFindTarget.focus) handle.setActivePosition({ rowIdx: -1, idx }, { shouldFocus: true });
  }, [fieldFindTarget, owner, disabled, orderKey]);
  /** 虚拟行复用不授予旧对象权限；复制同样检查原页和准确rows，不能从当前选中名称猜数据。 */
  function baseCurrent(row?: SqliteDraftRow): boolean { try { return committed.current === ticket && source.current === owner && isCurrent() && (!row || rows.includes(row)); } catch { return false; } }
  function localCurrent(): boolean { return committed.current === ticket && source.current === owner && selection.current.revision === selectionTicket && activeCell.current.revision === anchorTicket; }
  function current(row?: SqliteDraftRow): boolean { return localCurrent() && baseCurrent(row); }
  /** 起点只从RDG真实cell位置事件取得，不能借selectedRow、复选框或行号推测。 */
  function captureCell(row?: SqliteDraftRow, key = ''): void {
    if (!baseCurrent(row) || !noModal()) return;
    const column = Number(key.slice(1)), position = row ? { row, key } : undefined;
    // 筛选允许读取生成列；粘贴起点仍沿原可写字段限制。
    onFilterCell?.(!disabled && row && !row.deleted && /^c(?:0|[1-9]\d*)$/.test(key) && Number.isSafeInteger(column) && order.includes(column) && page.columns[column] ? { row, column } : undefined);
    let reason: string = rangeText.anchorRequired, value: SqlitePasteAnchor | undefined;
    if (disabled || page.edit?.kind !== 'editable') reason = rangeText.readonly;
    else if (row?.deleted) reason = rangeText.deleted;
    else if (row && /^c(?:0|[1-9]\d*)$/.test(key) && Number.isSafeInteger(column) && order.includes(column) && page.columns[column]) { if (page.columns[column].generated || page.edit.columns[column]?.generated) reason = rangeText.generated; else { value = Object.freeze({ row, column, ...(!naturalOrder ? { columns: order } : {}) }); reason = ''; } }
    const before = activeCell.current;
    if (before.position?.row === position?.row && before.position?.key === position?.key && sameAnchor(before.value, value) && before.value?.columns === value?.columns && before.reason === reason) return;
    activeCell.current = { owner, value, position, reason, revision: {} }; notifyAnchor(value); selectionChanged(revision => revision + 1);
  }
  function noModal(): boolean { return !document.querySelector('[role="dialog"], [role="alertdialog"]'); }
  /** 输入控件保留自己的剪贴板语义，不截获文字编辑器、搜索框或其它模态的copy/paste。 */
  function inputTarget(event: ClipboardEvent<HTMLDivElement>): boolean { const node = event.target as HTMLElement | null; return !!node && (node.isContentEditable || ['TEXTAREA', 'SELECT'].includes(node.tagName) || node.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'reset'].includes((node as HTMLInputElement).type)); }
  const currentFindHit = findHit?.page === page && findHit.rows === rows ? findHit : undefined;
  const rowIdFor = (row: SqliteDraftRow) => row.index === undefined ? undefined : page.rowIds?.[row.index];
  const columns: Column<SqliteDraftRow>[] = [SelectColumn, { key: '__row', name: '#', width: 68, frozen: true, renderCell: ({ row }) => <button aria-label={text.select(rows.indexOf(row) + 1)} aria-pressed={selected === row.id} onClick={() => { if (baseCurrent(row)) { onSelect(row); captureCell(row, '__row'); } }}>{rows.indexOf(row) + 1}</button> }, ...display.map(({ index, width, frozen }, position): Column<SqliteDraftRow> => ({
    key: 'c' + index, name: page.columns[index].name + (page.columns[index].generated ? ' · ' + text.generated : ''), minWidth: 64, width: width ?? 180, frozen, resizable: true, draggable: !!onColumnReorder && !disabled, sortable: !!onSortChange && !disabled,
    headerCellClass: tableFieldFindClass(fieldFind, page.result.columns[index].key),
    cellClass: row => {
      if (row.deleted) return;
      const rangeClass = gridCellRangeClass(cellRange.rectangle, rangeRowIndex.get(row), position);
      if (rangeClass) return rangeClass;
      if ((currentFindHit?.row !== row || currentFindHit.column !== index) && findHighlights?.get(row.id)?.has(index)) return 'query-result-find-match';
    },
    // 仅替换显示名称，保留 RDG 自带的排序方向和多列优先级。
    renderHeaderCell: props => renderHeaderCell({ ...props, column: { ...props.column, name:
      <GridHeaderDetails name={String(props.column.name)} type={showFieldType ? page.columns[index].declaredType || browseText.dynamic : undefined}/>
    } }),
    renderCell: ({ row }) => {
      const value = row.values[index], matched = currentFindHit?.row === row && currentFindHit.column === index && !row.deleted;
      const raw = value === undefined ? text.omitted : value.kind === 'null' ? 'NULL' : value.value, range = matched ? currentFindHit.range : undefined;
      const precise = range && Number.isInteger(range.start) && Number.isInteger(range.end) && range.start >= 0 && range.end >= range.start && range.end <= raw.length;
      if (showGridImages && value?.kind === 'blob' && !row.deleted && !precise) return <span title={raw} className={matched ? 'grid-row-preview sqlite-find-hit' : 'grid-row-preview'} data-sqlite-find-current={matched ? 'true' : undefined}><GridCellImage sqliteHex={raw}>{'BLOB · ' + raw}</GridCellImage></span>;
      return <span title={raw} className={matched ? 'grid-row-preview sqlite-find-hit' : 'grid-row-preview'} data-sqlite-find-current={matched ? 'true' : undefined}>{value && value.kind !== 'null' ? value.kind.toUpperCase() + ' · ' : ''}{precise ? <>{raw.slice(0, range.start)}<mark className="sqlite-find-range">{raw.slice(range.start, range.end) || '\u200b'}</mark>{raw.slice(range.end)}</> : raw}</span>;
    },
  })), ...(showRowId && page.rowIds ? [sqliteRowIdColumn(rowIdFor)] : [])];
  /** F2和双击只打开本地typed编辑，不直接投递写入。 */
  function edit(row: SqliteDraftRow, key: string): void { const column = Number(key.slice(1)); if (current(row) && !disabled && !row.deleted && /^c\d+$/.test(key) && page.columns[column] && !page.columns[column].generated) onEdit(row, column); }
  /** 复制沿当前可见列取原值；SQLite 类型化格式始终保留原始数据行。 */
  function clipboardContent(checked: SqliteDraftRow[], row: SqliteDraftRow | undefined, key: string, headers = false) {
    const index = Number(key.slice(1));
    if (!checked.length && (!row || row.deleted || !/^c\d+$/.test(key) || !order.includes(index) || !page.columns[index] || row.values.length !== page.columns.length)) return;
    return encodeGridCells(checked.length ? checked : [row!], checked.length ? order : [index], headers);
  }
  function encodeGridCells(records: readonly SqliteDraftRow[], indices: readonly number[], headers: boolean) {
    if (records.some(item => item.values.length !== page.columns.length)) throw Error(clipboardText.invalid);
    return encodeSqliteClipboard(records.map(item => indices.map(index => item.values[index])),
      indices.map(index => page.columns[index].name), headers);
  }
  /** 标题入口使用本页草稿显示值，编码仍保留 SQLite 存储类及字段名称。 */
  function sqliteHeaderDataActions(current: () => boolean, key?: string, row?: SqliteDraftRow) {
    const index = key === undefined ? undefined : order.find(item => key === 'c' + item);
    if (!rows.length || row?.deleted || key !== undefined && index === undefined) return [];
    const checked = row ? selectedRows.has(row.id) : selectedRows.size > 0;
    const allowed = () => current() && selection.current.revision === selectionTicket && orderRef.current.indices === order && noModal();
    return gridHeaderDataCopyActions(index !== undefined, headers => {
      if (!allowed()) return;
      try {
        const records = row && !checked ? [row] : rows.filter(item => !item.deleted && (!checked || selectedRows.has(item.id)));
        if (!records.length) throw Error(headerCopyText.stale);
        const content = encodeGridCells(records, index === undefined ? order : [index], headers);
        writeTableClipboardEvent(allowed, data => writeSqliteClipboardData(data, content));
        setError('');
      } catch (reason) { if (allowed()) setError(reason instanceof Error ? reason.message : headerCopyText.unavailable); }
    });
  }
  /** RDG的真实copy事件同步写三种MIME；先编码完整内容，失败只清本事件已写的数据。 */
  function copy(row: SqliteDraftRow, key: string, event: ClipboardEvent<HTMLDivElement>): void {
    if (inputTarget(event)) return; event.preventDefault();
    if (!current(row) || !noModal()) return;
    if (key === sqliteRowIdKey && showRowId) {
      const value = rowIdFor(row);
      if (value !== undefined) event.clipboardData.setData('text/plain', value);
      return;
    }
    try {
      const selected = rangeCurrent() ? cellRange.copy(row, key, (item, column) => item.values[Number(column.slice(1))], item => item.deleted) : undefined;
      if (selected ? !selected.values.length : row.deleted) return;
      const content = selected ? encodeSqliteClipboard(selected.values, selected.columns.map(column => page.columns[Number(column.slice(1))].name))
        : clipboardContent(rows.filter(item => selectedRows.has(item.id) && !item.deleted), row, key);
      if (!content) return;
      if (!current(row) || !noModal()) return; writeSqliteClipboardData(event.clipboardData, content); setError('');
    } catch (reason) { try { event.clipboardData.clearData(); } catch { /* 仅原事件可清理，不借系统剪贴板重试。 */ } if (current()) setError(reason instanceof Error ? reason.message : clipboardText.invalid); }
  }
  /** 复制只读本页；JSON 取当前记录的全部可见列。 */
  function copyFromGrid(mode: 'headers' | 'column' | 'json' | 'csv' | 'names') {
    const allowed = () => !disabled && (mode === 'names' ? baseCurrent() : current()) && noModal();
    if (!allowed()) return;
    try {
      if (mode === 'names') {
        copyGridColumnNames(order.map(index => page.columns[index].name), allowed);
        setError('');
        useWorkspace.getState().notify(headerCopyText.namesCopied);
        return;
      }
      const checked = rows.filter(item => selectedRows.has(item.id) && !item.deleted);
      const cell = activeCell.current.position;
      if (selectedRows.size && !checked.length) throw Error(headerCopyText.stale);
      if (mode === 'json' || mode === 'csv') {
        const labels = mode === 'csv' ? csvCopyText : jsonCopyText;
        const encode = mode === 'csv' ? encodeGridCsv : encodeGridJson;
        const records = selectedRows.size ? checked :
          cell && !cell.row.deleted && order.some(index => cell.key === 'c' + index) ? [cell.row] : [];
        if (selectedRows.size && checked.length !== selectedRows.size ||
            records.some(row => row.values.length !== page.columns.length)) throw Error(labels.invalid);
        const columns = order.map(index => ({ key: String(index), name: page.columns[index].name }));
        const content = encode(columns, records, (row, key) => sqliteClipboardProtocolCell(row.values[Number(key)]));
        writeTableClipboardEvent(allowed, data => data.setData('text/plain', content));
        setError('');
        useWorkspace.getState().notify(labels.copied);
        return;
      }
      let content;
      if (mode === 'column') {
        const index = cell ? order.find(index => cell.key === 'c' + index) : undefined;
        if (index === undefined) throw Error(headerCopyText.stale);
        const records = selectedRows.size ? checked : rows.filter(row => !row.deleted);
        if (!records.length) throw Error(headerCopyText.stale);
        content = encodeGridCells(records, [index], false);
      } else {
        content = clipboardContent(checked, cell?.row, cell?.key ?? '', true);
      }
      if (!content) throw Error(headerCopyText.stale);
      writeTableClipboardEvent(allowed, data => writeSqliteClipboardData(data, content));
      setError('');
    } catch (reason) { if (allowed()) setError(reason instanceof Error ? reason.message : headerCopyText.unavailable); }
  }
  /** 只从本次勾选或活动数据格取得原行，生成失败时不产生副作用。 */
  function handleTableSql(build: typeof sqliteCopyInsertDraftRows, checked: boolean, destination: string | ((sql: string) => void),
    menu?: { records(): readonly SqliteDraftRow[] | undefined; current(): boolean }) {
    const allowed = () => !disabled && (menu ? menu.current() : current()) && noModal();
    if (!allowed()) return;
    try {
      const row = activeCell.current.position?.row;
      const records = menu ? menu.records() : checked ? rows.filter(row => selectedRows.has(row.id)) : row ? [row] : [];
      if (!records) return;
      if (checked && records.length !== selectedRows.size) throw Error(insertCopyText.selection);
      const sql = build(page, records);
      if (typeof destination === 'function') {
        if (allowed()) {
          destination(sql);
          setError('');
        }
        return;
      }
      writeTableClipboardEvent(allowed, data => data.setData('text/plain', sql));
      setError('');
      useWorkspace.getState().notify(destination);
    } catch (reason) { if (allowed()) setError(reason instanceof Error ? reason.message : insertCopyText.invalid); }
  }
  /** 矩形覆盖的行按显示顺序提交给原快照校验，不跳过其中的草稿或删除行。 */
  function sqliteRowSqlActions(row: SqliteDraftRow | undefined, current: () => boolean, rectangle?: GridCellRectangle, checked = false) {
    if (!rows.length || row && (row.deleted || row.index === undefined)) return [];
    const menu = { current, records: () => checked ? rows.filter(item => selectedRows.has(item.id))
      : rectangle ? cellRange.capture(rectangle, null)?.rows : row ? [row] : rows };
    return gridRowSqlActions(rectangle ? 'range' : checked ? 'selected' : row ? 'current' : 'all',
      page.insertCopy ? () => handleTableSql(sqliteCopyInsertDraftRows, checked, insertCopyText.copied, menu) : undefined,
      page.primaryKey?.length ? () => handleTableSql(sqliteCopyUpdateDraftRows, checked, updateSqlCopyZh.copied, menu) : undefined);
  }
  const hasActiveDataColumn = order.some(index => activeCell.current.position?.key === 'c' + index);
  /** 原动态类型用于判断文件格式，未填值和已删草稿不参与。 */
  function saveActiveCell(): void {
    const cell = activeCell.current.position;
    if (!cell || cell.row.deleted || !hasActiveDataColumn) return;
    void saveGridCell(() => sqliteClipboardProtocolCell(cell.row.values[Number(cell.key.slice(1))]),
      () => current(cell.row) && !disabled && noModal());
  }
  const cellActionMenu = useGridCellActionMenu();
  const { sizeDialog, reorderColumns, ...headerMenu } = useGridHeaderMenu(cellActionMenu.open, {
    owner, grid: () => grid.current?.element,
    column: index => page.result.columns[order[index - 2]],
    columnNameDialect: 'sqlite', findColumn: onFindColumn,
    sort: sort ?? [], current: () => !disabled && baseCurrent() && noModal(),
    canSort: () => !!onSortChange, applySort: next => onSortChange?.(next),
    selectColumn: index => cellRange.selectColumnAction(index - 2),
    columnActions: (column, current) => [
      ...sqliteHeaderDataActions(current, column.key),
      ...sqliteRowSqlActions(undefined, () => current() && selection.current.revision === selectionTicket, undefined, selectedRows.size > 0),
    ],
    resizeColumn: onColumnResize, rowHeaderColumns: 2,
    rowActions: (index, current) => {
      const row = rows[index];
      if (!row || !baseCurrent(row)) return [];
      // 打开菜单会重渲染网格。行菜单用最新网格状态和原勾选代次核对行，不绑定打开前的渲染票据。
      const allowed = () => current() && rows[index] === row && selection.current.revision === selectionTicket;
      return [...sqliteHeaderDataActions(allowed, undefined, row), ...sqliteRowSqlActions(row, allowed, undefined, selectedRows.has(row.id))];
    },
    visibility: { showType: !!showFieldType, onShowTypeChange: onShowFieldTypeChange },
    resizeRows: onRowHeightChange ? { height, apply: onRowHeightChange } : undefined,
    columnVisibility, reorderColumns: onColumnReorder, freeze: freezeColumns, frozenThrough: page.result.columns[display.filter(column => column.frozen).at(-1)?.index ?? -1]?.key,
  });
  const quickValue = useRef(onQuickValue); quickValue.current = onQuickValue;
  function stageGridRangeFill(rectangle: GridCellRectangle, input: GridRangeFillInput) {
    const range = cellRange.capture(rectangle);
    if (!range || !onFillRange) throw Error(rangeFillText.stale);
    onFillRange(range, input);
  }

  function applyGridRangeFill(rectangle: GridCellRectangle, kind: GridRangeFillKind): void {
    try { stageGridRangeFill(rectangle, { kind, value: '' }); setError(''); }
    catch (reason) { setError(errorMessage(reason)); }
  }

  function openCellActions(row: SqliteDraftRow | undefined, key: string | undefined, target: EventTarget | null, point?: { x: number; y: number }): boolean {
    const index = key?.startsWith('c') ? Number(key.slice(1)) : -1, edit = page.edit;
    if (!row || key === undefined || row.deleted || !order.includes(index) || edit?.kind !== 'editable' || disabled || !baseCurrent(row)) return false;
    const column = edit.columns[index], raw = row.values[index];
    const rowIndex = rows.indexOf(row);
    const rectangle = cellRange.at(row, rowIndex, key), selectRow = cellRange.selectRowAction(row, rowIndex, key);
    const selectAll = cellRange.selectAllAction(row, rowIndex, key);
    const current = () => source.current === owner && checkedContext.current?.owner === owner &&
      !checkedContext.current.disabled && checkedContext.current.isCurrent() && orderRef.current.indices === order && noModal() &&
      (!rectangle || cellRange.rectangleCurrent(rectangle));
    return cellActionMenu.open(target, grid.current?.element, { title: column.name, current, focusTarget: rectangle ? cellRange.focusTarget : undefined, actions: [
      ...(selectRow ? [selectRow] : []),
      ...(selectAll ? [selectAll] : []),
      ...(rectangle ? gridRangeCopyActions(format => {
        try {
          if (format === 'names') return copyGridRangeNames(cellRange.captureColumns(rectangle), page.result.columns, current);
          const selected = cellRange.copyRectangle(rectangle, (item, key) => item.values[Number(key.slice(1))], item => item.deleted);
          if (!selected?.values.length) return;
          const names = selected.columns.map(key => page.columns[Number(key.slice(1))].name);
          if (format === 'csv' || format === 'json') {
            copyGridRangeText(names, selected.values, format, current, sqliteClipboardProtocolCell);
            return;
          }
          const content = encodeSqliteClipboard(selected.values, names, format === 'headers');
          writeTableClipboardEvent(current, data => writeSqliteClipboardData(data, content));
        } catch (reason) { if (current()) setError(reason instanceof Error ? reason.message : clipboardText.invalid); }
      }) : []),
      ...sqliteRowSqlActions(row, current, rectangle),
      ...(rectangle && onExportRange ? [{ label: rangeExportText.action, run: () => {
        try {
          const range = cellRange.capture(rectangle, null);
          if (!range) throw Error(rangeExportText.stale);
          const result = snapshotGridRangeExport(range, page.result.columns, (item, key) => {
            const value = item.values[Number(key.slice(1))];
            if (value?.kind === 'blob') return sqliteBinaryOriginalCell(value.value);
            return value?.kind === 'null' ? null : value?.value;
          }, item => item.deleted, (item, key) => {
            const kind = item.values[Number(key.slice(1))]?.kind;
            return kind && { null: 'n', integer: 'i', real: 'r', text: 't', blob: 'b' }[kind];
          });
          if (current()) onExportRange(result);
        } catch (reason) { if (current()) setError(reason instanceof Error ? reason.message : rangeExportText.stale); }
      } }] : []),
      ...(rectangle && onFillRange ? gridRangeFillActions(rectangle, kind => applyGridRangeFill(rectangle, kind)) : []),
      ...(rectangle && onFilterTableRange ? tableRangeFilterActions(rectangle,
        () => cellRange.capture(rectangle, null), current, onFilterTableRange) : []),
      { label: quickValueText.copyCell, run: () => {
        try {
          const content = clipboardContent([], row, key);
          if (content) writeTableClipboardEvent(current, data => writeSqliteClipboardData(data, content));
        } catch (reason) { if (current()) setError(reason instanceof Error ? reason.message : clipboardText.invalid); }
      } },
      ...(cellMenuFilters?.(row, index)?.actions ?? []),
      ...gridQuickValueKinds.map(kind => ({ label: quickValueText[kind], disabled: !onQuickValue || !sqliteQuickValueAllowed(column, !!edit.strict, kind),
        run: () => quickValue.current?.({ row, column: index }, kind) })),
      { label: gridCellFileZh.action, disabled: !raw || raw.kind === 'null',
        run: () => { void saveGridCell(() => sqliteClipboardProtocolCell(raw), current); } },
    ] }, point);
  }
  /** 当前RDG无内联editor，onCellPaste不会派发；在原生capture接管一次，不伪造editable/onRowsChange。 */
  function paste(event: ClipboardEvent<HTMLDivElement>): void {
    if (inputTarget(event) || !onPaste) return; event.preventDefault(); event.stopPropagation();
    if (!localCurrent()) return;
    if (!baseCurrent() || !noModal()) { setError(rangeText.stale); return; }
    if (disabled || page.edit?.kind !== 'editable') { setError(rangeText.readonly); return; }
    const target = event.target as HTMLElement | null, anchor = activeCell.current.value;
    if (target?.tagName === 'INPUT' || target?.tagName === 'BUTTON' || !anchor) { setError(activeCell.current.reason || rangeText.anchorRequired); return; }
    if (naturalOrder ? anchor.columns !== undefined : anchor.columns !== order) { setError(rangeText.stale); return; }
    if (!rows.includes(anchor.row) || anchor.row.deleted || !page.columns[anchor.column] || page.columns[anchor.column].generated || page.edit.columns[anchor.column]?.generated) { setError(rangeText.stale); return; }
    try {
      const range = cellRange.pasteTarget(anchor.row, 'c' + anchor.column);
      if (range) onPaste(event.clipboardData, anchor, range);
      else onPaste(event.clipboardData, anchor);
      setError('');
    }
    catch (reason) { if (current()) setError(reason instanceof Error ? reason.message : rangeText.invalid); }
  }
  /** 前两列是辅助列，测宽只交给实际显示字段对应的布局键。 */
  function fitHeaderColumn(event: MouseEvent): void {
    const position = gridResizeHandleColumn(event, grid.current?.element);
    if (position === undefined || disabled || !baseCurrent() || !noModal()) return;
    const index = order[position - 2], column = page.columns[index], source = fitSource?.();
    if (!column || !source) return;
    try {
      const width = fitGridColumnWidths(source, new Set([column.name])).get(column.name)!;
      onColumnResize?.(page.result.columns[index].key, width);
    } catch { if (current()) setError(gridColumnWidthBatchZh.fitUnavailable); }
  }
  /** 只移动已载入的可见网格，保持草稿和勾选。 */
  function jumpToGridRow(rowIdx: number): boolean {
    const row = rows[rowIdx], handle = grid.current;
    if (!row || !handle?.element?.isConnected || disabled || !baseCurrent(row) || !noModal()) return false;
    const key = activeCell.current.position?.key, displayed = key ? order.indexOf(Number(key.slice(1))) : -1;
    const position = { rowIdx, idx: Math.max(0, displayed) + 2 };
    handle.scrollToCell(position);
    handle.setActivePosition(position, { enableEditor: false, shouldFocus: true });
    return true;
  }
  /** SQLite 编辑网格前两列是辅助列，显示索引须按本页布局转换。 */
  function jumpToGridColumn(index: number): boolean {
    if (order[index] === undefined || disabled || !baseCurrent() || !noModal()) return false;
    const row = activeCell.current.position?.row;
    return focusGridColumn(grid.current, index + 2, row ? rows.indexOf(row) : -1);
  }
  // 表头、行复选框和页操作共用同一勾选修订与父级通知。
  const rowSelectionKey = (row: SqliteDraftRow) => row.deleted ? undefined : row.id;
  const rowSelectionCurrent = () => !disabled && baseCurrent() && selection.current.revision === selectionTicket && noModal();

  function changeCheckedRows(ids: ReadonlySet<string>) {
    if (!baseCurrent() || selection.current.revision !== selectionTicket || !noModal()) return;
    selection.current = { owner, ids: new Set(rows.filter(row => ids.has(row.id) && !row.deleted).map(row => row.id)), revision: {} };
    notifyChecked();
    selectionChanged(value => value + 1);
  }

  useImperativeHandle(matchRowsRef, () => (matches, checked) => {
    if (!rowSelectionCurrent()) return;
    const eligible = gridRowKeys(rows, row => !row.deleted && matches.has(row.id) ? row.id : undefined);
    const next = mergeGridMatchSelection(selection.current.ids, eligible, checked);
    if (next) changeCheckedRows(next);
  });

  return <div className="sqlite-edit-clipboard-region" {...headerMenu} onPasteCapture={paste} onDoubleClickCapture={fitSource && onColumnResize ? fitHeaderColumn : undefined}>{cellActionMenu.menu}{sizeDialog}{error && <p role="alert">{error}</p>}<div className="sqlite-grid-row-jump"><GridRowJump grid={grid} key={orderKey} scope={owner} count={rows.length} disabled={disabled} onJump={jumpToGridRow}/><button type="button" title={headerCopyText.hint} disabled={disabled || (!selectedRows.size && !hasActiveDataColumn)} onClick={() => copyFromGrid('headers')}>{headerCopyText.action}</button><button type="button" title={headerCopyText.columnHint} disabled={disabled || !hasActiveDataColumn} onClick={() => copyFromGrid('column')}>{headerCopyText.column}</button>
    <GridColumnJump key={'column:' + orderKey} scope={owner} columns={order.map(index => page.columns[index])}
      disabled={disabled} isCurrent={() => !disabled && baseCurrent() && noModal()} onJump={jumpToGridColumn}/>
    <button type="button" title={headerCopyText.namesHint} disabled={disabled} onClick={() => copyFromGrid('names')}>{headerCopyText.names}</button>
    <button type="button" title={gridCellFileZh.hint} disabled={disabled || !hasActiveDataColumn} onClick={saveActiveCell}>{gridCellFileZh.action}</button>
    <button type="button" title={jsonCopyText.hint} disabled={disabled || !selectedRows.size && !hasActiveDataColumn}
      onClick={() => copyFromGrid('json')}>{jsonCopyText.action}</button>
    <button type="button" title={csvCopyText.hint} disabled={disabled || !selectedRows.size && !hasActiveDataColumn}
      onClick={() => copyFromGrid('csv')}>{csvCopyText.action}</button>
    {page.insertCopy && <CopyInsertSqlButtons disabled={disabled} current={hasActiveDataColumn}
      selected={!!selectedRows.size} onCopy={checked => handleTableSql(sqliteCopyInsertDraftRows, checked, insertCopyText.copied)}/>}
    {!!page.primaryKey?.length && <button type="button" title={keyCopyText.hint}
      disabled={disabled || !selectedRows.size && !hasActiveDataColumn}
      onClick={() => handleTableSql(sqliteCopyPrimaryKeyDraftRows, selectedRows.size > 0, keyCopyText.copied)}>{keyCopyText.action}</button>}
    {!!page.primaryKey?.length && <button type="button" title={updateSqlCopyZh.hint}
      disabled={disabled || !selectedRows.size && !hasActiveDataColumn}
      onClick={() => handleTableSql(sqliteCopyUpdateDraftRows, selectedRows.size > 0, updateSqlCopyZh.copied)}>{updateSqlCopyZh.action}</button>}
    {!!page.primaryKey?.length && <button type="button" title={deleteSqlCopyZh.hint}
      disabled={disabled || !selectedRows.size && !hasActiveDataColumn}
      onClick={() => handleTableSql(sqliteCopyDeleteDraftRows, selectedRows.size > 0, deleteSqlCopyZh.copied)}>{deleteSqlCopyZh.action}</button>}
    {page.insertCopy && onOpenRowSql && <button type="button" title={insertCopyText.openHint}
      disabled={disabled || !selectedRows.size && !hasActiveDataColumn}
      onClick={() => handleTableSql(sqliteCopyInsertDraftRows, selectedRows.size > 0, sql => onOpenRowSql('insert', sql))}>{insertCopyText.open}</button>}
    {!!page.primaryKey?.length && onOpenRowSql && ([
      ['select', sqliteCopyPrimaryKeyDraftRows, keyCopyText], ['update', sqliteCopyUpdateDraftRows, updateSqlCopyZh],
      ['delete', sqliteCopyDeleteDraftRows, deleteSqlCopyZh],
    ] as const).map(([kind, build, labels]) => <button key={kind} type="button" title={labels.openHint}
      disabled={disabled || !selectedRows.size && !hasActiveDataColumn}
      onClick={() => handleTableSql(build, selectedRows.size > 0, sql => onOpenRowSql(kind, sql))}>{labels.open}</button>)}
    {onFillRange && cellRange.rectangle && !disabled &&
      <GridRangeFill rectangle={cellRange.rectangle} typed onStage={stageGridRangeFill}/>}
    <GridRowSelectionActions rows={rows} selected={selectedRows} disabled={disabled}
      keyFor={rowSelectionKey}
      isCurrent={rowSelectionCurrent}
      onChange={changeCheckedRows}/></div><DataGrid<SqliteDraftRow, unknown, string> ref={grid} onColumnsReorder={onColumnReorder ? reorderColumns : undefined} aria-label={text.grid} aria-description={onSortChange ? browseText.headerHint : undefined} className={`results-grid grid-row-height-${height}${height >= 56 ? ' grid-row-multiline' : ''}`} style={{ '--grid-data-row-height': `${height}px` } as CSSProperties} columns={columns} rows={rows} rowKeyGetter={row => row.id} rowHeight={height} headerRowHeight={42}
    sortColumns={sort} onSortColumnsChange={next => { if (!disabled && baseCurrent() && noModal()) onSortChange?.(next); }} onColumnResize={onColumnResize ? (column, width) => { if (!disabled && baseCurrent() && noModal() && /^c(?:0|[1-9]\d*)$/.test(column.key) && order.includes(Number(column.key.slice(1)))) onColumnResize(column.key, width); } : undefined}
    renderers={{ renderCheckbox: props => renderCheckbox({ ...props, 'aria-label': props['aria-label'] === 'Select All' ? clipboardText.copyAll : clipboardText.copyRow }) }}
    selectedRows={selectedRows} isRowSelectionDisabled={row => row.deleted} onSelectedRowsChange={changeCheckedRows}
    rowClass={row => row.deleted ? 'row-deleted' : row.index === undefined ? 'row-inserted' : undefined}
    onCellMouseDown={(args, event) => cellRange.mouse(args, event)}
    onCellClick={({ row, column }) => { if (baseCurrent(row)) { onSelect(row); captureCell(row, column?.key); } }}
    onCellDoubleClick={({ row, column }, event) => { event.preventGridDefault(); edit(row, column.key); }}
    onCellContextMenu={({ row, column }, event) => {
      if (event.defaultPrevented || !openCellActions(row, column.key, event.target, { x: event.clientX, y: event.clientY })) return;
      event.preventGridDefault(); event.preventDefault(); event.stopPropagation();
    }}
    onCellKeyDown={(args, event) => {
      const { row, rowIdx, column, mode } = args;
      if (mode === 'ACTIVE' && cellRange.key(args, event)) return;
      if (mode === 'ACTIVE' && onFillRange && cellRange.fillValueKey(args, event, applyGridRangeFill)) return;
      if (mode === 'ACTIVE' && handleGridSelectAllKey(event,
        () => !!row && rows[rowIdx] === row && !!column && order.some(index => column.key === 'c' + index) && rowSelectionCurrent(),
        () => changeCheckedRows(gridRowKeys(rows, rowSelectionKey)))) return;
      if (isGridContextKey(event) && mode === 'ACTIVE' && !event.defaultPrevented && !event.isGridDefaultPrevented() &&
          openCellActions(row, column?.key, event.target)) {
        event.preventGridDefault(); event.preventDefault(); event.stopPropagation(); return;
      }
      if (row && column && event.key === 'F2' && !event.nativeEvent.isComposing) { event.preventDefault(); event.preventGridDefault(); edit(row, column.key); }
    }}
    onCellCopy={({ row, column }, event) => copy(row, column.key, event)}
    onActivePositionChange={({ row, rowIdx, column }) => { cellRange.move(row, rowIdx, column?.key); if (row && baseCurrent(row)) onSelect(row); captureCell(row, column?.key); }}/></div>;
}
