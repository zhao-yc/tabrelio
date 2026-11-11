import { queryViewFromEditor, type QueryViewDraft } from '../queryViewDraft';
import { queryViewDraftZh as queryViewText } from '../locales/queryViewDraft.zh-CN';
import { sqlClipboardStackAction } from '../sqlClipboardStack';
import { sqlQuotedCopyAction } from '../sqlQuotedCopy';
import { PostgresSearchRecordEditDialog, type PostgresQueryCellEdit, type PostgresQueryRangeEdit,
  type PostgresQueryRecordIntent } from './PostgresSearchRecordEditDialog';
import { postgresIdentifier } from '../../shared/postgresSql';
import type { PostgresResultOrigin } from '../../shared/postgresResultOrigins';
import { postgresResultOriginsZh as originsText } from '../locales/postgresResultOrigins.zh-CN';
import { PostgresResultOriginsDialog } from './PostgresResultOriginsDialog';
import type { PostgresQueryRecordPageInput } from '../../shared/postgresQueryRecord';
import { PostgresQueryReferenceDialog } from './PostgresQueryReferenceDialog';
import { postgresReferencePickerZh as referenceText } from '../locales/postgresReferencePicker.zh-CN';
import { handleQueryExecutionShortcut } from '../queryExecutionShortcut';
import { QueryResultNavigator } from './QueryResultNavigator';
import { PinnedResultRename } from './PinnedResultRename';
import { ResultSqlDialog } from './ResultSqlDialog';
import { focusQueryResultPane, focusQueryResultReplacement, handleQueryPaneShortcut, handleQueryResultReplaceShortcut, handleQueryResultShortcut, runFocusedQueryReplace } from '../queryResultShortcut';
import { appModalSelector, isAppModalNode } from '../modalSelectors';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type * as monaco from 'monaco-editor';
import type { ColumnWidths } from 'react-data-grid';
import { formatSqlEditor, type SqlFormattingMode } from '../sqlFormatting';
import { captureQueryFormattingOptions, type QueryFormattingOptions } from '../queryFormattingOptions';
import { QueryFormattingOptionsDialog } from './QueryFormattingOptionsDialog';
import { sqlFormattingZh } from '../locales/sqlFormatting.zh-CN';
import type { DataRow, PostgresResultSource, QueryOutcome, QueryResult, ResultColumn, ResultExportData, SqlSnippet } from '../../shared/contracts';
import { queryResultTitle } from '../../shared/queryResultTitle';
import { ResultArchiveDialog } from './ResultArchiveDialog';
import { resultArchiveZh as archiveText } from '../locales/resultArchive.zh-CN';
import { postgresTableLimits } from '../../shared/postgresTable';
import { postgresClipboardInput, postgresGridPasteMatrix } from '../postgresGridPaste';
import { postgresQueryRowSqlBuilders } from '../postgresCopyInsertSql';
import { openRowSqlDraft } from '../openRowSqlDraft';
import { postgresGridPasteZh as pasteText } from '../locales/postgresGridPaste.zh-CN';
import type { GridRangeTarget } from '../useGridCellRange';
import type { GridRangeFillInput } from '../gridRangeFill';
import type { PageTextPatch } from '../pageFindReplace';
import { postgresTableFindZh as findText } from '../locales/postgresTableFind.zh-CN';
import { PostgresTableFindPanel, type PostgresFindRequest } from './PostgresTableFindPanel';
import type { QueryParameterNames, QueryParameter } from '../../shared/queryParameters';
import type { SavedQueryNavigationSource } from '../../shared/savedQuerySearch';
import type { UiCommandId } from '../../shared/uiCommands';
import { sqlEditorZoomCommandIds, sqlLineCommandIds } from '../../shared/uiCommandIds';
import { uiCommandLabels } from '../../shared/uiCommands.zh-CN';
import { queryResultPresetValueSchema, type QueryResultPresetValue } from '../../shared/queryResultPresets';
import { QuerySaveCloseIntent, type QueryCloseRequest } from '../queryCloseIntent';
import { acquireWorkspaceBusy, flushSettings, useWorkspace, type WorkspaceTab } from '../store';
import { invoke, uid, errorMessage, ownCell } from '../lib';
import { postgresZh as text } from '../locales/postgres.zh-CN';
import { formatText, zh } from '../locales/zh-CN';
import { pinLimits, pinnedResultSnapshotName, pinnedResultTooltip, renamePinnedResult, snapshotQueryResult, type PinnedQueryResult } from '../queryPins';
import { QueryResultSnapshotIntent } from '../queryResultSnapshotIntent';
import { createDisplayedQueryResultSnapshot } from '../../shared/queryResultSnapshot';
import { queryResultSnapshotUiZh as snapshotText } from '../locales/queryResultSnapshot.zh-CN';
import { postgresRecordTransferZh as transferText } from '../locales/postgresRecordTransfer.zh-CN';
import { capturePostgresQueryTransfer, usePostgresRecordTransfer } from '../postgresRecordTransfer';
import { queryResultComparisonZh as comparisonText } from '../locales/queryResultComparison.zh-CN';
import { ResultExportSelection, type ResultGridSelection, type ResultSelectionBinding } from '../resultExport';
import { frozenQueryResultKeys, queryResultColumnKeys, queryResultColumnWidth, queryResultVisibleColumns, setQueryResultFrozenThrough, setQueryResultHeaderColumnVisibility, reorderQueryResultColumn, setQueryResultRowHeight, type QueryResultColumnLayout } from '../queryResultColumns';
import { captureQueryResultMemory, queryResultMemoryMatches } from '../queryResultMemory';
import { queryResultPresetsZh as presetsText } from '../locales/queryResultPresets.zh-CN';
import { queryResultColumnsZh as columnText } from '../locales/queryResultColumns.zh-CN';
import { QueryRowDetails, type QueryRowDetailsBinding, type QueryRowDetailsView } from '../queryRowDetails';
import { queryRowDetailsZh as detailText } from '../locales/queryRowDetails.zh-CN';
import { queryResultStatisticsZh as statisticsText } from '../locales/queryResultStatistics.zh-CN';
import { QueryResultSort, type QueryResultSortBinding, type QueryResultSortRule, type QueryResultSortView } from '../queryResultSort';
import { queryResultSortZh as sortText } from '../locales/queryResultSort.zh-CN';
import { appendQueryResultFilterNode, QueryResultFilter, type QueryResultFilterBinding, type QueryResultFilterGroup, type QueryResultFilterRule, type QueryResultFilterView } from '../queryResultFilter';
import { captureQueryResultCellFilter, queryResultCellFilterNode, type CellFilterOperator } from '../queryResultCellFilter';
import { currentQueryResultSelectedFilter, queryResultSelectedFilterNode, type QueryResultSelectedFilterCapture, type QueryResultSelectedFilterMode } from '../queryResultSelectedFilter';
import type { QueryResultCopyCell } from '../queryResultHeaderCopy';
import { prepareQueryResultOrganization, QueryResultHistory } from '../queryResultHistory';
import { queryResultHistoryZh as historyText } from '../locales/queryResultHistory.zh-CN';
import { queryResultFilterZh as filterText } from '../locales/queryResultFilter.zh-CN';
import { SqlEditor, type SqlCompletionStatus } from './SqlEditor';
import { ResultsGrid, type GridFindTarget } from './ResultsGrid';
import { ResultExportDialog } from './ResultExportDialog';
import { FullQueryExportDialog, type FullQueryExportSource } from './FullQueryExportDialog';
import { postgresCurrentQueryExportSource } from '../../shared/postgresQueryExport';
import { postgresQueryExportZh as fullExportText } from '../locales/postgresQueryExport.zh-CN';
import { QueryResultSortPanel } from './QueryResultSortPanel';
import { QueryResultFilterPanel } from './QueryResultFilterPanel';
import { QueryResultKeyword, useQueryResultKeyword } from './QueryResultKeyword';
import { QueryResultMatchView, useQueryResultMatchView, type QueryResultRowViewKind } from './QueryResultMatchView';
import { QueryResultColumnsDialog } from './QueryResultColumnsDialog';
import { QueryRowDetailsPanel } from './QueryRowDetailsPanel';
import { QueryResultStatisticsDialog } from './QueryResultStatisticsDialog';
import { QueryResultPresetsDialog } from './QueryResultPresetsDialog';
import { QueryResultComparisonDialog } from './QueryResultComparisonDialog';
import { QueryResultSnapshotActions, type QueryResultSnapshotOperation } from './QueryResultSnapshotActions';
import { ExplainPlanView } from './ExplainPlanView';
import { QueryAnalyzeView } from './QueryAnalyzeView';
import { QueryAnalyzeConfirmDialog } from './QueryAnalyzeConfirmDialog';
import { queryAnalyzeZh } from '../locales/queryAnalyze.zh-CN';
import { ErrorBox, Spinner, Empty, Modal } from './ui';
import { QueryCloseDialog } from './QueryCloseDialog';
import { QueryBindingDialog } from './QueryBindingDialog';
import { QueryDuplicateIntent, resultStatementTargetDraft, type QueryDuplicateMode, type QueryTargetDraft } from '../queryDuplicateIntent';
import { queryDuplicateZh } from '../locales/queryDuplicate.zh-CN';
import { QueryParametersDialog } from './QueryParametersDialog';
import { QueryTransactionSettingsIntent } from '../queryTransactionSettingsIntent';
import { PostgresTransactionSettingsDialog } from './PostgresTransactionSettingsDialog';
import { postgresTransactionSettingsZh as transactionText } from '../locales/postgresTransactionSettings.zh-CN';
import { PostgresSearchPathDialog } from './PostgresSearchPathDialog';
import { postgresSearchPathZh as searchPathText } from '../locales/postgresSearchPath.zh-CN';
import { PostgresQueryTimeoutsDialog } from './PostgresQueryTimeoutsDialog';
import { postgresQueryTimeoutsZh as timeoutText } from '../locales/postgresQueryTimeouts.zh-CN';
import { captureQueryFailureSource, type QueryFailureSourceLease, type QueryFailureSourceScope } from '../queryFailureSource';
import { QueryPartialOutcomeNotice } from './QueryPartialOutcomeNotice';
import { PostgresNoticesPanel } from './PostgresNoticesPanel';
import type { PostgresNoticeEntry } from '../../shared/postgresNotices';
import { QueryContinueOnErrorNotice, confirmedQueryContinueRange } from './QueryContinueOnErrorNotice';
import { queryContinueOnErrorZh as continueText } from '../locales/queryContinueOnError.zh-CN';
import type { QueryFailure } from '../../shared/queryFailure';
import { QueryParameterReuseOwner, type QueryParameterReuseOwnerInput } from '../queryParameterReuseOwner';
import type { QueryParameterReusePort } from '../queryParameterReusePort';
import { SnippetsDialog } from './SnippetsDialog';
import { prepareBuiltinSnippetInsert } from '../snippetInsertion';
import { SNIPPET_LIMITS } from '../../shared/snippets';
import { useQueryFileSource } from '../useQueryFileSource';
import { captureQueryFileSnapshot } from '../queryFileSnapshot';
import { flushEditorContent } from '../editorContentBridge';
import { captureHistoryInsertion, type HistoryInsertionRegistry, type HistoryInsertionTarget, type QueryInsertionMode } from '../historyInsertion';
import { SavedQueryMatchNavigation } from './SavedQueryMatchNavigation';
import { useUiCommandScope, type UiCommandHandler } from '../uiCommands';
import { bracketCommands, sqlPositionActions, sqlTextActions } from '../sqlEditorActions';
import { hasExplicitCaseSelection } from '../sqlSelectionCase';
import { editSqlBlockComment } from '../sqlBlockComment';
import { openFocusedGridRowJump } from './GridRowJump';
import { openFocusedQueryResultFind } from './QueryResultFind';
import { StatementNavigationPanel } from './StatementNavigationPanel';
import { usePostgresStatementNavigation } from '../usePostgresStatementNavigation';
import type { SavedQueryGroupTarget } from '../../shared/savedQueryOrganization';
import { openStatementDraftBatch, saveStatementQuery, type StatementQueryOutput } from '../statementNavigationExtract';
import { statementNavigationZh as navigationText } from '../locales/statementNavigation.zh-CN';
import type { NavigableStatement } from '../../shared/statementNavigation';
import { QueryFileActions, QueryFileSourceCaption } from './QueryFilesDialog';
import { QueryLayoutSplitter, queryEditorVisualHeight } from './QueryLayoutSplitter';
import { beginWorkspaceQueryLayout, queryLayoutActiveTab, queryLayoutTarget } from '../queryLayoutWorkspace';
import { useQueryLayoutMaximum } from '../useQueryLayoutMaximum';
import { queryLayoutLimits, queryLayoutWidthLimits, queryResultBesideMinimum, queryEditorWidthMaximum,
  readQueryEditorHeight, readQueryEditorWidth, readQueryResultPlacement } from '../../shared/queryLayout';
