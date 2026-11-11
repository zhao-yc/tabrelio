import { queryViewFromEditor, type QueryViewDraft } from '../queryViewDraft';
import { queryViewDraftZh as queryViewText } from '../locales/queryViewDraft.zh-CN';
import { sqlClipboardStackAction } from '../sqlClipboardStack';
import { sqlQuotedCopyAction } from '../sqlQuotedCopy';
import { handleQueryExecutionShortcut } from '../queryExecutionShortcut';
import { QueryResultNavigator } from './QueryResultNavigator';
import { PinnedResultRename } from './PinnedResultRename';
import { ResultSqlDialog } from './ResultSqlDialog';
import { focusQueryResultPane, focusQueryResultReplacement, handleQueryPaneShortcut, handleQueryResultReplaceShortcut, handleQueryResultShortcut, runFocusedQueryReplace } from '../queryResultShortcut';
import { sqliteStatementTimeoutMaximumMs, validSqliteStatementTimeout } from '../../shared/sqliteStatementTimeout';
import { appDialogSelector, appModalSelector } from '../modalSelectors';
import { StatementNavigationController, type StatementNavigationView } from '../statementNavigationController';
import { StatementNavigationPanel } from './StatementNavigationPanel';
import { extractStatementSelection, openStatementDraftBatch, saveStatementQuery, type StatementQueryOutput, type StatementSelectionDestination } from '../statementNavigationExtract';
import { StatementNavigationWorkerClient } from '../statementNavigationWorkerClient';
import StatementNavigationWorker from '../statementNavigation.worker?worker';
import { adjacentNavigableStatement, currentNavigableStatement, type NavigableStatement, type StatementNavigationResult } from '../../shared/statementNavigation';
import { statementNavigationZh as navigationText } from '../locales/statementNavigation.zh-CN';
import { editor as monacoEditor, MarkerSeverity } from 'monaco-editor';
import { SqlSyntaxCheckController, type SqlSyntaxCheckView } from '../sqlSyntaxCheckController';
import { SqlSyntaxCheckPanel } from './SqlSyntaxCheckPanel';
import { sqlSyntaxCheckZh as syntaxText, sqliteSyntaxCheckZh } from '../locales/sqlSyntaxCheck.zh-CN';
import { LocalReferencesWorkerClient } from '../localReferencesWorkerClient';
import CompletionWorker from '../completion.worker?worker';
import { sqlSyntaxCheckLimits, type SqlSyntaxCheckResult } from '../../shared/sqlSyntaxCheck';
import { ObjectDefinitionDialog, type ObjectDefinitionSource } from './ObjectDefinitionDialog';
import { objectDefinitionZh } from '../locales/objectDefinition.zh-CN';
import { connectionDatabase, connectionOverview } from '../sqliteWorkspace';
import { sqliteZh } from '../locales/sqlite.zh-CN';
import { postgresTableLimits } from '../../shared/postgresTable';
import { postgresRecordTransferZh as transferText } from '../locales/postgresRecordTransfer.zh-CN';
import { captureMysqlQueryTransfer, captureSqliteQueryTransfer, usePostgresRecordTransfer } from '../postgresRecordTransfer';
import { QueryRowDetails, type QueryRowDetailsBinding, type QueryRowDetailsView } from '../queryRowDetails';
import { QueryRowDetailsPanel } from './QueryRowDetailsPanel';
import { queryRowDetailsZh as rowDetailsText } from '../locales/queryRowDetails.zh-CN';
import { QueryResultColumnsDialog } from './QueryResultColumnsDialog';
import { queryResultColumnKeys, queryResultVisibleColumns, frozenQueryResultKeys, setQueryResultFrozenThrough, setQueryResultHeaderColumnVisibility, reorderQueryResultColumn, setQueryResultRowHeight, queryResultColumnWidth, type QueryResultColumnLayout } from '../queryResultColumns';
import type { ColumnWidths } from 'react-data-grid';
import { queryResultColumnsZh as columnText } from '../locales/queryResultColumns.zh-CN';
import { QueryResultSortPanel } from './QueryResultSortPanel';
import { QueryResultSort, queryResultSortScope, queryResultSortSupportsIgnoreCase, type QueryResultSortBinding, type QueryResultSortView, type QueryResultSortRule } from '../queryResultSort';
import { QueryResultFilter, queryResultFilteredSortView, appendQueryResultFilterRule, appendQueryResultFilterNode, type QueryResultFilterBinding, type QueryResultFilterView, type QueryResultFilterGroup, type QueryResultFilterRule } from '../queryResultFilter';
import { captureQueryResultCellFilter, queryResultCellFilterNode, type CellFilterOperator } from '../queryResultCellFilter';
import { currentQueryResultSelectedFilter, queryResultSelectedFilterNode, type QueryResultSelectedFilterCapture, type QueryResultSelectedFilterMode } from '../queryResultSelectedFilter';
import type { QueryResultCopyCell } from '../queryResultHeaderCopy';
import { QueryResultHistory, prepareQueryResultOrganization } from '../queryResultHistory';
import { queryResultHistoryZh as historyText } from '../locales/queryResultHistory.zh-CN';
import { captureQueryResultMemory, queryResultMemoryMatches, type QueryResultMemory } from '../queryResultMemory';
import { queryResultMemoryZh as memoryText } from '../locales/queryResultMemory.zh-CN';
import { queryResultPresetValueSchema, type QueryResultPresetValue } from '../../shared/queryResultPresets';
import { QueryResultPresetsDialog } from './QueryResultPresetsDialog';
import { QueryResultStatisticsDialog } from './QueryResultStatisticsDialog';
import { QueryResultComparisonDialog } from './QueryResultComparisonDialog';
import { queryResultComparisonZh as comparisonText } from '../locales/queryResultComparison.zh-CN';
import { captureQueryResultStatistics } from '../queryResultStatistics';
import { queryResultStatisticsZh as statisticsText } from '../locales/queryResultStatistics.zh-CN';
import { queryResultPresetsZh as presetsText } from '../locales/queryResultPresets.zh-CN';
import { QueryResultFilterPanel } from './QueryResultFilterPanel';
import { QueryResultKeyword, useQueryResultKeyword } from './QueryResultKeyword';
import { QueryResultMatchView, useQueryResultMatchView, type QueryResultRowViewKind } from './QueryResultMatchView';
import { queryResultFilterZh as filterText } from '../locales/queryResultFilter.zh-CN';
import { queryResultSortZh as sortText } from '../locales/queryResultSort.zh-CN';
import '../queryResultSort.css';
import { zh, formatText } from '../locales/zh-CN';
import { uiCommandLabels } from '../../shared/uiCommands.zh-CN';
import { sqlEditorZoomCommandIds, sqlLineCommandIds } from '../../shared/uiCommandIds';
import { hasExplicitCaseSelection } from '../sqlSelectionCase';
import { sqlLineCommentAction } from '../sqlLineComment';
import { editSqlBlockComment } from '../sqlBlockComment';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { QueryCloseDialog } from './QueryCloseDialog';
import { QuerySaveCloseIntent, type QueryCloseRequest } from '../queryCloseIntent';
import { queryCloseZh } from '../locales/queryClose.zh-CN';
import type * as monaco from 'monaco-editor';
import { formatSqlEditor, type SqlFormattingMode } from '../sqlFormatting';
import { DeferredUpperSqlFormatting } from '../sqlFormattingDeferred';
import { captureQueryFormattingOptions, type QueryFormattingOptions } from '../queryFormattingOptions';
import { QueryFormattingOptionsDialog } from './QueryFormattingOptionsDialog';
import { readSqlKeywordCase } from '../../shared/sqlKeywordCase';
import { sqlFormattingZh } from '../locales/sqlFormatting.zh-CN';
import { Play, Square, AlignLeft, Save, History, Gauge, ChevronDown, Check, RotateCcw, LockKeyhole, Pin, X, Download, BookOpen, Braces, Copy } from 'lucide-react';
import type { GridRangeExportData } from '../gridRangeExport';
import type { QueryOutcome, QueryResult, ResultColumn, DataRow, SqlSnippet } from '../../shared/contracts';
import { errorMessage, invoke, ownCell, uid } from '../lib';
import { acquireWorkspaceBusy, flushSettings,useWorkspace, wasQueryFileOpenTarget, type WorkspaceTab, type WorkspaceBusyLease } from '../store';
import { SqlEditor,type SqlCompletionStatus } from './SqlEditor';
import {SavedQueryMatchNavigation} from './SavedQueryMatchNavigation';
import type {SavedQueryNavigationSource} from '../../shared/savedQuerySearch';
import {completionZh} from '../locales/completion.zh-CN';
import type {CompletionSessionState} from '../../shared/sqlCompletion';
import {queryConnectionDatabase,queryDatabaseFromSession,queryDatabasePatch,resolveQueryDatabase,type QueryDatabaseContext} from '../../shared/queryContext';
import {queryContextZh} from '../locales/queryContext.zh-CN';
import { isResultBinaryCell, ResultsGrid, type GridFindTarget } from './ResultsGrid';
import { openFocusedGridRowJump } from './GridRowJump';
import { openFocusedQueryResultFind } from './QueryResultFind';
import { ExplainPlanView } from './ExplainPlanView';
import { SqliteExplainPlanView } from './SqliteExplainPlanView';
import { QueryAnalyzeView } from './QueryAnalyzeView';
import { QueryAnalyzeConfirmDialog } from './QueryAnalyzeConfirmDialog';
import { QueryTransactionSettingsDialog, type QueryTransactionSettingsApplyInput } from './QueryTransactionSettingsDialog';
import { QueryTransactionSettingsIntent, type QueryTransactionSettingsScope } from '../queryTransactionSettingsIntent';
import { queryTransactionSettingsZh } from '../locales/queryTransactionSettings.zh-CN';
import { queryTransactionSettingsSnapshotSchema, type QueryTransactionSettingsSnapshot } from '../../shared/queryTransactionSettings';
import { checkQueryAutocommitOutput, type QueryAutocommitApplyInput, type QueryAutocommitOutput } from '../../shared/queryAutocommit';
import { QueryDatabaseSwitchDialog } from './QueryDatabaseSwitchDialog';
import { QueryDatabaseSwitchIntent, type QueryDatabaseSwitchScope } from '../queryDatabaseSwitchIntent';
import { queryDatabaseSwitchZh } from '../locales/queryDatabaseSwitch.zh-CN';
import type { QueryDatabaseSwitchOutput } from '../../shared/queryDatabaseSwitch';
import { QueryAnalyzeIntent, type QueryAnalyzeScope } from '../queryAnalyzeIntent';
import { queryAnalyzeCapability } from '../../shared/queryAnalyze';
import { queryAnalyzeZh } from '../locales/queryAnalyze.zh-CN';
import { QueryPartialOutcomeNotice } from './QueryPartialOutcomeNotice';
import { QueryContinueOnErrorNotice, confirmedQueryContinueRange } from './QueryContinueOnErrorNotice';
import { MysqlQueryStatus } from './MysqlQueryStatus';
import type { MysqlQueryStatusReport } from '../../shared/mysqlQueryStatus';
import { mysqlQueryStatusZh } from '../locales/mysqlQueryStatus.zh-CN';
import { queryContinueOnErrorZh } from '../locales/queryContinueOnError.zh-CN';
import { QueryWarningsDialog } from './QueryWarningsDialog';
import { QueryWarningsViewIntent, sameQueryWarningsExecution, type QueryWarningsViewScope } from '../queryWarningsView';
import { queryWarningsZh } from '../locales/queryWarnings.zh-CN';
import type { QueryFailure } from '../../shared/queryFailure';
import { captureQueryFailureSource, type QueryFailureSourceLease, type QueryFailureSourceScope } from '../queryFailureSource';
import { queryFailureSourceZh as sourceLocationText } from '../locales/queryFailureSource.zh-CN';
import { Empty, ErrorBox, Field, Modal, Spinner } from './ui';
import { pinLimits, pinnedResultSnapshotName, pinnedResultTooltip, renamePinnedResult, snapshotQueryResult, type PinnedQueryResult } from '../queryPins';
import { queryResultTitle } from '../../shared/queryResultTitle';
import { ResultArchiveDialog } from './ResultArchiveDialog';
import { sqliteQueryEditMaxRows, type SqliteQueryRecordInput, type SqliteTablePageInput } from '../../shared/sqliteTableBrowse';
import { sqliteTableEditLimits } from '../../shared/sqliteTableEdit';
import type { GridRangeTarget } from '../useGridCellRange';
import { fitGridRangePaste } from '../gridRangePaste';
import { readSqliteClipboard } from '../sqliteTableClipboard';
import { sqliteTableRangePasteZh as sqlitePasteText } from '../locales/sqliteTableRangePaste.zh-CN';
import type { GridRangeFillInput } from '../gridRangeFill';
import type { SqliteQueryRangeFill } from '../sqliteQueryRangeFill';
import { planSqliteQueryReplace, sqliteQueryReplacementRows, type SqliteQueryReplacePlan } from '../sqliteQueryReplace';
import { gridRangeFillZh } from '../locales/gridRangeFill.zh-CN';
import type { SqliteQueryInlineCell } from './SqliteQueryInlineCellEditor';
import { SqliteSearchRecordEditDialog, type SqliteQueryRangePaste } from './SqliteSearchRecordEditDialog';
import { SqliteQueryRelationDialog } from './SqliteQueryRelationDialog';
import { sqliteRelationZh as relationText } from '../locales/sqliteRelation.zh-CN';
import { openSqliteRelatedTable } from '../openSqliteRelatedTable';
import { MysqlQueryRelationDialog } from './MysqlQueryRelationDialog';
import { MysqlSearchRecordEditDialog } from './MysqlSearchRecordEditDialog';
import { mysqlQueryRecordEditZh as mysqlEditText } from '../locales/mysqlQueryRecordEdit.zh-CN';
import { mysqlQueryRelationZh as mysqlRelationText } from '../locales/mysqlQueryRelation.zh-CN';
import { mysqlQueryBatchLimits, type MysqlQueryBatchEditInput, type MysqlQueryRecordEditInput, type MysqlQueryReplaceColumnsInput } from '../../shared/mysqlQueryRelation';
import { MysqlQueryBatchEditDialog } from './MysqlQueryBatchEditDialog';
import { mysqlQueryPasteMatrix, planMysqlQueryReplace, type MysqlQueryBatchInput } from '../mysqlQueryBatchEdit';
import { mysqlQueryBatchEditZh as mysqlBatchText } from '../locales/mysqlQueryBatchEdit.zh-CN';
import { copyInsertSqlLimits } from '../../shared/copyInsertSql';
import type { QueryRowSqlInput } from '../../shared/queryRowSql';
import { queryRowSqlZh as queryRowSqlText } from '../locales/queryRowSql.zh-CN';
import { QueryRowSqlDialog } from './QueryRowSqlDialog';
import { openRowSqlDraft } from '../openRowSqlDraft';
import { PostgresTableFindPanel, type PostgresFindRequest } from './PostgresTableFindPanel';
import type { PageTextPatch } from '../pageFindReplace';
import { captureQueryInlineCellAnchor, type QueryInlineCellAnchor } from '../queryInlineCellAnchor';
import { SqliteResultOriginsDialog } from './SqliteResultOriginsDialog';
import { MysqlResultOriginsDialog } from './MysqlResultOriginsDialog';
import { mysqlResultOriginsZh as mysqlOriginsText } from '../locales/mysqlResultOrigins.zh-CN';
import { sqliteResultOriginsZh as originsText } from '../locales/sqliteResultOrigins.zh-CN';
import { resultArchiveZh as archiveText } from '../locales/resultArchive.zh-CN';
import { QueryResultSnapshotActions, type QueryResultSnapshotOperation } from './QueryResultSnapshotActions';
import { QueryResultSnapshotIntent } from '../queryResultSnapshotIntent';
import { createDisplayedQueryResultSnapshot } from '../../shared/queryResultSnapshot';
import { queryResultSnapshotUiZh } from '../locales/queryResultSnapshot.zh-CN';
import { exportableQueryResult, resultExportData, ResultExportSelection, type ResultSelectionBinding, type ResultGridSelection } from '../resultExport';
import { ResultExportDialog } from './ResultExportDialog';
import { ResultInsertDialog } from './ResultInsertDialog';
import { ResultInsertSourceIntent } from '../resultInsertUi';
import { resultInsertZh } from '../locales/resultInsert.zh-CN';
import { QueryFileActions, QueryFileSourceCaption } from './QueryFilesDialog';
import { SnippetsDialog } from './SnippetsDialog';
import { SNIPPET_LIMITS } from '../../shared/snippets';
import { prepareBuiltinSnippetInsert } from '../snippetInsertion';
import { captureHistoryInsertion, type HistoryInsertionRegistry, type HistoryInsertionTarget, type QueryInsertionMode } from '../historyInsertion';
import { QueryParametersDialog } from './QueryParametersDialog';
import { QueryParameterReuseOwner } from '../queryParameterReuseOwner';
import type { QueryParameterReusePort } from '../queryParameterReusePort';
import type { QueryParameterReuseScopeInput } from '../queryParameterReuseScope';
import { parameterZh } from '../locales/queryParameters.zh-CN';
import { queryParameterLimits, type QueryParameter, type QueryParameterStatementRange } from '../../shared/queryParameters';
import { locateSqliteStatement } from '../../shared/sqliteStatementScanner';
import '../queryPins.css';
import { QueryStreamExportDialog, type StreamExportOptions } from './QueryStreamExportDialog';
import { FullQueryExportDialog, type FullQueryExportSource } from './FullQueryExportDialog';
import { sqliteQueryExportZh } from '../locales/sqliteQueryExport.zh-CN';
import { sqliteCurrentQueryExportSource } from '../../shared/sqliteQueryExport';
import { queryStreamZh } from '../locales/queryStreamExport.zh-CN';
import {SessionObjectsDialog} from './SessionObjectsDialog';
import {sessionObjectsZh} from '../locales/sessionObjects.zh-CN';
import { QueryBindingDialog } from './QueryBindingDialog';
import { queryBindingZh } from '../locales/queryBinding.zh-CN';
import { savedQueryOriginContext } from '../../shared/queryBinding';
import type { SavedQueryGroupTarget } from '../../shared/savedQueryOrganization';
import { CurrentStatementIntent, type CurrentStatementScope } from '../currentStatementIntent';
import { currentStatementZh } from '../locales/currentStatement.zh-CN';
import { sqliteExplainZh } from '../locales/sqliteExplain.zh-CN';
import { historyPagesZh } from '../locales/historyPages.zh-CN';
import { QueryDuplicateIntent, resultStatementTargetDraft, type QueryDuplicateMode, type QueryTargetDraft } from '../queryDuplicateIntent';
import { flushEditorContent } from '../editorContentBridge';
import { captureQueryFileSnapshot } from '../queryFileSnapshot';
import { useQueryFileSource } from '../useQueryFileSource';
import { QuerySourceLease, querySourceTab } from '../querySourceLease';
import { queryFilesZh } from '../locales/queryFiles.zh-CN';
import { queryDuplicateZh } from '../locales/queryDuplicate.zh-CN';
import { QueryLayoutSplitter, queryEditorVisualHeight } from './QueryLayoutSplitter';
import { queryEditorWidthMaximum, queryLayoutLimits, queryLayoutWidthLimits, queryResultBesideMinimum, readQueryEditorHeight, readQueryEditorWidth, readQueryResultPlacement } from '../../shared/queryLayout';
import { queryLayoutZh } from '../locales/queryLayout.zh-CN';
import { beginWorkspaceQueryLayout, queryLayoutActiveTab, queryLayoutTarget } from '../queryLayoutWorkspace';
import { useQueryLayoutMaximum } from '../useQueryLayoutMaximum';
import '../queryLayout.css';
import { ActionMenu, ActionMenuSection } from './ActionMenu';
import { AdaptiveToolbar } from './AdaptiveToolbar';
import { useUiCommandScope } from '../uiCommands';
import { actionMenuZh as menuText } from '../locales/actionMenu.zh-CN';
import { bracketCommands, sqlPositionActions, sqlTextActions } from '../sqlEditorActions';
const completionStatusInfo={sessionUnknown:{text:completionZh.sessionUnknown,hint:completionZh.sessionUnknownHint},partial:{text:completionZh.partial,hint:completionZh.partialHint},unavailable:{text:completionZh.unavailable,hint:completionZh.unavailableHint},limited:{text:completionZh.limited,hint:completionZh.limitedHint},databaseUnknown:{text:completionZh.databaseUnknown,hint:completionZh.databaseUnknownHint},startupTimeout:{text:completionZh.startupTimeout,hint:completionZh.startupTimeoutHint},analysisTimeout:{text:completionZh.analysisTimeout,hint:completionZh.analysisTimeoutHint}};

interface QueryParameterForm { id: string; source: string; intent?: CurrentStatementIntent; connectionId: string; connection: unknown; version: number; fileBinding: unknown; savedBinding: unknown; session: string; recognized: boolean; confirmedRange?: QueryParameterStatementRange; sqliteNavicatParameters?: true; submitted: boolean; valid: boolean; }

