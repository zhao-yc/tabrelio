import { isFocusedDataCell, tableCellEditorKey, tableCellKeyIsComposing } from '../tableCellKeyboard';
import { handleGridRecordKey, type GridRecordActions } from '../gridRecordActions';
import { gridRecordActionsZh as gridRecordText } from '../locales/gridRecordActions.zh-CN';
import { isGridContextKey, useGridCellActionMenu, type GridCellAction } from './GridCellActionMenu';
import { sqliteRowIdColumn, sqliteRowIdKey } from './SqliteRowIdColumn';
import { useGridHeaderMenu, type GridHeaderColumnVisibility, type GridHeaderFreeze, type GridHeaderValueOptions } from './GridHeaderMenu';
import { gridRowSqlActions } from '../gridRowSqlActions';
import { gridQuickValueKinds, type GridQuickValue } from '../gridQuickValue';
import { gridQuickValueZh as quickValueText } from '../locales/gridQuickValue.zh-CN';
import { gridCellEditZh } from '../locales/gridCellEdit.zh-CN';
import { zh } from '../locales/zh-CN';
import { gridZoomDimensions, useGridZoom } from '../gridZoom';
import { readGridRowHeight, type GridRowHeight } from '../../shared/gridRowHeight';
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type MouseEvent, type ReactNode, type Ref } from 'react';
import { DataGrid, SelectColumn, type DataGridHandle, type ColumnWidths, type Column, type CellKeyDownArgs, type CellKeyboardEvent } from 'react-data-grid';
import type { CellValue, ConnectionProfile, DataRow, QueryResult, ResultColumn } from '../../shared/contracts';
import type { QueryResultSortRule, SortDialect } from '../queryResultSort';
import { cellPreview, errorMessage, ownCell } from '../lib';
import { BinaryCellViewer } from './BinaryCellViewer';
import { Modal } from './ui';
import { GridCellImage } from './GridCellImage';
import { binaryCellZh } from '../locales/binaryCell.zh-CN';
import { isBinaryCell } from '../binaryCell';
import { DataTypeColor } from './DataTypeColor';
import { useWorkspace } from '../store';
import { cellClipboardType, copyGridColumnNames, encodeClipboard, encodeGridCsv, encodeGridJson, maxClipboardCells, writeTableClipboardEvent } from '../gridClipboard';
import { saveGridCell } from '../gridCellFile';
import { gridCellFileZh } from '../locales/gridCellFile.zh-CN';
import { fitGridColumnWidths, gridResizeHandleColumn } from '../gridColumnFit';
import { gridColumnWidthBatchZh } from '../locales/gridColumnWidthBatch.zh-CN';
import { GridHeaderDetails, type GridHeaderDetailsOptions } from './GridHeaderDetails';
import { updateSqlCopyZh } from '../locales/updateSqlCopy.zh-CN';
import { deleteSqlCopyZh } from '../locales/deleteSqlCopy.zh-CN';
import type { RowSqlKind } from '../openRowSqlDraft';
import { gridJsonClipboardZh as jsonCopyText } from '../locales/gridJsonClipboard.zh-CN';
import { gridCsvClipboardZh as csvCopyText } from '../locales/gridCsvClipboard.zh-CN';
import type { ResultCheckedRows, ResultGridSelection } from '../resultExport';
import { QueryResultFind, type QueryResultFindControl, type QueryResultFindHit } from './QueryResultFind';
import type { QueryResultFilterRule } from '../queryResultFilter';
import type { QueryResultRowViewKind } from './QueryResultMatchView';
import { queryResultFindZh as rowViewText } from '../locales/queryResultFind.zh-CN';
import { gridCellRangeClass, useGridCellRange, type GridCellRectangle, type GridRangeTarget } from '../useGridCellRange';
import { encodeSqliteResultClipboard, sqliteCellClipboardType } from '../sqliteTableClipboard';
import { copyGridRangeNames, copyGridRangeText, gridHeaderDataCopyActions, gridRangeCopyActions } from '../gridRangeCopy';
import { gridRangeSqliteStorage, snapshotGridRangeExport, type GridRangeExportData } from '../gridRangeExport';
import { gridRangeExportZh as rangeExportText } from '../locales/gridRangeExport.zh-CN';
import { GridRangeFill, type GridRangeFillHandle } from './GridRangeFill';
import { GridEmptyState } from './GridEmptyState';
import { gridRangeFillActions, type GridRangeFillInput, type GridRangeFillKind } from '../gridRangeFill';
import { gridRangeFillZh as rangeFillText } from '../locales/gridRangeFill.zh-CN';
import { tableRangeFilterActions, type TableRangeFilter } from '../tableRangeFilter';
import type { QueryResultFindScan } from '../queryResultFind';
import { appModalSelector, gridDialogCurrent } from '../modalSelectors';
import { GridRowSelectionActions, mergeGridMatchSelection, type GridMatchRowsAction, gridRowKeys, handleGridSelectAllKey } from './GridRowSelectionActions';
import { useGridCheckedRange } from './useGridCheckedRange';
import { GridRowJump } from './GridRowJump';
import { focusGridColumn, GridColumnJump } from './GridColumnJump';
import { encodeQueryResultColumn, encodeQueryResultWithHeaders, encodeTableGridCopy, writeQueryResultClipboard, type QueryResultCopyCell } from '../queryResultHeaderCopy';
import { queryResultCopyZh as copyText } from '../locales/queryResultCopy.zh-CN';
import { copyInsertSqlZh as insertCopyText } from '../../shared/copyInsertSql.zh-CN';
import { primaryKeyCopyZh as keyCopyText } from '../locales/primaryKeyCopy.zh-CN';
import { CopyInsertSqlButtons } from './CopyInsertSqlButtons';
import { tableHeaderCopyZh as tableCopyText } from '../locales/tableHeaderCopy.zh-CN';
import '../queryResultCopy.css';
import { queryResultSortZh as sortText } from '../locales/queryResultSort.zh-CN';
import { captureQueryResultCellFilter, cellBoundOperators, cellTextOperators, currentQueryResultCellFilter, type CellFilterOperator, type QueryResultCellFilterCapture } from '../queryResultCellFilter';
import { queryResultFilterZh as filterText } from '../locales/queryResultFilter.zh-CN';
import { queryResultHistoryZh as historyText } from '../locales/queryResultHistory.zh-CN';
import { captureQueryResultSelectedFilter, currentQueryResultSelectedFilter, queryResultSelectedBounds, type QueryResultSelectedFilterCapture, type QueryResultSelectedFilterMode } from '../queryResultSelectedFilter';
import { queryResultSelectedFilterZh as selectedFilterText } from '../locales/queryResultSelectedFilter.zh-CN';
import { queryResultStatisticsZh as statisticsText } from '../locales/queryResultStatistics.zh-CN';

/** 任意结果的协议BLOB也可能是TEXT；没有真实结构时只认显式字节包装，NULL仍常规展示。 */
export function isResultBinaryCell(value: CellValue | undefined): boolean { return isBinaryCell(value); }

export interface GridFindTarget { row: number; key: string; focus?: boolean; }

export interface GridCellPresentation {
  value: CellValue | undefined;
  title: string;
  className: string;
  label?: string;
  copyError?: string;
}
type PresentGridCell = (row: DataRow, key: string) => GridCellPresentation | undefined;
function displayedValue(row: DataRow, key: string, present?: PresentGridCell) {
  const display = present?.(row, key);
  return display ? display.value : ownCell(row, key);
}

