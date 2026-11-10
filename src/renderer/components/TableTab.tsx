import { recordTemporalSpec } from '../recordTemporal';
import { recordTemporalZh as temporalText } from '../locales/recordTemporal.zh-CN';
import { columnEnumerationZh as enumerationText } from '../locales/columnEnumeration.zh-CN';
import { binaryCellZh as gridImageText } from '../locales/binaryCell.zh-CN';
import { tableRefreshShortcut } from '../tableRefreshShortcut';
import { objectQueryKeyShortcuts, objectQueryShortcutLabel, openTableObjectQuery, tableObjectQueryShortcut } from '../objectQueryNavigation';
import { objectQueryZh } from '../locales/objectQuery.zh-CN';
import { navigationZh } from '../locales/navigation.zh-CN';
import { isGridContextKey, useGridCellActionMenu } from './GridCellActionMenu';
import { useGridHeaderMenu } from './GridHeaderMenu';
import { gridRowSqlActions } from '../gridRowSqlActions';
import { gridQuickValueAssignment, gridQuickValueKinds, mysqlQuickValueAllowed, type GridQuickValue } from '../gridQuickValue';
import { gridQuickValueZh as quickValueText } from '../locales/gridQuickValue.zh-CN';
import { TableEditWorkspace, type TableEditBatch, type TableEditPage, type TableEditNavigation, type TableCheckedFill, type TableCheckedRecordEdit } from '../tableEditWorkspace';
import { tableEditWorkspaceZh as workspaceText } from '../locales/tableEditWorkspace.zh-CN';
import { TableEditWorkspaceBar } from './TableEditWorkspaceBar';
import { TableApplyRecovery, type TableApplyRecoveryTicket, type TableApplyRecoveryRead } from '../tableApplyRecovery';
import { tableApplyRecoveryZh } from '../locales/tableApplyRecovery.zh-CN';
import { TableApplyRecoveryBanner } from './TableApplyRecoveryBanner';
import { RecordBatchEditIntent } from '../recordBatchEdit';
import { recordBatchEditZh } from '../locales/recordBatchEdit.zh-CN';
import { TableRecordBatchDialog } from './TableRecordBatchDialog';
import { GridRowSelectionActions, gridRowKeys, mergeGridMatchSelection, handleGridSelectAllKey } from './GridRowSelectionActions';
import { gridCellRangeClass, useGridCellRange, type GridCellRectangle, type GridRangeTarget } from '../useGridCellRange';
import { copyGridRangeNames, copyGridRangeText, gridHeaderDataCopyActions, gridRangeCopyActions } from '../gridRangeCopy';
import { snapshotGridRangeExport } from '../gridRangeExport';
import { gridRangeExportZh as rangeExportText } from '../locales/gridRangeExport.zh-CN';
import { GridRangeFill } from './GridRangeFill';
import { gridRangeFillActions, gridRangeFillSource, type GridRangeFillInput, type GridRangeFillKind } from '../gridRangeFill';
import { fitGridRangePaste } from '../gridRangePaste';
import { gridRangeFillZh as rangeFillText } from '../locales/gridRangeFill.zh-CN';
import { GridRowJump, openFocusedGridRowJump } from './GridRowJump';
import { focusGridColumn, GridColumnJump } from './GridColumnJump';
import { gridZoomDimensions, useGridZoom } from '../gridZoom';
import { readGridRowHeight } from '../../shared/gridRowHeight';
import { tableChecksZh } from '../locales/tableChecks.zh-CN';
import { tableCopyDataZh } from '../locales/tableCopyData.zh-CN';
import { tableCopyStructureZh } from '../locales/tableCopyStructure.zh-CN';
import { zh, formatText } from '../locales/zh-CN';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { DataGrid, SelectColumn, type Column, type RenderEditCellProps, type DataGridHandle, type CellKeyDownArgs, type CellKeyboardEvent, type SortColumn } from 'react-data-grid';
import { ArrowDownToLine, ArrowUpFromLine, ChevronLeft, ChevronRight, CopyPlus, Filter, Plus, RefreshCw, Save, SlidersHorizontal, Trash2, Undo2, Eye, KeyRound } from 'lucide-react';
import type { FilterRule, FilterGroup, SortRule, SqlPreview, TableInfo, TablePage, ResultExportData } from '../../shared/contracts';
import { cellPreview, cellText, errorMessage, invoke, ownCell, rowEqual, uid } from '../lib';
import { acquireWorkspaceBusy, useWorkspace, type WorkspaceBusyLease, type WorkspaceTab } from '../store';
import { SqlEditor } from './SqlEditor';
import { ErrorBox, Modal, Spinner } from './ui';
import { collectChanges, newDraftRow, type DraftRow } from '../dataChanges';
import { cellClipboardType, copyGridCells, copyGridCellValue, copyGridColumnNames, decodeClipboard, encodeClipboard, encodeGridCsv, encodeGridJson, maxClipboardCells, pasteCells, writeTableClipboardEvent } from '../gridClipboard';
import { gridJsonClipboardZh as jsonCopyText } from '../locales/gridJsonClipboard.zh-CN';
import { gridCsvClipboardZh as csvCopyText } from '../locales/gridCsvClipboard.zh-CN';
import { tableHeaderCopyZh as headerCopyText } from '../locales/tableHeaderCopy.zh-CN';
import { filterDraftFromRule, maxTablePage, parsePageJump, parseTablePageSize, setAllFilterRulesEnabled, type FilterMode, type FilterDraft } from '../tableFilters';
import { tableLastPageBounds } from '../../shared/tableLastPage';
import { openNetworkSchemaScript, schemaScriptLabel } from '../schemaScriptNavigation';
import { tableCellBoundActions, tableCellFilterDraft, tableCellTextActions, tableRangeFilterDraft, type TableCellFilterMode } from '../tableCellFilter';
import { tableCellFilterZh as cellFilterText } from '../locales/tableCellFilter.zh-CN';
import { buildTableSelectedFilter, type TableSelectedFilterProposal } from '../tableSelectedFilter';
import { tableSelectedFilterZh as selectedFilterText } from '../locales/tableSelectedFilter.zh-CN';
import { TableSelectedFilterPanel } from './TableSelectedFilterPanel';
import { captureTableRangeBounds, tableCheckedBoundsOptions, tableRangeFilterActions, type TableRangeFilter } from '../tableRangeFilter';
import { TableFilterPanel } from './TableFilterPanel';
import { TableFilterGroupsDialog } from './TableFilterGroupsDialog';
import { tableFilterGroupAfterChange, tableFilterGroupWithMode, tableFilterGroupSummary } from '../tableFilterGroups';
import { tableFilterGroupsZh as groupText } from '../locales/tableFilterGroups.zh-CN';
import { validateFilterGroup } from '../../shared/filtering';
import { snapshotTablePageExport } from '../tablePageExport';
import { useTableCheckedExport } from '../tableCheckedExport';
import { TableCheckedExportActions } from './TableCheckedExportActions';
import { tablePageExportZh as pageExportText } from '../locales/tablePageExport.zh-CN';
import { ResultExportDialog } from './ResultExportDialog';
import { ResultInsertDialog, type FixedResultInsertTarget } from './ResultInsertDialog';
import { ResultInsertSourceIntent } from '../resultInsertUi';
import { createTableRowTransfer } from '../tableRowTransfer';
import { tableRowTransferZh as rowTransferText } from '../locales/tableRowTransfer.zh-CN';
import { resultInsertZh as resultInsertText } from '../locales/resultInsert.zh-CN';
import { networkQueryTransferData, networkQueryTransferSource } from '../networkQueryTransfer';
import type { PostgresRecordTransfer } from '../postgresRecordTransfer';
import { TableFilteredExportDialog } from './TableFilteredExportDialog';
import { TableFilteredExportIntent } from '../tableFilteredExportUi';
import { tableFilteredExportZh } from '../locales/tableFilteredExport.zh-CN';
import { TableFilteredDeleteDialog } from './TableFilteredDeleteDialog';
import { TableFilteredDeleteIntent, tableFilteredDeleteAvailable } from '../tableFilteredDeleteUi';
import { tableFilteredDeleteZh as filteredDeleteText } from '../locales/tableFilteredDelete.zh-CN';
import type { TableFilteredDeleteApplyOutput } from '../../shared/tableFilteredDelete';
import { TableFilteredUpdateDialog } from './TableFilteredUpdateDialog';
import { TableFilteredUpdateIntent, tableFilteredUpdateColumns } from '../tableFilteredUpdateUi';
import { tableFilteredUpdateZh as filteredUpdateText } from '../locales/tableFilteredUpdate.zh-CN';
import type { TableFilteredUpdateApplyOutput } from '../../shared/tableFilteredUpdate';
import { TableQueryTemplateDialog } from './TableQueryTemplateDialog';
import { buildTableQueryTemplate, tableQueryTemplateMetadataKey, type TableQueryTemplateKind, type TableQueryTemplateOptions } from '../tableQueryTemplate';
import { tableQueryTemplateZh as templateText } from '../locales/tableQueryTemplate.zh-CN';
import { TableForeignKeyJoinDialog } from './TableForeignKeyJoinDialog';
import { IncomingForeignKeyJoinDialog } from './IncomingForeignKeyJoinDialog';
import { TableForeignKeyJoinIntent, fixedForeignKeyJoinStart, type ForeignKeyJoinPreview, type FixedForeignKeyJoinStart } from '../tableForeignKeyJoinIntent';
import type { IncomingReferenceRelation } from '../../shared/incomingReferences';
import { foreignKeyJoinChoices, foreignKeyJoinMetadataKey } from '../tableForeignKeyJoin';
import { tableForeignKeyJoinZh } from '../locales/tableForeignKeyJoin.zh-CN';
import { TableFilteredSelectIntent } from '../tableFilteredSelectUi';
import { tableFilteredSelectZh as filteredSelectText } from '../locales/tableFilteredSelect.zh-CN';
import { TableSortPanel } from './TableSortPanel';
import { tableSortZh as sortText } from '../locales/tableSort.zh-CN';
import { validateTableSort, tableSortFromGrid } from '../tableSort';
import { queryDatabasePatch } from '../../shared/queryContext';
import { openRowSqlDraft, type RowSqlKind } from '../openRowSqlDraft';
import { TablePresetPanel } from './TablePresetPanel';
import { TableReadHistory, useTableReadHistory } from './TableReadHistory';
import { tableReadHistoryZh } from '../locales/tableReadHistory.zh-CN';
import { createPresetDialogGuard } from '../tablePresetDialogs';
import { validateTablePresetColumns, type TablePresetConfiguration } from '../../shared/tablePresets';
import { ForeignKeyDialog } from './ForeignKeyDialog';
import { ChildReferenceDialog } from './ChildReferenceDialog';
import { ChildReferenceIntent } from '../childReferenceIntent';
import { childReferencesZh } from '../locales/childReferences.zh-CN';
import { TableStatisticsDialog } from './TableStatisticsDialog';
import { RelationshipDiagramDialog } from './RelationshipDiagramDialog';
import type { RelationshipJoinDraft } from '../relationshipDiagramReader';
import { relationshipDiagramZh } from '../locales/relationshipDiagram.zh-CN';
import { TableStatisticsIntent } from '../tableStatisticsIntent';
import { tableStatisticsZh } from '../locales/tableStatistics.zh-CN';
import { TableValueOptionsDialog } from './TableValueOptionsDialog';
import { tableValueOptionsServices } from '../tableValueOptionsServices';
import { tableValueOptionsZh } from '../locales/tableValueOptions.zh-CN';
import { tableValueOptionsColumnCapability } from '../../shared/tableValueOptions';
import type { TableValueOptionsConditions } from '../tableValueOptionsUi';
import { patchReferenceRow, referenceWritable, referencesForColumn, type ReferenceSnapshot } from '../referenceChanges';
import { referenceZh } from '../locales/references.zh-CN';
import type { CellValue, ForeignKeyInfo } from '../../shared/contracts';
import type { TablePreferences } from '../../shared/tablePreferences';
import { changeTablePreference, moveTableColumn, reconcileTablePreferences, visibleTableKeys, frozenTableKeys, setTableHeaderColumnVisibility, setTableFrozenThrough, setTableRowHeight } from '../tableColumnPreferences';
import { applyPageReplacement, type PageOccurrence, type PageReplacement } from '../pageFindReplace';
import { GridCellImage } from './GridCellImage';
import { tableFieldFindClass, type TableFieldFindDisplay } from './TableFieldFind';
import { PageFindPanel, type PageFindDisplay } from './PageFindPanel';
import { TablePreferencesDialog } from './TablePreferencesDialog';
import { fitGridColumnWidths, gridResizeHandleColumn, type GridColumnFitSource } from '../gridColumnFit';
import { gridColumnWidthBatchZh } from '../locales/gridColumnWidthBatch.zh-CN';
import { tableGridZh } from '../locales/tableGrid.zh-CN';
import { isBinaryCell } from '../binaryCell';
import { blocksBinaryTextInput, tableCellKeyIsComposing } from '../tableCellKeyboard';
import '../tableGrid.css';
import { DataTypeColor } from './DataTypeColor';
import { catalogColorType } from '../dataTypeColors';
import { indexPatchZh } from '../locales/indexPatches.zh-CN';
import { foreignKeyPatchZh } from '../locales/foreignKeyPatches.zh-CN';
import { columnPatchZh } from '../locales/columnPatches.zh-CN';
import { tableRenameZh } from '../locales/tableRename.zh-CN';
import { tableDropZh } from '../locales/tableDrop.zh-CN';
import { tableTruncateZh } from '../locales/tableTruncate.zh-CN';
import { tableCommentZh } from '../locales/tableComment.zh-CN';
import { tableDefaultEncodingZh } from '../locales/tableDefaultEncoding.zh-CN';
import { columnPageRefreshAction } from '../columnPatchServices';
import { useRecordViews, type RecordViewController } from '../hooks/useRecordViews';
import { TableApplyReceiptsDialog } from './TableApplyReceiptsDialog';
import { tableApplyReceiptZh } from '../locales/tableApplyReceiptZh';
import { acceptGridDrafts, captureRecordPagePreview, consumeRecordPagePreview, recordReadonlyReason, recordTargetKey, type RecordContext, type RecordPagePreview } from '../recordViews';
import { RecordEditorDialogs, RecordFormPanel } from './RecordFormPanel';
import { recordViewZh } from '../locales/recordViews.zh-CN';
import { tableAutoIncrementZh } from '../locales/tableAutoIncrement.zh-CN';
import { RecordPageNavigation, recordPageScope, type RecordPageContext } from '../recordPageNavigation';
import { assertCopiedRecordKeys, duplicateRecordDraft, recordDuplicateReadonlyReason } from '../recordDuplicate';
import { duplicateSelectedRecordDrafts } from '../recordDuplicateBatch';
import { RecordTemplatesDialog } from './RecordTemplatesDialog';
import { mysqlTemplateCandidate, mysqlTemplateColumns, mysqlTemplateRows, RecordTemplateLease, type RecordTemplateCandidate, type RecordTemplateColumn } from '../recordTemplates';
import { recordTemplatesZh } from '../locales/recordTemplates.zh-CN';
import type { RecordTemplateContent } from '../../shared/recordTemplates';
import { recordDuplicateZh } from '../locales/recordDuplicate.zh-CN';
import { beginRecordCopyRead, consumeRecordCopyRead, recordCopySourceReady, recordCopyMetadataReason, type RecordCopyReadIntent, type RecordCopyPage } from '../recordCopySource';
import { recordCopySourceZh } from '../locales/recordCopySource.zh-CN';
import { tableCopyMetadataKey, type TableCopyPageSources } from '../../shared/tableCopySource';
import { PasteInsertIntent, preparePasteInsert, type PasteInsertPlan } from '../pasteInsert';
import { PasteInsertDialog } from './PasteInsertDialog';
import { pasteInsertZh } from '../locales/pasteInsert.zh-CN';
import { BatchFillIntent, prepareBatchFill, prepareBatchFillAcross, prepareBatchFillFromRow, prepareBatchFillSequence, type BatchFillAssignment } from '../recordBatchFill';
import type { RecordInput } from '../recordViews';
import { TableBatchFillDialog } from './TableBatchFillDialog';
import { recordBatchFillZh } from '../locales/recordBatchFill.zh-CN';
import { draftHistoryKey } from '../draftHistory';
import { captureTableDraft, restoreTableDraftRows } from '../tableDraft';
import type { TableDraftDocument, TableDraftPayload } from '../../shared/tableDraft';
import { TableDraftDialog } from './TableDraftDialog';
import { tableDraftFilesZh as savedDraftText } from '../locales/tableDraftFiles.zh-CN';
import { draftHistoryZh } from '../locales/draftHistory.zh-CN';
import { AdaptiveToolbar } from './AdaptiveToolbar';
import { ActionMenuSection } from './ActionMenu';
import { useUiCommandScope } from '../uiCommands';
import { tableToolbarZh } from '../locales/tableToolbar.zh-CN';
import { primaryKeyCopyZh } from '../locales/primaryKeyCopy.zh-CN';
import { prepareCopyDeleteSql, prepareCopyInsertSql, prepareCopyPrimaryKeyQuery, prepareCopyUpdateSql } from '../copyInsertSql';
import { saveGridCell } from '../gridCellFile';
import { gridCellFileZh } from '../locales/gridCellFile.zh-CN';
import { GridHeaderDetails } from './GridHeaderDetails';
import { gridHeaderDetailsZh as headerText } from '../locales/gridHeaderDetails.zh-CN';
import { updateSqlCopyZh } from '../locales/updateSqlCopy.zh-CN';
import { deleteSqlCopyZh } from '../locales/deleteSqlCopy.zh-CN';
import { copyInsertSqlZh } from '../../shared/copyInsertSql.zh-CN';
import { buildCopyInsertSql } from '../../shared/copyInsertSql';

/** 输入始终保留字符串精度，失焦仅提交到本地草稿，不执行数据库写入。 */
function TextCellEditor({ row, column, onRowChange, onClose, binary, onEditingChange }: RenderEditCellProps<DraftRow> & { binary: boolean; onEditingChange: (editor: object, editing: boolean) => void }) {
  const editor = useRef({}).current;
  // 网格Enter/Escape/Tab可直接卸载输入框而不派发blur；挂载时在绘制前占门。
  useLayoutEffect(() => { onEditingChange(editor, true); }, [editor, onEditingChange]);
  // 被动清理晚于父页卸载标记；旧会话的清理不能释放随后挂载的新编辑器。
  useEffect(() => () => { onEditingChange(editor, false); }, [editor, onEditingChange]);
  const value = ownCell(row.data, column.key);
  // 即使将来有额外的编辑入口，字节也只能以有界只读预览呈现，不能被转换为文本草稿。
  return <input className="grid-input" readOnly={binary} autoFocus onFocus={event => event.currentTarget.select()} defaultValue={binary ? cellPreview(value) : value === null ? '' : cellText(value)} onChange={event => { if (!binary) onRowChange({ ...row, data: { ...row.data, [column.key]: event.target.value } }); }} onBlur={() => onClose(!binary, false)} aria-label={formatText(zh.table.text001, column.key)}/>;
}

/** 分页、排序和筛选全部交给数据库，界面仅持有当前页及该页的待提交修改。 */
type TableQueryTemplateLease = { info: TableInfo; metadata: string; tab: WorkspaceTab; version: number; refresh: number; generation: number; limit: number; invalid: boolean };
type TableFilteredSelectPage = { info: TableInfo; page: TablePage; scope: string; generation: number; index: number };
type TableLastPageRead = { taskId: string; sent: boolean; finished: boolean; stopped: boolean; stop?: Promise<unknown> };
const tablePageSizePresets = [50, 100, 200, 500, 1000];
type TableSortLease = { scope: object; columns: string[]; sort: SortRule[]; invalid: boolean };
type TableDraftLease = { mode: 'save' | 'restore'; payload?: TableDraftPayload; info: TableInfo; page: TablePage; rows: DraftRow[]; generation: number; invalid: boolean; values: unknown[] };
type TableFilterGroupLease = { scope: object; filters: FilterRule[]; mode: FilterMode; initial?: FilterGroup; invalid: boolean; dialogs: ReturnType<typeof createPresetDialogGuard> };
type TableSelectedFilterLease = { proposal: TableSelectedFilterProposal; fingerprint: string; metadata: string; scope: object; rows: DraftRow[]; selected: ReadonlySet<string>; selection: { rowId: string; key: string }; rangeCurrent?: () => boolean; generation: number; layout: number; epoch: number; profile: unknown; tab: string; invalid: boolean; dialogs: ReturnType<typeof createPresetDialogGuard> };