import { queryLayoutZh } from '../locales/queryLayout.zh-CN';
import '../queryLayout.css';
import './PostgresQueryTab.css';
import '../queryPins.css';
import '../queryResultSort.css';
interface Scope {
  profile: unknown;
  version: number;
  database: string;
}
interface Phase {
  life: object;
  scope: Scope;
  valid: boolean;
  cancelled: boolean;
  taskId: string;
  sent: boolean;
  work?: Promise<void>;
  cancel?: Promise<void>;
}
interface ParameterOwner {
  source: string;
  scope: Scope;
  model: monaco.editor.ITextModel;
  version: number;
  valid: boolean;
  session?: string;
  reuse: QueryParameterReusePort | null;
  failureSource?: QueryFailureSourceLease;
  continueOnError: boolean;
}
interface AnalyzeOwner {
  token: string;
  source: string;
  sessionId: string;
  scope: Scope;
  model: monaco.editor.ITextModel;
  version: number;
}
interface SortDraft { binding: QueryResultSortBinding; view: QueryResultSortView; }
interface FilterDraft { binding: QueryResultFilterBinding; view: QueryResultFilterView; sortView: QueryResultSortView; seed?: QueryResultFilterGroup; }
interface ColumnDraft { binding: ResultSelectionBinding; owner: string; initial: QueryResultColumnLayout; }
interface StatisticsDraft { binding: ResultSelectionBinding; owner: string; column: ResultColumn; indices: ReadonlySet<number>; }
interface PresetDraft { binding: ResultSelectionBinding; owner: string; value: QueryResultPresetValue; }
interface ResultLayout { source: QueryResult; layout: QueryResultColumnLayout; columns: ResultColumn[]; }
interface PinState { items: PinnedQueryResult[]; selected?: string; sequence: number; }
const emptyResults: QueryResult[] = [];
interface ComparisonDraft { pins: PinnedQueryResult[]; owner: string; }
/** PostgreSQL查询复用原编辑器、结果网格、文件来源及保存查询；驱动任务和事务明确独立。 */
export function PostgresQueryTab({
  tab,
  closeRequest,
  onCloseRequestFinished,
  onHistory,
  searchNavigation,
  historyInsertionRegistry,
  onChooseQueryTarget,
  onCreateView,
}: {
  tab: WorkspaceTab;
  closeRequest?: QueryCloseRequest;
  onCloseRequestFinished?(request: QueryCloseRequest, close: boolean, keep?: WorkspaceTab): void;
  onHistory(): void;
  searchNavigation?: SavedQueryNavigationSource;
  historyInsertionRegistry?: HistoryInsertionRegistry;
  onChooseQueryTarget?(draft: QueryTargetDraft): void;
  onCreateView?(draft: QueryViewDraft): void;
}) {
  const workspace = useWorkspace((s) => s),
    profile = workspace.connections.find((p) => p.id === tab.connectionId),
    version = workspace.connectionVersions[tab.connectionId] ?? 0;
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null),
    alive = useRef(false),
    life = useRef<object>({}),
    session = useRef<{ id: string; scope: Scope } | undefined>(undefined),
    phase = useRef<Phase | undefined>(undefined),
    closeRef = useRef(closeRequest);
  closeRef.current = closeRequest;
  const [editorInstance, setEditorInstance] = useState<monaco.editor.IStandaloneCodeEditor | null>(null);
  const layoutRoot = useRef<HTMLDivElement>(null);
  const [layoutWidth, setLayoutWidth] = useState(0), [resultsOnly, setResultsOnly] = useState(false);
  const [formatOptions, setFormatOptions] = useState<QueryFormattingOptions>();
  const [editorPreview, setEditorPreview] = useState<number | null>(null), [editorWidthPreview, setEditorWidthPreview] = useState<number | null>(null);
  const preferredPlacement = readQueryResultPlacement(tab.queryResultPlacement);
  const besideAvailable = layoutWidth >= queryResultBesideMinimum;
  const resultLayout = resultsOnly ? 'results' : preferredPlacement === 'beside' && besideAvailable ? 'beside' : 'below';
  const layoutMaximum = useQueryLayoutMaximum(layoutRoot, queryLayoutLimits.maxEditorHeight, setLayoutWidth);
  const widthMaximum = queryEditorWidthMaximum(layoutWidth);
  const preferredEditorHeight = readQueryEditorHeight(tab.queryEditorHeight), preferredEditorWidth = readQueryEditorWidth(tab.queryEditorWidth);
  const editorHeight = queryEditorVisualHeight(editorPreview ?? preferredEditorHeight, layoutMaximum);
  const editorWidth = queryEditorVisualHeight(editorWidthPreview ?? preferredEditorWidth, widthMaximum);
  const layoutActiveTab = queryLayoutActiveTab(workspace.settings);
  const layoutScope = JSON.stringify([queryLayoutTarget(tab, version), layoutActiveTab, !!closeRequest]);
  const layoutEditorId = useId();
  useLayoutEffect(() => { setEditorPreview(null); setEditorWidthPreview(null); }, [resultLayout]);
  const [editorSelection, setEditorSelection] = useState({ explicit: false, single: false });
  const updateEditorSelection = useCallback((explicit: boolean, single: boolean) => {
    setEditorSelection(previous => previous.explicit === explicit && previous.single === single ? previous : { explicit, single });
  }, []);
  const historyInsertion = useRef<HistoryInsertionTarget | null>(null);
  const duplicateIntent = useRef<QueryDuplicateIntent | undefined>(undefined);
  const duplicateOrigin = useRef({ connectionId: tab.connectionId, version });
  const [duplicating, setDuplicating] = useState(false);
  const [snippets, setSnippets] = useState<{ initialSql: string; create: boolean }>();
  const snippetTarget = useRef<HistoryInsertionTarget | null>(null);
  const [busy, setBusy] = useState(false),
    [fileBusy, setFileBusy] = useState(false),
    [error, setError] = useState(''),
    [outcome, setOutcome] = useState<QueryOutcome>(),
    [selected, setSelected] = useState(0),
    [state, setState] = useState<{
      transactionOpen: boolean;
      transactionKnown: boolean;
      transactionFailed: boolean;
      broken: boolean;
      standardConformingStrings?: boolean;
    }>({
      transactionOpen: false,
      transactionKnown: true,
      transactionFailed: false,
      broken: false,
    });
  const [save, setSave] = useState(false),
    [closeSaving, setCloseSaving] = useState(false),
    [parameterOwner, setParameterOwner] = useState<ParameterOwner>(),
    parameters = useRef<ParameterOwner | undefined>(undefined);
  parameters.current = parameterOwner;
  const parameterReuse = useRef<QueryParameterReuseOwner | null>(null), parameterTask = useRef('');
  const parameterState = useRef<{ sessionId: string; known: boolean }>({ sessionId: '', known: false });
  const failureSource = useRef<QueryFailureSourceLease | undefined>(undefined);
  const [, refreshFailureSource] = useState(0);
  const [continueOnError, setContinueOnError] = useState(false);
  const [sessionSetting, setSessionSetting] = useState<{intent: QueryTransactionSettingsIntent; scope: Scope; mode: 'transaction' | 'search-path' | 'timeouts'; changed: string}>();
  const sessionSettingRef = useRef(sessionSetting); sessionSettingRef.current = sessionSetting;
  const scriptFailureRanges = useRef(new Set<QueryFailure>());
  const noticeRanges = useRef(new Set<PostgresNoticeEntry>());
  const resultRanges = useRef(new Set<PostgresResultSource>());
  useLayoutEffect(() => {
    const current = sessionSettingRef.current; current?.intent.current();
    if (current && closeRef.current && !phase.current) closeSessionSetting(current);
  });
  const [completionStatus, setCompletionStatus] = useState<SqlCompletionStatus>('idle');
  const [analyze, setAnalyze] = useState<AnalyzeOwner>();
  const analyzeRef = useRef<AnalyzeOwner | undefined>(undefined);
  const [resultSelection] = useState(() => new ResultExportSelection());
  const [pinState, setPinState] = useState<PinState>({ items: [], sequence: 0 });
  const pinStateRef = useRef(pinState);
  const snapshotOperation = useRef<QueryResultSnapshotIntent | undefined>(undefined);
  const [snapshotBusy, setSnapshotBusy] = useState(false);
  const [resultSql, setResultSql] = useState<{ result: QueryResult; pinned: boolean; sourceSql?: string }>();
  const [comparisonDraft, setComparisonDraft] = useState<ComparisonDraft>();
  const comparisonDraftRef = useRef<ComparisonDraft | undefined>(undefined);
  const [resultHistory] = useState(() => new QueryResultHistory());
  const [rowDetails] = useState(() => new QueryRowDetails());
  const [activeDetailRow, setActiveDetailRow] = useState<{ binding: QueryRowDetailsBinding; index: number }>();
  const [rowDetail, setRowDetail] = useState<QueryRowDetailsView>();
  const [organization] = useState(() => ({ filter: new QueryResultFilter('postgresql'), sorter: new QueryResultSort('postgresql') }));
  const { filter: resultFilter, sorter: resultSorter } = organization;
  const [, refreshResult] = useState(0);
  const [sortDraft, setSortDraft] = useState<SortDraft>();
  const sortDraftRef = useRef<SortDraft | undefined>(undefined);
  const [filterDraft, setFilterDraft] = useState<FilterDraft>();
  const filterDraftRef = useRef<FilterDraft | undefined>(undefined);
  const [filterError, setFilterError] = useState('');
  const [columnLayout, setColumnLayout] = useState<ResultLayout>();
  const [columnDraft, setColumnDraft] = useState<ColumnDraft>();
  const columnDraftRef = useRef<ColumnDraft | undefined>(undefined);
  const [statisticsDraft, setStatisticsDraft] = useState<StatisticsDraft>();
  const statisticsDraftRef = useRef<StatisticsDraft | undefined>(undefined);
  const [presetDraft, setPresetDraft] = useState<PresetDraft>();
  const presetDraftRef = useRef<PresetDraft | undefined>(undefined);
  const [archiveOutcome, setArchiveOutcome] = useState<QueryOutcome>();
  type OriginsView = { token: object; result: QueryResult; scope: Scope; sessionId: string; origins?: PostgresResultOrigin[]; error?: string };
  const [originsView, setOriginsView] = useState<OriginsView>();
  const originsOwner = useRef<OriginsView | undefined>(undefined);
  const [recordEdit, setRecordEdit] = useState<{
    source: PostgresQueryRecordIntent;
    result: QueryResult; scope: Scope; job: ReturnType<typeof acquireWorkspaceBusy>;
    cell?: PostgresQueryCellEdit;
    range?: PostgresQueryRangeEdit;
    deletePositions?: readonly number[];
  }>();
  const retiredRecordExecution = useRef<string | undefined>(undefined);
  useEffect(() => () => { recordEdit?.job.release(); }, [recordEdit]);
  const [recordReference, setRecordReference] = useState<{
    request: Extract<PostgresQueryRecordPageInput, { operation: 'reference' }>;
    direction: 'parent' | 'children';
    result: QueryResult; scope: Scope; job: ReturnType<typeof acquireWorkspaceBusy>;
  }>();
  useEffect(() => () => { recordReference?.job.release(); }, [recordReference]);

  const [exportView, setExportView] = useState<{ result: ResultExportData; selected: boolean; scope?: 'rectangle' }>();
  const [fullExport, setFullExport] = useState<FullQueryExportSource>();
  const exportOpen = useRef(false);
  const scope: Scope = {
    profile,
    version,
    database: tab.database || (profile?.dialect === 'postgresql' && profile.database) || 'postgres',
  };
  const currentTab = () => useWorkspace.getState().settings.tabs.find((t) => t.id === tab.id);
  const source = () => editor.current?.getModel()?.getValue() ?? currentTab()?.sql ?? '';
  /** 定位只持原模型和执行范围，来源变化永久撤销；忙碌或模态期间仅暂时禁用。 */
  function failureSourceScope(): QueryFailureSourceScope {
    const now = useWorkspace.getState(), current = currentTab(), connectionId = current?.connectionId ?? tab.connectionId;
    return { tabId: tab.id, connectionId, connectionVersion: now.connectionVersions[connectionId] ?? 0,
      draft: current?.sql, present: alive.current && current?.kind === 'query' && now.connections.some(item => item.id === connectionId),
      active: now.settings.activeTabId === tab.id, busy: !!phase.current || !!now.activeJobs[tab.id],
      modal: !!document.querySelector(appModalSelector), closing: !!closeRef.current };
  }
  function captureFailureSource(sql: string, all = false): QueryFailureSourceLease | undefined {
    if (!editor.current) return;
    return captureQueryFailureSource({ editor: editor.current, source: sql, all, scope: failureSourceScope,
      subscribe: changed => useWorkspace.subscribe(changed),
      onInvalidated: () => { if (alive.current) refreshFailureSource(value => value + 1); } });
  }
  function clearFailureSource(): void {
    failureSource.current?.dispose();
    failureSource.current = undefined;
    scriptFailureRanges.current.clear();
    noticeRanges.current.clear();
    resultRanges.current.clear();
  }
  /** 消息沿同一原模型租约定位；旧结果、固定副本和无可靠偏移的消息不能接管选择。 */
  function locateNotice(entry: PostgresNoticeEntry): void {
    if (pinStateRef.current.selected || !noticeRanges.current.has(entry) || !failureSource.current?.available() ||
        !failureSource.current.bindRange(entry.sourceRange)) return;
    locateFailure();
  }
  /** 多错摘要共用原模型租约；旧错误对象不能重绑后继执行的范围。 */
  function locateFailure(failure?: QueryFailure): void {
    const locator = failureSource.current;
    if (pinStateRef.current.selected || !locator?.available() || failure &&
        (!scriptFailureRanges.current.has(failure) || !locator.bindRange(failure.sourceRange))) return;
    flushSync(() => setResultsOnly(false));
    editor.current?.layout(); locator.locate();
  }
  /** 暂存只读取本标签原模型及已确认的物理会话；不把参数值写入工作区或来源键。 */
  function parameterReuseInput(): QueryParameterReuseOwnerInput | null {
    const now = useWorkspace.getState(), current = currentTab(), owned = session.current;
    if (!current || current.kind !== 'query') return null;
    const connection = now.connections.find(item => item.id === current.connectionId);
    const saved = current.sourceBinding, file = current.fileSourceBinding;
    const database = current.database || (connection?.dialect === 'postgresql' && connection.database) || 'postgres';
    return { tabId: current.id, connectionId: current.connectionId, connectionVersion: now.connectionVersions[current.connectionId] ?? 0,
      sessionId: owned?.id ?? null, editor: editor.current, present: alive.current && connection?.dialect === 'postgresql' && !closeRef.current,
      draft: current.sql, savedSourceKey: JSON.stringify(saved ? [saved.id, saved.digest, saved.connectionId ?? null,
        saved.connectionDigest ?? null, saved.context.state, 'database' in saved.context ? saved.context.database ?? null : null] : null),
      fileSourceKey: JSON.stringify(file ? [file.id, file.revision] : null), databaseKey: JSON.stringify([database]),
      databaseKnown: !!owned && owned.scope.database === database && parameterState.current.sessionId === owned.id && parameterState.current.known,
      taskId: parameterTask.current };
  }
  useLayoutEffect(() => { parameterReuse.current?.observe(); });
  useEffect(() => {
    if (!editorInstance) return;
    const changed = () => parameterReuse.current?.observe();
    const subscriptions = [editorInstance.onDidChangeModel(changed), editorInstance.onDidChangeModelContent(changed),
      editorInstance.onDidChangeCursorSelection(changed), editorInstance.onDidDispose(() => {
        parameterReuse.current?.dispose(); parameterReuse.current = null;
      })];
    return () => subscriptions.forEach(item => item.dispose());
  }, [editorInstance]);
  /** 来源判断不靠同名连接或旧渲染闭包；等待中的配置／默认库ABA会留下永久失效标记。 */
  function same(original: Scope) {
    const now = useWorkspace.getState(),
      p = now.connections.find((p) => p.id === tab.connectionId),
      current = currentTab();
    return (
      alive.current &&
      !!current &&
      current.connectionId === tab.connectionId &&
      p === original.profile &&
      (now.connectionVersions[tab.connectionId] ?? 0) === original.version &&
      (current.database || (p?.dialect === 'postgresql' && p.database) || 'postgres') === original.database
    );
  }
  function available(allowFormattingDialog?: true) {
    const now = useWorkspace.getState();
    return (
      same(scope) &&
      profile?.dialect === 'postgresql' &&
      now.settings.activeTabId === tab.id &&
      !!editor.current?.getModel() &&
      !now.activeJobs[tab.id] &&
      !phase.current &&
      !analyzeRef.current &&
      !exportOpen.current &&
      !sessionSettingRef.current &&
      !sortDraftRef.current &&
      !filterDraftRef.current &&
      !columnDraftRef.current &&
      !statisticsDraftRef.current &&
      !presetDraftRef.current &&
      !comparisonDraftRef.current &&
      !snapshotOperation.current &&
      !fileBusy &&
      !closeRef.current &&
      (allowFormattingDialog === true || !document.querySelector(appModalSelector))
    );
  }
  /** 撤销确认来源，后续事件不能使用已经关闭或换代的弹窗。 */
  function clearAnalyze(discard = true) {
    const current = analyzeRef.current;
    analyzeRef.current = undefined;
    setAnalyze(undefined);
    if (discard && current) void invoke('postgres.analyzeDiscard', { sessionId: current.sessionId, token: current.token }).catch(() => {});
  }

  /** 参数弹窗绑定准确的模型和活动标签，选区正文无需与整份脚本相等。 */
  function parameterCurrent(owner: ParameterOwner) {
    const current = useWorkspace.getState();
    return (
      owner.valid &&
      parameters.current === owner &&
      same(owner.scope) &&
      current.settings.activeTabId === tab.id &&
      !closeRef.current &&
      editor.current?.getModel() === owner.model &&
      !owner.model.isDisposed() &&
      owner.model.getVersionId() === owner.version
    );
  }
  const files = useQueryFileSource(
    tab,
    () => captureQueryFileSnapshot(editor.current, currentTab),
    () => alive.current,
    (v) => setFileBusy(v),
    {
      editor: () => editor.current,
      available: () => !phase.current && !closeRef.current,
      current: () => !phase.current && !closeRef.current,
    },
  );
  /** 原会话只在用户操作时创建；任何等待失效都关闭刚创建的新会话，不把它交给新目标。 */
  async function ensure(owner: Phase): Promise<string> {
    if (!owner.valid || owner.cancelled || !same(owner.scope) || life.current !== owner.life)
      throw Error(text.changed);
    if (session.current) {
      if (!same(session.current.scope) || session.current.scope.profile !== owner.scope.profile)
        throw Error(text.unknown);
      return session.current.id;
    }
    await invoke('connections.open', { id: tab.connectionId });
    if (!owner.valid || owner.cancelled || !same(owner.scope)) throw Error(text.changed);
    const result = await invoke('sessions.open', {
      connectionId: tab.connectionId,
      database: owner.scope.database,
    });
    if (!owner.valid || owner.cancelled || !same(owner.scope) || life.current !== owner.life) {
      await invoke('sessions.close', { sessionId: result.sessionId });
      throw Error(text.changed);
    }
    session.current = { id: result.sessionId, scope: owner.scope };
    return result.sessionId;
  }
  /** 事务dirty来自实际ReadyForQuery；未知状态保持退出保护，不按按钮文字猜COMMIT。 */
  async function readState(id: string, owner: Phase) {
    try {
      const next = await invoke('query.sessionState', { sessionId: id });
      if (phase.current === owner && owner.valid && same(owner.scope)) {
        parameterState.current = { sessionId: id, known: next.transactionKnown && !next.broken };
        parameterReuse.current?.observe();
        setState({ ...next, transactionFailed: next.transactionFailed === true });
        useWorkspace.getState().setDirty(tab.id, next.transactionOpen || !next.transactionKnown);
      }
    } catch {
      if (same(owner.scope)) {
        parameterState.current = { sessionId: id, known: false };
        parameterReuse.current?.observe();
        setState({ transactionOpen: true, transactionKnown: false, transactionFailed: false, broken: true });
        useWorkspace.getState().setDirty(tab.id, true);
      }
    }
  }
  /** 停止只投递原task，等待原查询及取消Promise都结束；取消ACK不代表数据库未写入。 */
  function stop() {
    const owner = phase.current;
    if (!owner || owner.cancelled) return;
    owner.cancelled = true;
    if (owner.sent)
      owner.cancel = invoke('query.cancel', { taskId: owner.taskId })
        .then(() => {})
        .catch((reason) => {
          if (alive.current) setError(errorMessage(reason));
        });
  }
  /** 查询和计划都捕获原模型版本，实际分析只接受已经确认的原令牌。 */
  function run(
    mode: 'normal' | 'selection' | 'current' | 'all' | 'explain' | 'analyzePreview' = 'normal',
    values?: QueryParameter[],
    parameter?: ParameterOwner,
    sqlOverride?: string,
    confirmed?: AnalyzeOwner,
  ) {
    if (confirmed) {
      const current = useWorkspace.getState();
      if (analyzeRef.current !== confirmed || phase.current || closeRef.current || !same(confirmed.scope) ||
          current.settings.activeTabId !== tab.id || current.activeJobs[tab.id] ||
          session.current?.id !== confirmed.sessionId || editor.current?.getModel() !== confirmed.model ||
          confirmed.model.isDisposed() || confirmed.model.getVersionId() !== confirmed.version) {
        clearAnalyze();
        setError(queryAnalyzeZh.changed);
        return;
      }
      clearAnalyze(false);
    } else if (values) {
      if (
        !parameter ||
        !parameterCurrent(parameter) ||
        phase.current ||
        useWorkspace.getState().activeJobs[tab.id] ||
        parameter.session !== session.current?.id ||
        !parameter.session
      )
        throw Error(text.changed);
    } else if (!commandEditor()) return;
    if (session.current && !state.transactionKnown) {
      setError(text.unknown);
      return;
    }
    const model = editor.current?.getModel(),
      selection = editor.current?.getSelection(),
      original = model?.getValue() ?? source();
    // 「执行选区」在实际派发时重新读取原选区，空选区或多选区不得降级为整份执行。
    if (mode === 'selection' && (!model || !selection || selection.isEmpty() || editor.current?.getSelections()?.length !== 1)) return;
    if (mode === 'current' && !selection) return;
    let sql = confirmed?.source ?? sqlOverride ?? original,
      offset: number | undefined;
    if (!confirmed && !sqlOverride && !values && selection && mode !== 'all') {
      if (mode === 'current' || (mode === 'explain' || mode === 'analyzePreview') && selection.isEmpty()) offset = model!.getOffsetAt(selection.getPosition());
      else if (!selection.isEmpty()) sql = model!.getValueInRange(selection);
    }
    if (values) sql = parameter!.source;
    if (!sql.trim()) {
      setError(text.noSql);
      return;
    }
    clearFailureSource();
    const locator = parameter?.failureSource ?? (!sqlOverride && !confirmed && mode !== 'explain' && mode !== 'analyzePreview'
      ? captureFailureSource(sql, mode === 'all' || mode === 'current') : undefined);
    if (parameter) parameter.failureSource = undefined;
    const continuing = !sqlOverride && !confirmed && mode !== 'explain' && mode !== 'analyzePreview' &&
      (parameter ? parameter.continueOnError : continueOnError);
    const modelVersion = model?.getVersionId(),
      job = acquireWorkspaceBusy(tab.id),
      owner: Phase = {
        life: life.current,
        scope: confirmed?.scope ?? parameter?.scope ?? scope,
        valid: true,
        cancelled: false,
        taskId: uid(),
        sent: false,
      };
    phase.current = owner;
    parameterTask.current = owner.taskId;
    setBusy(true);
    setError('');
    if (mode !== 'analyzePreview') {
      resetResultView();
      if (pinStateRef.current.selected) publishPinState({ ...pinStateRef.current, selected: undefined });
      setOutcome(undefined);
      setSelected(0);
    }
    owner.work = (async () => {
      let succeeded = false;
      let retainLocator = false;
      try {
        const id = await ensure(owner);
        if (
          !owner.valid ||
          owner.cancelled ||
          !same(owner.scope) ||
          editor.current?.getModel() !== model ||
          model?.getVersionId() !== modelVersion ||
          (confirmed && confirmed.sessionId !== id) ||
          (parameter && (!parameterCurrent(parameter) || parameter.session !== id))
        )
          throw Error(text.changed);
        if (mode === 'analyzePreview') {
          const preview = await invoke('postgres.analyzePreview', { sessionId: id, sql,
            ...(offset === undefined ? {} : { currentStatement: { offset } }) });
          if (model && modelVersion !== undefined && !model.isDisposed() && model.getVersionId() === modelVersion &&
              owner.valid && !owner.cancelled && same(owner.scope) && !closeRef.current &&
              editor.current?.getModel() === model && useWorkspace.getState().settings.activeTabId === tab.id) {
            const intent = { ...preview, sessionId: id, scope: owner.scope, model, version: modelVersion };
            analyzeRef.current = intent;
            setAnalyze(intent);
          } else void invoke('postgres.analyzeDiscard', { sessionId: id, token: preview.token }).catch(() => {});
          return;
        }
        if (parameter?.reuse) {
          const reuse = parameterReuse.current;
          // 暂存失效只撤销可选记忆能力；原表单的明确执行仍沿原来源校验。
          if (reuse?.bind(parameter.reuse, owner.taskId)) reuse.beforeLedger(owner.taskId);
        }
        if (parameter) setParameterOwner(undefined);
        owner.sent = true;
        const result = confirmed
          ? await invoke('postgres.analyze', { sessionId: id, taskId: owner.taskId, token: confirmed.token, acknowledged: true })
          : values
          ? await invoke('query.executeParameterized', {
              sessionId: id,
              taskId: owner.taskId,
              sql,
              parameters: values,
              ...(continuing ? {continueOnError: true} : {}),
              maxRows: useWorkspace.getState().settings.resultLimit,
            })
          : await invoke(mode === 'explain' ? 'postgres.explain' : 'query.execute', {
              sessionId: id,
              taskId: owner.taskId,
              sql,
              maxRows: useWorkspace.getState().settings.resultLimit,
              ...(offset === undefined ? {} : { currentStatement: { offset } }),
              ...(continuing ? {continueOnError: true} : {}),
            });
        succeeded = !result.failure && !result.scriptReport?.errors.length && result.scriptReport?.reachedEnd !== false;
        if (owner.valid && same(owner.scope) && life.current === owner.life) {
          const failures = (result.scriptReport?.errors ?? (result.failure ? [result.failure] : [])).filter(item => confirmedQueryContinueRange(sql, item));
          scriptFailureRanges.current = new Set(failures);
          const messages = result.postgresNotices?.entries.filter(item => confirmedQueryContinueRange(sql, item)) ?? [];
          noticeRanges.current = new Set(messages);
          const sources = result.postgresResultSources?.filter(item => confirmedQueryContinueRange(sql, item)) ?? [];
          resultRanges.current = new Set(sources);
          const range = failures[0]?.sourceRange ?? messages[0]?.sourceRange ?? sources[0]?.sourceRange;
          if (range && locator?.bindRange(range)) {
            failureSource.current = locator; retainLocator = true;
          }
          setOutcome(result);
          if (result.failure) setError(result.failure.message);
        }
      } catch (reason) {
        if (alive.current && life.current === owner.life) setError(errorMessage(reason));
      } finally {
        if (!retainLocator) locator?.dispose();
        if (owner.cancel) await owner.cancel;
        const id = session.current?.id;
        if (id) await readState(id, owner);
        if (parameter?.reuse) {
          const reuse = parameterReuse.current;
          const success = succeeded && !owner.cancelled && owner.valid && same(owner.scope) && life.current === owner.life;
          if (reuse?.settled(owner.taskId, success)) reuse.confirmed(owner.taskId, JSON.stringify([owner.scope.database]));
        }
        if (phase.current === owner) phase.current = undefined;
        job.release();
        if (alive.current && life.current === owner.life) {
          setBusy(false);
          if (parameter) {
            parameter.valid = false;
            setParameterOwner(undefined);
          }
        }
      }
    })();
  }
  /** 参数识别只读原模式；表单值不持久到settings、历史或草稿文件。 */
  async function names(owner: ParameterOwner): Promise<QueryParameterNames> {
    if (!parameterCurrent(owner) || phase.current) throw Error(text.changed);
    const job = acquireWorkspaceBusy(tab.id);
    const operation: Phase = {
      life: life.current,
      scope: owner.scope,
      valid: true,
      cancelled: false,
      taskId: uid(),
      sent: false,
    };
    phase.current = operation;
    const result = (async () => {
      try {
        const id = await ensure(operation);
        if (!parameterCurrent(owner)) throw Error(text.changed);
        const result = await invoke('query.parameterNames', { sessionId: id, sql: owner.source });
        if (!parameterCurrent(owner)) throw Error(text.changed);
        owner.session = id;
        await readState(id, operation);
        if (!parameterCurrent(owner)) throw Error(text.changed);
        if (owner.reuse) parameterReuse.current?.recognized(owner.reuse);
        return result;
      } finally {
        if (phase.current === operation) phase.current = undefined;
        job.release();
      }
    })();
    operation.work = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  /** 记录所选正文和模型版本，表单存续期间禁止借用其他标签或模型。 */
  function openParameters() {
    if (!available()) return;
    const model = editor.current?.getModel(),
      selection = editor.current?.getSelection();
    if (!model) return;
    if (editor.current?.getSelections()?.length !== 1) return;
    const selected = selection && !selection.isEmpty() ? model.getValueInRange(selection) : '';
    const sql = selected.trim() ? selected : model.getValue();
    const reuse = (parameterReuse.current ??= new QueryParameterReuseOwner(parameterReuseInput)).begin(sql);
    clearFailureSource();
    setParameterOwner({ source: sql, scope, model, version: model.getVersionId(), valid: true, reuse,
      failureSource: captureFailureSource(sql), continueOnError });
  }
  /** 会话设置绑定原标签、数据库及会话。草稿编辑不改变设置目标。 */
  function openSessionSetting(mode: NonNullable<typeof sessionSetting>['mode']) {
    if (!available()) return;
    try {
      const original = scope;
      const changed = {transaction: transactionText.changed, 'search-path': searchPathText.changed, timeouts: timeoutText.changed}[mode];
      const intent = new QueryTransactionSettingsIntent(() => {
        const now = useWorkspace.getState(), current = currentTab();
        return {tabId: tab.id, connectionId: current?.connectionId ?? tab.connectionId,
          connectionVersion: now.connectionVersions[tab.connectionId] ?? 0,
          connection: now.connections.find(item => item.id === current?.connectionId), sessionId: session.current?.id ?? '',
          present: same(original), active: now.settings.activeTabId === tab.id, closing: !!closeRef.current};
      }, listener => useWorkspace.subscribe(listener), changed);
      const owner = {intent, scope: original, mode, changed}; sessionSettingRef.current = owner; setSessionSetting(owner);
    } catch (reason) { setError(errorMessage(reason)); }
  }
  /** 元数据请求保留原结果和历史，所有等待边界核对原弹窗及物理会话。 */
  async function requestSessionSetting<T>(owner: NonNullable<typeof sessionSetting>,
    send: (request: {sessionId: string; taskId: string}) => Promise<T>): Promise<T> {
    const assertCurrent = () => {
      owner.intent.assertCurrent();
      if (sessionSettingRef.current !== owner || !same(owner.scope)) throw Error(owner.changed);
    };
    assertCurrent();
    if (phase.current || useWorkspace.getState().activeJobs[tab.id]) throw Error('原标签已有活动作业');
    const job = acquireWorkspaceBusy(tab.id);
    const operation: Phase = {life: life.current, scope: owner.scope, valid: true, cancelled: false, taskId: uid(), sent: false};
    phase.current = operation; setBusy(true);
    const work = (async () => {
      try {
        assertCurrent(); const id = await ensure(operation); owner.intent.bindSession(id); assertCurrent();
        operation.sent = true;
        const result = await send({sessionId: id, taskId: operation.taskId});
        assertCurrent(); return result;
      } finally {
        if (operation.cancel) await operation.cancel;
        const id = session.current?.id; if (id) await readState(id, operation);
        if (phase.current === operation) phase.current = undefined;
        job.release(); if (alive.current && life.current === operation.life) setBusy(false);
      }
    })();
    operation.work = work.then(() => {}, () => {});
    return work;
  }
  /** 迟到关闭不能清除后继弹窗；原请求收尾前保持占用。 */
  function closeSessionSetting(owner: NonNullable<typeof sessionSetting>): void {
    if (sessionSettingRef.current !== owner || phase.current) return;
    owner.intent.dispose(); sessionSettingRef.current = undefined; setSessionSetting(undefined);
  }
  /** 显式重连先正常关闭旧会话；旧事务或未知写入不会被自动恢复和重放。 */
  async function reconnect() {
    const original = session.current;
    if (!original || !available() || !window.confirm(text.confirmReconnect) || !available()) return;
    clearFailureSource();
    const job = acquireWorkspaceBusy(tab.id);
    const owner: Phase = { life: life.current, scope, valid: true, cancelled: false, taskId: uid(), sent: false };
    phase.current = owner;
    setBusy(true);
    setError('');
    owner.work = (async () => {
      try {
        await invoke('sessions.close', { sessionId: original.id });
        if (session.current === original) session.current = undefined;
        if (!same(owner.scope) || life.current !== owner.life) return;
        setState({ transactionOpen: false, transactionKnown: true, transactionFailed: false, broken: false });
        useWorkspace.getState().setDirty(tab.id, false);
        if (owner.valid && !owner.cancelled) await readState(await ensure(owner), owner);
      } catch (reason) {
        if (same(owner.scope)) setError(errorMessage(reason));
      } finally {
        if (phase.current === owner) phase.current = undefined;
        job.release();
        if (alive.current && life.current === owner.life) setBusy(false);
      }
    })();
    await owner.work;
  }
  /** 保存目录沿原来源CAS接口；回包过期仍保留已保存事实，不能覆盖后来编辑器内容。 */
  async function saveQuery(action: 'create' | 'update', name: string, group?: SavedQueryGroupTarget) {
    const snapshot = captureQueryFileSnapshot(editor.current, currentTab);
    const originalTab = currentTab(),
      original = snapshot.sql ?? '',
      originalScope = scope;
    const request = closeSaving ? closeRef.current : undefined;
    const instance = editor.current,
      model = instance?.getModel(),
      modelVersion = model?.getVersionId();
    if (!originalTab || !instance || !model || !same(originalScope) || (closeSaving && !request))
      throw Error(text.changed);
    if (action === 'update' && !snapshot.sourceBinding) throw Error(text.changed);
    const read = useWorkspace.getState;
    const intent =
      request &&
      new QuerySaveCloseIntent(
        instance,
        () => {
          const state = read(),
            current = currentTab(),
            connection = state.connections.find((item) => item.id === current?.connectionId);
          return {
            present: current?.kind === 'query' && !!connection,
            connection,
            blocked: !!state.dirtyTabs[tab.id],
            connectionId: current?.connectionId ?? '',
            connectionVersion: state.connectionVersions[tab.connectionId] ?? 0,
            sessionId: session.current?.id ?? '',
            draft: current?.sql,
            title: current?.title,
            database: current?.database,
            databaseContext: current?.databaseContext,
          };
        },
        (listener) => useWorkspace.subscribe(listener),
        () => alive.current,
        () => closeRef.current === request,
      );
    let job: ReturnType<typeof acquireWorkspaceBusy> | undefined;
    try {
      job = acquireWorkspaceBusy(tab.id);
      const content = {
        name,
        connectionId: tab.connectionId,
        context: { state: 'known' as const, database: originalScope.database },
        sql: original,
      };
      const result =
        action === 'update'
          ? await invoke('queries.updateSource', { source: snapshot.sourceBinding!, content })
          : await invoke('queries.create', group ? { ...content, group } : content);
      const current =
        same(originalScope) &&
        currentTab() === originalTab &&
        instance.getModel() === model &&
        !model.isDisposed() &&
        model.getVersionId() === modelVersion &&
        (!intent || intent.isCurrent()) &&
        job.owns();
      if (!current || snapshot.fileSourceBinding) {
        read().notify(text.retainedSave, true);
        if (alive.current) {
          setSave(false);
          setCloseSaving(false);
        }
        if (request) onCloseRequestFinished?.(request, false);
        return;
      }
      intent?.adoptTitle(result.name);
      const patch = { title: result.name, sourceBinding: result.source };
      const update = () => read().updateTab(tab.id, patch);
      if (request?.mutate) request.mutate(originalTab, patch, update);
      else update();
      setSave(false);
      setCloseSaving(false);
      const updated = currentTab();
      let restored = true;
      await flushSettings().catch((reason) => {
        restored = false;
        read().notify(text.retainedSave + ' ' + errorMessage(reason), true);
      });
      if (request && closeRef.current === request) {
        const close = restored && currentTab() === updated && !!intent?.isCurrent() && job.owns();
        job.release();
        onCloseRequestFinished?.(request, close);
      }
    } catch (reason) {
      request?.failed?.();
      throw reason;
    } finally {
      job?.release();
      intent?.dispose();
    }
  }
  function finishClose(close: boolean, keep = false) {
    const request = closeRef.current,
      current = currentTab();
    if (!request || !current || phase.current || files.isBusy()) return;
    if (keep && source() !== (current.sql ?? '')) return;
    onCloseRequestFinished?.(request, close, keep ? current : undefined);
  }
  async function saveClose() {
    if (!closeRef.current) return;
    if (tab.fileSourceBinding) {
      const request = closeRef.current,
        receipt = await files.save(undefined, request, () => closeRef.current === request);
      onCloseRequestFinished?.(request, receipt.restored && receipt.busyUnchanged);
    } else {
      setCloseSaving(true);
      setSave(true);
    }
  }
  useEffect(() => {
    const token = {};
    life.current = token;
    alive.current = true;
    return () => {
      alive.current = false;
      clearFailureSource(); parameters.current?.failureSource?.dispose();
      parameterReuse.current?.dispose(); parameterReuse.current = null;
      sessionSettingRef.current?.intent.dispose();
      duplicateIntent.current?.dispose();
      snippetTarget.current?.dispose();
      snapshotOperation.current?.invalidate();
      const pending = phase.current,
        owned = session.current;
      if (pending?.life === token) stop();
      void (async () => {
        if (pending?.life === token && pending.work) await pending.work;
        const current = session.current ?? owned;
        if (current) {
          await invoke('sessions.close', { sessionId: current.id });
          if (session.current === current) session.current = undefined;
        }
      })().catch((reason) => useWorkspace.getState().notify(text.closeFailed + errorMessage(reason), true));
    };
  }, []);
  useEffect(
    () =>
      useWorkspace.subscribe((next, previous) => {
        parameterReuse.current?.observe();
        const beforeTab = previous.settings.tabs.find((item) => item.id === tab.id);
        const afterTab = next.settings.tabs.find((item) => item.id === tab.id);
        const changed =
          next.connections.find((p) => p.id === tab.connectionId) !==
            previous.connections.find((p) => p.id === tab.connectionId) ||
          next.connectionVersions[tab.connectionId] !== previous.connectionVersions[tab.connectionId] ||
          beforeTab?.database !== afterTab?.database ||
          beforeTab?.connectionId !== afterTab?.connectionId;
        const left = next.settings.activeTabId !== tab.id;
        if (phase.current && (changed || (left && !phase.current.sent))) phase.current.valid = false;
        if (changed || left) resultSelection.invalidate();
        if (changed) {
          clearFailureSource();
          resetResultView();
          publishPinState({ items: [], sequence: 0 });
          setOutcome(undefined);
          setSelected(0);
        }
        if (changed || left) setResultSql(undefined);
        if (changed || left) snapshotOperation.current?.invalidate();
        if ((changed || left) && sortDraftRef.current) closeResultSort(sortDraftRef.current);
        if ((changed || left) && filterDraftRef.current) closeResultFilter(filterDraftRef.current);
        if ((changed || left) && columnDraftRef.current) closeResultColumns(columnDraftRef.current);
        if ((changed || left) && statisticsDraftRef.current) closeResultStatistics(statisticsDraftRef.current);
        if ((changed || left) && presetDraftRef.current) closeResultPresets(presetDraftRef.current);
        if ((changed || left) && comparisonDraftRef.current) closeResultComparison(comparisonDraftRef.current);
        const parameter = parameters.current;
        if (parameter && (changed || left)) {
          parameter.failureSource?.dispose();
          parameter.valid = false;
          setParameterOwner((current) => (current === parameter ? undefined : current));
        }
        if (analyzeRef.current && (changed || left || beforeTab?.sql !== afterTab?.sql)) clearAnalyze();
      }),
    [tab.id, tab.connectionId],
  );
  useEffect(() => {
    if (closeRequest && analyzeRef.current) clearAnalyze();
    if (closeRequest) setFullExport(undefined);
    if (closeRequest && sortDraftRef.current) closeResultSort(sortDraftRef.current);
    if (closeRequest && filterDraftRef.current) closeResultFilter(filterDraftRef.current);
    if (closeRequest && columnDraftRef.current) closeResultColumns(columnDraftRef.current);
    if (closeRequest && statisticsDraftRef.current) closeResultStatistics(statisticsDraftRef.current);
    if (closeRequest && presetDraftRef.current) closeResultPresets(presetDraftRef.current);
    if (closeRequest && comparisonDraftRef.current) closeResultComparison(comparisonDraftRef.current);
    if (closeRequest) setResultSql(undefined);
    if (closeRequest) { originsOwner.current = undefined; setOriginsView(undefined); }
    if (closeRequest) snapshotOperation.current?.invalidate();
  }, [closeRequest]);
  const pin = pinState.items.find(item => item.id === pinState.selected);
  const results = outcome?.results ?? emptyResults,
    result = pin?.result ?? results[selected],
    controlsLocked = busy || fileBusy || snapshotBusy || !!save || !!parameterOwner || !!analyze || !!sessionSetting || !!closeRequest || !!exportView || !!archiveOutcome || !!originsView || !!recordEdit || !!recordReference || !!resultSql,
    operationLocked = controlsLocked || !!sortDraft || !!filterDraft || !!columnDraft || !!statisticsDraft || !!presetDraft || !!comparisonDraft,
    locked = operationLocked || !!snippets || !!fullExport;
  const archiveAvailable = !pin && !busy && !!outcome && !outcome.explain && !outcome.analysis
    && results.filter(item => item.columns.length).length > 1;
  const resultSources = outcome?.postgresResultSources;
  const receiptSource = pin ? undefined : resultSources?.[selected];
  const receiptOrdinal = receiptSource?.statementOrdinal;
  const selectedResultRef = useRef(result);
  selectedResultRef.current = result;
  const origins = pin ? undefined : outcome?.postgresResultOrigins?.[selected];
  function originsCurrent(view: OriginsView): boolean {
    return same(view.scope) && originsOwner.current === view && selectedResultRef.current === view.result &&
      session.current?.id === view.sessionId && !phase.current && !closeRef.current &&
      useWorkspace.getState().settings.activeTabId === tab.id;
  }
  function closeOrigins() { originsOwner.current = undefined; setOriginsView(undefined); }
  useEffect(() => {
    if (originsOwner.current && !originsCurrent(originsOwner.current)) closeOrigins();
  }, [result, profile, version, scope.database, workspace.settings.activeTabId, closeRequest]);
  async function openOrigins() {
    const original = session.current;
    if (!original || !result || !origins || origins.length !== result.columns.length || originsOwner.current ||
        !resultScopeCurrent() || document.querySelector(appModalSelector)) return;
    const view = { token: {}, result, scope, sessionId: original.id };
    originsOwner.current = view;
    setOriginsView(view);
    try {
      const resolved = await invoke('postgres.resultOrigins', {
        sessionId: original.id, connectionId: tab.connectionId, database: original.scope.database, columns: origins,
      });
      if (resolved.length !== origins.length) throw Error(originsText.invalid);
      if (originsCurrent(view)) setOriginsView({ ...view, origins: resolved });
    } catch (reason) {
      if (originsCurrent(view)) setOriginsView({ ...view, error: errorMessage(reason) });
    }
  }
  const resultLocationAvailable = !!receiptSource && resultRanges.current.has(receiptSource) && !!failureSource.current?.availableForRender();
  // 名称属于服务器已返回的语句，编辑草稿时仍显示原结果的名称。
  const resultNames = useMemo(() => outcome?.results.map(result => result.columns.length
    ? queryResultTitle(result.statement, 'postgresql') : undefined) ?? [], [outcome]);
  const insertionLocked = useRef(locked);
  const snippetInsertionLocked = useRef(operationLocked);
  const fileOperation = useRef(files.isBusy);
  useLayoutEffect(() => {
    insertionLocked.current = locked;
    snippetInsertionLocked.current = operationLocked;
    fileOperation.current = files.isBusy;
    historyInsertion.current?.current();
    snippetTarget.current?.current();
    if (locked) duplicateIntent.current?.dispose();
  });
  /** 片段模态只放行自身的插入；会话、正文、选区、关闭和其它操作仍沿原意图保护。 */
  function captureInsertion(instance: monaco.editor.IStandaloneCodeEditor, ownSnippet = false, mode?: QueryInsertionMode) {
    flushEditorContent(instance);
    return captureHistoryInsertion(instance, () => {
      const current = useWorkspace.getState();
      const draft = current.settings.tabs.find(item => item.id === tab.id);
      return {
        tab: draft, activeTabId: current.settings.activeTabId,
        connection: current.connections.find(item => item.id === draft?.connectionId),
        connectionVersion: current.connectionVersions[draft?.connectionId ?? ''] ?? 0,
        selection: current.selection, session: session.current?.id ?? '', execution: phase.current?.taskId ?? '',
        alive: alive.current && editor.current === instance,
        busy: (ownSnippet ? snippetInsertionLocked.current : insertionLocked.current) || !!phase.current ||
          !!current.activeJobs[tab.id] || fileOperation.current(), closing: !!closeRef.current,
      };
    }, listener => useWorkspace.subscribe(listener), mode);
  }
  /** 进入历史或保存查询搜索时才捕获原选区。后续执行、切源、关闭或模型变化会撤销插入资格。 */
  useEffect(() => {
    if (!historyInsertionRegistry) return;
    const unregister = historyInsertionRegistry.register(tab.id, mode => {
      historyInsertion.current?.dispose();
      const instance = editor.current;
      if (!instance) return null;
      historyInsertion.current = captureInsertion(instance, false, mode);
      return historyInsertion.current;
    });
    return () => {
      unregister();
      historyInsertion.current?.dispose();
      historyInsertion.current = null;
    };
  }, [historyInsertionRegistry, tab.id]);
  const resultSource = pin?.result ?? (!outcome?.analysis && !outcome?.explain && result?.columns.length ? result : undefined);
  // 名称修改会替换快照元数据，只有结果来源变化才撤销网格状态。
  const resultContext = [pin?.result ?? outcome, pin ? undefined : selected, profile, version, scope.database];
  const snapshotIdentity = [tab, pinState, ...resultContext, resultSource];
  useLayoutEffect(() => { snapshotOperation.current?.observe(snapshotIdentity); });
  const currentLayout = columnLayout?.source === resultSource ? columnLayout : undefined;
  const layout = currentLayout?.layout;
  const visibleColumns = currentLayout?.columns ?? resultSource?.columns;
  const frozenKeys = useMemo(() => resultSource && layout ? frozenQueryResultKeys(resultSource.columns, layout) : undefined,
    [resultSource, layout]);
  const filterBinding = resultFilter.bind(resultSource, resultContext, visibleColumns);
  const filterView = resultFilter.view(filterBinding);
  const sortBinding = resultSorter.bind(filterView?.result ?? resultSource, resultContext, visibleColumns);
  const sortView = resultSorter.view(sortBinding);
  const historyBinding = resultHistory.bind(resultSource, visibleColumns ?? [], resultContext,
    filterView && sortView ? { expression: filterView.expression, sort: sortView.rules } : undefined, filterBinding);
  const organizedResult = sortView?.result ?? filterView?.result ?? result;
  const keywordFilter = useQueryResultKeyword(filterBinding?.source, visibleColumns, resultContext, organizedResult);
  const matchView = useQueryResultMatchView(keywordFilter.result, visibleColumns, resultContext);
  const displayResult = matchView.result;
  const dataResult = !busy && resultSource ? displayResult : undefined;
  const binding = resultSelection.bind(workspace.settings.activeTabId === tab.id ? dataResult : undefined,
    resultContext, visibleColumns);
  const selectedCount = resultSelection.count(binding);
  const rowSqlSource = !pin ? outcome?.postgresQueryRowSql : undefined;
  const rowSql = rowSqlSource && binding && result ? postgresQueryRowSqlBuilders(rowSqlSource, result, binding.rows) : undefined;
  // 显示行已筛选和排序，完整列仍来自该结果的原始元数据。
  const detailBinding = rowDetails.bind(!locked ? binding?.result : undefined, [binding]);
  const currentRowDetail = rowDetail && rowDetails.valid(rowDetail) ? rowDetail : undefined;
  useEffect(() => {
    // 切换来源后释放旧快照，旧行号不会沿用到新结果。
    setRowDetail(old => old?.binding === detailBinding ? old : undefined);
    setActiveDetailRow(old => old?.binding === detailBinding ? old : undefined);
  }, [detailBinding]);

  /** 当前标签、连接和事务操作仍归原工作区，排序不借用数据库会话。 */
  function resultScopeCurrent() {
    const current = useWorkspace.getState();
    return alive.current && !controlsLocked && !closeRef.current && !exportOpen.current && !phase.current &&
      !snapshotOperation.current && !current.activeJobs[tab.id] &&
      current.settings.activeTabId === tab.id && same(scope);
  }

  /** 选择归属于当前显示顺序及工作区代次，旧网格回调不能读取后来切换的行。 */
  function resultCurrent() {
    return resultScopeCurrent() && !sortDraftRef.current && !filterDraftRef.current && !columnDraftRef.current &&
      !statisticsDraftRef.current && !presetDraftRef.current && !comparisonDraftRef.current && resultSelection.current(binding);
  }

  /** 切换结果来源时同步撤销旧布局、整理历史和网格回执。 */
  function resetResultView() {
    organization.filter.invalidate();
    organization.sorter.invalidate();
    resultSelection.invalidate();
    resultHistory.invalidate();
    setColumnLayout(undefined);
  }

  /** 同步替换快照列表与选中项，旧按钮不能覆盖后续快照。 */
  function publishPinState(next: PinState) {
    pinStateRef.current = next;
    setPinState(next);
  }

  /** 文件回包只归原标签及作业，打开时校验 PostgreSQL 格式和固定快照容量。 */
  function beginResultSnapshot(mode: 'open' | 'save', shown = false): QueryResultSnapshotOperation {
    if (!pinNavigationCurrent() || currentTab() !== tab) throw Error(snapshotText.unavailable);
    if (mode === 'save' && !resultSource?.columns.length) throw Error(zh.query.pinRequiresRows);
    if (mode === 'open' && pinState.items.length >= pinLimits.count) throw Error(zh.query.pinCountLimit);
    if (shown && (!resultSource || !displayResult || !visibleColumns?.length || !resultScopeCurrent())) throw Error(snapshotText.stale);
    const name = pinnedResultSnapshotName(pin);
    const snapshot = shown && resultSource && displayResult && visibleColumns
      ? createDisplayedQueryResultSnapshot(resultSource, displayResult, visibleColumns, name) : undefined;
    const job = acquireWorkspaceBusy(tab.id);
    const intent: QueryResultSnapshotIntent = new QueryResultSnapshotIntent(snapshotIdentity, () =>
      snapshotOperation.current === intent && same(scope) && currentTab() === tab &&
      useWorkspace.getState().settings.activeTabId === tab.id && !closeRef.current && job.owns() &&
      pinStateRef.current === pinState && !document.querySelector(appModalSelector));
    snapshotOperation.current = intent;
    setSnapshotBusy(true);
    let finished = false;
    const notify = (message: string) => useWorkspace.getState().notify(message, true);
    return {
      result: resultSource, name, snapshot,
      current: () => intent.current(),
      invalidate: () => intent.invalidate(),
      /** 完成方言和容量检查后一次性加入固定列表。 */
      adopt(snapshot, name) {
        if (!intent.current()) throw Error(snapshotText.stale);
        if (snapshot.version !== 3) throw Error(snapshotText.postgresRequired);
        const sequence = pinState.sequence + 1;
        const label = `${formatText(zh.query.pinLabel, sequence)} · ${snapshot.name || name}`;
        const next = snapshotQueryResult(pinState.items, snapshot.result, uid(), label);
        intent.consume();
        resetResultView();
        publishPinState({ items: [...pinState.items, next], selected: next.id, sequence });
      },
      uncertain: notify,
      reportError: notify,
      /** 即使窗口撤销回包，也要等待原文件操作完成后才释放作业。 */
      finish() {
        if (finished) return;
        finished = true;
        intent.invalidate();
        if (snapshotOperation.current === intent) {
          snapshotOperation.current = undefined;
          if (alive.current) setSnapshotBusy(false);
        }
        job.release();
      },
    };
  }

  /** 快照切换和释放也可在没有本次行结果时使用，仍核对当前标签和操作窗口。 */
  function pinNavigationCurrent() {
    return pinStateRef.current === pinState && !locked && available();
  }

  /** 克隆原始完整结果，保留原列、原行和附带 SQL。 */
  function pinResult() {
    if (pin || !resultSource || !pinNavigationCurrent() || !resultCurrent()) return;
    try {
      const sequence = pinState.sequence + 1;
      const base = formatText(zh.query.pinLabel, sequence), name = resultNames[selected];
      const label = name ? formatText(zh.query.namedResultLabel, base, name) : base;
      const next = snapshotQueryResult(pinState.items, resultSource, uid(), label);
      resetResultView();
      publishPinState({ items: [...pinState.items, next], selected: next.id, sequence });
      setError('');
    } catch (reason) { setError(errorMessage(reason)); }
  }

  /** 来源切换后，新网格从原返回顺序开始整理。 */
  function selectPinnedResult(next?: PinnedQueryResult) {
    if (!pinNavigationCurrent() || next && !pinState.items.includes(next) || pin === next) return;
    resetResultView();
    publishPinState({ ...pinState, selected: next?.id });
  }

  function renameSelectedPin(target: PinnedQueryResult, name: string): boolean {
    if (pin !== target || !pinNavigationCurrent()) return false;
    const items = renamePinnedResult(pinState.items, target, name);
    if (!items) return false;
    publishPinState({ ...pinState, items });
    return true;
  }

  /** 离开快照只切换显示来源，快照仍保留在当前查询中。 */
  function selectCurrentResult(index: number): boolean {
    if (!pinNavigationCurrent() || !results[index]) return false;
    if (pin || selected !== index) {
      resetResultView();
      if (pin) publishPinState({ ...pinState, selected: undefined });
      setSelected(index);
    }
    return true;
  }

  /** 释放当前快照时返回本次结果，释放其它快照保留当前结果视图。 */
  function releasePinnedResult(item: PinnedQueryResult) {
    if (!pinNavigationCurrent() || !pinState.items.includes(item)) return;
    if (pin === item) resetResultView();
    publishPinState({ ...pinState, items: pinState.items.filter(entry => entry !== item),
      selected: pin === item ? undefined : pinState.selected });
  }

  /** 已核验的原范围保留参数模板，失效时仍可查看结果附带的文本。 */
  function openResultSql() {
    if (!result?.statement.trim() || !(pin || receiptSource) || selectedResultRef.current !== result || !pinNavigationCurrent()) return;
    const sourceSql = receiptSource && resultRanges.current.has(receiptSource)
      ? failureSource.current?.readRange(receiptSource.sourceRange) : undefined;
    setResultSql({ result, pinned: !!pin, sourceSql });
  }

  /** 旧预览的关闭回调仅能释放自身。 */
  function closeResultSql(item: NonNullable<typeof resultSql>) {
    setResultSql(current => current === item ? undefined : current);
  }

  /** 确认来源仍是当前结果，使用执行时的原模型范围，禁止按文本查找同文语句。 */
  function locateResultSource() {
    const locator = failureSource.current;
    if (!receiptSource || selectedResultRef.current !== result || !pinNavigationCurrent() ||
        !resultRanges.current.has(receiptSource) || !locator?.available() || !locator.bindRange(receiptSource.sourceRange)) return;
    locateFailure();
  }

  /** 参数结果沿已验证的编辑器范围提取模板，独立草稿不接收执行参数或会话。 */
  function openResultStatement() {
    if (!receiptSource || selectedResultRef.current !== result || !pinNavigationCurrent() ||
        !resultRanges.current.has(receiptSource)) return;
    const sql = failureSource.current?.readRange(receiptSource.sourceRange);
    if (sql === undefined) return;
    try { onChooseQueryTarget?.(resultStatementTargetDraft(tab, sql, 'postgresql')); }
    catch (reason) { setError(errorMessage(reason)); }
  }

  /** 对比只使用当前标签的固定快照，即使本次查询没有行结果也可打开。 */
  function openResultComparison() {
    if (!pinNavigationCurrent() || pinState.items.length < 2) return;
    const draft = { pins: pinState.items, owner: uid() };
    comparisonDraftRef.current = draft;
    setComparisonDraft(draft);
  }

  /** 每批核对当前标签、固定列表和本窗口，逐行校验由对比器完成。 */
  function comparisonCurrent(draft: ComparisonDraft) {
    if (!resultScopeCurrent() || comparisonDraftRef.current !== draft || pinStateRef.current.items !== draft.pins) return false;
    const owned = document.querySelector(`[data-query-result-comparison-owner="${draft.owner}"] [role="dialog"]`);
    return Array.from(document.querySelectorAll(appModalSelector)).every(node => node === owned);
  }

  /** 只撤销准确的对比窗口，取消当前扫描由共享组件负责。 */
  function closeResultComparison(draft: ComparisonDraft) {
    if (comparisonDraftRef.current !== draft) return;
    comparisonDraftRef.current = undefined;
    setComparisonDraft(undefined);
  }

  /** 行详情沿用当前网格的来源校验，另排除遮挡网格的模态窗口。 */
  function rowDetailCurrent(source: QueryRowDetailsBinding | undefined) {
    return resultCurrent() && rowDetails.current(source) && !document.querySelector(appModalSelector);
  }

  /** 同坐标重新点击也采集当前单元格，旧投影的行索引不能重用。 */
  function selectDetailRow(index: number | undefined) {
    if (!detailBinding || !rowDetailCurrent(detailBinding)) return;
    setActiveDetailRow(old => index === undefined ? undefined :
      old?.binding === detailBinding && old.index === index ? old : { binding: detailBinding, index });
  }

  /** 打开准确活动行，保留完整原值。 */
  function openRowDetail() {
    if (!activeDetailRow || activeDetailRow.binding !== detailBinding || !rowDetailCurrent(detailBinding)) return;
    try { setRowDetail(rowDetails.open(detailBinding, activeDetailRow.index)); }
    catch (reason) { setError(errorMessage(reason)); }
  }

  const recordExecution = !pin && state.transactionKnown && !state.transactionOpen &&
    outcome?.postgresQueryRecordExecution !== retiredRecordExecution.current ? outcome?.postgresQueryRecordExecution : undefined;
  const canUpdateQueryRecord = !!recordExecution && outcome?.postgresQueryRecordCapabilities?.update === true;
  const canDeleteQueryRecord = !!recordExecution && outcome?.postgresQueryRecordCapabilities?.delete === true;
  const canDuplicateQueryRecord = !!recordExecution && outcome?.postgresQueryRecordCapabilities?.insert === true;
  const canAddQueryRecord = !!recordExecution && outcome?.postgresQueryRecordCapabilities?.newRecord === true;
  const canBrowseQueryReference = !!recordExecution && outcome?.postgresQueryRecordCapabilities?.reference === true;
  const selectedDetailRow = activeDetailRow && activeDetailRow.binding === detailBinding ? activeDetailRow : undefined;

  /** 本地排序及筛选只改变显示顺序。始终从原执行的行对象取序号。 */
  function browseQueryReference(direction: 'parent' | 'children') {
    const original = session.current;
    if (locked || !canBrowseQueryReference || !recordExecution || !result || !original ||
        !selectedDetailRow || !rowDetailCurrent(detailBinding)) return;
    const rowIndex = result.rows.indexOf(selectedDetailRow.binding.rows[selectedDetailRow.index]);
    if (rowIndex < 0) return;
    const job = acquireWorkspaceBusy(tab.id);
    setRecordReference({ request: { connectionId: tab.connectionId, database: scope.database, sessionId: original.id,
      executionId: recordExecution, tabId: uid(), rowIndex, operation: 'reference' }, direction, result, scope, job });
  }

  function queryReferenceCurrent(view: NonNullable<typeof recordReference>) {
    return view.job.owns() && same(view.scope) && session.current?.id === view.request.sessionId &&
      selectedResultRef.current === view.result && !closeRef.current && useWorkspace.getState().settings.activeTabId === tab.id;
  }

  function closeQueryReference(view: NonNullable<typeof recordReference>) {
    view.job.release();
    setRecordReference(current => current === view ? undefined : current);
  }

  useEffect(() => {
    if (recordReference && !queryReferenceCurrent(recordReference)) closeQueryReference(recordReference);
  });
  const joinTarget = outcome?.postgresQueryRecordJoinTarget;
  const [replaceView, setReplaceView] = useState<{ binding: ResultSelectionBinding; request: PostgresFindRequest }>();
  const replaceKeys = useMemo(() => new Set(outcome?.postgresQueryReplaceColumns?.map(index => result?.columns[index]?.key)), [outcome, result]);
  const replaceWritable = useCallback((column: ResultColumn) => replaceKeys.has(column.key), [replaceKeys]);
  const canReplaceResult = !!binding?.rows.length && canUpdateQueryRecord && !!visibleColumns?.some(replaceWritable);
  const activeReplace = canReplaceResult && binding && replaceView?.binding === binding ? replaceView : undefined;
  const replaceRows = useMemo(() => activeReplace?.binding.rows.map((data, index) =>
    ({ id: String(index), data, inserted: false, deleted: false })) ?? [], [activeReplace]);
  function replaceCurrent() {
    return !!activeReplace && resultCurrent() && !document.querySelector(appModalSelector);
  }
  function openResultReplace(): boolean {
    if (!binding || !canReplaceResult || !resultCurrent() || document.querySelector(appModalSelector)) return false;
    if (activeReplace) { focusQueryResultReplacement(layoutRoot.current); return true; }
    setReplaceView({ binding, request: { replace: true } });
    return true;
  }

  /** 同一原列可以重复投影。整批替换只保留一份相同的原字段更新。 */
  function planQueryReplace(patches: readonly PageTextPatch[]) {
    if (!replaceCurrent() || !activeReplace || !result) throw Error(originsText.editStale);
    const { rows, visibleColumns } = activeReplace.binding;
    const byKey = new Map(visibleColumns.map(column => [column.key, column]));
    const planned = new Map<string, { row: number; column: ResultColumn; columnIndex: number; before: string; after: string }>();
    for (const { rowId, key, before, after } of patches) {
      const row = Number(rowId), column = byKey.get(key), columnIndex = result.columns.findIndex(item => item.key === key);
      const origin = origins?.[columnIndex];
      if (!column || !replaceWritable(column) || !origin || !Number.isSafeInteger(row) || String(row) !== rowId || !rows[row] ||
          ownCell(rows[row], key) !== before) throw Error(originsText.editStale);
      if (before === after) continue;
      const identity = row + ':' + origin.attribute;
      const previous = planned.get(identity);
      if (previous && (previous.before !== before || previous.after !== after)) throw Error(originsText.editStale);
      if (!previous) planned.set(identity, { row, column, columnIndex, before, after });
    }
    const changes = [...planned.values()];
    if (!changes.length) throw Error(findText.noChange);
    const positions = [...new Set(changes.map(patch => patch.row))].sort((a, b) => a - b);
    if (positions.length > postgresTableLimits.changes) throw Error(originsText.replaceLimit);
    return { patches: changes, positions };
  }

  function stageQueryReplace(owner: object, plan: ReturnType<typeof planQueryReplace>) {
    if (!activeReplace || owner !== activeReplace.binding || !replaceCurrent()) throw Error(originsText.editStale);
    const { positions } = plan, indices = new Map(positions.map((row, index) => [row, index]));
    const rows = positions.map(row => activeReplace.binding.rows[row]);
    const patches = plan.patches.map(({ row, columnIndex, before, after }) =>
      ({ rowId: String(indices.get(row)), columnIndex, before, after }));
    if (!openQueryRecords(rows, { range: { kind: 'replace', positions, patches } })) throw Error(originsText.editStale);
    setReplaceView(undefined);
  }
  function writableQueryColumn(index: number) {
    const origin = origins?.[index];
    return !!origin && (joinTarget === undefined || origin.relation === joinTarget);
  }
  /** 网格整理只改变展示顺序，回查使用原结果中的行对象及序号。 */
  function openQueryRecords(rows: readonly DataRow[], { cell, range, operation, deletePositions }: {
    cell?: PostgresQueryCellEdit; range?: PostgresQueryRangeEdit; operation?: 'delete' | 'insert' | 'new'; deletePositions?: readonly number[];
  } = {}): boolean {
    const original = session.current;
    if (!recordExecution || !original || !result || !rowDetailCurrent(detailBinding) ||
        !outcome?.postgresQueryRecordCapabilities?.[operation === 'new' ? 'newRecord' : operation ?? 'update']) return false;
    const rowIndices = rows.map(row => result.rows.indexOf(row));
    if ((operation === 'new' ? rowIndices.length !== 0 : !rowIndices.length) || rowIndices.some(index => index < 0) ||
        new Set(rowIndices).size !== rowIndices.length) return false;
    const job = acquireWorkspaceBusy(tab.id);
    const identity = { sessionId: original.id, executionId: recordExecution };
    const source: PostgresQueryRecordIntent = operation === 'new' ? { ...identity, operation }
      : operation ? { ...identity, rowIndices, operation }
      : range ? { ...identity, rowIndices } : { ...identity, rowIndex: rowIndices[0] };
    setRecordEdit({ result, scope, job, cell, range, source, deletePositions });
    setError('');
    return true;
  }

  /** 批量操作只消费已接纳的勾选，按显示顺序映射回原执行，空选不回退全表。 */
  function openCheckedQueryRows(operation: 'delete' | 'insert') {
    if (!binding || !resultCurrent()) return;
    const checked = resultSelection.checkedIndices(binding);
    if (!checked.length || checked.length > postgresTableLimits.changes) return;
    openQueryRecords(checked.map(index => binding.rows[index]), {
      operation, deletePositions: operation === 'delete' ? checked.map(index => index + 1) : undefined,
    });
  }

  function editQueryCell(cell: QueryResultCopyCell, anchor: HTMLElement, typed?: string): boolean {
    const column = cell.column;
    if (!column || detailBinding?.rows[cell.index] !== cell.row || column.type.toLowerCase() === 'bytea') return false;
    const raw = ownCell(cell.row, column.key);
    if (raw !== null && typeof raw !== 'string') return false;
    const columnIndex = result?.columns.findIndex(item => item.key === column.key) ?? -1;
    if (columnIndex < 0 || !writableQueryColumn(columnIndex)) return false;
    return openQueryRecords([cell.row], { cell: { columnIndex, anchor, typed } });
  }

  /** 按同一显示视图取行和原列序号，筛选、排序及隐藏列均不能改变原位置。 */
  function queryRangeAt(startRow: number, startKey: string, height: number, width: number, selected?: GridRangeTarget<DataRow>) {
    if (!result || !visibleColumns || !detailBinding || !rowDetailCurrent(detailBinding)) throw Error(originsText.editStale);
    const startColumn = visibleColumns.findIndex(column => column.key === startKey);
    if (startColumn < 0 || startRow < 0 || width < 1 || width > postgresTableLimits.fields ||
        height < 1 || height > postgresTableLimits.changes || startColumn + width > visibleColumns.length ||
        startRow + height > detailBinding.rows.length) throw Error(pasteText.bounds);
    const rows = detailBinding.rows.slice(startRow, startRow + height);
    const columns = visibleColumns.slice(startColumn, startColumn + width);
    if (selected && (selected.rows.some((row, index) => row !== rows[index]) ||
        selected.keys.some((key, index) => key !== columns[index]?.key))) throw Error(originsText.editStale);
    const columnIndices = columns.map(column => result.columns.findIndex(origin => origin.key === column.key));
    if (columnIndices.some(index => index < 0)) throw Error(originsText.editStale);
    if (columnIndices.some(index => !writableQueryColumn(index)))
      throw Error(joinTarget === undefined ? originsText.expressionReadOnly : originsText.joinColumnReadOnly);
    return { rows, columnIndices, startRow };
  }

  function fillQueryCells(selected: GridRangeTarget<DataRow>, input: GridRangeFillInput) {
    const { rows, columnIndices, startRow } = queryRangeAt(selected.startRow, selected.keys[0], selected.rows.length, selected.keys.length, selected);
    if (!openQueryRecords(rows, { range: { kind: 'fill', columnIndices, startRow, input } })) throw Error(originsText.editStale);
  }

  /** 同步消费剪贴板事件，矩形确认仍由当前查询执行的快照负责。 */
  function pasteQueryCells(cell: QueryResultCopyCell, data: DataTransfer, selected?: GridRangeTarget<DataRow>) {
    try {
      if (!cell.column || detailBinding?.rows[cell.index] !== cell.row) throw Error(originsText.editStale);
      const matrix = postgresGridPasteMatrix(postgresClipboardInput(data),
        selected ? { rows: selected.rows.length, columns: selected.keys.length } : undefined);
      const { rows, columnIndices, startRow } = queryRangeAt(selected?.startRow ?? cell.index, selected?.keys[0] ?? cell.column.key,
        matrix.length, matrix[0].length, selected);
      if (!openQueryRecords(rows, { range: { kind: 'paste', columnIndices, matrix, startRow } }))
        throw Error(originsText.editStale);
    } catch (reason) { setError(errorMessage(reason)); }
  }
  /** 侧栏翻行只访问当前显示行，旧侧栏回调必须通过同一视图校验。 */
  function moveRowDetail(view: QueryRowDetailsView, index: number) {
    if (!rowDetailCurrent(view.binding) || !rowDetails.valid(view)) return;
    try { setRowDetail(rowDetails.move(view, index)); }
    catch (reason) { setError(errorMessage(reason)); }
  }

  /** 关闭对应侧栏，保留网格中的活动行。 */
  function closeRowDetail(view: QueryRowDetailsView) {
    if (rowDetailCurrent(view.binding) && rowDetails.close(view)) setRowDetail(undefined);
  }

  /** 排序草稿只消费所属结果与排序视图。 */
  function sortCurrent(draft?: SortDraft) {
    return resultScopeCurrent() && !filterDraftRef.current && !columnDraftRef.current && !statisticsDraftRef.current &&
      !presetDraftRef.current && !comparisonDraftRef.current &&
      sortDraftRef.current === draft && !!sortBinding && !!sortView &&
      (!draft || draft.binding === sortBinding && draft.view === sortView) && resultSorter.view(sortBinding) === sortView;
  }

  /** 筛选与排序原视图必须同时有效，迟到草稿不能覆盖另一结果集。 */
  function filterCurrent(draft?: FilterDraft) {
    return resultScopeCurrent() && !sortDraftRef.current && !columnDraftRef.current && !statisticsDraftRef.current &&
      !presetDraftRef.current && !comparisonDraftRef.current &&
      filterDraftRef.current === draft &&
      !!filterBinding && !!filterView && !!sortView &&
      (!draft || draft.binding === filterBinding && draft.view === filterView && draft.sortView === sortView) &&
      resultFilter.view(filterBinding) === filterView && resultSorter.view(sortBinding) === sortView;
  }

  /** 普通入口和快捷入口都打开同一草稿，追加条件与当前生效表达式分开保存。 */
  function openResultFilter(node?: QueryResultFilterRule | QueryResultFilterGroup) {
    if (!filterBinding || !filterView || !sortView || !filterCurrent() ||
        document.querySelector(appModalSelector)) return;
    try {
      const seed = node && appendQueryResultFilterNode(filterView.expression, node);
      beginResultFilter({ binding: filterBinding, view: filterView, sortView, seed });
    } catch (reason) { setError(errorMessage(reason)); }
  }

  /** 提交已经校验的草稿，统计窗口也沿用同一个筛选应用入口。 */
  function beginResultFilter(draft: FilterDraft) {
    filterDraftRef.current = draft;
    setFilterDraft(draft);
  }

  /** 重新核对当前可见列和显示行，从原格填入本地筛选草稿。 */
  function openCellFilter(cell: QueryResultCopyCell, operator: CellFilterOperator) {
    if (!resultCurrent() || !binding) return;
    try {
      const capture = captureQueryResultCellFilter(binding.visibleColumns, binding.rows, cell, undefined, 'postgresql');
      openResultFilter(queryResultCellFilterNode(capture, operator));
    } catch (reason) { setError(errorMessage(reason)); }
  }

  /** 取值须绑定当前勾选或单列矩形，原行列核验后才打开审核草稿。 */
  function openSelectedFilter(capture: QueryResultSelectedFilterCapture, rangeCurrent?: () => boolean, mode: QueryResultSelectedFilterMode = false) {
    const current = () => !!binding && resultCurrent() &&
      (rangeCurrent ? rangeCurrent() : resultSelection.matchesIndices(binding, capture.indices)) &&
      currentQueryResultSelectedFilter(capture, binding.visibleColumns, binding.rows);
    if (!current()) return;
    try {
      const node = queryResultSelectedFilterNode(capture, mode);
      if (current()) openResultFilter(node);
    }
    catch (reason) { setError(errorMessage(reason)); }
  }

  /** 统计以父网格接纳的行索引为准，锁定已显示行和准确可见列。 */
  function openResultStatistics(column: ResultColumn, indices: ReadonlySet<number>) {
    if (!binding || !resultCurrent() || !binding.visibleColumns.includes(column) ||
        document.querySelector(appModalSelector)) return;
    const selected = Array.from(Set.prototype.values.call(indices) as IterableIterator<number>).sort((a, b) => a - b);
    if (selected.length ? !resultSelection.matchesIndices(binding, selected) : resultSelection.count(binding) !== 0) return;
    const draft = { binding, column, indices: new Set(selected), owner: uid() };
    statisticsDraftRef.current = draft;
    setStatisticsDraft(draft);
  }

  /** 扫描批次仅核对工作区和本窗口身份，完整原值校验交由共享扫描器完成。 */
  function statisticsCurrent(draft: StatisticsDraft) {
    if (!resultScopeCurrent() || statisticsDraftRef.current !== draft || binding !== draft.binding) return false;
    const owned = document.querySelector(`[data-query-result-statistics-owner="${draft.owner}"] [role="dialog"]`);
    return Array.from(document.querySelectorAll(appModalSelector)).every(node => node === owned);
  }

  /** 只关闭对应统计窗口。 */
  function closeResultStatistics(draft: StatisticsDraft) {
    if (statisticsDraftRef.current !== draft) return;
    statisticsDraftRef.current = undefined;
    setStatisticsDraft(undefined);
  }

  /** 先验证追加条件，再从分布图交接到同一结果的筛选草稿。 */
  function filterFromStatistics(draft: StatisticsDraft, node: QueryResultFilterRule | QueryResultFilterGroup) {
    if (!statisticsCurrent(draft) || !resultSelection.current(draft.binding) || !filterBinding || !filterView ||
        !sortView || resultFilter.view(filterBinding) !== filterView || resultSorter.view(sortBinding) !== sortView)
      throw Error(statisticsText.stale);
    const seed = appendQueryResultFilterNode(filterView.expression, node);
    closeResultStatistics(draft);
    beginResultFilter({ binding: filterBinding, view: filterView, sortView, seed });
  }

  /** 只关闭自己打开的草稿。 */
  function closeResultFilter(draft: FilterDraft) {
    if (filterDraftRef.current !== draft) return;
    filterDraftRef.current = undefined;
    setFilterDraft(undefined);
    setFilterError('');
  }

  /** 在独立控制器上完整试算筛选和原排序，任何失败都保留现有视图。 */
  function applyResultFilter(expression: QueryResultFilterGroup, draft?: FilterDraft) {
    if (!resultSource || !visibleColumns || !sortView || !filterCurrent(draft)) return;
    try {
      const next = prepareQueryResultOrganization(resultSource, resultContext, visibleColumns,
        { expression, sort: sortView.rules }, 'postgresql');
      if (historyBinding) resultHistory.record(historyBinding, {
        expression: next.filter.view(next.filterBinding)!.expression,
        sort: next.sorter.view(next.sortBinding)!.rules,
      }, next.filterBinding);
      publishResultOrganization(next);
      if (draft) closeResultFilter(draft);
    } catch (reason) {
      if (draft) setFilterError(errorMessage(reason));
      else setError(errorMessage(reason));
    }
  }

  /** 发布已验证的筛选和排序，原勾选、查找及行详情由新的网格绑定重置。 */
  function publishResultOrganization(next: ReturnType<typeof prepareQueryResultOrganization>) {
    resultFilter.invalidate();
    resultSorter.invalidate();
    organization.filter = next.filter;
    organization.sorter = next.sorter;
    resultSelection.invalidate();
    setError('');
    refreshResult(value => value + 1);
  }

  /** 验证历史目标能完整恢复后才移动游标，避免失败丢失重做。 */
  function travelResultHistory(direction: -1 | 1) {
    if (!resultSource || !visibleColumns || !resultCurrent() || document.querySelector(appModalSelector)) return;
    const ticket = resultHistory.target(historyBinding, direction);
    if (!ticket) return;
    try {
      const next = prepareQueryResultOrganization(resultSource, resultContext, visibleColumns, ticket.configuration, 'postgresql');
      resultHistory.commit(ticket, next.filterBinding);
      publishResultOrganization(next);
    } catch (reason) { setError(errorMessage(reason)); }
  }

  /** 打开时捕获当前条件、排序、字段身份和冻结边界，沿用原本机方案存储。 */
  function openResultPresets() {
    if (!binding || !resultSource || !visibleColumns || !filterView || !sortView || !historyBinding ||
        !resultCurrent() || document.querySelector(appModalSelector)) return;
    try {
      const value = queryResultPresetValueSchema.parse(captureQueryResultMemory(resultSource, visibleColumns,
        { expression: filterView.expression, sort: sortView.rules }, layout?.frozenThrough, 'postgresql'));
      const draft = { binding, value, owner: uid() };
      presetDraftRef.current = draft;
      setPresetDraft(draft);
    } catch (reason) { setError(errorMessage(reason)); }
  }

  /** 异步读写前后均核对原结果、连接和模态归属，旧回包不能应用到其它结果。 */
  function presetCurrent(draft: PresetDraft) {
    if (!resultScopeCurrent() || presetDraftRef.current !== draft || !resultSelection.current(draft.binding)) return false;
    const owned = document.querySelector(`[data-query-result-presets-owner="${draft.owner}"] [role="dialog"]`);
    return Array.from(document.querySelectorAll(appModalSelector)).every(node => node === owned);
  }

  /** 只关闭本代窗口，迟到的关闭不能撤销后来打开的方案。 */
  function closeResultPresets(draft: PresetDraft) {
    if (presetDraftRef.current !== draft) return;
    presetDraftRef.current = undefined;
    setPresetDraft(undefined);
  }

  /** 保存的配置须匹配完整列及可见顺序；完整试算成功才发布，并记录一整步撤销。 */
  function applyResultPreset(draft: PresetDraft, value: QueryResultPresetValue) {
    if (!resultSource || !visibleColumns || !historyBinding || !presetCurrent(draft)) throw Error(presetsText.stale);
    if (!queryResultMemoryMatches(value, resultSource, visibleColumns)) throw Error(presetsText.mismatch);
    const keys = resultSource.columns.map(column => column.key);
    const nextLayout = setQueryResultFrozenThrough(layout ?? { order: keys, visible: keys }, value.frozenThrough);
    const next = prepareQueryResultOrganization(resultSource, resultContext, visibleColumns, value.configuration, 'postgresql');
    resultHistory.record(historyBinding, {
      expression: next.filter.view(next.filterBinding)!.expression,
      sort: next.sorter.view(next.sortBinding)!.rules,
    }, next.filterBinding);
    setColumnLayout({ source: resultSource, layout: nextLayout, columns: visibleColumns });
    closeResultPresets(draft);
    publishResultOrganization(next);
  }

  /** 只关闭准确的草稿，旧面板不能关闭后来打开的排序。 */
  function closeResultSort(draft: SortDraft) {
    if (sortDraftRef.current !== draft) return;
    sortDraftRef.current = undefined;
    setSortDraft(undefined);
  }

  /** 单列与多列共用同一投影，成功后撤销旧行位置并重建导出选择。 */
  function applyResultSort(rules: QueryResultSortRule[], draft?: SortDraft) {
    if (!sortBinding || !sortView || !sortCurrent(draft)) return false;
    try {
      const sorted = resultSorter.apply(sortBinding, sortView, rules);
      if (historyBinding && filterView) resultHistory.record(historyBinding, { expression: filterView.expression, sort: sorted.rules });
      resultSelection.invalidate();
      if (draft) closeResultSort(draft);
      refreshResult(value => value + 1);
      return true;
    } catch (reason) {
      if (draft) throw reason;
      setError(errorMessage(reason));
      return false;
    }
  }

  /** 列管理从当前已返回的显示行取样，以原列键维护所有列的草稿。 */
  function openResultColumns() {
    if (!binding || !resultCurrent() || document.querySelector(appModalSelector)) return;
    try {
      const keys = queryResultColumnKeys(binding.columns);
      const draft = { binding, owner: uid(), initial: layout ?? { order: keys, visible: keys } };
      columnDraftRef.current = draft;
      setColumnDraft(draft);
    } catch (reason) { setError(errorMessage(reason)); }
  }

  /** 应用时只允许本草稿的窗口存在，并再次核对结果及连接归属。 */
  function columnCurrent(draft: ColumnDraft) {
    if (!resultScopeCurrent() || columnDraftRef.current !== draft || !resultSelection.current(draft.binding)) return false;
    const owned = document.querySelector(`[data-query-columns-owner="${draft.owner}"] [role="dialog"]`);
    return Array.from(document.querySelectorAll(appModalSelector)).every(node => node === owned);
  }

  /** 关闭时撤销旧网格回执，迟到的草稿事件不能修改后续结果。 */
  function closeResultColumns(draft: ColumnDraft) {
    if (columnDraftRef.current !== draft) return;
    columnDraftRef.current = undefined;
    resultSelection.invalidate();
    setColumnDraft(undefined);
  }

  /** 在新列投影上验证原筛选和排序，全部通过才切换视图。 */
  function applyResultColumns(draft: ColumnDraft, nextLayout: QueryResultColumnLayout) {
    if (!columnCurrent(draft)) return;
    publishResultColumns(nextLayout);
    closeResultColumns(draft);
  }

  function publishResultColumns(nextLayout: QueryResultColumnLayout): void {
    if (!resultSource || !visibleColumns || !filterView || !sortView) return;
    const projected = queryResultVisibleColumns(resultSource.columns, nextLayout);
    const changed = projected.length !== visibleColumns.length || projected.some((column, index) => column !== visibleColumns[index]);
    if (changed) {
      const keys = new Set(projected.map(column => column.key));
      if ([...filterView.rules, ...sortView.rules].some(rule => !keys.has(rule.column))) throw Error(columnText.activeRule);
      const next = prepareQueryResultOrganization(resultSource, resultContext, projected,
        { expression: filterView.expression, sort: sortView.rules }, 'postgresql');
      resultHistory.invalidate();
      resultFilter.invalidate();
      resultSorter.invalidate();
      organization.filter = next.filter;
      organization.sorter = next.sorter;
    }
    setColumnLayout({ source: resultSource, layout: nextLayout, columns: changed ? projected : visibleColumns });
  }

  /** 网格拖动只更新当前可见列的宽度，沿用行、列投影及其它显示配置。 */
  function resizeResultColumns(sizes: ColumnWidths) {
    if (!resultSource || !visibleColumns || !resultCurrent()) return;
    const widths = new Map(layout?.widths);
    let changed = false;
    for (const { key } of visibleColumns) {
      const size = sizes.get(key);
      if (size?.type !== 'resized' || !Number.isFinite(size.width)) continue;
      const width = Math.max(queryResultColumnWidth.min, Math.min(queryResultColumnWidth.max, Math.round(size.width)));
      if (widths.get(key) === width) continue;
      widths.set(key, width);
      changed = true;
    }
    if (!changed) return;
    const keys = resultSource.columns.map(column => column.key);
    setColumnLayout({ source: resultSource, columns: visibleColumns,
      layout: { ...(layout ?? { order: keys, visible: keys }), widths } });
  }

  function resizeResultRowHeight(height: number): void {
    if (!resultSource || !visibleColumns || !resultCurrent()) return;
    setColumnLayout({ source: resultSource, columns: visibleColumns, layout: setQueryResultRowHeight(resultSource.columns, layout, height) });
  }

  const headerFreeze = {
    current: resultCurrent,
    apply(key?: string) {
      if (!resultSource || !visibleColumns) return;
      try {
        const keys = queryResultColumnKeys(resultSource.columns);
        const next = setQueryResultFrozenThrough(layout ?? { order: keys, visible: keys }, key);
        setColumnLayout({ source: resultSource, layout: next, columns: visibleColumns });
      } catch (reason) { setError(errorMessage(reason)); }
    },
  };

  const columnVisibility = {
    current: () => !!filterView && !!sortView && resultCurrent(),
    canHide: (visibleColumns?.length ?? 0) > 1, hasHidden: !!visibleColumns && visibleColumns.length < (resultSource?.columns.length ?? 0),
    apply: (key?: string) => changeHeaderColumnLayout(layout => setQueryResultHeaderColumnVisibility(layout, key)),
  };
  /** 显隐和拖动通过同一布局接纳门，保留原结果及有效整理规则。 */
  function changeHeaderColumnLayout(update: (layout: QueryResultColumnLayout) => QueryResultColumnLayout): void {
    if (!resultSource || !columnVisibility.current()) return;
    try {
      const keys = queryResultColumnKeys(resultSource.columns);
      const base = layout ?? { order: keys, visible: keys }, next = update(base);
      if (next === base) return;
      publishResultColumns(next);
      resultSelection.invalidate(); setError('');
    } catch (reason) { setError(errorMessage(reason)); }
  }
  function reorderResultColumns(from: string, to: string): void {
    changeHeaderColumnLayout(layout => reorderQueryResultColumn(layout, from, to));
  }

  /** 仅接收当前网格送出的行位置；校验失败后旧勾选失效。 */
  function acceptResultSelection(selection: ResultGridSelection) {
    if (!resultCurrent()) return false;
    try {
      if (!resultSelection.select(binding, selection)) return false;
      refreshResult(value => value + 1);
      return true;
    } catch (reason) {
      resultSelection.invalidate();
      setError(errorMessage(reason));
      return false;
    }
  }
  function changeMatchView(indices?: ReadonlySet<number>, kind: QueryResultRowViewKind = 'find'): void {
    if (!resultCurrent() || document.querySelector(appModalSelector)) return;
    const invalidate = () => {
      resultSelection.invalidate();
      rowDetails.invalidate();
      setRowDetail(undefined);
      setActiveDetailRow(undefined);
    };
    if (kind !== 'find' && (!indices || !resultSelection.matchesIndices(binding, [...indices]))) return;
    try {
      if (indices) matchView.apply(indices, invalidate, kind);
      else matchView.clear(invalidate);
    } catch (reason) { setError(errorMessage(reason)); }
  }

  /** 打开时冻结导出内容，不通过会话、SQL 或数据库连接再次读取。 */
  function openResultExport(selectedOnly: boolean) {
    if (!resultCurrent() || document.querySelector(appModalSelector)) return;
    try {
      const snapshot = selectedOnly ? resultSelection.snapshot(binding) : resultSelection.allSnapshot(binding);
      exportOpen.current = true;
      setExportView({ result: snapshot, selected: selectedOnly });
    } catch (reason) { setError(errorMessage(reason)); }
  }

  /** 仅消费当前结果代次已接纳的勾选，不读取连接或再次执行原 SQL。 */
  function captureResultTransfer() {
    if (pin || !binding || !resultCurrent() || document.querySelector(appModalSelector)) return;
    try {
      const snapshot = capturePostgresQueryTransfer({
        connectionId: tab.connectionId, label: profile?.name ?? tab.connectionId, database: scope.database,
        title: tab.title, result: selected + 1,
      }, resultSelection.snapshot(binding), binding.visibleColumns);
      usePostgresRecordTransfer.setState({ snapshot });
      workspace.notify(transferText.queryCapturedToNetwork(snapshot.rows.length));
    } catch (reason) { setError(errorMessage(reason)); }
  }
  const hasPaneResult = !!(result || outcome?.analysis || outcome?.explain);
  /** 恢复编辑区时保留原模型、选区及偏好的结果位置。 */
  function focusQueryPane(pane: 'editor' | 'result'): boolean {
    const instance = editor.current;
    if (!instance || !available() || files.isBusy()) return false;
    if (pane === 'result') return hasPaneResult && focusQueryResultPane(layoutRoot.current);
    if (resultsOnly) flushSync(() => setResultsOnly(false));
    instance.focus();
    return instance.hasTextFocus();
  }
  /** 菜单、快捷键和工具栏只操作活动标签中已同步且可编辑的原模型。 */
  function commandEditor() {
    const instance = editor.current;
    const model = instance?.getModel();
    if (!instance || !model || model.isDisposed() || !available() || files.isBusy() || instance.getRawOptions().readOnly) return;
    const draft = currentTab()?.sql ?? '';
    if (model.getValue() === draft.replace(/\r\n|\r|\n/g, model.getEOL())) {
      // 显式编辑命令先恢复原编辑区，不卸载模型或让定位动作落在隐藏控件。
      if (resultsOnly) flushSync(() => setResultsOnly(false));
      return { instance, model };
    }
  }
  /** 视图设计使用独立连接，复制原编辑器查询并保留当前结果和事务。 */
  function openViewDesign() {
    if (!onCreateView || resultsOnly || !available() || files.isBusy() || !profile) return;
    try {
      onCreateView({ tabId: tab.id, connectionId: tab.connectionId, version, database: scope.database,
        dialect: 'postgresql', sql: queryViewFromEditor(editor.current, 'postgresql') });
    } catch (reason) { setError(errorMessage(reason)); }
  }
  /** 布局只通过既有租约合并当前标签字段，不持有或回写旧SQL快照。 */
  function beginEditorLayout(cancel: () => void, dimension: 'height' | 'width' = 'height') {
    return beginWorkspaceQueryLayout(tab, version, () => alive.current && !closeRef.current && !phase.current && !insertionLocked.current, cancel, dimension);
  }
  function changeResultLayout(value: string) {
    if (!available()) return;
    if (value === 'results') { setResultsOnly(true); return; }
    if (value !== 'below' && value !== 'beside') return;
    setResultsOnly(false);
    if (preferredPlacement !== value) useWorkspace.getState().updateTab(tab.id, {queryResultPlacement: value});
  }
  async function editorAction(actionId: string, explicitSelection = false) {
    const target = commandEditor();
    if (!target || explicitSelection && !hasExplicitCaseSelection(target.instance)) return;
    const action = target.instance.getAction(actionId);
    if (!action?.isSupported()) return;
    target.instance.focus();
    await action.run();
  }
  function toggleBlockComment() {
    if (resultsOnly) return;
    const target = commandEditor();
    if (!target) return;
    try { editSqlBlockComment(target.instance, 'postgresql'); }
    catch (reason) { useWorkspace.getState().notify(errorMessage(reason), true); }
  }
  function formatQuery(mode: SqlFormattingMode = 'format') {
    const target = commandEditor();
    if (!target) return;
    try {
      const settings = useWorkspace.getState().settings;
      setError('');
      formatSqlEditor(target.instance, { dialect: 'postgresql', tabSize: settings.editorTabSize, insertSpaces: settings.editorInsertSpaces, expressionWidth: settings.sqlExpressionWidth }, mode);
    } catch (reason) { setError(errorMessage(reason)); }
  }
  function openFormattingOptions() {
    if (formatOptions || !commandEditor()) return;
    try {
      setFormatOptions(captureQueryFormattingOptions(tab.id, () => editor.current, 'postgresql', () => available(true) && !files.isBusy()));
    } catch (reason) { setError(errorMessage(reason)); }
  }
  function openSaveQuery() {
    if (commandEditor()) setSave(true);
  }
  /** 捕获要重新执行的正文及其目标。选择文件期间不会读取后来编辑的草稿。 */
  function openFullExport(mode: 'selection-or-all' | 'current' = 'selection-or-all') {
    const target = commandEditor(), draft = currentTab();
    if (!target || !draft) return;
    const selections = target.instance.getSelections();
    const selection = selections?.[0];
    if (selections?.length !== 1 || !selection) { setError(fullExportText.singleSource); return; }
    const version = target.model.getVersionId(), fromCurrentStatement = mode === 'current';
    let sql: string;
    try {
      if (fromCurrentStatement) {
        const caret = target.instance.getPosition();
        if (!caret) throw Error(fullExportText.singleSource);
        sql = postgresCurrentQueryExportSource(target.model.getValue(), target.model.getOffsetAt(caret));
      } else sql = selection.isEmpty() ? target.model.getValue() : target.model.getValueInRange(selection);
      if (!sql.trim()) throw Error(fullExportText.singleSource);
    } catch (reason) { setError(errorMessage(reason)); return; }
    setFullExport({tabId: draft.id, connectionId: draft.connectionId, database: scope.database, sql, fromCurrentStatement,
      current: () => same(scope) && currentTab() === draft && useWorkspace.getState().settings.activeTabId === draft.id &&
        !closeRef.current && editor.current === target.instance && target.instance.getModel() === target.model &&
        !target.model.isDisposed() && target.model.getVersionId() === version});
  }
  /** 打开片段库时捕获原选区；预览编辑器和本地保存不能接管查询模型。 */
  function openSnippets(create = false, instance = editor.current) {
    const target = commandEditor();
    if (!target || target.instance !== instance) return;
    const ranges = instance.getSelections();
    if (ranges?.length !== 1) { setError(zh.snippets.singleTarget); return; }
    const range = ranges[0], length = target.model.getValueLengthInRange(range);
    if (create && range.isEmpty()) return;
    if (create && length > SNIPPET_LIMITS.sql) { setError(zh.snippets.selectionTooLong); return; }
    const selected = length <= SNIPPET_LIMITS.sql ? target.model.getValueInRange(range) : '';
    if (create && !selected.trim()) { setError(zh.snippets.selectionBlank); return; }
    const initialSql = selected || (target.model.getValueLength() <= SNIPPET_LIMITS.sql ? target.model.getValue() : '');
    snippetTarget.current?.dispose();
    snippetTarget.current = captureInsertion(instance, true, 'snippet');
    if (snippetTarget.current) setSnippets({ initialSql, create });
  }
  function closeSnippets() {
    snippetTarget.current?.dispose();
    snippetTarget.current = null;
    setSnippets(undefined);
  }
  /** 只消费原选区和单一撤销组；内置字段可以逐项填写，用户正文按原文插入。 */
  function insertSnippet(snippet: SqlSnippet) {
    const instance = editor.current, target = snippetTarget.current;
    if (!instance || !target?.current()) throw Error(zh.snippets.insertChanged);
    target.insert(snippet.sql, undefined, prepareBuiltinSnippetInsert(instance, snippet));
    closeSnippets();
    window.setTimeout(() => {
      if (alive.current && editor.current === instance && useWorkspace.getState().settings.activeTabId === tab.id) instance.focus();
    }, 0);
  }
  /** 复制只读取原草稿和固定数据库上下文，沿既有意图保护新建未绑定的独立查询。 */
  async function duplicateQuery(mode: QueryDuplicateMode = 'all', expectedEditor = editor.current, statements?: readonly NavigableStatement[], output?: StatementQueryOutput) {
    const library = output?.mode === 'save-statements' ? output : undefined;
    if (duplicateIntent.current || expectedEditor !== editor.current ||
        (mode === 'selection' || mode === 'statement' || !!output) && resultsOnly || !commandEditor()) {
      if (library) throw Error(queryDuplicateZh.unavailable);
      return;
    }
    let intent: QueryDuplicateIntent | undefined;
    try {
      intent = new QueryDuplicateIntent({
        editor: () => editor.current,
        flush: flushEditorContent,
        scope: () => {
          const workspace = useWorkspace.getState();
          const current = workspace.settings.tabs.find(item => item.id === tab.id);
          const connection = workspace.connections.find(item => item.id === current?.connectionId);
          const origin = duplicateOrigin.current;
          return {
            tab: current, connection, connectionVersion: workspace.connectionVersions[current?.connectionId ?? ''] ?? 0,
            sessionId: session.current?.id ?? '',
            present: alive.current && current?.kind === 'query' && connection?.dialect === 'postgresql' &&
              current.connectionId === origin.connectionId && (workspace.connectionVersions[current.connectionId] ?? 0) === origin.version,
            active: workspace.settings.activeTabId === tab.id,
            blocked: insertionLocked.current || !!phase.current || !!workspace.activeJobs[tab.id] || !!closeRef.current ||
              fileOperation.current() || !!document.querySelector(appModalSelector) || !!output && output.mode !== 'statements' && !output.current(),
          };
        },
        subscribe: changed => {
          const release = useWorkspace.subscribe(changed);
          const observer = new MutationObserver(records => {
            if (records.some(record => [...record.addedNodes].some(node =>
              isAppModalNode(node) || node.nodeType === 1 && !!(node as Element).querySelector(appModalSelector))))
              intent?.dispose();
          });
          observer.observe(document.body, { childList: true, subtree: true });
          return () => { release(); observer.disconnect(); };
        },
        database: initial => {
          const connection = initial.connection;
          if (connection?.dialect !== 'postgresql') throw Error(queryDuplicateZh.changed);
          const original = session.current;
          if (initial.sessionId && (!original || original.id !== initial.sessionId || !same(original.scope)))
            throw Error(queryDuplicateZh.changed);
          return { state: 'known', database: original?.scope.database || initial.tab?.database || connection.database || 'postgres' };
        },
        open: candidate => {
          if (library) return saveStatementQuery(candidate, library.libraryName, library.group);
          const workspace = useWorkspace.getState();
          if (workspace.settings.tabs.length >= 100) throw Error(queryDuplicateZh.tooMany);
          workspace.openTab(candidate);
        },
        openBatch: openStatementDraftBatch,
        chooseTarget: onChooseQueryTarget,
      }, mode, statements);
      duplicateIntent.current = intent;
      setDuplicating(true);
      await intent.run();
    } catch (reason) {
      if (library) throw reason;
      if (alive.current) setError(errorMessage(reason));
    } finally {
      intent?.dispose();
      if (duplicateIntent.current === intent) {
        duplicateIntent.current = undefined;
        if (alive.current) setDuplicating(false);
      }
    }
  }
  const editable = !!profile && !!editorInstance && !locked;
  const canDuplicateQuery = editable && !duplicating && duplicateOrigin.current.connectionId === tab.connectionId &&
    duplicateOrigin.current.version === version;
  const canRun = editable && state.transactionKnown;
  const canPlan = canRun && !state.transactionFailed;
  const canStop = busy && !!phase.current && !phase.current.cancelled;
  const navigation = usePostgresStatementNavigation(() => {
    const target = commandEditor(), draft = currentTab(), original = session.current;
    if (!target || !draft || locked) return;
    return { ...target, sessionId: original?.id, current: () =>
      available() && !files.isBusy() && currentTab() === draft && session.current === original &&
      editor.current === target.instance && !target.instance.getRawOptions().readOnly };
  }, (instance, ranges, output) =>
    duplicateQuery(output?.mode ?? 'statement', instance, ranges, output));
  const canNavigate = editable && !navigation.busy;
  const canOpenStatementQuery = canNavigate && canDuplicateQuery && !resultsOnly;
  const commands: Partial<Record<UiCommandId, UiCommandHandler>> = {
    execute: { enabled: canRun, run: () => run() },
    'execute-selection': { enabled: canRun && editorSelection.single, run: () => run('selection') },
    'execute-current': { enabled: canRun, run: () => run('current') },
    'execute-all': { enabled: canRun, run: () => run('all') },
    'statement-navigation': { enabled: canNavigate, run: () => navigation.open() },
    'select-current-statement': { enabled: canNavigate, run: () => navigation.open('select') },
    'open-current-statement-query': { enabled: canOpenStatementQuery, run: () => navigation.open('duplicate') },
    'previous-statement': { enabled: canNavigate, run: () => navigation.open('previous') },
    'next-statement': { enabled: canNavigate, run: () => navigation.open('next') },
    stop: { enabled: canStop, run: stop },
    explain: { enabled: canPlan, run: () => run('explain') },
    analyze: { enabled: canPlan, run: () => run('analyzePreview') },
    parameters: { enabled: canRun, run: openParameters },
    format: { enabled: editable, run: formatQuery },
    'compact-sql': { enabled: editable, run: () => formatQuery('compact') },
    'sql-format-options': { enabled: editable, run: openFormattingOptions },
    'save-query': { enabled: editable, run: openSaveQuery },
    'focus-query-pane': { enabled: editable && (hasPaneResult || resultsOnly),
      run: () => { focusQueryPane(editor.current?.hasTextFocus() ? 'result' : 'editor'); } },
    'sql-copy-quoted': { enabled: editable && !resultsOnly && editorSelection.single, run: () => editorAction(sqlQuotedCopyAction) },
    'sql-clipboard-stack': { enabled: editable && !resultsOnly, run: () => editorAction(sqlClipboardStackAction) },
    'sql-selection-to-snippet': { enabled: editable && editorSelection.single, run: () => openSnippets(true) },
    find: { enabled: (editable || !!binding) && !locked,
      run: () => { if (!openFocusedQueryResultFind(layoutRoot.current)) return editorAction('actions.find'); } },
    replace: { enabled: editable || canReplaceResult,
      run: () => runFocusedQueryReplace(layoutRoot.current, openResultReplace, () => editorAction('editor.action.startFindReplaceAction')) },
    'sql-find-selection': { enabled: editable && !resultsOnly && editorSelection.single, run: () => editorAction('sql-find-selection') },
    'sql-replace-selection': { enabled: editable && !resultsOnly && editorSelection.single, run: () => editorAction('sql-replace-selection') },
    'sql-goto-line': { enabled: editable, run: () => { if (!openFocusedGridRowJump()) return editorAction(sqlPositionActions['sql-goto-line']); } },
    'sql-toggle-comment': { enabled: editable, run: () => editorAction('editor.action.commentLine') },
    'sql-toggle-block-comment': { enabled: editable && !resultsOnly && editorSelection.single, run: toggleBlockComment },
    'sql-uppercase': { enabled: editable && editorSelection.explicit, run: () => editorAction(sqlTextActions['sql-uppercase'], true) },
    'sql-lowercase': { enabled: editable && editorSelection.explicit, run: () => editorAction(sqlTextActions['sql-lowercase'], true) },
  };
  for (const id of bracketCommands) commands[id] = { enabled: editable, run: () => editorAction(sqlPositionActions[id]) };
  for (const id of sqlLineCommandIds) commands[id] = { enabled: editable, run: () => editorAction(sqlTextActions[id]) };
  for (const id of sqlEditorZoomCommandIds) commands[id] = { enabled: editable && !resultsOnly, run: () => editorAction(id) };
  useUiCommandScope(`tab:${tab.id}`, commands, {
    active: workspace.settings.activeTabId === tab.id && !closeRequest,
    contextKey: JSON.stringify([scope.database, session.current?.id, phase.current?.taskId, state.transactionKnown, state.transactionFailed]),
  });
  useEffect(() => {
    if (!editorInstance || !editable || workspace.settings.activeTabId !== tab.id) return;
    let active = true;
    // 右键与原生菜单走同一编辑命令。旧右键项不能操作已切换或重建的模型。
    const menuModel = editorInstance.getModel();
    const blockComment = editorInstance.addAction({
      id: `dbark-postgres-block-comment:${uid()}`, label: uiCommandLabels['sql-toggle-block-comment'],
      precondition: 'editorHasSelection && !editorHasMultipleSelections && !editorReadonly',
      contextMenuGroupId: 'modification', contextMenuOrder: 2.5,
      run: () => {
        if (active && editor.current === editorInstance && editorInstance.getModel() === menuModel) toggleBlockComment();
      },
    });
    const editActions = (['sql-toggle-comment', 'sql-uppercase', 'sql-lowercase', ...sqlLineCommandIds] as const)
      .map((id, order) => editorInstance.addAction({
        id: `dbark-postgres-${id}:${uid()}`, label: uiCommandLabels[id],
        precondition: id === 'sql-uppercase' || id === 'sql-lowercase' ? 'editorHasSelection && !editorReadonly' : '!editorReadonly',
        contextMenuGroupId: order < 3 ? 'modification' : 'modification-lines',
        contextMenuOrder: order < 3 ? 2 + order : order - 3,
        run: () => {
          if (active && editor.current === editorInstance && editorInstance.getModel() === menuModel && !resultsOnly)
            return commands[id]?.run();
        },
      }));
    const action = editorInstance.addAction({
      id: `dbark-postgres-selection-to-snippet:${uid()}`, label: uiCommandLabels['sql-selection-to-snippet'],
      precondition: 'editorHasSelection && !editorHasMultipleSelections && !editorReadonly',
      contextMenuGroupId: 'modification', contextMenuOrder: 6,
      run: () => { if (active) openSnippets(true, editorInstance); },
    });
    const selectionQuery = editorInstance.addAction({
      id: `dbark-postgres-open-selection-query:${uid()}`, label: queryDuplicateZh.selection,
      precondition: 'editorHasSelection && !editorHasMultipleSelections && !editorReadonly',
      contextMenuGroupId: 'modification', contextMenuOrder: 7,
      run: () => { if (active) return duplicateQuery('selection', editorInstance); },
    });
    const statementQuery = editorInstance.addAction({
      id: `dbark-postgres-open-current-statement-query:${uid()}`, label: uiCommandLabels['open-current-statement-query'],
      precondition: '!editorReadonly && !editorHasMultipleSelections', contextMenuGroupId: 'navigation', contextMenuOrder: 1.69,
      run: () => { if (active && canOpenStatementQuery) navigation.open('duplicate'); },
    });
    return () => { active = false; blockComment.dispose(); for (const edit of editActions) edit.dispose(); action.dispose(); selectionQuery.dispose(); statementQuery.dispose(); };
  }, [editorInstance, editable, resultsOnly, workspace.settings.activeTabId, tab.id, tab.sql, profile, version, canOpenStatementQuery]);
  const renderResultGrid = (target?: GridFindTarget, marks?: ReadonlySet<string>) => result && displayResult ? (
    <ResultsGrid zoomable columns={visibleColumns ?? result.columns} rows={displayResult.rows} navigateTo={target} findMarks={marks} rowJump selectionScope={binding}
      insertSql={rowSql?.insert} updateSql={rowSql?.update} deleteSql={rowSql?.delete} primaryKeySql={rowSql?.select}
      onOpenRowSql={rowSql ? (kind, sql) => {
        if (resultCurrent() && !document.querySelector(appModalSelector))
          openRowSqlDraft({ connectionId: tab.connectionId, database: scope.database, table: rowSql.table }, kind, sql);
      } : undefined}
      frozenKeys={frozenKeys} freezeColumns={headerFreeze} columnVisibility={columnVisibility} onColumnReorder={reorderResultColumns} columnWidths={layout?.widths} rowHeight={layout?.rowHeight} onRowHeightChange={resizeResultRowHeight} onColumnWidthsChange={resizeResultColumns}
      isCurrent={binding ? resultCurrent : undefined} onSelectionChange={binding ? acceptResultSelection : undefined}
      onShowRows={binding ? changeMatchView : undefined}
      onExportRange={binding ? result => {
        if (!resultCurrent() || document.querySelector(appModalSelector)) return;
        exportOpen.current = true;
        setExportView({ result, selected: false, scope: 'rectangle' });
      } : undefined}
      onActiveCellChange={cell => selectDetailRow(cell?.column ? cell.index : undefined)}
      onCellEdit={canUpdateQueryRecord ? editQueryCell : undefined}
      onCellPaste={canUpdateQueryRecord ? pasteQueryCells : undefined}
      onFillRange={canUpdateQueryRecord ? fillQueryCells : undefined}
      filterDialect="postgresql"
      onFilterCell={filterBinding && sortView && binding ? openCellFilter : undefined}
      onStageFindFilter={filterBinding && sortView && binding ? openResultFilter : undefined} findFilterSource={filterBinding?.source}
      onFilterSelected={filterBinding && sortView && binding ? openSelectedFilter : undefined}
      onStatistics={binding ? openResultStatistics : undefined}
      onHistoryTravel={binding && historyBinding ? travelResultHistory : undefined}
      sort={sortView ? [...sortView.rules] : undefined} sortReasons={sortBinding?.reasons}
      onSortChange={sortView ? rules => applyResultSort(rules) : undefined} />
  ) : null;

  return (
    <div ref={layoutRoot} className="workspace-tab query-tab postgres-query" data-result-layout={resultLayout}
      onKeyDownCapture={event => {
        const focused = () => !!editor.current?.hasTextFocus();
        if (handleQueryPaneShortcut(event, focused, focusQueryPane)) return;
        if (handleQueryExecutionShortcut(event, tab.id, focused) || handleQueryResultReplaceShortcut(event, openResultReplace)) return;
        handleQueryResultShortcut(event, focused, results.length, selectCurrentResult);
      }}>
      {formatOptions && <QueryFormattingOptionsDialog options={formatOptions} onClose={() => setFormatOptions(undefined)}/>}
      <div className="context-bar">
        <strong>{profile?.name}</strong>
        <span>PostgreSQL / {scope.database}</span>
        <QueryFileSourceCaption tab={tab} files={files} compact />
        <span>{session.current ? '原查询会话' : '尚未连接'}</span>
        <label className="check" title={text.continueHint}><input type="checkbox" checked={continueOnError} disabled={locked}
          onChange={event => setContinueOnError(event.target.checked)} />{continueText.option}</label>
      </div>
      <QueryResultSnapshotActions result={resultSource} canSaveShown={!!dataResult && !!visibleColumns?.length} disabled={locked} begin={beginResultSnapshot}
        renderActions={snapshotActions => <QueryFileActions
        tab={tab}
        files={files}
        renderActions={(actions) => (
          <div className="query-toolbar postgres-toolbar">
            {actions}
            <button disabled={!canRun} onClick={() => run()}>
              {text.execute}
            </button>
            <button disabled={!canRun} onClick={() => run('current')}>
              {text.current}
            </button>
            <button disabled={!canNavigate} onClick={() => navigation.open()}>
              {navigationText.entry}
            </button>
            <button disabled={!canPlan} onClick={() => run('explain')}>
              {text.explain}
            </button>
            <button disabled={!canPlan} onClick={() => run('analyzePreview')}>
              {queryAnalyzeZh.open}
            </button>
            <button disabled={!canRun} onClick={openParameters}>
              {text.parameters}
            </button>
            <button disabled={!canStop} onClick={stop}>
              {text.stop}
            </button>
            <button disabled={!editable} title={sqlFormattingZh.hint} onClick={() => formatQuery()}>
              {text.format}
            </button>
            <button disabled={!editable} title={sqlFormattingZh.compactHint} onClick={() => formatQuery('compact')}>{sqlFormattingZh.compact}</button>
            <button disabled={!editable} onClick={openFormattingOptions}>{sqlFormattingZh.options}</button>
            <button disabled={!editable} onClick={openSaveQuery}>
              {text.save}
            </button>
            <button disabled={!editable} onClick={() => openFullExport()}>{fullExportText.open}</button>
            <button disabled={!editable} onClick={() => openFullExport('current')}>{fullExportText.openCurrent}</button>
            <button disabled={!editable} onClick={() => openSnippets()}>{zh.snippets.title}</button>
            <button disabled={!canDuplicateQuery} title={queryDuplicateZh.hint}
              onClick={() => void duplicateQuery()}>{queryDuplicateZh.action}</button>
            <button disabled={!canDuplicateQuery || !editorSelection.single || resultsOnly} title={queryDuplicateZh.selectionHint}
              onClick={() => void duplicateQuery('selection')}>{queryDuplicateZh.selection}</button>
            <button disabled={!canOpenStatementQuery} title={queryDuplicateZh.statementHint}
              onClick={() => navigation.open('duplicate')}>{uiCommandLabels['open-current-statement-query']}</button>
            {onCreateView && <button disabled={!editable || resultsOnly} title={queryViewText.hint}
              onClick={openViewDesign}>{queryViewText.entry}</button>}
            {onChooseQueryTarget && <button disabled={!canDuplicateQuery} title={queryDuplicateZh.targetHint}
              onClick={() => void duplicateQuery('target')}>{queryDuplicateZh.targetAction}</button>}
            <button disabled={locked} onClick={onHistory}>
              {text.history}
            </button>
            <button disabled={locked || !session.current} onClick={() => void reconnect()}>
              {text.reconnect}
            </button>
            <button disabled={!editable} onClick={() => openSessionSetting('transaction')}>{transactionText.open}</button>
            <button disabled={!editable} onClick={() => openSessionSetting('search-path')}>{searchPathText.open}</button>
            <button disabled={!editable} onClick={() => openSessionSetting('timeouts')}>{timeoutText.open}</button>
            {snapshotActions}
          </div>
        )}
      />} />
      <ErrorBox message={error} />
      {continueOnError && <p className="muted small" role="note">{text.continueHint}</p>}
      {outcome?.scriptReport && <QueryContinueOnErrorNotice report={outcome.scriptReport} completedResults={outcome.results.length}
        locateAvailable={failure => !pin && scriptFailureRanges.current.has(failure) && !!failureSource.current?.available()}
        onLocate={locateFailure} />}
      {outcome?.failure && !outcome.scriptReport && <QueryPartialOutcomeNotice failure={outcome.failure} completedResults={outcome.results.length}
        locateAvailable={!pin && scriptFailureRanges.current.has(outcome.failure) && !!failureSource.current?.available()}
        onLocate={() => locateFailure(outcome.failure)} />}
      {!pin && outcome?.postgresNotices && <PostgresNoticesPanel report={outcome.postgresNotices}
        locateAvailable={entry => noticeRanges.current.has(entry) && !!failureSource.current?.available()} onLocate={locateNotice} />}
      {!busy && completionStatus !== 'idle' && <p className="muted small" role="status">{completionStatus === 'limited'
        ? text.completionLimited : completionStatus === 'partial' ? text.completionPartial
          : completionStatus === 'sessionUnknown' ? text.completionTransaction : text.completionUnavailable}</p>}
      {busy && <Spinner text={phase.current?.sent ? text.running : text.connecting} />}
      <div className="postgres-result-actions postgres-layout-actions">
        <select aria-label={queryLayoutZh.placement} value={resultsOnly ? 'results' : preferredPlacement}
          disabled={layoutActiveTab !== tab.id || !profile || locked} onChange={event => changeResultLayout(event.target.value)}>
          <option value="below">{queryLayoutZh.below}</option><option value="beside">{queryLayoutZh.beside}</option>
          <option value="results">{queryLayoutZh.results}</option>
        </select>
        {!resultsOnly && preferredPlacement === 'beside' && !besideAvailable && <span className="muted small">{queryLayoutZh.besideNarrow}</span>}
      </div>
      <div className="query-layout-panes">
        <div className="query-layout-editor" style={resultLayout === 'beside' ? {width: editorWidth} : undefined}>
          <SavedQueryMatchNavigation tabId={tab.id} source={searchNavigation} editor={editorInstance} />
          <div id={layoutEditorId} className="postgres-editor sql-editor-wrap query-editor-region" style={resultLayout === 'below' ? {height: editorHeight} : undefined}>
            <SqlEditor
              queryTabId={tab.id}
              clipboardDisabled={locked || resultsOnly || !!closeRequest}
              value={tab.sql ?? ''}
              dialect="postgresql"
              snippetCompletion
              postgresStandardStrings={session.current && !busy && same(session.current.scope) ? state.standardConformingStrings : undefined}
              postgresCompletion={{ tabId: tab.id, connectionId: tab.connectionId, database: scope.database,
                connectionVersion: scope.version, sessionId: session.current?.id }}
              onCompletionStatus={setCompletionStatus}
              readOnly={busy || fileBusy || snapshotBusy || !!analyze || !!exportView || !!filterDraft || !!columnDraft || !!statisticsDraft ||
                !!presetDraft || !!resultSql || !!comparisonDraft}
              onReady={(instance) => {
                editor.current = instance;
                setEditorInstance(instance);
              }}
              onChange={(sql) => {
                if (analyzeRef.current) clearAnalyze();
                if (!phase.current) useWorkspace.getState().updateTab(tab.id, { sql });
              }}
              onExecute={() => run()}
              onExecuteCurrent={() => run('current')}
              onSelectCurrent={() => navigation.open('select')}
              onFormat={formatQuery}
              onToggleComment={() => editorAction('editor.action.commentLine')}
              onToggleBlockComment={toggleBlockComment}
              onSelectionState={updateEditorSelection}
            />
            {navigation.panel && <StatementNavigationPanel {...navigation.panel} />}
          </div>
        </div>
        {resultLayout === 'below' && <QueryLayoutSplitter value={preferredEditorHeight} min={queryLayoutLimits.minEditorHeight}
          max={layoutMaximum} defaultValue={queryLayoutLimits.defaultEditorHeight} controls={layoutEditorId} scope={layoutScope}
          disabled={layoutActiveTab !== tab.id || !profile || locked} begin={beginEditorLayout} onPreview={setEditorPreview} />}
        {resultLayout === 'beside' && <QueryLayoutSplitter dimension="width" value={preferredEditorWidth} min={queryLayoutWidthLimits.minEditorWidth}
          max={widthMaximum} defaultValue={queryLayoutWidthLimits.defaultEditorWidth} controls={layoutEditorId} scope={layoutScope}
          disabled={layoutActiveTab !== tab.id || !profile || locked} begin={cancel => beginEditorLayout(cancel, 'width')} onPreview={setEditorWidthPreview} />}
        <div className="postgres-results query-layout-results">
          {!!pinState.items.length && <div className="pinned-results" role="group" aria-label={zh.query.pinSection} title={zh.query.pinSessionOnly}>
            <span>{zh.query.pinSection}</span>
            <button className={`current-results ${pin ? '' : 'selected'}`} aria-pressed={!pin} disabled={locked}
              onClick={() => selectPinnedResult()}>{zh.query.currentResults}</button>
            {pinState.items.map(item => <div key={item.id} className={`pinned-result ${pin === item ? 'selected' : ''}`}>
              <button aria-pressed={pin === item} title={pinnedResultTooltip(item)} disabled={locked} onClick={() => selectPinnedResult(item)}>{item.label}</button>
              <button aria-label={formatText(zh.query.releasePin, item.label)} title={formatText(zh.query.releasePin, item.label)}
                disabled={locked} onClick={() => releasePinnedResult(item)}>×</button>
            </div>)}
            <button disabled={locked || pinState.items.length < 2} title={pinState.items.length < 2 ? comparisonText.requireTwo : comparisonText.notice}
              onClick={openResultComparison}>{comparisonText.open}</button>
          </div>}
          {(!pin && results.length > 1 || dataResult || pinState.items.length > 0) && (
            <div className="postgres-result-actions">
              {!pin && results.length > 1 && <select aria-label="PostgreSQL结果集" value={selected} disabled={locked}
                onChange={event => selectCurrentResult(Number(event.target.value))}>
                {results.map((r, i) => <option key={i} value={i}>{text.result(resultSources?.[i]?.statementOrdinal ?? i + 1, r.postgresCommand ?? '', r.rows.length, resultNames[i])}</option>)}
              </select>}
              {(results.length > 1 || pinState.items.length > 0) && <QueryResultNavigator tabId={tab.id} results={results} names={resultNames}
                selected={pin ? undefined : selected} pins={pinState.items} selectedPin={pin}
                disabled={locked} isCurrent={pinNavigationCurrent} onSelect={selectCurrentResult} onSelectPin={selectPinnedResult}/>}
              {pin && <PinnedResultRename tabId={tab.id} pin={pin} disabled={locked} isCurrent={pinNavigationCurrent} onRename={renameSelectedPin}/>}
              {archiveAvailable && <button disabled={locked} onClick={() => {
                if (outcome && resultScopeCurrent() && !document.querySelector(appModalSelector)) setArchiveOutcome(outcome);
              }}>{archiveText.open}</button>}
              {dataResult && <>
                {!pin && results.length === 1 && resultNames[selected] && <strong className="postgres-result-name">{resultNames[selected]}</strong>}
                {pin ? <button disabled={locked || !pin.result.statement.trim()} onClick={openResultSql}>{zh.query.pinnedStatement}</button> :
                  <button disabled={locked || !binding} title={zh.query.pinHint} onClick={pinResult}>{zh.query.pinResult}</button>}
                <button disabled={locked || !binding} onClick={openResultColumns}>{columnText.open}</button>
                {origins && <button disabled={locked} onClick={() => void openOrigins()}>{originsText.open}</button>}
                <button disabled={locked || !detailBinding || activeDetailRow?.binding !== detailBinding}
                  title={detailText.choose} onClick={openRowDetail}>{detailText.open}</button>
                {canBrowseQueryReference && <>
                  <button disabled={locked || !selectedDetailRow} title={referenceText.queryChoose}
                    onClick={() => browseQueryReference('parent')}>{referenceText.browse}</button>
                  <button disabled={locked || !selectedDetailRow} title={referenceText.queryChoose}
                    onClick={() => browseQueryReference('children')}>{referenceText.children}</button>
                </>}
                {canUpdateQueryRecord && <button disabled={locked || !detailBinding || activeDetailRow?.binding !== detailBinding}
                  title={joinTarget === undefined ? originsText.cellHint : originsText.joinEditHint} onClick={() => {
                    if (activeDetailRow && activeDetailRow.binding === detailBinding)
                      openQueryRecords([activeDetailRow.binding.rows[activeDetailRow.index]]);
                  }}>{joinTarget === undefined ? originsText.edit : originsText.editJoin}</button>}
                {canDeleteQueryRecord && <button className="danger" disabled={locked || !selectedCount || selectedCount > postgresTableLimits.changes}
                  title={originsText.deleteLimit} onClick={() => openCheckedQueryRows('delete')}>{joinTarget === undefined ? originsText.deleteChecked : originsText.deleteCheckedJoin}</button>}
                {canDuplicateQueryRecord && <button disabled={locked || !selectedCount || selectedCount > postgresTableLimits.changes}
                  title={originsText.duplicateLimit} onClick={() => openCheckedQueryRows('insert')}>{originsText.duplicateChecked}</button>}
                {canAddQueryRecord && <button disabled={locked} onClick={() => openQueryRecords([], { operation: 'new' })}>{originsText.add}</button>}
                {canReplaceResult && <button disabled={locked} aria-expanded={!!activeReplace} onClick={openResultReplace}>{originsText.replace}</button>}
                <button disabled={locked || !filterBinding || !filterView || !sortView}
                  onClick={() => openResultFilter()}>{filterText.open}</button>
                {!!filterView?.rules.length && <>
                  <button disabled={locked} onClick={() => applyResultFilter({ mode: 'AND', children: [] })}>{filterText.clear}</button>
                  <span role="status">{filterText.counts(resultSource!.rows.length, organizedResult!.rows.length)}</span>
                </>}
                <button disabled={locked || !sortView || !sortBinding?.visible.some(column => !sortBinding.reasons.get(column.key))}
                  onClick={() => {
                    if (!sortBinding || !sortView || !sortCurrent() || document.querySelector(appModalSelector)) return;
                    const draft = { binding: sortBinding, view: sortView };
                    sortDraftRef.current = draft;
                    setSortDraft(draft);
                  }}>{sortText.panelTitle}</button>
                {!!sortView?.rules.length && <button disabled={locked} onClick={() => applyResultSort([])}>{sortText.clear}</button>}
                <button disabled={locked || !binding || !resultHistory.target(historyBinding, -1)}
                  title={resultHistory.limited ? historyText.limited : historyText.postgresHint}
                  onClick={() => travelResultHistory(-1)}>{historyText.undo}</button>
                <button disabled={locked || !binding || !resultHistory.target(historyBinding, 1)} title={historyText.postgresHint}
                  onClick={() => travelResultHistory(1)}>{historyText.redo}</button>
                <button disabled={locked || !binding || !historyBinding} onClick={openResultPresets}>{presetsText.open}</button>
                <button disabled={locked || !binding} onClick={() => openResultExport(false)}>{zh.resultExport.title}</button>
                <button disabled={locked || !selectedCount} onClick={() => openResultExport(true)}>{zh.resultExport.selectedTitle}</button>
                {!pin && <button disabled={locked || !binding || !selectedCount || selectedCount > postgresTableLimits.changes ||
                  binding.visibleColumns.length > postgresTableLimits.fields} title={transferText.limits} onClick={captureResultTransfer}>
                  {transferText.queryCapture}</button>}
              </>}
            </div>
          )}
          {result && receiptOrdinal !== undefined && <div className="info-strip postgres-result-receipt" role="group" aria-label={text.receipt}>
            <span>{[
              text.receiptStatement(receiptOrdinal),
              result.postgresCommand && text.receiptCommand(result.postgresCommand),
              result.affectedRows !== undefined && text.receiptRows(result.affectedRows),
              !!result.columns.length && text.receiptCached(result.rows.length),
              displayResult && displayResult.rows.length !== result.rows.length && text.receiptVisible(displayResult.rows.length),
              text.receiptElapsed(result.elapsedMs),
            ].filter(Boolean).join(' · ')}</span>
            <button disabled={locked || !result.statement.trim()} onClick={openResultSql}>{zh.query.resultSql}</button>
            <button disabled={locked || !resultLocationAvailable}
              title={resultLocationAvailable ? text.locateResult : text.locateResultUnavailable} onClick={locateResultSource}>{text.locateResult}</button>
            {onChooseQueryTarget && <button disabled={locked || !resultLocationAvailable}
              title={resultLocationAvailable ? queryDuplicateZh.resultStatementHint : queryDuplicateZh.resultStatementUnavailable}
              onClick={openResultStatement}>{queryDuplicateZh.resultStatement}</button>}
          </div>}
          {filterBinding && organizedResult && keywordFilter.result && <QueryResultKeyword key={keywordFilter.generation}
            keyword={keywordFilter.keyword} total={organizedResult.rows.length} matched={keywordFilter.result.rows.length}
            disabled={locked || !binding}
            onApply={keyword => resultCurrent() && filterCurrent() && !document.querySelector(appModalSelector) &&
              keywordFilter.apply(keyword, () => resultSelection.invalidate())} />}
          {matchView.active && <QueryResultMatchView active={matchView.active} disabled={locked || !binding}
            onClear={() => changeMatchView()}/>}
          <div className="result-body" role="region" aria-label={zh.query.text016} tabIndex={-1}>
            {!pin && outcome?.analysis ? <QueryAnalyzeView plan={outcome.analysis} outcome={outcome} busy={locked} fileActions onFileBusyChange={setFileBusy} /> :
              !pin && outcome?.explain ? <ExplainPlanView outcome={outcome} busy={locked} fileActions onFileBusyChange={setFileBusy} /> : result ? (
              result.columns.length ? (
                <div className="query-result-with-details">
                  <div className="query-result-grid" inert={!!recordEdit?.cell}>
                    <PostgresTableFindPanel request={activeReplace?.request} scope={binding ?? scope}
                      enabled={!!activeReplace} writable={canReplaceResult} rows={replaceRows} columns={visibleColumns ?? result.columns}
                      replaceSelection={activeReplace ? resultSelection.checkedRows(activeReplace.binding) ?? null : undefined}
                      replaceWritable={replaceWritable} scopeDescription={originsText.replaceScope} shortcuts={false}
                      isCurrent={replaceCurrent} anchor={() => undefined} onOpen={openResultReplace}
                      onClose={() => setReplaceView(undefined)} onPreview={planQueryReplace} onStage={stageQueryReplace}
                      renderGrid={renderResultGrid}/>
                  </div>
                  {currentRowDetail && <QueryRowDetailsPanel controller={rowDetails} view={currentRowDetail}
                    isCurrent={() => rowDetailCurrent(currentRowDetail.binding)} onMove={moveRowDetail} onClose={closeRowDetail} />}
                </div>
              ) : (
                receiptOrdinal === undefined && <div className="info-strip">
                  {text.complete(result.postgresCommand ?? '', result.affectedRows)}
                </div>
              )
            ) : (
              <Empty title={text.empty} />
            )}
          </div>
          {result?.truncated && <p className="warning-text">{text.truncated}</p>}
        </div>
      </div>
      {resultSql && <ResultSqlDialog title={resultSql.pinned ? zh.query.pinSource : zh.query.resultSqlTitle}
        hint={resultSql.pinned ? zh.query.resultSqlHint : text.resultSqlHint} statement={resultSql.result.statement}
        sourceSql={resultSql.sourceSql} dialect="postgresql" onClose={() => closeResultSql(resultSql)}/>}
      {columnDraft && <QueryResultColumnsDialog key={columnDraft.owner} binding={columnDraft.binding}
        initial={columnDraft.initial} owner={columnDraft.owner}
        isCurrent={() => columnCurrent(columnDraft)} onApply={next => applyResultColumns(columnDraft, next)}
        onClose={() => closeResultColumns(columnDraft)} />}
      {statisticsDraft && <QueryResultStatisticsDialog key={statisticsDraft.owner} owner={statisticsDraft.owner}
        columns={statisticsDraft.binding.visibleColumns} rows={statisticsDraft.binding.rows} dialect="postgresql"
        initialColumn={statisticsDraft.column} selectedIndices={statisticsDraft.indices} truncated={statisticsDraft.binding.truncated}
        isCurrent={() => statisticsCurrent(statisticsDraft)} onClose={() => closeResultStatistics(statisticsDraft)}
        onFilter={filterBinding && sortView ? node => filterFromStatistics(statisticsDraft, node) : undefined} />}
      {presetDraft && <QueryResultPresetsDialog key={presetDraft.owner} connectionId={tab.connectionId}
        value={presetDraft.value} owner={presetDraft.owner} isCurrent={() => presetCurrent(presetDraft)}
        matches={value => !!visibleColumns && queryResultMemoryMatches(value, resultSource, visibleColumns)}
        onApply={value => applyResultPreset(presetDraft, value)} onClose={() => closeResultPresets(presetDraft)} />}
      {comparisonDraft && <QueryResultComparisonDialog key={comparisonDraft.owner} owner={comparisonDraft.owner}
        pins={comparisonDraft.pins} dialect="postgresql" isCurrent={() => comparisonCurrent(comparisonDraft)}
        onClose={() => closeResultComparison(comparisonDraft)} />}
      {filterDraft && <Modal title={filterText.title} wide onClose={() => closeResultFilter(filterDraft)} onEscape={event => {
        // 先交给内层条件草稿或值选择处理，候选面板的 Esc 不关闭外层窗口。
        if (event.target instanceof Element && event.target.closest('.query-result-filter-panel')) return;
        event.stopPropagation();
        closeResultFilter(filterDraft);
      }}>
        <div className="modal-content"><QueryResultFilterPanel binding={filterDraft.binding} initial={filterDraft.view} seed={filterDraft.seed}
          isCurrent={() => filterCurrent(filterDraft)} onApply={expression => applyResultFilter(expression, filterDraft)}
          onClose={() => closeResultFilter(filterDraft)} /><ErrorBox message={filterError} /></div>
      </Modal>}
      {sortDraft && <Modal title={sortText.panelTitle} wide onClose={() => closeResultSort(sortDraft)}>
        <div className="modal-content"><QueryResultSortPanel binding={sortDraft.binding} initial={sortDraft.view}
          isCurrent={() => sortCurrent(sortDraft)} onApply={rules => applyResultSort(rules, sortDraft)}
          onClose={() => closeResultSort(sortDraft)} /></div>
      </Modal>}
      {recordReference && <PostgresQueryReferenceDialog request={recordReference.request} direction={recordReference.direction}
        isCurrent={() => queryReferenceCurrent(recordReference)} onClose={() => closeQueryReference(recordReference)} />}
      {recordEdit && <PostgresSearchRecordEditDialog connectionId={tab.connectionId} database={recordEdit.scope.database} queryRecord={recordEdit.source}
        cell={recordEdit.cell} range={recordEdit.range} deletePositions={recordEdit.deletePositions} visible={workspace.settings.activeTabId === tab.id}
        isCurrent={() => recordEdit.job.owns() && same(recordEdit.scope) && session.current?.id === recordEdit.source.sessionId &&
          selectedResultRef.current === recordEdit.result && !closeRef.current && useWorkspace.getState().settings.activeTabId === tab.id}
        onDirty={() => { /* 原编辑窗口全程持有标签占用，放弃草稿由对话框确认。 */ }}
        onDone={committed => {
          if (committed) {
            retiredRecordExecution.current = recordEdit.source.executionId;
            useWorkspace.getState().notify(recordEdit.source.operation === 'delete' ? originsText.deleteCommitted :
              recordEdit.source.operation === 'new' ? originsText.addCommitted :
              recordEdit.source.operation === 'insert' ? originsText.duplicateCommitted :
              recordEdit.range ? originsText.rangeCommitted : originsText.editCommitted);
          }
          recordEdit.job.release();
          setRecordEdit(undefined);
          const anchor = recordEdit.cell?.anchor;
          if (anchor) requestAnimationFrame(() => {
            if (anchor.isConnected && useWorkspace.getState().settings.activeTabId === tab.id) anchor.focus({ preventScroll: true });
          });
        }}/>}
      {originsView && <PostgresResultOriginsDialog result={originsView.result} origins={originsView.origins} error={originsView.error}
        onClose={() => { if (originsOwner.current?.token === originsView.token) closeOrigins(); }} onOpen={index => {
          const owner = originsOwner.current, origin = originsView.origins?.[index];
          if (!owner || owner.token !== originsView.token || !origin?.canOpen || !originsCurrent(owner)) return;
          closeOrigins();
          useWorkspace.getState().openTab({ kind: 'table', connectionId: tab.connectionId, database: owner.scope.database,
            title: origin.table, table: postgresIdentifier(origin.schema) + '.' + postgresIdentifier(origin.table) });
        }}/>}
      {archiveOutcome && <ResultArchiveDialog outcome={archiveOutcome} tabId={tab.id} dialect="postgresql"
        isCurrent={() => archiveAvailable && archiveOutcome === outcome && !closeRef.current && same(scope)}
        onClose={() => setArchiveOutcome(undefined)} />}
      {exportView && <ResultExportDialog result={exportView.result} tabId={tab.id} selected={exportView.selected} scope={exportView.scope}
        allowSql sqlDialect="postgresql" onClose={() => {
          exportOpen.current = false;
          setExportView(undefined);
        }} />}
      {fullExport && !closeRequest && <FullQueryExportDialog source={fullExport} onClose={() => setFullExport(undefined)} />}
      <div className="tab-status">
        {!pin && outcome && resultSources && <span>{text.executionElapsed(outcome.elapsedMs)}</span>}
        <span>
          {!state.transactionKnown
            ? text.unknown
            : state.transactionFailed
              ? text.failedTransaction
              : state.transactionOpen
                ? text.transaction
                : text.idle}
        </span>
        <span className="grow" />
        <button
          disabled={locked || state.transactionOpen || !state.transactionKnown}
          onClick={() => run('normal', undefined, undefined, 'BEGIN')}
        >
          {text.begin}
        </button>
        <button
          disabled={locked || !state.transactionOpen || state.transactionFailed || !state.transactionKnown}
          onClick={() => run('normal', undefined, undefined, 'COMMIT')}
        >
          {text.commit}
        </button>
        <button
          disabled={locked || !state.transactionOpen || !state.transactionKnown}
          onClick={() => run('normal', undefined, undefined, 'ROLLBACK')}
        >
          {text.rollback}
        </button>
      </div>
      {analyze && !busy && !closeRequest && (
        <QueryAnalyzeConfirmDialog key={analyze.token} source={analyze.source} dialect="postgresql"
          connectionName={profile?.name ?? ''} databaseLabel={analyze.scope.database}
          onConfirm={() => run('normal', undefined, undefined, undefined, analyze)} onClose={clearAnalyze} />
      )}
      {save && (
        <QueryBindingDialog
          initialName={tab.title}
          bound={!!tab.sourceBinding}
          onSave={saveQuery}
          onClose={() => {
            setSave(false);
            setCloseSaving(false);
          }}
        />
      )}
      {closeRequest && !sessionSetting && !save && !snippets && !exportView && !archiveOutcome && !filterDraft && !columnDraft && !statisticsDraft && !presetDraft && !resultSql && !comparisonDraft && (
        <QueryCloseDialog
          title={tab.title}
          onCancel={() => finishClose(false)}
          onDiscard={() => finishClose(true)}
          onKeep={() => finishClose(true, true)}
          onSave={() => void saveClose()}
        />
      )}
      {parameterOwner && (
        <QueryParametersDialog
          syntaxHint={text.parameterHint}
          source={parameterOwner.source}
          reuse={parameterOwner.reuse ?? undefined}
          loadNames={() => names(parameterOwner)}
          onExecute={(values) => run('normal', values, parameterOwner)}
          onClose={() => {
            parameterOwner.failureSource?.dispose();
            if (parameterOwner.reuse) parameterReuse.current?.close(parameterOwner.reuse);
            parameterOwner.valid = false;
            setParameterOwner(undefined);
          }}
        />
      )}
      {sessionSetting?.mode === 'transaction' && <PostgresTransactionSettingsDialog intent={sessionSetting.intent} connectionName={profile?.name ?? ''}
        onRead={() => requestSessionSetting(sessionSetting, request => invoke('postgres.transactionSettings.read', request))}
        onApply={(expected, defaults) => requestSessionSetting(sessionSetting, request => invoke('postgres.transactionSettings.apply', {...request, expected, defaults}))}
        onClose={() => closeSessionSetting(sessionSetting)} />}
      {sessionSetting?.mode === 'search-path' && <PostgresSearchPathDialog intent={sessionSetting.intent}
        onRead={() => requestSessionSetting(sessionSetting, request => invoke('postgres.searchPath.read', request))}
        onApply={(expected, change) => requestSessionSetting(sessionSetting, request => invoke('postgres.searchPath.apply', {...request, expected, change}))}
        onClose={() => closeSessionSetting(sessionSetting)} />}
      {sessionSetting?.mode === 'timeouts' && <PostgresQueryTimeoutsDialog intent={sessionSetting.intent}
        onRead={() => requestSessionSetting(sessionSetting, request => invoke('postgres.queryTimeouts.read', request))}
        onApply={(expected, change) => requestSessionSetting(sessionSetting, request => invoke('postgres.queryTimeouts.apply', {...request, expected, change}))}
        onClose={() => closeSessionSetting(sessionSetting)} />}
      {snippets && <SnippetsDialog dialect="postgresql" initialSql={snippets.initialSql} startWithDraft={snippets.create}
        onInsert={insertSnippet} onClose={closeSnippets} />}
    </div>
  );
}