/** 表页可覆盖展示值，定位、编辑及原页能力仍引用原网格数据。查询结果默认使用原值。 */
export function ResultsGrid({ columns, rows, headerDetails, columnNameDialect, onFindColumn, onFilterColumn, columnValueOptions, onColumnStatistics, frozenKeys, columnWidths, rowHeight, onRowHeightChange, zoomable = false, rowJump = false, rowJumpCurrent, freezeColumns, columnVisibility, onColumnReorder, tableCopy, insertSql, updateSql, deleteSql, primaryKeySql, onOpenRowSql, onColumnWidthsChange, onColumnResize, onActiveRowChange, onActiveRowIndexChange, onActivateRow, focusFirstRowRef, sort, onSortChange, sortReasons, selectionScope, preserveCheckedRowsOnColumnLayout = false, onSelectionChange, onCheckedRows, matchRowsRef, onShowRows, onStageFindFilter, findFilterSource, isCurrent, binarySourceIdentity, binaryIsCurrent, binaryFileActions = true, showGridImages, ownDialog, sqliteSource, sqliteRowIds, filterDialect, onFilterCell, onFilterSelected, onHistoryTravel, onStatistics, onActiveCellChange, cellMenuFilters, cellReference, onCellEdit, canOpenCellEditor, onCellPaste, onEmptyPaste, recordActions, onFillRange, onExportRange, onFilterTableRange, findTarget, findMarks, navigateTo, restoreCell, onGridAnchor, quickValueActions, renderRowSelectionAction, presentCell, skipRowInInversion }: { columns: ResultColumn[]; rows: DataRow[]; headerDetails?: GridHeaderDetailsOptions; columnNameDialect?: ConnectionProfile['dialect']; onFindColumn?(key: string): void; onFilterColumn?(key: string): void; columnValueOptions?: GridHeaderValueOptions; onColumnStatistics?(key: string): void; frozenKeys?: readonly string[]; columnWidths?: ReadonlyMap<string, number>; rowJump?: boolean; rowJumpCurrent?(): boolean; freezeColumns?: GridHeaderFreeze; columnVisibility?: GridHeaderColumnVisibility; onColumnReorder?(source: string, target: string): void; tableCopy?: { enabled: boolean; isCurrent(): boolean }; insertSql?(indices: ReadonlySet<number>): string; updateSql?(indices: ReadonlySet<number>): string; deleteSql?(indices: ReadonlySet<number>): string; primaryKeySql?(indices: ReadonlySet<number>): string; onOpenRowSql?(kind: RowSqlKind, sql: string): void; rowHeight?: GridRowHeight; onRowHeightChange?(height: number): void; zoomable?: boolean; onColumnWidthsChange?(widths: ColumnWidths): void; onColumnResize?(key: string, width: number): void; onActiveRowChange?: (row: DataRow | null) => void; onActiveRowIndexChange?: (index: number | null) => void; onActivateRow?(row: DataRow): void; focusFirstRowRef?: Ref<() => boolean>; sort?: QueryResultSortRule[]; onSortChange?: (sort: QueryResultSortRule[]) => void; sortReasons?: ReadonlyMap<string, string | undefined>; selectionScope?: object; preserveCheckedRowsOnColumnLayout?: boolean; onSelectionChange?(selection: ResultGridSelection): boolean; onCheckedRows?(checked: ResultCheckedRows | undefined): void; matchRowsRef?: Ref<GridMatchRowsAction<number>>; onShowRows?(indices: ReadonlySet<number>, kind?: QueryResultRowViewKind): void; onStageFindFilter?(rule: QueryResultFilterRule): void; findFilterSource?: QueryResult; isCurrent?(): boolean; binarySourceIdentity?: readonly unknown[]; binaryIsCurrent?(): boolean; binaryFileActions?: boolean; showGridImages?: boolean; ownDialog?(): Element | undefined; sqliteSource?: QueryResult; sqliteRowIds?: readonly string[]; filterDialect?: SortDialect; onFilterCell?(cell:QueryResultCopyCell,operator:CellFilterOperator):void;onFilterSelected?(capture:QueryResultSelectedFilterCapture, rangeCurrent?: () => boolean, mode?: QueryResultSelectedFilterMode):void;onHistoryTravel?(direction:-1|1):void;onStatistics?(column:ResultColumn,indices:ReadonlySet<number>):void; onActiveCellChange?(cell: QueryResultCopyCell | undefined): void; cellMenuFilters?(cell: QueryResultCopyCell): { label?: string; actions: GridCellAction[] } | undefined; cellReference?: { label: string; allowed(cell: QueryResultCopyCell): boolean; open(cell: QueryResultCopyCell): void }; onCellEdit?(cell: QueryResultCopyCell, anchor: HTMLElement, initialText?: string): boolean; canOpenCellEditor?(cell: QueryResultCopyCell): boolean; onCellPaste?(cell: QueryResultCopyCell, data: DataTransfer, range?: GridRangeTarget<DataRow>): void; onEmptyPaste?(data: DataTransfer): void; recordActions?: GridRecordActions<QueryResultCopyCell>; onFillRange?(range: GridRangeTarget<DataRow>, input: GridRangeFillInput): void; onExportRange?(result: GridRangeExportData): void; onFilterTableRange?: TableRangeFilter<DataRow>; findTarget?: GridFindTarget; findMarks?: ReadonlySet<string>; navigateTo?: GridFindTarget; restoreCell?: { row: DataRow; key: string }; onGridAnchor?(anchor: GridFindTarget | undefined): void; quickValueActions?: { allowed(cell: QueryResultCopyCell, kind: GridQuickValue): boolean; apply(cell: QueryResultCopyCell, kind: GridQuickValue): void }; renderRowSelectionAction?(indices: ReadonlySet<number>, current: () => boolean, tools?: ReactNode): ReactNode; presentCell?: PresentGridCell; skipRowInInversion?(row: DataRow): boolean }) {
  const height = readGridRowHeight(rowHeight);
  const zoom = useGridZoom();
  const dimensions = gridZoomDimensions(zoomable ? zoom.percent : 100, height, headerDetails?.showType && headerDetails.showComment ? 52 : 40);
  const rowSql = useRef({ insertSql, updateSql });
  rowSql.current = { insertSql, updateSql };
  const theme = useWorkspace(state => state.settings.theme);
  const dataTypeColors = useWorkspace(state => state.settings.dataTypeColors === true);
  /** 只接受当前可见顺序的精确前缀；任一过期、重复或稀疏键整组取消，禁止RDG重排非前缀列。 */
  const frozenCount = (() => {
    if (frozenKeys === undefined || !Array.isArray(frozenKeys)) return 0;
    const count = Object.getOwnPropertyDescriptor(frozenKeys, 'length')?.value;
    if (!Number.isSafeInteger(count) || count < 0 || count > columns.length || new Set(columns.map(column => column.key)).size !== columns.length) return 0;
    for (let index = 0; index < count; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(frozenKeys, String(index));
      if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'string' || !descriptor.value || descriptor.value !== columns[index].key) return 0;
    }
    return count as number;
  })();
  const [gridRevision,setGridRevision]=useState(0), gridRevisionRef=useRef(0);
  const filterCapable=!!(onFilterCell||onFilterSelected||onStatistics)&&!onActiveRowChange;
  // 表页的勾选归当前原行；列投影变化仍撤销旧的列操作、复制和筛选能力。
  const rowColumns = preserveCheckedRowsOnColumnLayout ? undefined : columns;
  const rowScope = useMemo(() => ({}), [rowColumns, rows, selectionScope, gridRevision, filterCapable, sqliteSource, filterDialect]);
  const scope = useMemo(() => ({}), [rowScope, columns, frozenCount]);
  const currentScope = useRef<typeof scope|null>(scope); currentScope.current = scope;
  const [resultImages, setResultImages] = useState(false);
  const imagesShown = showGridImages ?? resultImages;
  const latestPresentation = useRef(presentCell);
  latestPresentation.current = presentCell;
  const alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;currentScope.current=null;};},[]);
  /** 全部网格回调核同一准确scope及父接纳门，不能在切换／模态／卸载后复制旧数据。 */
  function actionCurrent():boolean {if(!alive.current||currentScope.current!==scope||latestPresentation.current!==presentCell||gridRevisionRef.current!==gridRevision)return false;try{return !isCurrent||isCurrent()===true;}catch{return false;}}
  const [statisticsReadyScope,setStatisticsReadyScope]=useState<typeof scope>();
  // 模态卸载前的渲染仍能看到旧DOM；提交后再准入新按钮，不能把旧模态的禁用状态留在新网格。
  useEffect(()=>{if(onStatistics&&actionCurrent())setStatisticsReadyScope(scope);},[scope,onStatistics]);
  /** RDG只回传列和方向；同一活列继承NULL位置及大小写选项，删除后重加则回到默认。 */
  function changeSortColumns(next:readonly {columnKey:string;direction:'ASC'|'DESC'}[]):void{
    if(!actionCurrent())return;
    onSortChange?.(next.map(rule=>{const previous=sort?.find(previous=>previous.column===rule.columnKey);return{column:rule.columnKey,direction:rule.direction,...(previous?.nulls?{nulls:previous.nulls}:{}),...(previous?.ignoreCase!==undefined?{ignoreCase:previous.ignoreCase}:{})};}));
  }
  const gridRef = useRef<DataGridHandle | null>(null);
  const rangeFill = useRef<GridRangeFillHandle>(null);
  const resultFind = useRef<QueryResultFindControl>(null);
  const rangeKeys = useMemo(() => columns.map(column => column.key), [columns]);
  const rangeScope = useMemo(() => ({}), [scope, presentCell]);
  const hasResultTools = !!selectionScope && !!isCurrent && !onActiveRowChange;
  const rangeTools = !onActiveRowChange && (rowJump || hasResultTools || !!tableCopy);
  const rangeCurrent = () => !onActiveRowChange && actionCurrent() && tableCopy?.enabled !== false && tableCopy?.isCurrent() !== false;
  const cellRange = useGridCellRange(rows, rangeKeys, rangeScope, onActiveRowChange ? 0 : 1, gridRef, rangeCurrent, ownDialog);
  useLayoutEffect(() => {
    const target = findTarget ?? navigateTo;
    if (!target || !gridRef.current?.element?.isConnected || !actionCurrent()) return;
    const column = columns.findIndex(item => item.key === target.key);
    if (column < 0 || target.row < -1 || target.row >= rows.length) return;
    const position = { rowIdx: target.row, idx: column + (onActiveRowChange ? 0 : 1) };
    gridRef.current.scrollToCell(target.row < 0 ? { idx: position.idx } : position);
    gridRef.current.setActivePosition(position, { enableEditor: false, shouldFocus: target.focus === true });
  }, [findTarget, navigateTo, columns, rows]);
  /** 原位输入关闭后用原行及可见列定位，虚拟网格可重新创建原 DOM 节点。 */
  useLayoutEffect(() => {
    if (!restoreCell || !actionCurrent() || document.querySelector(appModalSelector)) return;
    const row = rows.indexOf(restoreCell.row), column = columns.findIndex(item => item.key === restoreCell.key);
    if (row >= 0 && column >= 0) focusGridColumn(gridRef.current, column + (onActiveRowChange ? 0 : 1), row);
  }, [restoreCell]);
  const [findHit, setFindHit] = useState<{ scope: typeof scope; hit: QueryResultFindHit }>();
  const activeHit = findHit?.scope === scope && findHit.hit.scan.current() && actionCurrent() ? findHit.hit.match : undefined;
  const [findHighlights, setFindHighlights] = useState<{ scope: typeof scope; scan: QueryResultFindScan }>();
  const activeHighlights = findHighlights?.scope === scope && findHighlights.scan.current() && actionCurrent() ? findHighlights : undefined;
  const showFindHighlights = useCallback((scan: QueryResultFindScan | undefined) => {
    if (currentScope.current === scope && alive.current) setFindHighlights(scan ? { scope, scan } : undefined);
  }, [scope]);
  const [selection, setSelection] = useState<{ scope: typeof scope; indices: ReadonlySet<number> }>();
  const selectedRows = selection?.scope === rowScope ? selection.indices : new Set<number>();
  const [headerCell, setHeaderCell] = useState<{ scope: typeof scope; cell: QueryResultCopyCell }>();
  const copyRevisionRef = useRef(0), copyRevision = copyRevisionRef.current;
  const filterCellRef=useRef<{scope:typeof scope;capture:QueryResultCellFilterCapture}|undefined>(undefined);
  const copyCellRef=useRef<{scope:typeof scope;cell:QueryResultCopyCell}|undefined>(undefined);
  const selectedRowsRef=useRef<{scope:typeof scope;indices:ReadonlySet<number>}|undefined>(undefined);
  const selectionBefore = selectedRowsRef.current;
  const selectedFilterRef=useRef<{scope:typeof scope;revision:number;capture:QueryResultSelectedFilterCapture}|undefined>(undefined);
  const selectedFilterErrorRef=useRef('');
  const activeCopyCell = headerCell?.scope === scope ? headerCell.cell : undefined;
  const activeJumpColumn = useRef<{ scope: typeof scope; key: string }>(undefined);
  const rowJumpIsCurrent = () => {
    if (!actionCurrent() || rowJumpCurrent?.() === false) return false;
    const element = gridRef.current?.element;
    return ownDialog ? !!element && gridDialogCurrent(element, ownDialog) : !document.querySelector(appModalSelector);
  };
  const canSelectRows = !onActiveRowChange && (rowJump || hasResultTools);
  const rowSelectionKey = (row: DataRow, index: number) => skipRowInInversion?.(row) ? undefined : index;
  const rowSelectionCurrent = () => tableCopy?.enabled !== false && selectedRowsRef.current === selectionBefore && rowJumpIsCurrent();
  const checkedRange = useGridCheckedRange(rows, rowScope, { keyFor: rowSelectionKey,
    selected: () => selectedRowsRef.current?.scope === rowScope ? selectedRowsRef.current.indices : selectedRows,
    isCurrent: rowSelectionCurrent, onChange: setSelectedRows });
  const columnJumpAvailable = !!isCurrent && !!selectionScope || !!rowJumpCurrent && tableCopy?.enabled === true;
  const columnJumpIsCurrent = () => columnJumpAvailable && rowJumpIsCurrent();
  /** 定位当前展示数组中的行，保留活动可见列，且不修改勾选集。 */
  function jumpToGridRow(rowIdx: number): boolean {
    const handle = gridRef.current;
    if (!handle?.element?.isConnected || !rowJumpIsCurrent() || !rows[rowIdx] || !columns.length) return false;
    const key = activeJumpColumn.current?.scope === scope ? activeJumpColumn.current.key : undefined;
    const column = columns.findIndex(item => item.key === key);
    return focusGridColumn(handle, Math.max(0, column) + (onActiveRowChange ? 0 : 1), rowIdx);
  }
  /** 定位显示列时沿活动格的原行身份，不修改勾选。 */
  function jumpToGridColumn(index: number): boolean {
    if (!columns[index] || !columnJumpIsCurrent()) return false;
    const cell = copyCellRef.current?.scope === scope ? copyCellRef.current.cell : undefined;
    const rowIdx = cell && rows[cell.index] === cell.row ? cell.index : -1;
    return focusGridColumn(gridRef.current, index + (onActiveRowChange ? 0 : 1), rowIdx);
  }
  /** 仅在明确换列或父级接纳新勾选后捕获；不在旧按钮点击时读取后来选择。 */
  function captureSelectedFilter(cell:typeof copyCellRef.current,indices:ReadonlySet<number>):void{
    selectedFilterRef.current=undefined;selectedFilterErrorRef.current='';
    if(!onFilterSelected||!cell||cell.scope!==scope||!indices.size)return;
    try{selectedFilterRef.current={scope,revision:copyRevisionRef.current,capture:captureQueryResultSelectedFilter(columns,rows,cell.cell,indices,sqliteSource,filterDialect)};}
    catch(reason){selectedFilterErrorRef.current=errorMessage(reason);}
  }
  /** 同坐标重选不一定通知活动位置；显式点击仍须重新核验当前行列。 */
  function captureCopyCell(row: DataRow | undefined, rowIdx: number, column?: { key: string }) {
    if (!actionCurrent()) return;
    if (rowJump && row && rows[rowIdx] === row && column && columns.some(item => item.key === column.key))
      activeJumpColumn.current = { scope, key: column.key };
    if (((!selectionScope || !isCurrent) && !tableCopy) || onActiveRowChange) return;
    copyRevisionRef.current++;
    const next=row && Number.isSafeInteger(rowIdx) && rowIdx >= 0 && rows[rowIdx] === row && (!column || columns.some(item => item.key === column.key)) ? { scope, cell: { index: rowIdx, row, column: columns.find(item => item.key === column?.key) } } : undefined;
    filterCellRef.current=undefined;
    if(onFilterCell&&next)try{filterCellRef.current={scope,capture:captureQueryResultCellFilter(columns,rows,next.cell,sqliteSource,filterDialect)};}catch{/* 不支持的原值仅禁用快捷填入，不影响原复制或查看。 */}
    copyCellRef.current=next;
    onActiveCellChange?.(next?.cell);
    captureSelectedFilter(next,selectedRowsRef.current?.scope===rowScope?selectedRowsRef.current.indices:new Set());
    setHeaderCell(next);
  }
  /** 旧网格回调在首次effect前也不能覆盖新选择；复制仍沿用同一组当前勾选行。 */
  function setSelectedRows(indices: ReadonlySet<number>) {
    if (!actionCurrent()) return;
    const next = new Set(indices);
    // 导出父级须明确接纳同一选择；模态或任务门拒绝时保留原勾选，避免显示与文件范围分离。
    if (onSelectionChange && onSelectionChange({ scope: selectionScope ?? scope, rows, columns, indices: next }) !== true) return;
    if (!actionCurrent()) return;
    copyRevisionRef.current++;selectedRowsRef.current={scope:rowScope,indices:next};captureSelectedFilter(copyCellRef.current,next);setSelection({ scope: rowScope, indices: next });
  }
  /** 查找批量操作合并当下勾选，再沿用网格的原选择及导出接纳门。 */
  function changeMatchingRows(indices: ReadonlySet<number>, checked: boolean): void {
    if (!actionCurrent()) return;
    const previous = selectedRowsRef.current;
    const eligible = [...indices].filter(index => rows[index] && !skipRowInInversion?.(rows[index]));
    const next = mergeGridMatchSelection(previous?.scope === rowScope ? previous.indices : new Set<number>(), eligible, checked);
    if (next) setSelectedRows(next);
  }
  useImperativeHandle(matchRowsRef, () => changeMatchingRows);
  /** 表页按钮与原 Ctrl+C 共用草稿值和 DEFAULT 拒绝规则。 */
  function copyValue(row: DataRow, key: string) {
    const presentation = presentCell?.(row, key);
    if (presentation?.copyError) throw Error(presentation.copyError);
    return presentation ? presentation.value : ownCell(row, key);
  }

  /** CSV 和 JSON 交由编码器处理已暂存的 DEFAULT，缺失的查询结果字段仍视为失效。 */
  function readTabularCopyValue(row: DataRow, key: string, invalid: string) {
    const presentation = tableCopy && presentCell?.(row, key);
    if (presentation) return presentation.value;
    const descriptor = Object.getOwnPropertyDescriptor(row, key);
    if (!descriptor || !('value' in descriptor) || descriptor.value === undefined) throw Error(invalid);
    return descriptor.value as CellValue;
  }

  /** 另存使用当前格的原值或已暂存值，不从格式化后的 DOM 读取。 */
  function saveActiveCell() {
    const cell = activeCopyCell, key = cell?.column?.key;
    if (!cell || key === undefined) return;
    const current = () => actionCurrent() && copyRevisionRef.current === copyRevision && rows[cell.index] === cell.row &&
      !skipRowInInversion?.(cell.row) && tableCopy?.enabled !== false && tableCopy?.isCurrent() !== false &&
      !document.querySelector(appModalSelector);
    void saveGridCell(() => copyValue(cell.row, key), current);
  }

  /** 旧按钮不能复制后来变更的行、列或草稿。 */
  function copyResult(mode: 'headers' | 'column') {
    const current = () => actionCurrent() && copyRevisionRef.current === copyRevision && tableCopy?.isCurrent() !== false;
    if (!current()) return;
    try {
      if (tableCopy) {
        const content = encodeTableGridCopy(mode, columns, rows, selectedRows, activeCopyCell, copyValue);
        writeTableClipboardEvent(current, data => {
          data.setData('text/plain', content.text);
          data.setData(cellClipboardType, content.typed);
        });
      } else {
        const encode = mode === 'headers' ? encodeQueryResultWithHeaders : encodeQueryResultColumn;
        writeQueryResultClipboard(encode(columns, rows, selectedRows, activeCopyCell, sqliteSource), current);
      }
    } catch (reason) { useWorkspace.getState().notify(errorMessage(reason), true); }
  }
  /** 表头复制只需要当前列布局，不借用行勾选或活动格。 */
  function copyVisibleNames() {
    const current = () => actionCurrent() && tableCopy?.enabled !== false &&
      tableCopy?.isCurrent() !== false && !document.querySelector(appModalSelector);
    if (!current()) return;
    try {
      copyGridColumnNames(columns.map(column => column.name), current);
      useWorkspace.getState().notify(tableCopyText.namesCopied);
    } catch (reason) { useWorkspace.getState().notify(errorMessage(reason), true); }
  }
  /** 单格漂移一旦观察就撤销，恢复旧值也不能复活原按钮；新选择必须重新捕获。 */
  function filterCellCurrent(expected:typeof filterCellRef.current):boolean{
    if(!expected||filterCellRef.current!==expected||expected.scope!==scope||!actionCurrent())return false;
    try{if(currentQueryResultCellFilter(expected.capture,columns,rows))return true;}catch{}
    filterCellRef.current=undefined;return false;
  }
  const filterCell=filterCellRef.current,filterCellAllowed=!!onFilterCell&&filterCellCurrent(filterCell);
  /** 只提出当前原格请求；父级再次核准确结果并打开草稿，绝不自动应用或执行SQL。 */
  function filterFromCell(operator:CellFilterOperator):void{
    if(copyRevisionRef.current!==copyRevision||!filterCellCurrent(filterCell)||!onFilterCell)return;
    onFilterCell(filterCell!.capture.cell,operator);
  }
  /** 选择、列、原值或作用域失效后永久丢弃本次捕获，恢复旧值不能复活旧按钮。 */
  function selectedFilterCurrent(expected:typeof selectedFilterRef.current):boolean{
    if(!expected||selectedFilterRef.current!==expected||expected.scope!==scope||expected.revision!==copyRevisionRef.current||!actionCurrent())return false;
    if(currentQueryResultSelectedFilter(expected.capture,columns,rows,sqliteSource))return true;
    selectedFilterRef.current=undefined;selectedFilterErrorRef.current=selectedFilterText.unavailable;return false;
  }
  const selectedFilter=selectedFilterRef.current,selectedFilterAllowed=!!onFilterSelected&&selectedFilterCurrent(selectedFilter);
  /** 子网格只提出准确原值捕获，父级另核已接纳勾选和完整结构后才开审核草稿。 */
  function filterFromSelected(mode: QueryResultSelectedFilterMode):void{
    if(copyRevisionRef.current!==copyRevision||!selectedFilterCurrent(selectedFilter)||!onFilterSelected)return;
    onFilterSelected(selectedFilter!.capture, undefined, mode);
  }
  const checkedBounds = selectedFilterAllowed && !!selectedFilter && queryResultSelectedBounds(selectedFilter.capture);
  const checkedFilterActions = onFilterSelected && ([
    [selectedFilterText.open, selectedFilterText.hint, false],
    [selectedFilterText.exclude, selectedFilterText.excludeHint, true],
    ...(checkedBounds ? [
      [selectedFilterText.checkedBetween, selectedFilterText.boundsHint, 'between'],
      [selectedFilterText.checkedNotBetween, selectedFilterText.boundsHint, 'notBetween'],
    ] as const : []),
  ] as const).map(([label, hint, mode]) =>
    <button key={label} type="button" title={selectedFilterAllowed ? hint : selectedFilterErrorRef.current || selectedFilterText.unavailable}
      disabled={!selectedFilterAllowed} onClick={() => filterFromSelected(mode)}>{label}</button>);
  /** 统计锁定本次活动列和已接纳勾选；旧渲染不能读取后来选择，空结果仍可统计首列。 */
  function openStatistics(key?: string): void {
    if (!onStatistics || !selectedActionCurrent() || (key === undefined && copyRevisionRef.current !== copyRevision)) return;
    const column = key === undefined ? activeCopyCell?.column ?? columns[0] : columns.find(item => item.key === key);
    if(!column||!columns.includes(column))return;
    onStatistics(column,selectedRows);
  }
  const binaryGeneration=useRef({identity:binarySourceIdentity??[],revision:0});
  const binaryIdentity=frozenCount?[...(binarySourceIdentity??[]),frozenCount]:binarySourceIdentity??[];
  if(binaryIdentity.length!==binaryGeneration.current.identity.length||binaryIdentity.some((value,index)=>!Object.is(value,binaryGeneration.current.identity[index])))binaryGeneration.current={identity:binaryIdentity,revision:binaryGeneration.current.revision+1};
  const latestBinaryGuard=useRef(binaryIsCurrent);latestBinaryGuard.current=binaryIsCurrent;
  type BinaryView = { sourceRevision: number; row: DataRow; key: string; rows: DataRow[]; columns: ResultColumn[]; presentation?: PresentGridCell; value: CellValue | undefined; revision: number; workspaceCurrent(): boolean; invalid: boolean };
  const [binary, setBinary] = useState<BinaryView | null>(null);
  const binaryRef=useRef(binary);binaryRef.current=binary;
  const binarySource=useRef({rows,columns});binarySource.current={rows,columns};
  /** 原结果模态会撤销普通网格选择；只读文件用途独立持有已准入的结果来源，不复活选择权限。 */
  function binaryCurrent(expected: BinaryView): boolean {
    if (expected.invalid) return false;
    if (!alive.current || binaryGeneration.current.revision !== expected.sourceRevision || latestBinaryGuard.current && !latestBinaryGuard.current() || binaryRef.current !== expected || binarySource.current.rows !== expected.rows || binarySource.current.columns !== expected.columns || gridRevisionRef.current !== expected.revision || latestPresentation.current !== expected.presentation || displayedValue(expected.row, expected.key, latestPresentation.current) !== expected.value || !expected.workspaceCurrent()) { expected.invalid = true; return false; }
    return true;
  }
  // 同步观察工作区ABA；恢复原tab也不能重新领取旧文件回包。
  useEffect(() => useWorkspace.subscribe(() => { const current=binaryRef.current; if(current)binaryCurrent(current); }), []);
  const rowIndexes = useMemo(() => new Map(rows.map((row, index) => [row, index])), [rows]);
  useEffect(() => { setBinary(null); onActiveRowChange?.(null); }, [columns, rows]);
  useEffect(() => { setBinary(null); }, [presentCell]);
  /** 任意 SQL 结果仅打开只读查看器，绝不从列名推测写表定位或提供写入回调。 */
  function viewBinary(row: DataRow, key: string) {
    const value = displayedValue(row, key, presentCell);
    if (!actionCurrent() || !rowIndexes.has(row) || !columns.some(column=>column.key===key) || !isResultBinaryCell(value)) return;
    const state=useWorkspace.getState(),tab=state.settings.tabs.find(item=>item.id===state.settings.activeTabId),connection=state.connections.find(item=>item.id===tab?.connectionId),version=tab?(state.connectionVersions[tab.connectionId]??0):0;
    // 打开必须经过原actionCurrent；之后只检查同一活动查询及原行列，不借父选择模态门提升权限。
    const workspaceCurrent=()=>{const now=useWorkspace.getState();return !!tab&&now.settings.activeTabId===tab.id&&now.settings.tabs.find(item=>item.id===tab.id)===tab&&!now.activeJobs[tab.id]&&(now.connectionVersions[tab.connectionId]??0)===version&&now.connections.find(item=>item.id===tab.connectionId)===connection;};
    gridRevisionRef.current++;setGridRevision(gridRevisionRef.current);
    const next={sourceRevision:binaryGeneration.current.revision,row,key,rows,columns,presentation:presentCell,value,revision:gridRevisionRef.current,workspaceCurrent,invalid:false};binaryRef.current=next;setBinary(next);
  }
  /** 右键和编辑都按事件所在格定位，不能借用之前选中的行列。 */
  function locateCell(row: DataRow | undefined, rowIdx: number, key: string | undefined, target: EventTarget | null) {
    if (!row || rows[rowIdx] !== row || !actionCurrent() || !(target instanceof Element)) return;
    const column = columns.find(item => item.key === key);
    const element = target.closest<HTMLElement>('[role="gridcell"]');
    if (column && element?.isConnected) return { cell: { row, index: rowIdx, column }, element };
  }

  /** 键盘和双击只作用于候选所属的唯一窗口；叠加确认框时暂停候选操作。 */
  function candidateGridCurrent(element: HTMLElement) {
    const modal = element.closest(appModalSelector);
    return !!onActivateRow && actionCurrent() && gridDialogCurrent(element, modal ? () => modal : ownDialog);
  }

  useImperativeHandle(focusFirstRowRef, () => () => {
    const handle = gridRef.current;
    return !!handle?.element && !!rows.length && !!columns.length && candidateGridCurrent(handle.element) &&
      focusGridColumn(handle, onActiveRowChange ? 0 : 1, 0);
  });

  const cellActionMenu = useGridCellActionMenu(ownDialog);
  function stageGridRangeFill(rectangle: GridCellRectangle, input: GridRangeFillInput) {
    const range = cellRange.capture(rectangle);
    if (!range || !onFillRange) throw Error(rangeFillText.stale);
    onFillRange(range, input);
  }

  function applyGridRangeFill(rectangle: GridCellRectangle, kind: GridRangeFillKind): void {
    try { stageGridRangeFill(rectangle, { kind, value: '' }); }
    catch (reason) { useWorkspace.getState().notify(errorMessage(reason), true); }
  }

  /** 普通 TSV 和通用 MIME 沿用原表示，原生 SQLite 类型只作为额外的粘贴来源。 */
  function gridCopyData(indices: readonly number[], keys: readonly string[], headers?: readonly string[]) {
    if (indices.length * keys.length + (headers?.length ?? 0) > maxClipboardCells) throw Error(zh.clipboard.copyLimit);
    const content = encodeClipboard(indices.map(index => keys.map(key => copyValue(rows[index], key))), headers);
    const sqlite = encodeSqliteResultClipboard(sqliteSource, rows, indices, keys);
    return (data: Pick<DataTransfer, 'setData'>) => {
      data.setData('text/plain', content.text);
      data.setData(cellClipboardType, content.typed);
      if (sqlite !== undefined) data.setData(sqliteCellClipboardType, sqlite);
    };
  }

  /** 读取标题关联的显示列和行，保留通用及 SQLite 原生剪贴板载荷。 */
  function resultHeaderDataActions(current: () => boolean, column?: { key: string; name: string }, index?: number) {
    const fields = column ? [column] : columns;
    if (!rangeTools || !rows.length || !fields.length || tableCopy?.enabled === false) return [];
    const checked = index === undefined ? selectedRows.size > 0 : selectedRows.has(index);
    const allowed = () => current() && selectedActionCurrent() && tableCopy?.isCurrent() !== false;
    return gridHeaderDataCopyActions(!!column, headers => {
      if (!allowed()) return;
      try {
        const indices = index !== undefined && !checked ? [index] : rows.flatMap((row, position) =>
          !skipRowInInversion?.(row) && (!checked || selectedRows.has(position)) ? [position] : []);
        if (!indices.length) throw Error(copyText.invalid);
        writeTableClipboardEvent(allowed, gridCopyData(indices, fields.map(field => field.key),
          headers ? fields.map(field => field.name) : undefined));
      } catch (reason) { if (allowed()) useWorkspace.getState().notify(errorMessage(reason), true); }
    });
  }

  function rangeCopyIndices(target: GridRangeTarget<DataRow>): number[] {
    return target.rows.flatMap((row, index) => skipRowInInversion?.(row) ? [] : [target.startRow + index]);
  }

  /** 结果列可重名。查看按内部键和原行定位，原始缺列也不能伪装成 DEFAULT。 */
  function resultCellValueSource(cell: QueryResultCopyCell) {
    const column = cell.column;
    if (!column || !rangeTools || skipRowInInversion?.(cell.row)) return;
    const display = presentCell?.(cell.row, column.key), original = Object.getOwnPropertyDescriptor(cell.row, column.key);
    if (!display && (!original || !('value' in original) || original.value === undefined)) return;
    const value = display ? display.value : ownCell(cell.row, column.key);
    return { title: column.name, inspectValue: () => value,
      current: () => actionCurrent() && tableCopy?.isCurrent() !== false && rows[cell.index] === cell.row &&
        Object.is(displayedValue(cell.row, column.key, presentCell), value) };
  }

  function openCellActions(row: DataRow | undefined, rowIdx: number, key: string | undefined, target: EventTarget | null, point?: { x: number; y: number }): boolean {
    const located = locateCell(row, rowIdx, key, target);
    if (!located || key === undefined || skipRowInInversion?.(located.cell.row)) return false;
    const { cell } = located, column = cell.column!;
    const rectangle = cellRange.at(cell.row, rowIdx, key);
    const inspection = rectangle ? undefined : resultCellValueSource(cell);
    const current = () => actionCurrent() && tableCopy?.isCurrent() !== false && rows[cell.index] === cell.row && !skipRowInInversion?.(cell.row) &&
      (!rectangle || cellRange.rectangleCurrent(rectangle)) && gridDialogCurrent(located.element, ownDialog) && inspection?.current() !== false;
    const filter = cellMenuFilters?.(cell), actions = [...(filter?.actions ?? [])];
    const remove = recordActions?.remove;
    if (!rectangle && remove?.allowed(cell)) actions.push({ label: gridRecordText.remove, run: () => {
      if (current() && remove.allowed(cell)) remove.run(cell);
    } });
    if ((rowJump || hasResultTools || tableCopy) && tableCopy?.enabled !== false) {
      actions.unshift({ label: quickValueText.copyCell, disabled: !!presentCell?.(cell.row, key)?.copyError, run: () => {
        try { writeTableClipboardEvent(current, gridCopyData([cell.index], [key])); }
        catch (reason) { if (current()) useWorkspace.getState().notify(errorMessage(reason), true); }
      } });
      if (rectangle) actions.unshift(...gridRangeCopyActions(format => {
        try {
          if (format === 'names') return copyGridRangeNames(cellRange.captureColumns(rectangle), columns, current);
          if (format === 'csv' || format === 'json') {
            const labels = format === 'csv' ? csvCopyText : jsonCopyText;
            const content = cellRange.copyRectangle(rectangle, (row, key) => readTabularCopyValue(row, key, labels.invalid), skipRowInInversion);
            if (content?.values.length) copyGridRangeText(content.columns.map(key => columns.find(column => column.key === key)!.name),
              content.values, format, current, value => value);
            return;
          }
          const range = cellRange.capture(rectangle, null);
          if (!range) return;
          const indices = rangeCopyIndices(range);
          if (indices.length) writeTableClipboardEvent(current, gridCopyData(indices, range.keys,
            format === 'headers' ? range.keys.map(key => columns.find(column => column.key === key)!.name) : undefined));
        } catch (reason) { if (current()) useWorkspace.getState().notify(errorMessage(reason), true); }
      }));
      actions.push(...resultRowSqlActions(cell.index, current, rectangle));
      const selectRow = rangeTools ? cellRange.selectRowAction(cell.row, rowIdx, key) : undefined;
      const selectAll = rangeTools ? cellRange.selectAllAction(cell.row, rowIdx, key) : undefined;
      if (selectAll) actions.unshift(selectAll);
      if (selectRow) actions.unshift(selectRow);
    }
    if (!rectangle && cellReference?.allowed(cell)) actions.push({ label: cellReference.label, run: () => {
      if (current() && cellReference.allowed(cell)) cellReference.open(cell);
    } });
    if (!rectangle && onCellEdit && canOpenCellEditor?.(cell)) actions.push({ label: gridCellEditZh.open, run: () => {
      if (current() && canOpenCellEditor(cell)) onCellEdit(cell, located.element);
    } });
    if (rectangle && onFillRange) actions.push(...gridRangeFillActions(rectangle, kind => applyGridRangeFill(rectangle, kind)));
    if (rectangle && onFilterTableRange) actions.push(...tableRangeFilterActions(rectangle,
      () => cellRange.capture(rectangle, null), current, onFilterTableRange));
    if (rectangle && onExportRange) actions.push({ label: rangeExportText.action, run: () => {
      try {
        const range = cellRange.capture(rectangle, null);
        if (!range) throw Error(rangeExportText.stale);
        const result = snapshotGridRangeExport(range, columns, copyValue, skipRowInInversion,
          gridRangeSqliteStorage(sqliteSource, rows));
        if (current()) onExportRange(result);
      } catch (reason) { if (current()) useWorkspace.getState().notify(errorMessage(reason), true); }
    } });
    if (onFilterCell) try {
      const capture = captureQueryResultCellFilter(columns, rows, cell, sqliteSource, filterDialect);
      const apply = (operator: CellFilterOperator) => {
        if (current() && currentQueryResultCellFilter(capture, columns, rows)) onFilterCell(capture.cell, operator);
      };
      actions.push({ label: filterText.cellEquals, run: () => apply('eq') },
        { label: filterText.cellNotEquals, run: () => apply('ne') });
      if (capture.textMatch) actions.push(...cellTextOperators.map(operator => ({
        label: filterText.cellText[operator], run: () => apply(operator),
      })));
      if (capture.orderedMatch) actions.push(...cellBoundOperators.map(operator => ({
        label: filterText.cellBounds[operator], run: () => apply(operator),
      })));
    } catch { /* 未知或不可比较的原值不提供本地筛选项。 */ }
    if (rectangle && rectangle.left === rectangle.right && onFilterSelected) {
      const captureRange = () => {
        // 单列矩形绑定菜单打开时的选区，不读勾选、剪贴板或渲染文本。
        const indices = new Set(Array.from({ length: rectangle.bottom - rectangle.top + 1 }, (_, index) => rectangle.top + index));
        return captureQueryResultSelectedFilter(columns, rows, cell, indices, sqliteSource, filterDialect);
      };
      const stage = (mode: QueryResultSelectedFilterMode, captured?: QueryResultSelectedFilterCapture) => {
        if (!current()) return;
        try {
          const capture = captured ?? captureRange();
          if (current()) onFilterSelected(capture, current, mode);
        } catch (reason) { if (current()) useWorkspace.getState().notify(errorMessage(reason), true); }
      };
      actions.push({ label: selectedFilterText.range, run: () => stage(false) },
        { label: selectedFilterText.rangeExclude, run: () => stage(true) });
      if (rectangle.bottom - rectangle.top === 1) try {
        const capture = captureRange();
        if (queryResultSelectedBounds(capture)) actions.push(
          { label: selectedFilterText.rangeBetween, run: () => stage('between', capture) },
          { label: selectedFilterText.rangeNotBetween, run: () => stage('notBetween', capture) });
      } catch { /* 不可靠的双端原值只保留原菜单。 */ }
    }
    if (quickValueActions) for (const kind of gridQuickValueKinds) actions.push({
      label: quickValueText[kind], disabled: !quickValueActions.allowed(cell, kind),
      run: () => { if (current() && quickValueActions.allowed(cell, kind)) quickValueActions.apply(cell, kind); },
    });
    if (binaryFileActions && (hasResultTools || tableCopy) && tableCopy?.enabled !== false) {
      const value = displayedValue(cell.row, key, presentCell);
      actions.push({ label: gridCellFileZh.action, disabled: value == null,
        run: () => { void saveGridCell(() => copyValue(cell.row, key), current); } });
    }
    const display = presentCell?.(cell.row, key);
    const webValue = rectangle || display?.copyError ? undefined : display ? display.value : ownCell(cell.row, key);
    return cellActionMenu.open(target, gridRef.current?.element, { title: column.name, label: filter?.label, actions, current, webValue,
      inspectValue: inspection?.inspectValue,
      focusTarget: rectangle ? cellRange.focusTarget : undefined }, point);
  }

  /** 只消费焦点所在的原始数据格，文本编辑控件继续使用系统粘贴。 */
  function pasteGrid(event: ClipboardEvent<HTMLDivElement>) {
    const target = event.target;
    if (!onCellPaste || event.defaultPrevented || !(target instanceof HTMLElement) || target !== document.activeElement ||
      target.getAttribute('role') !== 'gridcell' || target.getAttribute('aria-selected') !== 'true' ||
      target.closest('[role="grid"]') !== gridRef.current?.element) return;
    // 该网格有一行表头，可选的勾选列位于全部数据列之前。
    const rowIdx = Number(target.closest('[role="row"]')?.getAttribute('aria-rowindex')) - 2;
    const column = columns[Number(target.getAttribute('aria-colindex')) - (onActiveRowChange ? 1 : 2)];
    const located = locateCell(rows[rowIdx], rowIdx, column?.key, target);
    if (!located || !column) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      const range = cellRange.pasteTarget(located.cell.row, column.key);
      if (range) onCellPaste(located.cell, event.clipboardData, range);
      else onCellPaste(located.cell, event.clipboardData);
    }
    catch (reason) { useWorkspace.getState().notify(errorMessage(reason), true); }
  }

  /** 整理快捷键仅属于当前只读网格；输入框、编辑模式和旧渲染不能借此撤销正文或另一结果。 */
  function cellKeyDown(args:CellKeyDownArgs<DataRow>,event:CellKeyboardEvent):void{
    const {row,column}=args,key=event.key.toLowerCase();
    if (args.mode === 'ACTIVE' && cellRange.key(args, event)) return;
    if (recordActions && args.mode === 'ACTIVE' && isFocusedDataCell(event.target) && handleGridRecordKey(event, kind => {
      const located = locateCell(row, args.rowIdx, column?.key, event.target);
      if (!located || !gridDialogCurrent(located.element, ownDialog)) return;
      if (kind === 'add') return recordActions.add;
      const remove = recordActions.remove;
      if (!cellRange.rectangle && remove?.allowed(located.cell)) return () => remove.run(located.cell);
    })) return;
    if (args.mode === 'ACTIVE' && onFillRange && cellRange.fillValueKey(args, event, applyGridRangeFill)) return;
    const fill = rangeFill.current;
    if (args.mode === 'ACTIVE' && fill && onFillRange && cellRange.fillTextKey(args, event, fill.beginText)) return;
    if (args.mode === 'ACTIVE' && handleGridSelectAllKey(event,
      () => canSelectRows && !!row && rows[args.rowIdx] === row && !!column && columns.some(item => item.key === column.key) && rowSelectionCurrent(),
      () => setSelectedRows(gridRowKeys(rows, rowSelectionKey)))) return;
    if (isGridContextKey(event) && args.mode === 'ACTIVE' && !event.defaultPrevented && !event.isGridDefaultPrevented() &&
      openCellActions(row, args.rowIdx, column?.key, event.target)) {
      event.preventGridDefault();
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if ((rangeTools || canOpenCellEditor && onCellEdit) && args.mode === 'ACTIVE' &&
      !event.defaultPrevented && !event.isGridDefaultPrevented() && tableCellEditorKey(event)) {
      event.preventGridDefault(); event.preventDefault(); event.stopPropagation();
      const located = !event.repeat && !cellRange.rectangle && locateCell(row, args.rowIdx, column?.key, event.target);
      if (located && event.target === located.element && gridDialogCurrent(located.element, ownDialog)) {
        if (canOpenCellEditor?.(located.cell) && onCellEdit) onCellEdit(located.cell, located.element);
        else {
          const source = resultCellValueSource(located.cell);
          if (source) cellActionMenu.inspect(located.element, gridRef.current?.element, source);
        }
      }
      return;
    }
    if (cellReference && args.mode === 'ACTIVE' && key === 'enter' && (event.ctrlKey || event.metaKey) &&
      !event.altKey && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229 &&
      !event.defaultPrevented && !event.isGridDefaultPrevented() && !cellRange.rectangle) {
      const located = locateCell(row, args.rowIdx, column?.key, event.target);
      if (located && event.target === located.element && gridDialogCurrent(located.element, ownDialog) && cellReference.allowed(located.cell)) {
        event.preventGridDefault(); event.preventDefault(); event.stopPropagation();
        if (!event.repeat) cellReference.open(located.cell);
        return;
      }
    }
    if (onActivateRow && args.mode === 'ACTIVE' && key === 'enter' && !event.ctrlKey && !event.metaKey &&
        !event.altKey && !event.shiftKey && !event.defaultPrevented && !event.isGridDefaultPrevented()) {
      const located = locateCell(row, args.rowIdx, column?.key, event.target);
      if (located && event.target === located.element && document.activeElement === located.element && candidateGridCurrent(located.element)) {
        event.preventGridDefault(); event.preventDefault(); event.stopPropagation();
        if (!event.repeat && !tableCellKeyIsComposing(event.nativeEvent)) onActivateRow(located.cell.row);
        return;
      }
    }
    if (onCellEdit && args.mode === 'ACTIVE' && !event.defaultPrevented && !event.isGridDefaultPrevented() &&
      !event.nativeEvent.isComposing && event.keyCode !== 229 && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const typed = Array.from(event.key).length === 1 && !(event.shiftKey && event.key === ' ');
      const located = (key === 'f2' || typed) && locateCell(row, args.rowIdx, column?.key, event.target);
      if (located && event.target === located.element && onCellEdit(located.cell, located.element, typed ? event.key : undefined)) {
        event.preventGridDefault();
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    }
    const historyKey=(event.ctrlKey||event.metaKey)&&!event.altKey&&(key==='z'||key==='y'&&event.ctrlKey&&!event.metaKey&&!event.shiftKey);
    if(historyKey&&onHistoryTravel&&selectionScope&&isCurrent&&!onActiveRowChange){
      const target=event.target as HTMLElement;
      if(event.defaultPrevented||event.nativeEvent.isComposing||event.keyCode===229||event.isGridDefaultPrevented()||args.mode!=='ACTIVE'||!target||target.nodeType!==1||target.isContentEditable||['INPUT','TEXTAREA','SELECT'].includes(target.tagName)||!column||!columns.some(item=>item.key===column.key)||!(row===undefined?args.rowIdx===-1:rows[args.rowIdx]===row)||!actionCurrent())return;
      event.preventGridDefault();event.preventDefault();event.stopPropagation();
      // 长按只消费当前命令，避免一次按键跨越多步；下一次明确按键重新核当前租约。
      if(!event.repeat)onHistoryTravel(key==='y'||event.shiftKey?1:-1);
      return;
    }
    if(row&&column&&event.key==='Enter'&&!event.nativeEvent.isComposing&&isResultBinaryCell(displayedValue(row,column.key,presentCell))){event.preventGridDefault();event.preventDefault();viewBinary(row,column.key);}
  }
  // 标题使用用户可见列名，值仍按唯一内部键定位；重复别名不能导致读取另一列。
  // 离线窗口只查看原字节，不借查询页归属开放文件能力；默认仍沿用原安全门。
  const binaryColumn = binary ? columns.find(column => column.key === binary.key) : undefined;
  // 查询结果受控，恢复默认后丢弃虚拟网格此前缓存的手动宽度。
  const controlledWidths = useMemo<ColumnWidths>(() => new Map(Array.from(columnWidths ?? [], ([key, width]) => [key, { type: 'resized', width }])), [columnWidths]);
  function resizeColumn(key: string, width: number): void {
    if (onColumnResize) onColumnResize(key, width);
    else onColumnWidthsChange?.(new Map(controlledWidths).set(key, { type: 'resized', width }));
  }
  /** 适宽与拖动共享布局接纳门，按内部列键区分同名结果列。 */
  function fitHeaderColumn(event: MouseEvent): void {
    const index = gridResizeHandleColumn(event, gridRef.current?.element);
    if (index === undefined || !actionCurrent() || document.querySelector(appModalSelector)) return;
    const column = columns[index - (onActiveRowChange ? 0 : 1)];
    if (!column) return;
    try {
      const type = headerDetails ? (headerDetails.showType ? headerDetails.fields?.get(column.key)?.type ?? column.type : undefined) : column.type;
      const width = fitGridColumnWidths({ columns: [{ ...column, type }], rowCount: rows.length, zoomPercent: zoomable ? zoom.percent : undefined,
        cell: (row, key) => presentCell?.(rows[row], key)?.label ?? cellPreview(displayedValue(rows[row], key, presentCell)),
      }, new Set([column.key])).get(column.key)!;
      resizeColumn(column.key, width);
    } catch { useWorkspace.getState().notify(gridColumnWidthBatchZh.fitUnavailable, true); }
  }
  const gridColumns = useMemo<Column<DataRow>[]>(() => [...(onActiveRowChange ? [] : [canSelectRows ? checkedRange.column : SelectColumn]), ...columns.map<Column<DataRow>>((column, index) => ({ key: column.key, name: column.name, draggable: !!onColumnReorder, frozen: index < frozenCount,
    headerCellClass: (activeHit?.row === -1 && activeHit.column === index || findTarget?.row === -1 && findTarget.key === column.key) ? 'query-result-find-hit'
      : activeHighlights?.scan.hasMatch(-1, index) ? 'query-result-find-match' : findMarks?.has('-1:' + column.key) ? 'pg-find-match' : undefined,
    cellClass: row => {
    const rowIndex = rowIndexes.get(row);
    const rangeClass = !skipRowInInversion?.(row) && gridCellRangeClass(cellRange.rectangle, rowIndex, index);
    if (activeHit?.row === rowIndex && activeHit?.column === index || findTarget?.row === rowIndex && findTarget?.key === column.key)
      return rangeClass ? `query-result-find-hit ${rangeClass}` : 'query-result-find-hit';
    if (rangeClass) return rangeClass;
    if (rowIndex !== undefined && activeHighlights?.scan.hasMatch(rowIndex, index)) return 'query-result-find-match';
    return findMarks?.has(rowIndex + ':' + column.key) ? 'pg-find-match' : undefined;
  }, resizable: true, minWidth: columnWidths || onColumnWidthsChange ? 64 : 110, maxWidth: onColumnWidthsChange ? 2000 : undefined, width: Number.isInteger(columnWidths?.get(column.key)) && columnWidths!.get(column.key)! >= 64 && columnWidths!.get(column.key)! <= 2000 ? columnWidths!.get(column.key)! : 170, sortable: !!onSortChange && !sortReasons?.get(column.key), renderHeaderCell: () => {
    const sortIndex = sort?.findIndex(rule => rule.column === column.key) ?? -1;
    const direction = sort?.[sortIndex]?.direction;
    const marker = direction && <span aria-label={direction === 'ASC' ? sortText.ascending : sortText.descending}
      title={sortText.priority(sortIndex + 1, column.name)}>{sortIndex + 1}{direction === 'ASC' ? ' ↑' : ' ↓'}</span>;
    const hint = sortReasons?.get(column.key) ?? (onSortChange ? sortText.keyboard : column.type);
    if (!headerDetails) return <span title={hint}>{column.name}<small className="column-type">{column.type}</small>{marker}</span>;
    const field = headerDetails.fields?.get(column.key);
    return <GridHeaderDetails name={column.name} hint={hint}
      type={headerDetails.showType ? field?.type ?? column.type : undefined}
      comment={headerDetails.showComment ? field?.comment : undefined}>{marker}</GridHeaderDetails>;
  }, renderCell: ({ row, tabIndex }) => {
    const presentation = presentCell?.(row, column.key);
    const value = presentation ? presentation.value : ownCell(row, column.key);
    const label = presentation?.label ?? cellPreview(value);
    return <DataTypeColor enabled={dataTypeColors} selected={tabIndex === 0 || selectedRows.has(rowIndexes.get(row)!)}
      value={value} type={column.type} source="protocol"
      className={['grid-row-preview', value === null && 'null-value', presentation?.className].filter(Boolean).join(' ')}
      title={presentation?.title ?? label}>{imagesShown && !skipRowInInversion?.(row) ? <GridCellImage value={value}>{label}</GridCellImage> : label}</DataTypeColor>;
  } })), ...(sqliteRowIds ? [sqliteRowIdColumn<DataRow>(row => sqliteRowIds[rowIndexes.get(row) ?? -1])] : [])],
    [columns, columnWidths, headerDetails, sqliteRowIds, onColumnWidthsChange, onColumnReorder, frozenCount, onActiveRowChange, canSelectRows, checkedRange.column, onSortChange, sort, sortReasons, activeHit, activeHighlights, findTarget, findMarks, cellRange.rectangle, skipRowInInversion, rowIndexes, presentCell, imagesShown, dataTypeColors, dataTypeColors ? selectedRows : null]);
  const fitHeader = onColumnResize || onColumnWidthsChange ? fitHeaderColumn : undefined;
  const { sizeDialog, reorderColumns, ...headerMenu } = useGridHeaderMenu(cellActionMenu.open, {
    owner: scope, grid: () => gridRef.current?.element,
    column: index => columns[index - (onActiveRowChange ? 0 : 1)],
    columnNameDialect: columnNameDialect ?? filterDialect,
    findColumn: onFindColumn ?? (hasResultTools ? key => resultFind.current?.openColumn(key) : undefined),
    filterColumn: onFilterColumn,
    valueOptions: columnValueOptions,
    columnStatistics: onColumnStatistics ?? (onStatistics && statisticsReadyScope === scope ? openStatistics : undefined),
    sort: sort?.map(({ column, direction }) => ({ columnKey: column, direction })) ?? [],
    current: actionCurrent, canSort: key => !!onSortChange && (key === undefined || !sortReasons?.get(key)), applySort: changeSortColumns,
    selectColumn: rangeTools ? index => cellRange.selectColumnAction(index - 1) : undefined,
    columnActions: (column, current) => [
      ...resultHeaderDataActions(current, column),
      ...resultRowSqlActions(undefined, () => current() && selectedActionCurrent(), undefined, selectedRows.size > 0),
    ],
    resizeColumn: fitHeader ? resizeColumn : undefined, ownDialog,
    zoom: zoomable ? zoom : undefined,
    resizeRows: onRowHeightChange ? { height, apply: onRowHeightChange } : undefined, rowHeaderColumns: onActiveRowChange ? 0 : 1,
    rowActions: rangeTools || insertSql || updateSql ? (index, current) => {
      const row = rows[index];
      if (!row || skipRowInInversion?.(row) || tableCopy?.enabled === false || tableCopy?.isCurrent() === false) return [];
      const allowed = () => current() && rows[index] === row && selectedActionCurrent();
      return [...resultHeaderDataActions(allowed, undefined, index), ...resultRowSqlActions(index, allowed, undefined, selectedRows.has(index))];
    } : undefined,
    visibility: headerDetails,
    columnVisibility, reorderColumns: onColumnReorder, freeze: freezeColumns, frozenCount,
  });
  const dataGrid = <DataGrid<DataRow, unknown, number> ref={gridRef} aria-keyshortcuts={onActivateRow ? 'Enter' : undefined} onColumnsReorder={onColumnReorder ? reorderColumns : undefined} aria-description={onHistoryTravel ? historyText.shortcuts : undefined} className={`results-grid rdg-${theme} grid-row-height-${height}${height >= 56 ? ' grid-row-multiline' : ''}${zoomable ? ' grid-zoomable' : ''}`} style={dimensions.style} columns={gridColumns} rows={rows} columnWidths={onColumnWidthsChange ? controlledWidths : undefined} onColumnWidthsChange={onColumnWidthsChange ? widths => { if (actionCurrent()) onColumnWidthsChange(widths); } : undefined} onColumnResize={onColumnResize ? (column, width) => { if (actionCurrent() && !document.querySelector('[role="dialog"], [role="alertdialog"]')) onColumnResize(column.key, width); } : undefined} onCellMouseDown={(args, event) => cellRange.mouse(args, event)} onCellClick={rowJump || tableCopy || selectionScope && isCurrent && !onActiveRowChange ? ({ row, rowIdx, column }, event) => {
    if (canSelectRows && columns.some(item => item.key === column.key)) checkedRange.toggle(row, rowIdx, event);
    captureCopyCell(row, rowIdx, column);
  } : undefined} onCellContextMenu={({ row, rowIdx, column }, event) => {
    if (event.defaultPrevented || !openCellActions(row, rowIdx, column.key, event.target, { x: event.clientX, y: event.clientY })) return;
    event.preventGridDefault();
    event.preventDefault();
    event.stopPropagation();
  } } onCellDoubleClick={({ row, rowIdx, column }, event) => {
    if ((onActivateRow || onCellEdit) && !event.defaultPrevented) {
      const located = locateCell(row, rowIdx, column.key, event.target);
      if (located && onActivateRow && candidateGridCurrent(located.element)) {
        event.preventGridDefault(); event.preventDefault(); onActivateRow(located.cell.row); return;
      }
      if (located && onCellEdit?.(located.cell, located.element)) {
        event.preventGridDefault(); event.preventDefault(); return;
      }
    }
    viewBinary(row, column.key);
  }} onCellKeyDown={cellKeyDown} rowHeight={dimensions.rowHeight} headerRowHeight={dimensions.headerHeight} rowKeyGetter={row => rowIndexes.get(row)!} selectedRows={selectedRows} isRowSelectionDisabled={skipRowInInversion} onSelectedRowsChange={setSelectedRows} onActivePositionChange={({ row, rowIdx, column }) => { if (!actionCurrent()) return; cellRange.move(row, rowIdx, column?.key); captureCopyCell(row, rowIdx, column); onGridAnchor?.(column && columns.some(item => item.key === column.key) ? { row: rowIdx, key: column.key } : undefined); onActiveRowChange?.(row ?? null); onActiveRowIndexChange?.(row && Number.isSafeInteger(rowIdx) && rowIdx >= 0 && rows[rowIdx] === row ? rowIdx : null); }} sortColumns={sort?.map(rule => ({ columnKey: rule.column, direction: rule.direction }))} onSortColumnsChange={changeSortColumns} onCellCopy={({ row, column }, event) => {
    event.preventDefault();
    if (!actionCurrent() || !rowIndexes.has(row)) return;
    if (sqliteRowIds && column.key === sqliteRowIdKey) {
      const value = sqliteRowIds[rowIndexes.get(row)!];
      if (value !== undefined) event.clipboardData.setData('text/plain', value);
      return;
    }
    if (!selectedRows.size && !columns.some(item => item.key === column.key)) return;
    try {
      const selected = rangeCurrent() ? cellRange.copyTarget(row, column.key) : undefined;
      if (selected) {
        const indices = rangeCopyIndices(selected);
        if (indices.length) gridCopyData(indices, selected.keys)(event.clipboardData);
        return;
      }
      const indices = selectedRows.size ? [...selectedRows].sort((a, b) => a - b) : [rowIndexes.get(row)!];
      if (indices.some(index => !Number.isSafeInteger(index) || index < 0 || index >= rows.length)) return;
      gridCopyData(indices, selectedRows.size ? columns.map(item => item.key) : [column.key])(event.clipboardData);
    }catch(reason){useWorkspace.getState().notify(errorMessage(reason),true);}
  }} renderers={{ noRowsFallback: <GridEmptyState
    onPaste={onEmptyPaste && (data => { if (actionCurrent()) onEmptyPaste(data); })}
    onAddRow={recordActions?.add && (() => { if (actionCurrent()) recordActions.add?.(); })}/> }}/>;
  const hasHeaderMenu = onSortChange || freezeColumns || columnVisibility || onColumnReorder || rangeTools || columnNameDialect || filterDialect || onFindColumn || columnValueOptions || onColumnStatistics || onStatistics || fitHeader || onRowHeightChange || insertSql || updateSql ||
    headerDetails?.onShowTypeChange || headerDetails?.onShowCommentChange;
  const grid = onCellPaste || fitHeader || hasHeaderMenu ? <div style={{ display: 'contents' }}
    {...(hasHeaderMenu ? headerMenu : undefined)} onPasteCapture={onCellPaste ? pasteGrid : undefined} onDoubleClickCapture={fitHeader}>{dataGrid}</div> : dataGrid;
  // 自定义行操作必须接收网格当前勾选集，避免在换页或二进制查看后使用已经清除的选择。
  const selectedActionCurrent = () => actionCurrent() && selectedRowsRef.current === selectionBefore &&
    (selectionBefore?.scope === rowScope ? selectionBefore.indices === selectedRows : !selectedRows.size);
  // 查找读取同一份已接纳勾选。选择提交时同步更新引用，旧凭据在 React 提交之前也会失效。
  const needsCheckedRows = hasResultTools || !!onCheckedRows;
  const checkedRows = useMemo((): ResultCheckedRows | undefined => {
    if (!needsCheckedRows || !selectionBefore || selectionBefore.scope !== rowScope || !selectionBefore.indices.size) return;
    return {
      indices: Object.freeze([...selectionBefore.indices].sort((a, b) => a - b)),
      isCurrent: () => alive.current && selectedRowsRef.current === selectionBefore && currentScope.current === scope && gridRevisionRef.current === gridRevision,
    };
  }, [needsCheckedRows, selectionBefore, rowScope, scope, gridRevision]);
  useLayoutEffect(() => { onCheckedRows?.(checkedRows); }, [onCheckedRows, checkedRows]);
  /** 原 SQL 生成器接收显示行下标。矩形或当前网格含有不可用行时拒绝整组复制。 */
  function resultRowSqlActions(index: number | undefined, current: () => boolean, rectangle?: GridCellRectangle, checked = false) {
    if (!rows.length || tableCopy?.enabled === false || tableCopy?.isCurrent() === false || !insertSql && !updateSql) return [];
    const menu = { current, indices: () => {
      if (checked) return selectedRows;
      if (index !== undefined && !rectangle) return new Set([index]);
      const range = rectangle ? cellRange.capture(rectangle, null) : { rows, startRow: 0 };
      if (!range) return;
      if (range.rows.some(row => skipRowInInversion?.(row))) throw Error(insertCopyText.selection);
      return new Set(range.rows.map((_, offset) => range.startRow + offset));
    } };
    return gridRowSqlActions(rectangle ? 'range' : checked ? 'selected' : index === undefined ? 'all' : 'current',
      insertSql ? () => handleRowOutput(rowSql.current.insertSql, checked, insertCopyText.copied, menu) : undefined,
      updateSql ? () => handleRowOutput(rowSql.current.updateSql, checked, updateSqlCopyZh.copied, menu) : undefined);
  }
  /** 复制与打开查询草稿共用活动格或勾选代次，生成失败时不产生副作用。 */
  function handleRowOutput(build: ((indices: ReadonlySet<number>) => string) | undefined, checked: boolean, destination: string | ((sql: string) => void),
    menu?: { indices(): ReadonlySet<number> | undefined; current(): boolean }) {
    const current = () => tableCopy?.enabled !== false && (menu ? menu.current() : selectedActionCurrent() && copyRevisionRef.current === copyRevision) &&
      tableCopy?.isCurrent() !== false && !document.querySelector(appModalSelector);
    if (!build || !current()) return;
    try {
      const indices = menu ? menu.indices() : checked ? selectedRows :
        activeCopyCell && rows[activeCopyCell.index] === activeCopyCell.row ? new Set([activeCopyCell.index]) : undefined;
      if (!indices) return;
      const sql = build(indices);
      if (typeof destination === 'function') {
        if (current()) destination(sql);
        return;
      }
      writeTableClipboardEvent(current, data => data.setData('text/plain', sql));
      useWorkspace.getState().notify(destination);
    } catch (reason) { useWorkspace.getState().notify(errorMessage(reason), true); }
  }
  /** 勾选顺序独立于显示顺序，列名与值从同一当前视图取出。 */
  function copyRowsAsText(indices: ReadonlySet<number>, format: 'json' | 'csv'): string {
    const labels = format === 'csv' ? csvCopyText : jsonCopyText;
    const encode = format === 'csv' ? encodeGridCsv : encodeGridJson;
    if (indices.size * columns.length > maxClipboardCells) throw Error(zh.clipboard.copyLimit);
    const selected = [...indices].sort((left, right) => left - right).map(index => {
      const row = rows[index];
      if (!Number.isSafeInteger(index) || !row || skipRowInInversion?.(row)) throw Error(labels.invalid);
      return row;
    });
    return encode(columns, selected, (row, key) => readTabularCopyValue(row, key, labels.invalid));
  }
  const jump = rowJump ? <>
    <GridRowJump grid={gridRef} scope={scope} count={rows.length} dialogShortcut={!!ownDialog}
      disabled={!columns.length} isCurrent={rowJumpIsCurrent} onJump={jumpToGridRow}/>
    <GridColumnJump scope={scope} columns={columns} disabled={!columnJumpAvailable}
      isCurrent={columnJumpIsCurrent} onJump={jumpToGridColumn}/>
  </> : undefined;
  const copyLabels = tableCopy ? tableCopyText : copyText;
  const copyEnabled = actionCurrent() && tableCopy?.enabled !== false;
  function applyQuickValue(kind: GridQuickValue): void {
    const cell = activeCopyCell;
    if (!cell || !actionCurrent() || copyRevisionRef.current !== copyRevision || rows[cell.index] !== cell.row ||
        document.querySelector(appModalSelector) || !quickValueActions?.allowed(cell, kind)) return;
    quickValueActions.apply(cell, kind);
  }
  const copyTools = <>
    {onFillRange && cellRange.rectangle && <GridRangeFill ref={rangeFill} rectangle={cellRange.rectangle} typed={!!sqliteSource?.sqliteStorage} onStage={stageGridRangeFill}/>}
    {quickValueActions && gridQuickValueKinds.map(kind =>
      <button key={kind} type="button" title={quickValueText[`${kind}Hint`]}
        disabled={!activeCopyCell || !quickValueActions.allowed(activeCopyCell, kind)} onClick={() => applyQuickValue(kind)}>{quickValueText[kind]}</button>)}
    <button type="button" title={gridCellFileZh.hint} disabled={!copyEnabled || !activeCopyCell?.column || !!skipRowInInversion?.(activeCopyCell.row)}
      onClick={saveActiveCell}>{gridCellFileZh.action}</button>
    <button type="button" title={copyLabels.hint} disabled={!copyEnabled || !selectedRows.size && !activeCopyCell}
      onClick={() => copyResult('headers')}>{copyLabels.action}</button>
    <button type="button" title={tableCopyText.namesHint} disabled={!copyEnabled || !columns.length}
      onClick={copyVisibleNames}>{tableCopyText.names}</button>
    <button type="button" title={copyLabels.columnHint} disabled={!copyEnabled || !activeCopyCell?.column}
      onClick={() => copyResult('column')}>{copyLabels.column}</button>
    <button type="button" title={jsonCopyText.hint} disabled={!copyEnabled || !selectedRows.size && !activeCopyCell}
      onClick={() => handleRowOutput(indices => copyRowsAsText(indices, 'json'), selectedRows.size > 0, jsonCopyText.copied)}>{jsonCopyText.action}</button>
    <button type="button" title={csvCopyText.hint} disabled={!copyEnabled || !selectedRows.size && !activeCopyCell}
      onClick={() => handleRowOutput(indices => copyRowsAsText(indices, 'csv'), selectedRows.size > 0, csvCopyText.copied)}>{csvCopyText.action}</button>
    {insertSql && <CopyInsertSqlButtons disabled={!copyEnabled}
      current={!!activeCopyCell} selected={!!selectedRows.size} onCopy={checked => handleRowOutput(insertSql, checked, insertCopyText.copied)}/>}
    {updateSql && <button type="button" title={updateSqlCopyZh.hint} disabled={!copyEnabled || !selectedRows.size && !activeCopyCell}
      onClick={() => handleRowOutput(updateSql, selectedRows.size > 0, updateSqlCopyZh.copied)}>{updateSqlCopyZh.action}</button>}
    {deleteSql && <button type="button" title={deleteSqlCopyZh.hint} disabled={!copyEnabled || !selectedRows.size && !activeCopyCell}
      onClick={() => handleRowOutput(deleteSql, selectedRows.size > 0, deleteSqlCopyZh.copied)}>{deleteSqlCopyZh.action}</button>}
    {primaryKeySql && <button type="button" title={keyCopyText.hint} disabled={!copyEnabled || !selectedRows.size && !activeCopyCell}
      onClick={() => handleRowOutput(primaryKeySql, selectedRows.size > 0, keyCopyText.copied)}>{keyCopyText.action}</button>}
    {onOpenRowSql && ([
      ['select', primaryKeySql, keyCopyText], ['insert', insertSql, insertCopyText], ['update', updateSql, updateSqlCopyZh], ['delete', deleteSql, deleteSqlCopyZh],
    ] as const).map(([kind, build, labels]) => build && <button key={kind} type="button" title={labels.openHint}
      disabled={!copyEnabled || !selectedRows.size && !activeCopyCell}
      onClick={() => handleRowOutput(build, selectedRows.size > 0, sql => onOpenRowSql(kind, sql))}>{labels.open}</button>)}
  </>;
  const selectionTools = canSelectRows ?
    <GridRowSelectionActions rows={rows} selected={selectedRows} disabled={tableCopy?.enabled === false}
      keyFor={rowSelectionKey}
      isCurrent={rowSelectionCurrent}
      onChange={setSelectedRows}/> : undefined;
  /** 只使用已接纳的当代勾选，旧事件不能隐藏或显示后来勾选的行。 */
  function showCheckedView(kind: 'checked' | 'excluded') {
    if (!checkedRows?.isCurrent() || !selectedActionCurrent()) return;
    onShowRows?.(new Set(checkedRows.indices), kind);
  }
  const checkedViewTools = onShowRows && <>
    <button type="button" disabled={!checkedRows} onClick={() => showCheckedView('checked')}>{rowViewText.showCheckedRows}</button>
    <button type="button" disabled={!checkedRows} onClick={() => showCheckedView('excluded')}>{rowViewText.hideCheckedRows}</button>
  </>;
  const gridTools = jump || tableCopy ? <>{jump}{tableCopy && copyTools}{selectionTools}</> : undefined;
  return <>{cellActionMenu.menu}{sizeDialog}{renderRowSelectionAction?.(selectedRows, selectedActionCurrent, hasResultTools ? undefined : gridTools)}
    {!hasResultTools && !renderRowSelectionAction && gridTools && <div className="query-result-copy-actions">{gridTools}</div>}{hasResultTools ? <div className="query-result-copy-region"><div className="query-result-copy-actions">{showGridImages === undefined && <button type="button" aria-pressed={imagesShown} onClick={() => setResultImages(value => !value)}>{binaryCellZh.gridImages}</button>}{copyTools}{selectionTools}{checkedViewTools}{onFilterCell&&<><button type="button" title={filterCellAllowed?filterText.cellHint:filterText.cellUnavailable} disabled={!filterCellAllowed} onClick={()=>filterFromCell('eq')}>{filterText.cellEquals}</button><button type="button" title={filterCellAllowed?filterText.cellHint:filterText.cellUnavailable} disabled={!filterCellAllowed} onClick={()=>filterFromCell('ne')}>{filterText.cellNotEquals}</button></>}{checkedFilterActions}{onStatistics&&<button type="button" disabled={statisticsReadyScope!==scope||!columns.length} onClick={() => openStatistics()}>{statisticsText.open}</button>}{jump}</div><QueryResultFind control={resultFind} owner={scope} rows={rows} columns={columns} checkedRows={checkedRows} grid={gridRef} isCurrent={actionCurrent} onHighlights={showFindHighlights} onMatchingRows={changeMatchingRows} onShowMatchingRows={onShowRows} onStageFindFilter={onStageFindFilter} findFilterSource={findFilterSource} filterDialect={filterDialect} onHit={hit => { if (currentScope.current === scope && alive.current) setFindHit(hit ? { scope, hit } : undefined); }}>{grid}</QueryResultFind></div> : grid}{binary && binaryColumn && binary.rows === rows && binary.columns === columns && binary.presentation === presentCell && <Modal title={`${binaryCellZh.title}：${binaryColumn.name}`} onClose={() => {if(alive.current&&currentScope.current===scope&&binaryRef.current===binary){gridRevisionRef.current++;setGridRevision(gridRevisionRef.current);setBinary(null);}}} wide><div className="modal-content"><BinaryCellViewer value={binary.value} reason={binaryCellZh.readonly} source={[binary]} isCurrent={binaryFileActions ? () => binaryCurrent(binary) : undefined}/></div></Modal>}</>;
}