export function TableTab({ tab, onViewApplied, onOpenGeneratedQuery, onQueryTemplateNavigation, onDesign, onTransfer, onColumnPatches, onIndexPatches, onForeignKeyPatches, onTableCopyData, onTableCopyStructure, onTableRename, onTableAutoIncrement, onTableChecks, onTableComment, onTableDrop, onTableTruncate, onTableDefaultEncoding, incomingQuery, readIncomingQuery, consumeIncomingQuery, refreshVersion = 0, refreshAutomatically = true }: { incomingQuery?: PostgresRecordTransfer; readIncomingQuery?(): PostgresRecordTransfer | undefined; consumeIncomingQuery?(snapshot: PostgresRecordTransfer): void; tab: WorkspaceTab; onViewApplied?(): void; onOpenGeneratedQuery?(candidate: Omit<WorkspaceTab, 'id'>): void; onQueryTemplateNavigation?(): void; onDesign: (isView: boolean) => void; onTransfer: (mode: 'import' | 'export') => void; onColumnPatches(): void; onIndexPatches(): void; onForeignKeyPatches(): void; onTableCopyData?(): void; onTableCopyStructure?(): void; onTableRename(): void; onTableAutoIncrement(): void; onTableChecks?(): void; onTableComment(): void; onTableDrop?(): void; onTableTruncate?(): void; onTableDefaultEncoding(): void; refreshVersion?: number; refreshAutomatically?: boolean }) {
  const settings = useWorkspace(state => state.settings); const connection = useWorkspace(state => state.connections.find(profile => profile.id === tab.connectionId));
  const connectionVersion = useWorkspace(state => state.connectionVersions[tab.connectionId] ?? 0);
  const readHistory = useTableReadHistory(JSON.stringify([tab.connectionId, connectionVersion, tab.database, tab.table]));
  const presetUiEpoch=useRef(0);
  const [info, setInfo] = useState<TableInfo | null>(null); const [page, setPage] = useState<TablePage | null>(null);
  const [pageRequest, setPageRequest] = useState<number | { from: number }>(1);
  const pageIndex = typeof pageRequest === 'number' ? pageRequest : page?.page ?? pageRequest.from;
  const lastPageRead = useRef<TableLastPageRead | undefined>(undefined), [lastPageStopping, setLastPageStopping] = useState(false);
  const [draftDialog, setDraftDialog] = useState<TableDraftLease | null>(null), draftLease = useRef<TableDraftLease | null>(null);
  const [restoredDraftView, setRestoredDraftView] = useState(false);
  const [pageJump, setPageJump] = useState('1');
  const [pageSize, setPageSize] = useState(settings.pageSize);
  const [pageSizeDraft, setPageSizeDraft] = useState<string | null>(null);
  const pageSizeSelect = useRef<HTMLSelectElement>(null);
  const [rows, setRowsState] = useState<DraftRow[]>([]); const [sort, setSort] = useState<SortRule[]>([]); const [showFilter, setShowFilter] = useState(false);
  const [{ filters, paused }, setFilterSelection] = useState<{ filters: FilterRule[]; paused?: { original: FilterRule[]; tab: WorkspaceTab; profile: typeof connection; version: number } }>({ filters: [] });
  const resumableFilters = paused?.tab === tab && paused.profile === connection && paused.version === connectionVersion ? paused.original : undefined;
  /** 手动替换条件列表结束暂停，旧启停快照不能覆盖新条件。 */
  function setFilters(next: FilterRule[]): void { setFilterSelection({ filters: next }); }
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [filterGroup, setFilterGroup] = useState<FilterGroup>();
  const [filterGroups, setFilterGroups] = useState<TableFilterGroupLease | null>(null), filterGroupsRef = useRef(filterGroups);
  const [selectedFilter, setSelectedFilter] = useState<TableSelectedFilterLease | null>(null), selectedFilterRef = useRef(selectedFilter);
  const [cellFilterSeed, setCellFilterSeed] = useState<FilterDraft>();
  const [pageExport, setPageExport] = useState<{ data: ResultExportData; selected: boolean; scope?: 'collected' | 'rectangle' } | null>(null), pageExportRef = useRef(pageExport);
  const [rowTransferDialog, setRowTransferDialog] = useState<ResultInsertSourceIntent | null>(null), rowTransferIntent = useRef<ResultInsertSourceIntent | null>(null);
  const incomingTransfer = useRef<{ snapshot: PostgresRecordTransfer; fixed: FixedResultInsertTarget; committed: boolean } | null>(null);
  const rowTransferSource = useRef<object | null>(null), rowTransferEnvironment = useRef<unknown[]>([]);
  const rowTransferBusy = useRef<{ lease?: WorkspaceBusyLease; acquiring: boolean; releasing: boolean } | null>(null);
  const [filteredExportDialog, setFilteredExportDialog] = useState<TableFilteredExportIntent | null>(null), filteredExportIntent = useRef<TableFilteredExportIntent | null>(null);
  const [filteredUpdateDialog, setFilteredUpdateDialog] = useState<TableFilteredUpdateIntent | null>(null), filteredUpdateIntent = useRef<TableFilteredUpdateIntent | null>(null);
  const [filteredDeleteDialog, setFilteredDeleteDialog] = useState<TableFilteredDeleteIntent | null>(null), filteredDeleteIntent = useRef<TableFilteredDeleteIntent | null>(null);
  const [queryTemplate, setQueryTemplate] = useState<TableQueryTemplateLease | null>(null), queryTemplateRef = useRef(queryTemplate);
  const [foreignKeyJoinDialog, setForeignKeyJoinDialog] = useState<
    { intent: TableForeignKeyJoinIntent; mode: 'directory'; proceed(child: TableInfo, relation: IncomingReferenceRelation): void } |
    { intent: TableForeignKeyJoinIntent; mode: 'build'; fixed?: FixedForeignKeyJoinStart; manual?: boolean } | null>(null);
  const foreignKeyJoinIntent = useRef<TableForeignKeyJoinIntent | null>(null);
  const foreignKeyJoinBusy = useRef<{ lease?: WorkspaceBusyLease; acquiring: boolean; releasing: boolean } | null>(null);
  const [filteredSelectDialog, setFilteredSelectDialog] = useState<TableFilteredSelectIntent | null>(null), filteredSelectIntent = useRef<TableFilteredSelectIntent | null>(null), filteredSelectPage = useRef<TableFilteredSelectPage | null>(null);
  /** 所有已应用条件/排序均同时回到第一页；在排队渲染前撤销旧loaded来源，堵住同事件旧按钮。 */
  function setPageIndex(next: number): void {
    rowTransferIntent.current?.invalidate(); filteredSelectIntent.current?.invalidate(); filteredSelectPage.current = null;
    setPageRequest(next);
  }
  const [sortPanel, setSortPanel] = useState<TableSortLease | null>(null), sortPanelRef = useRef(sortPanel);
  const tableReadAction = useRef<object | null>(null), tableReadRender = {};
  /** 只发布已提交渲染的快捷动作；卸载、隐藏恢复或后继渲染不能复活旧按钮回调。 */
  useLayoutEffect(() => { tableReadAction.current = tableReadRender; return () => { if (tableReadAction.current === tableReadRender) tableReadAction.current = null; }; });
  const [checkedSelection, setCheckedSelection] = useState<{ ids: ReadonlySet<string> }>(() => ({ ids: new Set() }));
  const selectedRows = checkedSelection.ids;
  const selectedRowsRef = useRef(selectedRows), checkedSelectionRef = useRef(checkedSelection);
  const checkedFindRows = useMemo(() => ({ ids: selectedRows, isCurrent: () => checkedSelectionRef.current === checkedSelection }), [checkedSelection]);
  /** 勾选状态同步发布，旧回调也只能读取当前选择。 */
  function setSelectedRows(value: ReadonlySet<string>) { rowTransferIntent.current?.invalidate(); batchFillIntent.current?.invalidate(); recordBatchIntent.current?.invalidate(); if (selectedFilterRef.current) selectedFilterRef.current.invalid = true; selectedRowsRef.current = value; const next = { ids: value }; checkedSelectionRef.current = next; setCheckedSelection(next); }
  const copiedDraftIds = useRef(new Set<string>()); const [duplicateNotice, setDuplicateNotice] = useState('');
  const [copyPending, setCopyPending] = useState(false); const copyPendingRef = useRef(false);
  const insertCopyBlockedRef = useRef(false);
  const copyReadIntent = useRef<RecordCopyReadIntent | null>(null); const copyPageTask = useRef<string | undefined>(undefined);
  const copySources = useRef<{ connectionId: string; source: TableCopyPageSources } | null>(null); const copyRowRefs = useRef(new Map<string, string>());
  const copyPage = useRef<RecordCopyPage | null>(null);
  const pendingPaste = useRef<DraftRow[] | null>(null);
  const pasteInsertIntent = useRef<PasteInsertIntent | null>(null); const [pasteInsertDialog, setPasteInsertDialog] = useState<PasteInsertIntent | null>(null);
  const pasteInsertEnvironment = useRef<unknown[]>([]);
  type TemplateDialog = { lease: RecordTemplateLease; insert: PasteInsertIntent; candidate?: RecordTemplateCandidate; columns: RecordTemplateColumn[] };
  const templateRef = useRef<TemplateDialog | undefined>(undefined), [templateDialog, setTemplateDialog] = useState<TemplateDialog>();
  useEffect(() => { const stop = useWorkspace.subscribe(() => { templateRef.current?.lease.current(); }); return () => { stop(); templateRef.current?.lease.invalidate(); }; }, []);
  const batchFillIntent = useRef<BatchFillIntent | TableCheckedFill | null>(null), [batchFillDialog, setBatchFillDialog] = useState<BatchFillIntent | TableCheckedFill | null>(null);
  type RecordBatchOwner = RecordBatchEditIntent | TableCheckedRecordEdit;
  const recordBatchIntent = useRef<RecordBatchOwner | null>(null), [recordBatchDialog, setRecordBatchDialog] = useState<RecordBatchOwner | null>(null);
  const recordBatchAttachment = useRef<{ intent: RecordBatchOwner; attached: boolean } | null>(null);
  const batchFillEnvironment = useRef<unknown[]>([]);
  useEffect(() => () => { batchFillIntent.current?.invalidate(); recordBatchIntent.current?.invalidate(); }, []);
  // 工作区先变化再恢复也同步撤销票据，不等待React合并渲染才发现切页或作业变化。
  useEffect(() => {
    const identity = (state: ReturnType<typeof useWorkspace.getState>) => JSON.stringify([state.settings.activeTabId, state.settings.tabs.find(item => item.id === tab.id), state.connectionVersions[tab.connectionId] ?? 0, state.connections.find(item => item.id === tab.connectionId), !!state.activeJobs[tab.id]]);
    // 导出自己的chooser/任务会占用标签；该忙碌位不撤销自身，原标签与连接变化仍同步作废。
    const exportIdentity = (state: ReturnType<typeof useWorkspace.getState>) => JSON.stringify([state.settings.activeTabId, state.settings.tabs.find(item => item.id === tab.id), state.connectionVersions[tab.connectionId] ?? 0, state.connections.find(item => item.id === tab.connectionId)]);
    return useWorkspace.subscribe((state, previous) => {
      if (state.settings.activeTabId !== previous.settings.activeTabId || state.settings.tabs.find(item => item.id === tab.id) !== previous.settings.tabs.find(item => item.id === tab.id) || state.connections.find(item => item.id === tab.connectionId) !== previous.connections.find(item => item.id === tab.connectionId) || state.connectionVersions[tab.connectionId] !== previous.connectionVersions[tab.connectionId]) rowTransferIntent.current?.invalidate();
      if (state.activeJobs !== previous.activeJobs && (state.activeJobs[tab.id] || previous.activeJobs[tab.id])) {
        const own = rowTransferBusy.current;
        const ownTransition = own?.acquiring && !previous.activeJobs[tab.id] && state.activeJobs[tab.id] || own?.releasing && previous.activeJobs[tab.id] && !state.activeJobs[tab.id];
        if (!ownTransition && !own?.lease?.owns()) rowTransferIntent.current?.invalidate();
      }
      if (state.settings.activeTabId !== previous.settings.activeTabId || state.settings.tabs.find(item => item.id === tab.id) !== previous.settings.tabs.find(item => item.id === tab.id) || state.connections.find(item => item.id === tab.connectionId) !== previous.connections.find(item => item.id === tab.connectionId) || state.connectionVersions[tab.connectionId] !== previous.connectionVersions[tab.connectionId] || state.settings.resultLimit !== previous.settings.resultLimit) foreignKeyJoinIntent.current?.invalidate();
      if (state.activeJobs !== previous.activeJobs && (state.activeJobs[tab.id] || previous.activeJobs[tab.id])) {
        const own = foreignKeyJoinBusy.current;
        const ownTransition = own?.acquiring && !previous.activeJobs[tab.id] && state.activeJobs[tab.id] || own?.releasing && previous.activeJobs[tab.id] && !state.activeJobs[tab.id];
        if (!ownTransition && !own?.lease?.owns()) foreignKeyJoinIntent.current?.invalidate();
      }
      if (exportIdentity(state) !== exportIdentity(previous)) filteredExportIntent.current?.invalidate();
      if (exportIdentity(state) !== exportIdentity(previous) || state.settings.tabs.find(item=>item.id===tab.id)!==previous.settings.tabs.find(item=>item.id===tab.id) || state.connections.find(item=>item.id===tab.connectionId)!==previous.connections.find(item=>item.id===tab.connectionId) || state.activeJobs[tab.id] && !previous.activeJobs[tab.id] && referenceCount.current===0) { filteredUpdateIntent.current?.invalidate(); filteredDeleteIntent.current?.invalidate(); }
      if (identity(state) !== identity(previous) || state.settings.resultLimit !== previous.settings.resultLimit) filteredSelectIntent.current?.invalidate();
      if (identity(state) !== identity(previous)) {
        batchFillIntent.current?.invalidate(); recordBatchIntent.current?.invalidate(); if (sortPanelRef.current) sortPanelRef.current.invalid = true; if (filterGroupsRef.current) filterGroupsRef.current.invalid = true;
        // 模板窗口也在标签／连接切走的当下失效，同轮恢复原值不能复活旧SQL来源。
        if (queryTemplateRef.current) queryTemplateRef.current.invalid = true;
        if (selectedFilterRef.current) selectedFilterRef.current.invalid = true;
      }
      if (state.settings.resultLimit !== previous.settings.resultLimit && queryTemplateRef.current) queryTemplateRef.current.invalid = true;
    });
  }, [tab.id, tab.connectionId]);
  useEffect(() => () => foreignKeyJoinIntent.current?.invalidate(), []);
  useEffect(() => () => { pasteInsertIntent.current?.invalidate(); }, []);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [selection, setSelection] = useState<{ rowId: string; key: string }>();
  const [preview, setPreview] = useState<{ view: SqlPreview & { previewId?: string; previewExpiresAt?: string }; snapshot: RecordPagePreview; workspace?: TableEditBatch } | null>(null); const [previewing, setPreviewing] = useState(false); const previewingRef = useRef(false); const [applying, setApplying] = useState(false);
  const [applyTaskId, setApplyTaskId] = useState('');
  const [lastReceiptId, setLastReceiptId] = useState(''), [showReceipt, setShowReceipt] = useState(false), [commitLocked, setCommitLocked] = useState(false);
  const receiptTaskRef = useRef('');
  const applyRecovery = useRef(new TableApplyRecovery()).current;
  const [recoveryView, setRecoveryView] = useState(applyRecovery.view);
  // 主进程关联编号用于展示；提交事实仍只来自受校验的独立回执。
  useEffect(() => window.dbark?.onTask(event => {
    if (event.taskId !== receiptTaskRef.current || !event.tableApply || !applyRecovery.observe(event.taskId, event.tableApply)) return;
    setLastReceiptId(event.tableApply.operationId);
    if (event.tableApply.evidence.commitMayHaveBeenSent) setCommitLocked(true);
    publishApplyRecovery();
  }), []);
  const [referenceDialog, setReferenceDialogState] = useState<{ snapshot: ReferenceSnapshot; keys: ForeignKeyInfo[]; mode: 'choose' | 'browse'; column?: string; cellCurrent?(): boolean } | null>(null);
  const [childReferenceDialog, setChildReferenceDialog] = useState<ChildReferenceIntent | null>(null), childReferenceIntent = useRef<ChildReferenceIntent | null>(null);
  const [tableStatisticsDialog, setTableStatisticsDialog] = useState<{ intent: TableStatisticsIntent; onCount?(count: string): void } | null>(null), tableStatisticsIntent = useRef<TableStatisticsIntent | null>(null);
  const [pageCount, setPageCount] = useState<{ generation: number; refreshVersion: typeof refreshVersion; count: string }>();
  const [relationshipDialog, setRelationshipDialog] = useState<{ source: TableInfo; current(): boolean } | null>(null), relationshipRef = useRef<typeof relationshipDialog>(null);
  const [tableValueOptionsDialog, setTableValueOptionsDialog] = useState<{ intent: TableStatisticsIntent; column: string } | null>(null), tableValueOptionsIntent = useRef<TableStatisticsIntent | null>(null);
  /** 关联窗口即使打开后关闭，也永久推进原方案的上下文代次。 */
  function setReferenceDialog(next:typeof referenceDialog){filteredUpdateIntent.current?.invalidate(); filteredDeleteIntent.current?.invalidate();batchFillIntent.current?.invalidate(); recordBatchIntent.current?.invalidate();presetUiEpoch.current++;setReferenceDialogState(next);}
  const [referenceBusy, setReferenceBusy] = useState(false); const referenceCount = useRef(0);
  const grid = useRef<DataGridHandle>(null); const [showFind, setShowFind] = useState(false); const [showPreferences, setShowPreferencesState] = useState(false);
  const [findDisplay, setFindDisplay] = useState<PageFindDisplay>();
  /** 布局窗口变化同步记代，不依赖晚到的React effect或最终布尔值。 */
  function setShowPreferences(next:boolean){filteredUpdateIntent.current?.invalidate(); filteredDeleteIntent.current?.invalidate();batchFillIntent.current?.invalidate(); recordBatchIntent.current?.invalidate();presetUiEpoch.current++;setShowPreferencesState(next);}
  const [findFocus, setFindFocus] = useState<{ target: 'query' | 'replacement'; generation: number; column?: string }>({ target: 'query', generation: 0 });
  const [preferences, setPreferences] = useState<TablePreferences>({ version: 1, columns: [] }); const preferencesRef = useRef(preferences); preferencesRef.current = preferences;
  const [preferencesLoading, setPreferencesLoading] = useState(true); const [preferencesPending, setPreferencesPending] = useState(false); const preferencesLock = useRef(false);
  const [preferencesDirty, setPreferencesDirtyState] = useState(false); const [preferencesError, setPreferencesError] = useState(''); const layoutRevision = useRef(0);
  const namedLayout = useRef<{ configuration: TablePresetConfiguration; layout: TablePreferences; scope: string; revision: number; finish(applied: boolean): void } | undefined>(undefined);
  /** 同步发布布局草稿，跨标签结构操作不能在React效果到来前抢先丢弃设置。 */
  function setPreferencesDirty(dirty: boolean) { setPreferencesDirtyState(dirty); useWorkspace.getState().setTableLayoutDraft(tab.id, dirty); }
  const preferenceLifecycle = useRef(0); const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; rowTransferIntent.current?.invalidate(); rowTransferSource.current = null; childReferenceIntent.current?.invalidate(); tableStatisticsIntent.current?.invalidate(); tableValueOptionsIntent.current?.invalidate(); filteredExportIntent.current?.invalidate(); filteredUpdateIntent.current?.invalidate(); filteredDeleteIntent.current?.invalidate(); filteredSelectIntent.current?.invalidate(); filteredSelectPage.current = null; pageExportRef.current = null; queryTemplateRef.current = null; sortPanelRef.current = null; preferenceLifecycle.current++; useWorkspace.getState().setTableLayoutDraft(tab.id, false); }; }, []);
  const rowsRef = useRef(rows); rowsRef.current = rows;
  const [, updateWorkspace] = useState(0);
  const [tableEdits] = useState(() => new TableEditWorkspace(() => updateWorkspace(value => value + 1)));
  const history = tableEdits.history;
  const workspaceSkipLoad = useRef<{ entry: TableEditPage; scope: string } | undefined>(undefined);
  useEffect(() => useWorkspace.subscribe((state, previous) => { if (state.settings.tabs.find(item => item.id === tab.id) !== previous.settings.tabs.find(item => item.id === tab.id) || state.connections.find(item => item.id === tab.connectionId) !== previous.connections.find(item => item.id === tab.connectionId) || state.connectionVersions[tab.connectionId] !== previous.connectionVersions[tab.connectionId]) tableEdits.invalidate(); }), [tableEdits, tab.id, tab.connectionId]);
  const historyEnvironment = useRef<unknown[]>([]);
  const [gridEditing, setGridEditing] = useState(false);
  const activeGridEditor = useRef<object | null>(null);
  /** 编辑器生命周期是占门依据；稳定回调避免每次输入都重新注册，卸载父页不再更新状态。 */
  const onGridEditingChange = useCallback((editor: object, editing: boolean) => {
    if (!mounted.current) return;
    if (editing) { filteredUpdateIntent.current?.invalidate(); filteredDeleteIntent.current?.invalidate(); if (selectedFilterRef.current) selectedFilterRef.current.invalid = true; activeGridEditor.current = editor; setGridEditing(true); }
    else if (activeGridEditor.current === editor) { activeGridEditor.current = null; setGridEditing(false); }
  }, []);
  useEffect(() => () => tableEdits.clear(false), [tableEdits]);
  const inputDirtyRef = useRef(false); const recordControllerRef = useRef<RecordViewController | null>(null); const rootElement = useRef<HTMLDivElement>(null);
  const selectionRef = useRef(selection); selectionRef.current = selection;
  /** 所有入口同步替换同一页草稿引用，避免一次事件轮次内的迟到回调覆盖更新。 */
  function setRows(value: DraftRow[] | ((current: DraftRow[]) => DraftRow[]), mode: 'record' | 'replace' | 'replay' = 'record') {
    rowTransferIntent.current?.invalidate();
    childReferenceIntent.current?.invalidate();
    tableStatisticsIntent.current?.invalidate(); tableValueOptionsIntent.current?.invalidate();
    filteredExportIntent.current?.invalidate();
    filteredUpdateIntent.current?.invalidate(); filteredDeleteIntent.current?.invalidate();
    filteredSelectIntent.current?.invalidate();
    batchFillIntent.current?.invalidate(); recordBatchIntent.current?.invalidate();
    if (selectedFilterRef.current) selectedFilterRef.current.invalid = true;
    invalidateCopyRead();
    const next = typeof value === 'function' ? value(rowsRef.current) : value;
    if (mode !== 'replace') tableEdits.update(rowsRef.current, next);
    if (mode === 'record') history.record(rowsRef.current, next); else if (mode === 'replace') history.clear();
    const retained = history.retainedIds();
    for (const row of next) if (copiedDraftIds.current.has(row.id)) retained.add(row.id);
    for (const id of copiedDraftIds.current) if (!retained.has(id)) copiedDraftIds.current.delete(id);
    rowsRef.current = next; setRowsState(next); useWorkspace.getState().setDirty(tab.id, collectChanges(tableEdits.allRows(next)).length > 0 || inputDirtyRef.current);
  }
  const applyingRef = useRef(applying); applyingRef.current = applying;
  const blocked = busy || referenceBusy || !!rowTransferDialog || !!foreignKeyJoinDialog || !!childReferenceDialog || !!tableStatisticsDialog || !!tableValueOptionsDialog || !!filteredExportDialog || !!filteredUpdateDialog || !!filteredDeleteDialog || !!filteredSelectDialog || applying || preferencesPending || previewing || !!preview || copyPending; const blockedRef = useRef(blocked); blockedRef.current = blocked;
  const changes = useMemo(() => collectChanges(tableEdits.allRows(rows)), [rows, tableEdits.revision]);
  const loadGeneration = useRef(0);
  const recordPages = useRef(new RecordPageNavigation()).current;
  const [recordPageMessage, setRecordPageMessage] = useState({ revision: -1, text: '' });
  const loadingCount = useRef(0); const observedRefresh = useRef(refreshVersion); const [externalStaleState, setExternalStaleState] = useState(false), externalStaleRef = useRef(false);
  let externalStale = externalStaleState || applyRecovery.locked || tableEdits.stale;
  /** 外部结构失效独立于提交保护，不能在已回滚时误清真正的结构墓碑。 */
  function setExternalStale(value: boolean): void { externalStaleRef.current = value; setExternalStaleState(value); }
  const base = useMemo(() => ({ connectionId: tab.connectionId, database: tab.database!, table: tab.table! }), [tab.connectionId, tab.database, tab.table]);
  const workspaceScope = recordPageScope({ target: base, connectionVersion, refreshVersion, pageSize, filters, filterMode, filterGroup, sort });
  tableEdits.observe(workspaceScope, connection); externalStale ||= tableEdits.stale;
  const savedDraftValues = [base, connection, connectionVersion, refreshVersion, info, page, rows, loadGeneration.current, pageIndex, pageSize, filters, filterMode, filterGroup, sort, externalStale, settings.activeTabId, tableEdits.revision, tableEdits.generation];
  const foreignKeyJoinValues = [...savedDraftValues, tab, settings.resultLimit]; foreignKeyJoinIntent.current?.observe(foreignKeyJoinValues);
  if (draftLease.current && savedDraftValues.some((value, index) => value !== draftLease.current!.values[index])) draftLease.current.invalid = true;
  // 观察标签和连接的每次变化，切走后再切回也不能复活文件选择前的恢复授权。
  useEffect(() => useWorkspace.subscribe((state, previous) => {
    if (state.settings.activeTabId !== previous.settings.activeTabId || state.settings.tabs.find(item => item.id === tab.id) !== previous.settings.tabs.find(item => item.id === tab.id) || state.connectionVersions[tab.connectionId] !== previous.connectionVersions[tab.connectionId] || state.connections.find(item => item.id === tab.connectionId) !== previous.connections.find(item => item.id === tab.connectionId)) { if (draftLease.current) draftLease.current.invalid = true; }
  }), [tab.id, tab.connectionId]);
  // 排序草稿绑定原表页及读取条件；切换后再回到相同值也不复活旧草稿。
  const sortScope = useMemo(() => ({}), [base, connectionVersion, refreshVersion, info, page, pageIndex, pageSize, sort, filters, filterMode, filterGroup, externalStale, settings.activeTabId, JSON.stringify(info?.columns.map(column => column.name))]);
  const sortScopeRef = useRef(sortScope); sortScopeRef.current = sortScope;
  const filteredExportValues = [base, connectionVersion, refreshVersion, info, page, rows, loadGeneration.current, pageIndex, pageSize, filters, filterMode, filterGroup, sort, externalStale, settings.activeTabId];
  filteredExportIntent.current?.observe(filteredExportValues);
  const filteredSelectValues = [...filteredExportValues, settings.resultLimit, filteredSelectPage.current, selectedRows, selection];
  filteredSelectIntent.current?.observe(filteredSelectValues);
  if (sortPanelRef.current && sortPanelRef.current.scope !== sortScope) sortPanelRef.current.invalid = true;
  if (filterGroupsRef.current && filterGroupsRef.current.scope !== sortScope) filterGroupsRef.current.invalid = true;
  if (selectedFilterRef.current && selectedFilterRef.current.scope !== sortScope) selectedFilterRef.current.invalid = true;
  useEffect(() => () => { filterGroupsRef.current?.dialogs.dispose(); }, []);
  useEffect(() => () => { selectedFilterRef.current?.dialogs.dispose(); if (selectedFilterRef.current) selectedFilterRef.current.invalid = true; }, []);
  const copyEnvironment = useRef<{ values: unknown[] }>({ values: [] });
  const copyValues = [base, connectionVersion, refreshVersion, info, page, info && tableCopyMetadataKey(info), page?.copyMetadataKey, page?.copySource, page?.copySource?.status === 'ready' && page.copySource.metadataKey];
  if (copyValues.some((value, index) => value !== copyEnvironment.current.values[index])) { copyEnvironment.current = { values: copyValues }; if (copyReadIntent.current) copyReadIntent.current.invalidated = true; }
  // 观察过的目标/目录/页面/布局变化使旧对话框永久失效，随后变回也不复活旧计划。
  const pasteInsertValues = [base, connectionVersion, refreshVersion, info, page, info && tableCopyMetadataKey(info), layoutRevision.current, externalStale, pageIndex, pageSize, filters, filterMode, filterGroup, sort];
  if (pasteInsertValues.some((value, index) => value !== pasteInsertEnvironment.current[index])) { pasteInsertIntent.current?.invalidate(); pasteInsertEnvironment.current = pasteInsertValues; }
  // 页面、条件、目录及连接身份只要观察过变化就清空，不允许返回旧值时复活旧历史。
  const historyValues = [base, connectionVersion, refreshVersion, info && tableCopyMetadataKey(info), externalStale, pageSize, filters, filterMode, filterGroup, sort];
  if (historyValues.some((value, index) => value !== historyEnvironment.current[index])) { history.clear(); historyEnvironment.current = historyValues; }
  const recordContextRef = useRef<RecordContext>({ target: base, connectionVersion, generation: loadGeneration.current, info, loaded: !!page, stale: externalStale, busy: blocked });
  recordContextRef.current = { target: base, connectionVersion, generation: loadGeneration.current, info, loaded: !!page, stale: externalStale, busy: blocked };
  /** 代次与忙碌读取同步引用，不等待下一次渲染才能阻止旧字段输入写入新页。 */
  function getRecordContext(): RecordContext { return { ...recordContextRef.current, generation: loadGeneration.current, busy: blockedRef.current, stale: recordContextRef.current.stale || tableEdits.stale || applyRecovery.locked }; }
  /** 先同步撤销编辑资格，再发布展示；同轮旧按钮不等待React渲染才看见提交保护。 */
  function publishApplyRecovery(): void {
    recordContextRef.current.stale = externalStaleRef.current || applyRecovery.locked || tableEdits.stale;
    setRecoveryView(applyRecovery.view);
  }
  /** 取消只请求一次并保留占门，直到实际读取收尾；已消费结果不再向完成任务发送KILL。 */
  function invalidateCopyRead() {
    const intent = copyReadIntent.current; if (!intent || intent.consumed) return;
    intent.invalidated = true; if (intent.cancelSent) return; intent.cancelSent = true;
    void invoke('query.cancel', { taskId: intent.taskId }).catch(() => undefined);
  }
  /** 本地先撤掉页/行引用，再幂等释放引擎租约；迟到页面另行按其请求连接释放。 */
  async function releaseCopySources(source = copySources.current) {
    if (source === copySources.current) { copySources.current = null; copyPage.current = null; copyRowRefs.current.clear(); }
    if (source?.source.status === 'ready') await invoke('table.copySourceRelease', { connectionId: source.connectionId, pageRef: source.source.pageRef }).catch(() => undefined);
  }
  useEffect(() => { invalidateCopyRead(); }, [base, connectionVersion, refreshVersion]);
  useEffect(() => () => { invalidateCopyRead(); if (copyPageTask.current && !lastPageRead.current?.stopped) void invoke('query.cancel', { taskId: copyPageTask.current }).catch(() => undefined); void releaseCopySources(); }, []);
  const record = useRecordViews({ rows, getRows: () => rowsRef.current, getContext: getRecordContext, onRows: setRows, onDirty: dirty => { childReferenceIntent.current?.invalidate(); tableStatisticsIntent.current?.invalidate(); tableValueOptionsIntent.current?.invalidate(); if (dirty && selectedFilterRef.current) selectedFilterRef.current.invalid = true; if (dirty) { filteredUpdateIntent.current?.invalidate(); filteredDeleteIntent.current?.invalidate(); invalidateCopyRead(); batchFillIntent.current?.invalidate(); recordBatchIntent.current?.invalidate(); } inputDirtyRef.current = dirty; useWorkspace.getState().setDirty(tab.id, dirty || collectChanges(tableEdits.allRows(rowsRef.current)).length > 0); }, onFocusGrid: () => restoreGridFocus(true) });
  recordControllerRef.current = record;
  const childReferenceValues = [base, connectionVersion, refreshVersion, info, page, rows, loadGeneration.current, pageIndex, pageSize, sort, filters, filterMode, filterGroup, externalStale, selection?.rowId, settings.activeTabId, record.dirty, record.pending, record.formOpen, gridEditing];
  childReferenceIntent.current?.observe(childReferenceValues);
  tableStatisticsIntent.current?.observe(childReferenceValues);
  tableValueOptionsIntent.current?.observe(childReferenceValues);
  const statisticsConditions = useRef({ filters, filterMode, ...(filterGroup ? { filterGroup } : {}) }); statisticsConditions.current = { filters, filterMode, ...(filterGroup ? { filterGroup } : {}) };
  const filteredSelectView = useRef({ info, page, unavailable: false });
  filteredSelectView.current = { info, page, unavailable: restoredDraftView || busy || referenceBusy || applying || preferencesPending || previewing || !!preview || copyPending || showPreferences || !!referenceDialog || externalStale || gridEditing || record.hasInput() };
  // 标签或连接切走再切回亦同步撤销，不依赖React合并后的最终值。
  useEffect(() => useWorkspace.subscribe((state, previous) => {
    const target = (value: typeof state) => JSON.stringify([value.settings.activeTabId, value.settings.tabs.find(item => item.id === tab.id), value.connectionVersions[tab.connectionId] ?? 0]);
    if (target(state) !== target(previous) || state.connections.find(item => item.id === tab.connectionId) !== previous.connections.find(item => item.id === tab.connectionId)) { childReferenceIntent.current?.invalidate(); tableStatisticsIntent.current?.invalidate(); tableValueOptionsIntent.current?.invalidate(); }
  }), [tab.id, tab.connectionId]);
  const batchFillValues = [...pasteInsertValues, rows, selectedRows, selection, settings.activeTabId, blocked, record.dirty, record.pending, gridEditing, showPreferences, referenceDialog];
  const filteredUpdateValues = [...filteredExportValues, record.dirty, record.pending, gridEditing, showPreferences, referenceDialog, busy, applying, previewing, preview, preferencesPending];
  filteredUpdateIntent.current?.observe(filteredUpdateValues);
  const filteredDeleteValues = [...filteredUpdateValues];
  filteredDeleteIntent.current?.observe(filteredDeleteValues);
  if (batchFillValues.some((value, index) => value !== batchFillEnvironment.current[index])) { batchFillIntent.current?.invalidate(); recordBatchIntent.current?.invalidate(); batchFillEnvironment.current = batchFillValues; }
  const recordPageScopeValue = { target: base, connectionVersion, refreshVersion, pageSize, filters, filterMode, filterGroup, sort };
  const recordPageScopeRef = useRef({ value: recordPageScopeValue, page: pageIndex }); recordPageScopeRef.current = { value: recordPageScopeValue, page: pageIndex };
  /** 异步完成仍读取当前工作区身份，连接版本或标签切换无需等待旧闭包更新。 */
  function getRecordPageContext(): RecordPageContext {
    const current = recordPageScopeRef.current, workspace = useWorkspace.getState(), target = current.value.target;
    const currentTab = workspace.settings.tabs.find(item => item.id === tab.id);
    return { scope: recordPageScope({ ...current.value, connectionVersion: workspace.connectionVersions[target.connectionId] ?? 0 }), page: current.page, generation: loadGeneration.current, active: workspace.settings.activeTabId === tab.id && currentTab?.connectionId === target.connectionId && currentTab.database === target.database && currentTab.table === target.table, formOpen: recordControllerRef.current?.formOpen ?? false, stale: recordContextRef.current.stale };
  }
  recordPages.observe(getRecordPageContext());
  useEffect(() => () => recordPages.cancel(), [recordPages]);
  const editable = !recordReadonlyReason({ ...getRecordContext(), busy: false });
  const visibleKeys = useMemo(() => visibleTableKeys(reconcileTablePreferences(page?.columns.map(column => column.key) ?? [], preferences)), [page?.columns, preferences]);
  // 冻结边界和可见列使用同一真实结构调和，只标记前缀，不重排原值或读取数据库。
  const frozenKeys = useMemo(() => frozenTableKeys(reconcileTablePreferences(page?.columns.map(column => column.key) ?? [], preferences)), [page?.columns, preferences]);
  const visibleColumns = useMemo(() => { const source = new Map(page?.columns.map(column => [column.key, column]) ?? []); return visibleKeys.map(key => source.get(key)!); }, [page?.columns, visibleKeys]);
  const pageFindContext = useRef<{ values: unknown[]; generation: number }>({ values: [], generation: 0 });
  /** 任意草稿或上下文变化都递增查找代次；应用时同步重算，不能覆盖同轮事件的新草稿。 */
  function pageFindGeneration(): number {
    const context = getRecordContext();
    const values = [rowsRef.current, context.info, context.connectionVersion, refreshVersion, context.stale, recordTargetKey(context.target), context.loaded, context.generation, pageIndex, pageSize, sort, filters, filterMode, filterGroup, visibleKeys];
    if (values.some((value, index) => value !== pageFindContext.current.values[index])) pageFindContext.current = { values, generation: pageFindContext.current.generation + 1 };
    return pageFindContext.current.generation;
  }
  /** 只使用当前页网格的预览，包括本地草稿值。 */
  function columnFitSource(): GridColumnFitSource | undefined {
    if (!page || rowsRef.current !== rows || !getRecordPageContext().active || blockedRef.current || externalStale) return;
    return { columns: page.columns, rowCount: rows.length, cell: (index, key) => {
      const value = ownCell(rows[index].data, key);
      return value === undefined ? zh.common.defaultValue : cellPreview(value);
    } };
  }
  const collectScopeKey = recordPageScope(recordPageScopeValue);
  const collectScope = useMemo(() => ({}), [tab, connection, collectScopeKey, externalStale]);
  const collectSignature = page && info ? JSON.stringify([tableCopyMetadataKey(info), visibleKeys]) : undefined;
  const checkedExport = useTableCheckedExport(collectScope, collectSignature);
  const rowJumpScope = pageFindGeneration();
  const visibleFind = showFind && !blocked && !externalStale && settings.activeTabId === tab.id && findDisplay?.generation === rowJumpScope ? findDisplay : undefined;
  const rowJumpDisabled = blocked || externalStale || gridEditing || record.hasInput() || record.pending || !visibleKeys.length;
  const rangeCurrent = () => !rowJumpDisabled && tableToolbarCurrent() && rowsRef.current === rows && rowJumpScope === pageFindGeneration();
  const cellRange = useGridCellRange(rows, visibleKeys, rowJumpScope, 1, grid, rangeCurrent);
  const rowSelectionKey = (row: DraftRow) => row.deleted ? undefined : row.id;
  const rowSelectionCurrent = () => !rowJumpDisabled && tableToolbarCurrent() && rowsRef.current === rows && selectedRowsRef.current === selectedRows
    && !blockedRef.current && !activeGridEditor.current && !record.hasInput() && rowJumpScope === pageFindGeneration();
  /** 与表格复选框走同一状态入口，筛选、排序或草稿变化后不消费旧命中。 */
  function changeFindMatches(matches: ReadonlySet<string>, checked: boolean): void {
    if (!showFind || !rowSelectionCurrent()) return;
    const eligible = gridRowKeys(rows, row => matches.has(row.id) ? rowSelectionKey(row) : undefined);
    const next = mergeGridMatchSelection(selectedRowsRef.current, eligible, checked);
    if (next) setSelectedRows(next);
  }
  /** 行列定位共用本页、可见列与编辑门；换页或草稿变化后旧坐标失效。 */
  function gridJumpCurrent(): boolean {
    const workspace = useWorkspace.getState();
    return !!grid.current?.element?.isConnected && mounted.current && getRecordPageContext().active
      && (workspace.connectionVersions[tab.connectionId] ?? 0) === connectionVersion
      && !workspace.activeJobs[tab.id] && !blockedRef.current && !externalStale && observedRefresh.current === refreshVersion
      && !activeGridEditor.current && !record.hasInput() && !record.pending && !document.querySelector('[role="dialog"], [role="alertdialog"]')
      && rowJumpScope === pageFindGeneration();
  }
  function jumpToGridRow(rowIdx: number): boolean {
    const row = rowsRef.current[rowIdx];
    if (!row || !gridJumpCurrent()) return false;
    const activeKey = selectionRef.current?.key;
    const key = activeKey && visibleKeys.includes(activeKey) ? activeKey : visibleKeys[0];
    if (!key) return false;
    jumpToMatch(row.id, key);
    return true;
  }
  function jumpToGridColumn(index: number): boolean {
    if (!visibleKeys[index] || !gridJumpCurrent()) return false;
    const rowIdx = rowsRef.current.findIndex(item => item.id === selectionRef.current?.rowId);
    recordPages.cancel();
    return focusGridColumn(grid.current, index + 1, rowIdx);
  }
  useEffect(() => {
    let alive = true; preferenceLifecycle.current++; const revision = ++layoutRevision.current; setPreferencesLoading(true); setPreferencesDirty(false); setPreferencesError('');
    preferencesRef.current = { version: 1, columns: [] }; setPreferences(preferencesRef.current);
    void invoke('table.preferences.get', base).then(value => { if (alive && revision === layoutRevision.current) { const next = value ?? { version: 1 as const, columns: [] }; preferencesRef.current = next; setPreferences(next); setPreferencesError(''); } }).catch(reason => { if (alive) { setPreferencesError(errorMessage(reason)); setPreferencesDirty(true); } }).finally(() => { if (alive) setPreferencesLoading(false); });
    return () => { alive = false; };
  }, [base, connectionVersion]);
  /** 真实列新增或删除时调和偏好，不刷新数据或丢弃草稿。 */
  useEffect(() => { if (!page) return; const next = reconcileTablePreferences(page.columns.map(column => column.key), preferencesRef.current); if (JSON.stringify(next) !== JSON.stringify(preferencesRef.current)) { preferencesRef.current = next; setPreferences(next); } }, [page?.columns, preferencesLoading]);
  /** 活动身份保留列名，隐藏后移到首个可见列，重排后重新计算网格坐标。 */
  useEffect(() => {
    if (!selection || !visibleKeys.length) return;
    const rowIdx = rowsRef.current.findIndex(row => row.id === selection.rowId); if (rowIdx < 0) return;
    const key = visibleKeys.includes(selection.key) ? selection.key : visibleKeys[0]; const idx = visibleKeys.indexOf(key) + 1;
    if (key !== selection.key) setSelection({ rowId: selection.rowId, key });
    grid.current?.setActivePosition({ rowIdx, idx }, { enableEditor: false, shouldFocus: false });
  }, [visibleKeys]);
  /** 使用本地行身份还原网格位置；已失效目标回到本标签工具栏，不误选另一行。 */
  function restoreGridFocus(focus: boolean) {
    const current = selectionRef.current; const rowIdx = rowsRef.current.findIndex(row => row.id === current?.rowId); const idx = current ? visibleKeys.indexOf(current.key) + 1 : -1;
    if (rowIdx >= 0 && idx > 0) grid.current?.setActivePosition({ rowIdx, idx }, { enableEditor: false, shouldFocus: focus });
    else if (focus) rootElement.current?.querySelector<HTMLButtonElement>('.toolbar button:not(:disabled)')?.focus();
  }
  /** 所有本地写入口共享输入守卫；未暂存字段不能被另一个工具悄悄覆盖。 */
  function assertGridWritable() { if (record.hasInput()) throw new Error(recordViewZh.resolveInput); const reason = recordReadonlyReason(getRecordContext()); if (reason) throw new Error(reason); }
  /** 按钮与快捷键都同步核对真实工作区、输入及模态门；历史从不领取连接或执行票据。 */
  function historyAvailable(): boolean {
    const workspace = useWorkspace.getState(), current = workspace.settings.tabs.find(item => item.id === tab.id), context = getRecordContext();
    return mounted.current && workspace.settings.activeTabId === tab.id && !!current && workspace.connections.some(item => item.id === current.connectionId) && recordTargetKey({ connectionId: current.connectionId, database: current.database ?? '', table: current.table ?? '' }) === recordTargetKey(context.target) && (workspace.connectionVersions[current.connectionId] ?? 0) === context.connectionVersion && !blockedRef.current && !loadingCount.current && !referenceCount.current && !applyingRef.current && !preferencesLock.current && !previewingRef.current && !copyPendingRef.current && !recordReadonlyReason(context) && !record.hasInput() && !record.pending && !gridEditing && !activeGridEditor.current && !showPreferences && !referenceDialog && !pasteInsertDialog && !document.querySelector('[role="dialog"]') && !rootElement.current?.querySelector('.grid-input');
  }
  /** 只重放本页RAM差异，不重新调用原操作；重建记录输入并撤销旧粘贴/查找/复制意图。 */
  function moveHistory(direction: 'undo' | 'redo') {
    if (!historyAvailable()) return;
    const next = history.move(rowsRef.current, direction); if (!next) { if (history.notice) setError(history.notice); return; }
    const recordRowId = record.draft?.rowId;
    pasteInsertIntent.current?.invalidate(); pendingPaste.current = null; recordPages.cancel(); record.reset();
    setRows(next, 'replay'); setError(''); setDuplicateNotice('');
    const liveIds = new Set(next.map(row => row.id));
    setSelectedRows(new Set([...selectedRows].filter(id => liveIds.has(id))));
    const selected = selectionRef.current;
    if (selected && !next.some(row => row.id === selected.rowId)) { selectionRef.current = undefined; setSelection(undefined); }
    const formRowId = selected?.rowId ?? recordRowId;
    if (record.formOpen && formRowId && next.some(row => row.id === formRowId)) record.select(formRowId);
    restoreGridFocus(false);
  }
  /** 布局即时生效但明确保持未保存状态，异步读取不能覆盖用户刚调整的布局。 */
  function updatePreferences(next: TablePreferences) { if (preferencesLock.current) return; rowTransferIntent.current?.invalidate(); layoutRevision.current++; preferencesRef.current = next; setPreferences(next); setPreferencesDirty(true); setPreferencesError(''); }
  /** 成功返回后才显示已保存，失败保持本页布局并报告未持久化。 */
  async function savePreferences(reset = false) {
    if (preferencesLock.current) return; preferencesLock.current = true; setPreferencesPending(true); setPreferencesError(''); useWorkspace.getState().setBusy(tab.id, true);
    const lifecycle = preferenceLifecycle.current; const revision = layoutRevision.current;
    try {
      const next = reset ? reconcileTablePreferences(page?.columns.map(column => column.key) ?? [], null) : preferencesRef.current;
      if (reset) await invoke('table.preferences.reset', base); else await invoke('table.preferences.save', { ...base, preferences: next });
      if (mounted.current && lifecycle === preferenceLifecycle.current) {
        if (revision === layoutRevision.current && (reset || JSON.stringify(next) === JSON.stringify(preferencesRef.current))) { preferencesRef.current = next; setPreferences(next); setPreferencesDirty(false); layoutRevision.current++; }
        else setPreferencesDirty(true);
      }
    } catch (reason) { if (mounted.current && lifecycle === preferenceLifecycle.current) { setPreferencesError(formatText(tableGridZh.saveFailed, errorMessage(reason))); setPreferencesDirty(true); } }
    finally { preferencesLock.current = false; if (mounted.current) setPreferencesPending(false); useWorkspace.getState().setBusy(tab.id, loadingCount.current > 0 || referenceCount.current > 0 || applyingRef.current || preferencesLock.current || copyPendingRef.current); }
  }
  /** 查找按最新行身份和可见列跳转，虚拟行无需先存在于 DOM。 */
  function jumpToMatch(rowId: string, key: string, focusGrid = true) {
    recordPages.cancel();
    const rowIdx = rowsRef.current.findIndex(row => row.id === rowId), idx = visibleKeys.indexOf(key) + 1;
    if (blocked || rowIdx < 0 || idx < 1) return;
    const activate = () => { setSelection({ rowId, key }); selectionRef.current = { rowId, key }; grid.current?.scrollToCell({ rowIdx, idx }); grid.current?.setActivePosition({ rowIdx, idx }, { enableEditor: false, shouldFocus: focusGrid }); };
    if (record.formOpen) record.select(rowId, activate); else activate();
  }
  /** 网格快捷键与工具栏明确打开时发出新焦点请求，已打开的面板也能再次聚焦。 */
  function openPageFind(target: 'query' | 'replacement' = 'query', column?: string) {
    if (blocked || document.querySelector('[role="dialog"]') || column !== undefined && !visibleKeys.includes(column)) return;
    setShowFind(true); setFindFocus(current => ({ target, generation: current.generation + 1, column }));
  }
  /** 当前页替换先核对完整快照，最后只一次写本地草稿。 */
  function applyPagePlan(plan: PageReplacement, only?: PageOccurrence, selectionToken?: unknown) {
    assertGridWritable();
    const context = getRecordContext();
    // 单处定位还须属于网格同步选中身份，用户移到另一行/列后不沿用旧Worker命令。
    if (only && (selectionToken !== selectionRef.current || selectionRef.current?.rowId !== only.rowId || selectionRef.current.key !== only.key || plan.patches.length !== 1 || plan.patches[0].rowId !== only.rowId || plan.patches[0].key !== only.key)) throw new Error(tableGridZh.changed);
    // 最后写草稿前同步复核字段、记录和连接；迟到Worker结果不能借旧渲染信息跨页或覆盖活动输入。
    if (blockedRef.current || record.dirty || rootElement.current?.querySelector('.grid-input') || !context.info || plan.patches.some(patch => { const row = rowsRef.current.find(row => row.id === patch.rowId); return !row || !visibleKeys.includes(patch.key) || recordReadonlyReason(context, row, patch.key); })) throw new Error(tableGridZh.changed);
    const next = applyPageReplacement(rowsRef.current, plan, context.info, pageFindGeneration()); setRows(next); setError(''); return next;
  }
  /** 缓存采用仅恢复原页、原UUID和原历史；离开页的引擎补取租约不重新签发。 */
  function adoptWorkspacePage(entry: TableEditPage, generation: number, scope: string): void {
    copySources.current = null; copyRowRefs.current.clear();
    copyPage.current = tableEdits.restored ? null : { page: entry.page, target: recordTargetKey(base), connectionVersion, generation };
    filteredSelectPage.current = tableEdits.restored ? null : { info: entry.info, page: entry.page, scope, generation, index: entry.index };
    copiedDraftIds.current = entry.copied;
    setInfo(entry.info); setPage(entry.page); setRows(entry.rows, 'replay'); setRestoredDraftView(tableEdits.restored);
    setSelectedRows(entry.selected); selectionRef.current = entry.selection; setSelection(entry.selection); setDuplicateNotice('');
    recordControllerRef.current?.reset();
    if (recordControllerRef.current?.formOpen && entry.selection && entry.rows.some(row => row.id === entry.selection!.rowId)) recordControllerRef.current.select(entry.selection.rowId);
    setError('');
  }
  /** 普通切页保留准确原页；表单未暂存输入不被静默放弃，原页来源与条件全程固定。 */
  function retainAndNavigate(target: number | 'last', continuation = false): boolean {
    const entry = tableEdits.selected;
    if (!entry || entry.rows !== rowsRef.current || restoredDraftView) return false;
    if (!pageNavigationCurrent() || applyRecovery.locked || externalStaleRef.current || tableEdits.stale) throw Error(workspaceText.stale);
    if (record.hasInput() || activeGridEditor.current) throw Error(workspaceText.input);
    tableEdits.remember(rowsRef.current, selectedRowsRef.current, selectionRef.current, copiedDraftIds.current);
    tableEdits.navigate(target, getRecordPageContext().scope);
    if (!continuation) recordPages.cancel();
    tableReadAction.current = null; blockedRef.current = true; setBusy(true); record.reset(); setError('');
    if (target === 'last') setPageRequest({ from: entry.index }); else setPageIndex(target);
    return true;
  }
  /** 恢复文件中的原页只作本地分组；切换前核原父页身份和输入，绝不触发服务器分页。 */
  function selectRestoredWorkspacePage(entry: TableEditPage): void {
    const state = useWorkspace.getState();
    if (!restoredDraftView || !tableEdits.restored || !mounted.current || tableReadAction.current !== tableReadRender || reloadBlocked() || applyRecovery.locked || tableEdits.stale || externalStaleRef.current || state.settings.activeTabId !== tab.id || state.settings.tabs.find(item => item.id === tab.id) !== tab || state.connections.find(item => item.id === tab.connectionId) !== connection || (state.connectionVersions[tab.connectionId] ?? 0) !== connectionVersion || !tableEdits.pages.includes(entry) || entry === tableEdits.selected) return;
    if (record.hasInput() || activeGridEditor.current) { setError(workspaceText.input); return; }
    try {
      tableEdits.remember(rowsRef.current, selectedRowsRef.current, selectionRef.current, copiedDraftIds.current);
      tableEdits.selectRestored(entry); tableReadAction.current = null; recordPages.cancel();
      const generation = ++loadGeneration.current, scope = getRecordPageContext().scope;
      adoptWorkspacePage(entry, generation, scope); workspaceSkipLoad.current = { entry, scope }; setPageIndex(entry.index);
    } catch (reason) { setError(errorMessage(reason)); }
  }
  /** 放弃准确原页；后台页不读库，当前页优先返回另一原缓存，最后一页才重读。 */
  function discardWorkspacePage(entry: TableEditPage): void {
    const current = () => mounted.current && tableReadAction.current === tableReadRender && !reloadBlocked() && !activeGridEditor.current && !record.hasInput() && !applyRecovery.locked && useWorkspace.getState().settings.activeTabId === tab.id && useWorkspace.getState().settings.tabs.find(item => item.id === tab.id) === tab && (useWorkspace.getState().connectionVersions[tab.connectionId] ?? 0) === connectionVersion && tableEdits.pages.includes(entry);
    if (!current()) return;
    const isCurrent = tableEdits.selected === entry, capturedRows = entry.rows, capturedGeneration = tableEdits.generation, capturedRevision = tableEdits.revision;
    if (!window.confirm(workspaceText.confirmPage(entry.index, collectChanges(entry.rows).length, isCurrent, tableEdits.pages.length > 1)) || !current() || entry.rows !== capturedRows || tableEdits.generation !== capturedGeneration || tableEdits.revision !== capturedRevision) return;
    if (!tableEdits.discard(entry)) return;
    if (isCurrent) {
      recordPages.cancel(); record.reset(); void releaseCopySources();
      const next = tableEdits.selected;
      if (next) { const generation = ++loadGeneration.current, scope = getRecordPageContext().scope; adoptWorkspacePage(next, generation, scope); workspaceSkipLoad.current = { entry: next, scope }; setPageIndex(next.index); }
      else void load();
    }
    useWorkspace.getState().setDirty(tab.id, tableEdits.dirty || (!isCurrent && collectChanges(rowsRef.current).length > 0));
  }
  /** 每次加载分配代次，旧请求迟到时不能覆盖新页面或当前编辑状态。 */
  const load = useCallback(async () => {
    const readScope = recordPageScope({ target: base, connectionVersion, refreshVersion: recordPageScopeRef.current.value.refreshVersion, pageSize, filters, filterMode, filterGroup, sort });
    // 方案布局只随它发起的第一页读取消费，失败或晚到回包不会改当前布局。
    let preset = namedLayout.current;
    namedLayout.current = undefined;
    if (preset && (preset.scope !== readScope || preset.configuration.filters !== filters || pageRequest !== 1)) {
      preset.finish(false); preset = undefined;
    }
    let presetApplied = false;
    const skip = workspaceSkipLoad.current;
    if (skip && skip.scope === readScope && skip.entry === tableEdits.selected && skip.entry.index === pageRequest && skip.entry.rows === rowsRef.current) { workspaceSkipLoad.current = undefined; preset?.finish(false); return; }
    workspaceSkipLoad.current = undefined;
    let retainedNavigation: TableEditNavigation | undefined;
    try { retainedNavigation = tableEdits.navigation(typeof pageRequest === 'number' ? pageRequest : 'last', readScope); } catch (reason) { preset?.finish(false); setError(errorMessage(reason)); if (!loadingCount.current) setBusy(false); return; }
    let recoveryRead: TableApplyRecoveryRead | undefined;
    try { recoveryRead = applyRecovery.beginRead({ target: base, connectionVersion }); }
    catch (reason) { preset?.finish(false); setError(errorMessage(reason)); return; }
    publishApplyRecovery();
    rowTransferIntent.current?.invalidate();
    if (!retainedNavigation) history.clear();
    const last = typeof pageRequest !== 'number', requestedIndex = last ? 1 : pageRequest;
    const previousPage = last ? filteredSelectPage.current : null;
    const generation = ++loadGeneration.current; blockedRef.current = true;
    filteredSelectIntent.current?.invalidate(); filteredSelectPage.current = null;
    // 实际读取实参在第一个await前固定，不能让旧页领取后来筛选/排序的SQL草稿。
    const selectScope = recordPageScope({ target: base, connectionVersion, refreshVersion: recordPageScopeRef.current.value.refreshVersion, pageSize, filters, filterMode, filterGroup, sort });
    // 读取实参绑定当次条件；结构版本取最新值，其它旧闭包实参不能领取新条件的意图。
    const navigation = last ? undefined : recordPages.claim({ ...getRecordPageContext(), scope: selectScope, page: requestedIndex, generation });
    invalidateCopyRead(); if (copyPageTask.current && !lastPageRead.current?.stopped) void invoke('query.cancel', { taskId: copyPageTask.current }).catch(() => undefined);
    const sourceTaskId = uid(); copyPageTask.current = sourceTaskId;
    const lastRead: TableLastPageRead | undefined = last ? { taskId: sourceTaskId, sent: false, finished: false, stopped: false } : undefined;
    lastPageRead.current = lastRead; setLastPageStopping(false);
    let pendingSource: { connectionId: string; source: TableCopyPageSources } | null = null;
    let retiringSource: Promise<void> | undefined;
    loadingCount.current++; useWorkspace.getState().setBusy(tab.id, true);
    setBusy(true); setError('');
    try {
      const cached = retainedNavigation && tableEdits.cached(retainedNavigation);
      if (cached) {
        await releaseCopySources();
        if (generation !== loadGeneration.current || !mounted.current) return;
        tableEdits.select(retainedNavigation!, cached); adoptWorkspacePage(cached, generation, selectScope);
        if (navigation && recordPages.complete(navigation, getRecordPageContext(), cached.rows)) setRecordPageMessage({ revision: navigation.action, text: formatText(cached.rows.length ? recordViewZh.pageArrived : recordViewZh.pageEmpty, cached.index) });
        return;
      }
      if (!last) await releaseCopySources();
      await invoke('connections.open', { id: tab.connectionId });
      if (generation !== loadGeneration.current || !mounted.current) return;
      if (lastRead?.stopped) throw Error(zh.table.lastPageCancelled);
      if (lastRead) lastRead.sent = true;
      const settled = await Promise.allSettled([invoke('metadata.table', base), invoke('table.page', { ...base, page: requestedIndex, pageSize, filters, filterMode, filterGroup, sort, copySource: true, includeReadStatements: true, taskId: sourceTaskId, ...(last ? { lastPage: true } : {}) }, statements => {
        if (generation === loadGeneration.current && mounted.current && !lastRead?.stopped) readHistory.recordReadFailure(statements);
      })]);
      if (lastRead) lastRead.finished = true;
      if (settled[1].status === 'fulfilled' && settled[1].value.copySource) pendingSource = { connectionId: base.connectionId, source: settled[1].value.copySource };
      if (lastRead?.stopped) {
        if (settled[1].status === 'rejected') throw settled[1].reason;
        throw Error(zh.table.lastPageCancelled);
      }
      if (settled[0].status === 'rejected') throw settled[0].reason;
      const metadata = settled[0].value;
      if (settled[1].status === 'rejected') throw settled[1].reason; const data = settled[1].value;
      if (generation !== loadGeneration.current || !mounted.current) return;
      let presetPreferences: TablePreferences | undefined;
      if (preset && preset.revision === layoutRevision.current && !preferencesLock.current &&
          getRecordPageContext().active && getRecordPageContext().scope === readScope) {
        const names = data.columns.map(column => column.key);
        const configuration = validateTablePresetColumns(preset.configuration, metadata.columns.map(column => column.name));
        if (configuration.layout?.columns.some(column => !names.includes(column.name))) throw Error('表页缺少方案布局字段，未应用方案');
        presetPreferences = reconcileTablePreferences(names, preset.layout);
      }
      if (last) {
        const expected = tableLastPageBounds(data.matchingRows, pageSize);
        if (data.page !== expected.page || data.pageSize !== pageSize || data.hasMore || data.rows.length !== expected.rows || data.copyMetadataKey !== tableCopyMetadataKey(metadata)) throw Error(zh.table.lastPageMismatch);
      } else if (navigation && (data.page !== requestedIndex || data.pageSize !== pageSize)) throw new Error(recordViewZh.pageChanged);
      if (recoveryRead) {
        const current = getRecordContext(), workspace = useWorkspace.getState(), currentTab = workspace.settings.tabs.find(item => item.id === tab.id);
        // 重新读取的回包不能清除后来目标或连接修订上的保护。
        if (recordTargetKey(current.target) !== recordTargetKey(base) || current.connectionVersion !== connectionVersion || (workspace.connectionVersions[tab.connectionId] ?? 0) !== connectionVersion || !currentTab || currentTab.connectionId !== base.connectionId || currentTab.database !== base.database || currentTab.table !== base.table) throw Error(tableApplyRecoveryZh.blocked);
      }
      const nextRows = data.rows.map(data => ({ id: uid(), data: structuredClone(data), original: structuredClone(data), inserted: false, deleted: false }));
      const writable = !recordReadonlyReason({ target: base, connectionVersion, generation, info: metadata, loaded: true, stale: false, busy: false });
      if (retainedNavigation && !writable) throw Error(workspaceText.stale);
      if (retainedNavigation?.target === 'last' && tableEdits.pages.some(entry => entry.index === data.page) && pendingSource) { await releaseCopySources(pendingSource); pendingSource = null; if (generation !== loadGeneration.current || !mounted.current) return; }
      const retained = writable ? tableEdits.adopt(selectScope, connection, metadata, data, nextRows, retainedNavigation) : undefined;
      const recordRead = () => readHistory.record(data.readStatements, (data.page - 1) * data.pageSize + 1, data.rows.length);
      if (!writable) tableEdits.clear();
      if (retained && retained.page !== data) {
        if (pendingSource) { await releaseCopySources(pendingSource); pendingSource = null; }
        if (last) retiringSource = releaseCopySources();
        adoptWorkspacePage(retained, generation, selectScope);
        if (typeof pageRequest !== 'number') { workspaceSkipLoad.current = { entry: retained, scope: selectScope }; setPageIndex(retained.index); }
        // 末页查询已经真实完成，复用原草稿页也要记这次读取。
        if (generation === loadGeneration.current && mounted.current) recordRead();
        return;
      }
      if (last) retiringSource = releaseCopySources();
      copySources.current = pendingSource; copyPage.current = { page: data, target: recordTargetKey(base), connectionVersion, generation }; pendingSource = null; copyRowRefs.current.clear();
      if (data.copySource?.status === 'ready') { const refs = data.copySource.rowRefs; nextRows.forEach((row, index) => { if (refs[index]) copyRowRefs.current.set(row.id, refs[index]!); }); }
      filteredSelectPage.current = { info: metadata, page: data, scope: selectScope, generation, index: last ? data.page : requestedIndex };
      setInfo(metadata); setPage(data); setRows(nextRows, 'replace'); setRestoredDraftView(false); setSelectedRows(new Set()); setSelection(undefined); selectionRef.current = undefined; copiedDraftIds.current = retained?.copied ?? new Set(); setDuplicateNotice(''); recordControllerRef.current?.reset(); setExternalStale(false);
      if (recoveryRead && !applyRecovery.completeRead(recoveryRead, { target: base, connectionVersion })) throw Error(tableApplyRecoveryZh.blocked);
      if (presetPreferences) {
        if (JSON.stringify(presetPreferences) !== JSON.stringify(preferencesRef.current)) updatePreferences(presetPreferences);
        presetApplied = true;
      }
      publishApplyRecovery();
      if (navigation && recordPages.complete(navigation, getRecordPageContext(), nextRows)) setRecordPageMessage({ revision: navigation.action, text: formatText(nextRows.length ? recordViewZh.pageArrived : recordViewZh.pageEmpty, requestedIndex) });
      recordRead();
    } catch (reason) {
      if (generation === loadGeneration.current && mounted.current) {
        setError(errorMessage(reason));
        if (retainedNavigation) {
          tableEdits.fail(retainedNavigation); adoptWorkspacePage(retainedNavigation.from, generation, selectScope); setError(errorMessage(reason)); workspaceSkipLoad.current = { entry: retainedNavigation.from, scope: selectScope }; setPageIndex(retainedNavigation.from.index);
          // 保留原页草稿和独立历史；回到原页不再读取或覆盖原值。
        } else if (recoveryRead) {
          // 核对读取失败保持提交前的完整草稿，不用空页伪装读取成功。
          applyRecovery.failRead(recoveryRead); publishApplyRecovery();
        } else if (previousPage?.scope === selectScope && recordPageSource.current === previousPage.page && getRecordPageContext().scope === selectScope) {
          // 显式末页读取失败或取消时，原页、原行和复制来源均保持。
          filteredSelectPage.current = { ...previousPage, generation };
          if (copyPage.current?.page === previousPage.page) copyPage.current = { ...copyPage.current, generation };
        } else {
          if (last) retiringSource = releaseCopySources();
          setPage(null); setRows([], 'replace'); setRestoredDraftView(false); setSelectedRows(new Set()); setSelection(undefined); selectionRef.current = undefined; recordControllerRef.current?.reset();
        }
        if (navigation && recordPages.fail(navigation, getRecordPageContext())) setRecordPageMessage({ revision: navigation.action, text: formatText(recordViewZh.pageFailed, requestedIndex) });
      }
    }
    finally {
      preset?.finish(presetApplied);
      if (retainedNavigation) tableEdits.fail(retainedNavigation);
      if (recoveryRead) { applyRecovery.failRead(recoveryRead); publishApplyRecovery(); }
      if (pendingSource) await releaseCopySources(pendingSource);
      if (retiringSource) await retiringSource;
      if (lastRead?.stop) await lastRead.stop;
      if (lastPageRead.current === lastRead) { lastPageRead.current = undefined; if (mounted.current) setLastPageStopping(false); }
      if (copyPageTask.current === sourceTaskId) copyPageTask.current = undefined;
      loadingCount.current = Math.max(0, loadingCount.current - 1); useWorkspace.getState().setBusy(tab.id, loadingCount.current > 0 || referenceCount.current > 0 || applyingRef.current || preferencesLock.current || copyPendingRef.current); if (loadingCount.current === 0 && mounted.current) setBusy(false);
    }
  }, [base, pageRequest, pageSize, filters, filterMode, filterGroup, sort, tab.connectionId, connectionVersion]);
  const observedConnection = useRef({ target: recordTargetKey(base), version: connectionVersion });
  useEffect(() => {
    const changed = observedConnection.current.target !== recordTargetKey(base) || observedConnection.current.version !== connectionVersion;
    observedConnection.current = { target: recordTargetKey(base), version: connectionVersion };
    // 正常编辑连接已由上层保护；仍防御外部版本改变静默丢弃两层草稿。
    if (changed && (tableEdits.protected || collectChanges(rowsRef.current).length || recordControllerRef.current?.hasInput())) { loadGeneration.current++; setExternalStale(true); return; }
    void load(); return () => { loadGeneration.current++; };
  }, [load]);
  /** 仅同目标的完成版本触发刷新；未知结果或有草稿时明确过期，绝不自动丢数据。 */
  useEffect(() => {
    const action = columnPageRefreshAction(observedRefresh.current, refreshVersion, refreshAutomatically, blocked, changes.length > 0 || record.dirty);
    if (action === 'ignore' || action === 'wait') return;
    observedRefresh.current = refreshVersion;
    if (action === 'reload') void load(); else setExternalStale(true);
  }, [refreshVersion, refreshAutomatically, blocked, changes.length, record.dirty, load]);
  useEffect(() => { setPageJump(String(pageIndex)); }, [pageIndex]);
  useEffect(() => { useWorkspace.getState().setDirty(tab.id, changes.length > 0 || record.dirty); }, [tab.id, changes.length, record.dirty]);
  useEffect(() => () => useWorkspace.getState().setDirty(tab.id, false), [tab.id]);
  /** 翻页、排序或刷新前先确认是否允许丢弃本页尚未提交的草稿。 */
  /** 保存和恢复都绑定原页；文件成功不清除数据库dirty，恢复从不自动提交。 */
  function openSavedDraft(mode: 'save' | 'restore') {
    if (tableReadAction.current !== tableReadRender || draftLease.current || !editable || !info || !page || !connection || blockedRef.current || gridEditing || record.hasInput() || record.pending || showPreferences || referenceDialog || document.querySelector('[role="dialog"]') || useWorkspace.getState().settings.activeTabId !== tab.id) return;
    if (mode === 'restore' && (tableEdits.protected || collectChanges(rowsRef.current).length)) { setError(savedDraftText.existing); return; }
    try {
      const payload = mode === 'save' ? captureTableDraft(tableEdits.allRows(rowsRef.current), base, info, tableEdits.draftLayout(rowsRef.current)) : undefined;
      const lease: TableDraftLease = { mode, ...(payload ? { payload } : {}), info, page, rows: rowsRef.current, generation: loadGeneration.current, invalid: false, values: savedDraftValues };
      draftLease.current = lease; blockedRef.current = true; referenceCount.current++; setReferenceBusy(true); useWorkspace.getState().setBusy(tab.id, true); setDraftDialog(lease); setError('');
    } catch (reason) { setError(errorMessage(reason)); }
  }
  /** 原文件或核验回包过期时保留父页全部数据，只有原租约能一次性发布独立草稿。 */
  function assertSavedDraft(lease: TableDraftLease) {
    const state = useWorkspace.getState();
    if (!mounted.current || draftLease.current !== lease || lease.invalid || state.settings.activeTabId !== tab.id || state.settings.tabs.find(item => item.id === tab.id) !== tab || state.connections.find(item => item.id === tab.connectionId) !== connection || (state.connectionVersions[tab.connectionId] ?? 0) !== connectionVersion || lease.rows !== rowsRef.current || lease.info !== recordContextRef.current.info || lease.generation !== loadGeneration.current || recordContextRef.current.stale || activeGridEditor.current || record.hasInput()) throw Error(savedDraftText.stale);
  }
  /** 独立草稿只显示保存的变更行；清空旧分页来源，不按当前页位置覆盖任何记录。 */
  function acceptSavedDraft(lease: TableDraftLease, document: TableDraftDocument) {
    assertSavedDraft(lease);
    if (tableEdits.protected || collectChanges(rowsRef.current).length || lease.mode !== 'restore') throw Error(savedDraftText.existing);
    if (document.workspace) {
      const scope = recordPageScope({ target: base, connectionVersion, refreshVersion, pageSize: document.workspace.pageSize, filters, filterMode, filterGroup, sort });
      const entry = tableEdits.restoreDraft(scope, connection, lease.info, document, uid);
      recordPages.cancel(); record.reset(); void releaseCopySources();
      adoptWorkspacePage(entry, ++loadGeneration.current, scope);
      workspaceSkipLoad.current = entry.index !== pageIndex || document.workspace.pageSize !== pageSize ? { entry, scope } : undefined;
      setPageSize(document.workspace.pageSize); setPageIndex(entry.index); return;
    }
    const restored = restoreTableDraftRows(document, lease.info, uid);
    const inserted = new Set(restored.filter(row => row.inserted).map(row => row.id));
    assertCopiedRecordKeys(restored, lease.info, inserted);
    tableEdits.clear();
    recordPages.cancel(); record.reset(); void releaseCopySources(); filteredSelectPage.current = null;
    copiedDraftIds.current = inserted;
    setPage({ ...lease.page, rows: restored.flatMap(row => row.original ? [structuredClone(row.original)] : []), hasMore: false, copySource: undefined });
    setRows(restored, 'replace'); setRestoredDraftView(true); setSelectedRows(new Set()); setSelection(undefined); selectionRef.current = undefined; setDuplicateNotice(''); setError('');
  }
  /** 占门持续到子窗口的原文件操作或核验全部结算，关闭后才允许刷新或退出。 */
  function closeSavedDraft(lease: TableDraftLease) {
    if (draftLease.current !== lease) return;
    lease.invalid = true; draftLease.current = null; setDraftDialog(null);
    referenceCount.current = Math.max(0, referenceCount.current - 1); setReferenceBusy(referenceCount.current > 0);
    useWorkspace.getState().setBusy(tab.id, loadingCount.current > 0 || referenceCount.current > 0 || applyingRef.current || preferencesLock.current || copyPendingRef.current);
  }
  function reloadBlocked():boolean {
    return !!(rowTransferSource.current||blockedRef.current||showPreferences||document.querySelector('[role="dialog"]')||referenceCount.current>0||referenceDialog);
  }
  /** 同一个丢稿确认入口在确认前后核原来源；confirm期间的导航或ABA不能授权后继页。 */
  function confirmPageReload(guard: () => boolean = () => !reloadBlocked()): boolean {
    if (!guard()) return false;
    const recovery = applyRecovery.view, workspaceRevision = tableEdits.revision, workspaceGeneration = tableEdits.generation, workspaceStale = tableEdits.stale;
    const prompt = recovery.locked ? recovery.outcome === 'committed' ? tableApplyRecoveryZh.confirmCommitted : tableApplyRecoveryZh.confirmUnknown : tableEdits.protected ? workspaceText.confirmAll : recordViewZh.discardPage;
    if ((recovery.locked || tableEdits.protected || collectChanges(rowsRef.current).length || record.hasInput()) && !window.confirm(prompt)) return false;
    if (!guard() || tableEdits.revision !== workspaceRevision || tableEdits.generation !== workspaceGeneration || tableEdits.stale !== workspaceStale) return false;
    return !recovery.locked || applyRecovery.authorizeRead(recovery, { target: getRecordContext().target, connectionVersion: getRecordContext().connectionVersion });
  }

  function canReload(selectedFilterOwner?: TableSelectedFilterLease, guard?: () => boolean) {
    if (!confirmPageReload(guard)) return false;
    if (!applyRecovery.locked) tableEdits.clear();
    // 普通翻页／排序／条件操作在排队渲染前撤销旧提案；仅本提案自身留给确认后二次核验。
    if (!selectedFilterOwner && selectedFilterRef.current) selectedFilterRef.current.invalid = true;
    recordPages.cancel(); record.reset(); return true;
  }
  /** 可写工作区先按明确按钮暂存本条，再保留整页；只读页继续沿原无草稿导航。 */
  function navigateRecordPage(direction: -1 | 1) {
    const retained = !!tableEdits.selected && tableEdits.selected.rows === rowsRef.current && !restoredDraftView;
    if (retained && !pageNavigationCurrent()) return;
    if (retained && record.hasInput() && !record.stage()) return;
    const result = recordPages.begin(getRecordPageContext(), { rows: rowsRef.current, rowId: record.draft?.rowId, key: selectionRef.current?.key ?? visibleKeys[0] ?? info?.columns[0]?.name ?? '', direction, hasMore: !!page?.hasMore, busy: blockedRef.current || showPreferences || !!document.querySelector('[role="dialog"]') || referenceCount.current > 0, inputDirty: record.hasInput() || !!rootElement.current?.querySelector('.grid-input'), keepDrafts: retained });
    if (result.kind !== 'ready') {
      if (result.kind !== 'busy') setRecordPageMessage({ revision: recordPages.revision, text: result.kind === 'dirty' ? recordViewZh.pageDirty : recordViewZh.pageUnavailable });
      return;
    }
    if (retained) {
      try { if (retainAndNavigate(result.ticket.page, true)) { setRecordPageMessage({ revision: result.ticket.action, text: formatText(recordViewZh.pageLoading, result.ticket.page) }); return; } } catch (reason) { recordPages.cancel(); setError(errorMessage(reason)); return; }
    }
    // 同步锁住连点并清除旧页展示；真正读取仍由原 pageIndex -> load 流程负责一次。
    blockedRef.current = true; setBusy(true); record.reset(); setPage(null); setRows([], 'replace'); setSelectedRows(new Set()); selectionRef.current = undefined; setSelection(undefined);
    setRecordPageMessage({ revision: result.ticket.action, text: formatText(recordViewZh.pageLoading, result.ticket.page) }); setPageIndex(result.ticket.page);
  }
  // 新页DOM提交后、绘制前选中目标，避免反向跨页先展示网格默认首行。
  useLayoutEffect(() => {
    const target = recordPages.consume(getRecordPageContext(), rowsRef.current, record.hasInput(), blocked);
    if (target) { const key = visibleKeys.includes(target.key) ? target.key : visibleKeys[0]; if (key) jumpToMatch(target.rowId, key, false); }
  }, [page, rows, blocked, record.formOpen, connectionVersion, settings.activeTabId, visibleKeys]);
  const references = info && selection ? referencesForColumn(info, selection.key) : { keys: [], error: '' };
  const relatedKeys = references.keys;
  const referenceRow = rows.find(row => row.id === selection?.rowId);
  const copyMetadataReason = recordCopyMetadataReason(getRecordContext(), copyPage.current, copySources.current?.source);
  const copySourceReady = !copyMetadataReason && recordCopySourceReady(getRecordContext(), referenceRow, copySources.current?.source, referenceRow ? copyRowRefs.current.get(referenceRow.id) : undefined);
  /** 捕获整行草稿及页面代次，多外键在关联窗口内明确选择约束。 */
  function openReference(mode: 'choose' | 'browse', hit?: { row: DraftRow; key: string }) {
    if (blockedRef.current || referenceDialog || !info) return;
    if (record.hasInput()) { setError(recordViewZh.resolveInput); return; }
    const row = hit?.row ?? rowsRef.current.find(item => item.id === selection?.rowId);
    const keys = hit ? cellReferenceKeys(hit.row, hit.key) : relatedKeys;
    if (!row || row.deleted || !keys.length || (mode === 'choose' && !keys.some(key => referenceWritable(info, key)))) return;
    // 候选回读期间窗口本身会占用表页。只核对命中行、布局和表页身份，不把自己的读取算作过期。
    const cellCurrent = hit ? () => tableTabCurrent(true) && sortScopeRef.current === sortScope
      && layoutRevision.current === headerCopyLayoutRevision && rowsRef.current.includes(hit.row) && !activeGridEditor.current : undefined;
    setReferenceDialog({ mode, column: hit?.key, cellCurrent, keys: structuredClone(keys), snapshot: {
      rowId: row.id, data: structuredClone(row.data), foreignKey: structuredClone(keys[0]), source: structuredClone(info), generation: loadGeneration.current,
    } });
  }
  const openCellReference = useRef(openReference); openCellReference.current = openReference;
  /** 父→子入口不依赖所选字段的正向外键，也不提交或清除已暂存父表草稿。 */
  function openChildReferences() {
    if (tableReadAction.current !== tableReadRender || blockedRef.current || childReferenceIntent.current || !connection || info?.objectKind !== 'table' || !page || !selectionRef.current || externalStale || gridEditing || record.hasInput() || document.querySelector('[role="dialog"]')) return;
    const row = rowsRef.current.find(item => item.id === selectionRef.current!.rowId);
    if (!row || row.deleted || row.inserted) return;
    const source = info, originalPage = page, originalRows = rowsRef.current, generation = loadGeneration.current, version = connectionVersion, profile = connection;
    const currentTab = JSON.stringify(useWorkspace.getState().settings.tabs.find(item => item.id === tab.id));
    let intent: ChildReferenceIntent;
    intent = new ChildReferenceIntent(source, row.id, row.data, childReferenceValues, () => {
      const state = useWorkspace.getState(), currentRow = rowsRef.current.find(item => item.id === row.id);
      return mounted.current && childReferenceIntent.current === intent && state.settings.activeTabId === tab.id && JSON.stringify(state.settings.tabs.find(item => item.id === tab.id)) === currentTab && state.connections.find(item => item.id === tab.connectionId) === profile && (state.connectionVersions[tab.connectionId] ?? 0) === version && recordContextRef.current.info === source && loadGeneration.current === generation && rowsRef.current === originalRows && currentRow === row && !row.deleted && selectionRef.current?.rowId === row.id && !recordControllerRef.current?.hasInput() && !activeGridEditor.current && JSON.stringify(source) === JSON.stringify(intent.source) && JSON.stringify(row.data) === JSON.stringify(intent.data) && recordPageSource.current === originalPage;
    });
    childReferenceIntent.current = intent; batchFillIntent.current?.invalidate(); recordBatchIntent.current?.invalidate(); presetUiEpoch.current++; setChildReferenceDialog(intent);
  }
  const recordPageSource = useRef(page); recordPageSource.current = page;
  /** 对话框只有原请求实际结算后才关闭，旧实例不能关闭后来的关联窗口。 */
  function closeChildReferences(intent: ChildReferenceIntent) { if (childReferenceIntent.current !== intent) return; intent.invalidate(); childReferenceIntent.current = null; presetUiEpoch.current++; setChildReferenceDialog(null); }
  const statisticsAvailable = !blocked && !!connection && !!info && ['table', 'view'].includes(info.objectKind ?? '') && !!page && !externalStale && !gridEditing && !record.hasInput();
  const loadedCountPage = filteredSelectPage.current;
  const countPageAvailable = !!loadedCountPage && loadedCountPage.page === page && loadedCountPage.generation === loadGeneration.current && !restoredDraftView;
  const visiblePageCount = pageCount && countPageAvailable && pageCount.generation === loadGeneration.current && pageCount.refreshVersion === refreshVersion && !externalStale ? pageCount.count : undefined;
  /** 统计不要求活动行；冻结服务器筛选且保留本地草稿，表和视图均使用同一只读入口。 */
  function openTableStatistics(countOnly = false) {
    if (tableReadAction.current !== tableReadRender || blockedRef.current || tableStatisticsIntent.current || !statisticsAvailable || !connection || !info || !page || activeGridEditor.current || useWorkspace.getState().settings.activeTabId !== tab.id || document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
    if (countOnly && (!countPageAvailable || filteredSelectPage.current !== loadedCountPage || loadedCountPage.scope !== getRecordPageContext().scope)) return;
    const source = info, originalPage = page, originalRows = rowsRef.current, originalSelection = selectionRef.current, generation = loadGeneration.current, version = connectionVersion, profile = connection;
    const currentTab = JSON.stringify(useWorkspace.getState().settings.tabs.find(item => item.id === tab.id));
    let intent: TableStatisticsIntent;
    intent = new TableStatisticsIntent(source, statisticsConditions.current, childReferenceValues, () => {
      const state = useWorkspace.getState();
      return mounted.current && tableStatisticsIntent.current === intent && state.settings.activeTabId === tab.id && JSON.stringify(state.settings.tabs.find(item => item.id === tab.id)) === currentTab && state.connections.find(item => item.id === tab.connectionId) === profile && (state.connectionVersions[tab.connectionId] ?? 0) === version && recordContextRef.current.info === source && loadGeneration.current === generation && rowsRef.current === originalRows && selectionRef.current === originalSelection && recordPageSource.current === originalPage && !recordControllerRef.current?.hasInput() && !activeGridEditor.current && JSON.stringify(source) === JSON.stringify(intent.source) && JSON.stringify(statisticsConditions.current) === JSON.stringify(intent.conditions);
    });
    // 仅快速计数回填原页；新读取代次、换页和外部结构刷新都会隐藏旧计数。
    const onCount = countOnly ? (count: string) => {
      if (intent.current()) setPageCount({ generation, refreshVersion, count });
    } : undefined;
    tableStatisticsIntent.current = intent; batchFillIntent.current?.invalidate(); recordBatchIntent.current?.invalidate(); presetUiEpoch.current++; setTableStatisticsDialog({ intent, onCount });
  }
  /** 原窗口原任务结算后才关闭；旧关闭回调不能关闭后续统计实例。 */
  function closeTableStatistics(intent: TableStatisticsIntent) { if (tableStatisticsIntent.current !== intent) return; intent.invalidate(); tableStatisticsIntent.current = null; presetUiEpoch.current++; setTableStatisticsDialog(null); }
  /** 关系图只捕获原结构与连接；自己的读取计数不撤销自身，也不访问父表的数据行。 */
  function openRelationshipDiagram() {
    if (tableReadAction.current !== tableReadRender || blockedRef.current || relationshipRef.current || !connection || info?.objectKind !== 'table' || externalStale || gridEditing || record.hasInput() || useWorkspace.getState().settings.activeTabId !== tab.id || document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
    const source = info, profile = connection, version = connectionVersion, generation = loadGeneration.current, originalTab = useWorkspace.getState().settings.tabs.find(item => item.id === tab.id);
    const owner: { source: TableInfo; current(): boolean } = { source, current() { const state = useWorkspace.getState(); return mounted.current && relationshipRef.current === owner && state.settings.activeTabId === tab.id && state.settings.tabs.find(item => item.id === tab.id) === originalTab && state.connections.find(item => item.id === tab.connectionId) === profile && (state.connectionVersions[tab.connectionId] ?? 0) === version && recordContextRef.current.info === source && loadGeneration.current === generation && !recordControllerRef.current?.hasInput() && !activeGridEditor.current; } };
    relationshipRef.current = owner; presetUiEpoch.current++; setRelationshipDialog(owner);
  }
  /** 候选绑定原页、原条件和连接；读取不碰父草稿，也不要求活动行。 */
  function openTableValueOptions() {
    if (tableReadAction.current !== tableReadRender || blockedRef.current || tableValueOptionsIntent.current || !connection || !info || !['table', 'view'].includes(info.objectKind ?? '') || !page || externalStale || gridEditing || record.hasInput() || document.querySelector('[role="dialog"]') || useWorkspace.getState().settings.activeTabId !== tab.id) return;
    const column = info.columns.find(item => item.name === selectionRef.current?.key && tableValueOptionsColumnCapability(item.type) !== 'unsupported') ?? info.columns.find(item => tableValueOptionsColumnCapability(item.type) !== 'unsupported');
    if (!column) return;
    const source = info, originalPage = page, originalRows = rowsRef.current, originalSelection = selectionRef.current, generation = loadGeneration.current, version = connectionVersion, profile = connection;
    const currentTab = JSON.stringify(useWorkspace.getState().settings.tabs.find(item => item.id === tab.id));
    let intent: TableStatisticsIntent;
    intent = new TableStatisticsIntent(source, statisticsConditions.current, childReferenceValues, () => {
      const state = useWorkspace.getState();
      return mounted.current && tableValueOptionsIntent.current === intent && state.settings.activeTabId === tab.id && JSON.stringify(state.settings.tabs.find(item => item.id === tab.id)) === currentTab && state.connections.find(item => item.id === tab.connectionId) === profile && (state.connectionVersions[tab.connectionId] ?? 0) === version && recordContextRef.current.info === source && loadGeneration.current === generation && rowsRef.current === originalRows && selectionRef.current === originalSelection && recordPageSource.current === originalPage && !recordControllerRef.current?.hasInput() && !activeGridEditor.current && JSON.stringify(source) === JSON.stringify(intent.source) && JSON.stringify(statisticsConditions.current) === JSON.stringify(intent.conditions);
    });
    tableValueOptionsIntent.current = intent; batchFillIntent.current?.invalidate(); recordBatchIntent.current?.invalidate(); presetUiEpoch.current++; setTableValueOptionsDialog({ intent, column: column.name });
  }
  /** 原读取结算后的关闭只处理自己的窗口，不释放后继实例。 */
  function closeTableValueOptions(intent: TableStatisticsIntent) {
    if (tableValueOptionsIntent.current !== intent) return;
    intent.invalidate(); tableValueOptionsIntent.current = null; presetUiEpoch.current++; setTableValueOptionsDialog(null);
  }
  /** 只为自己唯一的空闲模态放行丢稿确认，其他作业、弹窗或新页均拒绝。 */
  function valueOptionsReloadReady(intent: TableStatisticsIntent, modal: Element): boolean {
    const body = document.querySelector('[data-table-value-options-dialog]');
    return tableValueOptionsIntent.current === intent && intent.current() && body?.closest('[role="dialog"]') === modal && document.querySelectorAll('[role="dialog"]').length === 1 && !document.querySelector('[role="alertdialog"]') && !busy && !referenceBusy && !referenceCount.current && !childReferenceDialog && !tableStatisticsDialog && !applyingRef.current && !preferencesPending && !preferencesLock.current && !previewingRef.current && !preview && !copyPendingRef.current && !showPreferences && !referenceDialog && !externalStale;
  }
  /** 确认后一次接纳整份服务器条件，保持原排序；重置输入放在最终来源门之后。 */
  function applyTableValueOptions(intent: TableStatisticsIntent, conditions: TableValueOptionsConditions): boolean {
    const modal = document.querySelector('[data-table-value-options-dialog]')?.closest('[role="dialog"]');
    if (!modal || !valueOptionsReloadReady(intent, modal) || !info) return false;
    const next = validateTablePresetColumns({ filters: [...conditions.filters], filterMode: conditions.filterMode, ...(conditions.filterGroup ? { filterGroup: conditions.filterGroup } : {}), sort }, info.columns.map(column => column.name));
    if (!confirmPageReload(() => valueOptionsReloadReady(intent, modal))) return false;
    // 无await，先消费原实例再改变条件；reset的失效通知不再撤销已接纳的同一份筛选。
    closeTableValueOptions(intent); setFilters(next.filters); setFilterMode(next.filterMode); setFilterGroup(next.filterGroup); setPageIndex(1); setShowFilter(true);
    recordPages.cancel(); record.reset(); return true;
  }
  /** 请求已关闭窗口后仍占用标签，直到服务器请求实际结束才释放。 */
  const referenceActivity = useCallback((delta: 1 | -1) => {
    presetUiEpoch.current++;
    referenceCount.current = Math.max(0, referenceCount.current + delta); setReferenceBusy(referenceCount.current > 0);
    useWorkspace.getState().setBusy(tab.id, loadingCount.current > 0 || referenceCount.current > 0 || applyingRef.current || preferencesLock.current || copyPendingRef.current);
  }, [tab.id]);
  /** 使用最新行状态一次写入完整外键草稿，不更改 original 或调用提交。 */
  function applyReference(values: CellValue[], source: TableInfo, key: ForeignKeyInfo, expected: ForeignKeyInfo, clear: boolean) {
    if (record.hasInput()) throw new Error(recordViewZh.resolveInput);
    const readonly = recordReadonlyReason({ ...getRecordContext(), busy: false }); if (readonly) throw new Error(readonly);
    if (!referenceDialog || applyingRef.current || referenceDialog.cellCurrent?.() === false) throw new Error(referenceZh.changed);
    const next = patchReferenceRow(rowsRef.current, { ...referenceDialog.snapshot, foreignKey: expected }, loadGeneration.current, source, key, values, clear);
    setRows(next); setError('');
  }
  /** 条件变更始终从第一页读取，取消草稿确认时不更改任何已应用条件。 */
  const presetApplyScope=useRef<{base:typeof base;connectionVersion:number;refreshVersion:number;info:TableInfo;rows:DraftRow[];generation:number;uiEpoch:number;layoutRevision:number;dialogs:ReturnType<typeof createPresetDialogGuard>}|null>(null);
  useEffect(()=>()=>{presetApplyScope.current?.dialogs.dispose();presetApplyScope.current=null;namedLayout.current?.finish(false);namedLayout.current=undefined;},[]);
  /** 先沿原丢稿确认入口授权读取；记录原页对象，晚回包不能清掉后来新增的编辑。 */
  function preparePresetApply():boolean {
    presetApplyScope.current?.dialogs.dispose();presetApplyScope.current=null;
    if(!info||externalStale||activeGridEditor.current||!canReload())return false;
    presetApplyScope.current={base,connectionVersion,refreshVersion,info,rows:rowsRef.current,generation:loadGeneration.current,uiEpoch:presetUiEpoch.current,layoutRevision:layoutRevision.current,dialogs:createPresetDialogGuard(document)};return true;
  }
  /** 整份恢复条件、组合和排序，只触发现有表页读取，不调用写SQL或改动草稿历史。 */
  function applyNamedPreset(configuration:TablePresetConfiguration):boolean | Promise<boolean> {
    const original=presetApplyScope.current;presetApplyScope.current=null;
    if(!original)return false;
    const dialogsCurrent=original.dialogs.current();original.dialogs.dispose();
    // 晚回包只做无副作用检查；不重调会确认丢稿/清输入的canReload，不清后来窗口。
    if(!dialogsCurrent||original.uiEpoch!==presetUiEpoch.current||reloadBlocked())return false;
    if(!mounted.current||!original||original.base!==base||original.connectionVersion!==connectionVersion||original.refreshVersion!==refreshVersion||original.info!==info||original.rows!==rowsRef.current||original.generation!==loadGeneration.current||blockedRef.current||externalStale||record.hasInput()||activeGridEditor.current)return false;
    const next=validateTablePresetColumns(configuration,info!.columns.map(column=>column.name));
    let applied: boolean | Promise<boolean> = true;
    if (next.layout) {
      if (original.layoutRevision !== layoutRevision.current || preferencesLoading) return false;
      const layout = next.layout;
      const scope = recordPageScope({ target: base, connectionVersion, refreshVersion, pageSize, ...next });
      namedLayout.current?.finish(false);
      applied = new Promise<boolean>(finish => { namedLayout.current = { configuration: next, layout, scope, revision: original.layoutRevision, finish }; });
    }
    setFilters(next.filters);setFilterMode(next.filterMode);setFilterGroup(next.filterGroup);setSort(next.sort);setPageIndex(1);return applied;
  }
  const canSeedCellFilter = !blocked && !externalStale && !gridEditing && !record.dirty && !record.pending && !changes.length && !!info && !!page;
  let cellFilterAvailable = canSeedCellFilter && !!selection;
  if (cellFilterAvailable) { try { tableCellFilterDraft(info!.columns, rows, visibleKeys, selection); } catch { cellFilterAvailable = false; } }
  /** 快捷入口只预填手工条件；既有添加条件仍负责丢稿确认和服务器分页，不自动查询或提交。 */
  function stageCellFilter(mode: TableCellFilterMode, fromMenu?: { row: DraftRow; key: string }): void {
    const state = useWorkspace.getState(), current = state.settings.tabs.find(item => item.id === tab.id);
    if (tableReadAction.current !== tableReadRender || !mounted.current || !canSeedCellFilter ||
        (fromMenu ? !cellActionCurrent(fromMenu.row) : !cellFilterAvailable || selectionRef.current !== selection) || reloadBlocked() || activeGridEditor.current || record.hasInput() || collectChanges(rowsRef.current).length || state.settings.activeTabId !== tab.id || current?.connectionId !== tab.connectionId || current?.database !== tab.database || current?.table !== tab.table || (state.connectionVersions[tab.connectionId] ?? 0) !== connectionVersion) return;
    try { setCellFilterSeed(tableCellFilterDraft(info!.columns, rowsRef.current, visibleKeys, fromMenu ? { rowId: fromMenu.row.id, key: fromMenu.key } : selection, mode)); setShowFilter(true); }
    catch (reason) { setError(errorMessage(reason)); }
  }
  const stageMenuCellFilter = useRef(stageCellFilter); stageMenuCellFilter.current = stageCellFilter;
  /** 只预填准确当前查找的条件，原分页和未提交草稿沿用已有添加条件流程。 */
  function stageFindFilter(rule: FilterRule, generation: number): void {
    if (!showFind || !tableToolbarCurrent() || tableReadAction.current !== tableReadRender || pageFindGeneration() !== generation ||
        reloadBlocked() || activeGridEditor.current || record.hasInput() || filterGroups) return;
    setCellFilterSeed(filterDraftFromRule(rule));
    setShowFilter(true);
  }
  const selectedFilterReady = !blocked && !externalStale && !gridEditing && !record.dirty && !record.pending && !!info && !!page && !selectedFilter;
  const selectedFilterAvailable = selectedFilterReady && !!selection && visibleKeys.includes(selection.key) && selectedRows.size > 0;
  /** 冻结当前列的原勾选或单列选区及旧条件；预览不确认丢稿，也不读取服务器。 */
  function openSelectedFilter(exclude: boolean, target = selection, ids = selectedRows, rangeCurrent?: () => boolean): void {
    const state = useWorkspace.getState();
    if (tableReadAction.current !== tableReadRender || !selectedFilterReady || !target || !ids.size || selectedFilterRef.current ||
        (rangeCurrent ? !rangeCurrent() : selectionRef.current !== target || selectedRowsRef.current !== ids) ||
        reloadBlocked() || activeGridEditor.current || record.hasInput() || state.settings.activeTabId !== tab.id ||
        state.connections.find(item => item.id === tab.connectionId) !== connection || (state.connectionVersions[tab.connectionId] ?? 0) !== connectionVersion) return;
    try {
      const proposal = buildTableSelectedFilter({ columns: info!.columns, rows: rowsRef.current, visible: visibleKeys, selection: target, selected: ids, conditions: statisticsConditions.current, exclude });
      presetUiEpoch.current++;
      const lease: TableSelectedFilterLease = { proposal, fingerprint: JSON.stringify(proposal), metadata: tableCopyMetadataKey(info!), scope: sortScope, rows: rowsRef.current, selected: ids, selection: target, rangeCurrent, generation: loadGeneration.current, layout: layoutRevision.current, epoch: presetUiEpoch.current, profile: connection, tab: JSON.stringify(state.settings.tabs.find(item => item.id === tab.id)), invalid: false, dialogs: createPresetDialogGuard(document) };
      selectedFilterRef.current = lease; setSelectedFilter(lease); setError('');
    } catch (reason) { setError(errorMessage(reason)); }
  }
  const openRangeFilter = useRef<TableRangeFilter<DraftRow>['members']>(() => {});
  openRangeFilter.current = (range, exclude, current) => {
    openSelectedFilter(exclude, { rowId: range.rows[0].id, key: range.keys[0] }, new Set(range.rows.map(row => row.id)), current);
  };
  /** 双格与勾选复用相同的原页、原行和草稿门槛。 */
  function captureBounds(first: DraftRow, last: DraftRow, key: string, gridCurrent: () => boolean) {
    if (!info || !canSeedCellFilter) return;
    // 打开菜单会重渲染本组件；绑定网格快照和表页租约，允许菜单本身的重渲染。
    const current = () => gridCurrent() && !externalStaleRef.current && !reloadBlocked() &&
      !collectChanges(rowsRef.current).length && cellActionCurrent(first) && cellActionCurrent(last);
    return captureTableRangeBounds(() => tableRangeFilterDraft(info.columns, rowsRef.current, visibleKeys, key, first, last), current,
      (draft, outside) => {
        setCellFilterSeed({ ...draft, operator: outside ? 'NOT BETWEEN' : 'BETWEEN' });
        setShowFilter(true);
        setError('');
      });
  }
  function captureRangeBounds(range: GridRangeTarget<DraftRow>, gridCurrent: () => boolean) {
    return captureBounds(range.rows[0], range.rows[1], range.keys[0], gridCurrent);
  }
  /** 活动格只确定字段；端点严格来自本页两个勾选 ID，旧工具栏动作不能消费新勾选。 */
  function stageCheckedBounds(outside: boolean): void {
    if (!selection || selectedRows.size !== 2 || !selectedFilterAvailable) return;
    const current = () => selectionRef.current === selection && selectedRowsRef.current === selectedRows;
    if (!current()) return;
    const [first, last] = rows.filter(row => selectedRows.has(row.id));
    const stage = first && last && captureBounds(first, last, selection.key, current);
    if (stage) stage(outside);
    else if (current()) setError(selectedFilterText.checkedBoundsUnavailable);
  }
  /** 页、列、原值、勾选或连接变化即永久失效；原提案不能借后来相同值恢复授权。 */
  function selectedFilterCurrent(lease: TableSelectedFilterLease): boolean {
    let valid = false;
    try {
      const state = useWorkspace.getState();
      const selectionCurrent = lease.rangeCurrent ? lease.rangeCurrent() : selectedRowsRef.current === lease.selected && selectionRef.current === lease.selection;
      valid = mounted.current && selectedFilterRef.current === lease && !lease.invalid && lease.scope === sortScopeRef.current && rowsRef.current === lease.rows && selectionCurrent && loadGeneration.current === lease.generation && layoutRevision.current === lease.layout && presetUiEpoch.current === lease.epoch && state.settings.activeTabId === tab.id && JSON.stringify(state.settings.tabs.find(item => item.id === tab.id)) === lease.tab && state.connections.find(item => item.id === tab.connectionId) === lease.profile && (state.connectionVersions[tab.connectionId] ?? 0) === connectionVersion && !!info && tableCopyMetadataKey(info) === lease.metadata && !recordControllerRef.current?.hasInput() && !activeGridEditor.current && !externalStale && !reloadBlocked() && lease.dialogs.current();
      if (valid) valid = JSON.stringify(buildTableSelectedFilter({ columns: info!.columns, rows: rowsRef.current, visible: visibleKeys, selection: lease.selection, selected: lease.selected, conditions: statisticsConditions.current, exclude: lease.proposal.exclude })) === lease.fingerprint;
    } catch {}
    if (!valid) lease.invalid = true;
    return valid;
  }
  /** 完整条件与原排序一次发布；沿原丢稿确认，取消时保留面板、草稿及当前页。 */
  function applySelectedFilter(lease: TableSelectedFilterLease): boolean {
    if (!selectedFilterCurrent(lease)) throw Error(selectedFilterText.unavailable);
    const next = validateTablePresetColumns({ filters: lease.proposal.filters, filterMode: lease.proposal.filterMode, filterGroup: lease.proposal.filterGroup, sort }, info!.columns.map(column => column.name));
    if (!canReload(lease, () => selectedFilterCurrent(lease))) return false;
    if (!selectedFilterCurrent(lease)) throw Error(selectedFilterText.unavailable);
    closeSelectedFilter(lease); setFilters(next.filters); setFilterMode(next.filterMode); setFilterGroup(next.filterGroup); setPageIndex(1); setShowFilter(true); return true;
  }
  /** 只关闭本次预览，迟到的旧取消不触及后继勾选值提案。 */
  function closeSelectedFilter(lease: TableSelectedFilterLease): void {
    if (selectedFilterRef.current !== lease) return;
    lease.invalid = true; lease.dialogs.dispose(); selectedFilterRef.current = null; presetUiEpoch.current++; setSelectedFilter(null);
  }
  const pageExportAvailable = !restoredDraftView && !blocked && !preferencesLoading && !externalStale && !gridEditing && !record.dirty && !record.pending && !changes.length && !!info && !!page && !!visibleKeys.length;
  // 只观察来源变更；本窗口自己的忙态不改变原数据来源，也不能借此豁免其它作业。
  const rowTransferValues = [...filteredExportValues, selectedRows, visibleKeys, layoutRevision.current, record.dirty, record.pending, gridEditing, restoredDraftView];
  if (rowTransferValues.length !== rowTransferEnvironment.current.length || rowTransferValues.some((value, index) => value !== rowTransferEnvironment.current[index])) {
    rowTransferIntent.current?.invalidate(); rowTransferEnvironment.current = rowTransferValues;
  }
  const rowTransferAvailable = pageExportAvailable && !!connection && selectedRows.size > 0 && filteredUpdateReadReady();
  const incomingTransferAvailable = pageExportAvailable && !!networkQueryTransferSource(incomingQuery) &&
    (connection?.dialect === 'mysql' || connection?.dialect === 'mariadb') &&
    info?.objectKind === 'table' && info.engine?.toUpperCase() === 'INNODB' && filteredUpdateReadReady();
  /** 原页勾选只冻结一次；空选择、旧页或任何草稿都不能回退为整表/整页写入。 */
  function openRowTransfer(snapshot?: PostgresRecordTransfer): void {
    const source = filteredSelectPage.current, state = useWorkspace.getState();
    if (tableReadAction.current !== tableReadRender || !(snapshot ? incomingTransferAvailable && readIncomingQuery?.() === snapshot : rowTransferAvailable) || rowTransferSource.current || !filteredUpdateReadReady(source) || reloadBlocked() || activeGridEditor.current || record.hasInput() || collectChanges(rowsRef.current).length || state.settings.tabs.find(item => item.id === tab.id) !== tab || state.activeJobs[tab.id] || state.connections.find(item => item.id === tab.connectionId) !== connection) return;
    const token = {}, originalRows = rowsRef.current, originalSelected = selectedRowsRef.current, profile = connection, version = connectionVersion, layout = layoutRevision.current, environment = rowTransferEnvironment.current, owner = uid();
    rowTransferSource.current = token;
    try {
      const current = () => {
        const now = useWorkspace.getState(), own = rowTransferBusy.current, dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"]');
        return mounted.current && rowTransferSource.current === token && rowTransferEnvironment.current === environment && filteredUpdateReadReady(source)
          && now.settings.activeTabId === tab.id && now.settings.tabs.find(item => item.id === tab.id) === tab
          && now.connections.find(item => item.id === tab.connectionId) === profile && (now.connectionVersions[tab.connectionId] ?? 0) === version
          && rowsRef.current === originalRows && selectedRowsRef.current === originalSelected && layoutRevision.current === layout
          && !activeGridEditor.current && !recordControllerRef.current?.hasInput() && !collectChanges(rowsRef.current).length
          && !preferencesLock.current && !loadingCount.current && !applyingRef.current && !previewingRef.current && !copyPendingRef.current
          && (!snapshot || readIncomingQuery?.() === snapshot)
          && (!now.activeJobs[tab.id] || !!own?.acquiring || !!own?.lease?.owns())
          && (dialogs.length === 0 || dialogs.length === 1 && !!dialogs[0].querySelector(`[data-result-insert-owner="${owner}"]`));
      };
      let intent: ResultInsertSourceIntent;
      if (snapshot) {
        const from = networkQueryTransferSource(snapshot);
        if (!from || !connection) throw Error(resultInsertText.invalid);
        const { data, textOnly } = networkQueryTransferData(snapshot);
        intent = new ResultInsertSourceIntent(data, true, owner, current);
        incomingTransfer.current = { snapshot, committed: false, fixed: { target: base, connectionName: connection.name, textOnly,
          sourceLabel: resultInsertText.transferSource(from.dialect === 'sqlite' ? 'SQLite' : 'PostgreSQL', from.label, from.database, from.title, from.result) } };
      } else intent = createTableRowTransfer(source.page, originalRows, visibleKeys, originalSelected, owner, current);
      rowTransferIntent.current = intent; insertCopyBlockedRef.current = true; blockedRef.current = true; setRowTransferDialog(intent); setError('');
    } catch (reason) { if (rowTransferSource.current === token) rowTransferSource.current = null; setError(errorMessage(reason)); }
  }
  /** 仅本次operation可持有自己的busy世代；旧释放不能清除后继工作区作业。 */
  const rowTransferActivity = useCallback((delta: 1 | -1) => {
    if (delta === 1) {
      if (rowTransferBusy.current || referenceCount.current || useWorkspace.getState().activeJobs[tab.id]) throw Error(rowTransferText.hint);
      const own = { lease: undefined as WorkspaceBusyLease | undefined, acquiring: true, releasing: false }; rowTransferBusy.current = own;
      try { own.lease = acquireWorkspaceBusy(tab.id); referenceCount.current++; setReferenceBusy(true); }
      catch (reason) { rowTransferBusy.current = null; rowTransferIntent.current?.invalidate(); throw reason; }
      finally { own.acquiring = false; }
    } else {
      const own = rowTransferBusy.current; if (!own) return; own.releasing = true;
      if (!own.lease?.release()) rowTransferIntent.current?.invalidate();
      if (rowTransferBusy.current === own) rowTransferBusy.current = null;
      referenceCount.current = Math.max(0, referenceCount.current - 1); if (mounted.current) setReferenceBusy(referenceCount.current > 0);
    }
  }, [tab.id]);
  /** 原预览和取消收尾结束后才关闭；保留源页、勾选和其它标签，不自动刷新或提交。 */
  function closeRowTransfer(intent: ResultInsertSourceIntent): void {
    if (rowTransferIntent.current !== intent) return;
    const incoming = incomingTransfer.current, refresh = incoming?.committed && intent.current();
    incomingTransfer.current = null;
    intent.invalidate(); rowTransferIntent.current = null; rowTransferSource.current = null; setRowTransferDialog(null);
    if (incoming?.committed) consumeIncomingQuery?.(incoming.snapshot);
    if (refresh) { tableEdits.clear(); void load(); }
  }
  const filteredExportAvailable = !restoredDraftView && !blocked && !externalStale && !gridEditing && !record.hasInput() && !preferencesPending && !!connection && !!info && !!page && ['table', 'view'].includes(info.objectKind ?? '');
  /** 独立全量入口冻结已应用服务器条件和原页身份，保留本地数据草稿，不借用当前页样本。 */
  function openFilteredExport(): void {
    const state = useWorkspace.getState();
    if (tableReadAction.current !== tableReadRender || !filteredExportAvailable || filteredExportIntent.current || !info || !page || !connection || reloadBlocked() || activeGridEditor.current || record.hasInput() || state.settings.activeTabId !== tab.id) return;
    const source = info, originalRows = rowsRef.current, originalPage = page, generation = loadGeneration.current, profile = connection, version = connectionVersion, scope = sortScopeRef.current;
    const currentTab = JSON.stringify(state.settings.tabs.find(item => item.id === tab.id));
    let intent: TableFilteredExportIntent;
    try {
      intent = new TableFilteredExportIntent(base, source, statisticsConditions.current, sort, filteredExportValues, () => {
        const now = useWorkspace.getState(), dialogs = document.querySelectorAll('[role="dialog"]');
        return mounted.current && filteredExportIntent.current === intent && now.settings.activeTabId === tab.id && JSON.stringify(now.settings.tabs.find(item => item.id === tab.id)) === currentTab && now.connections.find(item => item.id === tab.connectionId) === profile && (now.connectionVersions[tab.connectionId] ?? 0) === version && recordContextRef.current.info === source && rowsRef.current === originalRows && recordPageSource.current === originalPage && loadGeneration.current === generation && sortScopeRef.current === scope && !recordControllerRef.current?.hasInput() && !activeGridEditor.current && !externalStale && !preferencesLock.current && dialogs.length <= 1 && !document.querySelector('[role="alertdialog"]') && JSON.stringify(source) === JSON.stringify(intent.source) && JSON.stringify(statisticsConditions.current) === JSON.stringify(intent.conditions);
      });
      filteredExportIntent.current = intent; batchFillIntent.current?.invalidate(); recordBatchIntent.current?.invalidate(); presetUiEpoch.current++; setFilteredExportDialog(intent);
    } catch (reason) { setError(errorMessage(reason)); }
  }
  /** 只有原文件选择/导出及取消均结算后的关闭，才能释放自己的窗口。 */
  function closeFilteredExport(intent: TableFilteredExportIntent): void {
    if (filteredExportIntent.current !== intent) return;
    intent.invalidate(); filteredExportIntent.current = null; presetUiEpoch.current++; setFilteredExportDialog(null);
  }
  /** 任何导出都必须属于准确活动表页；勾选、编辑器或连接变化后拒绝旧回调。 */
  function pageExportCurrent(): boolean {
    return pageExportAvailable && !pageExportRef.current && tableToolbarCurrent() &&
      tableReadAction.current === tableReadRender && !preferencesLock.current && !reloadBlocked() &&
      !activeGridEditor.current && !record.hasInput() && rowsRef.current === rows &&
      !collectChanges(rowsRef.current).length && selectedRowsRef.current === selectedRows;
  }

  function exportTablePage(selected: boolean): void {
    if (!page || !pageExportCurrent()) return;
    try { const lease = { data: snapshotTablePageExport(page, rows, visibleKeys, selected ? selectedRows : undefined), selected }; pageExportRef.current = lease; setSelectedRows(new Set()); setPageExport(lease); }
    catch (reason) { setError(errorMessage(reason)); }
  }

  function checkedExportCurrent(): boolean {
    return pageExportCurrent() && checkedExport.current() && filteredSelectReadReady();
  }

  function collectCheckedPage(): void {
    if (!page || !checkedExportCurrent()) return;
    try {
      const snapshot = selectedRows.size ? snapshotTablePageExport(page, rows, visibleKeys, selectedRows) : undefined;
      checkedExport.replace(page.page, snapshot);
      setError('');
    } catch (reason) { setError(errorMessage(reason)); }
  }

  function exportCollectedPages(): void {
    const collection = checkedExport.value;
    if (!collection || !checkedExportCurrent()) return;
    const lease = { data: collection.result, selected: true, scope: 'collected' as const };
    pageExportRef.current = lease;
    setPageExport(lease);
  }

  /** 同步比对实际已完成读取的来源，覆盖新条件已渲染但加载effect尚未开始的窗口。 */
  function filteredSelectReadReady(source = filteredSelectPage.current): source is TableFilteredSelectPage {
    if (!source || source !== filteredSelectPage.current || !mounted.current || filteredSelectView.current.unavailable) return false;
    const context = getRecordPageContext(), current = filteredSelectView.current;
    try { return context.active && !context.stale && context.scope === source.scope && context.page === source.index && context.generation === source.generation && current.info === source.info && current.page === source.page && source.info.database === base.database && source.info.name === base.table && (source.page.copyMetadataKey === undefined || source.page.copyMetadataKey === tableCopyMetadataKey(source.info)); } catch { return false; }
  }
  const filteredSelectAvailable = !restoredDraftView && !!onOpenGeneratedQuery && !!connection && !blocked && !gridEditing && !record.hasInput() && (connection.dialect === 'mysql' || connection.dialect === 'mariadb') && filteredSelectReadReady();
  /** 独立修改租约只核已完成读取的准确scope，自身任务占用不能被误判成外来加载。 */
  function filteredUpdateReadReady(source = filteredSelectPage.current): source is TableFilteredSelectPage {
    if (!source || source !== filteredSelectPage.current || !mounted.current) return false;
    const context=getRecordPageContext(), current=recordContextRef.current;
    try{return context.active&&!context.stale&&context.scope===source.scope&&context.page===source.index&&context.generation===source.generation&&current.info===source.info&&recordPageSource.current===source.page&&source.info.database===base.database&&source.info.name===base.table&&(source.page.copyMetadataKey===undefined||source.page.copyMetadataKey===tableCopyMetadataKey(source.info));}catch{return false;}
  }
  const filteredUpdateAvailable = !restoredDraftView && !!connection && !blocked && !externalStale && !gridEditing && !record.hasInput() && !record.pending && !changes.length && !!info && !!tableFilteredUpdateColumns(info).length && filteredUpdateReadReady();
  /** 开门不询问丢稿、不提交已有稿；全部筛选行与当前页勾选填充是两条独立用途。 */
  function openFilteredUpdate():void {
    const source=filteredSelectPage.current,state=useWorkspace.getState();
    if(tableReadAction.current!==tableReadRender||!filteredUpdateAvailable||filteredUpdateIntent.current||!filteredUpdateReadReady(source)||reloadBlocked()||activeGridEditor.current||record.hasInput()||collectChanges(rowsRef.current).length||state.settings.activeTabId!==tab.id||state.settings.tabs.find(item=>item.id===tab.id)!==tab||state.connections.find(item=>item.id===tab.connectionId)!==connection||(state.connectionVersions[tab.connectionId]??0)!==connectionVersion)return;
    const originalRows=rowsRef.current,originalTab=state.settings.tabs.find(item=>item.id===tab.id),profile=connection,version=connectionVersion,scope=sortScopeRef.current;
    let intent:TableFilteredUpdateIntent;
    try{
      intent=new TableFilteredUpdateIntent(base,source.info,{...statisticsConditions.current,sort:recordPageScopeRef.current.value.sort},filteredUpdateValues,()=>{
        const now=useWorkspace.getState(),dialogs=document.querySelectorAll('[role="dialog"], [role="alertdialog"]');
        return mounted.current&&filteredUpdateIntent.current===intent&&filteredUpdateReadReady(source)&&now.settings.activeTabId===tab.id&&now.settings.tabs.find(item=>item.id===tab.id)===originalTab&&now.connections.find(item=>item.id===tab.connectionId)===profile&&(now.connectionVersions[tab.connectionId]??0)===version&&rowsRef.current===originalRows&&sortScopeRef.current===scope&&!activeGridEditor.current&&!recordControllerRef.current?.hasInput()&&!collectChanges(rowsRef.current).length&&!preferencesLock.current&&!previewingRef.current&&!applyingRef.current&&dialogs.length<=1&&(!dialogs.length||!!dialogs[0].querySelector('[data-table-filtered-update-dialog]'))&&tableCopyMetadataKey(source.info)===intent.metadataKey&&JSON.stringify({...statisticsConditions.current,sort:recordPageScopeRef.current.value.sort})===JSON.stringify(intent.scope);
      });
      filteredUpdateIntent.current=intent;batchFillIntent.current?.invalidate(); recordBatchIntent.current?.invalidate();presetUiEpoch.current++;setFilteredUpdateDialog(intent);setError('');
    }catch(reason){setError(errorMessage(reason));}
  }
  /** 原任务与取消/预览释放均已终结后才到达这里；只在原scope仍有效时刷新原页。 */
  function closeFilteredUpdate(intent:TableFilteredUpdateIntent,result?:TableFilteredUpdateApplyOutput):void {
    if(filteredUpdateIntent.current!==intent)return;
    const refresh=!!result&&result.commitAcknowledged&&result.outcome==='committed'&&intent.current()&&!collectChanges(rowsRef.current).length&&!recordControllerRef.current?.hasInput();
    intent.invalidate();filteredUpdateIntent.current=null;setFilteredUpdateDialog(null);presetUiEpoch.current++;
    if (refresh) { checkedExport.clear(); void load(); }
  }
  function filteredDeleteReadReady(source = filteredSelectPage.current): source is TableFilteredSelectPage {
    if (!source || source !== filteredSelectPage.current || !mounted.current) return false;
    const context=getRecordPageContext(), current=recordContextRef.current;
    try{return context.active&&!context.stale&&context.scope===source.scope&&context.page===source.index&&context.generation===source.generation&&current.info===source.info&&recordPageSource.current===source.page&&source.info.database===base.database&&source.info.name===base.table&&(source.page.copyMetadataKey===undefined||source.page.copyMetadataKey===tableCopyMetadataKey(source.info));}catch{return false;}
  }
  const filteredDeleteAvailable = !restoredDraftView && !!connection && !blocked && !externalStale && !gridEditing && !record.hasInput() && !record.pending && !changes.length && !!info && tableFilteredDeleteAvailable(info) && filteredDeleteReadReady();
  /** 删除入口不询问丢稿、不混入当前页勾选；完整服务器快照只在明确确认后提交。 */
  function openFilteredDelete():void {
    const source=filteredSelectPage.current,state=useWorkspace.getState();
    if(tableReadAction.current!==tableReadRender||!filteredDeleteAvailable||filteredDeleteIntent.current||!filteredDeleteReadReady(source)||reloadBlocked()||activeGridEditor.current||record.hasInput()||collectChanges(rowsRef.current).length||state.settings.activeTabId!==tab.id||state.settings.tabs.find(item=>item.id===tab.id)!==tab||state.connections.find(item=>item.id===tab.connectionId)!==connection||(state.connectionVersions[tab.connectionId]??0)!==connectionVersion)return;
    const originalRows=rowsRef.current,originalTab=state.settings.tabs.find(item=>item.id===tab.id),profile=connection,version=connectionVersion,scope=sortScopeRef.current;
    let intent:TableFilteredDeleteIntent;
    try{
      intent=new TableFilteredDeleteIntent(base,source.info,{...statisticsConditions.current,sort:recordPageScopeRef.current.value.sort},filteredDeleteValues,()=>{
        const now=useWorkspace.getState(),dialogs=document.querySelectorAll('[role="dialog"], [role="alertdialog"]');
        return mounted.current&&filteredDeleteIntent.current===intent&&filteredDeleteReadReady(source)&&now.settings.activeTabId===tab.id&&now.settings.tabs.find(item=>item.id===tab.id)===originalTab&&now.connections.find(item=>item.id===tab.connectionId)===profile&&(now.connectionVersions[tab.connectionId]??0)===version&&rowsRef.current===originalRows&&sortScopeRef.current===scope&&!activeGridEditor.current&&!recordControllerRef.current?.hasInput()&&!collectChanges(rowsRef.current).length&&!preferencesLock.current&&!previewingRef.current&&!applyingRef.current&&dialogs.length<=1&&(!dialogs.length||!!dialogs[0].querySelector('[data-table-filtered-delete-dialog]'))&&tableCopyMetadataKey(source.info)===intent.metadataKey&&JSON.stringify({...statisticsConditions.current,sort:recordPageScopeRef.current.value.sort})===JSON.stringify(intent.scope);
      });
      filteredDeleteIntent.current=intent;batchFillIntent.current?.invalidate(); recordBatchIntent.current?.invalidate();presetUiEpoch.current++;setFilteredDeleteDialog(intent);setError('');
    }catch(reason){setError(errorMessage(reason));}
  }
  /** 原任务与取消/预览释放均已终结后才到达这里；只在原scope仍有效时刷新原页。 */
  function closeFilteredDelete(intent:TableFilteredDeleteIntent,result?:TableFilteredDeleteApplyOutput):void {
    if(filteredDeleteIntent.current!==intent)return;
    const refresh=!!result&&result.commitAcknowledged&&result.outcome==='committed'&&intent.current()&&!collectChanges(rowsRef.current).length&&!recordControllerRef.current?.hasInput();
    intent.invalidate();filteredDeleteIntent.current=null;setFilteredDeleteDialog(null);presetUiEpoch.current++;
    if (refresh) { checkedExport.clear(); void load(); }
  }
  /** 独立入口冻结完整已应用范围；不确认丢稿、不取当前页行值、不发IPC。 */
  function openFilteredSelect(): void {
    const source = filteredSelectPage.current, state = useWorkspace.getState();
    if (tableReadAction.current !== tableReadRender || !filteredSelectAvailable || filteredSelectIntent.current || !filteredSelectReadReady(source) || reloadBlocked() || activeGridEditor.current || record.hasInput() || state.settings.activeTabId !== tab.id || state.settings.tabs.find(item => item.id === tab.id) !== tab || state.settings.resultLimit !== settings.resultLimit || state.connections.find(item => item.id === tab.connectionId) !== connection || (state.connectionVersions[tab.connectionId] ?? 0) !== connectionVersion) return;
    const originalRows = rowsRef.current, originalSelected = selectedRowsRef.current, originalSelection = selectionRef.current, version = connectionVersion, profile = connection, scope = sortScopeRef.current, originalTab = state.settings.tabs.find(item => item.id === tab.id), limit = state.settings.resultLimit;
    let intent: TableFilteredSelectIntent;
    try {
      intent = new TableFilteredSelectIntent(source.info, { ...statisticsConditions.current, sort }, limit, filteredSelectValues, () => {
        const now = useWorkspace.getState(), dialogs = document.querySelectorAll('[role="dialog"]');
        return mounted.current && filteredSelectIntent.current === intent && filteredSelectReadReady(source) && now.settings.activeTabId === tab.id && now.settings.tabs.find(item => item.id === tab.id) === originalTab && now.connections.find(item => item.id === tab.connectionId) === profile && (now.connectionVersions[tab.connectionId] ?? 0) === version && now.settings.resultLimit === limit && rowsRef.current === originalRows && selectedRowsRef.current === originalSelected && selectionRef.current === originalSelection && sortScopeRef.current === scope && !activeGridEditor.current && !recordControllerRef.current?.hasInput() && !preferencesLock.current && dialogs.length <= 1 && !document.querySelector('[role="alertdialog"]') && tableCopyMetadataKey(source.info) === intent.metadata && JSON.stringify({ ...statisticsConditions.current, sort: recordPageScopeRef.current.value.sort }) === JSON.stringify(intent.readScope);
      });
      filteredSelectIntent.current = intent; onQueryTemplateNavigation?.(); setFilteredSelectDialog(intent); setError('');
    } catch (reason) { setError(errorMessage(reason)); }
  }
  /** 打开前按同一字段顺序重新生成并逐字核验；无await地消费一次后才建立未执行草稿。 */
  function openFilteredSelectQuery(intent: TableFilteredSelectIntent, sql: string, kind: TableQueryTemplateKind, options?: TableQueryTemplateOptions): boolean {
    if (filteredSelectIntent.current !== intent || kind !== 'SELECT' || !options || !onOpenGeneratedQuery || !intent.current()) return false;
    const dialogs = document.querySelectorAll('[role="dialog"]'), body = document.querySelector('[data-table-filtered-select-dialog]');
    if (dialogs.length !== 1 || !body || dialogs[0].querySelector('[data-table-filtered-select-dialog]') !== body || document.querySelector('[role="alertdialog"]')) { intent.invalidate(); return false; }
    if (useWorkspace.getState().settings.tabs.length >= 100) throw Error(filteredSelectText.tabs);
    if (intent.compile(options.columns).sql !== sql || !intent.current() || !intent.consume()) return false;
    filteredSelectIntent.current = null; setFilteredSelectDialog(null); onQueryTemplateNavigation?.();
    onOpenGeneratedQuery({ kind: 'query', title: filteredSelectText.queryTitle(intent.info.name), connectionId: tab.connectionId, ...queryDatabasePatch({ state: 'known', database: intent.info.database }), sql }); return true;
  }
  /** 原窗口取消只清自己的租约，父行草稿、勾选、当前页和服务器均保持。 */
  function closeFilteredSelect(intent: TableFilteredSelectIntent): void {
    if (filteredSelectIntent.current !== intent) return;
    intent.invalidate(); filteredSelectIntent.current = null; setFilteredSelectDialog(null); onQueryTemplateNavigation?.();
  }
  const templateAvailable = !!onOpenGeneratedQuery && !!info && !blocked && !externalStale && !gridEditing && !record.dirty && !record.pending && (connection?.dialect === 'mysql' || connection?.dialect === 'mariadb');
  const structureScriptAvailable = countPageAvailable && !blocked && !externalStale && !gridEditing && (connection?.dialect === 'mysql' || connection?.dialect === 'mariadb') && (info?.objectKind === 'table' || info?.objectKind === 'view');
  /** 表页入口从已加载的原对象取定义；刷新或改变读取范围会撤销旧草稿。 */
  function openStructureScript(): void {
    if (!structureScriptAvailable || !info || !loadedCountPage || tableReadAction.current !== tableReadRender || reloadBlocked() || activeGridEditor.current) return;
    const { database, name, objectKind } = info;
    if (objectKind !== 'table' && objectKind !== 'view') return;
    const sourceCurrent = () => mounted.current && filteredSelectPage.current === loadedCountPage && loadGeneration.current === loadedCountPage.generation && getRecordPageContext().scope === loadedCountPage.scope;
    void openNetworkSchemaScript(tab.connectionId, database, { name, kind: objectKind }, sourceCurrent);
  }
  const incomingForeignKeyJoinAvailable = templateAvailable && info?.objectKind === 'table';
  let foreignKeyJoinAvailable = incomingForeignKeyJoinAvailable;
  if (foreignKeyJoinAvailable) { try { foreignKeyJoinAvailable = foreignKeyJoinChoices(info!).length > 0; } catch { foreignKeyJoinAvailable = false; } }
  /** JOIN 只消费目录结构；当前行、原表筛选和排序不会写进查询。 */
  function openForeignKeyJoin(mode: 'outgoing' | 'incoming' | 'manual' = 'outgoing', handoff?: { owner: NonNullable<typeof relationshipDialog>; draft: RelationshipJoinDraft }): boolean {
    if (!info || tableReadAction.current !== tableReadRender || foreignKeyJoinIntent.current || activeGridEditor.current || record.hasInput()) return false;
    const state = useWorkspace.getState(), source = info, version = connectionVersion, profile = connection, generation = loadGeneration.current, refresh = refreshVersion, limit = settings.resultLimit;
    if (state.settings.activeTabId !== tab.id || state.settings.tabs.find(item => item.id === tab.id) !== tab || state.activeJobs[tab.id] || state.connections.find(item => item.id === tab.connectionId) !== profile) return false;
    if (handoff) {
      // 关系图交接只能替换自身，读取占用须已释放；其他模态、脏草稿和变更来源仍拒绝。
      const dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"]');
      if (!onOpenGeneratedQuery || relationshipRef.current !== handoff.owner || !handoff.owner.current() || referenceCount.current ||
          recordContextRef.current.stale || state.dirtyTabs[tab.id] || record.dirty || record.pending ||
          dialogs.length !== 1 || dialogs[0].getAttribute('aria-label') !== relationshipDiagramZh.title) return false;
    } else if (!(mode === 'outgoing' ? foreignKeyJoinAvailable : incomingForeignKeyJoinAvailable) || reloadBlocked()) return false;
    try {
      const originKey = foreignKeyJoinMetadataKey(source);
      /** 来自入向目录的子表加入构建后，原父表标签及其结构仍是整个流程的来源。 */
      function createIntent(child: TableInfo): TableForeignKeyJoinIntent {
        const intent: TableForeignKeyJoinIntent = new TableForeignKeyJoinIntent(child, tab.connectionId, limit, foreignKeyJoinValues, (): boolean => {
          const now = useWorkspace.getState(), own = foreignKeyJoinBusy.current;
          return mounted.current && foreignKeyJoinIntent.current === intent && now.settings.activeTabId === tab.id && now.settings.tabs.find(item => item.id === tab.id) === tab && now.connections.find(item => item.id === tab.connectionId) === profile && (now.connectionVersions[tab.connectionId] ?? 0) === version && now.settings.resultLimit === limit && refreshVersion === refresh && loadGeneration.current === generation && recordContextRef.current.info === source && !recordContextRef.current.stale && !recordControllerRef.current?.hasInput() && !activeGridEditor.current && !loadingCount.current && !applyingRef.current && !previewingRef.current && !preferencesLock.current && !copyPendingRef.current && (!now.activeJobs[tab.id] || !!own?.acquiring || !!own?.lease?.owns()) && foreignKeyJoinMetadataKey(source) === originKey;
        });
        return intent;
      }
      const intent = createIntent(handoff?.draft.child ?? source);
      foreignKeyJoinIntent.current = intent; onQueryTemplateNavigation?.(); setError('');
      if (handoff) {
        relationshipRef.current = null; presetUiEpoch.current++; setRelationshipDialog(null);
        setForeignKeyJoinDialog({ intent, mode: 'build', fixed: handoff.draft.start });
        return true;
      }
      if (mode !== 'incoming') { setForeignKeyJoinDialog({ intent, mode: 'build', manual: mode === 'manual' }); return true; }
      setForeignKeyJoinDialog({ intent, mode: 'directory', proceed(child, relation) {
        if (foreignKeyJoinIntent.current !== intent || !intent.current()) return;
        let setup: FixedForeignKeyJoinStart, childIntent: TableForeignKeyJoinIntent;
        try {
          setup = fixedForeignKeyJoinStart(intent.source, relation, child, 'RIGHT');
          childIntent = createIntent(child);
        } catch (reason) { intent.invalidate(); throw reason; }
        intent.invalidate();
        foreignKeyJoinIntent.current = childIntent;
        setForeignKeyJoinDialog({ intent: childIntent, mode: 'build', fixed: setup });
      } });
      return true;
    } catch (reason) { setError(errorMessage(reason)); return false; }
  }
  /** 独占busy世代只认可本次原operation；别人覆盖同true时也失效，旧释放不清后来作业。 */
  const foreignKeyJoinActivity = useCallback((delta: 1 | -1) => {
    if (delta === 1) {
      if (foreignKeyJoinBusy.current || referenceCount.current || useWorkspace.getState().activeJobs[tab.id]) throw Error(tableForeignKeyJoinZh.stale);
      const own = { lease: undefined as WorkspaceBusyLease | undefined, acquiring: true, releasing: false }; foreignKeyJoinBusy.current = own;
      try { own.lease = acquireWorkspaceBusy(tab.id); referenceCount.current++; setReferenceBusy(true); }
      catch (reason) { foreignKeyJoinBusy.current = null; foreignKeyJoinIntent.current?.invalidate(); throw reason; }
      finally { own.acquiring = false; }
    } else {
      const own = foreignKeyJoinBusy.current; if (!own) return;
      own.releasing = true;
      if (!own.lease?.release()) foreignKeyJoinIntent.current?.invalidate();
      if (foreignKeyJoinBusy.current === own) foreignKeyJoinBusy.current = null;
      referenceCount.current = Math.max(0, referenceCount.current - 1); setReferenceBusy(referenceCount.current > 0);
    }
  }, [tab.id]);
  /** 正式结构前置核验完成后同步消费一次，独立查询明确绑定子库且不继承原表草稿。 */
  function openForeignKeyJoinQuery(intent: TableForeignKeyJoinIntent, preview: ForeignKeyJoinPreview): boolean {
    if (foreignKeyJoinIntent.current !== intent || !onOpenGeneratedQuery || !intent.current() || activeGridEditor.current || record.hasInput()) return false;
    if (useWorkspace.getState().settings.tabs.length >= 100) throw Error(tableForeignKeyJoinZh.tabs);
    const sql = intent.consume(preview);
    foreignKeyJoinIntent.current = null; setForeignKeyJoinDialog(null); onQueryTemplateNavigation?.();
    const title = typeof preview.relation === 'string' ? tableForeignKeyJoinZh.queryTitle(intent.source.name) : tableForeignKeyJoinZh.manualQueryTitle(intent.source.name);
    onOpenGeneratedQuery({ kind: 'query', title, connectionId: intent.connectionId, ...queryDatabasePatch({ state: 'known', database: intent.source.database }), sql }); return true;
  }
  /** 关闭只移除已完成原异步收尾的那个窗口，不能放行旧读取或撤掉后来窗口。 */
  function closeForeignKeyJoin(intent: TableForeignKeyJoinIntent): void { if (foreignKeyJoinIntent.current === intent) { intent.invalidate(); foreignKeyJoinIntent.current = null; setForeignKeyJoinDialog(null); onQueryTemplateNavigation?.(); } }
  /** 模板只消费结构；已暂存数据草稿留在原表页，不进入SQL或新查询。 */
  function openQueryTemplate(): void {
    if (!templateAvailable || tableReadAction.current !== tableReadRender || queryTemplateRef.current || reloadBlocked() || activeGridEditor.current || record.hasInput() || useWorkspace.getState().settings.activeTabId !== tab.id) return;
    try { const lease: TableQueryTemplateLease = { info: info!, metadata: tableQueryTemplateMetadataKey(info!), tab, version: connectionVersion, refresh: refreshVersion, generation: loadGeneration.current, limit: settings.resultLimit, invalid: false }; queryTemplateRef.current = lease; onQueryTemplateNavigation?.(); setQueryTemplate(lease); }
    catch (reason) { setError(errorMessage(reason)); }
  }
  /** 模板的表、结构、连接修订、页代次和默认上限都固定；一次失效不因恢复原值复活。 */
  function queryTemplateCurrent(lease: TableQueryTemplateLease): boolean {
    if (lease.invalid || queryTemplateRef.current !== lease) return false;
    const state = useWorkspace.getState(), current = state.settings.tabs.find(item => item.id === lease.tab.id);
    let valid = false;
    try { valid = mounted.current && !blockedRef.current && !externalStale && current === lease.tab && current.kind === 'table' && state.settings.activeTabId === current.id && (state.connectionVersions[current.connectionId] ?? 0) === lease.version && refreshVersion === lease.refresh && loadGeneration.current === lease.generation && state.settings.resultLimit === lease.limit && info === lease.info && info.database === base.database && info.name === base.table && tableQueryTemplateMetadataKey(info) === lease.metadata; } catch {}
    if (!valid) lease.invalid = true; return valid;
  }
  /** 新查询仅持有生成SQL和明确默认库，保留表页／草稿；不继承查询来源或会话。 */
  function openGeneratedQuery(lease: TableQueryTemplateLease, sql: string, kind: TableQueryTemplateKind, options?: TableQueryTemplateOptions): boolean {
    if (!queryTemplateCurrent(lease) || !onOpenGeneratedQuery || activeGridEditor.current || record.hasInput()) return false;
    try {
      if (useWorkspace.getState().settings.tabs.length >= 100) throw Error(templateText.tabs);
      if (buildTableQueryTemplate(lease.info, kind, lease.limit, options).sql !== sql) throw Error(templateText.changed);
      queryTemplateRef.current = null; setQueryTemplate(null); onQueryTemplateNavigation?.();
      onOpenGeneratedQuery({ kind: 'query', title: templateText.queryTitle(lease.info.name, kind), connectionId: lease.tab.connectionId, ...queryDatabasePatch({ state: 'known', database: lease.info.database }), sql }); return true;
    } catch (reason) { setError(errorMessage(reason)); throw reason; }
  }
  /** 旧窗口关闭只能结束自己，不能移除后来打开的模板。 */
  function closeQueryTemplate(lease: TableQueryTemplateLease): void { if (queryTemplateRef.current === lease) { queryTemplateRef.current = null; setQueryTemplate(null); onQueryTemplateNavigation?.(); } }
  const sortPanelAvailable = !!info && !!page && !blocked && !externalStale && !gridEditing && !record.pending;
  /** 只打开当前排序的独立草稿，不确认丢弃数据，也不重新读取服务器。 */
  function openSortPanel(): void {
    if (tableReadAction.current !== tableReadRender) return;
    if (sortPanelRef.current) { closeSortPanel(sortPanelRef.current); return; }
    if (!sortPanelAvailable || reloadBlocked() || activeGridEditor.current || useWorkspace.getState().settings.activeTabId !== tab.id) return;
    try { const columns = info!.columns.map(column => column.name), lease: TableSortLease = { scope: sortScope, columns, sort: validateTableSort(sort, columns), invalid: false }; sortPanelRef.current = lease; setSortPanel(lease); }
    catch (reason) { setError(errorMessage(reason)); }
  }
  /** 旧父渲染、连接／标签ABA、页和筛选变化均不能应用到后继表页。 */
  function sortPanelCurrent(lease: TableSortLease): boolean {
    const valid = mounted.current && tableReadAction.current === tableReadRender && sortPanelRef.current === lease && !lease.invalid && lease.scope === sortScopeRef.current && useWorkspace.getState().settings.activeTabId === tab.id && !reloadBlocked() && !externalStale && !activeGridEditor.current;
    if (!valid) lease.invalid = true; return valid;
  }
  /** 与列头共用正式排序规则，明确应用后复用原分页加载及草稿确认。 */
  function applySortPanel(lease: TableSortLease, next: SortRule[]): boolean {
    if (!sortPanelCurrent(lease)) throw Error(sortText.stale);
    const checked = validateTableSort(next, info!.columns.map(column => column.name));
    if (JSON.stringify(checked) === JSON.stringify(sort)) { closeSortPanel(lease); return true; }
    if (!canReload()) return false;
    if (!sortPanelCurrent(lease)) throw Error(sortText.stale);
    closeSortPanel(lease); setSort(checked); setPageIndex(1); return true;
  }
  /** 取消只撤销自己的排序草稿，原页数据和已应用规则保持。 */
  function closeSortPanel(lease: TableSortLease): void { if (sortPanelRef.current === lease) { sortPanelRef.current = null; setSortPanel(null); } }
  /** 组合器只编辑原条件的逻辑关系，打开不确认丢稿、不重新查询。 */
  function openFilterGroups(): void {
    if (tableReadAction.current !== tableReadRender || filterGroupsRef.current || !filters.length || !info || !page || externalStale || reloadBlocked() || activeGridEditor.current || useWorkspace.getState().settings.activeTabId !== tab.id) return;
    try {
      const lease: TableFilterGroupLease = { scope: sortScope, filters, mode: filterMode, initial: validateFilterGroup(filters, filterMode, filterGroup), invalid: false, dialogs: createPresetDialogGuard(document) };
      presetUiEpoch.current++; filterGroupsRef.current = lease; setFilterGroups(lease);
    } catch (reason) { setError(errorMessage(reason)); }
  }
  /** 条件、页、目标、外部窗口和工作区变化后永久撤销，取消仍可关闭原面板。 */
  function filterGroupsCurrent(lease: TableFilterGroupLease): boolean {
    const valid = mounted.current && filterGroupsRef.current === lease && !lease.invalid && lease.scope === sortScopeRef.current && useWorkspace.getState().settings.activeTabId === tab.id && lease.dialogs.current() && !reloadBlocked() && !externalStale && !activeGridEditor.current;
    if (!valid) lease.invalid = true;
    return valid;
  }
  /** 完整树先校验；用户拒绝丢草稿时保留面板、原条件、排序和当前页。 */
  function applyFilterGroups(lease: TableFilterGroupLease, next: FilterGroup): boolean {
    if (!filterGroupsCurrent(lease)) throw Error(groupText.stale);
    const checked = validateFilterGroup(lease.filters, next.mode, next)!;
    if (JSON.stringify(checked) === JSON.stringify(filterGroup ?? { mode: filterMode, children: filters.map((_, index) => index) })) { closeFilterGroups(lease); return true; }
    if (!canReload()) return false;
    if (!filterGroupsCurrent(lease)) throw Error(groupText.stale);
    closeFilterGroups(lease); setFilterGroup(checked); setFilterMode(checked.mode); setPageIndex(1); return true;
  }
  /** 只关闭自己的组合器，旧取消不能清除后来创建的分组。 */
  function closeFilterGroups(lease: TableFilterGroupLease): void {
    if (filterGroupsRef.current !== lease) return;
    lease.dialogs.dispose(); presetUiEpoch.current++; filterGroupsRef.current = null; setFilterGroups(null);
  }
  const filterPauseAvailable = showFilter && (!!page || !!resumableFilters) && !!connection && !blocked && !externalStale && !restoredDraftView && !gridEditing;
  /** 原条件的值、顺序和分组不动，只替换启用位；一次确认后从第一页读取。 */
  function toggleFilterPause(): boolean {
    const source = filteredSelectPage.current, generation = loadGeneration.current;
    const current = () => {
      const state = useWorkspace.getState();
      // 若读取全部记录失败，仍允许从同一个标签恢复原条件。
      const samePage = source ? source.page === page && source.generation === generation && source.scope === getRecordPageContext().scope : !page && !!resumableFilters;
      return filterPauseAvailable && mounted.current && tableReadAction.current === tableReadRender
        && samePage && filteredSelectPage.current === source && loadGeneration.current === generation
        && state.settings.activeTabId === tab.id && state.settings.tabs.find(item => item.id === tab.id) === tab
        && state.connections.find(item => item.id === tab.connectionId) === connection && (state.connectionVersions[tab.connectionId] ?? 0) === connectionVersion
        && !filterGroupsRef.current && !activeGridEditor.current && !reloadBlocked() && !document.querySelector('[role="alertdialog"]');
    };
    if (!current() || !resumableFilters && !filters.some(rule => rule.enabled !== false)) return false;
    const next = resumableFilters ?? setAllFilterRulesEnabled(filters, false);
    if (!canReload(undefined, current)) return false;
    tableReadAction.current = null;
    setFilterSelection({ filters: next, paused: resumableFilters ? undefined : { original: filters, tab, profile: connection, version: connectionVersion } });
    setPageIndex(1); return true;
  }
  function changeFilters(next: FilterRule[]): boolean {
    if (!mounted.current || tableReadAction.current !== tableReadRender || externalStale || useWorkspace.getState().settings.activeTabId !== tab.id) return false;
    const nextGroup = tableFilterGroupAfterChange(filters, next, filterGroup, filterMode);
    if (!canReload()) return false;
    setFilters(next); setFilterGroup(nextGroup); setPageIndex(1); return true;
  }
  /** 全部与任一是整组规则的组合方式，切换也必须通过当前页草稿保护。 */
  function changeFilterMode(next: FilterMode): boolean {
    if (!mounted.current || tableReadAction.current !== tableReadRender || externalStale || useWorkspace.getState().settings.activeTabId !== tab.id) return false;
    if (next === filterMode) return true;
    if (!canReload()) return false;
    setFilterGroup(tableFilterGroupWithMode(filterGroup, next)); setFilterMode(next); setPageIndex(1); return true;
  }
  /** 分页动作在确认前后核原活动标签，旧控件不能替新标签改页码或全局页大小。 */
  function pageNavigationCurrent(): boolean {
    const workspace = useWorkspace.getState();
    return mounted.current && tableReadAction.current === tableReadRender && !restoredDraftView && !reloadBlocked() && !activeGridEditor.current
      && workspace.settings.activeTabId === tab.id && workspace.settings.tabs.find(item => item.id === tab.id) === tab
      && workspace.connections.find(item => item.id === tab.connectionId) === connection && (workspace.connectionVersions[tab.connectionId] ?? 0) === connectionVersion
      && !document.querySelector('[role="alertdialog"]');
  }
  /** 首页、上一页、下一页和输入页码都使用同一服务器读取入口。 */
  function goToNumberedPage(target: number): void {
    if (!Number.isSafeInteger(target) || target < 1 || target > maxTablePage || target === pageRequest || !pageNavigationCurrent()) return;
    try { if (retainAndNavigate(target)) return; } catch (reason) { setError(errorMessage(reason)); return; }
    if (!canReload(undefined, pageNavigationCurrent)) return;
    tableReadAction.current = null; setError(''); setPageIndex(target);
  }
  /** 页码可指向空页；只检查接口范围，不用当前页的 hasMore 推测总页数。 */
  function jumpToPage() {
    if (!pageNavigationCurrent()) return;
    try { goToNumberedPage(parsePageJump(pageJump)); }
    catch (reason) { setError(errorMessage(reason)); }
  }
  /** 编辑自定义值不查询；有效值经确认后一次更新当前页与下次打开表的默认值。 */
  function changePageSize(value: string): void {
    if (!pageNavigationCurrent()) return;
    if (value === 'custom') { setPageSizeDraft(String(pageSize)); setError(''); return; }
    try {
      const size = parseTablePageSize(value);
      if (size !== pageSize) {
        if (!canReload(undefined, pageNavigationCurrent)) return;
        tableReadAction.current = null;
        setPageIndex(1); setPageSize(size); useWorkspace.getState().updateSettings({ pageSize: size });
      }
      setPageSizeDraft(null); setError('');
    } catch (reason) { setError(errorMessage(reason)); }
  }
  /** 取消只关闭输入框，恢复显示实际生效的页大小。 */
  function closePageSizeDraft(): void { if (pageNavigationCurrent()) { setPageSizeDraft(null); setError(''); pageSizeSelect.current?.focus(); } }
  const lastPageSupported = info?.objectKind === 'table' && info.engine.toUpperCase() === 'INNODB';
  const lastPageAvailable = lastPageSupported && (countPageAvailable || !!tableEdits.selected) && !blocked && !externalStale && !gridEditing;
  const renderedLastPageRead = lastPageRead.current;
  /** 末页读取使用原筛选和排序，丢稿确认前后都核对同一已加载页。 */
  function openLastPage(): void {
    if (lastPageAvailable && pageNavigationCurrent()) { try { if (retainAndNavigate('last')) return; } catch (reason) { setError(errorMessage(reason)); return; } }
    const current = () => lastPageAvailable && pageNavigationCurrent() && filteredSelectPage.current === loadedCountPage && loadedCountPage?.scope === getRecordPageContext().scope;
    if (!canReload(undefined, current)) return;
    tableReadAction.current = null;
    setPageRequest({ from: pageIndex });
  }
  /** 停止只消费本次末页任务；收到取消回执之前，仍等原读取完成清理。 */
  function stopLastPage(read: TableLastPageRead): void {
    if (!mounted.current || lastPageRead.current !== read || read.stopped || read.finished || useWorkspace.getState().settings.activeTabId !== tab.id) return;
    read.stopped = true; setLastPageStopping(true);
    if (read.sent) read.stop = invoke('query.cancel', { taskId: read.taskId }).catch(() => undefined);
  }
  const [fieldFindDisplay, setFieldFindDisplay] = useState<TableFieldFindDisplay>();
  const visibleFieldFind = showFind && !blocked && !record.dirty && !externalStale && settings.activeTabId === tab.id ? fieldFindDisplay : undefined;
  const fieldFindTarget = visibleFieldFind?.current;
  // 字段匹配在标题行定位，面板内导航保留输入焦点及当前记录。
  useLayoutEffect(() => {
    if (!fieldFindTarget || !grid.current?.element?.isConnected) return;
    const idx = visibleKeys.indexOf(fieldFindTarget.key) + 1;
    if (idx < 1) return;
    grid.current.scrollToCell({ idx });
    if (fieldFindTarget.focus) grid.current.setActivePosition({ rowIdx: -1, idx }, { shouldFocus: true });
  }, [fieldFindTarget, visibleKeys]);
  const [showGridImages, setShowGridImages] = useState(false);
  const [showFieldType, setShowFieldType] = useState(true);
  const [showFieldComment, setShowFieldComment] = useState(false);
  const headerFields = useMemo(() => new Map(info?.columns.map(field => [field.name, field])), [info]);
  const rangeRowIndex = useMemo(() => new Map(rows.map((row, index) => [row, index])), [rows]);
  const columns = useMemo<Column<DraftRow>[]>(() => [SelectColumn, ...visibleColumns.map<Column<DraftRow>>((column, index) => ({
    key: column.key, name: column.name, minWidth: 64, maxWidth: 2000, width: preferences.columns.find(item => item.name === column.key)?.width ?? 165, frozen: frozenKeys.includes(column.key), resizable: true, sortable: true, draggable: true,
    // 组件的editable同时控制粘贴派发；只读判断保持不变，二进制另在文本入口拦截。
    editable: row => !record.dirty && !recordReadonlyReason(getRecordContext(), row, column.key),
    cellClass: row => {
      if (row.deleted) return;
      if (visibleFind?.current?.rowId === row.id && visibleFind.current.key === column.key) return 'query-result-find-hit';
      const rangeClass = gridCellRangeClass(cellRange.rectangle, rangeRowIndex.get(row), index);
      if (rangeClass) return rangeClass;
      if (visibleFind?.highlights?.get(row.id)?.has(column.key)) return 'query-result-find-match';
    },
    headerCellClass: tableFieldFindClass(visibleFieldFind, column.key),
    renderEditCell: props => <TextCellEditor {...props} onEditingChange={onGridEditingChange} binary={isBinaryCell(ownCell(props.row.data, column.key), info?.columns.find(item => item.name === column.key)?.type)}/>,
    renderHeaderCell: () => <span className="data-header">{info?.primaryKey.includes(column.key) && <KeyRound size={11}/>}<GridHeaderDetails name={column.name} type={showFieldType ? headerFields.get(column.key)?.type ?? column.type : undefined}
      comment={showFieldComment ? headerFields.get(column.key)?.comment : undefined}/></span>,
    renderCell: ({ row, tabIndex }) => { const value = ownCell(row.data, column.key), label = value === undefined ? zh.common.defaultValue : cellPreview(value); return <DataTypeColor enabled={settings.dataTypeColors === true} selected={tabIndex === 0 || selectedRows.has(row.id)} value={value} type={settings.dataTypeColors === true ? catalogColorType(info?.columns, column.key) : undefined} source="catalog" className={value === null ? 'grid-row-preview null-value' : value === undefined ? 'grid-row-preview default-value' : 'grid-row-preview'} title={label}>{showGridImages && !row.deleted ? <GridCellImage value={value}>{label}</GridCellImage> : label}</DataTypeColor>; }
  }))], [visibleColumns, preferences, frozenKeys, editable, info, blocked, record.dirty, externalStale, showFieldType, showFieldComment, headerFields, visibleFind, visibleFieldFind, showGridImages, cellRange.rectangle, rangeRowIndex, settings.dataTypeColors, settings.dataTypeColors === true ? selectedRows : null]);
  /** 刷新后网格可能保留同一活动坐标；点击也须用当前行同步选择，不能只等待坐标变化。 */
  function selectCurrentCell(row: DraftRow | undefined, key: string | undefined) {
    // 先永久撤销旧意图；忙碌时忽略新选择也不能让切走再切回的回包复活。
    if (selectionRef.current?.rowId !== row?.id || selectionRef.current?.key !== key) { invalidateCopyRead(); batchFillIntent.current?.invalidate(); recordBatchIntent.current?.invalidate(); }
    if (selectionRef.current?.rowId !== row?.id) childReferenceIntent.current?.invalidate();
    if (selectionRef.current?.rowId !== row?.id || selectionRef.current?.key !== key) { tableStatisticsIntent.current?.invalidate(); tableValueOptionsIntent.current?.invalidate(); if (selectedFilterRef.current) selectedFilterRef.current.invalid = true; }
    if (blocked || document.querySelector('[role="dialog"]')) return;
    // 失去有效坐标时先同步撤销选择令牌，迟到预览不能抢在React渲染前写入。
    if (!row || !key || !page?.columns.some(column => column.key === key) || !rowsRef.current.some(current => current.id === row.id)) { selectionRef.current = undefined; setSelection(undefined); return; }
    const activate = () => {
      // 同坐标重复通知复用令牌；同步引用与React状态共用同一对象，重渲染不制造选择变化。
      const current = selectionRef.current;
      const next = current?.rowId === row.id && current.key === key ? current : { rowId: row.id, key };
      selectionRef.current = next; setSelection(next);
    };
    if (record.formOpen && !record.select(row.id, activate)) restoreGridFocus(false); else if (!record.formOpen) activate();
  }
  /** 数据网格先返回当前行，再统一替换整个矩阵，避免多行粘贴被默认单行更新覆盖。 */
  function changeRows(updated: DraftRow[]) { try { assertGridWritable(); setRows(acceptGridDrafts(rowsRef.current, rows, pendingPaste.current ?? updated)); } catch (reason) { setError(errorMessage(reason)); } finally { pendingPaste.current = null; } }
  /** 捕获当前记录与草稿代次，模板只授权原页的一次整批新增。 */
  function openRecordTemplates(): void {
    try {
      assertPasteInsertTarget(); if (document.querySelector('[role="dialog"], [role="alertdialog"]') || !getRecordContext().info) return;
      const context = getRecordContext(), initialRows = rowsRef.current, generation = history.generation, workspace = useWorkspace.getState(), originalTab = workspace.settings.tabs.find(item => item.id === tab.id), profile = workspace.connections.find(item => item.id === tab.connectionId), refresh = observedRefresh.current;
      const insert = new PasteInsertIntent(initialRows, context, visibleKeys);
      const lease = new RecordTemplateLease(uid(), () => {
        const now = useWorkspace.getState();
        return mounted.current && now.settings.activeTabId === tab.id && now.settings.tabs.find(item => item.id === tab.id) === originalTab && now.connections.find(item => item.id === tab.connectionId) === profile
          && (now.connectionVersions[tab.connectionId] ?? 0) === context.connectionVersion && !now.activeJobs[tab.id] && observedRefresh.current === refresh && history.generation === generation
          && !recordControllerRef.current?.hasInput() && !activeGridEditor.current && !rootElement.current?.querySelector('.grid-input') && !insert.reason(rowsRef.current, getRecordContext());
      });
      const row = initialRows.find(row => row.id === selectionRef.current?.rowId && !row.deleted);
      const value: TemplateDialog = { lease, insert, columns: mysqlTemplateColumns(context.info!), ...(row ? { candidate: mysqlTemplateCandidate(row.data, context.info!) } : {}) };
      templateRef.current?.lease.invalidate(); templateRef.current = value; setTemplateDialog(value); setError('');
    } catch (reason) { setError(errorMessage(reason)); }
  }
  /** 关闭仅撤销本模态票据，不放弃原页数据或已有草稿。 */
  function closeRecordTemplates(value: TemplateDialog): void {
    value.lease.invalidate(); value.insert.invalidate(); if (templateRef.current !== value) return;
    templateRef.current = undefined; setTemplateDialog(undefined);
  }
  /** 新增走原粘贴计划与历史，一次发布且复用唯一键保护，不投递SQL。 */
  function stageRecordTemplate(value: TemplateDialog, content: RecordTemplateContent, count: number): void {
    if (templateRef.current !== value || !value.lease.current()) throw Error(recordTemplatesZh.stale);
    const context = getRecordContext(), data = mysqlTemplateRows(content, context.info!, count), names = content.fields.map(field => field.name);
    const plan = preparePasteInsert(context.info!, data.map(row => names.map(name => Object.getOwnPropertyDescriptor(row, name)!.value)), names);
    const result = value.insert.consume(plan, rowsRef.current, context, uid);
    closeRecordTemplates(value); result.ids.forEach(id => copiedDraftIds.current.add(id)); setRows(result.rows); setError(''); setDuplicateNotice(recordTemplatesZh.staged(count));
  }

  /** 新增使用同一草稿 UUID；表单已打开时可立即编辑该新增记录。 */
  function addRow() {
    try { assertGridWritable(); const row = newDraftRow(uid()); setRows(current => [...current, row]); const key = visibleKeys[0]; if (key) { selectionRef.current = { rowId: row.id, key }; setSelection(selectionRef.current); } if (record.formOpen) record.select(row.id); }
    catch (reason) { setError(errorMessage(reason)); }
  }
  /** 再读工作区同步状态，不让关闭标签、切换目标或未暂存输入借旧回调追加草稿。 */
  function assertPasteInsertTarget() {
    assertGridWritable();
    const workspace = useWorkspace.getState(), current = workspace.settings.tabs.find(item => item.id === tab.id), context = getRecordContext();
    if (!mounted.current || workspace.settings.activeTabId !== tab.id || !current || !workspace.connections.some(item => item.id === current.connectionId) || recordTargetKey({ connectionId: current.connectionId, database: current.database ?? '', table: current.table ?? '' }) !== recordTargetKey(context.target) || (workspace.connectionVersions[current.connectionId] ?? 0) !== context.connectionVersion || record.dirty || rootElement.current?.querySelector('.grid-input')) throw Error(pasteInsertZh.changed);
  }
  function openPasteInsert() {
    try {
      assertPasteInsertTarget(); if (document.querySelector('[role="dialog"]')) return;
      const intent = new PasteInsertIntent(rowsRef.current, getRecordContext(), visibleKeys);
      pasteInsertIntent.current?.invalidate(); pasteInsertIntent.current = intent; setPasteInsertDialog(intent); setError('');
    } catch (reason) { setError(errorMessage(reason)); }
  }
  function closePasteInsert(intent: PasteInsertIntent) {
    intent.invalidate(); if (pasteInsertIntent.current !== intent) return;
    pasteInsertIntent.current = null; setPasteInsertDialog(null);
  }
  /** 只一次发布整批本地草稿；键冲突及最终权限仍复用原集中preview/apply。 */
  function stagePasteInsert(intent: PasteInsertIntent, plan: PasteInsertPlan) {
    assertPasteInsertTarget(); if (pasteInsertIntent.current !== intent) throw Error(pasteInsertZh.changed);
    const result = intent.consume(plan, rowsRef.current, getRecordContext(), uid);
    result.ids.forEach(id => copiedDraftIds.current.add(id));
    setRows(result.rows); setError(''); setDuplicateNotice(pasteInsertZh.staged); closePasteInsert(intent);
  }
  /** 复用原活动页/输入门；仅允许本弹窗存在，其他模态、忙碌或迟到回调均不能发布。 */
  function assertBatchFillTarget() {
    assertPasteInsertTarget();
    if (useWorkspace.getState().activeJobs[tab.id] || observedRefresh.current !== refreshVersion || blockedRef.current || loadingCount.current || referenceCount.current || applyingRef.current || preferencesLock.current || previewingRef.current || copyPendingRef.current || activeGridEditor.current || record.pending || showPreferences || referenceDialog || pasteInsertDialog) throw Error(recordBatchFillZh.changed);
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
    if (dialogs.length > 1 || dialogs.some(dialog => dialog.getAttribute('aria-label') !== recordBatchFillZh.title)) throw Error(recordBatchFillZh.changed);
  }
  function openBatchFill(scope: 'page' | 'workspace') {
    try {
      assertBatchFillTarget();
      if (rows !== rowsRef.current || selectedRows !== selectedRowsRef.current || selection !== selectionRef.current || document.querySelector('[role="dialog"]')) throw Error(recordBatchFillZh.changed);
      const context = getRecordContext();
      const intent = scope === 'workspace' ? tableEdits.planCheckedFill(rows, selectedRows, context)
        : new BatchFillIntent(rows, selectedRows, context, copyPage.current, page);
      batchFillIntent.current?.invalidate();
      recordBatchIntent.current?.invalidate();
      batchFillIntent.current = intent;
      setBatchFillDialog(intent);
      setError('');
    } catch (reason) { setError(errorMessage(reason)); }
  }
  function closeBatchFill(intent: BatchFillIntent | TableCheckedFill) {
    intent.invalidate();
    if (batchFillIntent.current === intent) { batchFillIntent.current = null; setBatchFillDialog(null); }
  }
  /** 两种范围都只暂存本地草稿。多页历史已随工作区一次发布，活动网格只同步结果。 */
  function stageBatchFill(intent: BatchFillIntent | TableCheckedFill, assignments: readonly BatchFillAssignment[]) {
    try { assertBatchFillTarget(); if (batchFillIntent.current !== intent) throw Error(recordBatchFillZh.changed); }
    catch (reason) { intent.invalidate(); throw reason; }
    const current = rowsRef.current, selected = selectedRowsRef.current, context = getRecordContext();
    let changed: number;
    const workspace = 'groups' in intent;
    if (workspace) {
      const result = intent.stage(assignments, current, selected, context);
      changed = result.changed;
      setRows(result.rows, 'replay');
    } else {
      const next = intent.consumeAssignments(assignments, current, selected, context, copyPage.current, page);
      changed = next.filter((row, index) => row !== current[index]).length;
      setRows(next);
    }
    recordPages.cancel();
    record.reset();
    setError('');
    setDuplicateNotice(changed ? formatText(workspace ? workspaceText.filled : recordBatchFillZh.staged, changed) : recordBatchFillZh.unchanged);
    closeBatchFill(intent);
  }
  /** 仅原窗口唯一marker可保持来源；失活／忙态／外部输入和Modal脱离留下永久墓碑。 */
  function recordBatchCurrent(intent: RecordBatchOwner): boolean {
    if (recordBatchIntent.current !== intent || intent.invalidated || recordBatchAttachment.current?.intent !== intent) return false;
    try {
      assertPasteInsertTarget();
      if (useWorkspace.getState().activeJobs[tab.id] || observedRefresh.current !== refreshVersion || blockedRef.current || loadingCount.current || referenceCount.current || applyingRef.current || preferencesLock.current || previewingRef.current || copyPendingRef.current || activeGridEditor.current || record.pending || record.cellKey !== null || record.nodeInput || record.structureInput || record.documentInput || showPreferences || referenceDialog || pasteInsertDialog || batchFillDialog) throw Error(recordBatchEditZh.stale);
      const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')], markers = dialogs.length === 1 ? dialogs[0].querySelectorAll('[data-record-batch-owner]') : [];
      if (dialogs.length === 0 ? recordBatchAttachment.current.attached : dialogs.length !== 1 || markers.length !== 1 || markers[0].getAttribute('data-record-batch-owner') !== intent.id) throw Error(recordBatchEditZh.stale);
      if (intent.reason(rowsRef.current, selectedRowsRef.current, getRecordContext(), copyPage.current, page)) throw Error(recordBatchEditZh.stale);
      if (dialogs.length) recordBatchAttachment.current.attached = true; return true;
    } catch { intent.invalidate(); return false; }
  }
  /** 打开准确当前页选择，窗口只编辑独立RAM副本；不读取新页或改变原记录表单。 */
  function openRecordBatch(scope: 'page' | 'workspace' = 'page'): void {
    try {
      assertPasteInsertTarget();
      if (recordBatchIntent.current || insertCopyBlockedRef.current || document.querySelector('[role="dialog"], [role="alertdialog"]') || rows !== rowsRef.current || selectedRows !== selectedRowsRef.current) throw Error(recordBatchEditZh.stale);
      const context = getRecordContext(), id = uid();
      const intent = scope === 'workspace' ? tableEdits.planCheckedRecordEdit(rows, selectedRows, context, copyPage.current, page, id)
        : new RecordBatchEditIntent(rowsRef.current, selectedRowsRef.current, context, copyPage.current, page, id);
      recordBatchIntent.current = intent; recordBatchAttachment.current = { intent, attached: false }; setRecordBatchDialog(intent); setError('');
    } catch (reason) { setError(errorMessage(reason)); }
  }
  /** 只关闭本批票据；失效窗口也可取消，重新计算真实原草稿dirty。 */
  function closeRecordBatch(intent: RecordBatchOwner): void {
    if (recordBatchIntent.current !== intent) return;
    intent.invalidate(); recordBatchIntent.current = null; recordBatchAttachment.current = null; setRecordBatchDialog(null);
    useWorkspace.getState().setDirty(tab.id, record.hasInput() || collectChanges(tableEdits.allRows(rowsRef.current)).length > 0);
  }
  /** 所有行及原集中提交预算通过后只发布一次，原DraftHistory形成一个可撤销步骤。 */
  function stageRecordBatch(intent: RecordBatchOwner, candidates: DraftRow[]): boolean {
    if (!recordBatchCurrent(intent) || !recordBatchAttachment.current?.attached) return false;
    const current = rowsRef.current, selected = selectedRowsRef.current, context = getRecordContext();
    let count: number;
    if ('groups' in intent) {
      const result = intent.stage(candidates, current, selected, context, copyPage.current, page);
      count = result.changed;
      setRows(result.rows, 'replay');
    } else {
      const next = intent.consume(candidates, current, selected, context, copyPage.current, page);
      count = next.filter((row, at) => row !== current[at]).length;
      setRows(next);
    }
    recordPages.cancel(); record.reset(); closeRecordBatch(intent); setError(''); setDuplicateNotice(recordBatchEditZh.staged(count)); return true;
  }
  /** 未保留输入与已保留局部行均进入退出保护，取消后不遗留原页的伪dirty。 */
  function recordBatchDirty(intent: RecordBatchOwner, dirty: boolean): void {
    if (recordBatchIntent.current === intent) useWorkspace.getState().setDirty(tab.id, dirty || record.hasInput() || collectChanges(tableEdits.allRows(rowsRef.current)).length > 0);
  }
  /** 点击时同步核对活动页和输入占门；IPC 只携带此刻的已加载原值，不等待补取或推断目标。 */
  function copyRowsAsInsert(selected: boolean) {
    try {
      const workspace = useWorkspace.getState(), current = workspace.settings.tabs.find(item => item.id === tab.id), context = getRecordContext();
      if (!mounted.current || workspace.settings.activeTabId !== tab.id || !current || !workspace.connections.some(item => item.id === current.connectionId) || current.connectionId !== context.target.connectionId || current.database !== context.target.database || current.table !== context.target.table || (workspace.connectionVersions[current.connectionId] ?? 0) !== context.connectionVersion || loadingCount.current || referenceCount.current || applyingRef.current || preferencesLock.current || previewingRef.current || copyPendingRef.current || insertCopyBlockedRef.current || record.hasInput() || record.dirty || inputDirtyRef.current || activeGridEditor.current || rootElement.current?.querySelector('.grid-input')) throw Error(copyInsertSqlZh.busy);
      const ids = selected ? selectedRowsRef.current : new Set(selectionRef.current ? [selectionRef.current.rowId] : []);
      const input = prepareCopyInsertSql(context, copyPage.current, page, rowsRef.current, ids);
      setError(''); setDuplicateNotice('');
      // 无其他 await：主进程同步消费这个点击快照，迟到回包只影响提示，不再写第二次。
      const environment = copyEnvironment.current;
      void invoke('table.copyInsertSql', input).then(() => { if (mounted.current && copyEnvironment.current === environment) setDuplicateNotice(copyInsertSqlZh.copied); }, reason => { if (mounted.current && copyEnvironment.current === environment) setError(errorMessage(reason)); });
    } catch (reason) { setError(errorMessage(reason)); }
  }
  /** 复制 SQL 和打开查询草稿共享原页租约。活动页或勾选变更时撤销旧入口。 */
  function handleRowSql(kind: RowSqlKind, destination: 'clipboard' | 'draft', menu?: { ids(): ReadonlySet<string> | undefined; current(): boolean }) {
    const current = () => (menu ? menu.current() : tableToolbarCurrent() && selectionRef.current === selection) &&
      !insertCopyBlockedRef.current && !restoredDraftView &&
      !externalStaleRef.current && !activeGridEditor.current && !record.hasInput() &&
      rowsRef.current === rows && selectedRowsRef.current === selectedRows &&
      copyPage.current?.page === page;
    if (!current()) return;
    try {
      const ids = menu ? menu.ids()
        : selectedRows.size ? selectedRows : new Set(selection ? [selection.rowId] : []);
      if (!ids) return;
      const context = getRecordContext();
      const prepare = { select: prepareCopyPrimaryKeyQuery, update: prepareCopyUpdateSql, delete: prepareCopyDeleteSql };
      const sql = kind === 'insert' ? buildCopyInsertSql(prepareCopyInsertSql(context, copyPage.current, page, rows, ids))
        : prepare[kind](context, copyPage.current, page, rows, ids);
      if (destination === 'draft') {
        if (onOpenGeneratedQuery && current()) {
          openRowSqlDraft(context.target, kind, sql, onOpenGeneratedQuery);
          setError('');
        }
        return;
      }
      writeTableClipboardEvent(current, data => data.setData('text/plain', sql));
      setError('');
      setDuplicateNotice({ select: primaryKeyCopyZh.copied, insert: copyInsertSqlZh.copied, update: updateSqlCopyZh.copied, delete: deleteSqlCopyZh.copied }[kind]);
    } catch (reason) { if (current()) setError(errorMessage(reason)); }
  }
  const primaryKeyQueryDisabled = insertCopyBlockedRef.current || restoredDraftView || !!copyMetadataReason || (!selection && !selectedRows.size);
  // 捕获本次勾选和页面身份；观察过的页/目标变化即使恢复原值，也不能复活旧按钮。
  const batchDuplicateScope = { rows, selectedRows, page, source: page?.copySource, metadata: page?.copyMetadataKey, environment: copyEnvironment.current, revision: recordPages.revision };
  /** 批量复制只接受完整当前页，先整批验证，再一次发布历史和新增键保护。 */
  function duplicateSelectedRows() {
    try {
      assertPasteInsertTarget(); recordPages.observe(getRecordPageContext());
      if (insertCopyBlockedRef.current || blockedRef.current || loadingCount.current || referenceCount.current || applyingRef.current || preferencesLock.current || previewingRef.current || copyPendingRef.current || activeGridEditor.current || document.querySelector('[role="dialog"]')) throw Error(recordViewZh.resolveInput);
      if (batchDuplicateScope.rows !== rowsRef.current || batchDuplicateScope.selectedRows !== selectedRowsRef.current || batchDuplicateScope.page !== copyPage.current?.page || batchDuplicateScope.source !== copyPage.current?.page.copySource || batchDuplicateScope.metadata !== copyPage.current?.page.copyMetadataKey || batchDuplicateScope.environment !== copyEnvironment.current || batchDuplicateScope.revision !== recordPages.revision) throw Error(recordDuplicateZh.batchSource);
      const result = duplicateSelectedRecordDrafts(rowsRef.current, selectedRowsRef.current, getRecordContext(), copyPage.current, batchDuplicateScope.page, uid);
      for (const id of result.ids) copiedDraftIds.current.add(id);
      setRows(result.rows); setError(''); setDuplicateNotice(formatText(recordDuplicateZh.batchStaged, result.ids.length));
    } catch (reason) { setError(errorMessage(reason)); }
  }
  /** 完整本地行直接复制；缺列只可沿本页引擎租约补取，不猜测DEFAULT。 */
  function duplicateCurrentRow() {
    try {
      assertGridWritable();
      if (blockedRef.current || record.dirty || rootElement.current?.querySelector('.grid-input') || document.querySelector('[role="dialog"]')) throw new Error(recordViewZh.resolveInput);
      const metadataReason = recordCopyMetadataReason(getRecordContext(), copyPage.current, copySources.current?.source); if (metadataReason) throw new Error(metadataReason);
      const row = rowsRef.current.find(item => item.id === selectionRef.current?.rowId);
      if (recordDuplicateReadonlyReason(getRecordContext(), row) && recordCopySourceReady(getRecordContext(), row, copySources.current?.source, row ? copyRowRefs.current.get(row.id) : undefined)) { void readCompleteCopySource(); return; }
      const newId = uid();
      const next = duplicateRecordDraft(rowsRef.current, selectionRef.current?.rowId, getRecordContext(), newId);
      copiedDraftIds.current.add(newId); setRows(next); setError(''); setDuplicateNotice(recordDuplicateZh.staged);
    } catch (reason) { setError(errorMessage(reason)); }
  }
  /** 第一个await前占门并捕获意图；成功只追加一次，取消后等服务器实际收尾再解锁。 */
  async function readCompleteCopySource() {
    if (copyPendingRef.current) return;
    const sourcePage = copyPage.current;
    let intent: RecordCopyReadIntent;
    try {
      assertGridWritable();
      const metadataReason = recordCopyMetadataReason(getRecordContext(), sourcePage, copySources.current?.source); if (metadataReason) throw new Error(metadataReason);
      if (record.hasInput() || rootElement.current?.querySelector('.grid-input') || document.querySelector('[role="dialog"]')) throw new Error(recordViewZh.resolveInput);
      const rowId = selectionRef.current?.rowId; if (!rowId) throw new Error(recordCopySourceZh.unavailable);
      intent = beginRecordCopyRead(rowsRef.current, rowId, getRecordContext(), selectionRef.current, copySources.current?.source, copyRowRefs.current.get(rowId), uid());
    } catch (reason) { setError(errorMessage(reason)); return; }
    copyReadIntent.current = intent; copyPendingRef.current = true; blockedRef.current = true; setCopyPending(true); setError(''); setDuplicateNotice(recordCopySourceZh.reading); useWorkspace.getState().setBusy(tab.id, true);
    try {
      const result = await invoke('table.copySourceRead', { connectionId: base.connectionId, taskId: intent.taskId, pageRef: intent.source.pageRef, rowRef: intent.rowRef });
      if (!mounted.current || copyPage.current !== sourcePage || recordCopyMetadataReason(getRecordContext(), copyPage.current, copySources.current?.source) || copyReadIntent.current !== intent || recordControllerRef.current?.hasInput() || rootElement.current?.querySelector('.grid-input') || document.querySelector('[role="dialog"]')) throw new Error(recordCopySourceZh.unavailable);
      // 本操作的占门不算外部忙碌；其余同步门与完整来源守卫仍必须全部通过。
      const context = { ...getRecordContext(), busy: loadingCount.current > 0 || referenceCount.current > 0 || applyingRef.current || preferencesLock.current || previewingRef.current || !!preview };
      const newId = uid(), next = consumeRecordCopyRead(intent, rowsRef.current, context, selectionRef.current, copySources.current?.source, copyRowRefs.current.get(intent.row.id), result, newId);
      copiedDraftIds.current.add(newId); setRows(next); setError(''); setDuplicateNotice(formatText(recordCopySourceZh.completed, result.readAt));
    } catch (reason) { if (mounted.current && copyReadIntent.current === intent) { setError(errorMessage(reason)); setDuplicateNotice(''); } }
    finally {
      if (copyReadIntent.current === intent) { copyReadIntent.current = null; copyPendingRef.current = false; if (mounted.current) setCopyPending(false); }
      blockedRef.current = loadingCount.current > 0 || referenceCount.current > 0 || applyingRef.current || preferencesLock.current || previewingRef.current || !!preview || copyPendingRef.current;
      useWorkspace.getState().setBusy(tab.id, blockedRef.current);
    }
  }
  /** 删除选中记录仅形成草稿，仍须预览并提交后才影响数据库。 */
  function deleteSelected() {
    try { assertGridWritable(); } catch (reason) { setError(errorMessage(reason)); return; }
    const targets = selectedRows.size ? selectedRows : new Set(selection ? [selection.rowId] : []);
    setRows(current => current.map(row => targets.has(row.id) ? { ...row, deleted: !row.deleted } : row));
  }
  /** 确认期间继续观察工作区，只有原保留页、选择和输入状态都有效时才发布新增草稿。 */
  function duplicateWorkspaceChecked(): void {
    const current = () => tableToolbarCurrent() && tableReadAction.current === tableReadRender &&
      !reloadBlocked() && !externalStale && !insertCopyBlockedRef.current && !activeGridEditor.current &&
      !record.hasInput() && !record.pending && rowsRef.current === rows && selectedRowsRef.current === selectedRows;
    if (!current()) return;
    try {
      assertPasteInsertTarget();
      const plan = tableEdits.planCheckedDuplication(rows, selectedRows, getRecordContext(), uid);
      let valid = true;
      const stop = useWorkspace.subscribe(() => { if (!current() || !plan.current()) valid = false; });
      try {
        if (!window.confirm(workspaceText.duplicateConfirm(plan.pages)) || !valid || !current() || !plan.current()) return;
      } finally { stop(); }
      setRows(plan.stage(), 'replay');
      setError('');
      setDuplicateNotice(formatText(workspaceText.duplicated, plan.pages.reduce((total, group) => total + group.count, 0)));
    } catch (reason) { setError(errorMessage(reason)); }
  }
  /** 使用确认时的活动页及后台缓存，原有 SQL 预览之前只改变本地草稿。 */
  function deleteWorkspaceChecked(): void {
    const current = () => tableToolbarCurrent() && tableReadAction.current === tableReadRender &&
      !reloadBlocked() && !externalStale && !activeGridEditor.current && !record.hasInput() && !record.pending &&
      rowsRef.current === rows && selectedRowsRef.current === selectedRows;
    if (!current()) return;
    try {
      assertGridWritable();
      const plan = tableEdits.planCheckedDeletion(rows, selectedRows);
      let valid = true;
      const stop = useWorkspace.subscribe(() => { if (!current() || !plan.current()) valid = false; });
      try {
        if (!window.confirm(workspaceText.deleteConfirm(plan.pages)) || !valid || !current() || !plan.current()) return;
      } finally { stop(); }
      const next = plan.stage();
      if (plan.pages.some(group => group.index === pageIndex)) setSelectedRows(new Set());
      setRows(next, 'replay');
      setError('');
    } catch (reason) { setError(errorMessage(reason)); }
  }
  /** 矩形优先，其余沿用勾选行或当前格；文本和类型化内容同时写入剪贴板。 */
  function copyCells({ row, column }: { row: DraftRow; column: { key: string } }, event: React.ClipboardEvent) {
    if (!selectedRows.size && !(page?.columns.some(item => item.key === column.key))) return;
    event.preventDefault();
    try {
      const selected = rangeCurrent() ? cellRange.copy(row, column.key, (item, key) => ownCell(item.data, key), item => item.deleted) : undefined;
      if (selected && !selected.values.length) return;
      const matrix = selected?.values ?? (selectedRows.size ? rows.filter(item => selectedRows.has(item.id)).map(item => visibleKeys.map(key => ownCell(item.data, key))) : [[ownCell(row.data, column.key)]]);
      const content = encodeClipboard(matrix); event.clipboardData.setData('text/plain', content.text); event.clipboardData.setData(cellClipboardType, content.typed);
    }
    catch (reason) { setError(errorMessage(reason)); }
  }
  /** 选区只授权这些行列，不改变原有勾选；整组通过批量预算后只写一步草稿。 */
  function fillGridRange(rectangle: GridCellRectangle, input: GridRangeFillInput) {
    const target = cellRange.capture(rectangle);
    if (!target || !editable) throw Error(rangeFillText.stale);
    const { kind, value } = input;
    if (kind === 'sequence') {
      const next = prepareBatchFillSequence(target, input, rows, getRecordContext());
      if (next !== rows) setRows(next);
      setError('');
      return;
    }
    if (kind === 'left' || kind === 'right') {
      const next = prepareBatchFillAcross(target, kind, rows, getRecordContext());
      if (next !== rows) setRows(next);
      setError('');
      return;
    }
    if (kind === 'down' || kind === 'up') {
      const plan = gridRangeFillSource(target, kind, row => row.deleted);
      if (plan.rows.some(row => !row.inserted && target.keys.some(key => !Object.hasOwn(row.data, key)))) throw Error(rangeFillText.target);
      const next = prepareBatchFillFromRow(target.keys, plan.source, rows, new Set(plan.rows.map(row => row.id)), getRecordContext());
      if (next !== rows) setRows(next);
      setError('');
      return;
    }
    if ((kind !== 'text' && kind !== 'null') ||
        target.rows.some(row => row.deleted || !row.inserted && target.keys.some(key => !Object.hasOwn(row.data, key)))) throw Error(rangeFillText.target);
    const next = prepareBatchFill(target.keys.map(column => ({ column, input: { mode: kind, text: value } })),
      rows, new Set(target.rows.map(row => row.id)), getRecordContext(), kind === 'text' && input.onlyNull);
    if (next !== rows) setRows(next);
    setError('');
  }

  function applyGridRangeFill(rectangle: GridCellRectangle, kind: GridRangeFillKind): void {
    try { fillGridRange(rectangle, { kind, value: '' }); }
    catch (reason) { setError(errorMessage(reason)); }
  }
  const headerCopyLayoutRevision = layoutRevision.current;
  /** 勾选记录不改变另存范围，仍绑定活动格及其当前草稿。 */
  function saveActiveCell(): void {
    if (!selection || !visibleKeys.includes(selection.key)) return;
    const row = rows.find(item => item.id === selection.rowId && !item.deleted);
    if (!row) return;
    const current = () => tableToolbarCurrent() && !blockedRef.current && !externalStale && !activeGridEditor.current && !record.hasInput() &&
      rowsRef.current === rows && selectionRef.current === selection && layoutRevision.current === headerCopyLayoutRevision;
    void saveGridCell(() => ownCell(row.data, selection.key), current);
  }
  /** 从当前页按显示顺序取值，JSON 和 CSV 复制记录的全部可见列。 */
  function copyTableData(mode: 'headers' | 'column' | 'json' | 'csv' | 'names'): void {
    const current = () => tableToolbarCurrent() && !blockedRef.current && !externalStale && !activeGridEditor.current && !record.hasInput()
      && (mode === 'names' ? !!page && tableReadAction.current === tableReadRender :
        rowsRef.current === rows && selectedRowsRef.current === selectedRows && selectionRef.current === selection)
      && layoutRevision.current === headerCopyLayoutRevision;
    if (!current()) return;
    try {
      if (mode === 'names') {
        copyGridColumnNames(visibleColumns.map(column => column.name), current);
        setError('');
        useWorkspace.getState().notify(headerCopyText.namesCopied);
        return;
      }
      const columns = mode === 'json' || mode === 'csv' || mode === 'headers' && selectedRows.size ? visibleColumns : visibleColumns.filter(column => column.key === selection?.key);
      const records = rows.filter(row => !row.deleted && (selectedRows.size ? selectedRows.has(row.id) : mode === 'column' || row.id === selection?.rowId));
      if (!columns.length || !records.length) throw Error(headerCopyText.stale);
      if (mode === 'json' || mode === 'csv') {
        const labels = mode === 'csv' ? csvCopyText : jsonCopyText;
        const encode = mode === 'csv' ? encodeGridCsv : encodeGridJson;
        if (selectedRows.size && selectedRows.size !== records.length) throw Error(labels.invalid);
        const content = encode(columns, records, (row, key) => ownCell(row.data, key));
        writeTableClipboardEvent(current, data => data.setData('text/plain', content));
        setError('');
        useWorkspace.getState().notify(labels.copied);
        return;
      }
      copyTableCells(records, columns, mode === 'headers', current);
    } catch (reason) { setError(errorMessage(reason)); }
  }
  /** 标题菜单与工具栏共享当前显示值、大小限制和应用内粘贴格式。 */
  function copyTableCells(records: readonly DraftRow[], columns: readonly { key: string; name: string }[], headers: boolean, current: () => boolean) {
    if (!columns.length || !records.length) throw Error(headerCopyText.stale);
    if ((records.length + Number(headers)) * columns.length > maxClipboardCells) throw Error(zh.clipboard.copyLimit);
    copyGridCells(records.map(row => columns.map(column => ownCell(row.data, column.key))), current,
      headers ? columns.map(column => column.name) : undefined);
    setError('');
  }
  /** 从标题定位列或行，勾选和布局变化后旧菜单不能读取新的范围。 */
  function tableHeaderDataActions(current: () => boolean, column?: { key: string; name: string }, row?: DraftRow) {
    const fields = column ? [column] : visibleColumns;
    if (!rows.length || !fields.length || row?.deleted) return [];
    const checked = row ? selectedRows.has(row.id) : selectedRows.size > 0;
    const allowed = () => current() && rowsRef.current === rows && selectedRowsRef.current === selectedRows &&
      layoutRevision.current === headerCopyLayoutRevision && !blockedRef.current && !externalStaleRef.current && !record.hasInput();
    return gridHeaderDataCopyActions(!!column, headers => {
      if (!allowed()) return;
      try {
        const records = row && !checked ? [row] : rows.filter(item => !item.deleted && (!checked || selectedRows.has(item.id)));
        copyTableCells(records, fields, headers, allowed);
      } catch (reason) { if (allowed()) setError(errorMessage(reason)); }
    });
  }
  /** 原生粘贴事件提供内容，完全不依赖被禁用的浏览器剪贴板权限。 */
  function pasteClipboard({ row, column }: { row: DraftRow; column: { key: string } }, event: React.ClipboardEvent) {
    event.preventDefault(); pendingPaste.current = null;
    if (!editable || blocked || referenceDialog) return row;
    if (record.hasInput()) { setError(recordViewZh.resolveInput); return row; }
    try {
      const target = cellRange.pasteTarget(row, column.key);
      let values = decodeClipboard(event.clipboardData.getData(cellClipboardType), event.clipboardData.getData('text/plain'));
      if (target) {
        const original = values;
        values = fitGridRangePaste(original, { rows: target.rows.length, columns: target.keys.length });
        // 单值铺满仍受原类型化剪贴板的累计字节限制。
        if (values !== original) encodeClipboard(values);
      }
      const updated = pasteCells(rows, visibleKeys, target?.rows[0].id ?? row.id, target?.keys[0] ?? column.key,
        values, new Set(info!.columns.filter(item => item.generated).map(item => item.name)));
      pendingPaste.current = updated; setError(''); return updated.find(item => item.id === row.id)!;
    } catch (reason) { setError(errorMessage(reason)); return row; }
  }
  /** 普通编辑仍由网格处理；二进制保留原复制粘贴，仅将文本输入和IME交回专用查看器边界。 */
  function handleGridKeyDown(args: CellKeyDownArgs<DraftRow>, event: CellKeyboardEvent) {
    const composing = tableCellKeyIsComposing(event.nativeEvent);
    if (args.mode !== 'ACTIVE') {
      // EDIT态的Enter也会被网格自动提交；组合输入只取消网格行为，原生输入仍继续。
      if (composing) event.preventGridDefault();
      return;
    }
    if (blocked || document.querySelector('[role=dialog]')) return;
    const { row: activeRow, column: activeColumn } = args;
    if (!activeRow || !activeColumn) return;
    const binary = isBinaryCell(ownCell(activeRow.data, activeColumn.key), info?.columns.find(item => item.name === activeColumn.key)?.type);
    if (binary && blocksBinaryTextInput(event)) event.preventGridDefault();
    // 二进制不进入普通编辑器；TEXT保留原生IME输入，但组合事件不能触发查看、查找、清空或预览。
    if (composing) { if (binary) event.preventGridDefault(); return; }
    const target = event.target;
    const historyAction = draftHistoryKey(event, target instanceof HTMLElement && !!target.closest('[role="grid"]') && !target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],.monaco-editor'));
    if (historyAction) {
      event.preventGridDefault(); event.preventDefault(); moveHistory(historyAction); return;
    }
    if ((event.ctrlKey || event.metaKey) && ['f', 'h'].includes(event.key.toLowerCase()) && !(event.target instanceof HTMLElement && event.target.closest('input,textarea,select,[contenteditable=true]'))) {
      event.preventGridDefault(); event.preventDefault(); openPageFind(event.key.toLowerCase() === 'h' ? 'replacement' : 'query');
    } else if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && specializedFieldEditor(activeRow, activeColumn.key)) {
      event.preventGridDefault(); event.preventDefault(); record.openCell(activeRow.id, activeColumn.key);
    } else if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey && binary) {
      event.preventGridDefault(); event.preventDefault(); record.openCell(activeRow.id, activeColumn.key);
    } else if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !event.shiftKey && !event.altKey
      && !cellRange.rectangle && cellReferenceKeys(activeRow, activeColumn.key).length) {
      event.preventGridDefault(); event.preventDefault(); event.stopPropagation();
      if (!event.repeat) openReference('choose', { row: activeRow, key: activeColumn.key });
    } else if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && changes.length) {
      event.preventGridDefault(); event.preventDefault(); void makePreview();
    } else if (event.key === 'Delete') {
      event.preventGridDefault(); event.preventDefault();
      // 矩形无效或带修饰键时，不能退化为只改活动格。
      if (event.repeat || cellRange.rectangle) return;
      const context = getRecordContext(), field = context.info?.columns.find(item => item.name === activeColumn.key), currentRow = rowsRef.current.find(row => row.id === activeRow.id);
      // 清空与编辑/粘贴共享当前列资格；缺结构、迟到行和记录输入不能被快捷键绕过。
      if (!editable || record.dirty || record.hasInput() || !field || currentRow !== activeRow || !page?.columns.some(item => item.key === activeColumn.key) || recordReadonlyReason(context, currentRow, activeColumn.key)) return;
      const value = field.nullable ? null : isBinaryCell(ownCell(currentRow.data, activeColumn.key), field.type) ? { type: 'binary' as const, base64: '' } : '';
      setRows(current => current.map(row => row.id === activeRow.id ? { ...row, data: { ...row.data, [activeColumn.key]: value } } : row));
    }
  }
  const cellActionMenu = useGridCellActionMenu();
  const quickValueRow = selection && rows.find(row => row.id === selection.rowId);
  function canSetQuickValue(kind: GridQuickValue, row = quickValueRow, key = selection?.key): boolean {
    const column = key && visibleKeys.includes(key) ? info?.columns.find(column => column.name === key) : undefined;
    return !!row && !!column && !gridEditing && !record.hasInput() &&
      !recordReadonlyReason(getRecordContext(), row, column.name) && mysqlQuickValueAllowed(column, kind);
  }
  function cellActionCurrent(row: DraftRow): boolean {
    // 数据格菜单以命中的行和列为准，焦点回到命中格时活动格可能变化。
    return tableTabCurrent() && sortScopeRef.current === sortScope && rowsRef.current === rows && rows.includes(row) && !row.deleted &&
      layoutRevision.current === headerCopyLayoutRevision && !blockedRef.current && !activeGridEditor.current && !record.hasInput();
  }
  /** 原格从工具栏选择或菜单事件传入，写入仍沿用表页单步撤销。 */
  function setQuickValueAt(row: DraftRow, key: string, kind: GridQuickValue): void {
    if (!cellActionCurrent(row) || !canSetQuickValue(kind, row, key)) return;
    const value = gridQuickValueAssignment(kind);
    if (ownCell(row.data, key) === value) return;
    setRows(rows.map(item => item === row ? { ...item, data: { ...item.data, [key]: value } } : item));
    setError('');
  }
  function setQuickValue(kind: GridQuickValue): void {
    if (selection && selectionRef.current === selection && quickValueRow) setQuickValueAt(quickValueRow, selection.key, kind);
  }
  /** 类型控件沿用准确行和可见列的字段弹窗，提交仍由原草稿流程处理。 */
  function specializedFieldEditor(row: DraftRow, key: string): string | undefined {
    const context = getRecordContext();
    if (!cellActionCurrent(row) || !visibleKeys.includes(key) || recordReadonlyReason(context, row, key)) return;
    const column = context.info?.columns.find(item => item.name === key);
    if (column?.enumeration) return enumerationText.choose;
    if (column && recordTemporalSpec(column.type, 'mysql')) return temporalText.action;
  }
  /** 命中列可能属于多个约束，仅列出可整组暂存的声明。 */
  function cellReferenceKeys(row: DraftRow, key: string): ForeignKeyInfo[] {
    const context = getRecordContext();
    if (!cellActionCurrent(row) || !visibleKeys.includes(key) || !context.info || recordReadonlyReason(context, row, key)) return [];
    const source = context.info;
    return referencesForColumn(source, key).keys.filter(reference => referenceWritable(source, reference));
  }
  function openCellActions(row: DraftRow | undefined, key: string | undefined, target: EventTarget | null, point?: { x: number; y: number }): boolean {
    if (!row || key === undefined || !visibleKeys.includes(key) || !cellActionCurrent(row)) return false;
    const rowIndex = rows.indexOf(row);
    const rectangle = cellRange.at(row, rowIndex, key), selectRow = cellRange.selectRowAction(row, rowIndex, key);
    const selectAll = cellRange.selectAllAction(row, rowIndex, key);
    const filters = canSeedCellFilter && info ? ([
      [false, cellFilterText.equal], [true, cellFilterText.exclude],
      ...tableCellTextActions,
      ...tableCellBoundActions,
    ] as const).flatMap(([mode, label]) => {
      try {
        tableCellFilterDraft(info.columns, rows, visibleKeys, { rowId: row.id, key }, mode);
        return [{ label, run: () => stageMenuCellFilter.current(mode, { row, key }) }];
      } catch { return []; }
    }) : [];
    const current = () => cellActionCurrent(row) && (!rectangle || cellRange.rectangleCurrent(rectangle));
    const sqlActions = tableRowSqlActions(row, current, rectangle);
    const fieldEditor = rectangle ? undefined : specializedFieldEditor(row, key);
    const chooseReference = !rectangle && cellReferenceKeys(row, key).length > 0;
    return cellActionMenu.open(target, grid.current?.element, { title: key, current, focusTarget: rectangle ? cellRange.focusTarget : undefined, actions: [
      ...(selectRow ? [selectRow] : []),
      ...(selectAll ? [selectAll] : []),
      ...(rectangle ? gridRangeCopyActions(format => {
        try {
          if (format === 'names') return copyGridRangeNames(cellRange.captureColumns(rectangle), visibleColumns, current);
          const selected = cellRange.copyRectangle(rectangle, (item, key) => ownCell(item.data, key), item => item.deleted);
          if (!selected?.values.length) return;
          const names = selected.columns.map(key => visibleColumns.find(column => column.key === key)!.name);
          if (format === 'csv' || format === 'json') copyGridRangeText(names, selected.values, format, current, value => value);
          else copyGridCells(selected.values, current, format === 'headers' ? names : undefined);
        } catch (reason) { if (current()) setError(errorMessage(reason)); }
      }) : []),
      ...sqlActions,
      ...(rectangle ? [{ label: rangeExportText.action, run: () => {
        if (pageExportRef.current) return;
        try {
          const range = cellRange.capture(rectangle, null);
          if (!range) throw Error(rangeExportText.stale);
          const data = snapshotGridRangeExport(range, visibleColumns, (item, key) => ownCell(item.data, key), item => item.deleted);
          if (!current()) return;
          const lease = { data, selected: false, scope: 'rectangle' as const };
          pageExportRef.current = lease;
          setPageExport(lease);
        } catch (reason) { if (current()) setError(errorMessage(reason)); }
      } }] : []),
      ...(rectangle && editable ? gridRangeFillActions(rectangle, kind => applyGridRangeFill(rectangle, kind)) : []),
      ...(rectangle && selectedFilterReady ? tableRangeFilterActions(rectangle, () => cellRange.capture(rectangle, null),
        current, {
          members: (range, exclude, guard) => openRangeFilter.current(range, exclude, guard),
          bounds: captureRangeBounds,
        }) : []),
      { label: quickValueText.copyCell, run: () => {
        try { copyGridCellValue(ownCell(row.data, key), current); }
        catch (reason) { if (current()) setError(errorMessage(reason)); }
      } },
      ...filters,
      ...(chooseReference ? [{ label: referenceZh.choose, run: () => {
        if (current()) openCellReference.current('choose', { row, key });
      } }] : []),
      ...(fieldEditor ? [{ label: fieldEditor, run: () => {
        if (current() && specializedFieldEditor(row, key) === fieldEditor) record.openCell(row.id, key);
      } }] : []),
      ...gridQuickValueKinds.map(kind => ({ label: quickValueText[kind], disabled: !canSetQuickValue(kind, row, key), run: () => setQuickValueAt(row, key, kind) })),
      { label: gridCellFileZh.action, disabled: ownCell(row.data, key) == null,
        run: () => { void saveGridCell(() => ownCell(row.data, key), current); } },
    ] }, point);
  }
  /** 单元格弹窗也使用相同 UUID、代次与输入缓冲，关闭不会无提示丢稿。 */
  function editCell() { if (selection && !blockedRef.current) record.openCell(selection.rowId, selection.key); }
  /** 固定预览草稿与代次；先处理输入，且在第一个 await 前阻止重复读取和后续编辑。 */
  async function makePreview(afterInputConfirmation = false) {
    if (applyRecovery.locked) { setError(tableApplyRecoveryZh.blocked); return; }
    if (previewingRef.current || applyingRef.current || preview || referenceCount.current > 0 || (!afterInputConfirmation && document.querySelector('[role="dialog"]'))) return;
    if (record.hasInput()) { record.request(() => void makePreview(true)); return; }
    let snapshot: RecordPagePreview;
    let workspace: TableEditBatch | undefined;
    try { const context = getRecordContext(); tableEdits.remember(rowsRef.current, selectedRowsRef.current, selectionRef.current, copiedDraftIds.current); workspace = tableEdits.batch(rowsRef.current); snapshot = captureRecordPagePreview(workspace?.rows ?? rowsRef.current, context); if (!snapshot.changes.length) return; const copied = new Set([...tableEdits.pages.flatMap(page => [...page.copied]), ...copiedDraftIds.current]); assertCopiedRecordKeys(snapshot.rows, context.info!, copied); }
    catch (reason) { setError(errorMessage(reason)); return; }
    previewingRef.current = true; blockedRef.current = true; setPreviewing(true); setError(''); useWorkspace.getState().setBusy(tab.id, true);
    try {
      const view = await invoke('table.preview', { ...base, changes: snapshot.changes });
      if ((!workspace ? snapshot.rows !== rowsRef.current : !workspace.current()) || snapshot.generation !== loadGeneration.current || snapshot.connectionVersion !== recordContextRef.current.connectionVersion || recordContextRef.current.stale) throw new Error(recordViewZh.previewChanged);
      setPreview({ view: snapshot.rows.some(row => copiedDraftIds.current.has(row.id) && row.inserted && !row.deleted) ? { ...view, warnings: [...view.warnings, recordDuplicateZh.previewHint] } : view, snapshot, ...(workspace ? { workspace } : {}) });
    } catch (reason) { setError(errorMessage(reason)); }
    finally { previewingRef.current = false; setPreviewing(false); useWorkspace.getState().setBusy(tab.id, loadingCount.current > 0 || referenceCount.current > 0 || applyingRef.current || preferencesLock.current || copyPendingRef.current); }
  }
  /** 最终确认只投递一次；异常后以独立回执核终态，未知或已提交的旧草稿不能再次预览。 */
  async function apply() {
    if (!preview || applyingRef.current || previewingRef.current || applyRecovery.locked) return;
    let fixedChanges, attempt: TableApplyRecoveryTicket;
    const scope = { target: getRecordContext().target, connectionVersion: getRecordContext().connectionVersion }, originalRows = rowsRef.current, generation = loadGeneration.current;
    const ownerCurrent = () => (useWorkspace.getState().connectionVersions[tab.connectionId] ?? 0) === scope.connectionVersion && useWorkspace.getState().settings.tabs.find(item => item.id === tab.id) === tab && mounted.current && rowsRef.current === originalRows && loadGeneration.current === generation && recordTargetKey(recordContextRef.current.target) === recordTargetKey(scope.target) && recordContextRef.current.connectionVersion === scope.connectionVersion;
    const taskId = uid();
    try { if (preview.workspace && !preview.workspace.current()) throw Error(workspaceText.stale); fixedChanges = consumeRecordPagePreview(preview.snapshot, preview.workspace?.rows ?? rowsRef.current, getRecordContext()); attempt = applyRecovery.begin(scope, taskId, preview.view.previewId, fixedChanges, preview.view.statements.length); }
    catch (reason) { setError(errorMessage(reason)); return; }
    tableEdits.clearHistory(); history.clear(); publishApplyRecovery();
    applyingRef.current = true; blockedRef.current = true; setApplying(true); setError(''); useWorkspace.getState().setBusy(tab.id, true);
    setApplyTaskId(taskId); receiptTaskRef.current = taskId; setLastReceiptId(''); setCommitLocked(false);
    try {
      const result = await invoke('table.apply', { ...base, changes: fixedChanges, taskId, previewId: preview.view.previewId, includeWriteTrace: true });
      if (result.writeOutcome) readHistory.recordWrite(result.writeTrace, result.writeOutcome);
      if (result.applyError !== undefined) throw Error(result.applyError);
      const confirmed = applyRecovery.succeeded(attempt, result); publishApplyRecovery();
      if (!confirmed) { setError(tableApplyRecoveryZh.receiptUnavailable); return; }
      setLastReceiptId(result.receiptId ?? applyRecovery.view.operationId ?? ''); setPreview(null);
      useWorkspace.getState().notify(result.receiptSaved === false ? tableApplyReceiptZh.committedRecordFailed : result.cleanupWarning ? tableApplyReceiptZh.committedCleanupWarning : formatText(zh.table.text003, result.affectedRows), result.receiptSaved === false || result.cleanupWarning === true);
      if (applyRecovery.view.outcome === 'committed') { checkedExport.clear(); if (ownerCurrent()) await load(); }
    } catch (reason) {
      setError(errorMessage(reason));
      let receipt: unknown;
      try { const records = await invoke('table.applyReceipt.list', { taskId }); if (records.items[0]) receipt = records.items[0]; } catch { /* 缺少回执仍保持未知，不按错误文字猜测回滚。 */ }
      const outcome = applyRecovery.failed(attempt, receipt); publishApplyRecovery(); setLastReceiptId(applyRecovery.view.operationId ?? '');
      if (outcome === 'committed') checkedExport.clear();
      if (outcome === 'committed' && ownerCurrent()) { setPreview(null); useWorkspace.getState().notify(tableApplyRecoveryZh.recoveredCommitted); await load(); }
    }
    finally { applyingRef.current = false; setApplying(false); publishApplyRecovery(); useWorkspace.getState().setBusy(tab.id, loadingCount.current > 0 || referenceCount.current > 0 || preferencesLock.current || copyPendingRef.current); }
  }
  /** 核对后的读取仍绑定本render／原活动标签；确认不能授权后来目标或自动重放。 */
  function reloadAfterApply(): void {
    const current = () => mounted.current && tableReadAction.current === tableReadRender && useWorkspace.getState().settings.activeTabId === tab.id && useWorkspace.getState().settings.tabs.find(item => item.id === tab.id) === tab && !reloadBlocked() && applyRecovery.view.epoch === recoveryView.epoch;
    if (canReload(undefined, current)) { checkedExport.clear(); void load(); }
  }
  insertCopyBlockedRef.current = observedRefresh.current !== refreshVersion || blocked || gridEditing || record.dirty || record.pending || record.cellKey !== null || !!record.nodeInput || !!record.structureInput || !!record.documentInput || showPreferences || !!referenceDialog || !!pasteInsertDialog || !!batchFillDialog || !!recordBatchDialog || settings.activeTabId !== tab.id || !page;
  const historyBlocked = !!templateDialog || blocked || !editable || record.dirty || record.pending || gridEditing || showPreferences || !!referenceDialog || !!pasteInsertDialog || !!batchFillDialog || !!recordBatchDialog || record.cellKey !== null || !!record.nodeInput || !!record.structureInput || settings.activeTabId !== tab.id;
  // 菜单和原生命令绑定同一个表页快照，切页、改草稿、改选区或换连接后旧入口立即失效。
  const tableToolbarScope = useMemo(() => ({}), [tab, connection, connectionVersion, refreshVersion, info, page, rows, selection, selectedRows, settings.activeTabId, blocked, gridEditing, record.dirty, record.pending, showPreferences, referenceDialog, pasteInsertDialog, historyBlocked, sortScope]);
  const tableToolbarOwner = useRef({ scope: tableToolbarScope, revision: 0 });
  if (tableToolbarOwner.current.scope !== tableToolbarScope) tableToolbarOwner.current = { scope: tableToolbarScope, revision: tableToolbarOwner.current.revision + 1 };
  const tableToolbarContextKey = JSON.stringify([tab.id, connectionVersion, refreshVersion, tableToolbarOwner.current.revision]);
  /** 执行前读取同步工作区，不能将原菜单动作转交给后来选中的表或隐藏标签。 */
  function tableTabCurrent(allowDialog = false): boolean {
    const state = useWorkspace.getState();
    return mounted.current && state.settings.activeTabId === tab.id
      && state.settings.tabs.find(item => item.id === tab.id) === tab && state.connections.find(item => item.id === tab.connectionId) === connection
      && (state.connectionVersions[tab.connectionId] ?? 0) === connectionVersion
      && (allowDialog || !document.querySelector('[role="dialog"], [role="alertdialog"]'));
  }
  function tableToolbarCurrent(): boolean {
    return tableToolbarOwner.current.scope === tableToolbarScope && tableTabCurrent();
  }
  /** 矩形只提供涉及的行，原值和字段范围继续由行 SQL 生成器核对。 */
  function tableRowSqlActions(row: DraftRow | undefined, current: () => boolean, rectangle?: GridCellRectangle, checked = false) {
    if (!rows.length || row?.inserted || info?.objectKind !== 'table' || insertCopyBlockedRef.current || restoredDraftView || copyMetadataReason) return [];
    const menu = { current, ids: () => {
      if (checked) return selectedRows;
      if (!rectangle) return new Set(row ? [row.id] : rows.map(item => item.id));
      const range = cellRange.capture(rectangle, null);
      return range && new Set(range.rows.map(item => item.id));
    } };
    return gridRowSqlActions(rectangle ? 'range' : checked ? 'selected' : row ? 'current' : 'all', () => handleRowSql('insert', 'clipboard', menu),
      info.primaryKey.length ? () => handleRowSql('update', 'clipboard', menu) : undefined);
  }
  /** 菜单与原列头点击共用丢稿确认及分页读取，确认返回后仍检查菜单来源。 */
  function applyGridSort(next: readonly SortColumn[], guard?: () => boolean): void {
    if (tableReadAction.current !== tableReadRender) return;
    try {
      const checked = tableSortFromGrid(next, sort, info?.columns.map(column => column.name) ?? []);
      if (canReload(undefined, guard)) { setSort(checked); setPageIndex(1); }
    } catch (reason) { setError(errorMessage(reason)); }
  }
  const height = readGridRowHeight(preferences.rowHeight);
  const zoom = useGridZoom();
  const dimensions = gridZoomDimensions(zoom.percent, height, showFieldType && showFieldComment ? 52 : 42);
  const gridSort = sort.map(({ column, direction }) => ({ columnKey: column, direction }));
  const { sizeDialog, reorderColumns, ...headerMenu } = useGridHeaderMenu(cellActionMenu.open, {
    owner: sortScope, grid: () => grid.current?.element, column: index => visibleColumns[index - 1],
    columnNameDialect: 'mysql',
    sort: gridSort, current: () => tableToolbarCurrent() && !reloadBlocked() && !activeGridEditor.current,
    canSort: () => sortPanelAvailable, applySort: applyGridSort,
    selectColumn: index => cellRange.selectColumnAction(index - 1),
    columnActions: (column, current) => [
      ...tableHeaderDataActions(current, column), ...tableRowSqlActions(undefined, current, undefined, selectedRows.size > 0),
    ],
    findColumn: page ? key => openPageFind('query', key) : undefined,
    visibility: page && !blocked ? { showType: showFieldType, showComment: showFieldComment,
      onShowTypeChange: setShowFieldType, onShowCommentChange: setShowFieldComment } : undefined,
    rowActions: (index, current) => {
      const row = rows[index];
      if (!row || !cellActionCurrent(row)) return [];
      const allowed = () => current() && cellActionCurrent(row);
      return [...tableHeaderDataActions(allowed, undefined, row), ...tableRowSqlActions(row, allowed, undefined, selectedRows.has(row.id))];
    },
    zoom,
    resizeRows: page && !externalStale && !preferencesLoading && !preferencesLock.current ? { height,
      apply: next => updatePreferences(setTableRowHeight(preferencesRef.current, next)),
    } : undefined,
    resizeColumn: page && !externalStale && !preferencesLoading && !preferencesLock.current ? (key, width) => {
      try { updatePreferences(changeTablePreference(preferencesRef.current, key, { width })); }
      catch (reason) { setPreferencesError(errorMessage(reason)); }
    } : undefined,
    columnVisibility: {
      current: () => !!page && !externalStale && !preferencesLoading && !preferencesLock.current && !record.hasInput(),
      canHide: visibleColumns.length > 1, hasHidden: preferences.columns.some(column => column.hidden),
      apply: key => {
        try { updatePreferences(setTableHeaderColumnVisibility(preferencesRef.current, key)); }
        catch (reason) { setPreferencesError(errorMessage(reason)); }
      },
    },
    reorderColumns: (from, to) => {
      if (preferencesLoading || externalStale || preferencesLock.current || record.hasInput() ||
          !visibleKeys.includes(from) || !visibleKeys.includes(to)) return;
      updatePreferences(moveTableColumn(preferencesRef.current, from, to));
    },
    frozenThrough: frozenKeys.at(-1), freeze: {
      current: () => !!page && !externalStale && !preferencesLoading && !preferencesLock.current,
      // 和布局窗口共享同一草稿，保存仍由用户从布局入口触发。
      apply: key => {
        try { updatePreferences(setTableFrozenThrough(preferencesRef.current, key)); }
        catch (reason) { setPreferencesError(errorMessage(reason)); }
      },
    },
  });
  /** 表头适宽沿用当前表布局草稿，只改分隔线所属的可见列。 */
  function fitHeaderColumn(event: React.MouseEvent): void {
    const index = gridResizeHandleColumn(event, grid.current?.element);
    if (index === undefined || !tableToolbarCurrent() || activeGridEditor.current || record.hasInput()) return;
    const column = visibleColumns[index - 1], source = columnFitSource();
    if (!column || !source) return;
    try {
      const width = fitGridColumnWidths({ ...source, zoomPercent: zoom.percent }, new Set([column.key])).get(column.key)!;
      if (columns[index].width === width) return;
      updatePreferences(changeTablePreference(preferencesRef.current, column.key, { width }));
    } catch { setPreferencesError(gridColumnWidthBatchZh.fitUnavailable); }
  }
  useUiCommandScope(`tab:${tab.id}`, {
    'sql-goto-line': { enabled: rows.length > 0 && !rowJumpDisabled, run: () => { if (tableToolbarCurrent()) openFocusedGridRowJump(); } },
    find: { enabled: !!page && !blocked, run: () => { if (tableToolbarCurrent()) openPageFind(); } },
    replace: { enabled: !!page && editable && !blocked, run: () => { if (tableToolbarCurrent()) openPageFind('replacement'); } },
    import: { enabled: !!connection, run: () => { if (tableToolbarCurrent()) onTransfer('import'); } },
    export: { enabled: !!connection, run: () => { if (tableToolbarCurrent()) onTransfer('export'); } }
  }, { active: settings.activeTabId === tab.id, contextKey: tableToolbarContextKey });

  /** 刷新沿原页与已应用条件，放弃草稿前后都复核标签及连接归属。 */
  function refreshTable() {
    if (canReload(undefined, () => tableToolbarCurrent() && !reloadBlocked())) { checkedExport.clear(); void load(); }
  }

  return <div ref={rootElement} className="workspace-tab table-tab" data-table-find-scope onKeyDown={event => {
    if (!blocked && tableRefreshShortcut(event)) refreshTable();
    if (!blocked && !gridEditing && tableToolbarCurrent() && tableObjectQueryShortcut(event)) openTableObjectQuery(tab, connectionVersion);
  }}>{cellActionMenu.menu}{sizeDialog}<div className="context-bar"><span className="connection-dot" style={{ background: connection?.color }}/><strong>{connection?.name ?? zh.common.connectionDeleted}</strong><span className="breadcrumb-divider">/</span>{tab.database}<span className="breadcrumb-divider">/</span><strong>{tab.table}</strong>{lastReceiptId && <button disabled={applying} onClick={() => setShowReceipt(true)}>{tableApplyReceiptZh.openCurrent}</button>}<span className="grow"/><span className="tag">{info?.engine || zh.table.text004}</span></div><AdaptiveToolbar className="table-command-toolbar" ariaLabel={tableToolbarZh.title} contextKey={tableToolbarContextKey} isCurrent={tableToolbarCurrent} moreDisabled={gridEditing}
  items={[
    { key: 'refresh', content: (<button data-table-refresh title={navigationZh.tableRefreshShortcut} onClick={refreshTable} disabled={blocked}><RefreshCw size={14}/>{zh.common.refresh}</button>) },
    { key: 'read-history', content: <button type="button" disabled={blocked} onClick={() => readHistory.setOpen(true)}>{tableReadHistoryZh.title}</button> },
    { key: 'insert', content: (<button disabled={!editable || blocked} onClick={addRow}><Plus size={14}/>{zh.common.add}</button>) },
    { key: 'delete', content: (<button disabled={!editable || (!selection && !selectedRows.size) || blocked} onClick={deleteSelected}><Trash2 size={14}/>{zh.common.delete}</button>) },
    { key: 'filter', content: (<button className={showFilter || filters.length ? 'selected' : ''} onClick={() => { setCellFilterSeed(undefined); setShowFilter(!showFilter); }}><Filter size={14}/>{zh.table.text006}{filters.length > 0 ? ` (${filters.length})` : ''}</button>) },
    { key: 'sort', content: (<button aria-label={sortText.entry} title={sortText.hint} className={sortPanel || sort.length ? 'selected' : ''} disabled={!sortPanelAvailable} onClick={openSortPanel}>{sortText.entry}{sort.length ? ` (${sort.length})` : ''}</button>) },
    { key: 'import', content: (<button onClick={() => onTransfer('import')}><ArrowDownToLine size={14}/>{zh.common.import}</button>) },
    { key: 'export', content: (<button onClick={() => onTransfer('export')}><ArrowUpFromLine size={14}/>{zh.common.export}</button>) }
  ]}
  more={<>
    <ActionMenuSection label={tableToolbarZh.editing}><button aria-label={recordDuplicateZh.action} title={copyMetadataReason || (copySourceReady ? recordCopySourceZh.hint : recordDuplicateReadonlyReason(getRecordContext(), referenceRow) || recordDuplicateZh.hint)} disabled={blocked || record.dirty || !!copyMetadataReason || (!!recordDuplicateReadonlyReason(getRecordContext(), referenceRow) && !copySourceReady)} onClick={duplicateCurrentRow}><CopyPlus size={14}/>{recordDuplicateZh.action}</button>
<button aria-label={recordDuplicateZh.batchAction} title={recordDuplicateZh.batchHint} disabled={!editable || insertCopyBlockedRef.current || !selectedRows.size} onClick={duplicateSelectedRows}><CopyPlus size={14}/>{recordDuplicateZh.batchAction}</button>
<button aria-label={pasteInsertZh.action} disabled={!editable || blocked || record.dirty || !!pasteInsertDialog} onClick={openPasteInsert}>{pasteInsertZh.action}</button>
<button aria-label={recordTemplatesZh.open} disabled={!editable || blocked || record.dirty || gridEditing || !!templateDialog} onClick={openRecordTemplates}>{recordTemplatesZh.open}</button>
<button aria-label={recordBatchEditZh.action} disabled={!editable || insertCopyBlockedRef.current || !selectedRows.size} onClick={() => openRecordBatch()}>{recordBatchEditZh.action}</button>
<button aria-label={recordBatchFillZh.action} disabled={!editable || insertCopyBlockedRef.current || !selectedRows.size} onClick={() => openBatchFill('page')}>{recordBatchFillZh.action}</button>
{gridQuickValueKinds.map(kind => <button key={kind} type="button" title={quickValueText[`${kind}Hint`]}
  disabled={!canSetQuickValue(kind)} onClick={() => setQuickValue(kind)}>{quickValueText[kind]}</button>)}
<button aria-label={draftHistoryZh.undo} title={draftHistoryZh.limit} disabled={!history.status.undo || historyBlocked} onClick={() => moveHistory("undo")}>{draftHistoryZh.undo} ({history.status.undo})</button>
<button aria-label={draftHistoryZh.redo} title={draftHistoryZh.limit} disabled={!history.status.redo || historyBlocked} onClick={() => moveHistory("redo")}>{draftHistoryZh.redo} ({history.status.redo})</button>
<button aria-label={savedDraftText.save} disabled={historyBlocked || !changes.length} onClick={() => openSavedDraft('save')}>{savedDraftText.save}</button>
<button aria-label={savedDraftText.open} title={changes.length ? savedDraftText.existing : undefined} disabled={historyBlocked || !!changes.length} onClick={() => openSavedDraft('restore')}>{savedDraftText.open}</button>
{restoredDraftView && <button disabled={blocked} onClick={() => { if (canReload()) void load(); }}>{savedDraftText.leaveRestore}</button>}</ActionMenuSection>
    <ActionMenuSection label={tableToolbarZh.display}><button className={record.formOpen ? 'selected' : ''} disabled={!page || blocked} onClick={() => { if (record.formOpen) record.closeForm(); else record.openForm(selection?.rowId); }}>{recordViewZh.title}</button>
<button disabled={!selection || blocked} onClick={editCell}><Eye size={14}/>{zh.table.text005}</button>
<button aria-label={tableGridZh.find} title={tableGridZh.find} disabled={!page || blocked} className={showFind ? "selected" : ""} onClick={() => { if (showFind) { setShowFind(false); setFindDisplay(undefined); } else openPageFind(); }}>{tableGridZh.find}</button>
<button type="button" className={showGridImages ? 'selected' : undefined} aria-pressed={showGridImages} disabled={!page || blocked} onClick={() => setShowGridImages(value => !value)}>{gridImageText.gridImages}</button>
<button type="button" disabled={!page || blocked} onClick={() => setShowFieldType(value => !value)}>{showFieldType ? headerText.hideType : headerText.showType}</button>
<button type="button" disabled={!page || blocked} onClick={() => setShowFieldComment(value => !value)}>{showFieldComment ? headerText.hideComment : headerText.showComment}</button>
<button aria-label={tableGridZh.preferences} title={tableGridZh.preferences} disabled={!page || blocked || preferencesLoading} onClick={() => setShowPreferences(true)}>{tableGridZh.preferences}</button>
<button aria-label={tableStatisticsZh.title} title={tableStatisticsZh.title} disabled={!statisticsAvailable} onClick={() => openTableStatistics()}>{tableStatisticsZh.title}</button>
<button aria-label={tableValueOptionsZh.open} title={tableValueOptionsZh.scope} disabled={blocked || !connection || !info || !info.columns.some(column => tableValueOptionsColumnCapability(column.type) !== 'unsupported') || !['table', 'view'].includes(info.objectKind ?? '') || !page || externalStale || gridEditing || record.hasInput()} onClick={openTableValueOptions}>{tableValueOptionsZh.open}</button></ActionMenuSection>
    <ActionMenuSection label={tableToolbarZh.filter}><button type="button" aria-label={groupText.open} title={groupText.hint} className={filterGroup ? 'selected' : ''} disabled={!filters.length || !page || !info || blocked || externalStale || gridEditing || !!filterGroups} onClick={openFilterGroups}>{groupText.open}</button>
<button title={cellFilterText.hint} disabled={!cellFilterAvailable} onClick={() => stageCellFilter(false)}>{cellFilterText.equal}</button>
<button title={cellFilterText.hint} disabled={!cellFilterAvailable} onClick={() => stageCellFilter(true)}>{cellFilterText.exclude}</button>
<button aria-label={selectedFilterText.entry} title={selectedFilterText.hint} disabled={!selectedFilterAvailable} onClick={() => openSelectedFilter(false)}>{selectedFilterText.entry}</button>
<button aria-label={selectedFilterText.excludeEntry} title={selectedFilterText.hint} disabled={!selectedFilterAvailable} onClick={() => openSelectedFilter(true)}>{selectedFilterText.excludeEntry}</button>
{selectedRows.size === 2 && tableCheckedBoundsOptions.map(({ label, outside }) => <button key={label} type="button"
  title={selectedFilterText.checkedBoundsHint} disabled={!selectedFilterAvailable || !canSeedCellFilter} onClick={() => stageCheckedBounds(outside)}>{label}</button>)}</ActionMenuSection>
    <ActionMenuSection label={tableToolbarZh.references}><button aria-label={referenceZh.choose} title={referenceZh.choose} disabled={blocked || !referenceRow || referenceRow.deleted || !relatedKeys.some(key => info && referenceWritable(info, key))} onClick={() => openReference('choose')}>{referenceZh.choose}</button>
<button aria-label={referenceZh.browse} title={referenceZh.browse} disabled={blocked || !referenceRow || referenceRow.deleted || !relatedKeys.length} onClick={() => openReference('browse')}>{referenceZh.browse}</button>
<button aria-label={childReferencesZh.title} title={childReferencesZh.title} disabled={blocked || !connection || !referenceRow || referenceRow.deleted || referenceRow.inserted || info?.objectKind !== 'table' || !page || externalStale || gridEditing || record.hasInput()} onClick={openChildReferences}>{childReferencesZh.title}</button></ActionMenuSection>
    <ActionMenuSection label={tableToolbarZh.structure}><button disabled={!info || blocked} onClick={() => onDesign(!info?.engine)}><SlidersHorizontal size={14}/>{info && !info.engine ? zh.table.text007 : zh.table.text008}</button>
<button aria-label={relationshipDiagramZh.entry} disabled={info?.objectKind !== 'table' || blocked || externalStale || gridEditing || record.hasInput()} onClick={openRelationshipDiagram}>{relationshipDiagramZh.entry}</button>
<button title={columnPatchZh.title} aria-label={columnPatchZh.title} disabled={!info?.engine || blocked} onClick={onColumnPatches}>{columnPatchZh.title}</button>
<button title={indexPatchZh.title} aria-label={indexPatchZh.title} disabled={!info?.engine || blocked} onClick={onIndexPatches}>{indexPatchZh.title}</button>
<button title={foreignKeyPatchZh.title} aria-label={foreignKeyPatchZh.title} disabled={!info?.engine || blocked} onClick={onForeignKeyPatches}>{foreignKeyPatchZh.title}</button>
{info?.objectKind === 'table' && onTableChecks && <button title={tableChecksZh.entry} aria-label={tableChecksZh.entry} disabled={blocked} onClick={onTableChecks}>{tableChecksZh.entry}</button>}
<button title={tableRenameZh.title} aria-label={tableRenameZh.title} disabled={info?.objectKind !== 'table' || blocked} onClick={onTableRename}>{tableRenameZh.title}</button>
<button title={tableAutoIncrementZh.title} aria-label={tableAutoIncrementZh.title} disabled={info?.objectKind !== 'table' || blocked} onClick={onTableAutoIncrement}>{tableAutoIncrementZh.title}</button>
<button title={tableCommentZh.title} aria-label={tableCommentZh.title} disabled={info?.objectKind !== 'table' || blocked} onClick={onTableComment}>{tableCommentZh.title}</button>
<button title={tableDefaultEncodingZh.title} aria-label={tableDefaultEncodingZh.title} disabled={info?.objectKind !== 'table' || blocked} onClick={onTableDefaultEncoding}>{tableDefaultEncodingZh.title}</button></ActionMenuSection>
    <ActionMenuSection label={tableToolbarZh.generate}><button disabled={!connection || blocked || gridEditing}
      title={objectQueryShortcutLabel()} aria-keyshortcuts={objectQueryKeyShortcuts()}
      onClick={() => { if (tableToolbarCurrent()) openTableObjectQuery(tab, connectionVersion); }}>{objectQueryZh.entry}</button>
    <button disabled={!templateAvailable} onClick={openQueryTemplate}>{templateText.entry}</button>
<button disabled={!structureScriptAvailable} onClick={openStructureScript}>{schemaScriptLabel}</button>
<button aria-label={tableForeignKeyJoinZh.entry} title={tableForeignKeyJoinZh.scope} disabled={!foreignKeyJoinAvailable} onClick={() => openForeignKeyJoin()}>{tableForeignKeyJoinZh.entry}</button>
<button title={tableForeignKeyJoinZh.incomingScope} disabled={!incomingForeignKeyJoinAvailable} onClick={() => openForeignKeyJoin('incoming')}>{tableForeignKeyJoinZh.incomingEntry}</button>
<button title={tableForeignKeyJoinZh.manualScope} disabled={!incomingForeignKeyJoinAvailable} onClick={() => openForeignKeyJoin('manual')}>{tableForeignKeyJoinZh.manualEntry}</button>
<button aria-label={filteredSelectText.entry} title={filteredSelectText.hint} disabled={!filteredSelectAvailable} onClick={openFilteredSelect}>{filteredSelectText.entry}</button>
<button title={copyInsertSqlZh.policy} disabled={insertCopyBlockedRef.current || !selection} onClick={() => copyRowsAsInsert(false)}>{copyInsertSqlZh.current}</button>
<button title={copyInsertSqlZh.policy} disabled={insertCopyBlockedRef.current || !selectedRows.size} onClick={() => copyRowsAsInsert(true)}>{copyInsertSqlZh.selected}</button>
{onOpenGeneratedQuery && info?.objectKind === 'table' && <button title={copyInsertSqlZh.openHint} disabled={primaryKeyQueryDisabled}
  onClick={() => handleRowSql('insert', 'draft')}>{copyInsertSqlZh.open}</button>}
{info?.objectKind === 'table' && !!info.primaryKey.length && <>
  <button title={primaryKeyCopyZh.hint} disabled={primaryKeyQueryDisabled}
    onClick={() => handleRowSql('select', 'clipboard')}>{primaryKeyCopyZh.action}</button>
  <button title={updateSqlCopyZh.hint} disabled={primaryKeyQueryDisabled}
    onClick={() => handleRowSql('update', 'clipboard')}>{updateSqlCopyZh.action}</button>
  <button title={deleteSqlCopyZh.hint} disabled={primaryKeyQueryDisabled}
    onClick={() => handleRowSql('delete', 'clipboard')}>{deleteSqlCopyZh.action}</button>
  {onOpenGeneratedQuery && <>
    <button title={primaryKeyCopyZh.openHint} disabled={primaryKeyQueryDisabled}
      onClick={() => handleRowSql('select', 'draft')}>{primaryKeyCopyZh.open}</button>
    <button title={updateSqlCopyZh.openHint} disabled={primaryKeyQueryDisabled}
      onClick={() => handleRowSql('update', 'draft')}>{updateSqlCopyZh.open}</button>
    <button title={deleteSqlCopyZh.openHint} disabled={primaryKeyQueryDisabled}
      onClick={() => handleRowSql('delete', 'draft')}>{deleteSqlCopyZh.open}</button>
  </>}
</>}</ActionMenuSection>
    <ActionMenuSection label={tableToolbarZh.transfer}><button title={headerCopyText.hint} disabled={blocked || externalStale || gridEditing || record.hasInput() || (!selection && !selectedRows.size)} onClick={() => copyTableData('headers')}>{headerCopyText.action}</button>
<button title={headerCopyText.namesHint} disabled={blocked || externalStale || gridEditing || record.hasInput() || !page || !visibleColumns.length} onClick={() => copyTableData('names')}>{headerCopyText.names}</button>
<button title={headerCopyText.columnHint} disabled={blocked || externalStale || gridEditing || record.hasInput() || !visibleColumns.some(column => column.key === selection?.key)} onClick={() => copyTableData('column')}>{headerCopyText.column}</button>
<button title={jsonCopyText.hint} disabled={blocked || externalStale || gridEditing || record.hasInput() || (!selection && !selectedRows.size)} onClick={() => copyTableData('json')}>{jsonCopyText.action}</button>
<button title={csvCopyText.hint} disabled={blocked || externalStale || gridEditing || record.hasInput() || (!selection && !selectedRows.size)} onClick={() => copyTableData('csv')}>{csvCopyText.action}</button>
<button title={gridCellFileZh.hint} disabled={blocked || externalStale || gridEditing || record.hasInput() || !selection || !visibleKeys.includes(selection.key)} onClick={saveActiveCell}>{gridCellFileZh.action}</button>
{onTableCopyData && <button title={tableCopyDataZh.title} aria-label={tableCopyDataZh.title} disabled={info?.objectKind !== 'table' || blocked || gridEditing || record.dirty || record.pending || changes.length > 0 || showPreferences || !!referenceDialog || !!pasteInsertDialog} onClick={() => { if (!rootElement.current?.querySelector('.grid-input')) onTableCopyData(); }}>{tableCopyDataZh.title}</button>}
{onTableCopyStructure && <button title={tableCopyStructureZh.title} aria-label={tableCopyStructureZh.title} disabled={info?.objectKind !== 'table' || blocked || gridEditing || record.dirty || record.pending || changes.length > 0 || showPreferences || !!referenceDialog || !!pasteInsertDialog} onClick={() => { if (!rootElement.current?.querySelector('.grid-input')) onTableCopyStructure(); }}>{tableCopyStructureZh.title}</button>}
<button aria-label={filteredUpdateText.entry} title={filteredUpdateText.scope} disabled={!filteredUpdateAvailable} onClick={openFilteredUpdate}>{filteredUpdateText.entry}</button>
<button aria-label={filteredDeleteText.entry} title={filteredDeleteText.scope} disabled={!filteredDeleteAvailable} onClick={openFilteredDelete}>{filteredDeleteText.entry}</button>
<button aria-label={tableFilteredExportZh.entry} title={tableFilteredExportZh.scope} disabled={!filteredExportAvailable} onClick={openFilteredExport}>{tableFilteredExportZh.entry}</button>
<button title={pageExportText.hint} disabled={!pageExportAvailable} onClick={() => exportTablePage(false)}>{pageExportText.page}</button>
<button title={pageExportText.hint} disabled={!pageExportAvailable || !selectedRows.size} onClick={() => exportTablePage(true)}>{pageExportText.selected}</button><button aria-label={rowTransferText.entry} title={rowTransferText.hint} disabled={!rowTransferAvailable} onClick={() => openRowTransfer()}>{rowTransferText.entry}</button>
<button aria-label={resultInsertText.transferEntry} disabled={!incomingTransferAvailable} onClick={() => { if (incomingQuery) openRowTransfer(incomingQuery); }}>{resultInsertText.transferEntry}</button></ActionMenuSection>
    <ActionMenuSection label={tableToolbarZh.danger}>{onTableDrop && <button title={tableDropZh.title} aria-label={tableDropZh.title} disabled={info?.objectKind !== 'table' || blocked || gridEditing || record.dirty || record.pending || changes.length > 0 || showPreferences || !!referenceDialog || !!pasteInsertDialog} onClick={() => { if (!rootElement.current?.querySelector('.grid-input')) onTableDrop(); }}>{tableDropZh.title}</button>}
{onTableTruncate && <button title={tableTruncateZh.title} aria-label={tableTruncateZh.title} disabled={info?.objectKind !== 'table' || blocked || gridEditing || record.dirty || record.pending || changes.length > 0 || showPreferences || !!referenceDialog || !!pasteInsertDialog} onClick={() => { if (!rootElement.current?.querySelector('.grid-input')) onTableTruncate(); }}>{tableTruncateZh.title}</button>}</ActionMenuSection>
  </>}/>{preferencesDirty && <span className="muted small">{tableGridZh.unsaved}</span>}{showFilter && <TableFilterPanel applyShortcut seed={cellFilterSeed} columns={info?.columns.map(column => column.name) ?? []} filters={filters} mode={filterMode} disabled={blocked || !!filterGroups} onFiltersChange={changeFilters} onModeChange={changeFilterMode} pause={{ active: !!resumableFilters, available: filterPauseAvailable, onToggle: toggleFilterPause }}><TablePresetPanel target={base} connectionVersion={connectionVersion} refreshVersion={refreshVersion} columns={info?.columns.map(column=>column.name)??[]} configuration={{filters,filterMode,...(filterGroup?{filterGroup}:{}),sort,...(page&&!preferencesLoading?{layout:reconcileTablePreferences(page.columns.map(column=>column.key),preferences)}:{})}} layoutDirty={preferencesDirty} disabled={blocked||externalStale||!info||!!activeGridEditor.current||!!filterGroups} beforeApply={preparePresetApply} onApply={applyNamedPreset}/></TableFilterPanel>}{filterGroup && <p className="filter-value-hint" aria-label={groupText.structure}>{tableFilterGroupSummary(filterGroup)}</p>}{selectedFilter && <TableSelectedFilterPanel range={!!selectedFilter.rangeCurrent} proposal={selectedFilter.proposal} isCurrent={() => selectedFilterCurrent(selectedFilter)} onApply={() => applySelectedFilter(selectedFilter)} onClose={() => closeSelectedFilter(selectedFilter)}/>}{filterGroups && <TableFilterGroupsDialog filters={filterGroups.filters} mode={filterGroups.mode} initial={filterGroups.initial} isCurrent={() => filterGroupsCurrent(filterGroups)} onApply={next => applyFilterGroups(filterGroups, next)} onClose={() => closeFilterGroups(filterGroups)}/ >}{sortPanel && <TableSortPanel columns={sortPanel.columns} initial={sortPanel.sort} isCurrent={() => sortPanelCurrent(sortPanel)} onApply={next => applySortPanel(sortPanel, next)} onClose={() => closeSortPanel(sortPanel)}/>}{showFind && <PageFindPanel fieldColumns={visibleColumns} onFieldDisplay={setFieldFindDisplay} focusRequest={findFocus} checkedRows={checkedFindRows} rows={rows} keys={visibleKeys} info={info} generation={pageFindGeneration()} disabled={blocked || record.dirty || externalStale} replaceDisabled={!editable} onJump={jumpToMatch} onDisplay={setFindDisplay} getSelectionToken={() => selectionRef.current} onMatchRows={changeFindMatches} onApply={applyPagePlan} onFilter={() => setShowFilter(true)} onStageFilter={stageFindFilter}/>}{externalStaleState && <div className="info-strip">{columnPatchZh.staleTable}</div>}<TableEditWorkspaceBar pages={tableEdits.pages} current={tableEdits.selected} selected={selectedRows} changes={changes.length} stale={tableEdits.stale} disabled={blocked || gridEditing || applyRecovery.locked || !!record.pending} restored={tableEdits.restored} onFillChecked={editable ? () => openBatchFill('workspace') : undefined} onEditChecked={editable && !insertCopyBlockedRef.current ? () => openRecordBatch('workspace') : undefined} onDuplicateChecked={editable && !insertCopyBlockedRef.current ? duplicateWorkspaceChecked : undefined} onDeleteChecked={editable ? deleteWorkspaceChecked : undefined} onSelect={entry => restoredDraftView ? selectRestoredWorkspacePage(entry) : goToNumberedPage(entry.index)} onDiscard={discardWorkspacePage}/><TableApplyRecoveryBanner view={recoveryView} busy={blocked || !!preview || showReceipt} onRead={reloadAfterApply} onView={() => setShowReceipt(true)}/><ErrorBox message={error || references.error || preferencesError}/>{history.notice && <div className="info-strip" role="status">{history.notice}</div>}{duplicateNotice && <div className="info-strip" role="status">{duplicateNotice}{copyPending && <button onClick={() => { invalidateCopyRead(); setDuplicateNotice(recordCopySourceZh.cancelling); }}>{recordCopySourceZh.cancel}</button>}</div>}{info && !editable && <div className="info-strip">{recordReadonlyReason({ ...getRecordContext(), busy: false })}</div>}<div className="table-record-layout"><div className="table-grid-wrap" {...headerMenu} onDoubleClickCapture={fitHeaderColumn}>{busy && <div className="loading-overlay"><Spinner/></div>}<DataGrid<DraftRow, unknown, string> ref={grid} aria-label={tableGridZh.grid} onColumnResize={(column, width) => { if (!blocked && visibleKeys.includes(column.key)) { try { updatePreferences(changeTablePreference(preferencesRef.current, column.key, { width })); } catch (reason) { setPreferencesError(errorMessage(reason)); } } }} onColumnsReorder={reorderColumns} className={`results-grid rdg-${settings.theme} grid-zoomable grid-row-height-${height}${height >= 56 ? ' grid-row-multiline' : ''}`} style={dimensions.style} columns={columns} rows={rows} rowHeight={dimensions.rowHeight} headerRowHeight={dimensions.headerHeight} rowKeyGetter={row => row.id} rowClass={row => row.deleted ? 'row-deleted' : row.inserted ? 'row-inserted' : !rowEqual(row.original!, row.data) ? 'row-modified' : undefined} selectedRows={selectedRows} onSelectedRowsChange={setSelectedRows} onRowsChange={changeRows} onActivePositionChange={({ row, rowIdx, column }) => { cellRange.move(row, rowIdx, column?.key); selectCurrentCell(row, column?.key); }} onCellMouseDown={(args, event) => cellRange.mouse(args, event)} onCellClick={({ row, column }) => { recordPages.cancel(); selectCurrentCell(row, column.key); }} onCellDoubleClick={({ row, column }, event) => { if (!blocked && (specializedFieldEditor(row, column.key) || isBinaryCell(ownCell(row.data, column.key), info?.columns.find(item => item.name === column.key)?.type))) { event.preventGridDefault(); record.openCell(row.id, column.key); } }} sortColumns={gridSort} onSortColumnsChange={applyGridSort} onCellCopy={copyCells} onCellPaste={pasteClipboard} onCellContextMenu={({ row, column }, event) => {
    if (event.defaultPrevented || !openCellActions(row, column.key, event.target, { x: event.clientX, y: event.clientY })) return;
    event.preventGridDefault(); event.preventDefault(); event.stopPropagation();
  }} onCellKeyDown={(args, event) => {
    if (args.mode === 'ACTIVE' && cellRange.key(args, event)) return;
    if (args.mode === 'ACTIVE' && editable && cellRange.fillValueKey(args, event, (rectangle, kind) => {
      recordPages.cancel();
      applyGridRangeFill(rectangle, kind);
    })) return;
    if (args.mode === 'ACTIVE' && handleGridSelectAllKey(event,
      () => !!args.row && rows[args.rowIdx] === args.row && !!args.column && visibleKeys.includes(args.column.key) && rowSelectionCurrent(),
      () => setSelectedRows(gridRowKeys(rows, rowSelectionKey)))) return;
    if (isGridContextKey(event) && args.mode === 'ACTIVE' && !event.defaultPrevented && !event.isGridDefaultPrevented() &&
        openCellActions(args.row, args.column?.key, event.target)) {
      event.preventGridDefault(); event.preventDefault(); event.stopPropagation(); return;
    }
    recordPages.cancel(); handleGridKeyDown(args, event);
  }} renderers={{ noRowsFallback: <div className="grid-empty">{zh.common.noMatchingData}</div> }}/></div>{record.formOpen && <RecordFormPanel editor={record} context={getRecordContext()} rows={rows} visibleKeys={visibleKeys} pageNavigation={{ ...(tableEdits.selected ? { previousLabel: workspaceText.stagePrevious, nextLabel: workspaceText.stageNext } : {}), previous: !restoredDraftView && pageIndex > 1 && (rows.length === 0 || !!record.draft), next: !restoredDraftView && !!page?.hasMore && pageIndex < maxTablePage && !!record.draft, message: recordPageMessage.revision === recordPages.revision ? recordPageMessage.text : '', onNavigate: navigateRecordPage }} onSelect={rowId => { const key = selection?.key && visibleKeys.includes(selection.key) ? selection.key : visibleKeys[0]; if (key) jumpToMatch(rowId, key); }}/>}</div>{(page || checkedExport.value) && <TableCheckedExportActions collection={checkedExport.value}
      position={page?.page ?? -1} selected={selectedRows.size}
      ready={pageExportAvailable && settings.activeTabId === tab.id} hasDrafts={!!changes.length}
      onCollect={collectCheckedPage} onExport={exportCollectedPages}
      onClear={() => { if (checkedExportCurrent()) checkedExport.clear(); }}/>}
    <div className="table-action-bar mysql-table-page-status"><span className={changes.length ? 'warning-text' : 'muted'}>{changes.length ? formatText(zh.table.text015, changes.length) : formatText(zh.table.text016, page?.rows.length ?? 0)}</span>{record.dirty && <span className="warning-text">{recordViewZh.inputDirty}</span>}{(changes.length > 0 || record.dirty) && <><button disabled={blocked} onClick={() => { if (canReload()) void load(); }}><Undo2 size={13}/>{zh.table.text018}</button><button className="primary" disabled={blocked || applyRecovery.locked} onClick={() => void makePreview()}><Save size={13}/>{zh.table.text019}</button></>}<span className="grow"/><label className="inline-field">{zh.table.text020}<select ref={pageSizeSelect} aria-label={zh.table.text021} value={pageSizeDraft === null ? pageSize : 'custom'} disabled={blocked || restoredDraftView || gridEditing} onChange={event => changePageSize(event.target.value)}>{!tablePageSizePresets.includes(pageSize) && <option value={pageSize}>{pageSize}</option>}{tablePageSizePresets.map(size => <option key={size} value={size}>{size}</option>)}<option value="custom">{zh.table.customPageSize}</option></select>{zh.table.text022}</label>
      {pageSizeDraft !== null && <form className="page-jump" onSubmit={event => { event.preventDefault(); changePageSize(pageSizeDraft); }} onKeyDown={event => { if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); closePageSizeDraft(); } }}>
        <input autoFocus aria-label={zh.table.customPageSizeLabel} inputMode="numeric" maxLength={16} value={pageSizeDraft} disabled={blocked || restoredDraftView || gridEditing} onChange={event => { if (pageNavigationCurrent()) setPageSizeDraft(event.target.value); }}/>
        <button type="submit" disabled={blocked || restoredDraftView || gridEditing}>{zh.table.applyPageSize}</button>
        <button type="button" disabled={blocked || restoredDraftView || gridEditing} onClick={closePageSizeDraft}>{zh.common.cancel}</button>
      </form>}<GridRowJump grid={grid} scope={rowJumpScope} count={rows.length} disabled={rowJumpDisabled} onJump={jumpToGridRow}/>
      <GridColumnJump scope={rowJumpScope} columns={visibleColumns} disabled={rowJumpDisabled || !page}
        isCurrent={gridJumpCurrent} onJump={jumpToGridColumn}/>
      {editable && cellRange.rectangle && !rowJumpDisabled && <GridRangeFill rectangle={cellRange.rectangle} onStage={fillGridRange}/>}
      <GridRowSelectionActions rows={rows} selected={selectedRows} disabled={rowJumpDisabled}
        keyFor={rowSelectionKey}
        isCurrent={rowSelectionCurrent}
        onChange={setSelectedRows}/><form className="page-jump" title={zh.table.pageJumpHint} onSubmit={event => { event.preventDefault(); jumpToPage(); }}><input aria-label={zh.table.pageJumpLabel} inputMode="numeric" value={pageJump} disabled={blocked || restoredDraftView} onChange={event => setPageJump(event.target.value)}/><button type="submit" disabled={blocked || restoredDraftView}>{zh.table.pageJump}</button></form><button type="button" disabled={restoredDraftView || blocked || gridEditing || pageRequest === 1} onClick={() => goToNumberedPage(1)}>{zh.table.firstPage}</button><button className="icon-button" aria-label={zh.common.pagePrevious} disabled={restoredDraftView || pageIndex === 1 || blocked} onClick={() => goToNumberedPage(pageIndex - 1)}><ChevronLeft size={16}/></button><span>{restoredDraftView ? savedDraftText.restoredScope : <>{zh.table.text023}{pageIndex}{zh.table.text024}</>}</span><button className="icon-button" aria-label={zh.common.pageNext} disabled={restoredDraftView || !page?.hasMore || blocked || pageIndex >= maxTablePage} onClick={() => goToNumberedPage(pageIndex + 1)}><ChevronRight size={16}/></button>
      <button type="button" disabled={!lastPageAvailable} title={lastPageSupported ? zh.table.lastPageHint : zh.table.lastPageUnsupported} onClick={openLastPage}>{zh.table.lastPage}</button>
      {busy && renderedLastPageRead && <button type="button" disabled={lastPageStopping || renderedLastPageRead.finished} onClick={() => stopLastPage(renderedLastPageRead)}>{lastPageStopping ? zh.table.lastPageStopping : zh.table.lastPageStop}</button>}
      {countPageAvailable && !externalStale && page?.matchingRows !== undefined && <span title={zh.table.lastPageHint}>{formatText(zh.table.lastPageCount, page.matchingRows)}</span>}
      <button type="button" disabled={!statisticsAvailable || !countPageAvailable} title={tableStatisticsZh.countHint} onClick={() => openTableStatistics(true)}>{tableStatisticsZh.countTitle}</button>
      <span aria-live="polite" title={visiblePageCount === undefined ? undefined : tableStatisticsZh.recentCountHint}>{visiblePageCount === undefined ? '' : tableStatisticsZh.recentCount(visiblePageCount)}</span>
    </div>
    {rowTransferDialog && <ResultInsertDialog intent={rowTransferDialog} sourceMode="table-selection" fixed={incomingTransfer.current?.fixed} onActivity={rowTransferActivity} onClose={() => closeRowTransfer(rowTransferDialog)} onCommitted={output => {
      if (rowTransferIntent.current === rowTransferDialog && incomingTransfer.current) incomingTransfer.current.committed = true;
      useWorkspace.getState().notify(rowTransferText.committed(output.rows));
    }} onCleanupError={message => useWorkspace.getState().notify(message, true)}/>}
    {pageExport && <ResultExportDialog result={pageExport.data} tabId={tab.id} scope={pageExport.scope ?? 'table'} selected={pageExport.selected} allowSql={pageExport.scope !== 'collected'} onClose={() => { if (pageExportRef.current === pageExport) { pageExportRef.current = null; setPageExport(null); } }}/>}
    {queryTemplate && <TableQueryTemplateDialog info={queryTemplate.info} limit={queryTemplate.limit} isCurrent={() => queryTemplateCurrent(queryTemplate)} onOpen={(sql, kind, options) => openGeneratedQuery(queryTemplate, sql, kind, options)} onClose={() => closeQueryTemplate(queryTemplate)}/>}
    {filteredSelectDialog && <TableQueryTemplateDialog info={filteredSelectDialog.info} limit={filteredSelectDialog.limit} readScope={filteredSelectDialog.readScope} isCurrent={() => filteredSelectDialog.current()} onOpen={(sql, kind, options) => openFilteredSelectQuery(filteredSelectDialog, sql, kind, options)} onClose={() => closeFilteredSelect(filteredSelectDialog)}/>}
    {pasteInsertDialog && <PasteInsertDialog info={pasteInsertDialog.context.info!} visibleKeys={pasteInsertDialog.visible} invalidReason={pasteInsertDialog.reason(rowsRef.current, getRecordContext())} onStage={plan => stagePasteInsert(pasteInsertDialog, plan)} onClose={() => closePasteInsert(pasteInsertDialog)}/>}
    {templateDialog && <RecordTemplatesDialog key={templateDialog.lease.id} lease={templateDialog.lease} target={base} dialect="mysql" columns={templateDialog.columns} candidate={templateDialog.candidate} onStage={(content, count) => stageRecordTemplate(templateDialog, content, count)} onClose={() => closeRecordTemplates(templateDialog)}/>}
    {recordBatchDialog && <TableRecordBatchDialog key={recordBatchDialog.id} intent={recordBatchDialog} current={() => recordBatchCurrent(recordBatchDialog)} onStage={candidates => stageRecordBatch(recordBatchDialog, candidates)} onDirty={dirty => recordBatchDirty(recordBatchDialog, dirty)} onClose={() => closeRecordBatch(recordBatchDialog)}/>}
    {batchFillDialog && <TableBatchFillDialog intent={batchFillDialog} initialColumn={selection?.key} invalidReason={batchFillDialog.reason(rowsRef.current, selectedRowsRef.current, getRecordContext(), copyPage.current, page)} onStage={assignments => stageBatchFill(batchFillDialog, assignments)} onClose={() => closeBatchFill(batchFillDialog)}/>}
    <TableReadHistory history={readHistory}/>
    {showPreferences && <TablePreferencesDialog preferences={preferences} pending={preferencesPending} dirty={preferencesDirty} error={preferencesError} fitSource={columnFitSource} onChange={updatePreferences} onSave={() => void savePreferences()} onReset={() => void savePreferences(true)} onClose={() => { if (!preferencesLock.current) setShowPreferences(false); }}/ >}
    {referenceDialog && <ForeignKeyDialog base={base} snapshot={referenceDialog.snapshot} keys={referenceDialog.keys} mode={referenceDialog.mode} column={referenceDialog.column} onApply={applyReference} onClose={() => setReferenceDialog(null)} onActivity={referenceActivity}/ >}
    {childReferenceDialog && <ChildReferenceDialog base={base} intent={childReferenceDialog} onClose={() => closeChildReferences(childReferenceDialog)} onActivity={referenceActivity}/>}
    {foreignKeyJoinDialog?.mode === 'directory' && <IncomingForeignKeyJoinDialog intent={foreignKeyJoinDialog.intent} onProceed={foreignKeyJoinDialog.proceed}
      onClose={() => closeForeignKeyJoin(foreignKeyJoinDialog.intent)} onActivity={foreignKeyJoinActivity}/>}
    {foreignKeyJoinDialog?.mode === 'build' && <TableForeignKeyJoinDialog intent={foreignKeyJoinDialog.intent} fixed={foreignKeyJoinDialog.fixed} manual={foreignKeyJoinDialog.manual}
      onOpen={preview => 'parent' in preview && openForeignKeyJoinQuery(foreignKeyJoinDialog.intent, preview)} onClose={() => closeForeignKeyJoin(foreignKeyJoinDialog.intent)}
      onActivity={foreignKeyJoinActivity} onViewApplied={onViewApplied} onCleanupError={message => useWorkspace.getState().notify(message, true)}/>}
    {tableStatisticsDialog && <TableStatisticsDialog base={base} intent={tableStatisticsDialog.intent} onCount={tableStatisticsDialog.onCount} onClose={() => closeTableStatistics(tableStatisticsDialog.intent)} onActivity={referenceActivity}/>}
    {relationshipDialog && <RelationshipDiagramDialog connectionId={tab.connectionId} source={relationshipDialog.source} current={relationshipDialog.current} onActivity={referenceActivity}
      onJoin={onOpenGeneratedQuery && !record.dirty && !record.pending && !externalStale && (connection?.dialect === 'mysql' || connection?.dialect === 'mariadb')
        ? draft => openForeignKeyJoin('outgoing', { owner: relationshipDialog, draft }) : undefined}
      onClose={() => { if (relationshipRef.current === relationshipDialog) { relationshipRef.current = null; presetUiEpoch.current++; setRelationshipDialog(null); } }}/>}
    {tableValueOptionsDialog && <TableValueOptionsDialog target={base} source={tableValueOptionsDialog.intent.source} column={tableValueOptionsDialog.column} conditions={tableValueOptionsDialog.intent.conditions} isCurrent={() => tableValueOptionsDialog.intent.current()} services={tableValueOptionsServices} onApply={next => applyTableValueOptions(tableValueOptionsDialog.intent, next)} onClose={() => closeTableValueOptions(tableValueOptionsDialog.intent)} onCleanupError={message => useWorkspace.getState().notify(message, true)} onActivity={referenceActivity}/>}
    {filteredUpdateDialog && <TableFilteredUpdateDialog intent={filteredUpdateDialog} initialColumn={selection?.key} onActivity={referenceActivity} onClose={result => closeFilteredUpdate(filteredUpdateDialog,result)} onCommitted={(result,changed) => useWorkspace.getState().notify(changed?filteredUpdateText.committedChanged(result.rows):filteredUpdateText.committed(result.rows),changed)} onCleanupError={message => useWorkspace.getState().notify(message,true)}/>}
    {filteredDeleteDialog && <TableFilteredDeleteDialog intent={filteredDeleteDialog} onActivity={referenceActivity} onClose={result => closeFilteredDelete(filteredDeleteDialog,result)} onCommitted={(result,changed) => useWorkspace.getState().notify(changed?filteredDeleteText.committedChanged(result.rows):filteredDeleteText.committed(result.rows),changed)} onCleanupError={message => useWorkspace.getState().notify(message,true)}/>}
    {filteredExportDialog && <TableFilteredExportDialog dialect={connection?.dialect === 'mariadb' ? 'mariadb' : 'mysql'} intent={filteredExportDialog} onActivity={referenceActivity} onClose={() => closeFilteredExport(filteredExportDialog)} onCleanupError={message => useWorkspace.getState().notify(message, true)} onCommitted={(result, changed) => useWorkspace.getState().notify(changed ? tableFilteredExportZh.committedChanged(result.rows) : tableFilteredExportZh.completed(result.rows), changed)}/>}
    <RecordEditorDialogs editor={record} context={getRecordContext()} rows={rows}/>
    {draftDialog && <TableDraftDialog mode={draftDialog.mode} target={base} payload={draftDialog.payload} assertCurrent={() => assertSavedDraft(draftDialog)} onRestore={document => acceptSavedDraft(draftDialog, document)} onBusy={() => undefined} onClose={() => closeSavedDraft(draftDialog)}/>}
    {restoredDraftView && <div className="info-strip" role="status">{savedDraftText.restoredScope}</div>}
    {preview && <Modal title={zh.table.text031} wide onClose={() => { if (!applying) setPreview(null); }}><div className="modal-content"><p>{zh.table.text032}{preview.snapshot.changes.length}{zh.table.text033}</p>{preview.workspace && <p>{workspaceText.preview(preview.workspace.pages)}</p>}<p className="muted">{tableApplyReceiptZh.previewPrivacy}</p>{commitLocked && applying && <p>{tableApplyReceiptZh.phases.committing}</p>}{preview.view.warnings.map(warning => <p className="warning-text" key={warning}>{warning}</p>)}<SqlEditor value={preview.view.sql} height={280} readOnly/><ErrorBox message={error}/>{preview.snapshot.attempted && !applying && <p className="warning-text">{recordViewZh.applyAttempted}</p>}</div><footer className="modal-footer"><button disabled={applying} onClick={() => setPreview(null)}>{zh.common.backToEdit}</button><span className="grow"/>{applying && !commitLocked && <button onClick={() => void invoke('query.cancel', { taskId: applyTaskId }).catch(reason => setError(errorMessage(reason)))}>{zh.table.text034}</button>}<button className="primary" disabled={applying || preview.snapshot.attempted} onClick={() => void apply()}>{applying ? <Spinner text={zh.table.text035}/> : zh.common.confirmApply}</button></footer></Modal>}
    {showReceipt && <TableApplyReceiptsDialog initialOperationId={lastReceiptId} onClose={() => setShowReceipt(false)}/>}
  </div>;
}