/** 一个标签对应一个固定会话，流式结果和任务事件只接收当前执行编号。 */
export function QueryTab({ tab, onHistory,searchNavigation,closeRequest,onCloseRequestFinished,historyInsertionRegistry,onChooseQueryTarget,onCreateView }: { historyInsertionRegistry?: HistoryInsertionRegistry; closeRequest?: QueryCloseRequest; onCloseRequestFinished?(request: QueryCloseRequest, close: boolean, keep?: WorkspaceTab): void; tab: WorkspaceTab; onHistory: () => void;searchNavigation?:SavedQueryNavigationSource; onChooseQueryTarget?(draft: QueryTargetDraft): void; onCreateView?(draft: QueryViewDraft): void }) {
  const alive = useRef(true), closeRequestRef = useRef(closeRequest); closeRequestRef.current = closeRequest;
  const closeIntent = useRef<QuerySaveCloseIntent | undefined>(undefined);
  const closeBusy = useRef<WorkspaceBusyLease | undefined>(undefined);
  const formatting = useRef<DeferredUpperSqlFormatting | null>(null);
  const [formatOptions, setFormatOptions] = useState<QueryFormattingOptions>();
  const duplicateIntent = useRef<QueryDuplicateIntent | null>(null); const [duplicating, setDuplicating] = useState(false);
  const [closePhase, setClosePhase] = useState<'choose' | 'save' | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; failureSource.current?.dispose(); parameterFailureSource.current?.dispose(); formatting.current?.dispose(); formatting.current = null; duplicateIntent.current?.dispose(); if (closeIntent.current) { closeIntent.current.dispose(); closeBusy.current?.release(); } }; }, []);
  useEffect(() => { formatting.current?.dispose(); closeIntent.current?.dispose(); setClosePhase(closeRequest ? 'choose' : null); }, [closeRequest]);
  const settings = useWorkspace(state => state.settings); const connection = useWorkspace(state => state.connections.find(profile => profile.id === tab.connectionId));
  const sqlite = connection?.dialect === 'sqlite';
  const [sessionId, setSessionId] = useState(''); const sessionRef = useRef(''); const pendingSession = useRef<Promise<string> | null>(null);
  const [busy, setBusy] = useState(false); const busyRef = useRef(false); const task = useRef(''); const [transaction, setTransaction] = useState(false);
  const cancelledQuery=useRef('');
  const explainSource = useRef('');
  const [outcome, setOutcome] = useState<QueryOutcome | null>(null); const [stream, setStream] = useState<QueryResult[]>([]); const [resultIndex, setResultIndex] = useState(0);
  const [error, setError] = useState(''); const [save, setSave] = useState(false); const [queryName, setQueryName] = useState('');
  const [completionStatus,setCompletionStatus]=useState<SqlCompletionStatus>('idle');const connectionVersion=useWorkspace(state=>state.connectionVersions[tab.connectionId]??0);
  const layoutRoot=useRef<HTMLDivElement>(null),layoutEditorId=useId();
  // 原子提交后父props可能尚未刷新；仅本文件占位首次挂载需等到当前完整标签，避免瞬间创建旧空模型。
  const firstFileOpen=useRef(wasQueryFileOpenTarget(tab)), fileModelAttached=useRef(false);
  const fileOpening=useWorkspace(state=>state.queryFileOpenings[tab.id]?.target===tab || firstFileOpen.current && !fileModelAttached.current && state.settings.tabs.find(item=>item.id===tab.id)!==tab);
  const [layoutWidth, setLayoutWidth] = useState(0);
  const besideAvailable = layoutWidth >= queryResultBesideMinimum;
  const [resultsOnly, setResultsOnly] = useState(false);
  const preferredPlacement = readQueryResultPlacement(tab.queryResultPlacement);
  const resultLayout = resultsOnly ? 'results' : preferredPlacement === 'beside' && besideAvailable ? 'beside' : 'below';
  const layoutMaximum=useQueryLayoutMaximum(layoutRoot,queryLayoutLimits.maxEditorHeight,setLayoutWidth);
  const [editorPreview,setEditorPreview]=useState<number|null>(null);
  const [editorWidthPreview, setEditorWidthPreview] = useState<number | null>(null);
  useLayoutEffect(() => { setEditorPreview(null); setEditorWidthPreview(null); }, [resultLayout]);
  const preferredEditorHeight=readQueryEditorHeight(tab.queryEditorHeight);
  // 多错报告占用结果区时也给 SQLite 原语句留一段编辑区，短窗口沿用标签自身的滚动。
  const scriptEditorMinimum = sqlite && outcome?.scriptReport?.errors.length ? queryLayoutLimits.minEditorHeight : 0;
  const editorHeight = Math.max(scriptEditorMinimum, queryEditorVisualHeight(editorPreview ?? preferredEditorHeight, layoutMaximum));
  const preferredEditorWidth = readQueryEditorWidth(tab.queryEditorWidth);
  const widthMaximum = queryEditorWidthMaximum(layoutWidth);
  const editorWidth = queryEditorVisualHeight(editorWidthPreview ?? preferredEditorWidth, widthMaximum);
  const layoutActiveTab=queryLayoutActiveTab(settings),layoutScope=JSON.stringify([queryLayoutTarget(tab,connectionVersion),layoutActiveTab,!!closeRequest]);
  const duplicateOrigin = useRef({ connectionId: tab.connectionId, version: connectionVersion });
  const [completionSnapshot, commitCompletionSession] = useState<{ state: CompletionSessionState; sessionId: string; connectionId: string; version: number }>();
  const completionSession = completionSnapshot?.state;
  const completionSessionRef=useRef<CompletionSessionState|undefined>(undefined);
  /** 协议缓存同步发布给来源围栏，着色只接纳原物理会话与连接修订上的快照。 */
  function setCompletionSession(state: CompletionSessionState | undefined) {
    completionSessionRef.current = state;
    commitCompletionSession(state ? { state, sessionId: sessionRef.current, connectionId: tab.connectionId, version: connectionVersion } : undefined);
    databaseSwitchIntent.current?.current();
  }
  const mysqlEditorMode = !busy && sessionId && sessionId === sessionRef.current && completionSnapshot?.sessionId === sessionId &&
    completionSnapshot.connectionId === tab.connectionId && completionSnapshot.version === connectionVersion &&
    !completionSnapshot.state.broken && !completionSnapshot.state.busy ? completionSnapshot.state : undefined;
  const databaseSwitchIntent=useRef<QueryDatabaseSwitchIntent|null>(null),databaseSwitchTask=useRef('');
  type DatabaseSwitchOperation={intent:QueryDatabaseSwitchIntent;job?:WorkspaceBusyLease;acquiring:boolean};
  const databaseSwitchOperation=useRef<DatabaseSwitchOperation|null>(null),databaseSwitchAwaitingRelease=useRef(false);
  const [databaseSwitchDialog,setDatabaseSwitchDialog]=useState<QueryDatabaseSwitchIntent|null>(null);
  useEffect(()=>useWorkspace.subscribe(state=>{if(databaseSwitchAwaitingRelease.current&&!state.activeJobs[tab.id]){databaseSwitchAwaitingRelease.current=false;busyRef.current=false;if(alive.current)setBusy(false);}}),[tab.id]);
  useLayoutEffect(()=>{databaseSwitchIntent.current?.current();});
  useEffect(()=>()=>{databaseSwitchIntent.current?.dispose();},[]);
  const [sessionObjects,setSessionObjects]=useState(false);
  const [recovery,setRecovery]=useState(false);const [recoveryDatabase,setRecoveryDatabase]=useState('');
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const failureSource = useRef<QueryFailureSourceLease | undefined>(undefined), parameterFailureSource = useRef<QueryFailureSourceLease | undefined>(undefined);
  const [continueOnError, setContinueOnError] = useState(false);
  const [sqliteStatementTimeoutMs, setSqliteStatementTimeoutMs] = useState(0);
  const [collectWarnings, setCollectWarnings] = useState(false);
  const [collectStatus, setCollectStatus] = useState(false);
  const [collectStages, setCollectStages] = useState(false);
  const [interruptedStatus, setInterruptedStatus] = useState<{ taskId: string; report: MysqlQueryStatusReport }>();
  const parameterCollectWarnings = useRef(false);
  const parameterContinueOnError = useRef(false), scriptFailureRanges = useRef(new Set<QueryFailure>());
  const [, refreshFailureSource] = useState(0);
  const fileSource = useQueryFileSource(tab, () => captureQueryFileSnapshot(editor.current, () => useWorkspace.getState().settings.tabs.find(item => item.id === tab.id)), () => alive.current, value => { busyRef.current = value; setBusy(value); }, { editor: () => editor.current, available: () => !busyRef.current && !pendingSession.current && !closeRequestRef.current && !formatting.current, current: () => !pendingSession.current && !closeRequestRef.current && !formatting.current });
  const activeCurrentIntent = useRef<CurrentStatementIntent | null>(null);
  /** 关闭或文件切换开始即撤销当前语句意图，随后恢复同值也不能复活原光标来源。 */
  useLayoutEffect(() => { if (closeRequest || fileSource.busy || fileOpening) activeCurrentIntent.current?.dispose(); }, [closeRequest, fileSource.busy, fileOpening]);
  const analyzeIntent = useRef<QueryAnalyzeIntent | null>(null);
  const [analyzeDialog, setAnalyzeDialog] = useState<{ intent: QueryAnalyzeIntent; connectionName: string; databaseLabel: string } | null>(null);
  const [analyzeInvalid, setAnalyzeInvalid] = useState('');
  const transactionSettingsIntent = useRef<QueryTransactionSettingsIntent | null>(null);
  const transactionSettingsOperation = useRef<object | null>(null);
  const [transactionSettingsDialog, setTransactionSettingsDialog] = useState<{ intent: QueryTransactionSettingsIntent; connectionName: string } | null>(null);
  useEffect(() => () => { transactionSettingsIntent.current?.dispose(); }, []);
  useEffect(() => { transactionSettingsIntent.current?.current(); }, [closeRequest, tab.id, tab.connectionId, connectionVersion, sessionId]);
  useEffect(() => () => { analyzeIntent.current?.dispose(); }, []);
  const [searchEditor,setSearchEditor]=useState<monaco.editor.IStandaloneCodeEditor|null>(null);
  const [hasCaseSelection, setHasCaseSelection] = useState(false);
  const [hasSingleSelection, setHasSingleSelection] = useState(false);
  /** 只同步菜单需要的可用状态，实际执行时从原模型重新捕获选区。 */
  const updateSelectionState = useCallback((caseSelection: boolean, singleSelection: boolean) => {
    setHasCaseSelection(caseSelection);
    setHasSingleSelection(singleSelection);
  }, []);
  const [navigationView, setNavigationView] = useState<StatementNavigationView | null>(null), [navigationCursor, setNavigationCursor] = useState(0);
  const navigationIntent = useRef<{ id: string; controller: StatementNavigationController; source: string; dialect: 'mysql' | 'mariadb' | 'sqlite'; model: monaco.editor.ITextModel; instance: monaco.editor.IStandaloneCodeEditor; result?: Extract<StatementNavigationResult, { status: 'ready' }> } | null>(null);
  useEffect(() => () => { navigationIntent.current?.controller.dispose(); navigationIntent.current = null; }, []);
  useLayoutEffect(() => { navigationIntent.current?.controller.observe(); });
  const [syntaxView, setSyntaxView] = useState<SqlSyntaxCheckView | null>(null);
  const syntaxIntent = useRef<{ controller: SqlSyntaxCheckController; model: monaco.editor.ITextModel; instance: monaco.editor.IStandaloneCodeEditor; result?: Extract<SqlSyntaxCheckResult, { status: 'ready' }> } | null>(null);
  useEffect(() => () => { syntaxIntent.current?.controller.dispose(); syntaxIntent.current = null; }, []);
  useLayoutEffect(() => { syntaxIntent.current?.controller.observe(); });
  const [objectDefinition, setObjectDefinition] = useState<ObjectDefinitionSource | null>(null), objectDefinitionRef = useRef<ObjectDefinitionSource | null>(null);
  const [pins, setPins] = useState<PinnedQueryResult[]>([]); const [selectedPin, setSelectedPin] = useState(''); const pinSequence = useRef(0);
  type SnapshotOperation = { intent: QueryResultSnapshotIntent; job?: WorkspaceBusyLease; acquiring: boolean };
  const snapshotOperation = useRef<SnapshotOperation | null>(null);
  const snapshotAwaitingBusyRelease = useRef(false);
  const snapshotValues = useRef<readonly unknown[]>([]), snapshotView = useRef<{ result?: QueryResult; pins: PinnedQueryResult[] }>({ pins });
  /** 原文件操作的busy只认自己的世代；切页和别人覆盖同true都同步永久撤销发布。 */
  useEffect(() => useWorkspace.subscribe((state, previous) => {
    // 原IO已结束但被另一作业接管时，只在该作业明确释放后撤下本用途的局部忙态。
    if (snapshotAwaitingBusyRelease.current && !state.activeJobs[tab.id]) { snapshotAwaitingBusyRelease.current = false; busyRef.current = false; if (alive.current) setBusy(false); }
    const operation = snapshotOperation.current; if (!operation) return;
    if (state.settings.activeTabId !== previous.settings.activeTabId || state.settings.tabs.find(item => item.id === tab.id) !== previous.settings.tabs.find(item => item.id === tab.id) || state.connections.find(item => item.id === tab.connectionId) !== previous.connections.find(item => item.id === tab.connectionId) || state.connectionVersions[tab.connectionId] !== previous.connectionVersions[tab.connectionId]) operation.intent.invalidate();
    if (state.activeJobs !== previous.activeJobs && !operation.acquiring && !operation.job?.owns()) operation.intent.invalidate();
  }), [tab.id, tab.connectionId]);
  useLayoutEffect(() => { snapshotOperation.current?.intent.observe(snapshotValues.current); if (closeRequest) snapshotOperation.current?.intent.invalidate(); });
  useEffect(() => () => snapshotOperation.current?.intent.invalidate(), []);
  const warningsOutcome = useRef(outcome), warningsPinned = useRef(!!selectedPin); warningsOutcome.current = outcome; warningsPinned.current = !!selectedPin;
  const warningsResultSource = useRef<{ scope: QueryWarningsViewScope; valid: boolean } | null>(null);
  const warningsIntent = useRef<QueryWarningsViewIntent | null>(null), [warningsDialog, setWarningsDialog] = useState<QueryWarningsViewIntent | null>(null);
  useEffect(() => () => { warningsIntent.current?.dispose(); }, []);
  useEffect(() => { warningsIntent.current?.current(); }, [outcome, sessionId, connectionVersion, closeRequest, selectedPin, busy]);
  useEffect(() => useWorkspace.subscribe(() => { const receipt = warningsResultSource.current; if (receipt?.valid && !sameQueryWarningsExecution(receipt.scope, warningsViewScope())) receipt.valid = false; }), []);
  useEffect(() => { const receipt = warningsResultSource.current; if (receipt?.valid && !sameQueryWarningsExecution(receipt.scope, warningsViewScope())) receipt.valid = false; }, [sessionId, connectionVersion, closeRequest]);
  const [showPinSql, setShowPinSql] = useState<{ result: QueryResult; statement: string; sourceSql?: string; taskId: string; connectionVersion: number; pinId: string; resultIndex: number } | null>(null);
  const [recordEdit, setRecordEdit] = useState<{ table: string; source: SqliteQueryRecordInput; rangeFill?: SqliteQueryRangeFill;
    rangePaste?: SqliteQueryRangePaste; deletePositions?: readonly number[]; duplicatePositions?: readonly number[];
    rangeReplace?: SqliteQueryReplacePlan; job: WorkspaceBusyLease; cell?: SqliteQueryInlineCell & { key: string; row: DataRow } }>();
  useEffect(() => () => { recordEdit?.job.release(); }, [recordEdit]);
  const [recordRelation, setRecordRelation] = useState<{
    request: SqliteTablePageInput & { queryRecord: Extract<SqliteQueryRecordInput, { rowIndex: number }> };
    result: QueryResult; job: WorkspaceBusyLease;
  }>();
  useEffect(() => () => { recordRelation?.job.release(); }, [recordRelation]);
  const [mysqlRelation, setMysqlRelation] = useState<{
    request: MysqlQueryRecordEditInput; direction: 'parent' | 'children' | 'edit'; result: QueryResult; job: WorkspaceBusyLease;
    cell?: QueryInlineCellAnchor & { label: string; typed?: string; row: DataRow; key: string; columnIndex: number };
  }>();
  useEffect(() => () => { mysqlRelation?.job.release(); }, [mysqlRelation]);
  const [mysqlBatch, setMysqlBatch] = useState<{ request: MysqlQueryBatchEditInput; operation: MysqlQueryBatchInput;
    result: QueryResult; job: WorkspaceBusyLease; displayRows: number[]; anchor?: { row: DataRow; key: string } }>();
  useEffect(() => () => { mysqlBatch?.job.release(); }, [mysqlBatch]);
  const [queryRowSql, setQueryRowSql] = useState<{ request: Omit<QueryRowSqlInput, 'kind' | 'taskId'>;
    result: QueryResult; job: WorkspaceBusyLease; keyed: boolean }>();
  useEffect(() => () => { queryRowSql?.job.release(); }, [queryRowSql]);
  const retiredRecordTask = useRef<string | undefined>(undefined);
  const [restoreEditedCell, setRestoreEditedCell] = useState<{ row: DataRow; key: string }>();
  const [originDialog, setOriginDialog] = useState<{ outcome: QueryOutcome; index: number; mysql?: { sessionId: string; executionId: string } }>();
  const [archiveOutcome, setArchiveOutcome] = useState<QueryOutcome>();
  const [exportResult, setExportResult] = useState<(GridRangeExportData & { rectangle?: true }) | null>(null);
  const [exportSelected, setExportSelected] = useState(false);
  const resultSelection = useRef(new ResultExportSelection()).current;
  const [resultInsertSource, setResultInsertSource] = useState<ResultInsertSourceIntent | null>(null), resultInsertRef = useRef<ResultInsertSourceIntent | null>(null);
  const resultInsertActivity = useRef(0), resultInsertBusy = useRef<WorkspaceBusyLease | undefined>(undefined);
  const resultSorterRef = useRef(new QueryResultSort()), resultFilterRef = useRef(new QueryResultFilter());
  const resultSorter = resultSorterRef.current, resultFilter = resultFilterRef.current;
  const resultHistory = useRef(new QueryResultHistory()).current;
  const resultMemoryRef = useRef<QueryResultMemory | undefined>(undefined), resultMemory = resultMemoryRef.current;
  type FilterLease={binding:QueryResultFilterBinding;view:QueryResultFilterView;sortBinding:QueryResultSortBinding;sortView:QueryResultSortView;seed?:QueryResultFilterGroup};
  type SortLease = { binding: QueryResultSortBinding; view: QueryResultSortView; filterBinding: QueryResultFilterBinding; filterView: QueryResultFilterView };
  type PresetLease = SortLease & { owner: string; value: QueryResultPresetValue };
  const [presetLease, setPresetLease] = useState<PresetLease | null>(null), presetLeaseRef = useRef<PresetLease | null>(null);
  type StatisticsLease = SortLease & { source?:QueryResult; owner:string; columns:ResultColumn[]; rows:DataRow[]; column:ResultColumn; indices:ReadonlySet<number>; truncated:boolean; filter:QueryResultFilter; sorter:QueryResultSort };
  const [statisticsLease,setStatisticsLease]=useState<StatisticsLease|null>(null),statisticsLeaseRef=useRef<StatisticsLease|null>(null);
  type ComparisonLease={owner:string;pins:readonly PinnedQueryResult[]};
  const [comparisonLease,setComparisonLease]=useState<ComparisonLease|null>(null),comparisonLeaseRef=useRef<ComparisonLease|null>(null);
  const comparisonPinsRef=useRef(pins);comparisonPinsRef.current=pins;
  const [sortLease, setSortLease] = useState<SortLease | null>(null), sortLeaseRef = useRef<SortLease | null>(null);
  const [filterLease,setFilterLease]=useState<FilterLease|null>(null),filterLeaseRef=useRef<FilterLease|null>(null);
  const rowDetails = useRef(new QueryRowDetails()).current;
  const [rowDetail, setRowDetail] = useState<QueryRowDetailsView | null>(null);
  const [activeDetailRow, setActiveDetailRow] = useState<{ binding: QueryRowDetailsBinding; index: number } | null>(null);
  const [resultSelectionRevision, refreshResultSelection] = useState(0);
  const [columnLayout,setColumnLayout]=useState<{result:QueryResult;context:readonly unknown[];layout:QueryResultColumnLayout}>();
  type ColumnLease={binding:ResultSelectionBinding;owner:string;initial:QueryResultColumnLayout};
  const [columnLease,setColumnLease]=useState<ColumnLease|null>(null), columnLeaseRef=useRef<ColumnLease|null>(null);
  const resultOwner=useRef({tabId:tab.id,connectionId:tab.connectionId,version:connectionVersion});resultOwner.current={tabId:tab.id,connectionId:tab.connectionId,version:connectionVersion};
  /** 直接观察工作区ABA及其它模态，旧管理器／网格事件不能在恢复原值后重领。 */
  useEffect(()=>{
    const revoke=()=>{resultInsertRef.current?.invalidate();comparisonLeaseRef.current=null;setComparisonLease(null);statisticsLeaseRef.current=null;setStatisticsLease(null);presetLeaseRef.current=null;setPresetLease(null);sortLeaseRef.current=null;setSortLease(null);filterLeaseRef.current=null;setFilterLease(null);resultSelection.invalidate();rowDetails.invalidate();setRowDetail(null);setActiveDetailRow(null);columnLeaseRef.current=null;setColumnLease(null);refreshResultSelection(value=>value+1);};
    const unsubscribe=useWorkspace.subscribe(state=>{const source=resultOwner.current,current=state.settings.tabs.find(item=>item.id===source.tabId);const sourceChanged=current?.kind!=='query'||current.connectionId!==source.connectionId||(state.connectionVersions[source.connectionId]??0)!==source.version;const changed=state.settings.activeTabId!==source.tabId||sourceChanged;if(sourceChanged)resultMemoryRef.current=undefined;if(changed)resultHistory.invalidate();if(changed||state.activeJobs[source.tabId]&&!resultInsertActivity.current)revoke();else resultInsertRef.current?.current();});
    let blocked=false;
    const inspect=(records:MutationRecord[]=[])=>{
      // 网格尺寸和快照改名窗口保留原结果绑定，实际应用仍等窗口关闭后复核。
      const dialogs = Array.from(document.querySelectorAll(appDialogSelector));
      const gridSizeDialog=layoutRoot.current?.querySelector('[data-grid-size-dialog]')?.closest(appDialogSelector);
      const pinRenameDialog = dialogs.find(dialog => dialog.querySelector('[data-pinned-result-rename]')?.getAttribute('data-pinned-result-rename') === tab.id);
      const lease=columnLeaseRef.current, preset=presetLeaseRef.current, statistics=statisticsLeaseRef.current, comparison=comparisonLeaseRef.current, insert=resultInsertRef.current, owned=lease?document.querySelector(`[data-query-columns-owner="${lease.owner}"]`)?.querySelector(appDialogSelector):preset?document.querySelector(`[data-query-result-presets-owner="${preset.owner}"]`)?.querySelector(appDialogSelector):statistics?document.querySelector(`[data-query-result-statistics-owner="${statistics.owner}"]`)?.querySelector(appDialogSelector):comparison?document.querySelector(`[data-query-result-comparison-owner="${comparison.owner}"]`)?.querySelector(appDialogSelector):insert?dialogs.find(node=>node.querySelector(`[data-result-insert-owner="${insert.owner}"]`)):gridSizeDialog ?? pinRenameDialog;
      const foreign=dialogs.some(node=>node!==owned);
      const added=records.some(record=>Array.from(record.addedNodes).some(node=>node instanceof Element&&(node.getAttribute('role')==='dialog'&&node!==owned||Array.from(node.querySelectorAll(appDialogSelector)).some(dialog=>dialog!==owned))));
      if(foreign&&!blocked||added)revoke();else if(blocked&&!foreign)revoke();blocked=foreign;
    };
    const observer=typeof MutationObserver==='undefined'?undefined:new MutationObserver(inspect);observer?.observe(document.body,{childList:true,subtree:true});
    return()=>{unsubscribe();observer?.disconnect();resultInsertRef.current?.invalidate();comparisonLeaseRef.current=null;statisticsLeaseRef.current=null;presetLeaseRef.current=null;resultMemoryRef.current=undefined;resultFilterRef.current.invalidate();resultSorterRef.current.invalidate();resultHistory.invalidate();resultSelection.invalidate();rowDetails.invalidate();columnLeaseRef.current=null;sortLeaseRef.current=null;};
  },[tab.id,tab.connectionId,resultSelection]);
  /** 新执行和结果切换先撤销同步绑定，旧事件不能在下一次渲染前导出。 */
  function invalidateResultSelection() { snapshotOperation.current?.intent.invalidate();resultInsertRef.current?.invalidate();comparisonLeaseRef.current=null;setComparisonLease(null);statisticsLeaseRef.current=null;setStatisticsLease(null);sortLeaseRef.current=null;setSortLease(null);filterLeaseRef.current=null;setFilterLease(null);resultSelection.invalidate(); rowDetails.invalidate(); setRowDetail(null); setActiveDetailRow(null); }
  const [snippets, setSnippets] = useState<{ initialSql: string; create: boolean } | null>(null);
  const snippetTarget = useRef<HistoryInsertionTarget | null>(null);
  const historyInsertion = useRef<HistoryInsertionTarget | null>(null);
  /** 历史和片段均固定原模型、选区、连接、活动会话及操作状态。 */
  function captureInsertion(instance: monaco.editor.IStandaloneCodeEditor, mode?: QueryInsertionMode) {
    flushEditorContent(instance);
    return captureHistoryInsertion(instance, () => {
      const workspace = useWorkspace.getState(), current = workspace.settings.tabs.find(item => item.id === tab.id);
      return { tab: current, activeTabId: workspace.settings.activeTabId, connection: workspace.connections.find(item => item.id === current?.connectionId), connectionVersion: workspace.connectionVersions[current?.connectionId ?? ''] ?? 0, selection: workspace.selection,
        session: sessionRef.current, execution: task.current, alive: alive.current && editor.current === instance, busy: busyRef.current || !!pendingSession.current || !!workspace.activeJobs[tab.id] || !!formatting.current || fileSource.isBusy(), closing: !!closeRequestRef.current };
    }, listener => useWorkspace.subscribe(listener), mode);
  }
  /** App只登记工厂，打开历史时才捕获原查询；隐藏页不会被误认为活动编辑器。 */
  useEffect(() => {
    if (!historyInsertionRegistry) return;
    const unregister = historyInsertionRegistry.register(tab.id, mode => {
      historyInsertion.current?.dispose();
      const instance = editor.current;
      if (!instance) return null;
      historyInsertion.current = captureInsertion(instance, mode);
      return historyInsertion.current;
    });
    return () => { unregister(); historyInsertion.current?.dispose(); historyInsertion.current = null; };
  }, [historyInsertionRegistry, tab.id]);
  // 纯React忙态、关闭和会话提交同样立即观察；不等历史回包才比较，不增加轮询。
  useLayoutEffect(() => { historyInsertion.current?.current(); snippetTarget.current?.current(); });
  useEffect(() => () => snippetTarget.current?.dispose(), []);
  const [parameterSource, setParameterSource] = useState<string | null>(null);
  const parameterSession = useRef(''); const [queryRunning, setQueryRunning] = useState(false);
  const parameterFormRef = useRef<QueryParameterForm | null>(null);
  /** 原表单有独立生命周期；关闭/文件流程的ABA撤权，不因自身参数Modal或busy自失效。 */
  useLayoutEffect(() => { const form = parameterFormRef.current; if (!form) return; if (closeRequest || fileSource.busy || fileOpening) form.valid = false; try { assertParameterForm(form); } catch { /* 每次实际渲染也观察session/来源ABA，不复活旧租约。 */ } });
  useEffect(() => { const off = useWorkspace.subscribe(() => { const form = parameterFormRef.current; if (form) { try { assertParameterForm(form); } catch { /* 原表单保留错误提示，不接管后继来源。 */ } } }); return () => { off(); if (parameterFormRef.current) { parameterFormRef.current.valid = false; parameterFormRef.current.intent?.dispose(); } }; }, []);
  const parameterReuse = useRef<QueryParameterReuseOwner | null>(null);
  const parameterReusePort = useRef<QueryParameterReusePort | null>(null);
  /** 值只属于当前组件RAM；不进入workspace、设置、历史或文件来源。 */
  function parameterReuseOwner(): QueryParameterReuseOwner {
    return parameterReuse.current ??= new QueryParameterReuseOwner(parameterReuseInput);
  }
  /** 直接读取真实模型和同步工作区；来源键只含有界摘要，不序列化整个SQL正文。 */
  function parameterReuseInput(): Omit<QueryParameterReuseScopeInput, 'formIdentity'> | null {
    const workspace = useWorkspace.getState(), current = workspace.settings.tabs.find(item => item.id === tab.id);
    if (!current || current.kind !== 'query') return null;
    const profile = workspace.connections.find(item => item.id === current.connectionId);
    const context = resolveQueryDatabase(current.database, current.databaseContext, connectionDatabase(profile));
    const saved = current.sourceBinding, file = current.fileSourceBinding;
    return { tabId: current.id, connectionId: current.connectionId, connectionVersion: workspace.connectionVersions[current.connectionId] ?? 0,
      sessionId: sessionRef.current || null, editor: editor.current, present: alive.current && !!profile && !closeRequestRef.current,
      draft: current.sql, savedSourceKey: JSON.stringify(saved ? [saved.id, saved.digest, saved.connectionId ?? null, saved.connectionDigest ?? null, saved.context.state, 'database' in saved.context ? saved.context.database ?? null : null] : null),
      fileSourceKey: JSON.stringify(file ? [file.id, file.revision] : null), databaseKey: JSON.stringify([context.state === 'known' ? context.database : null]),
      databaseKnown: context.state === 'known', taskId: task.current };
  }
  useEffect(() => {
    const stop = useWorkspace.subscribe(() => parameterReuse.current?.observe());
    return () => { stop(); parameterReuse.current?.dispose(); parameterReuse.current = null; parameterReusePort.current = null; };
  }, []);
  useLayoutEffect(() => { parameterReuse.current?.observe(); });
  useEffect(() => {
    // 首次打开参数表单后才观察模型，普通编辑无需读取参数来源或注册额外模型事件。
    if (!searchEditor || !parameterReuse.current) return;
    const changed = () => parameterReuse.current?.observe();
    const subscriptions = [searchEditor.onDidChangeModel(changed), searchEditor.onDidChangeModelContent(changed), searchEditor.onDidChangeCursorSelection(changed), searchEditor.onDidDispose(() => {
      if (editor.current === searchEditor) { editor.current = null; parameterReuse.current?.dispose(); parameterReuse.current = null; }
    })];
    return () => subscriptions.forEach(subscription => subscription.dispose());
  }, [searchEditor, parameterSource]);
  const [transactionKnown, setTransactionKnown] = useState(true);
  const [sqliteFullExport, setSqliteFullExport] = useState<FullQueryExportSource | null>(null);
  const [streamExportSource, setStreamExportSource] = useState<string | null>(null); const streamParameterSession = useRef(''); const streamCancelled = useRef('');
  /** 打开前固定单一选区，模态内预览及本地片段写入都不能接管查询正文。 */
  function openSnippets(create = false, instance = editor.current) {
    if (!instance || instance !== editor.current || !queryMenuCurrent() || resultsOnly || busyRef.current || fileSource.isBusy() || useWorkspace.getState().activeJobs[tab.id]) return;
    const model = instance.getModel(), ranges = instance.getSelections();
    if (!model || model.isDisposed() || instance.getRawOptions().readOnly) return;
    if (ranges?.length !== 1) { setError(zh.snippets.singleTarget); return; }
    const range = ranges[0], length = model.getValueLengthInRange(range);
    if (create && range.isEmpty()) return;
    if (create && length > SNIPPET_LIMITS.sql) { setError(zh.snippets.selectionTooLong); return; }
    const selected = length <= SNIPPET_LIMITS.sql ? model.getValueInRange(range) : '';
    if (create && !selected.trim()) { setError(zh.snippets.selectionBlank); return; }
    const initialSql = selected || (model.getValueLength() <= SNIPPET_LIMITS.sql ? model.getValue() : '');
    snippetTarget.current?.dispose();
    snippetTarget.current = captureInsertion(instance, 'snippet');
    if (!snippetTarget.current) return;
    invalidateResultSelection();
    setSnippets({ initialSql, create });
  }
  function createSnippetFromSelection(instance = editor.current) { openSnippets(true, instance); }
  function closeSnippets() {
    snippetTarget.current?.dispose();
    snippetTarget.current = null;
    invalidateResultSelection();
    setSnippets(null);
  }
  /** 原选区仍有效时只插入一次。内置字段由编辑器管理，用户片段保留原始文本。 */
  function insertSnippet(snippet: SqlSnippet) {
    const instance = editor.current, target = snippetTarget.current;
    if (!instance || !target?.current()) throw Error(zh.snippets.insertChanged);
    target.insert(snippet.sql, undefined, prepareBuiltinSnippetInsert(instance, snippet));
    closeSnippets();
    window.setTimeout(() => {
      if (alive.current && editor.current === instance && useWorkspace.getState().settings.activeTabId === tab.id) instance.focus();
    }, 0);
  }

  /** 每个查询标签保持独立会话；事务和临时表不会混入其他标签。 */
  async function ensureSession() {
    if (sessionRef.current) return sessionRef.current;
    if (!pendingSession.current){
      const workspace=useWorkspace.getState(),current=workspace.settings.tabs.find(item=>item.id===tab.id)??tab;
      const context: QueryDatabaseContext = resolveQueryDatabase(current.database,current.databaseContext,connectionDatabase(workspace.connections.find(item=>item.id===tab.connectionId)));
      if(context.state==='unknown'){setRecoveryDatabase('');setRecovery(true);}
      const database=queryConnectionDatabase(context);
      pendingSession.current = invoke('connections.open', { id: tab.connectionId }).then(() => invoke('sessions.open', { connectionId: tab.connectionId, database })).then(result => { sessionRef.current = result.sessionId; setSessionId(result.sessionId); return result.sessionId; }).finally(() => { pendingSession.current = null; });
    }
    return pendingSession.current;
  }
  /** 仅更新仍存在的查询标签；重复快照不触发SQLite写入，也不复活已经关闭的标签。 */
  function rememberDatabase(context:QueryDatabaseContext, request?:QueryCloseRequest){
    const workspace=useWorkspace.getState(),current=workspace.settings.tabs.find(item=>item.id===tab.id);if(!current)return;
    const patch=queryDatabasePatch(context);if(current.database===patch.database&&JSON.stringify(current.databaseContext)===JSON.stringify(context))return;
    if(request?.mutate)request.mutate(current,patch,()=>workspace.updateTab(tab.id,patch));else workspace.updateTab(tab.id,patch);
  }
  /** 用户SQL发送前等待恢复信息真正落盘，不能把400毫秒防抖窗口当作崩溃安全。 */
  async function prepareExecutionContext(){
    rememberDatabase({state:'unknown'});
    try{await flushSettings();}catch(reason){throw new Error(queryContextZh.snapshotFailed+errorMessage(reason));}
  }
  /** 准备阶段先记取消意图，迟到的建连或配置保存完成后也不能继续投递用户SQL。 */
  async function cancelCurrentQuery(){cancelledQuery.current=task.current;await invoke('query.cancel',{taskId:task.current});}
  /** 明确的结构读取占用原会话，用户SQL保持原文和结果；自动补全不会进入此路径。 */
  async function readTemporaryObject(input:{database:string;table:string;taskId:string}){
    if(busyRef.current)throw new Error(sessionObjectsZh.busy);const current=sessionRef.current;if(!current)throw new Error(sessionObjectsZh.closed);
    busyRef.current=true;setBusy(true);useWorkspace.getState().setBusy(tab.id,true);
    try{return await invoke('query.temporaryRead',{...input,sessionId:current});}catch(reason){await handleQueryError(reason);throw reason;}
    finally{busyRef.current=false;setBusy(false);useWorkspace.getState().setBusy(tab.id,false);}
  }
  useEffect(() => () => { const id = sessionRef.current; if (id) void invoke('sessions.close', { sessionId: id }).catch(() => {}); else void pendingSession.current?.then(sessionId => invoke('sessions.close', { sessionId })).catch(() => {}); }, []);
  useEffect(()=>{
    // 正文执行结束只读协议缓存更新面包屑；期间隐藏旧库，绝不为展示附加SELECT DATABASE()。
    // 显式切库自己逐次核owner并发布缓存，普通effect不得清空其原actualContext。
    if(databaseSwitchIntent.current)return;
    let alive=true;setCompletionSession(undefined);
    if(sessionId&&!busy)void invoke('query.completionState',{sessionId}).then(state=>{if(alive&&sessionRef.current===sessionId&&!busyRef.current){const context=queryDatabaseFromSession(state);setCompletionSession(state);rememberDatabase(context);if(context.state==='known')parameterReuse.current?.confirmed(task.current,JSON.stringify([context.database]));}}).catch(()=>{if(alive&&sessionRef.current===sessionId&&!busyRef.current)rememberDatabase({state:'unknown'});});
    return()=>{alive=false;};
  },[sessionId,busy,connectionVersion,databaseSwitchDialog]);
  useEffect(() => window.dbark?.onTask(event => {
    if (event.taskId !== task.current) return;
    if (event.mysqlQueryStatus && (event.status === 'cancelled' || event.status === 'failed'))
      setInterruptedStatus({ taskId: event.taskId, report: event.mysqlQueryStatus });
    if (event.resultIndex === undefined) return;
    setStream(previous => {
      const updated = previous.slice(); const index = event.resultIndex!;
      const result = updated[index] ?? { columns: [], rows: [], elapsedMs: 0, truncated: false, statement: '' };
      updated[index] = { ...result, columns: event.columns ?? result.columns, rows: [...result.rows, ...(event.batch ?? [])].slice(0, settings.resultLimit) }; return updated;
    });
  }), [settings.resultLimit]);

  /** 捕获点击时的编辑器正文和选区，参数表单打开后不重新读取后台草稿。 */
  function querySource(all = false) {
    const selection = editor.current?.getSelection(); const selected = selection ? editor.current?.getModel()?.getValueInRange(selection) : '';
    return !all && selected?.trim() ? selected : editor.current?.getModel()?.getValue() ?? tab.sql ?? '';
  }
  /** 定位独立于会话与当前语句投递意图；正文、标签和连接修订均读取同步工作区。 */
  function failureSourceScope(): QueryFailureSourceScope {
    const workspace = useWorkspace.getState(), current = workspace.settings.tabs.find(item => item.id === tab.id), connectionId = current?.connectionId ?? tab.connectionId;
    return { tabId: tab.id, connectionId, connectionVersion: workspace.connectionVersions[connectionId] ?? 0, draft: current?.sql, present: alive.current && current?.kind === 'query' && workspace.connections.some(item => item.id === connectionId), active: workspace.settings.activeTabId === tab.id, busy: busyRef.current || !!workspace.activeJobs[tab.id], modal: !!document.querySelector(appDialogSelector), closing: !!closeRequestRef.current };
  }
  /** 捕获失败仅使定位不可用，不改变原执行范围、参数模板或发送行为。 */
  function captureFailureSource(source: string, all = false): QueryFailureSourceLease | undefined {
    if (!editor.current) return;
    return captureQueryFailureSource({ editor: editor.current, source, all, scope: failureSourceScope, subscribe: changed => useWorkspace.subscribe(changed), onInvalidated: () => { if (alive.current) refreshFailureSource(value => value + 1); } });
  }
  /** 新执行或新来源释放旧定位；旧按钮回调只能持有已失效的租约。 */
  function clearFailureSource(): void { failureSource.current?.dispose(); failureSource.current = undefined; }
  /** 格式化是当前草稿的普通编辑，不建连、投递SQL或改写会话/来源绑定。 */
  function formatQuery(mode: SqlFormattingMode = 'format') {
    if (busyRef.current || document.querySelector(appDialogSelector)) return;
    try {
      const workspace = useWorkspace.getState(), current = workspace.settings.tabs.find(item => item.id === tab.id), instance = editor.current;
      const model = instance?.getModel(), eol = model?.getEOL();
      // 与正文桥的受控同步采用同一模型EOL；只比较，不回写或吞掉其它正文差异。
      if (!alive.current || workspace.activeJobs[tab.id] || workspace.settings.activeTabId !== tab.id || current?.kind !== 'query' || !instance || !model || (eol !== '\n' && eol !== '\r\n') || model.getValue() !== (current.sql ?? '').replace(/\r\n|\r|\n/g, eol)) throw new Error(sqlFormattingZh.unavailable);
      const preferences = { tabSize: workspace.settings.editorTabSize, insertSpaces: workspace.settings.editorInsertSpaces, keywordCase: workspace.settings.sqlKeywordCase, expressionWidth: workspace.settings.sqlExpressionWidth, dialect: sqlite ? 'sqlite' as const : 'mysql' as const };
      if (mode === 'compact') {
        if (formatting.current || pendingSession.current || closeRequestRef.current || fileSource.isBusy()) throw Error(sqlFormattingZh.unavailable);
        setError('');
        formatSqlEditor(instance, preferences, mode);
        return;
      }
      if (preferences.dialect === 'sqlite' || readSqlKeywordCase(preferences.keywordCase) === 'preserve') { formatting.current?.dispose(); formatting.current = null; formatSqlEditor(instance, preferences); return; }
      if (formatting.current || pendingSession.current || closeRequestRef.current || fileSource.isBusy()) throw Error(sqlFormattingZh.unavailable);
      const owner = current, profile = workspace.connections.find(item => item.id === owner.connectionId), version = workspace.connectionVersions[owner.connectionId] ?? 0, session = sessionRef.current;
      let operation: DeferredUpperSqlFormatting | undefined, observer: MutationObserver | undefined, modalSeen = false;
      // 模态窗口即使打开又关闭也留下墓碑；提交前同步取出尚未投递的记录。
      const inspectModals = (records: MutationRecord[]) => { if (records.some(record => Array.from(record.addedNodes).some(node => node.nodeType === 1 && ((node as Element).getAttribute('role') === 'dialog' || (node as Element).querySelector(appDialogSelector))))) modalSeen = true; };
      operation = new DeferredUpperSqlFormatting({
        editor: () => editor.current,
        assertCurrent() {
          if (observer) inspectModals(observer.takeRecords());
          const latest = useWorkspace.getState(), target = latest.settings.tabs.find(item => item.id === tab.id);
          if (!alive.current || operation && formatting.current !== operation || target !== owner || latest.connections.find(item => item.id === owner.connectionId) !== profile || (latest.connectionVersions[owner.connectionId] ?? 0) !== version || sessionRef.current !== session || latest.settings.activeTabId !== tab.id || latest.activeJobs[tab.id] || busyRef.current || pendingSession.current || closeRequestRef.current || fileSource.isBusy() || modalSeen || document.querySelector(appDialogSelector) || latest.settings.sqlKeywordCase !== preferences.keywordCase || latest.settings.editorTabSize !== preferences.tabSize || latest.settings.editorInsertSpaces !== preferences.insertSpaces || latest.settings.sqlExpressionWidth !== preferences.expressionWidth) throw Error(sqlFormattingZh.unavailable);
        },
        subscribe(changed) {
          const unsubscribe = useWorkspace.subscribe(changed);
          if (typeof MutationObserver !== 'undefined') { observer = new MutationObserver(records => { inspectModals(records); if (modalSeen) changed(); }); observer.observe(document.body, { childList: true, subtree: true }); }
          return () => { unsubscribe(); observer?.disconnect(); observer = undefined; };
        },
      }, preferences);
      formatting.current = operation; const captured = operation;
      return captured.run().catch(reason => { if (alive.current && formatting.current === captured && useWorkspace.getState().settings.tabs.find(item => item.id === tab.id) === owner) setError(errorMessage(reason)); }).finally(() => { if (formatting.current === captured) formatting.current = null; });
    } catch (reason) { setError(errorMessage(reason)); }
  }
  function openFormattingOptions() {
    if (formatOptions || resultsOnly) return;
    try {
      setFormatOptions(captureQueryFormattingOptions(tab.id, () => editor.current, sqlite ? 'sqlite' : 'mysql',
        () => alive.current && !busyRef.current && !pendingSession.current && !closeRequestRef.current && !fileSource.isBusy() && !formatting.current));
    } catch (reason) { setError(errorMessage(reason)); }
  }
  /** 复制仅占本地意图，不占SQL任务、不清结果；关闭/换连/新作业会永久撤销等待中的复制。 */
  async function duplicateQuery(mode: QueryDuplicateMode = 'all', expectedEditor = editor.current, statements?: readonly NavigableStatement[], output?: StatementQueryOutput) {
    const library = output?.mode === 'save-statements' ? output : undefined;
    if (duplicateIntent.current || expectedEditor !== editor.current ||
        (mode === 'selection' || mode === 'statement' || !!output) && resultsOnly) {
      if (library) throw Error(queryDuplicateZh.unavailable);
      return;
    }
    let intent: QueryDuplicateIntent | undefined;
    try {
      const scope = () => {
        const workspace = useWorkspace.getState(), current = workspace.settings.tabs.find(item => item.id === tab.id), profile = workspace.connections.find(item => item.id === current?.connectionId), origin = duplicateOrigin.current;
        return { tab: current, connection: profile, connectionVersion: workspace.connectionVersions[current?.connectionId ?? ''] ?? 0, sessionId: sessionRef.current,
          present: alive.current && current?.kind === 'query' && !!profile && current.connectionId === tab.connectionId && current.connectionId === origin.connectionId && (workspace.connectionVersions[current.connectionId] ?? 0) === origin.version,
          active: workspace.settings.activeTabId === tab.id, blocked: busyRef.current || !!workspace.activeJobs[tab.id] || !!pendingSession.current || !!closeRequestRef.current || !!document.querySelector(appDialogSelector) ||
            mode !== 'all' && (fileSource.isBusy() || !!formatting.current) || !!output && output.mode !== 'statements' && !output.current() };
      };
      intent = new QueryDuplicateIntent({ editor: () => editor.current, scope, flush: flushEditorContent,
        subscribe: changed => {
          const unsubscribe = useWorkspace.subscribe(changed);
          const observer = typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(records => {
            if (records.some(record => Array.from(record.addedNodes).some(node => node instanceof Element && (node.getAttribute('role') === 'dialog' || node.querySelector(appDialogSelector))))) intent?.dispose();
          });
          observer?.observe(document.body, { childList: true, subtree: true }); return () => { unsubscribe(); observer?.disconnect(); };
        },
        database: async initial => initial.sessionId ? queryDatabaseFromSession(await invoke('query.completionState', { sessionId: initial.sessionId })) : resolveQueryDatabase(initial.tab?.database, initial.tab?.databaseContext, connectionDatabase(initial.connection)),
        open: candidate => {
          if (library) {
            if (sqlite && candidate.database && candidate.database !== 'main') throw Error(sqliteZh.mainOnly);
            return saveStatementQuery(candidate, library.libraryName, library.group);
          }
          const workspace = useWorkspace.getState();
          if (workspace.settings.tabs.length >= 100) throw Error(queryDuplicateZh.tooMany);
          workspace.openTab(candidate);
        },
        openBatch: openStatementDraftBatch,
        chooseTarget: onChooseQueryTarget,
      }, mode, statements);
      duplicateIntent.current = intent; setDuplicating(true); await intent.run();
    } catch (reason) {
      if (library) throw reason;
      if (alive.current) setError(errorMessage(reason));
    }
    finally { intent?.dispose(); if (duplicateIntent.current === intent) { duplicateIntent.current = null; if (alive.current) setDuplicating(false); } }
  }
  /** 选区优先执行；执行计划走专用命令，由引擎拒绝多语句输入。 */
  async function execute(mode: 'selected' | 'selection-only' | 'all' | 'explain' = 'selected') {
    if (busyRef.current || document.querySelector(appDialogSelector)) return;
    if (mode === 'selection-only' || sqlite && mode === 'explain') {
      if (mode === 'selection-only' && resultsOnly) return;
      if (!alive.current || useWorkspace.getState().activeJobs[tab.id] || closeRequestRef.current || fileSource.isBusy() || formatting.current || useWorkspace.getState().queryFileOpenings?.[tab.id] || document.querySelector('[role="alertdialog"]')) return;
      let intent: CurrentStatementIntent | undefined;
      try {
        if (!editor.current) throw Error(currentStatementZh.unavailable);
        // 仅选区使用准确捕获的文本，计划仍沿原选区优先规则；两者都不发送 currentStatement。
        const strictSelection = mode === 'selection-only';
        intent = new CurrentStatementIntent(editor.current, currentStatementScope, changed => useWorkspace.subscribe(changed), strictSelection); activeCurrentIntent.current = intent;
        if (strictSelection) await runQuery(intent.source, 'execute', undefined, intent, captureFailureSource(intent.source), undefined, continueOnError, !sqlite && collectWarnings);
        else {
          const source = querySource();
          await runQuery(source, 'explain', undefined, intent, captureFailureSource(source));
        }
      } catch (reason) { setError(errorMessage(reason)); }
      finally { intent?.dispose(); if (activeCurrentIntent.current === intent) activeCurrentIntent.current = null; }
      return;
    }
    const source = querySource(mode === 'all'), locator = mode === 'explain' ? undefined : captureFailureSource(source, mode === 'all');
    await runQuery(source, mode === 'explain' ? 'explain' : 'execute', undefined, undefined, locator, undefined, mode !== 'explain' && continueOnError, !sqlite && mode !== 'explain' && collectWarnings);
  }
  /** 事务默认值绑定原标签和物理会话来源，SQL正文变化不撤销设置。 */
  function transactionSettingsScope(): QueryTransactionSettingsScope {
    const state = useWorkspace.getState(), current = state.settings.tabs.find(item => item.id === tab.id), connectionId = current?.connectionId ?? tab.connectionId;
    return { tabId: tab.id, connectionId, connectionVersion: state.connectionVersions[connectionId] ?? 0, connection: state.connections.find(item => item.id === connectionId), sessionId: sessionRef.current, present: alive.current && current?.kind === 'query', active: state.settings.activeTabId === tab.id, closing: !!closeRequestRef.current };
  }

  /** 每次打开都由弹窗重新读取，不保存或恢复之前的默认事务设置。 */
  function openTransactionSettings() {
    if (sqlite) return;
    const workspace = useWorkspace.getState();
    if (busyRef.current || workspace.activeJobs[tab.id] || pendingSession.current || closeRequestRef.current || formatting.current || fileSource.isBusy() || transactionSettingsIntent.current || document.querySelector(appDialogSelector)) return;
    const current = workspace.settings.tabs.find(item => item.id === tab.id), profile = workspace.connections.find(item => item.id === current?.connectionId);
    if (current?.kind !== 'query' || !profile) return;
    // 尚未建立会话且默认库来源未知时，沿用既有确认入口，避免猜库或叠加模态。
    if (!sessionRef.current && resolveQueryDatabase(current.database, current.databaseContext, connectionDatabase(profile)).state === 'unknown') { setRecoveryDatabase(''); setRecovery(true); return; }
    try {
      const intent = new QueryTransactionSettingsIntent(transactionSettingsScope, listener => useWorkspace.subscribe(listener), queryTransactionSettingsZh.changed);
      transactionSettingsIntent.current = intent; setTransactionSettingsDialog({ intent, connectionName: profile.name });
    } catch (reason) { setError(errorMessage(reason)); }
  }

  /** 占用仅覆盖本次固定元数据命令；不使用查询任务编号，不改已有结果和执行历史。 */
  async function requestTransactionSettings(intent: QueryTransactionSettingsIntent, taskId: string, input?: QueryTransactionSettingsApplyInput): Promise<QueryTransactionSettingsSnapshot> {
    if (transactionSettingsIntent.current !== intent) throw Error(queryTransactionSettingsZh.changed);
    intent.assertCurrent();
    if (busyRef.current || useWorkspace.getState().activeJobs[tab.id]) throw Error(queryTransactionSettingsZh.busy);
    const job = acquireWorkspaceBusy(tab.id), operation = {};
    transactionSettingsOperation.current = operation; busyRef.current = true; setBusy(true);
    /** 每个await边界核对同一弹窗、会话来源及本次工作台占用。 */
    const assertOwner = () => {
      intent.assertCurrent();
      if (transactionSettingsIntent.current !== intent || transactionSettingsOperation.current !== operation || !job.owns()) throw Error(queryTransactionSettingsZh.changed);
    };
    try {
      assertOwner(); const session = await ensureSession(); intent.bindSession(session); assertOwner();
      const response = input ? await invoke('query.transactionSettings.apply', { sessionId: session, taskId, expected: input.expected, isolation: input.isolation, readOnly: input.readOnly }) : await invoke('query.transactionSettings.read', { sessionId: session, taskId });
      assertOwner(); const snapshot = queryTransactionSettingsSnapshotSchema.parse(response);
      // 新鲜协议状态允许只读事务拒写后恢复显式回滚按钮，不触碰旧可视结果。
      setTransaction(snapshot.transactionOpen); setTransactionKnown(true); useWorkspace.getState().setDirty(tab.id, snapshot.transactionOpen);
      return snapshot;
    } catch (reason) {
      // 断线或SET后读回失败不能继续声称旧协议状态可信；旧来源回执无权修改新标签。
      try { assertOwner(); setTransactionKnown(false); useWorkspace.getState().setDirty(tab.id, true); } catch { /* 仅原占用可标记未知，来源失效时保留新状态。 */ }
      throw reason;
    } finally {
      if (transactionSettingsOperation.current === operation) { transactionSettingsOperation.current = null; busyRef.current = false; if (alive.current) setBusy(false); }
      job.release();
    }
  }

  /** 自动提交沿用原弹窗及原会话租约，收到确认后保留提交事实，不重连或重放。 */
  async function requestAutocommit(intent: QueryTransactionSettingsIntent, input: Omit<QueryAutocommitApplyInput, 'sessionId'>): Promise<QueryAutocommitOutput> {
    if (transactionSettingsIntent.current !== intent) throw Error(queryTransactionSettingsZh.changed);
    intent.assertCurrent();
    if (busyRef.current || useWorkspace.getState().activeJobs[tab.id]) throw Error(queryTransactionSettingsZh.busy);
    const job = acquireWorkspaceBusy(tab.id), operation = {};
    transactionSettingsOperation.current = operation; busyRef.current = true; setBusy(true);
    /** 协议确认可记录到原任务，只有仍持有原来源的回执才能更新当前标签。 */
    const assertOwner = () => {
      intent.assertCurrent();
      if (transactionSettingsIntent.current !== intent || transactionSettingsOperation.current !== operation || !job.owns()) throw Error(queryTransactionSettingsZh.changed);
    };
    try {
      assertOwner(); const session = await ensureSession(); intent.bindSession(session); assertOwner();
      const output = checkQueryAutocommitOutput(await invoke('query.autocommit.apply', { ...input, sessionId: session }), input.expected, input.autocommit);
      assertOwner();
      setTransaction(output.snapshot.transactionOpen); setTransactionKnown(!output.cleanupWarning);
      useWorkspace.getState().setDirty(tab.id, output.snapshot.transactionOpen || !!output.cleanupWarning);
      return output;
    } catch (reason) {
      try { assertOwner(); setTransactionKnown(false); useWorkspace.getState().setDirty(tab.id, true); } catch { /* 失效来源无权覆盖新标签状态。 */ }
      throw reason;
    } finally {
      if (transactionSettingsOperation.current === operation) { transactionSettingsOperation.current = null; busyRef.current = false; if (alive.current) setBusy(false); }
      job.release();
    }
  }

  /** 晚到关闭回调不能清掉后一次弹窗，请求落定之前不允许关闭。 */
  function closeTransactionSettings(intent: QueryTransactionSettingsIntent) {
    if (transactionSettingsIntent.current !== intent || transactionSettingsOperation.current) return;
    intent.dispose(); transactionSettingsIntent.current = null; setTransactionSettingsDialog(null);
  }

  /** 原标签对象、实际协议库及模型由同步端口读取；只豁免本操作自己的忙租约。 */
  function databaseSwitchScope(): QueryDatabaseSwitchScope {
    const state=useWorkspace.getState(),current=state.settings.tabs.find(item=>item.id===tab.id),operation=databaseSwitchOperation.current;
    const own=operation?.intent===databaseSwitchIntent.current&&(operation?.acquiring||operation?.job?.owns());
    return {tab:current,connection:state.connections.find(item=>item.id===current?.connectionId),connectionVersion:state.connectionVersions[current?.connectionId??'']??0,sessionId:sessionRef.current,
      actualContext:queryDatabaseFromSession(completionSessionRef.current),present:alive.current&&current?.kind==='query',active:state.settings.activeTabId===tab.id,closing:!!closeRequestRef.current,
      available:!pendingSession.current&&!formatting.current&&!fileSource.isBusy()&&(!!own||!busyRef.current&&!state.activeJobs[tab.id])};
  }

  /** 仅当前已连接空闲页打开目录；绝不建连、修改正文或借普通runQuery发送USE。 */
  function openDatabaseSwitch() {
    if (sqlite) return;
    if(databaseSwitchIntent.current||busyRef.current||!sessionRef.current||!editor.current||closeRequestRef.current||document.querySelector(appDialogSelector))return;
    try {
      const intent=new QueryDatabaseSwitchIntent(editor.current,databaseSwitchScope,changed=>useWorkspace.subscribe(changed),queryDatabaseSwitchZh.changed);
      databaseSwitchIntent.current=intent;setDatabaseSwitchDialog(intent);
    }catch(reason){setError(errorMessage(reason));}
  }

  /** 目录晚回只属于原弹窗；取消加载不改默认库、不发送USE。 */
  async function loadDatabaseSwitchChoices(intent:QueryDatabaseSwitchIntent):Promise<readonly string[]> {
    if(databaseSwitchIntent.current!==intent)throw Error(queryDatabaseSwitchZh.changed);intent.assertCurrent();
    const scope=databaseSwitchScope(),databases=await invoke('metadata.databases',{connectionId:scope.tab!.connectionId});
    if(databaseSwitchIntent.current!==intent)throw Error(queryDatabaseSwitchZh.changed);intent.assertCurrent();
    return intent.ready(databases);
  }

  /** 缓存和事务分别读原session；每个await后再次核owner，失败绝不用旧库冒充服务器事实。 */
  async function refreshDatabaseSwitchSession(intent:QueryDatabaseSwitchIntent,assertOwner:()=>void) {
    assertOwner();
    const completion=await invoke('query.completionState',{sessionId:intent.sessionId}).catch(()=>undefined);assertOwner();
    const state=await invoke('query.sessionState',{sessionId:intent.sessionId}).catch(()=>null);assertOwner();
    const observed=state?.broken?undefined:completion,context=queryDatabaseFromSession(observed);
    intent.transition({recovery:context,actual:context},()=>{setCompletionSession(observed);rememberDatabase(context);});
    setTransactionKnown(!!state?.transactionKnown&&!state?.broken);
    if(state?.transactionKnown&&!state.broken)setTransaction(state.transactionOpen);
    useWorkspace.getState().setDirty(tab.id,!state?.transactionKnown||!!state?.broken||!!state?.transactionOpen);
    return context;
  }

  /** 独立任务只改变会话默认库；原task、结果来源和已应用筛选排序保持原身份。 */
  async function applyDatabaseSwitch(intent:QueryDatabaseSwitchIntent,database:string):Promise<QueryDatabaseSwitchOutput> {
    if(databaseSwitchIntent.current!==intent||busyRef.current||useWorkspace.getState().activeJobs[tab.id])throw Error(queryDatabaseSwitchZh.busy);
    intent.beginSend(database);
    const operation:DatabaseSwitchOperation={intent,acquiring:true};databaseSwitchOperation.current=operation;
    let output:QueryDatabaseSwitchOutput|undefined,failure:unknown,submitted=false;
    const taskId=uid();databaseSwitchTask.current=taskId;
    /** 原会话、原操作和原workspace占用同时成立才可推进；旧finally也无权清新busy。 */
    const assertOwner=()=>{intent.assertCurrent();if(databaseSwitchIntent.current!==intent||databaseSwitchOperation.current!==operation||databaseSwitchTask.current!==taskId||!operation.job?.owns())throw Error(queryDatabaseSwitchZh.changed);};
    try {
      operation.job=acquireWorkspaceBusy(tab.id);operation.acquiring=false;busyRef.current=true;setBusy(true);assertOwner();
      invalidateResultSelection();columnLeaseRef.current=null;setColumnLease(null);presetLeaseRef.current=null;setPresetLease(null);
      activeCurrentIntent.current?.dispose();analyzeIntent.current?.dispose();transactionSettingsIntent.current?.dispose();
      // RAM候选和值即刻撤销，不能跨越默认库迁移；物理临时表目录从未清空。
      parameterReuse.current?.dispose();parameterReuse.current=null;parameterReusePort.current=null;
      try {
        const actual=await invoke('query.completionState',{sessionId:intent.sessionId});assertOwner();
        if(actual.busy||actual.broken)throw Error(queryDatabaseSwitchZh.busy);
        const expectedContext=queryDatabaseFromSession(actual);
        if(JSON.stringify(expectedContext)!==JSON.stringify(intent.expectedContext))throw Error(queryDatabaseSwitchZh.changed);
        // 只允许自己的unknown恢复账本；发送给Engine的仍是刚读取的真实协议缓存。
        await intent.transition({recovery:{state:'unknown'}},()=>prepareExecutionContext());assertOwner();
        submitted=true;
        const response=await invoke('query.databaseSwitch',{sessionId:intent.sessionId,taskId,database,expectedContext});assertOwner();
        const context=queryDatabaseFromSession(response.completion);
        if(response.sessionId!==intent.sessionId||response.taskId!==taskId||response.database!==database||context.state!=='known'||context.database!==response.database)throw Error(queryDatabaseSwitchZh.unconfirmed);
        output=response;
        intent.transition({recovery:context,actual:context},()=>{setCompletionSession(response.completion);rememberDatabase(context);});
        setTransactionKnown(response.transactionKnown);if(response.transactionKnown&&response.transactionOpen!==undefined)setTransaction(response.transactionOpen);
        useWorkspace.getState().setDirty(tab.id,!response.transactionKnown||!!response.transactionOpen);
      }catch(reason){failure=reason;}
      if(submitted){
        try {const latest=await refreshDatabaseSwitchSession(intent,assertOwner);if(output&&(latest.state!=='known'||latest.database!==output.database))failure??=Error(queryDatabaseSwitchZh.unconfirmed);}catch(reason){failure??=reason;}
        // 只保存已观察事实；无论失败发生在哪一阶段，都不重放USE或创建替代session。
        assertOwner();
        try {await flushSettings();}catch(reason){if(output)throw Error(queryDatabaseSwitchZh.saveFailed(output.database)+errorMessage(reason));throw reason;}
        assertOwner();
      }
      assertOwner();
      if(failure)throw Error((submitted&&!output?queryDatabaseSwitchZh.unconfirmed:'')+errorMessage(failure));
      if(!output)throw Error(queryDatabaseSwitchZh.failed);
      setError('');return output;
    }finally{
      if(databaseSwitchOperation.current===operation){databaseSwitchOperation.current=null;databaseSwitchTask.current='';
        if(operation.job?.owns()||!useWorkspace.getState().activeJobs[tab.id]){busyRef.current=false;if(alive.current)setBusy(false);}
        else databaseSwitchAwaitingRelease.current=true;
      }
      operation.job?.release();
    }
  }

  /** 旧加载、旧关闭回调不能清掉新弹窗；发送中的操作必须等原任务真实落定。 */
  function closeDatabaseSwitch(intent:QueryDatabaseSwitchIntent) {
    if(databaseSwitchIntent.current!==intent||databaseSwitchOperation.current)return;
    databaseSwitchIntent.current=null;intent.dispose();setDatabaseSwitchDialog(null);
  }

  /** 同步读取原模型所属连接/会话，确认期间的工作台ABA立即撤销授权。 */
  function analyzeScope(): QueryAnalyzeScope {
    const state = useWorkspace.getState(), current = state.settings.tabs.find(item => item.id === tab.id), connectionId = current?.connectionId ?? tab.connectionId;
    return { tabId: tab.id, connectionId, connectionVersion: state.connectionVersions[connectionId] ?? 0, connection: state.connections.find(item => item.id === connectionId), sessionId: sessionRef.current, draft: current?.sql, databaseKey: JSON.stringify([current?.database, current?.databaseContext]), sourceKey: JSON.stringify([current?.sourceBinding, current?.fileSourceBinding]), present: alive.current && current?.kind === 'query', active: state.settings.activeTabId === tab.id };
  }
  /** 先在原会话受限读取真实默认库；完整确认之前不发送用户SQL，也不清除已有结果。 */
  async function openAnalyze() {
    if (sqlite) return;
    if (busyRef.current || analyzeIntent.current || document.querySelector(appDialogSelector) || !editor.current || closeRequestRef.current) return;
    let intent: QueryAnalyzeIntent | undefined, opened = false;
    try {
      intent = new QueryAnalyzeIntent(editor.current, analyzeScope, changed => useWorkspace.subscribe(changed), () => { if (alive.current) setAnalyzeInvalid(queryAnalyzeZh.changed); }, queryAnalyzeZh.changed);
      analyzeIntent.current = intent; setAnalyzeInvalid(''); busyRef.current = true; setBusy(true); useWorkspace.getState().setBusy(tab.id, true);
      const session = await ensureSession(); intent.bindSession(session);
      const state = await invoke('query.analyzeContext', { sessionId: session, taskId: uid() }); intent.assertCurrent();
      if (state.dialect === 'sqlite' || state.broken || state.busy || !state.databaseKnown || state.database === undefined) throw Error(queryAnalyzeZh.changed);
      const capability = state.dialect && state.serverVersion ? queryAnalyzeCapability({ dialect: state.dialect, version: state.serverVersion }) : undefined;
      if (!capability?.supported) throw Error(capability?.reason ?? queryAnalyzeZh.unsupported);
      setCompletionSession(state); rememberDatabase({ state: 'known', database: state.database });
      intent.ready(state.database);
      const current = useWorkspace.getState().connections.find(item => item.id === tab.connectionId);
      if (!current) throw Error(queryAnalyzeZh.changed);
      setAnalyzeDialog({ intent, connectionName: `${current.name} · ${connectionOverview(current)} · ${state.dialect} ${state.serverVersion}`, databaseLabel: state.database ?? queryContextZh.none }); opened = true;
    } catch (reason) { if (alive.current) setError(errorMessage(reason)); }
    finally {
      if (!opened) { intent?.dispose(); if (analyzeIntent.current === intent) analyzeIntent.current = null; }
      busyRef.current = false; if (alive.current) setBusy(false); useWorkspace.getState().setBusy(tab.id, false);
    }
  }
  /** 取消只释放本次确认租约，保留原会话、原结果及已有事务。 */
  function closeAnalyze(intent: QueryAnalyzeIntent) {
    if (analyzeIntent.current !== intent) return;
    intent.dispose(); analyzeIntent.current = null; setAnalyzeDialog(null); setAnalyzeInvalid('');
  }
  /** 明确确认后仅交付冻结来源一次；所有await仍核同一个模型及物理会话。 */
  async function confirmAnalyze(intent: QueryAnalyzeIntent) {
    if (analyzeIntent.current !== intent || busyRef.current) return;
    try { intent.beginSend(); setAnalyzeDialog(null); await runQuery(intent.source, 'analyze', undefined, undefined, undefined, intent); }
    catch (reason) { if (alive.current) setError(errorMessage(reason)); }
    finally { if (analyzeIntent.current === intent) closeAnalyze(intent); else intent.dispose(); }
  }
  /** 编辑器实例被替换时立即撤销旧意图，旧实例迟到销毁或随后换回也不能复活。 */
  function attachQueryEditor(instance: monaco.editor.IStandaloneCodeEditor) {
    fileModelAttached.current = true;
    if (editor.current !== instance) { analyzeIntent.current?.dispose(); clearFailureSource(); parameterFailureSource.current?.dispose(); parameterFailureSource.current = undefined; formatting.current?.dispose(); formatting.current = null; activeCurrentIntent.current?.dispose(); duplicateIntent.current?.dispose(); }
    editor.current = instance; setSearchEditor(instance);
  }
  /** 直接读workspace和session同步引用，不等待React重新渲染才能拒绝旧连接或旧草稿。 */
  function currentStatementScope(): CurrentStatementScope {
    const workspace = useWorkspace.getState(), current = workspace.settings.tabs.find(item => item.id === tab.id), connectionId = current?.connectionId ?? tab.connectionId;
    return { tabId: tab.id, connectionId, connectionVersion: workspace.connectionVersions[connectionId] ?? 0, sessionId: sessionRef.current, draft: current?.sql, present: alive.current && !closeRequestRef.current && !fileSource.isBusy() && !workspace.queryFileOpenings?.[tab.id] && current?.kind === 'query' && workspace.connections.some(item => item.id === connectionId), active: workspace.settings.activeTabId === tab.id, modal: !!document.querySelector(appModalSelector) };
  }
  /** 独立入口只捕获当前模型，不读取选区或tab.sql代替正文，也不改原执行快捷键。 */
  async function executeCurrentStatement(action: 'execute' | 'explain-current' = 'execute') {
    if (action === 'explain-current' && !sqlite) return;
    if (!alive.current || busyRef.current || useWorkspace.getState().activeJobs[tab.id] || closeRequestRef.current || fileSource.isBusy() || formatting.current || useWorkspace.getState().queryFileOpenings?.[tab.id] || document.querySelector(appModalSelector)) return;
    let intent: CurrentStatementIntent | undefined;
    try {
      if (!editor.current) throw new Error(currentStatementZh.unavailable);
      intent = new CurrentStatementIntent(editor.current, currentStatementScope, changed => useWorkspace.subscribe(changed));
      activeCurrentIntent.current = intent;
      const explain = action === 'explain-current';
      await runQuery(intent.source, explain ? 'explain-current' : 'execute', undefined, intent,
        captureFailureSource(intent.source, true), undefined, !explain && continueOnError, !explain && !sqlite && collectWarnings);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { intent?.dispose(); if (activeCurrentIntent.current === intent) activeCurrentIntent.current = null; }
  }
  /** 参数识别只打开固定会话，不建立任务、不执行用户模板，也不清除已有结果。 */
  function openParameters(mode: 'selection-or-all' | 'current' = 'selection-or-all') {
    const guarded = sqlite || mode === 'current';
    if (guarded && (!alive.current || useWorkspace.getState().settings.activeTabId !== tab.id || useWorkspace.getState().activeJobs[tab.id] || closeRequestRef.current || fileSource.isBusy() || formatting.current || useWorkspace.getState().queryFileOpenings?.[tab.id] || document.querySelector('[role="alertdialog"]'))) return;
    if (busyRef.current || document.querySelector(appDialogSelector)) return;
    let intent: CurrentStatementIntent | undefined;
    let source: string;
    const formId = guarded ? uid() : '';
    try {
      if (mode === 'current') {
        if (!editor.current) throw Error(currentStatementZh.unavailable);
        intent = new CurrentStatementIntent(editor.current, () => ({
          ...currentStatementScope(),
          // 原参数弹窗属于本次意图，其它模态仍会阻止发送。
          modal: Array.from(document.querySelectorAll(appModalSelector)).some(dialog =>
            !dialog.querySelector(`[data-query-parameter-owner="${formId}"]`)),
        }), changed => useWorkspace.subscribe(changed));
        const sql = intent.source;
        if (sql.length > queryParameterLimits.sqlBytes || new TextEncoder().encode(sql).length > queryParameterLimits.sqlBytes)
          throw Error(sqlite ? parameterZh.sqliteCurrentTooLong : parameterZh.currentTooLong);
        if (sqlite) {
          const selected = locateSqliteStatement(sql, intent.offset);
          if (!selected) throw Error(parameterZh.sqliteCurrentMissing);
          source = selected.sql;
        } else source = sql;
      } else {
        source = querySource();
        if (!source.trim()) throw Error(zh.query.text001);
      }
    } catch (reason) {
      intent?.dispose(); setError(errorMessage(reason)); return;
    }
    clearFailureSource(); parameterFailureSource.current?.dispose();
    parameterFailureSource.current = intent ? captureFailureSource(intent.source, true) : captureFailureSource(source);
    parameterContinueOnError.current = !intent && continueOnError;
    parameterCollectWarnings.current = !sqlite && collectWarnings;
    if (guarded) {
      const workspace = useWorkspace.getState(), current = workspace.settings.tabs.find(item => item.id === tab.id), profile = workspace.connections.find(item => item.id === tab.connectionId);
      const validDialect = sqlite ? profile?.dialect === 'sqlite' : profile?.dialect === 'mysql' || profile?.dialect === 'mariadb';
      if (current?.kind !== 'query' || current.connectionId !== tab.connectionId || workspace.settings.activeTabId !== tab.id || !validDialect) {
        intent?.dispose(); parameterFailureSource.current?.dispose(); parameterFailureSource.current = undefined; return;
      }
      parameterFormRef.current?.intent?.dispose();
      if (parameterFormRef.current) parameterFormRef.current.valid = false;
      parameterFormRef.current = { id: formId, source, intent, connectionId: current.connectionId, connection: profile, version: workspace.connectionVersions[current.connectionId] ?? 0, fileBinding: current.fileSourceBinding, savedBinding: current.sourceBinding, session: sessionRef.current, recognized: false, submitted: false, valid: true };
    }
    invalidateResultSelection(); parameterSession.current = ''; parameterReusePort.current = intent ? null : parameterReuseOwner().begin(source); setParameterSource(source);
  }
  /** 普通参数可执行原捕获模板；只有表单/连接/物理会话及文件来源必须始终保持原归属。 */
  function assertParameterForm(form: QueryParameterForm | undefined, recognized = false): void {
    const workspace = useWorkspace.getState(), current = workspace.settings.tabs.find(item => item.id === tab.id);
    if (!form || parameterFormRef.current !== form || !form.valid || !alive.current || current?.kind !== 'query' || current.connectionId !== form.connectionId || workspace.settings.activeTabId !== tab.id || workspace.connections.find(item => item.id === form.connectionId) !== form.connection || (workspace.connectionVersions[form.connectionId] ?? 0) !== form.version || current.fileSourceBinding !== form.fileBinding || current.sourceBinding !== form.savedBinding || closeRequestRef.current || fileSource.isBusy() || workspace.queryFileOpenings?.[tab.id] || form.session && sessionRef.current !== form.session || recognized && (!form.recognized || !form.session || parameterSession.current !== form.session)) { if (form) form.valid = false; throw Error(sqlite ? parameterZh.sqliteSourceChanged : parameterZh.currentSourceChanged); }
    form.intent?.assertCurrent();
  }
  /** 捕获不可变选区或全文；打开和选择文件均不执行 SQL。 */
  function openStreamExport() {
    if (sqlite) return;
    if (busyRef.current || document.querySelector(appDialogSelector)) return;
    const source = querySource(); if (!source.trim()) { setError(zh.query.text001); return; }
    invalidateResultSelection(); streamParameterSession.current = ''; setStreamExportSource(source);
  }
  /** 锁定原选区、查询标签与连接修订。弹窗内改格式或选文件不会重新读取编辑器。 */
  function openSqliteFullExport(mode: 'selection-or-all' | 'current' = 'selection-or-all') {
    if (!sqlite || !connection || !queryMenuCurrent() || busyRef.current || fileSource.isBusy() || useWorkspace.getState().activeJobs[tab.id]) return;
    const instance = editor.current, model = instance?.getModel(), selections = instance?.getSelections();
    const selection = selections?.[0];
    if (!instance || !model || model.isDisposed() || selections?.length !== 1 || !selection) { setError(sqliteQueryExportZh.singleSource); return; }
    const version = model.getVersionId(), full = model.getValue(), fromCurrentStatement = mode === 'current';
    const draft = () => useWorkspace.getState().settings.tabs.find(item => item.id === tab.id)?.sql;
    let sql: string;
    try {
      if (fromCurrentStatement) {
        const caret = instance.getPosition();
        if (!caret || full !== (draft() ?? '').replace(/\r\n|\r|\n/g, model.getEOL())) throw Error(sqliteQueryExportZh.changed);
        sql = sqliteCurrentQueryExportSource(full, model.getOffsetAt(caret));
      } else sql = selection.isEmpty() ? full : model.getValueInRange(selection);
      if (!sql.trim()) throw Error(sqliteQueryExportZh.singleSource);
    } catch (reason) { setError(errorMessage(reason)); return; }
    const capturedDraft = draft();
    invalidateResultSelection();
    setSqliteFullExport({dialect: 'sqlite', tabId: tab.id, connectionId: tab.connectionId, database: 'main', sql, fromCurrentStatement,
      current: () => queryOwnerCurrent() && !fileSource.isBusy() && !useWorkspace.getState().queryFileOpenings?.[tab.id] &&
        (!fromCurrentStatement || draft() === capturedDraft) && editor.current === instance &&
        instance.getModel() === model && !model.isDisposed() && model.getVersionId() === version});
  }
  /** 参数识别只读取会话协议缓存，保留旧结果和事务，互斥持续至 IPC 结束。 */
  async function loadStreamParameterNames() {
    if (busyRef.current) throw new Error(queryStreamZh.blocked);
    busyRef.current = true; setBusy(true); useWorkspace.getState().setBusy(tab.id, true);
    try { const session = await ensureSession(); const result = await invoke('query.parameterNames', { sessionId: session, sql: streamExportSource! }); streamParameterSession.current = session; return result; }
    catch (reason) { await handleQueryError(reason); throw reason; }
    finally { busyRef.current = false; setBusy(false); useWorkspace.getState().setBusy(tab.id, false); }
  }
  /** 最终确认只执行一次，在原标签会话中产生完整文件和独立有界预览。 */
  async function runStreamExport(options: StreamExportOptions) {
    if (busyRef.current) throw new Error(queryStreamZh.blocked);
    const source = streamExportSource!; clearFailureSource();
    invalidateResultSelection(); busyRef.current = true; streamCancelled.current = ''; setBusy(true); setQueryRunning(true); setError(''); if(options.format!=='sql'){setSelectedPin(''); setShowPinSql(null);setOutcome(null); setStream([]); setResultIndex(0);} task.current = options.taskId;cancelledQuery.current=''; useWorkspace.getState().setBusy(tab.id, true);
    try {
      const session = await ensureSession();
      if (streamCancelled.current === options.taskId) throw new Error(queryStreamZh.cancelledBeforeExecution);
      if (options.parameters && streamParameterSession.current !== session) throw new Error(queryStreamZh.sessionChanged);
      await prepareExecutionContext();
      if(streamCancelled.current===options.taskId||cancelledQuery.current===options.taskId)throw new Error(queryContextZh.cancelledBeforeSend);
      const result = await invoke('query.exportStream', { ...options, sql: source, sessionId: session });
      if(options.format!=='sql')setOutcome(result.preview); setTransaction(result.transactionOpen ?? false); setTransactionKnown(result.transactionKnown); useWorkspace.getState().setDirty(tab.id, !result.transactionKnown || !!result.transactionOpen);
      return result;
    } catch (reason) { await handleQueryError(reason); throw reason; }
    finally { busyRef.current = false; setBusy(false); setQueryRunning(false); useWorkspace.getState().setBusy(tab.id, false); }
  }
  /** 会话尚在建立时取消也必须阻止迟到的执行请求；已登记任务仍由引擎释放资源。 */
  async function cancelStreamExport(taskId: string) { streamCancelled.current = taskId; await invoke('query.cancel', { taskId }); }
  /** 模态关闭仍等待识别请求结束，期间保持标签互斥，不能同时开启另一条查询。 */
  async function loadParameterNames(form?: QueryParameterForm, sqliteNavicatParameters?: true) {
    if (busyRef.current) throw new Error('当前标签仍有操作正在进行，请稍后重试');
    if (sqlite && !form) assertParameterForm(form);
    const changed = (sqlite || form) ? (sqlite ? parameterZh.sqliteSourceChanged : parameterZh.currentSourceChanged) : undefined;
    if (form) {
      assertParameterForm(form);
      if (form.submitted) throw Error(changed);
      form.recognized = false;
      form.confirmedRange = undefined;
    }
    busyRef.current = true; setBusy(true); useWorkspace.getState().setBusy(tab.id, true);
    try {
      const session = await ensureSession();
      if (form) {
        assertParameterForm(form);
        if (form.session && form.session !== session || sessionRef.current !== session) throw Error(changed);
        form.session = session;
        form.intent?.bindSession(session);
      }
      const intent = form?.intent;
      const info = await invoke('query.parameterNames', { sessionId: session, sql: intent?.source ?? form?.source ?? parameterSource!,
        ...(intent ? {currentStatement: {offset: intent.offset}} : {}),
        ...(sqlite && sqliteNavicatParameters ? {sqliteNavicatParameters} : {}) });
      if (form) assertParameterForm(form);
      parameterSession.current = session;
      // 只读原协议缓存确认当前库；确认失败仅禁用复用，普通捕获模板仍沿原执行路径。
      try {
        const state = await invoke('query.completionState', { sessionId: session });
        if (sessionRef.current === session) {
          rememberDatabase(queryDatabaseFromSession(state));
          const port = parameterReusePort.current; if (port) parameterReuse.current?.recognized(port);
        }
      } catch { parameterReuse.current?.observe(); }
      if (form) {
        assertParameterForm(form);
        if (sqlite) {
          if (info.sqliteNavicatParameters !== sqliteNavicatParameters) throw Error(parameterZh.sqliteNavicatChanged);
          form.sqliteNavicatParameters = sqliteNavicatParameters;
        } else {
          const range = info.currentStatementRange;
          if (!intent || !range || !Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) ||
              range.start < 0 || range.start > intent.offset || range.start >= range.end || range.end > intent.source.length)
            throw Error(changed);
          form.confirmedRange = range;
        }
        form.recognized = true;
      }
      if (!info.currentStatementRange) return info;
      // 范围属于当前语句表单，参数元数据仍沿用原格式。
      const {currentStatementRange: _range, ...names} = info;
      return names;
    } catch (reason) { if (!form || parameterFormRef.current === form) await handleQueryError(reason); throw reason; }
    finally { busyRef.current = false; setBusy(false); useWorkspace.getState().setBusy(tab.id, false); }
  }
  /** 读取协议缓存更新事务提示；错误后不附加 SQL，不重放任何已经执行的写操作。 */
  async function handleQueryError(reason: unknown) {
    const message = errorMessage(reason); const current = sessionRef.current;
    const state = current ? await invoke('query.sessionState', { sessionId: current }).catch(() => null) : null;
    if (state?.broken || /会话不存在|会话连接已断开|数据库执行进程已退出|PROTOCOL_CONNECTION_LOST|ECONNRESET/.test(message)) {
      rememberDatabase({state:'unknown'});
      // SQLite 失效会话仍保留未知事务及原会话身份，不能冒充已回滚或在下一次执行时自动重建。
      if (sqlite) { if (state?.transactionOpen) setTransaction(true); setTransactionKnown(false); useWorkspace.getState().setDirty(tab.id, true); setError(sqliteZh.brokenTransaction + message); return; }
      sessionRef.current = ''; setSessionId(''); setTransaction(false); setTransactionKnown(true); useWorkspace.getState().setDirty(tab.id, false);
      if (current) void invoke('sessions.close', { sessionId: current }).catch(() => {});
      setError(formatText(zh.query.text002, message));
    } else {
      if (state) { setTransaction(state.transactionOpen); setTransactionKnown(state.transactionKnown); useWorkspace.getState().setDirty(tab.id, state.transactionOpen || !state.transactionKnown); }
      else if (current) { setTransactionKnown(false); useWorkspace.getState().setDirty(tab.id, true); }
      setError(message);
    }
  }
  /** 所有查询共用流式结果、取消与会话互斥；确认参数后立即取得互斥，无延迟重复执行窗口。 */
  async function runQuery(source: string, mode: 'execute' | 'explain' | 'explain-text' | 'explain-current' | 'analyze' = 'execute', parameters?: QueryParameter[], currentIntent?: CurrentStatementIntent, locator?: QueryFailureSourceLease, analysisIntent?: QueryAnalyzeIntent, continueAfterError = false, collectWarningDetails = false, reuseExecution?: { beforeLedger(taskId: string): void }, parameterForm?: QueryParameterForm): Promise<boolean> {
    if (sqlite && (!['execute', 'explain', 'explain-text', 'explain-current'].includes(mode) || parameters && (mode !== 'execute' || currentIntent !== parameterForm?.intent) || analysisIntent || collectWarningDetails)) { locator?.dispose(); setError(sqliteZh.unsupported); return false; }
    if (busyRef.current) { locator?.dispose(); return false; }
    if (!source.trim()) { locator?.dispose(); setError(zh.query.text001); return false; }
    const changed = parameters && (sqlite || parameterForm) ? (sqlite ? parameterZh.sqliteSourceChanged : parameterZh.currentSourceChanged) : undefined;
    if (parameters && (sqlite || parameterForm)) { try { assertParameterForm(parameterForm, true); if (source !== (parameterForm!.intent?.source ?? parameterForm!.source)) throw Error(changed); } catch (reason) { locator?.dispose(); setError(errorMessage(reason)); return false; } }
    clearFailureSource(); let retainLocator = false;
    setInterruptedStatus(undefined);
    invalidateResultSelection(); busyRef.current = true; setBusy(true); setQueryRunning(true); setError(''); setSelectedPin(''); setShowPinSql(null); setOutcome(null); setStream([]); setResultIndex(0); task.current = uid();cancelledQuery.current=''; useWorkspace.getState().setBusy(tab.id, true);
    let warningReceipt: { scope: QueryWarningsViewScope; valid: boolean } | undefined;
    try {
      if (mode === 'execute' && collectWarningDetails === true) { warningReceipt = { scope: warningsViewScope(), valid: true }; warningsResultSource.current = warningReceipt; }
      if (mode === 'analyze') { if (!analysisIntent) throw Error(queryAnalyzeZh.changed); analysisIntent.assertCurrent(); }
      const session = await ensureSession();
      if (parameters && parameterForm) { assertParameterForm(parameterForm, true); if (session !== parameterForm!.session) throw Error(changed); }
      if (warningReceipt) { if (warningReceipt.scope.sessionId && warningReceipt.scope.sessionId !== session) warningReceipt.valid = false; warningReceipt.scope.sessionId = session; }
      currentIntent?.bindSession(session);
      if (mode === 'analyze') { analysisIntent!.assertCurrent(); analysisIntent!.allowContextPreparation(); }
      if (parameters && session !== parameterSession.current) throw new Error('参数识别时的会话已失效，请重新打开参数表单');
      // 从发送前到协议终态之间持久化为未知，崩溃恢复不会误把初始库用于下一次写入。
      reuseExecution?.beforeLedger(task.current);
      await prepareExecutionContext();
      if (parameters && parameterForm) assertParameterForm(parameterForm, true);
      if (mode === 'analyze') analysisIntent!.assertCurrent();
      if(cancelledQuery.current===task.current)throw new Error(queryContextZh.cancelledBeforeSend);
      currentIntent?.assertCurrent();
      const input = { sessionId: session, sql: source, taskId: task.current, maxRows: settings.resultLimit, ...(sqlite && sqliteStatementTimeoutMs > 0 ? {sqliteStatementTimeoutMs} : {}), ...((mode === 'execute' || mode === 'explain-current') && currentIntent && !currentIntent.selectionOnly ? { currentStatement: { offset: currentIntent.offset } } : {}), ...(mode === 'execute' && continueAfterError && (!sqlite || !currentIntent || currentIntent.selectionOnly) ? { continueOnError: true as const } : {}), ...(mode === 'execute' && collectWarningDetails === true ? { collectWarnings: true as const } : {}),
        ...(mode === 'execute' && !sqlite && collectStatus ? { collectStatus: true as const } : {}),
        ...(mode === 'execute' && !sqlite && collectStages ? { collectStages: true as const } : {}) };
      // 文本计划复用首次捕获的 SQL，切换展示不会读取后来编辑的草稿。
      if (mode === 'explain' || mode === 'explain-text') explainSource.current = source;
      const result = parameters ? await invoke('query.executeParameterized', { ...input, parameters,
        ...(parameterForm?.sqliteNavicatParameters ? {sqliteNavicatParameters: true as const} : {}),
        ...(currentIntent && parameterForm?.confirmedRange ? {currentStatement: {offset: currentIntent.offset, confirmedRange: parameterForm.confirmedRange}} : {}) }) : mode === 'execute' ? await invoke('query.execute', input) : mode === 'analyze' ? await invoke('query.analyze', { ...input, acknowledged: true, expectedDatabase: analysisIntent!.database }) : await invoke('query.explain', { ...input, format: mode === 'explain-text' ? 'text' : 'auto' });
      if (result.scriptReport) {
        // 多个错误只共享一份模型/模板捕获；仅经数值和UTF16边界确认的范围可重绑定位。
        const failures = result.scriptReport.errors.filter(failure => confirmedQueryContinueRange(source, failure));
        scriptFailureRanges.current = new Set(failures);
        if (failures.length && locator?.bindRange(failures[0].sourceRange)) { failureSource.current = locator; retainLocator = true; }
      } else if (result.failure?.sourceRange && locator?.bindRange(result.failure.sourceRange)) { failureSource.current = locator; retainLocator = true; }
      if (!retainLocator && locator && (result.mysqlResultSourceRanges?.length || result.sqliteResultReceipts?.length || result.sqliteExplain?.sourceRange)) {
        // 同一原模型租约可保留成功结果的位置，即使其后失败语句没有可靠范围。
        failureSource.current = locator;
        retainLocator = true;
      }
      // 原响应只包含此前完整成功结果；清除失败语句的部分流，不能将其当作可固定或导出的结果。
      if (warningReceipt && result.warnings) warningReceipt.scope.outcome = result;
      setOutcome(result); setStream([]);
      if (result.failure) await handleQueryError(new Error(result.failure.message));
      else if (result.transactionOpen !== undefined) { setTransaction(result.transactionOpen); setTransactionKnown(true); useWorkspace.getState().setDirty(tab.id, result.transactionOpen); }
      return !result.failure && (!result.scriptReport || result.scriptReport.reachedEnd && result.scriptReport.errors.length === 0) && cancelledQuery.current !== task.current;
    } catch (reason) { await handleQueryError(reason); return false; }
    finally { if (!retainLocator) locator?.dispose(); busyRef.current = false; setBusy(false); setQueryRunning(false); useWorkspace.getState().setBusy(tab.id, false); }
  }
  /** 可选暂存与SQL提交分开：原方法同步签发任务，明确成功后再等待原会话库确认。 */
  function submitParameterQuery(source: string, parameters: QueryParameter[], form?: QueryParameterForm, sqliteNavicatParameters?: true): void {
    if (sqlite || form) {
      assertParameterForm(form, true);
      if (form!.submitted || source !== form!.source || form!.sqliteNavicatParameters !== sqliteNavicatParameters ||
          !sqlite && !form!.confirmedRange)
        throw Error(sqlite ? parameterZh.sqliteSourceChanged : parameterZh.currentSourceChanged);
      form!.submitted = true;
    }
    const port = parameterReusePort.current, owner = parameterReuse.current;
    const initial = owner ? parameterReuseInput() : null, session = parameterSession.current;
    const origin = initial ? { connectionId: initial.connectionId, connectionVersion: initial.connectionVersion } : null;
    const locator = parameterFailureSource.current; parameterFailureSource.current = undefined;
    const intent = form?.intent;
    const operation = runQuery(intent?.source ?? source, 'execute', parameters, intent, locator, undefined, parameterContinueOnError.current, parameterCollectWarnings.current, owner ?? undefined, form);
    const taskId = task.current;
    if (port) owner?.bind(port, taskId);
    parameterReusePort.current = null; setParameterSource(null);
    void operation.then(success => {
      intent?.dispose();
      if (form && parameterFormRef.current === form) { form!.valid = false; parameterFormRef.current = null; }
      if (!owner?.settled(taskId, success === true)) return;
      if (origin) void confirmParameterReuse(owner, taskId, session, origin);
      else owner.settled(taskId, false);
    });
  }
  /** 成功后补读一次协议缓存，避免React先确认库、后收到成功Promise时丢失发布机会；绝不执行诊断SQL。 */
  async function confirmParameterReuse(owner: QueryParameterReuseOwner, taskId: string, session: string, origin: { connectionId: string; connectionVersion: number }): Promise<void> {
    const current = () => {
      const workspace = useWorkspace.getState(), active = workspace.settings.tabs.find(item => item.id === tab.id);
      return alive.current && parameterReuse.current === owner && !busyRef.current && task.current === taskId && sessionRef.current === session && active?.kind === 'query' && active.connectionId === origin.connectionId && (workspace.connectionVersions[origin.connectionId] ?? 0) === origin.connectionVersion && workspace.connections.some(item => item.id === origin.connectionId);
    };
    try {
      if (!current()) { owner.settled(taskId, false); return; }
      const state = await invoke('query.completionState', { sessionId: session });
      if (!current()) { owner.settled(taskId, false); return; }
      const context = queryDatabaseFromSession(state);
      if (context.state !== 'known') { owner.settled(taskId, false); return; }
      rememberDatabase(context); owner.confirmed(taskId, JSON.stringify([context.database]));
    } catch { owner.settled(taskId, false); }
  }
  /** 取消只撤原表单；不清除其它新表单，也不写入或执行参数值。 */
  function closeParameters(form?: QueryParameterForm): void {
    if (sqlite || form) { if (!form || parameterFormRef.current !== form) return; form.valid = false; form.intent?.dispose(); parameterFormRef.current = null; }
    const port = parameterReusePort.current; if (port) parameterReuse.current?.close(port);
    parameterReusePort.current = null; parameterFailureSource.current?.dispose(); parameterFailureSource.current = undefined; invalidateResultSelection(); setParameterSource(null);
  }
  /** 报告绑定整次执行而非某个CALL结果集或排序后的行，不接触诊断会话。 */
  function warningsViewScope(): QueryWarningsViewScope {
    const workspace = useWorkspace.getState(), current = workspace.settings.tabs.find(item => item.id === tab.id), connectionId = current?.connectionId ?? tab.connectionId;
    return { tabId: tab.id, connectionId, connectionVersion: workspace.connectionVersions[connectionId] ?? 0, connection: workspace.connections.find(item => item.id === connectionId), sessionId: sessionRef.current, taskId: task.current, outcome: warningsOutcome.current, present: alive.current && current?.kind === 'query', active: workspace.settings.activeTabId === tab.id, closing: !!closeRequestRef.current, busy: busyRef.current || !!workspace.activeJobs[tab.id], pinned: warningsPinned.current };
  }

  /** 打开只使用已返回的离线报告，固定结果不能借用当前会话重新读警告。 */
  function openWarningsReport() {
    if (busyRef.current || warningsIntent.current || document.querySelector(appDialogSelector) || !warningsReportAvailable()) return;
    let intent: QueryWarningsViewIntent | undefined;
    try {
      intent = new QueryWarningsViewIntent(warningsViewScope, listener => useWorkspace.subscribe(listener), () => {
        if (warningsIntent.current === intent) { warningsIntent.current = null; if (alive.current) setWarningsDialog(null); }
      }, warningsResultSource.current!.scope);
      warningsIntent.current = intent; setWarningsDialog(intent);
    } catch (reason) { intent?.dispose(); setError(errorMessage(reason)); }
  }

  /** 执行时的收据失效后即使报告尚未打开，也不能把旧快照重新关联新连接。 */
  function warningsReportAvailable(): boolean {
    const receipt = warningsResultSource.current;
    return !!receipt?.valid && receipt.scope.outcome === warningsOutcome.current && !!warningsOutcome.current?.warnings && !warningsPinned.current && sameQueryWarningsExecution(receipt.scope, warningsViewScope());
  }

  /** 晚到的旧关闭回调不能清除新执行的报告窗口。 */
  function closeWarningsReport(intent: QueryWarningsViewIntent) {
    if (warningsIntent.current !== intent) return;
    intent.dispose(); warningsIntent.current = null; setWarningsDialog(null);
  }

  /** 事务控制与普通查询串行执行，避免提交正在运行的语句。 */
  async function transactionAction(action: 'begin' | 'commit' | 'rollback') {
    if (busyRef.current) return; busyRef.current = true; setBusy(true); setError(''); useWorkspace.getState().setBusy(tab.id, true);
    try { const session=await ensureSession();await prepareExecutionContext();await invoke('query.transaction', { sessionId:session, action }); setTransaction(action === 'begin'); setTransactionKnown(true); useWorkspace.getState().setDirty(tab.id, action === 'begin'); useWorkspace.getState().notify(action === 'begin' ? zh.query.text003 : action === 'commit' ? zh.query.text004 : zh.query.text005); }
    catch (reason) { await handleQueryError(reason); }
    finally { busyRef.current = false; setBusy(false); useWorkspace.getState().setBusy(tab.id, false); }
  }
  /** 普通保存按当前主来源分流，文件标签直接写回关联文件；查询库另存始终有独立入口。 */
  function saveCurrentSource() {
    if (busyRef.current) return;
    invalidateResultSelection();
    if (useWorkspace.getState().settings.tabs.find(item => item.id === tab.id)?.fileSourceBinding) void fileSource.save();
    else { setQueryName(tab.title); setSave(true); }
  }
  /** 文件保存后关闭仍使用严格正文/请求租约；保存期间的新编辑保留并停止关闭队列。 */
  async function saveFileAndClose() {
    const request = closeRequestRef.current;
    let intent: QuerySaveCloseIntent | undefined;
    try {
      if (!request || !editor.current) throw Error(queryCloseZh.unavailable);
      const state = useWorkspace.getState();
      if (state.activeJobs[tab.id] || state.dirtyTabs[tab.id]) throw Error(queryCloseZh.changed);
      captureQueryFileSnapshot(editor.current, () => useWorkspace.getState().settings.tabs.find(item => item.id === tab.id));
      intent = new QuerySaveCloseIntent(editor.current, () => {
        const currentState = useWorkspace.getState(), current = currentState.settings.tabs.find(item => item.id === tab.id);
        return { present: current?.kind === 'query', connection: currentState.connections.find(item => item.id === current?.connectionId), draft: current?.sql, title: current?.title, blocked: !!currentState.dirtyTabs[tab.id], connectionId: current?.connectionId ?? '', connectionVersion: currentState.connectionVersions[tab.connectionId] ?? 0, sessionId: sessionRef.current, database: current?.database, databaseContext: current?.databaseContext };
      }, listener => useWorkspace.subscribe(listener), () => alive.current, () => closeRequestRef.current === request);
      closeIntent.current = intent;
      const result = await fileSource.save(undefined, request, () => !!intent?.isCurrent(), title => intent?.adoptTitle(title));
      if (!alive.current || closeRequestRef.current !== request) return;
      const after = useWorkspace.getState(), close = result.saved && result.applied && result.restored && result.busyUnchanged && intent.isCurrent() && !after.activeJobs[tab.id] && !after.dirtyTabs[tab.id];
      if (result.saved && !close) after.notify(queryCloseZh.retained, true);
      finishClose(close);
    } catch (reason) { request?.failed?.(); setError(errorMessage(reason)); finishClose(false); }
    finally { intent?.dispose(); if (closeIntent.current === intent) closeIntent.current = undefined; }
  }
  /** 关闭三选沿主来源分流；文件失败转恢复入口，绝不隐式转存查询库。 */
  function beginCloseSave() {
    if (useWorkspace.getState().settings.tabs.find(item => item.id === tab.id)?.fileSourceBinding) { setClosePhase(null); void saveFileAndClose(); }
    else { setQueryName(tab.title); setClosePhase('save'); }
  }
  /** 保存点击时的正文与真实会话默认库；不执行SQL，不从初始标签库回填未知状态。 */
  async function saveQuery(action: 'update' | 'create', name: string, group?: SavedQueryGroupTarget, intent?: QuerySaveCloseIntent, request?: QueryCloseRequest) {
    if(busyRef.current)throw Error(queryContextZh.busy);
    intent?.assertCurrent();
    const current = useWorkspace.getState().settings.tabs.find(item => item.id === tab.id);
    if (!current) throw Error(queryBindingZh.missing);
    // 旧保存/历史来源的其他库名不能被静默保存为 main，也不能改写原查询正文或来源。
    if (sqlite && !sessionRef.current) { const context = resolveQueryDatabase(current.database, current.databaseContext, connectionDatabase(connection)); if (context.state === 'known' && context.database && context.database !== 'main') throw Error(sqliteZh.mainOnly); }
    const sql = current.fileSourceBinding ? captureQueryFileSnapshot(editor.current, () => useWorkspace.getState().settings.tabs.find(item => item.id === tab.id)).sql ?? '' : editor.current?.getModel()?.getValue() ?? current.sql ?? '';
    const fileLease = current.fileSourceBinding ? new QuerySourceLease({ ...current }, () => useWorkspace.getState().settings.tabs.find(item => item.id === tab.id), listener => useWorkspace.subscribe(listener), () => alive.current) : undefined;
    const job = intent ? acquireWorkspaceBusy(tab.id) : undefined;
    if (job) closeBusy.current = job;
    busyRef.current=true;setBusy(true);if (!job) useWorkspace.getState().setBusy(tab.id,true);
    try {
      const context = sessionRef.current ? savedQueryOriginContext(undefined, queryDatabaseFromSession(await invoke('query.completionState',{sessionId:sessionRef.current}).catch(()=>undefined)))
        : current.sourceBinding?.context.state === 'legacy' && current.databaseContext === undefined ? savedQueryOriginContext(current.database)
        : savedQueryOriginContext(undefined, resolveQueryDatabase(current.database,current.databaseContext,connectionDatabase(connection)));
      intent?.assertCurrent();
      if (context.state !== 'legacy') { intent?.adoptContext(context); rememberDatabase(context, request); }
      const content = { name, connectionId: current.connectionId, context, sql };
      if (action === 'update' && !current.sourceBinding) throw Error(queryBindingZh.unbound);
      const result = action === 'update' ? await invoke('queries.updateSource', { source: current.sourceBinding!, content })
        : await invoke('queries.create', group ? { ...content, group } : content);
      // 成功后才推进所见摘要；仅更新仍存在的原标签，绝不替换会话、事务或结果。
      const workspace = useWorkspace.getState(); let sourceApplied = true;
      if (fileLease) {
        // 文件标签显式另存查询库后原子切换主来源；旧回包不能夺走后来建立的文件关联。
        if (fileLease.current()) {
          const released = await invoke('queryFileSources.release', { tabId: tab.id, source: current.fileSourceBinding! }).catch(() => { throw Error(queryFilesZh.releaseFailed); });
          if (!released.released) throw Error(queryFilesZh.releaseFailed);
        }
        sourceApplied = fileLease.apply((_before, adoptTitle) => {
          const latest = useWorkspace.getState(); latest.updateSettings({ tabs: latest.settings.tabs.map(item => item.id === tab.id ? querySourceTab(item, { sourceBinding: result.source, ...(adoptTitle ? { title: result.name } : {}) }, 'library') : item) });
        });
      } else if ((!intent || intent.ownsView()) && workspace.settings.tabs.some(item => item.id === tab.id)) {
        const before=workspace.settings.tabs.find(item=>item.id===tab.id)!,patch={title:result.name,sourceBinding:result.source};
        if(request?.mutate)request.mutate(before,patch,()=>workspace.updateTab(tab.id,patch));else workspace.updateTab(tab.id,patch);
      }
      if (!intent || intent.ownsView()) setSave(false); workspace.notify(!sourceApplied ? queryFilesZh.libraryRetained : action === 'update' ? queryBindingZh.saved : queryBindingZh.created, !sourceApplied);
      let restored = true;
      await flushSettings().catch(reason => { restored = false; workspace.notify(queryBindingZh.restoreFailed + errorMessage(reason), true); });
      return { restored, busyUnchanged: !job || job.owns() };
    }
    finally {
      fileLease?.dispose();
      busyRef.current=false; if (!intent || intent.ownsView()) setBusy(false);
      // 新作业接替后只释放本次租约，不能清掉新标记或借此获得关闭权限。
      if (job) { job.release(); if (closeBusy.current === job) closeBusy.current = undefined; }
      else useWorkspace.getState().setBusy(tab.id,false);
    }
  }
  /** 一次关闭请求只借用既有保存函数；失败保留弹窗，成功后不重发写入。 */
  async function saveAndClose(action: 'update' | 'create', name: string, group?: SavedQueryGroupTarget) {
    const request = closeRequestRef.current;
    let intent: QuerySaveCloseIntent | undefined;
    try {
      if (!request || !editor.current) throw Error(queryCloseZh.unavailable);
      const before = useWorkspace.getState();
      if (before.activeJobs[tab.id] || before.dirtyTabs[tab.id]) throw Error(queryCloseZh.changed);
      intent = new QuerySaveCloseIntent(editor.current, () => {
        const state = useWorkspace.getState(), current = state.settings.tabs.find(item => item.id === tab.id), profile = state.connections.find(item => item.id === current?.connectionId);
        return { present: current?.kind === 'query' && !!profile, connection: profile, draft: current?.sql, blocked: !!state.dirtyTabs[tab.id], connectionId: current?.connectionId ?? '', connectionVersion: state.connectionVersions[tab.connectionId] ?? 0, sessionId: sessionRef.current, database: current?.database, databaseContext: current?.databaseContext };
      }, listener => useWorkspace.subscribe(listener), () => alive.current, () => closeRequestRef.current === request);
      closeIntent.current = intent;
      const result = await saveQuery(action, name, group, intent, request);
      if (!alive.current || closeRequestRef.current !== request) return;
      const state = useWorkspace.getState(), close = result.restored && result.busyUnchanged && intent.isCurrent() && !state.activeJobs[tab.id] && !state.dirtyTabs[tab.id];
      if (result.restored && !close) state.notify(queryCloseZh.retained, true);
      setClosePhase(null); onCloseRequestFinished?.(request, close);
    } catch (reason) { request?.failed?.(); throw reason; }
    finally { intent?.dispose(); if (closeIntent.current === intent) closeIntent.current = undefined; }
  }
  /** 直接关闭也需核对请求及既有作业/事务守卫；空草稿不要求保存。 */
  function finishClose(close: boolean) {
    const request = closeRequestRef.current; if (!request) return;
    closeIntent.current?.dispose(); setClosePhase(null); onCloseRequestFinished?.(request, close);
  }
  /** 只有原模型和工作台草稿一致时才把当前准确标签交给保留入口。 */
  function closeKeepingDraft(): void {
    const request = closeRequestRef.current, model = editor.current?.getModel();
    const state = useWorkspace.getState(), current = state.settings.tabs.find(item => item.id === tab.id);
    if (!request || current !== tab || !model || model.isDisposed() || busyRef.current || fileSource.isBusy() || model.getValue() !== (current.sql ?? '').replace(/\r\n|\r|\n/g, model.getEOL())) {
      state.notify(queryCloseZh.changed, true); return;
    }
    closeIntent.current?.dispose(); setClosePhase(null);
    onCloseRequestFinished?.(request, true, current);
  }
  // 保存类互斥不卸载计划查看器；实际新执行在 runQuery 内清空 outcome，仍走原结果生命周期。
  const results = outcome?.failure ? outcome.results : queryRunning ? stream : outcome?.results ?? stream; const pin = pins.find(item => item.id === selectedPin); const sourceResult = pin?.result ?? (outcome?.sqliteExplain ? undefined : results[resultIndex]);
  const resultNames = useMemo(() => results.map((item, index) => item.columns.length
    ? (sqlite ? outcome?.resultTitles?.[index] ?? undefined : queryResultTitle(item.statement))
    : undefined), [results, sqlite, outcome?.resultTitles]);
  const archiveAvailable = !pin && !busy && !queryRunning && !!outcome && !outcome.explain && !outcome.analysis && !outcome.sqliteExplain
    && outcome.results.filter(item => item.columns.length).length > 1;
  const resultOrigins = sqlite && !pin && !busy && !queryRunning && settings.activeTabId === tab.id && !closeRequest
    ? outcome?.sqliteResultOrigins?.[resultIndex] : undefined;
  const activeOrigins = originDialog && originDialog.outcome === outcome && originDialog.index === resultIndex &&
    resultOrigins && sourceResult && resultOrigins.length === sourceResult.columns.length ? { result: sourceResult, origins: resultOrigins } : undefined;
  const mysqlOrigins = !sqlite && !pin && !busy && !queryRunning && settings.activeTabId === tab.id && !closeRequest
    ? outcome?.mysqlResultOrigins?.[resultIndex] : undefined;
  const activeMysqlOrigins = originDialog?.mysql && originDialog.outcome === outcome && originDialog.index === resultIndex &&
    originDialog.mysql.sessionId === sessionRef.current && originDialog.mysql.executionId === task.current &&
    mysqlOrigins && sourceResult && mysqlOrigins.length === sourceResult.columns.length
    ? { result: sourceResult, origins: mysqlOrigins, source: originDialog, ...originDialog.mysql } : undefined;
  const mysqlOriginsOwner = useRef(activeMysqlOrigins?.source);
  mysqlOriginsOwner.current = activeMysqlOrigins?.source;
  useEffect(() => { if (originDialog && !activeOrigins && !activeMysqlOrigins) setOriginDialog(undefined); },
    [originDialog, !!activeOrigins, !!activeMysqlOrigins]);

  function mysqlOriginCurrent(view: NonNullable<typeof activeMysqlOrigins>): boolean {
    return mysqlOriginsOwner.current === view.source && queryOwnerCurrent() && !busyRef.current &&
      sessionRef.current === view.sessionId && task.current === view.executionId;
  }
  const sqliteReceipt = sqlite && !pin && !queryRunning ? outcome?.sqliteResultReceipts?.[resultIndex] : undefined;
  const resultSqlPreview = showPinSql && sourceResult === showPinSql.result && showPinSql.taskId === task.current
    && showPinSql.connectionVersion === connectionVersion && showPinSql.pinId === selectedPin && showPinSql.resultIndex === resultIndex
    && settings.activeTabId === tab.id && !busy && !closeRequest ? showPinSql : null;
  useEffect(() => {
    if (showPinSql && !resultSqlPreview) setShowPinSql(current => current === showPinSql ? null : current);
  }, [showPinSql, resultSqlPreview]);
  snapshotValues.current = [tab, connection, connectionVersion, outcome, pins, selectedPin, resultIndex, sourceResult, task.current, sessionRef.current, closeRequest]; snapshotView.current = { result: queryRunning ? undefined : sourceResult, pins };
  /** 文件能力只绑定本轮查询页与已返回来源，不要求连接存在，不触发建连或读取数据库。 */
  function beginResultSnapshot(mode: 'open' | 'save', shown = false): QueryResultSnapshotOperation {
    const state = useWorkspace.getState(), originalTab = state.settings.tabs.find(item => item.id === tab.id), profile = state.connections.find(item => item.id === tab.connectionId), view = snapshotView.current, values = [...snapshotValues.current];
    if (!alive.current || snapshotOperation.current || busyRef.current || pendingSession.current || closeRequestRef.current || formatting.current || fileSource.isBusy() || state.activeJobs[tab.id] || originalTab?.kind !== 'query' || originalTab !== tab || state.settings.activeTabId !== tab.id || document.querySelector(appDialogSelector)) throw Error(queryResultSnapshotUiZh.unavailable);
    if (mode === 'save' && !view.result?.columns.length) throw Error(zh.query.pinRequiresRows);
    if (mode === 'open' && view.pins.length >= pinLimits.count) throw Error(zh.query.pinCountLimit);
    if (shown && (!view.result || !result || !resultViewCurrent(result) || !visibleColumns.length)) throw Error(queryResultSnapshotUiZh.stale);
    const name = pinnedResultSnapshotName(pin);
    const snapshot = shown && view.result && result ? createDisplayedQueryResultSnapshot(view.result, result, visibleColumns, name) : undefined;
    const version = state.connectionVersions[tab.connectionId] ?? 0;
    let operation: SnapshotOperation;
    const intent = new QueryResultSnapshotIntent(values, () => {
      const now = useWorkspace.getState();
      return alive.current && snapshotOperation.current === operation && now.settings.activeTabId === tab.id && now.settings.tabs.find(item => item.id === tab.id) === originalTab && now.connections.find(item => item.id === tab.connectionId) === profile && (now.connectionVersions[tab.connectionId] ?? 0) === version && !closeRequestRef.current && !pendingSession.current && !formatting.current && !fileSource.isBusy() && (operation.acquiring || !!operation.job?.owns()) && values.length === snapshotValues.current.length && values.every((value, index) => Object.is(value, snapshotValues.current[index]));
    });
    operation = { intent, acquiring: true }; snapshotOperation.current = operation;
    try { operation.job = acquireWorkspaceBusy(tab.id); busyRef.current = true; setBusy(true); }
    catch (reason) { snapshotOperation.current = null; intent.invalidate(); throw reason; }
    finally { operation.acquiring = false; }
    let finished = false;
    return {
      result: view.result, name, snapshot,
      current: () => intent.current(), invalidate: () => intent.invalidate(),
      /** 解析和容量检查全部完成后一次追加固定结果，原结果/SQL/事务都保留。 */
      adopt(snapshot, name) {
        if (!intent.current() || snapshotView.current.pins !== view.pins) throw Error(queryResultSnapshotUiZh.stale);
        if (snapshot.version === 3) throw Error(queryResultSnapshotUiZh.postgresTabRequired);
        const next = snapshotQueryResult(view.pins, snapshot.result, uid(), snapshot.name || name || formatText(zh.query.pinLabel, pinSequence.current + 1));
        intent.consume(); invalidateResultSelection(); pinSequence.current++; setPins([...view.pins, next]); setSelectedPin(next.id); setShowPinSql(null); setError('');
      },
      uncertain: message => useWorkspace.getState().notify(message, true),
      reportError: message => useWorkspace.getState().notify(message, true),
      /** 原IO及Maincleanup真实结束才释放；旧finally不修改后来owner的busy或界面。 */
      finish() {
        if (finished) return; finished = true; intent.invalidate();
        if (snapshotOperation.current === operation) {
          snapshotOperation.current = null;
          if (operation.job?.owns() || !useWorkspace.getState().activeJobs[tab.id]) { snapshotAwaitingBusyRelease.current = false; busyRef.current = false; if (alive.current) setBusy(false); }
          else snapshotAwaitingBusyRelease.current = true;
        }
        operation.job?.release();
      },
    };
  }
  const sourceExportable = !pin && outcome?.sqliteExplain ? undefined : exportableQueryResult(busy, outcome, resultIndex, pin?.result);
  // 结果快照的寿命独立于模态/保存锁；只有新查询才撤销数据来源，操作权限仍走原忙态守卫。
  const viewSource = !pin && outcome?.sqliteExplain ? undefined : exportableQueryResult(queryRunning, outcome, resultIndex, pin?.result);
  const resultContext=[outcome,resultIndex,selectedPin,task.current,connectionVersion,tab.connectionId];
  const layoutMatches=!!columnLayout&&columnLayout.result===sourceResult&&columnLayout.context.length===resultContext.length&&columnLayout.context.every((value,index)=>Object.is(value,resultContext[index]));
  const shownColumns=useRef<ResultColumn[]>([]);
  const visibleColumns=useMemo(()=>{
    let next=sourceResult?.columns??[];
    if(sourceResult&&layoutMatches&&columnLayout)try{next=queryResultVisibleColumns(sourceResult.columns,columnLayout.layout);}catch{/* 元数据变化后回到原列，不能继续沿用旧布局。 */}
    // 只改变冻结边界或宽度时复用可见列身份，避免误撤销筛选或排序。
    if(shownColumns.current.length===next.length&&shownColumns.current.every((column,index)=>column===next[index]))return shownColumns.current;
    shownColumns.current=next;return next;
  },[sourceResult,columnLayout,layoutMatches]);
  const frozenKeys=useMemo(()=>sourceResult&&layoutMatches&&columnLayout?frozenQueryResultKeys(sourceResult.columns,columnLayout.layout):[],[sourceResult,columnLayout,layoutMatches]);
  const resultColumnWidths = layoutMatches ? columnLayout?.layout.widths : undefined;
  const resultModal=!!objectDefinition||!!warningsDialog||!!comparisonLease||!!statisticsLease||!!presetLease||!!closeRequest||!!exportResult||!!archiveOutcome||!!activeOrigins||!!activeMysqlOrigins||!!recordEdit||!!recordRelation||!!mysqlRelation||!!mysqlBatch||!!queryRowSql||save||!!resultSqlPreview||!!snippets||parameterSource!==null||streamExportSource!==null||!!sqliteFullExport||sessionObjects||recovery||!!databaseSwitchDialog;
  const failureLocator = failureSource.current;
  // SQLite筛选明确选择原存储类，先筛选再排序；所有消费者共用同一最终视图与租约。
  const filterBinding=resultFilter.bind(viewSource,resultContext,visibleColumns);
  const filterView=resultFilter.view(filterBinding);
  const sortBinding = resultSorter.bind(filterView?.result ?? viewSource, resultContext, visibleColumns);
  const sortView = resultSorter.view(sortBinding);
  const historyBinding = resultHistory.bind(viewSource, visibleColumns, resultContext, filterView && sortView ? { expression: filterView.expression, sort: sortView.rules } : undefined, filterBinding);
  const displayedView=useMemo(()=>queryResultFilteredSortView(filterView,sortView),[filterView,sortView]);
  const organizedResult = displayedView?.result ?? sourceResult;
  const keywordFilter = useQueryResultKeyword(filterBinding?.source, visibleColumns, resultContext, organizedResult);
  const matchView = useQueryResultMatchView(keywordFilter.result, visibleColumns, resultContext);
  const result = matchView.result;
  const exportable = sourceExportable ? result : undefined;
  const activeFilterLease=filterLease&&filterLeaseRef.current===filterLease&&resultFilter.view(filterLease.binding)===filterLease.view&&resultSorter.view(filterLease.sortBinding)===filterLease.sortView?filterLease:null;
  if(filterLease&&!activeFilterLease&&filterLeaseRef.current===filterLease)filterLeaseRef.current=null;
  const activeSortLease = sortLease && sortLeaseRef.current === sortLease && resultSorter.view(sortLease.binding) === sortLease.view && resultFilter.view(sortLease.filterBinding) === sortLease.filterView ? sortLease : null;
  if (sortLease && !activeSortLease && sortLeaseRef.current === sortLease) sortLeaseRef.current = null;
  const activePresetLease=presetLease&&presetLeaseRef.current===presetLease&&resultFilter.view(presetLease.filterBinding)===presetLease.filterView&&resultSorter.view(presetLease.binding)===presetLease.view?presetLease:null;
  useEffect(()=>{if(presetLease&&!activePresetLease){if(presetLeaseRef.current===presetLease)presetLeaseRef.current=null;setPresetLease(null);}},[presetLease,activePresetLease]);
  // 父渲染仅核一次完整视图；对话框的分批计数不在每批重复遍历原结果。
  const activeStatisticsLease=statisticsLease&&statisticsLeaseRef.current===statisticsLease&&resultFilter===statisticsLease.filter&&resultSorter===statisticsLease.sorter&&resultFilter.view(statisticsLease.filterBinding)===statisticsLease.filterView&&resultSorter.view(statisticsLease.binding)===statisticsLease.view?statisticsLease:null;
  if(statisticsLease&&!activeStatisticsLease&&statisticsLeaseRef.current===statisticsLease)statisticsLeaseRef.current=null;
  useEffect(()=>{if(statisticsLease&&!activeStatisticsLease)setStatisticsLease(null);},[statisticsLease,activeStatisticsLease]);
  const selectionBinding = resultSelection.bind(settings.activeTabId === tab.id&&!resultModal ? exportable : undefined, resultContext, visibleColumns);
  // 本用途的自有模态不撤销选择绑定；原结果/视图/列/上下文仍随每次渲染同步核验。
  const resultInsertView = useRef({ result: exportable, columns: visibleColumns, context: resultContext, binding: selectionBinding }); resultInsertView.current = { result: exportable, columns: visibleColumns, context: resultContext, binding: selectionBinding };
  // 详情绑定当前行视图的完整原列；排序只改行序，不把visibleColumns当成全部返回字段。
  const detailBinding = rowDetails.bind(settings.activeTabId === tab.id && !resultModal ? exportable : undefined, [tab.id, ...resultContext]);
  const currentRowDetail = rowDetail && rowDetails.valid(rowDetail) ? rowDetail : null;
  /** 排序预算只禁排序；未取得排序租约时仍核准确原结果，原能力另核各自租约和预算。 */
  function resultViewCurrent(expected: QueryResult | undefined): boolean {
    if(filterBinding&&!resultFilter.view(filterBinding))return false;
    const current = sortBinding ? resultSorter.view(sortBinding)?.result : filterView?.result ?? sourceExportable;
    return !!expected && current === organizedResult && expected === result;
  }
  /** 直接读原工作区防止标签/连接/忙态ABA；内联region不放宽已有modal保护。 */
  function rowDetailAllowed(binding: QueryRowDetailsBinding | undefined): boolean {
    const workspace = useWorkspace.getState(), current = workspace.settings.tabs.find(item => item.id === tab.id);
    return alive.current && !busyRef.current && !workspace.activeJobs[tab.id] && workspace.settings.activeTabId === tab.id && current?.kind === 'query' && current.connectionId === tab.connectionId && (workspace.connectionVersions[current.connectionId] ?? 0) === connectionVersion && !filterLeaseRef.current && !sortLeaseRef.current && !document.querySelector(appDialogSelector) && resultViewCurrent(binding?.result) && rowDetails.current(binding);
  }
  /** 活动位置独立于勾选；RDG的视图rowIdx只用于同一视图binding，不索引原source.rows。 */
  function selectActiveDetailRow(index: number | null): void {
    if (!rowDetailAllowed(detailBinding) || !detailBinding) return;
    if (index === null) { setActiveDetailRow(null); return; }
    if (!Number.isSafeInteger(index) || index < 0 || index >= detailBinding.rows.length) return;
    setActiveDetailRow(old => old && old.binding === detailBinding && old.index === index ? old : { binding: detailBinding, index });
  }
  const recordTable = sqlite && !pin && !transaction && transactionKnown && !queryRunning && !busy &&
    retiredRecordTask.current !== task.current ? outcome?.sqliteQueryRecordTable : undefined;
  const recordEditTable = connection?.dialect === 'sqlite' && !connection.sqlite.readOnly ? recordTable : undefined;
  const relationResult = useRef(sourceResult);
  relationResult.current = sourceResult;

  /** 已排序或筛选的行用对象身份回到 Main 持有的原执行，显示值不作为外键参数。 */
  function openQueryRelation(): void {
    if (!recordTable || !sourceResult || !sessionRef.current || activeDetailRow?.binding !== detailBinding ||
        !activeDetailRow || !queryOwnerCurrent() || !rowDetailAllowed(detailBinding)) return;
    const rowIndex = sourceResult.rows.indexOf(activeDetailRow.binding.rows[activeDetailRow.index]);
    if (rowIndex < 0) return;
    const job = acquireWorkspaceBusy(tab.id);
    setRecordRelation({ result: sourceResult, job, request: { connectionId: tab.connectionId, database: 'main', table: recordTable,
      taskId: uid(), offset: 0, limit: 1, mode: 'and', filters: [], sort: [],
      queryRecord: { sessionId: sessionRef.current, taskId: task.current, rowIndex } } });
  }

  function queryRelationCurrent(view: NonNullable<typeof recordRelation>): boolean {
    const source = view.request.queryRecord;
    return view.job.owns() && queryOwnerCurrent() && relationResult.current === view.result &&
      sessionRef.current === source.sessionId && task.current === source.taskId;
  }

  function closeQueryRelation(view: NonNullable<typeof recordRelation>): void {
    view.job.release();
    setRecordRelation(current => current === view ? undefined : current);
  }

  const querySourceAvailable = !pin && !transaction && transactionKnown && !queryRunning && !busy && retiredRecordTask.current !== task.current;
  const sqliteInsertTable = sqlite && querySourceAvailable && connection?.dialect === 'sqlite' && !connection.sqlite.readOnly
    ? outcome?.sqliteQueryInsertTable : undefined;
  const mysqlRelationAvailable = querySourceAvailable && outcome?.mysqlQueryRelation === true;
  const mysqlInsertAvailable = querySourceAvailable && outcome?.mysqlQueryInsert === true;
  const mysqlJoinColumns = outcome?.mysqlQueryJoinColumns;
  const mysqlComputedColumns = outcome?.mysqlQueryComputedColumns;
  const canPrepareQueryRowSql = (mysqlRelationAvailable || mysqlInsertAvailable ||
    sqlite && querySourceAvailable && outcome?.sqliteQueryRowSql === true) && !!sourceResult?.rows.length && !sourceResult.truncated;
  const queryRowSqlCount = resultSelection.count(selectionBinding);
  function closeQueryRowSql(view: NonNullable<typeof queryRowSql>): void {
    view.job.release();
    setQueryRowSql(current => current === view ? undefined : current);
  }
  function queryRowSqlCurrent(view: NonNullable<typeof queryRowSql>): boolean {
    return view.job.owns() && queryOwnerCurrent() && relationResult.current === view.result &&
      sessionRef.current === view.request.sessionId && task.current === view.request.executionId;
  }
  useEffect(() => { if (queryRowSql && !queryRowSqlCurrent(queryRowSql)) closeQueryRowSql(queryRowSql); });
  /** 勾选优先。显示排序后的行对象映射回原执行的序号，不接收网格显示值。 */
  function openQueryRowSql(): void {
    if (!canPrepareQueryRowSql || !sourceResult || !selectionBinding || !sessionRef.current ||
        !resultSelectionAllowed(selectionBinding) || !queryMenuCurrent()) return;
    const checked = resultSelection.checkedIndices(selectionBinding);
    const positions = checked.length ? checked : activeDetailRow && activeDetailRow.binding === detailBinding &&
      rowDetailAllowed(detailBinding) ? [activeDetailRow.index] : [];
    if (!positions.length || positions.length > copyInsertSqlLimits.rows) return;
    const rowIndices = positions.map(position => sourceResult.rows.indexOf(selectionBinding.rows[position]));
    if (rowIndices.some(index => index < 0) || new Set(rowIndices).size !== rowIndices.length) return;
    setQueryRowSql({ result: sourceResult, job: acquireWorkspaceBusy(tab.id), keyed: sqlite ? !!recordTable : mysqlRelationAvailable,
      request: { connectionId: tab.connectionId, sessionId: sessionRef.current, executionId: task.current, rowIndices } });
  }
  const [replaceView, setReplaceView] = useState<{ binding: ResultSelectionBinding; sessionId: string; executionId: string;
    lookup?: MysqlQueryReplaceColumnsInput; panel: PostgresFindRequest; fields?: ReadonlyMap<string, string> }>();
  const sqliteReplaceColumns = recordEditTable && sourceResult?.sqliteStorage ? outcome?.sqliteQueryReplaceColumns : undefined;
  const canReplaceResult = (mysqlRelationAvailable || !!sqliteReplaceColumns?.length) && !sourceResult?.truncated &&
    !!selectionBinding?.rows.length && !!visibleColumns.length;
  const activeReplace = canReplaceResult && replaceView?.binding === selectionBinding ? replaceView : undefined;
  const replaceLookup = activeReplace?.lookup && !activeReplace.fields ? activeReplace : undefined;
  const replaceRows = useMemo(() => activeReplace?.fields ? activeReplace.binding.rows.map((data, index) =>
    ({ id: String(index), data, inserted: false, deleted: false })) : [], [activeReplace]);
  const sqliteReplaceRows = useMemo(() => activeReplace?.fields && !activeReplace.lookup
    ? sqliteQueryReplacementRows(activeReplace.binding.result, activeReplace.fields) : undefined, [activeReplace]);
  const replaceWritable = useCallback((column: ResultColumn) => activeReplace?.fields?.has(column.key) === true, [activeReplace]);
  const closeResultReplace = () => setReplaceView(undefined);
  function resultReplaceCurrent(view = activeReplace): boolean {
    return !!view && sessionRef.current === view.sessionId && task.current === view.executionId &&
      resultSelectionAllowed(view.binding) && queryMenuCurrent();
  }
  function openResultReplace(): boolean {
    if (!canReplaceResult || !selectionBinding || !sourceResult || !sessionRef.current ||
        !resultSelectionAllowed(selectionBinding) || !queryMenuCurrent()) return false;
    if (activeReplace) { focusQueryResultReplacement(layoutRoot.current); return true; }
    setError('');
    const owner = { binding: selectionBinding, panel: { replace: true }, sessionId: sessionRef.current, executionId: task.current };
    if (sqliteReplaceColumns) {
      const keys = new Set(selectionBinding.visibleColumns.map(column => column.key));
      const fields = new Map(sqliteReplaceColumns.flatMap(index => {
        const column = sourceResult.columns[index], origin = resultOrigins?.[index];
        return column && keys.has(column.key) && origin?.database === 'main' && origin.table === recordEditTable
          ? [[column.key, origin.column] as const] : [];
      }));
      if (!fields.size) { setError(originsText.replaceUnavailable); return false; }
      setReplaceView({ ...owner, fields });
    } else setReplaceView({ ...owner,
      lookup: { connectionId: tab.connectionId, sessionId: owner.sessionId, executionId: owner.executionId, taskId: uid() } });
    return true;
  }
  useEffect(() => {
    const lookup = replaceLookup?.lookup;
    if (!replaceLookup || !lookup) return;
    let active = true, reading = false;
    void (async () => {
      try {
        await Promise.resolve();
        if (!active) return;
        reading = true;
        const columns = await invoke('mysql.queryReplaceColumns', lookup);
        reading = false;
        if (!active || !resultReplaceCurrent(replaceLookup)) return;
        const keys = new Set(replaceLookup.binding.visibleColumns.map(column => column.key));
        const fields = new Map(columns.flatMap(({ index, field }) => {
          const key = sourceResult?.columns[index]?.key;
          return key !== undefined && keys.has(key) ? [[key, field] as const] : [];
        }));
        if (!fields.size) throw Error(mysqlBatchText.replaceUnavailable);
        setReplaceView(view => view === replaceLookup ? { ...view, fields } : view);
      } catch (reason) {
        if (active && resultReplaceCurrent(replaceLookup)) {
          setError(errorMessage(reason));
          setReplaceView(view => view === replaceLookup ? undefined : view);
        }
      } finally {
        if (active) setReplaceView(view => view === replaceLookup ? undefined : view);
        reading = false;
      }
    })();
    return () => {
      active = false;
      if (reading) void invoke('query.cancel', { taskId: lookup.taskId }).catch(() => undefined);
    };
  }, [replaceLookup]);
  function previewResultReplace(patches: readonly PageTextPatch[]) {
    if (!activeReplace?.fields || !resultReplaceCurrent()) throw Error(sqlite ? originsText.editStale : mysqlBatchText.stale);
    const { binding, fields } = activeReplace;
    return sqliteReplaceRows ? { kind: 'sqlite' as const, ...planSqliteQueryReplace(sqliteReplaceRows, binding.visibleColumns, fields, patches) }
      : { kind: 'mysql' as const, ...planMysqlQueryReplace(binding.rows, binding.visibleColumns, fields, patches) };
  }
  function stageResultReplace(owner: object, plan: ReturnType<typeof previewResultReplace>): void {
    if (!activeReplace || owner !== activeReplace.binding || !resultReplaceCurrent()) throw Error(sqlite ? originsText.editStale : mysqlBatchText.stale);
    if (plan.kind === 'sqlite') {
      if (!startQueryRecords(plan.positions.map(index => activeReplace.binding.rows[index]), { rangeReplace: plan }))
        throw Error(originsText.editStale);
    } else startMysqlQueryBatch(plan.positions, { kind: 'replace', patches: plan.changes }, plan.keys);
    closeResultReplace();
  }
  /** 查询排序只改变视图次序，回查使用原执行中准确的行对象。 */
  function openMysqlRelation(direction: 'parent' | 'children' | 'edit'): void {
    if (!activeDetailRow || activeDetailRow.binding !== detailBinding) return;
    startMysqlQueryRecord(direction, activeDetailRow.binding.rows[activeDetailRow.index]);
  }

  function startMysqlQueryRecord(direction: 'parent' | 'children' | 'edit', row: DataRow, cell?: NonNullable<typeof mysqlRelation>['cell']): boolean {
    if (!mysqlRelationAvailable || !sourceResult || !sessionRef.current || !queryOwnerCurrent() || !rowDetailAllowed(detailBinding)) return false;
    const rowIndex = sourceResult.rows.indexOf(row);
    if (rowIndex < 0) return false;
    const job = acquireWorkspaceBusy(tab.id);
    setMysqlRelation({ result: sourceResult, direction, job, cell, request: { connectionId: tab.connectionId, sessionId: sessionRef.current,
      executionId: task.current, rowIndex, taskId: uid(), ...(cell ? { columnIndex: cell.columnIndex } : {}) } });
    return true;
  }

  function mysqlRecordCurrent(view: Pick<NonNullable<typeof mysqlRelation>, 'result' | 'job' | 'request'> | NonNullable<typeof mysqlBatch>): boolean {
    return view.job.owns() && queryOwnerCurrent() && relationResult.current === view.result &&
      sessionRef.current === view.request.sessionId && task.current === view.request.executionId;
  }

  function closeMysqlRecord(view: NonNullable<typeof mysqlRelation>, committed = false): void {
    if (view.cell && mysqlRecordCurrent(view)) setRestoreEditedCell({ row: view.cell.row, key: view.cell.key });
    if (committed) retiredRecordTask.current = view.request.executionId;
    view.job.release();
    setMysqlRelation(current => current === view ? undefined : current);
  }

  /** 显示顺序只决定预览坐标，提交用原执行的行列序号和独立读回的完整记录。 */
  function startMysqlQueryBatch(displayIndices: number[], operation: MysqlQueryBatchInput, keys: readonly string[] = []): void {
    if (!mysqlRelationAvailable || !result || !sourceResult || !sessionRef.current || !queryOwnerCurrent() || !resultSelectionAllowed(selectionBinding))
      throw Error(mysqlBatchText.stale);
    if (!displayIndices.length || displayIndices.length > mysqlQueryBatchLimits.rows ||
        (operation.kind === 'fill' || operation.kind === 'paste' || operation.kind === 'replace') &&
          (!keys.length || displayIndices.length * keys.length > mysqlQueryBatchLimits.cells))
      throw Error(gridRangeFillZh.limit);
    const rowIndices = displayIndices.map(index => sourceResult.rows.indexOf(result.rows[index]));
    const columnIndices = keys.map(key => sourceResult.columns.findIndex(column => column.key === key));
    if (rowIndices.some(index => index < 0) || columnIndices.some(index => index < 0)) throw Error(mysqlBatchText.stale);
    if (mysqlComputedColumns && columnIndices.some(index => mysqlComputedColumns.includes(index))) throw Error(mysqlEditText.computedReadOnly);
    if (mysqlJoinColumns && columnIndices.some(index => !mysqlJoinColumns.includes(index))) throw Error(mysqlEditText.joinReadOnly);
    const job = acquireWorkspaceBusy(tab.id);
    const owner = { connectionId: tab.connectionId, sessionId: sessionRef.current, executionId: task.current, taskId: uid(), rowIndices };
    const key = keys[0] ?? visibleColumns[0]?.key;
    setMysqlBatch({ request: operation.kind === 'delete' || operation.kind === 'insert' ? { ...owner, operation: operation.kind } : { ...owner, columnIndices },
      operation, job, result: sourceResult, displayRows: displayIndices.map(index => index + 1),
      anchor: key ? { row: result.rows[displayIndices[0]], key } : undefined });
    setError('');
  }

  function openMysqlQueryBatch(range: GridRangeTarget<DataRow>, operation: Extract<MysqlQueryBatchInput, { kind: 'fill' | 'paste' }>): void {
    if (!result || range.rows.some((row, index) => result.rows[range.startRow + index] !== row)) throw Error(mysqlBatchText.stale);
    startMysqlQueryBatch(range.rows.map((_, index) => range.startRow + index), operation, range.keys);
  }

  function openMysqlCheckedRecords(kind: 'delete' | 'insert'): void {
    const indices = resultSelection.checkedIndices(selectionBinding);
    if (!indices.length || indices.length > mysqlQueryBatchLimits.rows) return;
    try { startMysqlQueryBatch(indices, { kind }); }
    catch (reason) { setError(errorMessage(reason)); }
  }

  /** 新增只绑定原执行的来源表，空结果也能打开独立草稿。 */
  function openMysqlNewRecord(): void {
    if (!mysqlInsertAvailable || !sourceResult || !sessionRef.current || resultModal || !queryMenuCurrent()) return;
    try {
      const job = acquireWorkspaceBusy(tab.id);
      setMysqlBatch({ request: { connectionId: tab.connectionId, sessionId: sessionRef.current, executionId: task.current,
        taskId: uid(), operation: 'new' }, operation: { kind: 'new' }, result: sourceResult, job, displayRows: [1] });
      setError('');
    } catch (reason) { setError(errorMessage(reason)); }
  }

  function closeMysqlBatch(view: NonNullable<typeof mysqlBatch>, committed: boolean): void {
    if (mysqlRecordCurrent(view)) setRestoreEditedCell(view.anchor);
    if (committed) retiredRecordTask.current = view.request.executionId;
    view.job.release();
    setMysqlBatch(current => current === view ? undefined : current);
  }
  /** 新增只消费本次查询的来源表能力，空结果也能打开独立草稿。 */
  function openSqliteNewRecord(): void {
    if (!sqliteInsertTable || !sourceResult || !sessionRef.current || !queryMenuCurrent() || !rowDetailAllowed(detailBinding)) return;
    const job = acquireWorkspaceBusy(tab.id);
    setRecordEdit({ table: sqliteInsertTable, job, source: { sessionId: sessionRef.current, taskId: task.current, operation: 'insert' } });
  }

  function startQueryRecords(rows: readonly DataRow[], { cell, rangeFill, rangePaste, deletePositions, duplicatePositions, rangeReplace }: {
    cell?: SqliteQueryInlineCell & { key: string; row: DataRow };
    rangeFill?: SqliteQueryRangeFill;
    rangePaste?: SqliteQueryRangePaste;
    deletePositions?: readonly number[];
    duplicatePositions?: readonly number[];
    rangeReplace?: SqliteQueryReplacePlan;
  } = {}): boolean {
    if (!recordEditTable || !sourceResult || !sessionRef.current || !queryOwnerCurrent() || !rowDetailAllowed(detailBinding)) return false;
    // 本地筛选和排序保留原行对象，网格索引不能直接用于主进程原结果。
    const rowIndices = rows.map(row => sourceResult.rows.indexOf(row));
    if (!rowIndices.length || rowIndices.some(index => index < 0) || new Set(rowIndices).size !== rowIndices.length) return false;
    const identity = { sessionId: sessionRef.current, taskId: task.current };
    const source: SqliteQueryRecordInput = duplicatePositions ? { ...identity, rowIndices, operation: 'duplicate' }
      : rangeFill || rangePaste || deletePositions || rangeReplace ? { ...identity, rowIndices } : { ...identity, rowIndex: rowIndices[0] };
    const job = acquireWorkspaceBusy(tab.id);
    setRecordEdit({ table: recordEditTable, job, source, cell, rangeFill, rangePaste, deletePositions, duplicatePositions, rangeReplace });
    return true;
  }
  /** 显示行号仅供审阅。提交读取当前勾选对应的原行对象和独立快照。 */
  function openSqliteCheckedRecords(operation: 'delete' | 'duplicate'): void {
    if (!selectionBinding || !resultSelectionAllowed(selectionBinding) || !queryMenuCurrent()) return;
    if (operation === 'duplicate' && sourceResult?.truncated) return;
    const indices = resultSelection.checkedIndices(selectionBinding);
    if (!indices.length || indices.length > sqliteQueryEditMaxRows) return;
    const positions = indices.map(index => index + 1);
    if (!startQueryRecords(indices.map(index => selectionBinding.rows[index]), operation === 'delete'
      ? { deletePositions: positions } : { duplicatePositions: positions }))
      setError(originsText.editStale);
  }
  /** 只接纳当前显示范围，字段按原投影位置解析；显示别名不作为列身份。 */
  function queryRangeColumns(range: GridRangeTarget<DataRow>): string[] {
    if (!result || !sourceResult || !resultOrigins || !resultSelectionAllowed(selectionBinding) ||
        range.rows.some((row, i) => result.rows[range.startRow + i] !== row)) throw Error(gridRangeFillZh.stale);
    if (!range.keys.length || !range.rows.length || range.rows.length > sqliteQueryEditMaxRows || range.rows.length * range.keys.length > sqliteTableEditLimits.cells)
      throw Error(gridRangeFillZh.limit);
    return range.keys.map(key => {
      const index = sourceResult.columns.findIndex(column => column.key === key), origin = resultOrigins[index];
      if (outcome?.sqliteQueryComputedColumns?.includes(index)) throw Error(originsText.computedReadOnly);
      if (outcome?.sqliteQueryJoined && origin && origin.table !== recordEditTable) throw Error(originsText.joinReadOnly);
      if (!origin || origin.database !== 'main' || origin.table !== recordEditTable) throw Error(gridRangeFillZh.target);
      return origin.column;
    });
  }
  function fillQueryRange(range: GridRangeTarget<DataRow>, input: GridRangeFillInput): void {
    if (mysqlRelationAvailable) { openMysqlQueryBatch(range, { kind: 'fill', input }); return; }
    const columns = queryRangeColumns(range);
    if (!startQueryRecords(range.rows, { rangeFill: { columns, input } })) throw Error(gridRangeFillZh.stale);
  }
  function pasteQueryRange(cell: QueryResultCopyCell, data: Pick<DataTransfer, 'types' | 'getData'>, selected?: GridRangeTarget<DataRow>): void {
    try {
      if (!result || !cell.column || result.rows[cell.index] !== cell.row || !resultSelectionAllowed(selectionBinding)) throw Error(sqlitePasteText.stale);
      if (mysqlRelationAvailable) {
        const matrix = mysqlQueryPasteMatrix(data, selected ? { rows: selected.rows.length, columns: selected.keys.length } : undefined);
        const column = visibleColumns.indexOf(cell.column), width = matrix[0].length;
        if (column < 0 || !selected && (cell.index + matrix.length > result.rows.length || column + width > visibleColumns.length))
          throw Error(gridRangeFillZh.target);
        const range = selected ?? { startRow: cell.index, rows: result.rows.slice(cell.index, cell.index + matrix.length),
          keys: visibleColumns.slice(column, column + width).map(item => item.key) };
        openMysqlQueryBatch(range, { kind: 'paste', matrix });
        return;
      }
      // 同步消费原生粘贴事件。单格锚点从矩阵确定范围，已有选区保持其左上角和尺寸。
      const source = readSqliteClipboard(data), width = source.values[0].length;
      const shape = selected ? { rows: selected.rows.length, columns: selected.keys.length } : { rows: source.values.length, columns: width };
      fitGridRangePaste(source.values, shape, { rows: sqliteQueryEditMaxRows, cells: sqliteTableEditLimits.cells });
      const column = visibleColumns.indexOf(cell.column);
      if (column < 0 || !selected && (cell.index + shape.rows > result.rows.length || column + shape.columns > visibleColumns.length))
        throw Error(sqlitePasteText.outOfBounds);
      const range = selected ?? {
        startRow: cell.index,
        rows: result.rows.slice(cell.index, cell.index + shape.rows),
        keys: visibleColumns.slice(column, column + shape.columns).map(item => item.key),
      };
      const columns = queryRangeColumns(range);
      if (new Set(columns).size !== columns.length) throw Error(originsText.pasteDuplicateColumn);
      const firstColumn = visibleColumns.findIndex(item => item.key === range.keys[0]);
      if (firstColumn < 0) throw Error(sqlitePasteText.stale);
      const position = { row: range.startRow + 1, column: firstColumn + 1 };
      if (!startQueryRecords(range.rows, { rangePaste: { columns, shape, position, source } })) throw Error(sqlitePasteText.stale);
      setError('');
    } catch (reason) {
      // 拒绝信息归当前查询。后续合法粘贴清除它，不把错误提示覆盖到确认窗口上。
      setError(errorMessage(reason));
    }
  }
  function openQueryRecord(): void {
    if (activeDetailRow && activeDetailRow.binding === detailBinding)
      startQueryRecords([activeDetailRow.binding.rows[activeDetailRow.index]]);
  }
  function editQueryCell(cell: QueryResultCopyCell, anchor: HTMLElement, typed?: string): boolean {
    if (!cell.column || result?.rows[cell.index] !== cell.row || !sourceResult) return false;
    // 二进制双击沿用完整值查看器，编辑二进制仍可从原记录表单进入。
    if (mysqlRelationAvailable && isResultBinaryCell(ownCell(cell.row, cell.column.key))) return false;
    const index = sourceResult.columns.indexOf(cell.column);
    const position = captureQueryInlineCellAnchor(anchor);
    if (index < 0 || !position) return false;
    const target = { ...position, label: cell.column.name, typed, key: cell.column.key, row: cell.row };
    if (mysqlRelationAvailable) return !mysqlComputedColumns?.includes(index) && mysqlJoinColumns?.includes(index) !== false &&
      startMysqlQueryRecord('edit', cell.row, { ...target, columnIndex: index });
    const origin = resultOrigins?.[index];
    if (outcome?.sqliteQueryComputedColumns?.includes(index) || !origin || origin.database !== 'main' || origin.table !== recordEditTable) return false;
    return startQueryRecords([cell.row], { cell: { ...target, column: origin.column } });
  }
  function openRowDetail(): void {
    if (!activeDetailRow || activeDetailRow.binding !== detailBinding || !rowDetailAllowed(detailBinding)) return;
    try { setRowDetail(rowDetails.open(detailBinding, activeDetailRow.index)); } catch { setError(rowDetailsText.invalid); }
  }
  /** 旧侧栏的翻行/关闭回调不能作用于下一原行视图。 */
  function moveRowDetail(view: QueryRowDetailsView, index: number): void {
    if (!rowDetailAllowed(view.binding) || !rowDetails.valid(view)) return;
    try { setRowDetail(rowDetails.move(view, index)); } catch { setError(rowDetailsText.invalid); }
  }
  function closeRowDetail(view: QueryRowDetailsView): void { if (rowDetailAllowed(view.binding) && rowDetails.close(view)) setRowDetail(null); }
  /** 面板独立草稿租约；同步核源、工作区和模态，取消/切换后旧应用不可重放。 */
  function filterPanelCurrent(lease:FilterLease):boolean{
    return filterLeaseRef.current === lease && filterContextCurrent(lease);
  }
  /** 草稿首次显示及提交前均核对当前结果、排序和工作区。 */
  function filterContextCurrent(lease: FilterLease): boolean {
    if(sortLeaseRef.current||resultFilterRef.current.view(lease.binding)!==lease.view||resultSorterRef.current.view(lease.sortBinding)!==lease.sortView)return false;
    const workspace=useWorkspace.getState(),current=workspace.settings.tabs.find(item=>item.id===tab.id);
    return alive.current&&!busyRef.current&&!workspace.activeJobs[tab.id]&&workspace.settings.activeTabId===tab.id&&current?.kind==='query'&&current.connectionId===tab.connectionId&&(workspace.connectionVersions[current.connectionId]??0)===connectionVersion&&!columnLeaseRef.current&&!document.querySelector(appDialogSelector);
  }
  /** 打开只撤销旧选择；取消不修改过滤、排序和原SQL。 */
  function openFilterPanel():void{showFilterPanel();}
  /** 已生效view仍作租约依据；快捷条件只改变独立初始草稿，不冒充已应用视图。 */
  function showFilterPanel(seed?:QueryResultFilterGroup):void{
    if(!filterBinding||!filterView||!sortBinding||!sortView||!resultSelectionAllowed(selectionBinding))return;
    beginFilterDraft({binding:filterBinding,view:filterView,sortBinding,sortView,seed});
  }
  /** 撤销结果选择并发布新筛选草稿。 */
  function beginFilterDraft(lease: FilterLease): void {
    invalidateResultSelection();
    filterLeaseRef.current = lease;
    setFilterLease(lease);
    refreshResultSelection(value => value + 1);
  }
  /** 原显示位置对应原行及可见唯一键，追加AND保留旧OR括号；结构超限时完整保留原视图。 */
  function openCellFilter(cell:QueryResultCopyCell,operator:CellFilterOperator):void{
    if(!filterBinding||!filterView||!result||!resultSelectionAllowed(selectionBinding))return;
    try{const capture=captureQueryResultCellFilter(visibleColumns,result.rows,cell,result);openFilterRule(queryResultCellFilterNode(capture,operator));}catch(reason){setError(errorMessage(reason));}
  }
  /** 单格和单列查找共享草稿入口，保留当前已应用的分组与排序。 */
  function openFilterRule(node: QueryResultFilterRule | QueryResultFilterGroup): void {
    if (!filterView || !resultSelectionAllowed(selectionBinding)) return;
    try { showFilterPanel(appendQueryResultFilterNode(filterView.expression, node)); }
    catch (reason) { setError(errorMessage(reason)); }
  }
  /** 勾选核对父级接纳的索引，矩形核对网格原选区。结构检查通过才打开草稿。 */
  function openSelectedFilter(capture:QueryResultSelectedFilterCapture, rangeCurrent?: () => boolean, mode: QueryResultSelectedFilterMode = false):void{
    const current=()=>!!result&&resultSelectionAllowed(selectionBinding)&&
      (rangeCurrent ? rangeCurrent() : resultSelection.matchesIndices(selectionBinding,capture.indices))&&
      currentQueryResultSelectedFilter(capture,visibleColumns,result.rows,result);
    if(!filterBinding||!filterView||!current())return;
    try{
      const seed=appendQueryResultFilterNode(filterView.expression,queryResultSelectedFilterNode(capture, mode));
      if(current())showFilterPanel(seed);
    }catch(reason){setError(errorMessage(reason));}
  }
  /** 新筛选与已有完整排序共同试算；两者均成功且来源仍有效才一次发布并记一整步。 */
  function replaceResultFilter(expression:QueryResultFilterGroup,sort:readonly QueryResultSortRule[],isCurrent:()=>boolean):void{
    if(!viewSource||!historyBinding||!isCurrent())return;
    try{
      const prepared=prepareQueryResultOrganization(viewSource,resultContext,visibleColumns,{expression,sort});
      if(!isCurrent())return;
      const next={expression:prepared.filter.view(prepared.filterBinding)!.expression,sort:prepared.sorter.view(prepared.sortBinding)!.rules};
      resultHistory.record(historyBinding,next,prepared.filterBinding);
      resultFilter.invalidate();resultSorter.invalidate();resultFilterRef.current=prepared.filter;resultSorterRef.current=prepared.sorter;
      setError('');invalidateResultSelection();refreshResultSelection(value=>value+1);
    }catch(reason){setError(errorMessage(reason));}
  }
  /** 草稿租约同时绑定排序视图，不能在新筛选失败时丢掉NULL、大小写或旧优先级。 */
  function applyFilterRules(lease:FilterLease,expression:QueryResultFilterGroup):void{
    replaceResultFilter(expression,lease.sortView.rules,()=>filterPanelCurrent(lease));
  }
  /** 旧取消只关闭自己的草稿，不影响较新面板。 */
  function closeFilterPanel(lease:FilterLease):void{if(filterLeaseRef.current!==lease)return;sortLeaseRef.current=null;setSortLease(null);filterLeaseRef.current=null;setFilterLease(null);invalidateResultSelection();refreshResultSelection(value=>value+1);}
  /** 清除只移除筛选；在全部原返回行上保留原排序，排序失败时完整保留旧视图。 */
  function clearResultFilter():void{
    if(!filterBinding||!filterView||!sortView)return;
    replaceResultFilter({mode:'AND',children:[]},sortView.rules,()=>resultSelectionAllowed(selectionBinding));
  }
  /** 独立排序草稿同时绑定原排序及筛选视图；结果、列布局和工作区变代后不复活。 */
  function sortPanelCurrent(lease: SortLease): boolean {
    if (sortLeaseRef.current !== lease || resultSorterRef.current.view(lease.binding) !== lease.view || resultFilterRef.current.view(lease.filterBinding) !== lease.filterView) return false;
    const workspace = useWorkspace.getState(), current = workspace.settings.tabs.find(item => item.id === tab.id);
    return alive.current && !busyRef.current && !workspace.activeJobs[tab.id] && workspace.settings.activeTabId === tab.id && current?.kind === 'query' && current.connectionId === tab.connectionId && (workspace.connectionVersions[current.connectionId] ?? 0) === connectionVersion && !filterLeaseRef.current && !columnLeaseRef.current && !document.querySelector(appDialogSelector);
  }
  /** 打开只清旧选择；当前筛选、排序和历史均保持，草稿不触发比较或SQL。 */
  function openSortPanel(): void {
    if (!sortBinding || !sortView || !filterBinding || !filterView || !resultSelectionAllowed(selectionBinding)) return;
    invalidateResultSelection(); const lease = { binding: sortBinding, view: sortView, filterBinding, filterView }; sortLeaseRef.current = lease; setSortLease(lease); refreshResultSelection(value => value + 1);
  }
  /** 完整比较通过后一次发布并记一条整理历史；失败保留原排序及独立草稿。 */
  function applySortPanel(lease: SortLease, rules: QueryResultSortRule[]): boolean {
    if (!sortPanelCurrent(lease)) return false;
    try {
      const sorted = resultSorter.apply(lease.binding, lease.view, rules);
      resultHistory.record(historyBinding, { expression: lease.filterView.expression, sort: sorted.rules });
      invalidateResultSelection(); setError(''); refreshResultSelection(value => value + 1); return true;
    } catch (reason) { setError(errorMessage(reason)); return false; }
  }
  /** 旧取消不能关闭新面板；当前取消不改原视图或整理历史。 */
  function closeSortPanel(lease: SortLease): void {
    if (sortLeaseRef.current !== lease) return;
    invalidateResultSelection(); refreshResultSelection(value => value + 1);
  }
  /** 同一排序视图才可受理列头/键盘回调；同步撤销旧选择，原SQL及会话完全不变。 */
  function sortResult(next: QueryResultSortRule[]): void {
    if (!sortBinding || !sortView || !resultSelectionAllowed(selectionBinding) || resultSorter.view(sortBinding) !== sortView) return;
    try {
      const sorted = resultSorter.apply(sortBinding, sortView, next);
      if (filterView) resultHistory.record(historyBinding, { expression: filterView.expression, sort: sorted.rules });
      invalidateResultSelection(); refreshResultSelection(value => value + 1);
    } catch (reason) { setError(errorMessage(reason)); }
  }
  /** 完整试算成功且原视图仍有效才发布两个控制器；不执行SQL，不恢复旧选择或行详情。 */
  function travelResultHistory(direction: -1 | 1): void {
    if (!viewSource || !filterView || !sortView || !historyBinding || !resultSelectionAllowed(selectionBinding)) return;
    const ticket = resultHistory.target(historyBinding, direction); if (!ticket) return;
    try {
      const prepared = prepareQueryResultOrganization(viewSource, resultContext, visibleColumns, ticket.configuration);
      if (!resultSelectionAllowed(selectionBinding)) return;
      resultHistory.commit(ticket, prepared.filterBinding);
      resultFilter.invalidate(); resultSorter.invalidate();
      resultFilterRef.current = prepared.filter; resultSorterRef.current = prepared.sorter;
      invalidateResultSelection(); setError(''); refreshResultSelection(value => value + 1);
    } catch (reason) { setError(errorMessage(reason)); }
  }
  /** 暂存只复制完整配置，保留当前视图、历史和选择，不获取SQL或行快照。 */
  function rememberResultOrganization(): void {
    if (!viewSource || !filterView || !sortView || !resultSelectionAllowed(selectionBinding) || columnLeaseRef.current) return;
    try {
      const captured = captureQueryResultMemory(viewSource, visibleColumns, { expression: filterView.expression, sort: sortView.rules }, frozenKeys.at(-1));
      if (!resultSelectionAllowed(selectionBinding)) return;
      resultMemoryRef.current = captured; setError(''); refreshResultSelection(value => value + 1);
    } catch (reason) { setError(errorMessage(reason)); }
  }
  /** 用户显式应用到当前完整返回结果；筛选和排序均成功后一次发布、记一条撤销历史。 */
  function applyRememberedOrganization(): void {
    if (!resultMemory || resultMemoryRef.current !== resultMemory || !viewSource || !historyBinding || !resultSelectionAllowed(selectionBinding) || columnLeaseRef.current) return;
    try {
      if (!queryResultMemoryMatches(resultMemory, viewSource, visibleColumns)) throw Error(memoryText.mismatch);
      const layout=layoutWithFrozenThrough(resultMemory.frozenThrough);
      const prepared = prepareQueryResultOrganization(viewSource, resultContext, visibleColumns, resultMemory.configuration);
      if (resultMemoryRef.current !== resultMemory || !resultSelectionAllowed(selectionBinding)) return;
      resultHistory.record(historyBinding, resultMemory.configuration, prepared.filterBinding);
      resultFilter.invalidate(); resultSorter.invalidate();
      resultFilterRef.current = prepared.filter; resultSorterRef.current = prepared.sorter;
      setColumnLayout({result:sourceResult!,context:resultContext,layout});
      invalidateResultSelection(); setError(''); refreshResultSelection(value => value + 1);
    } catch (reason) { setError(errorMessage(reason)); }
  }
  /** 旧结果或旧暂存的丢弃回调不能清除下一份配置。 */
  function rememberedOrganizationCanDiscard(): boolean {
    const workspace = useWorkspace.getState(), current = workspace.settings.tabs.find(item => item.id === tab.id);
    return !!resultMemory && resultMemoryRef.current === resultMemory && alive.current && !busyRef.current && !workspace.activeJobs[tab.id] && workspace.settings.activeTabId === tab.id && current?.kind === 'query' && current.connectionId === tab.connectionId && (workspace.connectionVersions[current.connectionId] ?? 0) === connectionVersion && task.current === resultContext[3] && !columnLeaseRef.current && !filterLeaseRef.current && !sortLeaseRef.current && !document.querySelector(appDialogSelector) && (selectionBinding ? resultSelectionAllowed(selectionBinding) : !sourceResult?.columns.length);
  }
  /** 即使后续SQL失败或没有行结果，仍可主动清除包含条件值的内存暂存。 */
  function discardRememberedOrganization(): void {
    if (!rememberedOrganizationCanDiscard()) return;
    resultMemoryRef.current = undefined; refreshResultSelection(value => value + 1);
  }
  /** 只允许本方案窗口；另一模态、连接或原结果变代会永久撤销准确双视图租约。 */
  function presetManagerCurrent(lease: PresetLease): boolean {
    if(presetLeaseRef.current!==lease||resultFilterRef.current.view(lease.filterBinding)!==lease.filterView||resultSorterRef.current.view(lease.binding)!==lease.view)return false;
    const workspace=useWorkspace.getState(),current=workspace.settings.tabs.find(item=>item.id===tab.id);
    const owned=document.querySelector(`[data-query-result-presets-owner="${lease.owner}"]`)?.querySelector(appDialogSelector);
    return alive.current&&!busyRef.current&&!workspace.activeJobs[tab.id]&&workspace.settings.activeTabId===tab.id&&current?.kind==='query'&&current.connectionId===tab.connectionId&&(workspace.connectionVersions[current.connectionId]??0)===connectionVersion&&!columnLeaseRef.current&&!filterLeaseRef.current&&!sortLeaseRef.current&&!Array.from(document.querySelectorAll(appDialogSelector)).some(node=>node!==owned);
  }
  /** 打开时只捕获完整配置和字段，不复制行或SQL；暂存槽保持独立。 */
  function openResultPresets(): void {
    if(!viewSource||!filterBinding||!filterView||!sortBinding||!sortView||!historyBinding||!resultSelectionAllowed(selectionBinding)||columnLeaseRef.current)return;
    try{
      const value=queryResultPresetValueSchema.parse(captureQueryResultMemory(viewSource,visibleColumns,{expression:filterView.expression,sort:sortView.rules},frozenKeys.at(-1)));
      if(!resultSelectionAllowed(selectionBinding))return;
      invalidateResultSelection();const lease={owner:uid(),value,binding:sortBinding,view:sortView,filterBinding,filterView};presetLeaseRef.current=lease;setPresetLease(lease);
    }catch(reason){setError(errorMessage(reason));}
  }
  /** 对比独立于当前结果的选择；仅持有明确的本标签固定快照，不执行SQL或猜测行键。 */
  function openResultComparison():void {
    const workspace=useWorkspace.getState(),current=workspace.settings.tabs.find(item=>item.id===tab.id);
    if(!alive.current||busyRef.current||workspace.activeJobs[tab.id]||workspace.settings.activeTabId!==tab.id||current?.kind!=='query'||current.connectionId!==tab.connectionId||(workspace.connectionVersions[current.connectionId]??0)!==connectionVersion||comparisonPinsRef.current!==pins||pins.length<2||comparisonLeaseRef.current||statisticsLeaseRef.current||columnLeaseRef.current||filterLeaseRef.current||sortLeaseRef.current||presetLeaseRef.current||document.querySelector(appDialogSelector))return;
    invalidateResultSelection();const lease={owner:uid(),pins};comparisonLeaseRef.current=lease;setComparisonLease(lease);setError('');
  }
  /** 每批只核父级轻门；对比器最终完整核固定来源，旧窗口不能在标签或连接ABA后复活。 */
  function comparisonCurrent(lease:ComparisonLease):boolean {
    if(comparisonLeaseRef.current!==lease||comparisonPinsRef.current!==lease.pins)return false;
    const workspace=useWorkspace.getState(),current=workspace.settings.tabs.find(item=>item.id===tab.id);
    const owned=document.querySelector(`[data-query-result-comparison-owner="${lease.owner}"]`)?.querySelector(appDialogSelector);
    return alive.current&&!busyRef.current&&!workspace.activeJobs[tab.id]&&workspace.settings.activeTabId===tab.id&&current?.kind==='query'&&current.connectionId===tab.connectionId&&(workspace.connectionVersions[current.connectionId]??0)===connectionVersion&&!statisticsLeaseRef.current&&!columnLeaseRef.current&&!filterLeaseRef.current&&!sortLeaseRef.current&&!presetLeaseRef.current&&!Array.from(document.querySelectorAll(appDialogSelector)).some(node=>node!==owned);
  }
  /** 迟到关闭只能撤销原owner，不能影响重新打开的对比窗口。 */
  function closeResultComparison(lease:ComparisonLease):void {
    if(comparisonLeaseRef.current!==lease)return;
    comparisonLeaseRef.current=null;setComparisonLease(null);invalidateResultSelection();refreshResultSelection(value=>value+1);
  }
  const activeComparisonLease=comparisonLease&&comparisonLeaseRef.current===comparisonLease&&comparisonPinsRef.current===comparisonLease.pins?comparisonLease:null;
  useEffect(()=>{if(comparisonLease&&!activeComparisonLease){if(comparisonLeaseRef.current===comparisonLease)comparisonLeaseRef.current=null;setComparisonLease(null);}},[comparisonLease,activeComparisonLease]);
  /** 每批只核工作区与所属模态；统计器在开始和完成时完整核列、行及原值，避免二次方扫描。 */
  function statisticsCurrent(lease:StatisticsLease):boolean {
    if(statisticsLeaseRef.current!==lease||resultFilterRef.current!==lease.filter||resultSorterRef.current!==lease.sorter)return false;
    const workspace=useWorkspace.getState(),current=workspace.settings.tabs.find(item=>item.id===tab.id);
    const owned=document.querySelector(`[data-query-result-statistics-owner="${lease.owner}"]`)?.querySelector(appDialogSelector);
    return alive.current&&!busyRef.current&&!workspace.activeJobs[tab.id]&&workspace.settings.activeTabId===tab.id&&current?.kind==='query'&&current.connectionId===tab.connectionId&&(workspace.connectionVersions[current.connectionId]??0)===connectionVersion&&!columnLeaseRef.current&&!filterLeaseRef.current&&!sortLeaseRef.current&&!presetLeaseRef.current&&!Array.from(document.querySelectorAll(appDialogSelector)).some(node=>node!==owned);
  }
  /** 列只认准确可见对象；非空勾选必须匹配父级已接纳回执，不能由调用方伪造范围。 */
  function openResultStatistics(column:ResultColumn,indices:ReadonlySet<number>):void {
    if(!result||!filterBinding||!filterView||!sortBinding||!sortView||!resultSelectionAllowed(selectionBinding)||columnLeaseRef.current||!visibleColumns.includes(column))return;
    try {
      const selected=Array.from(Set.prototype.values.call(indices) as IterableIterator<number>).sort((a,b)=>a-b);
      if(selected.length?!resultSelection.matchesIndices(selectionBinding,selected):resultSelection.count(selectionBinding)!==0)throw Error(statisticsText.stale);
      const admitted=new Set(selected);
      captureQueryResultStatistics(visibleColumns,result.rows,column,selected.length?admitted:undefined,sqlite?result:undefined);
      if(!resultSelectionAllowed(selectionBinding))return;
      invalidateResultSelection();
      const lease:StatisticsLease={source:sqlite?result:undefined,owner:uid(),columns:visibleColumns,rows:result.rows,column,indices:admitted,truncated:result.truncated,binding:sortBinding,view:sortView,filterBinding,filterView,filter:resultFilter,sorter:resultSorter};
      statisticsLeaseRef.current=lease;setStatisticsLease(lease);setError('');
    }catch(reason){setError(errorMessage(reason));}
  }
  /** 旧窗口关闭回调只撤销自身，不能关闭后来打开的统计窗口。 */
  function closeResultStatistics(lease:StatisticsLease):void {
    if(statisticsLeaseRef.current!==lease)return;
    statisticsLeaseRef.current=null;setStatisticsLease(null);invalidateResultSelection();refreshResultSelection(value=>value+1);
  }
  /** 仅交接当前统计窗口绑定的筛选和排序来源，草稿保留已生效条件。 */
  function filterFromStatistics(lease: StatisticsLease, node: QueryResultFilterGroup | QueryResultFilterRule): void {
    if (!statisticsCurrent(lease) || lease.filter.view(lease.filterBinding) !== lease.filterView || lease.sorter.view(lease.binding) !== lease.view) {
      throw Error(statisticsText.stale);
    }
    const seed = appendQueryResultFilterNode(lease.filterView.expression, node);
    const draft = { binding: lease.filterBinding, view: lease.filterView, sortBinding: lease.binding, sortView: lease.view, seed };
    // 筛选面板首次渲染会核对模态。先提交旧窗口关闭，避免仍在 DOM 中的窗口令新草稿永久失效。
    flushSync(() => closeResultStatistics(lease));
    if (!filterLeaseRef.current && filterContextCurrent(draft)) beginFilterDraft(draft);
  }
  /** Main回读后再核完整元数据并共同试算；成功才原子替换视图并记录一整步。 */
  function applyResultPreset(lease: PresetLease, raw: QueryResultPresetValue): void {
    if(!viewSource||!historyBinding||!presetManagerCurrent(lease))throw Error(presetsText.stale);
    const value=queryResultPresetValueSchema.parse(raw);
    if(!queryResultMemoryMatches(value,viewSource,visibleColumns))throw Error(presetsText.mismatch);
    const layout=layoutWithFrozenThrough(value.frozenThrough);
    const prepared=prepareQueryResultOrganization(viewSource,resultContext,visibleColumns,value.configuration);
    if(!presetManagerCurrent(lease))throw Error(presetsText.stale);
    resultHistory.record(historyBinding,value.configuration,prepared.filterBinding);
    resultFilter.invalidate();resultSorter.invalidate();resultFilterRef.current=prepared.filter;resultSorterRef.current=prepared.sorter;
    setColumnLayout({result:sourceResult!,context:resultContext,layout});
    presetLeaseRef.current=null;setPresetLease(null);invalidateResultSelection();setError('');refreshResultSelection(number=>number+1);
  }
  /** 旧窗口关闭回调只撤销自己的租约，不影响下一份方案或当前结果。 */
  function closeResultPresets(lease: PresetLease): void {if(presetLeaseRef.current!==lease)return;presetLeaseRef.current=null;setPresetLease(null);invalidateResultSelection();refreshResultSelection(number=>number+1);}
  /** 仅重排当前规则数组；仍由sortResult核活视图和全部键，旧按钮不能修改下一代结果。 */
  function moveSortPriority(index: number, offset: -1 | 1): void {
    if (!sortView || index+offset<0 || index+offset>=sortView.rules.length) return;
    const next=[...sortView.rules];[next[index],next[index+offset]]=[next[index+offset],next[index]];sortResult(next);
  }
  /** 空值位置仅替换所属活规则，恢复默认时删除可选项；旧控件仍由sortResult拒绝。 */
  function changeSortNulls(index:number,value:string):void{
    if(!sortView||value!==''&&value!=='FIRST'&&value!=='LAST')return;
    sortResult(sortView.rules.map((item,i)=>{if(i!==index)return item;const{nulls:previous,...base}=item;return value?{...base,nulls:value}:base;}));
  }
  /** 大小写选项只替换所属活规则，关闭时删除可选项，仍由原排序租约核验。 */
  function changeSortCase(index:number,checked:boolean):void{
    if(!sortView)return;
    sortResult(sortView.rules.map((item,i)=>{if(i!==index)return item;const{ignoreCase:previous,...base}=item;return checked?{...base,ignoreCase:true}:base;}));
  }
  const activeColumnLease=columnLease&&columnLeaseRef.current===columnLease&&resultSelection.current(columnLease.binding)?columnLease:null;
  if(columnLease&&!activeColumnLease&&columnLeaseRef.current===columnLease)columnLeaseRef.current=null;
  const selectedExportCount = resultSelection.count(selectionBinding);
  /** 同步读取真实工作区和操作引用；关闭、连接修订或迟到按钮均不能借旧绑定导出。 */
  function resultSelectionAllowed(binding: ResultSelectionBinding | undefined): boolean {
    const workspace = useWorkspace.getState(), current = workspace.settings.tabs.find(item => item.id === tab.id);
    return alive.current && !busyRef.current && !workspace.activeJobs[tab.id] && workspace.settings.activeTabId === tab.id && current?.kind === 'query' && current.connectionId === tab.connectionId && (workspace.connectionVersions[current.connectionId] ?? 0) === connectionVersion && !resultInsertRef.current && !comparisonLeaseRef.current && !statisticsLeaseRef.current && !filterLeaseRef.current && !sortLeaseRef.current && !document.querySelector(appDialogSelector) && resultViewCurrent(binding?.result) && resultSelection.current(binding);
  }
  /** 网格只交付当前准确数组的选择，验证失败清空选择，不能回退成全结果导出。 */
  function selectResultRows(selection: ResultGridSelection): boolean {
    if (!resultSelectionAllowed(selectionBinding)) return false;
    try { if (resultSelection.select(selectionBinding, selection)) { refreshResultSelection(value => value + 1); return true; } }
    catch (reason) { resultSelection.invalidate(); refreshResultSelection(value => value + 1); setError(errorMessage(reason)); }
    return false;
  }
  function changeMatchView(indices?: ReadonlySet<number>, kind: QueryResultRowViewKind = 'find'): void {
    if (columnLeaseRef.current || !resultSelectionAllowed(selectionBinding)) return;
    if (kind !== 'find' && (!indices || !resultSelection.matchesIndices(selectionBinding, [...indices]))) return;
    try {
      if (indices) matchView.apply(indices, invalidateResultSelection, kind);
      else matchView.clear(invalidateResultSelection);
    } catch (reason) { setError(errorMessage(reason)); }
  }
  /** 打开时克隆已选快照；后续新执行、切换或勾选变化不修改这次文件内容。 */
  function exportSelectedRows() {
    if (!resultSelectionAllowed(selectionBinding)) return;
    try {
      const snapshot = sqlite && selectionBinding?.result.sqliteStorage
        ? resultSelection.sqliteSnapshot(selectionBinding) : resultSelection.snapshot(selectionBinding);
      invalidateResultSelection(); setExportSelected(true); setExportResult(snapshot);
    }
    catch (reason) { setError(errorMessage(reason)); }
  }
  /** 所有已返回行也只导出打开时的可见列，先校验有界投影再冻结。 */
  function exportVisibleResult(){
    if(!resultSelectionAllowed(selectionBinding))return;
    try{const snapshot=resultSelection.allSnapshot(selectionBinding);invalidateResultSelection();setExportSelected(false);setExportResult(snapshot);}catch(reason){setError(errorMessage(reason));}
  }
  function exportGridRange(data: GridRangeExportData) {
    if (!resultSelectionAllowed(selectionBinding)) return;
    setExportSelected(false);
    setExportResult({ ...data, rectangle: true });
  }
  /** 使用本次勾选的协议值和同一视图的类型证据，不重新执行源查询。 */
  function captureQueryTransfer() {
    if (!connection || connection.dialect === 'postgresql' || pin || !selectionBinding || !resultSelectionAllowed(selectionBinding)) return;
    try {
      const source = { connectionId: tab.connectionId, label: connection.name, title: tab.title, result: resultIndex + 1 };
      const snapshot = connection.dialect === 'sqlite'
        ? captureSqliteQueryTransfer({ ...source, database: 'main' }, resultSelection.sqliteSnapshot(selectionBinding))
        : captureMysqlQueryTransfer(source, connection.dialect, resultSelection.snapshot(selectionBinding), selectionBinding.visibleColumns);
      usePostgresRecordTransfer.setState({ snapshot });
      useWorkspace.getState().notify(connection.dialect === 'sqlite'
        ? transferText.queryCapturedToNetwork(snapshot.rows.length) : transferText.queryCapturedToEither(snapshot.rows.length));
    } catch (reason) { setError(errorMessage(reason)); }
  }

  /** 已返回视图直接取得完整typed快照；保留原SQL、事务、结果和勾选，不调用原查询。 */
  function openResultInsert(selected: boolean): void {
    if (sqlite) return;
    if (!selectionBinding || !resultSelectionAllowed(selectionBinding) || resultInsertRef.current) return;
    try {
      const snapshot = selected ? resultSelection.snapshot(selectionBinding) : resultSelection.allSnapshot(selectionBinding), state = useWorkspace.getState(), originalTab = state.settings.tabs.find(item => item.id === tab.id), profile = state.connections.find(item => item.id === tab.connectionId), binding = selectionBinding, context = [...resultContext], columns = visibleColumns;
      let intent: ResultInsertSourceIntent;
      intent = new ResultInsertSourceIntent(resultExportData(snapshot), selected, uid(), () => {
        const now = useWorkspace.getState(), view = resultInsertView.current, ownBusy = resultInsertActivity.current > 0 && (!resultInsertBusy.current || resultInsertBusy.current.owns());
        return alive.current && resultInsertRef.current === intent && !closeRequestRef.current && now.settings.activeTabId === tab.id && now.settings.tabs.find(item => item.id === tab.id) === originalTab && now.connections.find(item => item.id === tab.connectionId) === profile && (now.connectionVersions[tab.connectionId] ?? 0) === connectionVersion && (ownBusy || !busyRef.current && !now.activeJobs[tab.id]) && view.result === binding.result && view.columns === columns && view.binding === binding && view.context.length === context.length && view.context.every((value, index) => value === context[index]) && resultSelection.current(binding) && resultViewCurrent(binding.result);
      });
      resultInsertRef.current = intent; setResultInsertSource(intent); setError('');
    } catch (reason) { setError(errorMessage(reason)); }
  }
  /** 子任务自有占门不改变查询结果busy视图；实际异步与取消都结束后才能释放原标签。 */
  function resultInsertActivityChange(delta: 1 | -1): void {
    if (delta === 1) {
      if (!resultInsertActivity.current) {
        if (busyRef.current) throw Error(resultInsertZh.stale);
        resultInsertActivity.current = 1; busyRef.current = true;
        try { resultInsertBusy.current = acquireWorkspaceBusy(tab.id); } catch (reason) { resultInsertActivity.current = 0; busyRef.current = false; throw reason; }
      } else resultInsertActivity.current++;
    } else {
      resultInsertActivity.current = Math.max(0, resultInsertActivity.current - 1);
      if (!resultInsertActivity.current) { const lease = resultInsertBusy.current; resultInsertBusy.current = undefined; if (lease?.owns()) busyRef.current = false; lease?.release(); }
    }
  }
  /** 仅原窗口完成收尾后的关闭可以清自身；迟到旧回调不触及下一份结果操作。 */
  function closeResultInsert(intent: ResultInsertSourceIntent): void { if (resultInsertRef.current !== intent) return; intent.invalidate(); resultInsertRef.current = null; setResultInsertSource(null); }
  /** 开管理器即撤销旧网格回执，内部草稿变化只复制列布局。 */
  function openColumnManager(){
    if(!resultSelectionAllowed(selectionBinding)||!selectionBinding)return;
    try{
      const keys=queryResultColumnKeys(selectionBinding.columns), initial=layoutMatches&&columnLayout?columnLayout.layout:{order:keys,visible:keys};
      invalidateResultSelection();const binding=resultSelection.bind(selectionBinding.result,selectionBinding.context,visibleColumns);if(!binding)return;
      const lease={binding,owner:uid(),initial};columnLeaseRef.current=lease;setColumnLease(lease);refreshResultSelection(value=>value+1);
    }catch(reason){setError(errorMessage(reason));}
  }
  /** 只忽略本owner唯一模态；其它窗口、任务、连接修订和失效绑定均终止本次管理。 */
  function columnManagerCurrent(lease:ColumnLease):boolean {
    if(columnLeaseRef.current!==lease||!resultSelection.current(lease.binding)||!resultViewCurrent(lease.binding.result))return false;
    const workspace=useWorkspace.getState(),current=workspace.settings.tabs.find(item=>item.id===tab.id),owned=document.querySelector(`[data-query-columns-owner="${lease.owner}"]`)?.querySelector(appDialogSelector);
    return alive.current&&!busyRef.current&&!workspace.activeJobs[tab.id]&&workspace.settings.activeTabId===tab.id&&current?.kind==='query'&&current.connectionId===tab.connectionId&&(workspace.connectionVersions[current.connectionId]??0)===connectionVersion&&!closeRequest&&Array.from(document.querySelectorAll(appDialogSelector)).every(node=>node===owned);
  }
  /** 关闭也撤销本代次；旧关闭／应用回调不能作用于下一次管理器或新结果。 */
  function closeColumnManager(lease:ColumnLease){if(columnLeaseRef.current!==lease)return;columnLeaseRef.current=null;invalidateResultSelection();setColumnLease(null);refreshResultSelection(value=>value+1);}
  /** 接纳前再次核同一准确结果及布局，原outcome与pinned对象都不改写。 */
  function applyColumnLayout(lease:ColumnLease,layout:QueryResultColumnLayout){
    if(!columnManagerCurrent(lease))return;
    try{queryResultVisibleColumns(lease.binding.columns,layout);setColumnLayout({result:sourceResult!,context:resultContext,layout});closeColumnManager(lease);}catch(reason){setError(errorMessage(reason));}
  }
  /** 只接纳原网格的当前可见列尺寸，保留隐藏列宽和原结果数据。 */
  function resizeResultColumns(sizes: ColumnWidths): void {
    if (!sourceResult || !resultSelectionAllowed(selectionBinding)) return;
    const widths = new Map(resultColumnWidths);
    let changed = false;
    for (const { key } of visibleColumns) {
      const size = sizes.get(key);
      if (size?.type !== 'resized' || !Number.isFinite(size.width)) continue;
      const width = Math.max(queryResultColumnWidth.min, Math.min(queryResultColumnWidth.max, Math.round(size.width)));
      if (widths.get(key) !== width) {
        widths.set(key, width);
        changed = true;
      }
    }
    if (!changed) return;
    const keys = sourceResult.columns.map(column => column.key);
    const layout = layoutMatches && columnLayout ? columnLayout.layout : { order: keys, visible: keys };
    setColumnLayout({ result: sourceResult, context: resultContext, layout: { ...layout, widths } });
  }
  function resizeResultRowHeight(height: number): void {
    if (!sourceResult || !resultSelectionAllowed(selectionBinding)) return;
    const layout = setQueryResultRowHeight(sourceResult.columns, layoutMatches ? columnLayout?.layout : undefined, height);
    setColumnLayout({ result: sourceResult, context: resultContext, layout });
  }
  /** 方案和暂存仅替换当前边界，不改可见列/顺序；旧方案没有边界就明确清除当前冻结。 */
  function layoutWithFrozenThrough(key?:string):QueryResultColumnLayout {
    if(!sourceResult)throw Error(columnText.stale);
    const keys=queryResultColumnKeys(sourceResult.columns), base=layoutMatches&&columnLayout?columnLayout.layout:{order:keys,visible:keys};
    const next=setQueryResultFrozenThrough(base,key);queryResultVisibleColumns(sourceResult.columns,next);
    return next;
  }
  const headerFreeze = {
    current: () => resultSelectionAllowed(selectionBinding),
    apply(key?: string) {
      if (!sourceResult) return;
      try { setColumnLayout({ result: sourceResult, context: resultContext, layout: layoutWithFrozenThrough(key) }); }
      catch (reason) { setError(errorMessage(reason)); }
    },
  };
  const columnVisibility = {
    current: () => resultSelectionAllowed(selectionBinding),
    canHide: visibleColumns.length > 1, hasHidden: visibleColumns.length < (sourceResult?.columns.length ?? 0),
    apply: (key?: string) => changeHeaderColumnLayout(layout => setQueryResultHeaderColumnVisibility(layout, key)),
  };
  /** 显隐和拖动通过同一布局接纳门，保留原结果及有效整理规则。 */
  function changeHeaderColumnLayout(update: (layout: QueryResultColumnLayout) => QueryResultColumnLayout): void {
    if (!sourceResult || !resultSelectionAllowed(selectionBinding)) return;
    try {
      const keys = queryResultColumnKeys(sourceResult.columns);
      const base = layoutMatches && columnLayout ? columnLayout.layout : { order: keys, visible: keys };
      const next = update(base);
      if (next === base) return;
      const projected = queryResultVisibleColumns(sourceResult.columns, next);
      // 新列投影与筛选排序一起试算，隐藏正在使用的列时保留原网格。
      if (viewSource && filterView && sortView) {
        if ([...filterView.rules, ...sortView.rules].some(rule => !next.visible.includes(rule.column))) throw Error(columnText.activeRule);
        const prepared = prepareQueryResultOrganization(viewSource, resultContext, projected,
          { expression: filterView.expression, sort: sortView.rules });
        resultFilter.invalidate(); resultSorter.invalidate();
        resultFilterRef.current = prepared.filter; resultSorterRef.current = prepared.sorter;
      }
      shownColumns.current = projected;
      invalidateResultSelection();
      setColumnLayout({ result: sourceResult, context: resultContext, layout: next });
      setError('');
    } catch (reason) { setError(errorMessage(reason)); }
  }
  function reorderResultColumns(from: string, to: string): void {
    changeHeaderColumnLayout(layout => reorderQueryResultColumn(layout, from, to));
  }
  /** 快照由独立克隆保留旧数据，不重执行SQL，也不把结果写入本地配置库。 */
  function pinResult() {
    if (busy || !outcome || !result || pin) return;
    try {
      const base = formatText(zh.query.pinLabel, pinSequence.current + 1), name = resultNames[resultIndex];
      const next = snapshotQueryResult(pins, sourceResult!, uid(), name ? formatText(zh.query.namedResultLabel, base, name) : base);
      invalidateResultSelection(); pinSequence.current++; setPins([...pins, next]); setSelectedPin(next.id); setError('');
    } catch (reason) { setError(errorMessage(reason)); }
  }
  /** 释放快照后立即返回本次结果，原SQL标签和事务状态保持原样。 */
  function releasePin(id: string) {
    invalidateResultSelection();
    setPins(current => current.filter(item => item.id !== id));
    if (selectedPin === id) { setSelectedPin(''); setShowPinSql(null); }
  }
  /** 原查询标签的真实布局入口；不读写SQL/model，只取得当次工作台布局租约。 */
  function beginEditorLayout(cancel:()=>void, dimension: 'height' | 'width' = 'height') {
    return beginWorkspaceQueryLayout(tab,connectionVersion,()=>alive.current&&!closeRequestRef.current,cancel,dimension);
  }
  /** 布局切换保留原编辑器和结果实例，仅将可恢复位置写入当前标签。 */
  function changeResultLayout(value: string): void {
    if (!queryMenuCurrent()) return;
    if (value === 'results') { setResultsOnly(true); return; }
    if (value !== 'below' && value !== 'beside') return;
    setResultsOnly(false);
    if (preferredPlacement !== value) useWorkspace.getState().updateTab(tab.id, { queryResultPlacement: value });
  }
  /** 命令只归属当前查询；左树切换不能把已有标签的会话或文件来源改成另一数据库。 */
  function queryMenuCurrent(): boolean {
    return queryOwnerCurrent() && !document.querySelector(appModalSelector);
  }
  const hasPaneResult = !!(result || outcome?.sqliteExplain || outcome?.analysis || outcome?.explain);
  /** 恢复编辑区时保留原模型、选区及偏好的结果位置。 */
  function focusQueryPane(pane: 'editor' | 'result'): boolean {
    const instance = editor.current;
    if (!instance?.getModel() || !queryMenuCurrent() || busyRef.current || fileSource.isBusy()) return false;
    if (pane === 'result') return hasPaneResult && focusQueryResultPane(layoutRoot.current);
    if (resultsOnly) flushSync(() => setResultsOnly(false));
    instance.focus();
    return instance.hasTextFocus();
  }
  /** 已连接时以原查询会话的默认库为准，未知上下文不退回侧栏选择。 */
  function openViewDesign(): void {
    if (!onCreateView || !connection || !queryMenuCurrent() || busyRef.current || pendingSession.current || fileSource.isBusy() ||
        formatting.current || resultsOnly || useWorkspace.getState().activeJobs[tab.id] || (connection.dialect === 'sqlite' && connection.sqlite.readOnly)) return;
    try {
      const context = sessionRef.current ? queryDatabaseFromSession(mysqlEditorMode) : draftContext;
      const database = connection.dialect === 'sqlite' ? 'main' : context.state === 'known' ? context.database : null;
      if (!database) throw Error(queryViewText.database);
      onCreateView({ tabId: tab.id, connectionId: connection.id, version: connectionVersion, database,
        dialect: connection.dialect, sql: queryViewFromEditor(editor.current, connection.dialect) });
    } catch (reason) { setError(errorMessage(reason)); }
  }
  function queryOwnerCurrent(): boolean {
    const workspace = useWorkspace.getState(), current = workspace.settings.tabs.find(item => item.id === tab.id);
    return alive.current && workspace.settings.activeTabId === tab.id && current?.kind === 'query'
      && current.connectionId === tab.connectionId && current.database === tab.database
      && JSON.stringify(current.databaseContext) === JSON.stringify(tab.databaseContext)
      && JSON.stringify(current.fileSourceBinding) === JSON.stringify(tab.fileSourceBinding)
      && JSON.stringify(current.sourceBinding) === JSON.stringify(tab.sourceBinding)
      && workspace.connections.find(profile => profile.id === tab.connectionId) === connection
      && (workspace.connectionVersions[tab.connectionId] ?? 0) === connectionVersion
      && !closeRequestRef.current;
  }
  /** 目录、选中和相邻跳转共用原分段规则，均不创建连接、会话或查询任务。 */
  function openStatementNavigation(instance = editor.current, action: 'panel' | 'select' | 'previous' | 'next' | 'duplicate' = 'panel'): void {
    if (!queryMenuCurrent() || !connection || connection.dialect === 'postgresql' || !instance || instance !== editor.current || busyRef.current || fileSource.isBusy() || useWorkspace.getState().activeJobs[tab.id] || navigationIntent.current?.controller.busy) return;
    const model = instance.getModel(); if (!model || model.isDisposed() || instance.getRawOptions().readOnly) return;
    const oneShot = action !== 'panel', direction = action === 'previous' ? -1 : action === 'next' ? 1 : undefined;
    const selections = oneShot ? instance.getSelections() : undefined;
    if (oneShot && (resultsOnly || selections?.length !== 1)) return;
    const originalSelection = selections?.[0];
    const offset = originalSelection ? model.getOffsetAt(originalSelection.getPosition()) : 0;
    const noTarget = action === 'previous' ? navigationText.noPrevious : action === 'next' ? navigationText.noNext : navigationText.noCurrent;
    // 面板已经持有准确原模型的目录时，直接导航并保留搜索、分页和当前面板。
    const existing = navigationIntent.current;
    if (direction && existing?.model === model && existing.instance === instance && existing.result && existing.controller.current()) {
      const range = adjacentNavigableStatement(existing.source, existing.result.statements, offset, direction);
      if (range) applyStatementRange(existing, range, false); else useWorkspace.getState().notify(noTarget);
      return;
    }
    closeSyntaxCheck(); closeStatementNavigation();
    const version = model.getVersionId(), profile = connection, originalSession = sessionRef.current;
    const context = JSON.stringify([tab.connectionId, tab.database, tab.databaseContext, tab.sourceBinding, tab.fileSourceBinding]); let valid = true;
    const binding: NonNullable<typeof navigationIntent.current> = { id: uid(), source: model.getValue(), dialect: profile.dialect, model, instance, controller: undefined as unknown as StatementNavigationController };
    const current = () => {
      if (!valid) return false;
      const state = useWorkspace.getState(), now = state.settings.tabs.find(value => value.id === tab.id);
      const okay = alive.current && navigationIntent.current === binding && state.settings.activeTabId === tab.id && now?.kind === 'query'
        && JSON.stringify([now.connectionId, now.database, now.databaseContext, now.sourceBinding, now.fileSourceBinding]) === context
        && state.connections.find(value => value.id === profile.id) === profile && (state.connectionVersions[profile.id] ?? 0) === connectionVersion
        && sessionRef.current === originalSession && !closeRequestRef.current && !busyRef.current && !state.activeJobs[tab.id] && !fileSource.isBusy()
        && !document.querySelector(appModalSelector) && editor.current === instance && instance.getModel() === model && !model.isDisposed() && model.getVersionId() === version;
      const nowSelections = okay && originalSelection ? instance.getSelections() : undefined;
      if (!okay || originalSelection && (layoutRoot.current?.dataset.resultLayout === 'results' || nowSelections?.length !== 1 || !originalSelection.equalsSelection(nowSelections[0]))) valid = false;
      return valid;
    };
    binding.controller = new StatementNavigationController({ source: binding.source, dialect: binding.dialect, sessionId: originalSession || undefined, current,
      subscribe: changed => {
        const subscriptions = [model.onDidChangeContent(changed), model.onWillDispose(changed), instance.onDidChangeModel(changed), instance.onDidDispose(changed)], release = useWorkspace.subscribe(changed);
        if (originalSelection) subscriptions.push(instance.onDidChangeCursorSelection(changed));
        else subscriptions.push(instance.onDidChangeCursorPosition(() => { const point = instance.getPosition(); if (point && current()) setNavigationCursor(model.getOffsetAt(point)); }));
        return () => { release(); subscriptions.forEach(value => value.dispose()); };
      },
      state: sessionId => invoke('query.completionState', { sessionId }), create: () => new StatementNavigationWorkerClient(() => new StatementNavigationWorker()),
      decorate: result => { if (current()) binding.result = result; }, clear: () => { binding.result = undefined; },
      changed: view => {
        if (!alive.current || navigationIntent.current !== binding) return;
        if (!oneShot) { setNavigationView(view); return; }
        if (view.busy || !view.result) return;
        const result = view.result;
        const range = result.status === 'ready' && current()
          ? direction ? adjacentNavigableStatement(binding.source, result.statements, offset, direction) : result.statements[currentNavigableStatement(binding.source, result.statements, offset)] : undefined;
        closeStatementNavigation();
        if (range && action === 'duplicate') void duplicateQuery('statement', binding.instance, [range]);
        else if (range) applyStatementRange(binding, range, action === 'select');
        else if (result.status === 'ready') useWorkspace.getState().notify(noTarget);
        else if (result.reason !== 'stale') useWorkspace.getState().notify(navigationText.reasons[result.reason] ?? navigationText.unavailable, true);
      },
    });
    navigationIntent.current = binding;
    if (!oneShot) { const point = instance.getPosition(); setNavigationCursor(point ? model.getOffsetAt(point) : 0); setNavigationView({ busy: true }); }
    void binding.controller.start();
  }
  /** 跳转只更改原编辑器的光标／选区，不执行、不复制，也不修改正文和撤销栈。 */
  function navigateStatement(index: number, select: boolean): void {
    const binding = navigationIntent.current, range = binding?.result?.statements[index];
    if (!binding || !range || !binding.controller.current()) return;
    applyStatementRange(binding, range, select);
  }
  function extractNavigationStatements(ranges: readonly NavigableStatement[], destination: StatementSelectionDestination) {
    const binding = navigationIntent.current;
    if (binding) return extractStatementSelection(binding.controller, ranges, destination,
      output => duplicateQuery(output.mode, binding.instance, ranges, output));
  }
  /** 单次选中先解绑原监听，再应用选区，避免把自己的选区变更误认作用户取消。 */
  function applyStatementRange(binding: NonNullable<typeof navigationIntent.current>, range: NavigableStatement, select: boolean): void {
    const start = binding.model.getPositionAt(range.start), end = binding.model.getPositionAt(range.end);
    if (select) {
      const selection = { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column };
      binding.instance.setSelection(selection); binding.instance.revealRangeInCenter(selection);
    } else { binding.instance.setPosition(start); binding.instance.revealPositionInCenter(start); }
    binding.instance.focus();
  }
  /** 只释放本轮目录和监听，旧清理不能关闭继任面板。 */
  function closeStatementNavigation(): void { const binding = navigationIntent.current; navigationIntent.current = null; binding?.controller.dispose(); setNavigationView(null); }
  /** 检查始终绑定原查询来源。SQLite 可打开当前标签的会话进行准备，不执行正文。 */
  function openSyntaxCheck(instance = editor.current): void {
    if (!queryMenuCurrent() || !connection || connection.dialect === 'postgresql' || !instance || instance !== editor.current || busyRef.current || fileSource.isBusy() || useWorkspace.getState().activeJobs[tab.id] || syntaxIntent.current?.controller.busy) return;
    const model = instance.getModel();
    if (!model || model.isDisposed() || instance.getRawOptions().readOnly) return;
    closeStatementNavigation(); closeSyntaxCheck();
    if (resultsOnly) flushSync(() => setResultsOnly(false));
    const version = model.getVersionId(), profile = connection, source = model.getValue();
    const labels = sqlite ? sqliteSyntaxCheckZh : syntaxText;
    let boundSession = sessionRef.current, opening = false, ownsBusy = false;
    const context = JSON.stringify([tab.connectionId, tab.database, tab.databaseContext, tab.sourceBinding, tab.fileSourceBinding]);
    const owner = 'dbark-syntax:' + uid(); let valid = true;
    const binding: NonNullable<typeof syntaxIntent.current> = { model, instance, controller: undefined as unknown as SqlSyntaxCheckController };
    const current = () => {
      if (!valid) return false;
      const state = useWorkspace.getState(), now = state.settings.tabs.find(value => value.id === tab.id);
      const okay = alive.current && syntaxIntent.current === binding && state.settings.activeTabId === tab.id && now?.kind === 'query'
        && JSON.stringify([now.connectionId, now.database, now.databaseContext, now.sourceBinding, now.fileSourceBinding]) === context
        && state.connections.find(value => value.id === profile.id) === profile && (state.connectionVersions[profile.id] ?? 0) === connectionVersion
        && (opening || sessionRef.current === boundSession) && !closeRequestRef.current
        && (ownsBusy || !busyRef.current && !state.activeJobs[tab.id]) && !fileSource.isBusy()
        && !document.querySelector(appModalSelector) && editor.current === instance && instance.getModel() === model && !model.isDisposed() && model.getVersionId() === version;
      if (!okay) valid = false; return okay;
    };
    binding.controller = new SqlSyntaxCheckController({source, sessionId: boundSession || undefined, current,
      ...(sqlite ? {native: async (signal: AbortSignal): Promise<SqlSyntaxCheckResult> => {
        if (source.length > sqlSyntaxCheckLimits.sourceUnits) return {status: 'blocked', reason: 'budget'};
        if (!current() || signal.aborted) return {status: 'blocked', reason: 'stale'};
        const taskId = uid();
        let sent = false;
        const cancel = () => { if (sent) void invoke('query.cancel', {taskId}).catch(() => {}); };
        signal.addEventListener('abort', cancel, {once: true});
        ownsBusy = true;
        busyRef.current = true;
        setBusy(true);
        useWorkspace.getState().setBusy(tab.id, true);
        try {
          opening = !boundSession;
          boundSession = await ensureSession();
          opening = false;
          if (!current() || signal.aborted) return {status: 'blocked', reason: 'stale'};
          sent = true;
          return await invoke('sqlite.syntaxCheck', {sessionId: boundSession, taskId, sql: source});
        } finally {
          opening = false;
          signal.removeEventListener('abort', cancel);
          busyRef.current = false;
          if (alive.current) setBusy(false);
          useWorkspace.getState().setBusy(tab.id, false);
          ownsBusy = false;
        }
      }} : {}),
      subscribe: changed => {
        const subscriptions = [model.onDidChangeContent(changed), model.onWillDispose(changed), instance.onDidChangeModel(changed), instance.onDidDispose(changed)], release = useWorkspace.subscribe(changed);
        return () => { release(); subscriptions.forEach(value => value.dispose()); };
      },
      state: sessionId => invoke('query.completionState', { sessionId }), create: () => new LocalReferencesWorkerClient(() => new CompletionWorker()),
      decorate: result => {
        if (!current()) return;
        binding.result = result;
        monacoEditor.setModelMarkers(model, owner, result.issues.map(issue => { const start = model.getPositionAt(issue.start), end = model.getPositionAt(issue.end); return { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column, severity: MarkerSeverity.Warning, source: labels.title, message: labels.issueMessages[issue.code] ?? labels.issue }; }));
      },
      clear: () => { binding.result = undefined; if (!model.isDisposed()) monacoEditor.setModelMarkers(model, owner, []); },
      changed: view => { if (alive.current && syntaxIntent.current === binding) setSyntaxView(view); },
    });
    syntaxIntent.current = binding; setSyntaxView({ busy: true }); void binding.controller.start();
  }
  /** 点击问题只在原模型版本仍有效时定位；不修改SQL或撤销栈。 */
  function selectSyntaxIssue(index: number): void {
    const binding = syntaxIntent.current, issue = binding?.result?.issues[index];
    if (!binding || !issue || !binding.controller.current()) return;
    const start = binding.model.getPositionAt(issue.start), end = binding.model.getPositionAt(issue.end);
    const range = { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column };
    binding.instance.setSelection(range); binding.instance.revealRangeInCenter(range); binding.instance.focus();
  }
  /** 只清本轮marker owner；旧异步清理不能撤销继任检查。 */
  function closeSyntaxCheck(): void { const binding = syntaxIntent.current; syntaxIntent.current = null; binding?.controller.dispose(); setSyntaxView(null); }
  /** 捕获活动查询的原模型与连接；树选择不会成为这个对象导航的目标。 */
  function openObjectStructure(instance = editor.current): void {
    if (!queryMenuCurrent() || !connection || connection.dialect === 'postgresql' || !instance || instance !== editor.current || busyRef.current || fileSource.isBusy() || useWorkspace.getState().activeJobs[tab.id] || objectDefinitionRef.current) return;
    const model = instance.getModel(), position = instance.getPosition();
    if (!model || model.isDisposed() || !position || instance.getRawOptions().readOnly) return;
    const version = model.getVersionId(), originalSession = sessionRef.current, profile = connection;
    const key = JSON.stringify([tab.connectionId, tab.database, tab.databaseContext, tab.sourceBinding, tab.fileSourceBinding]);
    let valid = true;
    const intent: ObjectDefinitionSource = { id: uid(), tabId: tab.id, connectionName: profile.name, source: model.getValue(), offset: model.getOffsetAt(position), dialect: profile.dialect,
      scope: { connectionId: tab.connectionId, connectionVersion, database: draftContext.state === 'known' ? draftContext.database ?? undefined : undefined, databaseUnknown: draftContext.state === 'unknown', sessionId: originalSession || undefined },
      current: () => {
        if (!valid) return false;
        const workspace = useWorkspace.getState(), now = workspace.settings.tabs.find(value => value.id === tab.id);
        const dialogs = [...document.querySelectorAll(appModalSelector)];
        const okay = alive.current && objectDefinitionRef.current === intent && workspace.settings.activeTabId === tab.id && now?.kind === 'query'
          && JSON.stringify([now.connectionId, now.database, now.databaseContext, now.sourceBinding, now.fileSourceBinding]) === key
          && workspace.connections.find(value => value.id === profile.id) === profile && (workspace.connectionVersions[profile.id] ?? 0) === connectionVersion
          && sessionRef.current === originalSession && !closeRequestRef.current && !model.isDisposed() && editor.current === instance && instance.getModel() === model && model.getVersionId() === version
          && dialogs.length <= 1 && dialogs.every(dialog => dialog.querySelector('[data-object-definition]')?.getAttribute('data-object-definition') === intent.id);
        if (!okay) valid = false; return okay;
      },
      watch: changed => {
        const subscriptions = [model.onDidChangeContent(changed), model.onWillDispose(changed), instance.onDidChangeModel(changed), instance.onDidDispose(changed)];
        const release = useWorkspace.subscribe(changed);
        return () => { release(); subscriptions.forEach(subscription => subscription.dispose()); };
      },
      settled: async () => {
        if (!originalSession) return;
        // 失败的SHOW也可能令原协议缓存降为未知；仅同步准确会话缓存，不附加SQL或冒称事务已结束。
        const ownsSession = () => {
          const workspace = useWorkspace.getState(), now = workspace.settings.tabs.find(value => value.id === tab.id);
          return alive.current && objectDefinitionRef.current === intent && intent.current() && sessionRef.current === originalSession && now?.connectionId === profile.id
            && workspace.connections.some(value => value.id === profile.id) && (workspace.connectionVersions[profile.id] ?? 0) === connectionVersion && !busyRef.current;
        };
        if (!ownsSession()) return;
        const [state, cached] = await Promise.all([invoke('query.sessionState', { sessionId: originalSession }).catch(() => null), invoke('query.completionState', { sessionId: originalSession }).catch(() => undefined)]);
        if (!ownsSession()) return;
        setCompletionSession(cached);
        if (state) { setTransaction(state.transactionOpen); setTransactionKnown(state.transactionKnown && !state.broken); useWorkspace.getState().setDirty(tab.id, state.transactionOpen || !state.transactionKnown || state.broken); }
        else { setTransactionKnown(false); useWorkspace.getState().setDirty(tab.id, true); }
      },
    };
    objectDefinitionRef.current = intent; setObjectDefinition(intent);
  }
  /** 关闭保持原查询与草稿，不能把旧弹窗的回调交给继任弹窗。 */
  function closeObjectStructure(intent: ObjectDefinitionSource): void { if (objectDefinitionRef.current !== intent) return; objectDefinitionRef.current = null; setObjectDefinition(null); }
  /** 使用当前Monaco实例的正式查找动作，不发送模拟按键或点击旧按钮。 */
  function openEditorFind(replace = false, selection = false): void {
    if (!queryMenuCurrent() || !editor.current || fileSource.isBusy()) return;
    const instance = editor.current;
    const action = instance.getAction(selection ? replace ? 'sql-replace-selection' : 'sql-find-selection'
      : replace ? 'editor.action.startFindReplaceAction' : 'actions.find');
    if (action) { instance.focus(); void action.run().catch(reason => setError(errorMessage(reason))); }
  }
  /** 聚焦原查询编辑器后定位或选中，结果专注模式先恢复编辑区。 */
  async function openEditorPosition(command: keyof typeof sqlPositionActions = 'sql-goto-line', instance = editor.current): Promise<void> {
    if (!instance || instance !== editor.current || !queryMenuCurrent() || fileSource.isBusy()) return;
    const model = instance.getModel(), action = instance.getAction(sqlPositionActions[command]);
    if (!model || model.isDisposed() || !action?.isSupported()) return;
    if (resultsOnly) flushSync(() => setResultsOnly(false));
    if (instance !== editor.current || instance.getModel() !== model || model.isDisposed() || !queryMenuCurrent()) return;
    instance.focus();
    await action.run();
  }
  const queryMenuKey = JSON.stringify([tab.id, tab.connectionId, connectionVersion, sessionId, tab.database, tab.databaseContext, tab.fileSourceBinding, tab.sourceBinding, settings.activeTabId, busy, queryRunning, !!closeRequest, fileSource.busy]);
  /** 只对当前查询已同步的模型调用原生编辑动作，保留原撤销组。 */
  async function editSqlText(command: keyof typeof sqlTextActions | 'sql-toggle-comment' | 'sql-toggle-block-comment', instance = editor.current): Promise<void> {
    const workspace = useWorkspace.getState();
    if (!instance || instance !== editor.current || !queryMenuCurrent() || busyRef.current || workspace.activeJobs[tab.id] || workspace.queryFileOpenings?.[tab.id] || fileSource.isBusy() || formatting.current) return;
    const model = instance.getModel(), draft = workspace.settings.tabs.find(item => item.id === tab.id)?.sql ?? '';
    if (!model || model.isDisposed() || instance.getRawOptions().readOnly || model.getValue() !== draft.replace(/\r\n|\r|\n/g, model.getEOL())) return;
    const caseChange = command === 'sql-uppercase' || command === 'sql-lowercase';
    const selections = instance.getSelections();
    if (!selections?.length || (caseChange ? !hasExplicitCaseSelection(instance) : resultsOnly)) return;
    if (command === 'sql-toggle-block-comment') {
      if (!connection) return;
      try { editSqlBlockComment(instance, connection.dialect); }
      catch (reason) { workspace.notify(errorMessage(reason), true); }
      return;
    }
    const action = instance.getAction(command === 'sql-toggle-comment' ? sqlLineCommentAction(model, selections, sqlite) : sqlTextActions[command]);
    if (!action?.isSupported()) return;
    await action.run();
    if (instance === editor.current && queryMenuCurrent()) instance.focus();
  }
  useEffect(() => {
    if (!searchEditor || busy || closeRequest || fileSource.busy || settings.activeTabId !== tab.id) return;
    let active = true;
    const actions = (['sql-toggle-comment', 'sql-uppercase', 'sql-lowercase'] as const).map((id, order) => searchEditor.addAction({
      id: `dbark-${id}:${uid()}`, label: uiCommandLabels[id], precondition: id === 'sql-toggle-comment' ? '!editorReadonly' : 'editorHasSelection && !editorReadonly', contextMenuGroupId: 'modification', contextMenuOrder: 2 + order,
      run: () => { if (active) return editSqlText(id, searchEditor); },
    }));
    actions.push(searchEditor.addAction({
      id: `dbark-sql-toggle-block-comment:${uid()}`, label: uiCommandLabels['sql-toggle-block-comment'],
      precondition: 'editorHasSelection && !editorHasMultipleSelections && !editorReadonly',
      contextMenuGroupId: 'modification', contextMenuOrder: 2.5,
      run: () => { if (active) return editSqlText('sql-toggle-block-comment', searchEditor); },
    }));
    for (const [order, id] of sqlLineCommandIds.entries()) {
      actions.push(searchEditor.addAction({
        id: `dbark-${id}:${uid()}`, label: uiCommandLabels[id], precondition: '!editorReadonly',
        contextMenuGroupId: 'modification-lines', contextMenuOrder: order,
        run: () => { if (active) return editSqlText(id, searchEditor); },
      }));
    }
    actions.push(searchEditor.addAction({
      id: `dbark-sql-selection-to-snippet:${uid()}`, label: uiCommandLabels['sql-selection-to-snippet'],
      precondition: 'editorHasSelection && !editorHasMultipleSelections && !editorReadonly',
      contextMenuGroupId: 'modification', contextMenuOrder: 6,
      run: () => { if (active) createSnippetFromSelection(searchEditor); },
    }));
    actions.push(searchEditor.addAction({
      id: `dbark-open-selection-query:${uid()}`, label: queryDuplicateZh.selection,
      precondition: 'editorHasSelection && !editorHasMultipleSelections && !editorReadonly',
      contextMenuGroupId: 'modification', contextMenuOrder: 7,
      run: () => { if (active) return duplicateQuery('selection', searchEditor); },
    }));
    return () => { active = false; actions.forEach(action => action.dispose()); };
  }, [searchEditor, queryMenuKey, connection, tab.sql, sqlite, resultsOnly]);
  useEffect(() => {
    if (!searchEditor) return;
    let active = true;
    // 每代动作使用独立命令ID，旧Monaco菜单不能按复用ID调用新目标的处理器。
    const action = searchEditor.addAction({ id: 'dbark-object-definition:' + uid(), label: objectDefinitionZh.entry, contextMenuGroupId: 'navigation', contextMenuOrder: 1.8,
      run: () => { if (active && editor.current === searchEditor) openObjectStructure(searchEditor); },
    });
    return () => { active = false; action.dispose(); };
  }, [searchEditor, queryMenuKey, connection, tab.sql]);
  useEffect(() => {
    if (!searchEditor) return;
    let active = true;
    const action = searchEditor.addAction({ id: 'dbark-syntax-check:' + uid(), label: syntaxText.entry, precondition: '!editorReadonly', contextMenuGroupId: 'navigation', contextMenuOrder: 1.9,
      run: () => { if (active && editor.current === searchEditor) openSyntaxCheck(searchEditor); },
    });
    return () => { active = false; action.dispose(); };
  }, [searchEditor, queryMenuKey, connection, sqlite, syntaxView?.busy, tab.sql]);
  useEffect(() => {
    if (!searchEditor) return; let active = true;
    const action = searchEditor.addAction({ id: 'dbark-statement-navigation:' + uid(), label: navigationText.entry, precondition: '!editorReadonly', contextMenuGroupId: 'navigation', contextMenuOrder: 1.7,
      run: () => { if (active && editor.current === searchEditor) openStatementNavigation(searchEditor); },
    });
    const positions = (['sql-goto-line', ...bracketCommands] as const).map((id, index) => searchEditor.addAction({
      id: `dbark-${id}:${uid()}`, label: uiCommandLabels[id], contextMenuGroupId: 'navigation', contextMenuOrder: 1.6 + index / 100,
      run: () => { if (active) return openEditorPosition(id, searchEditor); },
    }));
    const select = searchEditor.addAction({ id: 'dbark-select-current-statement:' + uid(), label: uiCommandLabels['select-current-statement'], precondition: '!editorReadonly && !editorHasMultipleSelections', contextMenuGroupId: 'navigation', contextMenuOrder: 1.65,
      run: () => { if (active) openStatementNavigation(searchEditor, 'select'); },
    });
    const duplicate = searchEditor.addAction({ id: 'dbark-open-current-statement-query:' + uid(), label: uiCommandLabels['open-current-statement-query'],
      precondition: '!editorReadonly && !editorHasMultipleSelections', contextMenuGroupId: 'navigation', contextMenuOrder: 1.69,
      run: () => { if (active) openStatementNavigation(searchEditor, 'duplicate'); },
    });
    const adjacent = (['previous', 'next'] as const).map((direction, index) => searchEditor.addAction({
      id: `dbark-${direction}-statement:${uid()}`, label: uiCommandLabels[`${direction}-statement`], precondition: '!editorReadonly && !editorHasMultipleSelections', contextMenuGroupId: 'navigation', contextMenuOrder: 1.66 + index / 100,
      run: () => { if (active) openStatementNavigation(searchEditor, direction); },
    }));
    return () => { active = false; action.dispose(); positions.forEach(item => item.dispose()); select.dispose(); duplicate.dispose(); adjacent.forEach(item => item.dispose()); };
  }, [searchEditor, queryMenuKey, connection, navigationView?.busy, tab.sql, resultsOnly]);
  const menuResult = useRef<{ result?: QueryResult; revision: number }>({ revision: 0 });
  if (menuResult.current.result !== sourceResult) menuResult.current = { result: sourceResult, revision: menuResult.current.revision + 1 };
  const resultSqlTarget = menuResult.current;
  const canShowResultSql = !!sourceResult?.statement.trim() && !busy && !queryRunning && (!!pin || !!outcome && !outcome.explain && !outcome.analysis);
  const sqlitePlanRange = pin ? undefined : outcome?.sqliteExplain?.sourceRange;
  const mysqlSourceRange = !sqlite && !pin && !queryRunning && sourceResult === outcome?.results[resultIndex]
    ? outcome?.mysqlResultSourceRanges?.[resultIndex] : undefined;
  const sourceRange = sqliteReceipt?.sourceRange ?? sqlitePlanRange ?? mysqlSourceRange;
  const resultLocation = !busy && !resultModal && !!sourceRange && !!failureLocator?.canLocateRange(sourceRange);
  const canOpenResultStatement = !!onChooseQueryTarget && !queryRunning && !!sourceResult && !pin &&
    !!(sqliteReceipt?.sourceRange ?? mysqlSourceRange) && resultLocation && !fileSource.busy;
  /** 只消费当前结果的原范围，避免拿截断预览或同文的另一条语句创建草稿。 */
  function openResultStatement() {
    if (!canOpenResultStatement || !connection || failureSource.current !== failureLocator ||
        menuResult.current !== resultSqlTarget || !queryMenuCurrent() || fileSource.isBusy()) return;
    const sql = failureLocator?.readRange(sourceRange);
    if (sql === undefined) return;
    try { onChooseQueryTarget?.(resultStatementTargetDraft(tab, sql, connection.dialect)); }
    catch (reason) { setError(errorMessage(reason)); }
  }
  /** 跳转只消费当前结果或计划的原范围，恢复编辑器但不改写正文或布局偏好。 */
  function locateResultSource(): void {
    if (!resultLocation || !sourceRange || !failureLocator || failureSource.current !== failureLocator ||
        menuResult.current !== resultSqlTarget || !queryMenuCurrent() || fileSource.isBusy()) return;
    if (resultsOnly) flushSync(() => setResultsOnly(false));
    editor.current?.layout();
    failureLocator.locateRange(sourceRange);
  }
  /** 从仅显示结果定位错误时，先恢复原编辑器，再按已确认的原范围选中。 */
  function locateScriptFailure(failure: QueryFailure): void {
    if (!scriptFailureRanges.current.has(failure) || !failureLocator?.available() || !failureLocator.bindRange(failure.sourceRange)) return;
    if (resultsOnly) flushSync(() => setResultsOnly(false));
    editor.current?.layout();
    if (failureLocator.locate()) document.getElementById(layoutEditorId)?.scrollIntoView({block: 'nearest'});
  }
  /** 在模态打开前捕获已验证的原语句。正文失效或固定快照仍可展示结果附带文本。 */
  function openResultSql(): void {
    if (!sourceResult || !canShowResultSql || menuResult.current !== resultSqlTarget || busyRef.current || useWorkspace.getState().activeJobs[tab.id] || !queryMenuCurrent()) return;
    const sourceSql = !pin && failureSource.current === failureLocator
      ? failureLocator?.readRange(sqliteReceipt?.sourceRange ?? mysqlSourceRange) : undefined;
    invalidateResultSelection();
    setShowPinSql({ result: sourceResult, statement: sourceResult.statement, sourceSql, taskId: task.current, connectionVersion, pinId: selectedPin, resultIndex });
  }
  /** 旧对话框的关闭动作只消费自己的预览。 */
  function closeResultSql(): void {
    setShowPinSql(current => current === resultSqlPreview ? null : current);
  }
  const resultMenuKey = JSON.stringify([queryMenuKey, menuResult.current.revision, resultIndex, selectedPin, resultSelectionRevision, !!activeColumnLease, !!activeFilterLease, !!activeSortLease]);
  const canDuplicateQuery = !busy && !duplicating && !!connection && !!searchEditor && !closeRequest &&
    duplicateOrigin.current.connectionId === tab.connectionId && duplicateOrigin.current.version === connectionVersion;
  const canExecuteSelection = hasSingleSelection && !resultsOnly && !busy && !!connection && !closeRequest && !fileSource.busy;
  const canCompactSql = !!searchEditor && !resultsOnly && !busy && !closeRequest && !fileSource.busy;
  const canNavigateFromCursor = !!searchEditor && !!connection && !resultsOnly && !busy && !closeRequest && !fileSource.busy && !navigationView?.busy;
  useUiCommandScope(`tab:${tab.id}`, {
    execute: { enabled: !busy && !!connection && !closeRequest && !fileSource.busy, run: () => { void execute(); } },
    'execute-selection': { enabled: canExecuteSelection, run: () => { void execute('selection-only'); } },
    'execute-current': { enabled: !busy && !!connection && !closeRequest && !fileSource.busy, run: () => { void executeCurrentStatement(); } },
    'execute-all': { enabled: !busy && !!connection && !closeRequest && !fileSource.busy, run: () => { void execute('all'); } },
    stop: { enabled: queryRunning, run: () => { void cancelCurrentQuery().catch(reason => setError(errorMessage(reason))); } },
    format: { enabled: !busy && !closeRequest && !fileSource.busy, run: async () => { await formatQuery(); } },
    'compact-sql': { enabled: canCompactSql, run: () => { formatQuery('compact'); } },
    'sql-format-options': { enabled: canCompactSql, run: openFormattingOptions },
    parameters: { enabled: !busy && !!connection && !closeRequest && !fileSource.busy, run: () => openParameters() },
    explain: { enabled: !busy && !!connection && !closeRequest && !fileSource.busy, run: () => { void execute('explain'); } },
    analyze: { enabled: !sqlite && !busy && !!connection && !closeRequest, run: () => { void openAnalyze(); } },
    'transaction-settings': { enabled: !sqlite && !busy && !!connection && !closeRequest, run: openTransactionSettings },
    'save-query': { enabled: !busy && !closeRequest && !fileSource.busy, run: saveCurrentSource },
    'focus-query-pane': { enabled: !!searchEditor && (hasPaneResult || resultsOnly) && !busy && !closeRequest && !fileSource.busy,
      run: () => { focusQueryPane(editor.current?.hasTextFocus() ? 'result' : 'editor'); } },
    find: { enabled: (!!searchEditor || !!selectionBinding) && !closeRequest && !fileSource.busy,
      run: () => { if (queryMenuCurrent() && !openFocusedQueryResultFind(layoutRoot.current)) openEditorFind(); } },
    'statement-navigation': { enabled: !!searchEditor && !!connection && !busy && !closeRequest && !fileSource.busy && !navigationView?.busy, run: () => openStatementNavigation() },
    'select-current-statement': { enabled: canNavigateFromCursor, run: () => openStatementNavigation(editor.current, 'select') },
    'open-current-statement-query': { enabled: canNavigateFromCursor && canDuplicateQuery, run: () => openStatementNavigation(editor.current, 'duplicate') },
    'previous-statement': { enabled: canNavigateFromCursor, run: () => openStatementNavigation(editor.current, 'previous') },
    'next-statement': { enabled: canNavigateFromCursor, run: () => openStatementNavigation(editor.current, 'next') },
    'syntax-check': { enabled: !!searchEditor && !!connection && !busy && !closeRequest && !fileSource.busy && !syntaxView?.busy, run: () => openSyntaxCheck() },
    'object-definition': { enabled: !!searchEditor && !!connection && !busy && !closeRequest && !fileSource.busy && !objectDefinition, run: () => openObjectStructure() },
    replace: { enabled: (!!searchEditor || canReplaceResult) && !closeRequest && !fileSource.busy,
      run: () => runFocusedQueryReplace(layoutRoot.current, openResultReplace, () => openEditorFind(true)) },
    'sql-find-selection': { enabled: canCompactSql && hasSingleSelection, run: () => openEditorFind(false, true) },
    'sql-replace-selection': { enabled: canCompactSql && hasSingleSelection, run: () => openEditorFind(true, true) },
    'sql-goto-line': {
      enabled: (!!selectionBinding || !!searchEditor?.getAction?.(sqlPositionActions['sql-goto-line'])) && !closeRequest && !fileSource.busy,
      run: () => { if (queryMenuCurrent() && !openFocusedGridRowJump()) return openEditorPosition(); },
    },
    ...Object.fromEntries(bracketCommands.map(id => [id, {
      enabled: !!searchEditor?.getAction?.(sqlPositionActions[id])?.isSupported() && !closeRequest && !fileSource.busy,
      run: () => openEditorPosition(id),
    }])),
    'sql-toggle-comment': { enabled: !!searchEditor && !resultsOnly && !busy && !closeRequest && !fileSource.busy, run: () => editSqlText('sql-toggle-comment') },
    'sql-toggle-block-comment': { enabled: !!searchEditor && !!connection && hasSingleSelection && !resultsOnly && !busy && !closeRequest && !fileSource.busy, run: () => editSqlText('sql-toggle-block-comment') },
    ...Object.fromEntries(sqlLineCommandIds.map(id => [id, {
      enabled: !!searchEditor?.getAction?.(sqlTextActions[id])?.isSupported() && !resultsOnly && !busy && !closeRequest && !fileSource.busy,
      run: () => editSqlText(id),
    }])),
    'sql-uppercase': { enabled: hasCaseSelection && !busy && !closeRequest && !fileSource.busy, run: () => editSqlText('sql-uppercase') },
    'sql-lowercase': { enabled: hasCaseSelection && !busy && !closeRequest && !fileSource.busy, run: () => editSqlText('sql-lowercase') },
    ...Object.fromEntries(sqlEditorZoomCommandIds.map(id => [id, {
      enabled: !!searchEditor && !resultsOnly && !busy && !closeRequest && !fileSource.busy,
      run: () => { if (queryMenuCurrent() && !busyRef.current && !fileSource.isBusy()) return editor.current?.getAction(id)?.run(); },
    }])),
    'sql-copy-quoted': { enabled: !!searchEditor && hasSingleSelection && !resultsOnly && !busy && !closeRequest && !fileSource.busy,
      run: () => { if (queryMenuCurrent() && !busyRef.current && !fileSource.isBusy()) return editor.current?.getAction(sqlQuotedCopyAction)?.run(); } },
    'sql-clipboard-stack': { enabled: !!searchEditor && !resultsOnly && !busy && !closeRequest && !fileSource.busy,
      run: () => { if (queryMenuCurrent() && !busyRef.current && !fileSource.isBusy()) return editor.current?.getAction(sqlClipboardStackAction)?.run(); } },
    'sql-selection-to-snippet': { enabled: !!searchEditor && hasSingleSelection && !resultsOnly && !busy && !closeRequest && !fileSource.busy, run: () => createSnippetFromSelection() },
    export: { enabled: !!selectionBinding && !activeColumnLease && !activeFilterLease && !activeSortLease, run: exportVisibleResult },
  }, { active: settings.activeTabId === tab.id && !closeRequest, contextKey: queryMenuKey });
  const draftContext: QueryDatabaseContext = resolveQueryDatabase(tab.database,tab.databaseContext,connectionDatabase(connection));
  const databaseCaption=sessionId?(completionSession?.databaseKnown?completionSession.database||queryContextZh.none:queryContextZh.unknown):draftContext.state==='known'?draftContext.database||queryContextZh.none:queryContextZh.unknown;
  const parameterDialog = parameterFormRef.current;
  const recoveryDialog=recovery&&<Modal title={queryContextZh.title} onClose={()=>setRecovery(false)}><form onSubmit={event=>{event.preventDefault();if(sessionRef.current||busyRef.current)return;rememberDatabase({state:'known',database:sqlite?'main':recoveryDatabase||null});setRecovery(false);setError('');}}><div className="modal-content"><p className="muted small">{sqlite ? sqliteZh.recoveryHint : queryContextZh.hint}</p><Field label={queryContextZh.database}><input autoFocus readOnly={sqlite} value={sqlite ? 'main' : recoveryDatabase} maxLength={256} onChange={event=>setRecoveryDatabase(event.target.value)}/></Field></div><footer className="modal-footer"><span className="grow"/><button type="button" onClick={()=>setRecovery(false)}>{zh.common.cancel}</button><button className="primary" type="submit" disabled={busy}>{queryContextZh.confirm}</button></footer></form></Modal>;
  /** 鼠标和快捷键都清理原结果的选区与快照视图，再显示本次执行的目标结果。 */
  function selectCurrentResult(index: number): void {
    invalidateResultSelection();
    setResultIndex(index);
    setSelectedPin('');
    setShowPinSql(null);
  }

  function pinNavigationCurrent(): boolean {
    return queryMenuCurrent() && !busyRef.current && !queryRunning && !resultModal && !fileSource.isBusy() &&
      !useWorkspace.getState().activeJobs[tab.id] && snapshotView.current.pins === pins;
  }

  /** 固定结果条与查找窗口复用原快照身份和切换流程。 */
  function selectPinnedResult(next?: PinnedQueryResult): void {
    if (snapshotView.current.pins !== pins || next && !pins.includes(next)) return;
    invalidateResultSelection();
    setSelectedPin(next?.id ?? '');
    setShowPinSql(null);
  }

  /** 名称变化不撤销当前网格的选择、筛选或布局，结果仍使用原快照。 */
  function renameSelectedPin(target: PinnedQueryResult, name: string): boolean {
    if (pin !== target || !pinNavigationCurrent()) return false;
    const next = renamePinnedResult(pins, target, name);
    if (!next) return false;
    setPins(next);
    return true;
  }

  return <div ref={layoutRoot} className="workspace-tab query-tab" data-result-layout={resultLayout}
    onKeyDownCapture={event => {
      const focused = () => !!editor.current?.hasTextFocus();
      if (handleQueryExecutionShortcut(event, tab.id, focused)) return;
      if (handleQueryPaneShortcut(event, focused, focusQueryPane)) return;
      if (handleQueryResultReplaceShortcut(event, openResultReplace)) return;
      handleQueryResultShortcut(event, focused, results.length, index => {
        if (busyRef.current || fileSource.isBusy() || !queryMenuCurrent()) return false;
        if (pin || resultIndex !== index) selectCurrentResult(index);
        return true;
      });
    }}>{formatOptions && <QueryFormattingOptionsDialog options={formatOptions} onClose={() => setFormatOptions(undefined)}/>}{objectDefinition && <ObjectDefinitionDialog key={objectDefinition.id} source={objectDefinition} onClose={() => closeObjectStructure(objectDefinition)}/>}<div className="context-bar query-context-bar"><div className="query-context-target"><span className="connection-dot" style={{ background: connection?.color }}/><strong title={connection?.name ?? zh.common.connectionDeleted}>{connection?.name ?? zh.common.connectionDeleted}</strong><ChevronDown size={12}/><span className="breadcrumb-divider">/</span><span className="query-database-caption" aria-label="当前查询默认库" title={databaseCaption}>{databaseCaption}</span></div><QueryFileSourceCaption tab={tab} files={fileSource} compact/><span className="muted small query-session-state" title={sessionId ? zh.query.text008 : zh.query.text009}>{sessionId ? zh.query.text008 : zh.query.text009}</span><ActionMenu label={menuText.sessionOptions} className="query-context-options" contextKey={queryMenuKey} isCurrent={queryMenuCurrent} disabled={resultModal || !!transactionSettingsDialog || !!analyzeDialog || settings.activeTabId !== tab.id || !!closeRequest}><button aria-label={queryDatabaseSwitchZh.open} disabled={busy||!sessionId||!connection||settings.activeTabId!==tab.id||!!closeRequest||!!databaseSwitchDialog} onClick={openDatabaseSwitch}>{queryDatabaseSwitchZh.open}</button>{!sessionId&&draftContext.state==='unknown'&&<button disabled={busy} onClick={()=>{invalidateResultSelection();setRecoveryDatabase('');setRecovery(true);}}>{queryContextZh.choose}</button>}<button disabled={busy||!sessionId} title={!sessionId?sessionObjectsZh.needsSession:sessionObjectsZh.title} onClick={()=>{invalidateResultSelection();setSessionObjects(true);}}>{sessionObjectsZh.open}</button><div className="query-execution-options query-menu-options" role="group" aria-label={menuText.executionOptions}>{!sqlite && <label className="check" title={queryWarningsZh.hint}><input type="checkbox" aria-label={queryWarningsZh.option} checked={collectWarnings} disabled={busy || parameterSource !== null} onChange={event => { if (!busyRef.current && parameterSource === null) setCollectWarnings(event.target.checked); }}/>{queryWarningsZh.option}</label>}
        {!sqlite && <label className="check" title={mysqlQueryStatusZh.hint}>
          <input type="checkbox" aria-label={mysqlQueryStatusZh.collect} checked={collectStatus} disabled={busy || parameterSource !== null}
            onChange={event => { if (!busyRef.current && parameterSource === null) setCollectStatus(event.target.checked); }}/>{mysqlQueryStatusZh.collect}
        </label>}
        {!sqlite && <label className="check" title={mysqlQueryStatusZh.stageHint}>
          <input type="checkbox" aria-label={mysqlQueryStatusZh.collectStages} checked={collectStages} disabled={busy || parameterSource !== null}
            onChange={event => { if (!busyRef.current && parameterSource === null) setCollectStages(event.target.checked); }}/>{mysqlQueryStatusZh.collectStages}
        </label>}<label className="check" title={sqlite ? queryContinueOnErrorZh.sqliteHint : queryContinueOnErrorZh.hint}><input type="checkbox" aria-label={queryContinueOnErrorZh.option} checked={continueOnError} disabled={busy || parameterSource !== null} onChange={event => { if (!busyRef.current && parameterSource === null) setContinueOnError(event.target.checked); }}/>{queryContinueOnErrorZh.option}</label>{sqlite && <label className="inline-field" title={sqliteZh.statementTimeoutHint}>{sqliteZh.statementTimeout}
        <input type="number" aria-label={sqliteZh.statementTimeout} min={0} max={sqliteStatementTimeoutMaximumMs} step={1}
          disabled={busy || parameterSource !== null} value={sqliteStatementTimeoutMs || ''} placeholder="0"
          onChange={event => {
            const value = event.target.value === '' ? 0 : event.target.valueAsNumber;
            if (!busyRef.current && parameterSource === null && (value === 0 || validSqliteStatementTimeout(value))) setSqliteStatementTimeoutMs(value);
          }}/>
      </label>}</div></ActionMenu></div><QueryFileActions tab={tab} files={fileSource} renderActions={fileActions => <AdaptiveToolbar
      className="toolbar query-primary-toolbar" ariaLabel={menuText.queryToolbar} contextKey={queryMenuKey} isCurrent={queryMenuCurrent}
      items={[
        { key: 'execute', content: (<div className="query-execute-split"><button className="primary" disabled={busy || !connection} onClick={() => void execute()}><Play size={14}/>{zh.query.text010}<kbd>⌘ / Ctrl ↵</kbd></button><ActionMenu label={menuText.executeOptions} disabled={busy || !connection} contextKey={queryMenuKey} isCurrent={queryMenuCurrent}><button disabled={busy || !connection} title={menuText.selectedOrScriptHint} onClick={() => void execute()}>{menuText.selectedOrScript}</button><button disabled={!canExecuteSelection} title={currentStatementZh.selectionHint} onClick={() => void execute('selection-only')}>{currentStatementZh.selectionOnly}</button><button disabled={busy || !connection || !!closeRequest || fileSource.busy} title={currentStatementZh.hint} aria-label={currentStatementZh.action} onClick={() => void executeCurrentStatement()}><Play size={14}/>{currentStatementZh.action}</button><button disabled={busy || !connection || !!closeRequest || fileSource.busy} onClick={() => openParameters('current')}>{parameterZh.currentOpen}</button><button disabled={busy} onClick={() => void execute('all')}>{zh.query.text011}</button></ActionMenu></div>), overflow: (<ActionMenuSection label={menuText.executeOptions}><button className="primary" disabled={busy || !connection} onClick={() => void execute()}><Play size={14}/>{zh.query.text010}<kbd>⌘ / Ctrl ↵</kbd></button>
<button disabled={!canExecuteSelection} title={currentStatementZh.selectionHint} onClick={() => void execute('selection-only')}>{currentStatementZh.selectionOnly}</button><button disabled={busy || !connection || !!closeRequest || fileSource.busy} title={currentStatementZh.hint} aria-label={currentStatementZh.action} onClick={() => void executeCurrentStatement()}><Play size={14}/>{currentStatementZh.action}</button><button disabled={busy || !connection || !!closeRequest || fileSource.busy} onClick={() => openParameters('current')}>{parameterZh.currentOpen}</button>
<button disabled={busy} onClick={() => void execute('all')}>{zh.query.text011}</button></ActionMenuSection>) },
        { key: 'stop', content: (<button disabled={!queryRunning} onClick={() => void cancelCurrentQuery().catch(reason => setError(errorMessage(reason)))}><Square size={13}/>{zh.common.stop}</button>) },
        { key: 'format', content: (<button disabled={busy} title={sqlFormattingZh.hint} aria-label={sqlFormattingZh.action} onClick={() => formatQuery()}><AlignLeft size={15}/>{sqlFormattingZh.button}</button>) },
        { key: 'save', content: (<button disabled={busy} onClick={saveCurrentSource} title={tab.fileSourceBinding ? queryFilesZh.save : zh.query.text015} aria-label={tab.fileSourceBinding ? queryFilesZh.save : zh.query.text015}><Save size={15}/>{zh.common.save}</button>) }
      ]}
      moreLabel={menuText.queryMore}
      more={<>
        {onCreateView && <button disabled={busy || !connection || !searchEditor || resultsOnly || fileSource.busy || !!closeRequest || (connection.dialect === 'sqlite' && connection.sqlite.readOnly)}
          title={queryViewText.hint} onClick={openViewDesign}>{queryViewText.entry}</button>}
        <button disabled={!canCompactSql} onClick={openFormattingOptions}>{sqlFormattingZh.options}</button>
        <button disabled={!canCompactSql} title={sqlFormattingZh.compactHint} onClick={() => formatQuery('compact')}>{sqlFormattingZh.compact}</button>
        <ActionMenuSection label={navigationText.group}><button disabled={busy || !connection || !searchEditor || navigationView?.busy} onClick={() => openStatementNavigation()}>{navigationText.entry}</button><button disabled={!canNavigateFromCursor} onClick={() => openStatementNavigation(editor.current, 'previous')}>{uiCommandLabels['previous-statement']}</button><button disabled={!canNavigateFromCursor} onClick={() => openStatementNavigation(editor.current, 'next')}>{uiCommandLabels['next-statement']}</button></ActionMenuSection><ActionMenuSection label={sqlite ? sqliteSyntaxCheckZh.title : syntaxText.title}><button disabled={busy || !connection || !searchEditor || syntaxView?.busy} onClick={() => openSyntaxCheck()}>{syntaxText.entry}</button></ActionMenuSection><ActionMenuSection label={objectDefinitionZh.title}><button disabled={busy || !connection || !searchEditor} onClick={() => openObjectStructure()}>{objectDefinitionZh.entry}</button></ActionMenuSection>
        <ActionMenuSection label={menuText.execution}>{sqlite && <>
          <button disabled={busy || !connection} title={sqliteQueryExportZh.title} onClick={() => openSqliteFullExport()}><Download size={14}/>{sqliteQueryExportZh.open}</button>
          <button disabled={!canNavigateFromCursor} onClick={() => openSqliteFullExport('current')}><Download size={14}/>{sqliteQueryExportZh.openCurrent}</button>
        </>}{!sqlite && <button disabled={busy || !connection} title={queryStreamZh.title} aria-label={queryStreamZh.open} onClick={openStreamExport}><Download size={14}/>{queryStreamZh.open}</button>}
<button aria-label={parameterZh.open} disabled={busy || !connection || !!closeRequest || fileSource.busy} onClick={() => openParameters()}><Braces size={14}/>{parameterZh.open}</button>
{!sqlite && <button disabled={busy || !connection || !!closeRequest} onClick={openTransactionSettings}>{queryTransactionSettingsZh.open}</button>}
<button disabled={busy || !connection || !!closeRequest || fileSource.busy} onClick={() => void execute('explain')}><Gauge size={15}/>{zh.query.text014}</button>
{sqlite && <button disabled={!canNavigateFromCursor} title={sqliteExplainZh.currentHint} onClick={() => void executeCurrentStatement('explain-current')}><Gauge size={15}/>{sqliteExplainZh.current}</button>}
{!sqlite && <button disabled={busy || !connection || !!closeRequest} onClick={() => void openAnalyze()}><Gauge size={15}/>{queryAnalyzeZh.open}</button>}</ActionMenuSection>
        <ActionMenuSection label={menuText.files}>{fileActions}
{tab.fileSourceBinding && <button disabled={busy || fileSource.busy} title={queryFilesZh.librarySave} aria-label={queryFilesZh.librarySave} onClick={() => { invalidateResultSelection(); setQueryName(tab.title); setSave(true); }}>{queryFilesZh.librarySave}</button>}</ActionMenuSection>
        <ActionMenuSection label={menuText.library}><button disabled={!canDuplicateQuery} title={queryDuplicateZh.hint} aria-label={queryDuplicateZh.action} onClick={() => void duplicateQuery()}><Copy size={14}/>{queryDuplicateZh.action}</button>
<button disabled={!canDuplicateQuery || !hasSingleSelection || resultsOnly || fileSource.busy}
  title={queryDuplicateZh.selectionHint} onClick={() => void duplicateQuery('selection')}>{queryDuplicateZh.selection}</button>
<button disabled={!canDuplicateQuery || !canNavigateFromCursor} title={queryDuplicateZh.statementHint}
  onClick={() => openStatementNavigation(editor.current, 'duplicate')}>{uiCommandLabels['open-current-statement-query']}</button>
{onChooseQueryTarget && <button disabled={!canDuplicateQuery || fileSource.busy}
  title={queryDuplicateZh.targetHint} onClick={() => void duplicateQuery('target')}>{queryDuplicateZh.targetAction}</button>}
<button title={zh.snippets.title} aria-label={zh.snippets.title} disabled={busy || resultModal || resultsOnly || fileSource.busy} onClick={() => openSnippets()}><BookOpen size={15}/></button>
<button onClick={() => { if (queryMenuCurrent()) onHistory(); }} aria-label={historyPagesZh.queryHistory} title={historyPagesZh.queryHistory}><History size={15}/></button></ActionMenuSection>
      </>}
    />}/>{!sqlite && collectWarnings && <aside className="info-strip" role="note" aria-label={queryWarningsZh.notice} style={{ margin: '0 12px 8px', padding: '8px 12px', fontSize: 11, lineHeight: 1.6, maxHeight: 72, overflow: 'auto', flexShrink: 0 }}>{queryWarningsZh.hint}</aside>}<div className="query-layout-panes"><div className="query-layout-editor" style={resultLayout === 'beside' ? { width: editorWidth } : undefined}><SavedQueryMatchNavigation tabId={tab.id} source={searchNavigation} editor={searchEditor}/><div id={layoutEditorId} className="sql-editor-wrap query-editor-region" style={resultLayout === 'below' ? { height: editorHeight } : undefined}>{fileOpening ? <Spinner text={queryFilesZh.opening}/> : <SqlEditor queryTabId={tab.id} clipboardDisabled={busy || resultModal || resultsOnly || fileSource.busy} value={tab.sql ?? ''} onChange={sql => useWorkspace.getState().updateTab(tab.id, { sql })} onReady={instance => { attachQueryEditor(instance); parameterReuse.current?.observe(); }} onExecute={() => void execute()} onExecuteCurrent={() => void executeCurrentStatement()} onSelectCurrent={() => openStatementNavigation(editor.current, 'select')} onFormat={formatQuery} onToggleComment={() => editSqlText('sql-toggle-comment')} onToggleBlockComment={() => editSqlText('sql-toggle-block-comment')} snippetCompletion={!busy && !fileSource.busy && !closeRequest && !resultsOnly && settings.activeTabId === tab.id} dialect={connection?.dialect} mysqlMode={mysqlEditorMode} completion={!busy&&connection?{connectionId:tab.connectionId,connectionVersion,database:draftContext.state==='known'?draftContext.database??undefined:undefined,databaseUnknown:draftContext.state==='unknown',sessionId:sessionId||undefined}:undefined} onCompletionStatus={setCompletionStatus} onSelectionState={updateSelectionState}/>}{navigationView && navigationIntent.current && <StatementNavigationPanel key={navigationIntent.current.id} source={navigationIntent.current.source} dialect={navigationIntent.current.dialect} view={navigationView} cursor={navigationCursor} position={offset => { const model = navigationIntent.current?.model; return model && !model.isDisposed() ? model.getPositionAt(offset) : { lineNumber: 1, column: 1 }; }} onNavigate={navigateStatement} onExtract={extractNavigationStatements} onRefresh={() => openStatementNavigation()} onCancel={() => navigationIntent.current?.controller.stop()} onClose={closeStatementNavigation}/>}</div>{syntaxView && <SqlSyntaxCheckPanel dialect={sqlite ? 'sqlite' : undefined} view={syntaxView} position={offset => { const model = syntaxIntent.current?.model; return model && !model.isDisposed() ? model.getPositionAt(offset) : { lineNumber: 1, column: 1 }; }} onSelect={selectSyntaxIssue} onCancel={() => syntaxIntent.current?.controller.stop()} onClose={closeSyntaxCheck} onRecheck={() => openSyntaxCheck()}/>}</div>{resultLayout === 'below' && <QueryLayoutSplitter key="height" value={preferredEditorHeight} min={queryLayoutLimits.minEditorHeight} max={layoutMaximum} defaultValue={queryLayoutLimits.defaultEditorHeight} controls={layoutEditorId} scope={layoutScope} disabled={layoutActiveTab!==tab.id||!connection||!!closeRequest} begin={beginEditorLayout} onPreview={setEditorPreview}/>}{resultLayout === 'beside' && <QueryLayoutSplitter key="width" dimension="width" value={preferredEditorWidth} min={queryLayoutWidthLimits.minEditorWidth} max={widthMaximum} defaultValue={queryLayoutWidthLimits.defaultEditorWidth} controls={layoutEditorId} scope={layoutScope} disabled={layoutActiveTab!==tab.id||!connection||!!closeRequest} begin={cancel => beginEditorLayout(cancel, 'width')} onPreview={setEditorWidthPreview}/>}<div className="query-layout-results"><QueryResultSnapshotActions result={queryRunning ? undefined : sourceResult} canSaveShown={!!exportable && !!visibleColumns.length} disabled={busy || resultModal || settings.activeTabId !== tab.id} begin={beginResultSnapshot} renderActions={snapshotActions => <div className="result-toolbar query-result-toolbar">
      <span className="result-label">{zh.query.text016}</span><div className="query-result-tabs">{resultNames.map((name, index) => {
        const ordinal = `${zh.query.text017}${index + 1}`;
        const label = name ? formatText(zh.query.namedResultLabel, ordinal, name) : undefined;
        return <button className={!pin && resultIndex === index ? 'selected' : ''} aria-label={label} title={label}
          aria-pressed={!pin && resultIndex === index} onClick={() => selectCurrentResult(index)} key={index}>{name ?? ordinal}</button>;
      })}</div>
      {(results.length > 1 || pins.length > 0) && <QueryResultNavigator tabId={tab.id} results={results} names={resultNames}
        selected={pin ? undefined : resultIndex} pins={pins} selectedPin={pin}
        disabled={busy || queryRunning || resultModal || fileSource.busy}
        isCurrent={pinNavigationCurrent} onSelect={selectCurrentResult} onSelectPin={selectPinnedResult}/>}
      {pin && <PinnedResultRename tabId={tab.id} pin={pin} disabled={busy || queryRunning || resultModal || fileSource.busy}
        isCurrent={pinNavigationCurrent} onRename={renameSelectedPin}/>}
      <ActionMenu label={queryLayoutZh.placement} contextKey={JSON.stringify([queryMenuKey, resultLayout, preferredPlacement])} isCurrent={queryMenuCurrent}>
        {(['below', 'beside', 'results'] as const).map(value => <button key={value} className={(resultsOnly ? 'results' : preferredPlacement) === value ? 'selected' : undefined} onClick={() => changeResultLayout(value)} title={value === 'beside' && !besideAvailable ? queryLayoutZh.besideNarrow : undefined}>{queryLayoutZh[value]}</button>)}
      </ActionMenu>
      <AdaptiveToolbar className="query-result-actions" ariaLabel={menuText.resultToolbar} contextKey={resultMenuKey} isCurrent={queryMenuCurrent}
        items={[
          { key: 'filter', content: (<button disabled={!filterBinding||!selectionBinding||busy||!!activeColumnLease||!!activeFilterLease||!!activeSortLease} title={!filterBinding?filterText.unavailable:filterText.hint} onClick={openFilterPanel}>{filterText.open}</button>) },
          { key: 'sort', content: (<button disabled={!sortBinding||!filterBinding||!selectionBinding||busy||!!activeColumnLease||!!activeFilterLease||!!activeSortLease} title={queryResultSortScope(viewSource)} onClick={openSortPanel}>{sortText.panelTitle}</button>) },
          { key: 'columns', content: (<button disabled={!selectionBinding||busy||!!activeColumnLease||!!activeFilterLease||!!activeSortLease} onClick={openColumnManager}>{columnText.open}</button>) },
          { key: 'export', content: (<button disabled={!selectionBinding||!!activeColumnLease||!!activeFilterLease||!!activeSortLease} onClick={exportVisibleResult}><Download size={12}/>{zh.resultExport.title}</button>) }
        ]}
        moreLabel={menuText.resultMore}
        more={<>
          <ActionMenuSection label={menuText.resultView}>{<button disabled={busy||pins.length<2||!!comparisonLease||!!statisticsLease} title={comparisonText.notice} onClick={openResultComparison}>{comparisonText.open}</button>}{outcome?.warnings && !pin && <button disabled={busy || !!pin || !warningsReportAvailable() || !!closeRequest} onClick={openWarningsReport}>{queryWarningsZh.open}</button>}
<button disabled={busy || !outcome || !result?.columns.length || !!pin} title={zh.query.pinHint} onClick={pinResult}><Pin size={12}/>{zh.query.pinResult}</button>
{resultOrigins && <button onClick={() => { if (outcome && queryMenuCurrent() && !busyRef.current) setOriginDialog({ outcome, index: resultIndex }); }}>{originsText.open}</button>}
{mysqlOrigins && <button onClick={() => {
  if (outcome && sessionRef.current && queryMenuCurrent() && !busyRef.current)
    setOriginDialog({ outcome, index: resultIndex, mysql: { sessionId: sessionRef.current, executionId: task.current } });
}}>{mysqlOriginsText.open}</button>}
{(pin || sourceResult) && <button disabled={!canShowResultSql} onClick={openResultSql}>{pin ? zh.query.pinnedStatement : zh.query.resultSql}</button>}
{mysqlSourceRange && <button disabled={!resultLocation} title={resultLocation ? undefined : sourceLocationText.resultUnavailable}
  onClick={locateResultSource}>{sourceLocationText.locateResult}</button>}
{mysqlSourceRange && onChooseQueryTarget && <button disabled={!canOpenResultStatement}
  title={canOpenResultStatement ? queryDuplicateZh.resultStatementHint : queryDuplicateZh.resultStatementUnavailable}
  onClick={openResultStatement}>{queryDuplicateZh.resultStatement}</button>}
<button disabled={!activeDetailRow || activeDetailRow.binding !== detailBinding || !rowDetailAllowed(detailBinding)} title={rowDetailsText.choose} onClick={openRowDetail}>{rowDetailsText.open}</button>{recordEditTable && <button disabled={!activeDetailRow || activeDetailRow.binding !== detailBinding || !rowDetailAllowed(detailBinding)}
  onClick={openQueryRecord}>{outcome?.sqliteQueryJoined ? originsText.editJoin : originsText.editRecord}</button>}
{recordTable && <button disabled={!activeDetailRow || activeDetailRow.binding !== detailBinding || !rowDetailAllowed(detailBinding)}
  title={rowDetailsText.choose} onClick={openQueryRelation}>{relationText.entry}</button>}
{recordEditTable && <button className="danger" disabled={!selectedExportCount || selectedExportCount > sqliteQueryEditMaxRows}
  title={originsText.deleteLimit} onClick={() => openSqliteCheckedRecords('delete')}>{outcome?.sqliteQueryJoined ? originsText.deleteCheckedJoin : originsText.deleteChecked}</button>}
{recordEditTable && !sourceResult?.truncated && <button disabled={!selectedExportCount || selectedExportCount > sqliteQueryEditMaxRows}
  title={originsText.deleteLimit} onClick={() => openSqliteCheckedRecords('duplicate')}>{outcome?.sqliteQueryJoined ? originsText.duplicateCheckedJoin : originsText.duplicateChecked}</button>}
{mysqlRelationAvailable && !mysqlJoinColumns && (['parent', 'children'] as const).map(direction => <button key={direction}
  disabled={!activeDetailRow || activeDetailRow.binding !== detailBinding || !rowDetailAllowed(detailBinding)}
  title={rowDetailsText.choose} onClick={() => openMysqlRelation(direction)}>{mysqlRelationText[direction]}</button>)}
{mysqlRelationAvailable && <button disabled={!activeDetailRow || activeDetailRow.binding !== detailBinding || !rowDetailAllowed(detailBinding)}
  title={rowDetailsText.choose} onClick={() => openMysqlRelation('edit')}>{mysqlJoinColumns ? mysqlEditText.editJoin : mysqlEditText.edit}</button>}
{canReplaceResult && <button disabled={!!replaceLookup} onClick={openResultReplace}>{sqlite ? originsText.replaceOpen : mysqlBatchText.replaceOpen}</button>}
{canPrepareQueryRowSql && <button disabled={queryRowSqlCount > copyInsertSqlLimits.rows ||
  !queryRowSqlCount && (!activeDetailRow || activeDetailRow.binding !== detailBinding)}
  onClick={openQueryRowSql}>{queryRowSqlText.open}</button>}
{mysqlRelationAvailable && <button className="danger" disabled={!selectedExportCount || selectedExportCount > mysqlQueryBatchLimits.rows}
  title={mysqlBatchText.deleteLimit} onClick={() => openMysqlCheckedRecords('delete')}>{mysqlJoinColumns ? mysqlBatchText.deleteCheckedJoin : mysqlBatchText.deleteChecked}</button>}
{mysqlRelationAvailable && !mysqlJoinColumns && <button disabled={!selectedExportCount || selectedExportCount > mysqlQueryBatchLimits.rows}
  title={mysqlBatchText.deleteLimit} onClick={() => openMysqlCheckedRecords('insert')}>{mysqlBatchText.insert}</button>}
{sqliteInsertTable && <button disabled={resultModal} onClick={openSqliteNewRecord}>{originsText.insertOpen}</button>}
{mysqlInsertAvailable && <button disabled={resultModal} onClick={openMysqlNewRecord}>{mysqlBatchText.new}</button>}</ActionMenuSection>
          <ActionMenuSection label={menuText.resultHistory}><button title={resultHistory.limited?historyText.limited:historyText.hint} disabled={!selectionBinding||busy||!!activeColumnLease||!!activeFilterLease||!!activeSortLease||!resultHistory.target(historyBinding,-1)} onClick={()=>travelResultHistory(-1)}>{historyText.undo}</button>
<button title={historyText.hint} disabled={!selectionBinding||busy||!!activeColumnLease||!!activeFilterLease||!!activeSortLease||!resultHistory.target(historyBinding,1)} onClick={()=>travelResultHistory(1)}>{historyText.redo}</button>{sourceResult?.columns.length&&(pin||!(outcome?.explain||outcome?.analysis||outcome?.sqliteExplain))?<button disabled={!filterView?.rules.length||!!activeFilterLease||!!activeColumnLease||!!activeSortLease} onClick={clearResultFilter}>{filterText.clear}</button>:null}{sourceResult?.columns.length&&(pin||!(outcome?.explain||outcome?.analysis||outcome?.sqliteExplain))?<button disabled={!historyBinding||!selectionBinding||busy||!!activeColumnLease||!!activeFilterLease||!!activeSortLease} title={presetsText.hint} onClick={openResultPresets}>{presetsText.open}</button>:null}
{sourceResult?.columns.length&&(pin||!(outcome?.explain||outcome?.analysis||outcome?.sqliteExplain))?<><button disabled={!historyBinding||!selectionBinding||busy||!!activeColumnLease||!!activeFilterLease||!!activeSortLease} title={memoryText.hint} onClick={rememberResultOrganization}>{memoryText.save}</button></>:null}{resultMemory&&<><button disabled={!historyBinding||!selectionBinding||busy||!!activeColumnLease||!!activeFilterLease||!!activeSortLease||!queryResultMemoryMatches(resultMemory,viewSource,visibleColumns)} title={queryResultMemoryMatches(resultMemory,viewSource,visibleColumns)?memoryText.scope:memoryText.mismatch} onClick={applyRememberedOrganization}>{memoryText.apply}</button><button disabled={!rememberedOrganizationCanDiscard()} onClick={discardRememberedOrganization}>{memoryText.clear}</button></>}<div className="action-menu-field" role="group" aria-label={zh.app.text020}><label className="inline-field">{zh.query.text020}<input aria-label={zh.query.text021} type="number" min="1" max="100000" value={settings.resultLimit} onChange={event => useWorkspace.getState().updateSettings({ resultLimit: Math.max(1, Math.min(100000, Number(event.target.value))) })}/>{zh.query.text022}</label></div></ActionMenuSection>
          <ActionMenuSection label={menuText.resultTransfer}>{archiveAvailable && <button onClick={() => { if (queryMenuCurrent() && !busyRef.current && outcome) setArchiveOutcome(outcome); }}>{archiveText.open}</button>}<button disabled={!selectedExportCount || busy} onClick={exportSelectedRows}>{zh.resultExport.selectedTitle}</button>
{connection && connection.dialect !== 'postgresql' && !pin && <button disabled={busy || !selectionBinding ||
  sqlite && !selectionBinding.result.sqliteStorage || !selectedExportCount ||
  selectedExportCount > postgresTableLimits.changes || selectionBinding.visibleColumns.length > postgresTableLimits.fields}
  title={transferText.limits} onClick={captureQueryTransfer}>{transferText.queryCapture}</button>}
{!sqlite && <button aria-label={resultInsertZh.open} disabled={!selectionBinding || !exportable?.rows.length || busy || !!resultInsertSource || !!activeColumnLease || !!activeFilterLease || !!activeSortLease} onClick={() => openResultInsert(false)}>{resultInsertZh.open}</button>}
{!sqlite && <button aria-label={resultInsertZh.selected} disabled={!selectedExportCount || busy || !!resultInsertSource} onClick={() => openResultInsert(true)}>{resultInsertZh.selected}</button>}</ActionMenuSection>
          <ActionMenuSection label={menuText.snapshots}>{snapshotActions}</ActionMenuSection>
        </>}/>

    </div>}/>{pins.length > 0 && <div className="pinned-results" role="group" aria-label={zh.query.pinSection}><span>{zh.query.pinSection}</span><button className={`current-results ${!pin ? 'selected' : ''}`} aria-pressed={!pin} onClick={() => selectPinnedResult()}>{zh.query.currentResults}</button>{pins.map(item => <div key={item.id} className={`pinned-result ${pin?.id === item.id ? 'selected' : ''}`}><button aria-pressed={pin?.id === item.id} title={pinnedResultTooltip(item)} onClick={() => selectPinnedResult(item)}><Pin size={11}/>{item.label}</button><button aria-label={formatText(zh.query.releasePin, item.label)} onClick={() => releasePin(item.id)}><X size={11}/></button></div>)}</div>}<ErrorBox message={error}/>{!queryRunning && (outcome?.mysqlQueryStatus || interruptedStatus?.taskId === task.current && interruptedStatus.report) &&
        <MysqlQueryStatus key={task.current} report={outcome?.mysqlQueryStatus ?? interruptedStatus!.report}/>}
      {outcome?.scriptReport && <QueryContinueOnErrorNotice report={outcome.scriptReport} completedResults={outcome.results.length} locateAvailable={failure => scriptFailureRanges.current.has(failure) && !!failureLocator?.available()} onLocate={locateScriptFailure}/>}{outcome?.failure && !outcome.scriptReport && <QueryPartialOutcomeNotice failure={outcome.failure} completedResults={outcome.results.length} locateAvailable={!!failureLocator?.available()} onLocate={() => { failureLocator?.locate(); }}/>}<div className="query-result-filter-bar">{sourceResult?.columns.length&&(pin||!(outcome?.explain||outcome?.analysis||outcome?.sqliteExplain))?<><span>{filterText.counts(sourceResult.rows.length,filterView?.result.rows.length??sourceResult.rows.length)}</span>{sourceResult.truncated&&<strong>{filterText.truncated}</strong>}</>:null}{resultMemory&&<span role="status" title={memoryText.hint}>{memoryText.saved}</span>}</div>{activeFilterLease&&<QueryResultFilterPanel binding={activeFilterLease.binding} initial={activeFilterLease.view} seed={activeFilterLease.seed} isCurrent={()=>filterPanelCurrent(activeFilterLease)} onApply={expression=>applyFilterRules(activeFilterLease,expression)} onClose={()=>closeFilterPanel(activeFilterLease)}/>}{activeSortLease&&<QueryResultSortPanel binding={activeSortLease.binding} initial={activeSortLease.view} isCurrent={()=>sortPanelCurrent(activeSortLease)} onApply={rules=>applySortPanel(activeSortLease,rules)} onClose={()=>closeSortPanel(activeSortLease)}/>}<div className="query-result-sort-scope">{result?.columns.length && (pin || !(outcome?.explain || outcome?.analysis)) && (!!sortView?.rules.length || !sortBinding && sourceExportable && settings.activeTabId === tab.id && !resultModal) ? <>{!sortBinding && sourceExportable && settings.activeTabId === tab.id && !resultModal && <strong>{sortText.budget}</strong>}<button disabled={!sortView?.rules.length || !selectionBinding || !!activeColumnLease || !!activeFilterLease} onClick={() => sortResult([])}>{sortText.clear}</button>{!!sortView?.rules.length && <ol className="query-result-sort-priorities" aria-label={sortText.priorities}>{sortView.rules.map((rule,index)=>{
    const column=sourceResult?.columns.find(column=>column.key===rule.column),name=column?.name ?? rule.column;
    return <li key={rule.column}>
      <span>{sortText.priority(index+1,name)} · {rule.direction==='ASC'?sortText.ascending:sortText.descending}</span>
      <select aria-label={sortText.nulls(index+1,name)} title={sortText.nullsHint} value={rule.nulls??''} disabled={!!activeColumnLease||!!activeFilterLease||!!activeSortLease} onChange={event=>changeSortNulls(index,event.target.value)}><option value="">{sortText.nullsDefault}</option><option value="FIRST">{sortText.nullsFirst}</option><option value="LAST">{sortText.nullsLast}</option></select>
      {column&&queryResultSortSupportsIgnoreCase(column)&&<label title={column.type === 'SQLITE' ? sortText.sqliteCaseHint : sortText.caseHint}><input type="checkbox" aria-label={sortText.ignoreCase(index+1,name)} checked={rule.ignoreCase===true} disabled={!!activeColumnLease||!!activeFilterLease||!!activeSortLease} onChange={event=>changeSortCase(index,event.target.checked)}/>{sortText.ignoreCaseLabel}</label>}
      <button disabled={!!activeColumnLease||!!activeFilterLease||!!activeSortLease} aria-label={sortText.changeDirection(index+1,name)} onClick={()=>sortResult(sortView.rules.map((item,i)=>i===index?{...item,direction:item.direction==='ASC'?'DESC':'ASC'}:item))}>{rule.direction==='ASC'?'↑':'↓'}</button>
      <button disabled={!!activeColumnLease||!!activeFilterLease||!!activeSortLease||index===0} aria-label={sortText.earlier(index+1,name)} onClick={()=>moveSortPriority(index,-1)}>←</button>
      <button disabled={!!activeColumnLease||!!activeFilterLease||!!activeSortLease||index===sortView.rules.length-1} aria-label={sortText.later(index+1,name)} onClick={()=>moveSortPriority(index,1)}>→</button>
      <button disabled={!!activeColumnLease||!!activeFilterLease||!!activeSortLease} aria-label={sortText.remove(index+1,name)} onClick={()=>sortResult(sortView.rules.filter((_,i)=>i!==index))}>×</button>
    </li>;
  })}</ol>}</> : null}</div>
      {sqliteReceipt && sourceResult && <div className="info-strip" role="group" aria-label={sqliteZh.queryReceipt}>
        {sqliteZh.receiptOrdinal(sqliteReceipt.statementOrdinal ?? resultIndex + 1)} · {sqliteZh.receiptElapsed(sourceResult.elapsedMs)}
        {sourceResult.columns.length ? ' · ' + sqliteZh.receiptRows(sqliteReceipt.producedRows, sourceResult.rows.length) : ''}
        {' · '}<span title={sqliteZh.receiptChangeHint}>{sqliteZh.receiptChanges(sqliteReceipt.changedRows)}</span>
        {' '}<button disabled={!resultLocation} title={resultLocation ? undefined : sqliteZh.resultLocateUnavailable}
          onClick={locateResultSource}>{sqliteZh.resultLocate}</button>
        {onChooseQueryTarget && <button disabled={!canOpenResultStatement}
          title={canOpenResultStatement ? queryDuplicateZh.resultStatementHint : queryDuplicateZh.resultStatementUnavailable}
          onClick={openResultStatement}>{queryDuplicateZh.resultStatement}</button>}
      </div>}
      {sqlitePlanRange && <div className="info-strip">
        <button disabled={!resultLocation} title={resultLocation ? undefined : sqliteZh.resultLocateUnavailable}
          onClick={locateResultSource}>{sqliteExplainZh.locate}</button>
      </div>}
      {filterBinding && organizedResult && keywordFilter.result && <QueryResultKeyword key={keywordFilter.generation}
        keyword={keywordFilter.keyword} total={organizedResult.rows.length} matched={keywordFilter.result.rows.length}
        disabled={!selectionBinding || busy || !!activeColumnLease || !!activeFilterLease || !!activeSortLease}
        onApply={keyword => !columnLeaseRef.current && resultSelectionAllowed(selectionBinding) &&
          keywordFilter.apply(keyword, invalidateResultSelection)} />}
      {recordEditTable && <span className="muted small">{originsText.inlineHint}</span>}
      {mysqlRelationAvailable && <span className="muted small">{mysqlEditText.inlineHint}</span>}
      {replaceLookup && <Spinner text={mysqlBatchText.replaceRead}/>}
      {activeMysqlOrigins && <MysqlResultOriginsDialog result={activeMysqlOrigins.result} origins={activeMysqlOrigins.origins}
        resolve={async (columnIndex, taskId) => {
          if (!mysqlOriginCurrent(activeMysqlOrigins)) throw Error(mysqlOriginsText.stale);
          const origin = activeMysqlOrigins.origins[columnIndex];
          if (origin?.scope !== 'catalog') throw Error(mysqlOriginsText.stale);
          const job = acquireWorkspaceBusy(tab.id);
          try {
            const target = await invoke('mysql.resultOriginOpen', { connectionId: tab.connectionId, sessionId: activeMysqlOrigins.sessionId,
              executionId: activeMysqlOrigins.executionId, resultIndex: activeMysqlOrigins.source.index, columnIndex, taskId });
            if (!job.owns() || !mysqlOriginCurrent(activeMysqlOrigins) || target.database !== origin.database || target.table !== origin.table)
              throw Error(mysqlOriginsText.stale);
            return target;
          } finally { job.release(); }
        }}
        onClose={() => setOriginDialog(current => current === activeMysqlOrigins.source ? undefined : current)}
        onOpen={target => {
          if (!mysqlOriginCurrent(activeMysqlOrigins)) throw Error(mysqlOriginsText.stale);
          const workspace = useWorkspace.getState();
          if (workspace.settings.tabs.length >= 100 && !workspace.settings.tabs.some(item => item.kind === 'table' &&
              item.connectionId === tab.connectionId && item.database === target.database && item.table === target.table)) throw Error(mysqlOriginsText.full);
          setOriginDialog(undefined);
          workspace.openTab({ ...target, kind: 'table', title: target.table, connectionId: tab.connectionId });
        }} />}
      {mysqlRelation && (mysqlRelation.direction === 'edit' ?
        <MysqlSearchRecordEditDialog connectionId={tab.connectionId} queryRecord={mysqlRelation.request} cell={mysqlRelation.cell} visible={settings.activeTabId === tab.id} joined={!!mysqlJoinColumns}
          isCurrent={() => mysqlRecordCurrent(mysqlRelation)} onDirty={() => { /* 查询标签由编辑租约占用，表单自行确认丢弃。 */ }}
          onDone={committed => closeMysqlRecord(mysqlRelation, committed)} /> :
        <MysqlQueryRelationDialog request={mysqlRelation.request} direction={mysqlRelation.direction}
          current={() => mysqlRecordCurrent(mysqlRelation)} onClose={() => closeMysqlRecord(mysqlRelation)} />)}
      {mysqlBatch && <MysqlQueryBatchEditDialog request={mysqlBatch.request} operation={mysqlBatch.operation} displayRows={mysqlBatch.displayRows}
        isCurrent={() => mysqlRecordCurrent(mysqlBatch)} onDone={committed => closeMysqlBatch(mysqlBatch, committed)}/>}
      {queryRowSql && <QueryRowSqlDialog command={sqlite ? 'sqlite.queryRowSql' : 'mysql.queryRowSql'} request={queryRowSql.request} keyed={queryRowSql.keyed}
        isCurrent={() => queryRowSqlCurrent(queryRowSql)} onClose={() => closeQueryRowSql(queryRowSql)}
        onDraft={(kind, prepared) => {
          if (!queryRowSqlCurrent(queryRowSql)) return;
          openRowSqlDraft({ connectionId: tab.connectionId, database: prepared.database, table: prepared.table }, kind, prepared.sql);
          closeQueryRowSql(queryRowSql);
        }}/>}
      {recordRelation && <SqliteQueryRelationDialog request={recordRelation.request}
        current={() => queryRelationCurrent(recordRelation)} onClose={() => closeQueryRelation(recordRelation)}
        onOpen={output => {
          if (!queryRelationCurrent(recordRelation)) return false;
          openSqliteRelatedTable(output, { connectionId: tab.connectionId, profile: connection, version: connectionVersion });
          closeQueryRelation(recordRelation);
          return true;
        }} />}
      {matchView.active && <QueryResultMatchView active={matchView.active} disabled={!selectionBinding || busy || !!activeColumnLease}
        onClear={() => changeMatchView()}/>}
      <div className="result-body" role="region" aria-label={zh.query.text016} tabIndex={-1}>{!pin && outcome?.sqliteExplain ? <SqliteExplainPlanView key={task.current} outcome={outcome} busy={busy} isCurrent={queryMenuCurrent}/> : !pin && outcome?.analysis ? <QueryAnalyzeView key={task.current} plan={outcome.analysis} outcome={outcome} fileActions busy={busy}/> : !pin && outcome?.explain ? <ExplainPlanView key={task.current} outcome={outcome} fileActions fileBusy={busy} busy={busy || !sessionId} onText={() => void runQuery(explainSource.current, 'explain-text')}/> : result?.columns.length ? <div className="query-result-with-details">
      <PostgresTableFindPanel host={{ className: 'query-result-grid', inert: !!(recordEdit?.cell || mysqlRelation?.cell) }} request={activeReplace?.fields ? activeReplace.panel : undefined} scope={selectionBinding ?? visibleColumns}
        enabled={!!activeReplace?.fields} writable={!!activeReplace?.fields} rows={replaceRows} replacementRows={sqliteReplaceRows} columns={visibleColumns}
        replaceSelection={activeReplace?.fields ? resultSelection.checkedRows(activeReplace.binding) ?? null : undefined}
        replaceWritable={replaceWritable} scopeDescription="" replaceScopeDescription={sqlite ? originsText.replaceScope : mysqlBatchText.replaceScope} shortcuts={false}
        isCurrent={() => resultReplaceCurrent()} anchor={() => undefined} onOpen={openResultReplace} onClose={closeResultReplace}
        onPreview={previewResultReplace} onStage={stageResultReplace}
        renderGrid={(findTarget?: GridFindTarget, findMarks?: ReadonlySet<string>) => <ResultsGrid zoomable columnNameDialect={connection?.dialect} findTarget={findTarget} findMarks={findMarks} rowJump rowHeight={layoutMatches ? columnLayout?.layout.rowHeight : undefined} sqliteSource={result} key={pin?.id ?? `current-${resultIndex}`} columns={visibleColumns} rows={result.rows} frozenKeys={frozenKeys} freezeColumns={headerFreeze} columnVisibility={columnVisibility} onColumnReorder={reorderResultColumns} columnWidths={resultColumnWidths} onColumnWidthsChange={resizeResultColumns} onRowHeightChange={resizeResultRowHeight} binarySourceIdentity={[...resultContext,result,filterView,sortView]} binaryIsCurrent={() => alive.current && !busyRef.current && task.current === resultContext[3]} sort={sortView?.rules ? [...sortView.rules] : []} onSortChange={sortBinding && selectionBinding && !activeColumnLease && !activeFilterLease && !activeSortLease ? sortResult : undefined} sortReasons={sortBinding?.reasons} onHistoryTravel={travelResultHistory} onFilterCell={filterBinding && selectionBinding && !activeColumnLease && !activeFilterLease && !activeSortLease ? openCellFilter : undefined} onStageFindFilter={filterBinding && selectionBinding && !activeColumnLease && !activeFilterLease && !activeSortLease ? openFilterRule : undefined} findFilterSource={filterBinding?.source} onFilterSelected={filterBinding && selectionBinding && !activeColumnLease && !activeFilterLease && !activeSortLease ? openSelectedFilter : undefined} onStatistics={selectionBinding && !activeColumnLease && !activeFilterLease && !activeSortLease ? openResultStatistics : undefined} selectionScope={selectionBinding} onSelectionChange={selectResultRows} onShowRows={changeMatchView} onExportRange={exportGridRange} isCurrent={() => resultSelectionAllowed(selectionBinding)} onActiveRowIndexChange={selectActiveDetailRow} onCellEdit={recordEditTable || mysqlRelationAvailable ? editQueryCell : undefined} onFillRange={(recordEditTable || mysqlRelationAvailable) && selectionBinding ? fillQueryRange : undefined} onCellPaste={(recordEditTable || mysqlRelationAvailable) && selectionBinding ? pasteQueryRange : undefined} restoreCell={restoreEditedCell}/>}/>{currentRowDetail && <QueryRowDetailsPanel controller={rowDetails} view={currentRowDetail} isCurrent={() => rowDetailAllowed(currentRowDetail.binding)} onMove={moveRowDetail} onClose={closeRowDetail}/>}</div> : result ? <Empty title={zh.query.text023} text={sqliteReceipt ? undefined : formatText(zh.query.text024, result.affectedRows ?? 0, result.insertId ? formatText(zh.query.text025, result.insertId) : '', result.warningCount ? formatText(zh.query.text026, result.warningCount) : '')}/> : <Empty title={zh.query.text027} text={zh.query.text028}><div className="key-tip"><kbd>Ctrl / ⌘</kbd><span>+</span><kbd>Enter</kbd></div></Empty>}</div></div></div><div className="tab-status">{result?.columns.length && result.warningCount !== undefined ? <span aria-label={queryWarningsZh.count(result.warningCount)}>{queryWarningsZh.count(result.warningCount)}</span> : null}<span>{result ? formatText(zh.query.text029, result.rows.length, result.truncated ? zh.query.text030 : '') : zh.query.text031}</span>{busy ? <Spinner text={zh.query.text018}/> : outcome && (!sqlite || !pin) && <span className="muted small">{sqlite ? sqliteZh.executionElapsed(outcome.elapsedMs) : outcome.elapsedMs + zh.query.text019}</span>}<span className="grow"/>{!busy&&completionStatus!=='idle'&&<span className="muted small" aria-label="SQL 补全状态" title={completionStatusInfo[completionStatus].hint}>{completionStatusInfo[completionStatus].text}</span>}{(transaction || !transactionKnown) && <span className="warning-text" title={!transactionKnown ? parameterZh.transactionUnknownHint : undefined}><LockKeyhole size={12}/>{transactionKnown ? zh.query.text032 : parameterZh.transactionUnknown}</span>}<button disabled={busy || transaction || !transactionKnown} onClick={() => void transactionAction('begin')}>{zh.common.transactionBegin}</button><button disabled={busy || (!transaction && transactionKnown)} onClick={() => void transactionAction('commit')}><Check size={12}/>{zh.common.transactionCommit}</button><button disabled={busy || (!transaction && transactionKnown)} onClick={() => void transactionAction('rollback')}><RotateCcw size={12}/>{zh.common.transactionRollback}</button></div>{sessionObjects&&<SessionObjectsDialog sessionId={sessionId} database={completionSession?.databaseKnown?completionSession.database??undefined:undefined} busy={busy} onRead={readTemporaryObject} onClose={()=>setSessionObjects(false)}/ >}{recoveryDialog}{databaseSwitchDialog&&<QueryDatabaseSwitchDialog intent={databaseSwitchDialog} onLoad={()=>loadDatabaseSwitchChoices(databaseSwitchDialog)} onApply={database=>applyDatabaseSwitch(databaseSwitchDialog,database)} onClose={()=>closeDatabaseSwitch(databaseSwitchDialog)}/ >}{closeRequest && !archiveOutcome && closePhase === 'choose' && <QueryCloseDialog title={tab.title} onCancel={() => finishClose(false)} onDiscard={() => finishClose(true)} onKeep={closeKeepingDraft} onSave={beginCloseSave}/ >}{closeRequest && !archiveOutcome && closePhase === 'save' && createPortal(<QueryBindingDialog initialName={queryName} bound={!!tab.sourceBinding} onSave={saveAndClose} onClose={() => finishClose(false)}/>, document.body)}{save && <QueryBindingDialog initialName={queryName} bound={!!tab.sourceBinding} onSave={async (action, name, group) => { await saveQuery(action, name, group); }} onClose={() => {invalidateResultSelection();setSave(false);}}/>}{resultSqlPreview && <ResultSqlDialog title={resultSqlPreview.pinId ? zh.query.pinSource : zh.query.resultSqlTitle}
          hint={zh.query.resultSqlHint} statement={resultSqlPreview.statement} sourceSql={resultSqlPreview.sourceSql}
          dialect={connection?.dialect} onClose={closeResultSql}/>}{snippets && <SnippetsDialog dialect={connection?.dialect} initialSql={snippets.initialSql} startWithDraft={snippets.create} onInsert={insertSnippet} onClose={closeSnippets}/ >}{warningsDialog && <QueryWarningsDialog report={warningsDialog.report} onClose={() => closeWarningsReport(warningsDialog)}/ >}{transactionSettingsDialog && <QueryTransactionSettingsDialog intent={transactionSettingsDialog.intent} connectionName={transactionSettingsDialog.connectionName} onRead={taskId => requestTransactionSettings(transactionSettingsDialog.intent, taskId)} onApply={input => requestTransactionSettings(transactionSettingsDialog.intent, input.taskId, input)} onAutocommit={input => requestAutocommit(transactionSettingsDialog.intent, input)} onClose={() => closeTransactionSettings(transactionSettingsDialog.intent)}/>}{analyzeDialog && <QueryAnalyzeConfirmDialog source={analyzeDialog.intent.source} connectionName={analyzeDialog.connectionName} databaseLabel={analyzeDialog.databaseLabel} invalidReason={analyzeInvalid || undefined} onConfirm={() => void confirmAnalyze(analyzeDialog.intent)} onClose={() => closeAnalyze(analyzeDialog.intent)}/ >}{parameterSource !== null && <QueryParametersDialog key={parameterDialog?.id} source={parameterSource} allowSqliteNavicat={sqlite} allowManualParameters={sqlite || !parameterDialog?.intent} loadNames={navicat => loadParameterNames(parameterDialog ?? undefined, navicat)} reuse={parameterReusePort.current ?? undefined} ownerId={parameterDialog?.intent ? parameterDialog.id : undefined} syntaxHint={parameterDialog?.intent ? (sqlite ? parameterZh.sqliteCurrentHint : parameterZh.currentHint) : undefined}
          previewSql={parameterDialog?.intent && !sqlite ? () => {
            const range = parameterDialog.confirmedRange;
            if (!range) throw Error(parameterZh.currentSourceChanged);
            return parameterSource.slice(range.start, range.end);
          } : undefined} onExecute={(parameters, navicat) => submitParameterQuery(parameterSource, parameters, parameterDialog ?? undefined, navicat)} onClose={() => closeParameters(parameterDialog ?? undefined)}/ >}{sqliteFullExport && <FullQueryExportDialog source={sqliteFullExport} onClose={() => setSqliteFullExport(null)}/>}{streamExportSource !== null && (connection?.dialect === 'mysql' || connection?.dialect === 'mariadb') && <QueryStreamExportDialog dialect={connection.dialect} sessionBusy={busy} source={streamExportSource} loadNames={loadStreamParameterNames} onExecute={runStreamExport} onCancel={cancelStreamExport} onClose={() => { if (!busyRef.current) setStreamExportSource(null); }}/ >}{activeColumnLease&&<QueryResultColumnsDialog binding={activeColumnLease.binding} initial={activeColumnLease.initial} owner={activeColumnLease.owner} isCurrent={()=>columnManagerCurrent(activeColumnLease)} onApply={layout=>applyColumnLayout(activeColumnLease,layout)} onClose={()=>closeColumnManager(activeColumnLease)}/ >}{activePresetLease&&<QueryResultPresetsDialog key={activePresetLease.owner} connectionId={tab.connectionId} value={activePresetLease.value} owner={activePresetLease.owner} isCurrent={()=>presetManagerCurrent(activePresetLease)} matches={value=>queryResultMemoryMatches(value,viewSource,visibleColumns)} onApply={value=>applyResultPreset(activePresetLease,value)} onClose={()=>closeResultPresets(activePresetLease)}/ >}{activeStatisticsLease&&<QueryResultStatisticsDialog key={activeStatisticsLease.owner} sqliteSource={activeStatisticsLease.source} columns={activeStatisticsLease.columns} rows={activeStatisticsLease.rows} initialColumn={activeStatisticsLease.column} selectedIndices={activeStatisticsLease.indices} truncated={activeStatisticsLease.truncated} owner={activeStatisticsLease.owner} isCurrent={()=>statisticsCurrent(activeStatisticsLease)} onClose={()=>closeResultStatistics(activeStatisticsLease)} onFilter={node=>filterFromStatistics(activeStatisticsLease,node)}/ >}{activeComparisonLease&&<QueryResultComparisonDialog key={activeComparisonLease.owner} pins={activeComparisonLease.pins} owner={activeComparisonLease.owner} isCurrent={()=>comparisonCurrent(activeComparisonLease)} onClose={()=>closeResultComparison(activeComparisonLease)}/ >}{resultInsertSource && <ResultInsertDialog intent={resultInsertSource} initialConnectionId={tab.connectionId} onActivity={resultInsertActivityChange} onClose={() => closeResultInsert(resultInsertSource)} onCommitted={output => useWorkspace.getState().notify(resultInsertZh.committed(output.rows))} onCleanupError={message => useWorkspace.getState().notify(resultInsertZh.cleanupFailed + message, true)}/>}{recordEdit && <SqliteSearchRecordEditDialog connectionId={tab.connectionId} table={recordEdit.table} queryRecord={recordEdit.source} cell={recordEdit.cell} rangeFill={recordEdit.rangeFill} rangePaste={recordEdit.rangePaste} deletePositions={recordEdit.deletePositions} duplicatePositions={recordEdit.duplicatePositions} rangeReplace={recordEdit.rangeReplace} visible={settings.activeTabId === tab.id}
        isCurrent={() => recordEdit.job.owns() && queryOwnerCurrent() && recordEdit.source.sessionId === sessionRef.current && recordEdit.source.taskId === task.current}
        onDirty={() => { /* 整个编辑对话框占用原标签，关闭时由记录编辑器核对本地修改。 */ }}
        onDone={committed => {
          if (committed) {
            // 保留原查询快照的身份，提交后只撤销编辑入口，筛选、排序及列布局继续有效。
            retiredRecordTask.current = recordEdit.source.taskId;
            useWorkspace.getState().notify('operation' in recordEdit.source ?
              (recordEdit.source.operation === 'duplicate' ? originsText.duplicateCommitted : originsText.insertCommitted) :
              recordEdit.deletePositions ? originsText.deleteCommitted : recordEdit.rangeReplace ? originsText.replaceCommitted : originsText.editCommitted);
          }
          recordEdit.job.release();
          setRecordEdit(undefined);
          if (recordEdit.cell && queryOwnerCurrent()) {
            const { row, key } = recordEdit.cell;
            setRestoreEditedCell({ row, key });
          }
        }}/>}{activeOrigins && <SqliteResultOriginsDialog result={activeOrigins.result} origins={activeOrigins.origins} onClose={() => setOriginDialog(undefined)}
        onOpenTable={index => {
          const origin = activeOrigins.origins[index];
          if (!queryOwnerCurrent() || busyRef.current || origin?.database !== 'main') return;
          setOriginDialog(undefined);
          useWorkspace.getState().openTab({ kind: 'table', title: origin.table, connectionId: tab.connectionId, database: 'main', table: origin.table });
        }}/>}{archiveOutcome && <ResultArchiveDialog outcome={archiveOutcome} tabId={tab.id} dialect={sqlite ? 'sqlite' : 'mysql'} isCurrent={() => archiveAvailable && archiveOutcome === outcome && queryOwnerCurrent()} onClose={() => setArchiveOutcome(undefined)}/>}{exportResult && <ResultExportDialog result={exportResult} tabId={tab.id} scope={exportResult.rectangle ? 'rectangle' : undefined} allowSql={!sqlite || !!exportResult.sqliteStorage} sqlDialect={sqlite ? 'sqlite' : undefined} selected={exportSelected} onClose={() => {invalidateResultSelection();setExportResult(null);}}/>}</div>;
}
