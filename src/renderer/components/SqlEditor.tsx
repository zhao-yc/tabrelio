import { appModalSelector } from '../modalSelectors';
import { createPostgresCompletionProvider, type PostgresCompletionScope } from '../postgresCompletionProvider';
import type { ConnectionProfile } from '../../shared/contracts';
import { editorWordWrapOptions, readEditorWordWrap } from '../../shared/editorWordWrap';
import { editorFontOptions, readEditorFontSize } from '../../shared/editorFont';
import { editorIndentationOptions, readEditorInsertSpaces, readEditorTabSize } from '../../shared/editorIndentation';
import { bindEditorIndentation } from '../editorIndentation';
import { zh } from '../locales/zh-CN';
import { captureSqlClipboardSelection, sqlClipboardStack, sqlClipboardStackAction } from '../sqlClipboardStack';
import { sqlClipboardStackZh as clipboardText } from '../locales/sqlClipboardStack.zh-CN';
import { sqlQuotedCopyZh as quotedText } from '../locales/sqlQuotedCopy.zh-CN';
import { quoteSqlForCode, sqlQuotedCopyAction, sqlQuotedCopyMaxUnits, sqlQuoteFormats, type SqlQuoteFormat } from '../sqlQuotedCopy';
import { writeTableClipboardEvent } from '../gridClipboard';
import { ErrorBox, Modal } from './ui';
import { SqlSelectionFindDialog, sqlSelectionFindLimit } from './SqlSelectionFindDialog';
import { sqlSelectionFindZh } from '../locales/sqlSelectionFind.zh-CN';
import { uiCommandLabels } from '../../shared/uiCommands.zh-CN';
import { sqlEditorZoomCommandIds, sqlSelectionFindCommandIds } from '../../shared/uiCommandIds';
import { nextSqlEditorZoomOffset, sqlEditorZoomSize } from '../sqlEditorZoom';
import { hasExplicitCaseSelection } from '../sqlSelectionCase';
import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { objectIdentifierDragType } from '../objectIdentifierInsertion';
import { useSidebarObjectDrop } from './SidebarContextMenu';
import Editor, { loader, type OnMount } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import CompletionWorker from '../completion.worker?worker';
import { useWorkspace } from '../store';
import {CompletionWorkerClient} from '../completionWorkerClient';
import {CompletionDirectory} from '../completionDirectory';
import {completionSuggestions,type SqlCompletionItem} from '../completionSuggestions';
import {completionLimits} from '../../shared/sqlCompletion';
import {invoke,uid} from '../lib';
import {resolveCompletionContext,completionContextCapabilities,sameCompletionScope,type SqlCompletionScope} from '../completionContext';
import {SessionCompletionDirectory} from '../sessionCompletionDirectory';
import {completionServerFacts} from '../completionServerFacts';
import { currentStatementZh } from '../locales/currentStatement.zh-CN';
import { sqlStatementFoldingProvider } from '../sqlStatementFolding';
import { StatementNavigationWorkerClient } from '../statementNavigationWorkerClient';
import StatementNavigationWorker from '../statementNavigation.worker?worker';
import { editorContentBridge } from '../editorContentBridge';
import { sqlFormattingZh } from '../locales/sqlFormatting.zh-CN';
import { createSqlFieldHoverProvider } from '../sqlFieldHoverProvider';
import SqliteCompletionWorker from '../sqliteCompletion.worker?worker';
import { SqliteCompletionWorkerClient } from '../sqliteCompletionWorkerClient';
import { createSqliteCompletionProvider } from '../sqliteCompletionProvider';
import { createSqlDefinitionProvider } from '../sqlDefinitionProvider';
import { createMysqlDefinitionAnalysis } from '../mysqlDefinitionAnalysis';
import { createSqlSignatureProvider } from '../sqlSignatureProvider';
import SqliteLocalReferencesWorker from '../sqliteLocalReferences.worker?worker';
import { LocalReferencesWorkerClient } from '../localReferencesWorkerClient';
import { createLocalReferencesAnalysis } from '../localReferencesAnalysis';
import { createSqliteLocalReferencesAnalysis } from '../sqliteLocalReferencesAnalysis';
import { createSqlReferencesProvider } from '../sqlReferencesProvider';
import { SqlReferenceCompletionGuard } from '../sqlReferenceCompletionGuard';
import { createLocalRenameAnalysis } from '../localRenameAnalysis';
import { createSqlRenameProvider } from '../sqlRenameProvider';
import { localRenameZh } from '../locales/localRename.zh-CN';
import '../localRename.css';
import { sqliteCompletionTaskPrefix, sqliteCompletionLimits } from '../../shared/sqliteCompletion';
import { snippetCatalog } from '../snippetCompletion';
import { createSnippetCompletionProvider } from '../snippetCompletionProvider';
import { postgresEditorLanguage, postgresEditorLanguages, registerPostgresEditorLanguages } from '../postgresEditorLanguage';
import { registerSqliteEditorLanguage, sqliteEditorLanguage } from '../sqliteEditorLanguage';
import { mysqlEditorLanguage, mysqlEditorLanguages, registerMysqlEditorLanguages, type MysqlEditorMode } from '../mysqlEditorLanguage';

export type SqlCompletionStatus='idle'|'partial'|'unavailable'|'limited'|'databaseUnknown'|'sessionUnknown'|'startupTimeout'|'analysisTimeout';
export type { SqlCompletionScope } from '../completionContext';
const completionKinds:Record<SqlCompletionItem['kind'],monaco.languages.CompletionItemKind>={database:monaco.languages.CompletionItemKind.Module,table:monaco.languages.CompletionItemKind.Class,view:monaco.languages.CompletionItemKind.Interface,function:monaco.languages.CompletionItemKind.Function,procedure:monaco.languages.CompletionItemKind.Method,column:monaco.languages.CompletionItemKind.Field,alias:monaco.languages.CompletionItemKind.Variable,keyword:monaco.languages.CompletionItemKind.Keyword};

/** Monaco 使用随安装包发布的编辑器和 worker，离线环境也可直接编辑 SQL。 */
self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
loader.config({ monaco });

/** 每个编辑器只接收自身元数据补全，执行快捷键通过引用调用最新的标签逻辑。 */
export function SqlEditor({ value, onChange, onReady, height = '100%', readOnly = false, dialect: requestedDialect, completion, postgresCompletion, postgresStandardStrings, mysqlMode, snippetCompletion = false, onCompletionStatus, onSelectionState, onExecute, onExecuteCurrent, onFormat, onToggleComment, onToggleBlockComment, onSelectCurrent, queryTabId, clipboardDisabled = false }: { value: string; onChange?: (value: string) => void; onReady?: (editor: monaco.editor.IStandaloneCodeEditor) => void; height?: string | number; readOnly?: boolean; dialect?: ConnectionProfile['dialect']; completion?:SqlCompletionScope;postgresCompletion?:PostgresCompletionScope;postgresStandardStrings?:boolean;mysqlMode?:MysqlEditorMode;snippetCompletion?:boolean;onCompletionStatus?:(status:SqlCompletionStatus)=>void;onSelectionState?: (caseSelection: boolean, singleSelection: boolean) => void;onExecute?: () => void; onExecuteCurrent?: () => void; onFormat?: () => void; onToggleComment?: () => Promise<void>; onToggleBlockComment?: () => void | Promise<void>; onSelectCurrent?: () => void; queryTabId?: string; clipboardDisabled?: boolean }) {
  const objectDrop = useSidebarObjectDrop();
  // PostgreSQL使用独立查询词法；未接通的MySQL语义服务不接受其上下文。
  const dialect = requestedDialect === 'postgresql' ? undefined : requestedDialect;
  const network = requestedDialect === 'mysql' || requestedDialect === 'mariadb' ? requestedDialect : undefined;
  const language = network ? mysqlEditorLanguage(network, mysqlMode) : requestedDialect === 'postgresql'
    ? postgresEditorLanguage(postgresStandardStrings) : requestedDialect === 'sqlite' ? sqliteEditorLanguage : 'sql';
  const languageSelector = network ? mysqlEditorLanguages[network] : requestedDialect === 'postgresql' ? postgresEditorLanguages : language;
  useLayoutEffect(() => {
    if (requestedDialect === 'postgresql') registerPostgresEditorLanguages(monaco.languages);
    if (requestedDialect === 'sqlite') registerSqliteEditorLanguage(monaco.languages);
    if (network) registerMysqlEditorLanguages(monaco.languages, network);
  }, [requestedDialect, network]);
  const theme = useWorkspace(state => state.settings.theme);
  const baseFontSize = useWorkspace(state => readEditorFontSize(state.settings.editorFontSize));
  const [zoomOffset, setZoomOffset] = useState(0);
  const fontSize = sqlEditorZoomSize(baseFontSize, zoomOffset);
  const wordWrap = useWorkspace(state => readEditorWordWrap(state.settings.editorWordWrap));
  const lineNumbers = useWorkspace<'off' | 'on'>(state => state.settings.editorLineNumbers === false ? 'off' : 'on');
  const matchBrackets = useWorkspace<'never' | 'always'>(state => state.settings.editorMatchBrackets === false ? 'never' : 'always');
  const sqlFolding = useWorkspace(state => state.settings.editorSqlFolding === true);
  const tabSize = useWorkspace(state => readEditorTabSize(state.settings.editorTabSize));
  const insertSpaces = useWorkspace(state => readEditorInsertSpaces(state.settings.editorInsertSpaces));
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const contentRef = useRef<ReturnType<typeof editorContentBridge> | null>(null);
  const widgetRef = useRef<{ editor: monaco.editor.IStandaloneCodeEditor; alive: boolean; disposal?: monaco.IDisposable; formatAction?: monaco.IDisposable; formatToken?: object; indentation?: ReturnType<typeof bindEditorIndentation> } | null>(null);
  const propsRef = useRef({ value, onChange, onReady, readOnly, onFormat, queryTabId, clipboardDisabled });
  const foldingScope = useRef({ dialect: requestedDialect, standardStrings: postgresStandardStrings });
  useLayoutEffect(() => { foldingScope.current = { dialect: requestedDialect, standardStrings: postgresStandardStrings }; });
  const snippetScope = useRef({ dialect: requestedDialect, postgres: postgresCompletion, standardStrings: postgresStandardStrings });
  useLayoutEffect(() => { snippetScope.current = { dialect: requestedDialect, postgres: postgresCompletion, standardStrings: postgresStandardStrings }; });
  const completionRef = useRef(completion);
  const dialectRef = useRef(dialect);
  useLayoutEffect(() => { completionRef.current = completion; dialectRef.current = dialect; });
  const aliveRef = useRef(true), [contentReady, setContentReady] = useState(false);
  const queryEditor = !!onExecute;
  type ClipboardRequest = { intent: NonNullable<ReturnType<typeof captureSqlClipboardSelection>>; unsubscribe(): void } &
    ({ kind: 'paste'; entries: readonly string[] } | { kind: 'quoted'; sql: string });
  const clipboardRequest = useRef<ClipboardRequest | null>(null), clipboardHost = useRef<HTMLDivElement>(null);
  const [clipboardDialog, setClipboardDialog] = useState<ClipboardRequest>(), [clipboardIndex, setClipboardIndex] = useState(0);
  const [selectionFind, setSelectionFind] = useState<{
    mode: typeof sqlSelectionFindCommandIds[number];
    target: NonNullable<ReturnType<typeof captureSqlClipboardSelection>>;
    source: string;
    editor: monaco.editor.IStandaloneCodeEditor;
  }>();
  const selectionFindHost = useRef<HTMLFormElement>(null);
  const [clipboardError, setClipboardError] = useState('');
  const [quoteFormat, setQuoteFormat] = useState<SqlQuoteFormat>('javascript');

  /** 只接纳当前查询编辑器本次复制事件中由 Monaco 写入的文本。 */
  function rememberSql(event: ClipboardEvent<HTMLDivElement>): void {
    const editor = editorRef.current, tabId = propsRef.current.queryTabId;
    if (!tabId || useWorkspace.getState().settings.activeTabId !== tabId || !editor?.hasTextFocus() || !contentRef.current?.ready ||
      document.querySelector(appModalSelector) || !event.defaultPrevented || !event.clipboardData.types.includes('vscode-editor-data')) return;
    sqlClipboardStack.remember(event.clipboardData.getData('text/plain'));
  }
  function disposeClipboard(): void {
    const request = clipboardRequest.current;
    clipboardRequest.current = null;
    request?.unsubscribe();
    request?.intent.dispose();
  }
  function closeClipboard(): void { disposeClipboard(); setClipboardDialog(undefined); }
  /** 绑定打开时的标签、连接配置和编辑器，等待选择时不得切换目标。 */
  function openClipboard(editor: monaco.editor.IStandaloneCodeEditor, kind: ClipboardRequest['kind'] = 'paste'): void {
    if (clipboardRequest.current || document.querySelector(appModalSelector)) return;
    const workspace = useWorkspace.getState(), tab = workspace.settings.tabs.find(item => item.id === propsRef.current.queryTabId);
    if (!tab) return;
    const profile = workspace.connections.find(item => item.id === tab.connectionId), version = workspace.connectionVersions[tab.connectionId];
    const allowed = () => {
      const current = useWorkspace.getState(), props = propsRef.current;
      return aliveRef.current && editorRef.current === editor && contentRef.current?.ready === true && props.queryTabId === tab.id &&
        !props.clipboardDisabled && !props.readOnly && !editor.getRawOptions().readOnly && current.settings.activeTabId === tab.id &&
        current.settings.tabs.includes(tab) && !!profile && current.connections.includes(profile) &&
        current.connectionVersions[tab.connectionId] === version && !current.activeJobs[tab.id] && !current.queryFileOpenings?.[tab.id];
    };
    if (!allowed()) return;
    editor.focus();
    const intent = captureSqlClipboardSelection(editor, allowed);
    if (!intent) { workspace.notify(kind === 'paste' ? clipboardText.single : quotedText.select, true); return; }
    let sql: string | undefined;
    if (kind === 'quoted') {
      try { sql = intent.selectedText(sqlQuotedCopyMaxUnits); }
      catch { intent.dispose(); workspace.notify(quotedText.tooLarge, true); return; }
      if (!sql) { intent.dispose(); workspace.notify(quotedText.select, true); return; }
    }
    const owner = { intent, unsubscribe: useWorkspace.subscribe(intent.current) };
    const request: ClipboardRequest = sql ? { ...owner, kind: 'quoted', sql } : { ...owner, kind: 'paste', entries: sqlClipboardStack.snapshot() };
    clipboardRequest.current = request;
    setClipboardIndex(0); setClipboardError(''); setClipboardDialog(request);
  }
  function clipboardCurrent(request: ClipboardRequest): boolean {
    return clipboardRequest.current === request && Array.from(document.querySelectorAll(appModalSelector))
      .every(dialog => clipboardHost.current?.contains(dialog));
  }
  function pasteClipboard(request: Extract<ClipboardRequest, { kind: 'paste' }>): void {
    if (!clipboardCurrent(request)) return;
    if (!request.intent.paste(request.entries[clipboardIndex] ?? '')) { setClipboardError(clipboardText.stale); return; }
    closeClipboard();
  }
  /** 只写本次明确选择的格式，失效选区不触发剪贴板事件。 */
  function copyQuoted(request: Extract<ClipboardRequest, { kind: 'quoted' }>, encoded: string): void {
    const current = () => clipboardCurrent(request) && request.intent.current();
    if (!current()) { setClipboardError(quotedText.stale); return; }
    try { writeTableClipboardEvent(current, data => data.setData('text/plain', encoded)); }
    catch { setClipboardError(current() ? quotedText.unavailable : quotedText.stale); return; }
    closeClipboard();
    useWorkspace.getState().notify(quotedText.copied);
  }
  useEffect(() => {
    const instance = editorRef.current;
    if (!contentReady || !instance || !queryEditor || !sqlFolding || !requestedDialect) return;
    let active = true;
    const client = new StatementNavigationWorkerClient(() => new StatementNavigationWorker({ name: 'dbark-sql-folding' }));
    const registration = monaco.languages.registerFoldingRangeProvider(languageSelector, sqlStatementFoldingProvider(instance, requestedDialect, client,
      () => active && aliveRef.current && editorRef.current === instance && foldingScope.current.dialect === requestedDialect &&
        foldingScope.current.standardStrings === postgresStandardStrings && useWorkspace.getState().settings.editorSqlFolding === true,
      postgresStandardStrings === undefined ? {} : { noBackslashEscapes: postgresStandardStrings }));
    return () => { active = false; registration.dispose(); client.dispose(); };
  }, [contentReady, queryEditor, sqlFolding, requestedDialect, postgresStandardStrings, languageSelector]);
  /** 原生菜单只收到可用状态，选区内容留在当前模型内。 */
  useEffect(() => {
    if (!onSelectionState) return;
    const instance = editorRef.current;
    if (!instance || !contentReady || readOnly) { onSelectionState(false, false); return; }
    const sync = () => {
      const nonEmpty = hasExplicitCaseSelection(instance);
      onSelectionState(nonEmpty, nonEmpty && instance.getSelections()?.length === 1);
    };
    const selection = instance.onDidChangeCursorSelection(sync), model = instance.onDidChangeModel(sync);
    const disposal = instance.onDidDispose(() => onSelectionState(false, false));
    sync();
    return () => { selection.dispose(); model.dispose(); disposal.dispose(); onSelectionState(false, false); };
  }, [contentReady, onSelectionState, readOnly]);
  const [renameMessage, setRenameMessage] = useState<string | null>(null);
  useEffect(() => { setRenameMessage(null); }, [value, readOnly, dialect, completion?.connectionId, completion?.connectionVersion, completion?.database, completion?.sessionId]);
  // options引用稳定；库即使迟到应用初始options，也读取同一份最新readonly，不能重新开放失效实例。
  const optionsRef = useRef<monaco.editor.IStandaloneEditorConstructionOptions>({ readOnly: true, wordBasedSuggestions:'off',quickSuggestions:{other:true,comments:false,strings:false},fontFamily: 'Cascadia Code, SFMono-Regular, Consolas, monospace', ...editorFontOptions(fontSize), minimap: { enabled: false }, automaticLayout: true, scrollBeyondLastLine: false, padding: { top: 18, bottom: 12 }, ...editorIndentationOptions(tabSize, insertSpaces), ...editorWordWrapOptions(wordWrap), lineNumbers, matchBrackets, renderLineHighlight: 'line', smoothScrolling: true, fixedOverflowWidgets: true, contextmenu: true });
  // 只发布已提交的props；并发渲染被取消时不能把未提交回调交给旧模型。
  useLayoutEffect(() => { propsRef.current = { value, onChange, onReady, readOnly, onFormat, queryTabId, clipboardDisabled }; syncFormatAction(); clipboardRequest.current?.intent.current(); });
  /** 外部value只能走桥接的受控编辑范围；库不再另行更新value或订阅onChange。 */
  useLayoutEffect(() => { contentRef.current?.sync(); }, [value, readOnly]);
  useLayoutEffect(() => {
    aliveRef.current = true;
    setClipboardDialog(undefined);
    // Suspense重显会恢复layout effect但库不重发onMount；仅恢复仍存活widget的正文桥接。
    const widget = widgetRef.current;
    if (widget?.alive) { attachContent(widget.editor); syncFormatAction(); }
    else if (widget) { optionsRef.current.readOnly = true; setContentReady(false); }
    return () => { aliveRef.current = false; disposeClipboard(); contentRef.current?.dispose(); contentRef.current = null; editorRef.current = null; };
  }, []);
  /** 仅热更新字号/行高；不触及model、正文、撤销栈、选择、readonly或补全生命周期。 */
  useLayoutEffect(() => {
    const options = editorFontOptions(fontSize); Object.assign(optionsRef.current, options);
    const widget = widgetRef.current;
    if (aliveRef.current && widget?.alive) widget.editor.updateOptions(options);
  }, [fontSize]);
  /** 换行只更新原实例单个选项；顺序在widget恢复之后，隐藏期间的最新值也能提交。 */
  useLayoutEffect(() => {
    const options = editorWordWrapOptions(wordWrap); Object.assign(optionsRef.current, options);
    const widget = widgetRef.current;
    if (aliveRef.current && widget?.alive) widget.editor.updateOptions(options);
  }, [wordWrap]);
  /** 只更新原编辑器显示选项，行号和括号状态不进入 SQL 模型。 */
  useLayoutEffect(() => {
    const options = { lineNumbers, matchBrackets };
    Object.assign(optionsRef.current, options);
    const widget = widgetRef.current;
    if (aliveRef.current && widget?.alive) widget.editor.updateOptions(options);
  }, [lineNumbers, matchBrackets]);
  /** 全局偏好更新原widget和当前model；不替换正文，也不因正文已有Tab而重新猜缩进。 */
  useLayoutEffect(() => {
    Object.assign(optionsRef.current, editorIndentationOptions(tabSize, insertSpaces));
    widgetRef.current?.indentation?.sync();
  }, [tabSize, insertSpaces]);
  // 真实卸载释放widget存活监听；单纯布局隐藏保留句柄，不能用已销毁实例恢复桥接。
  useEffect(() => () => { const widget = widgetRef.current; widgetRef.current = null; if (widget) { widget.alive = false; widget.formatToken = undefined; widget.formatAction?.dispose(); widget.indentation?.dispose(); widget.disposal?.dispose(); } }, []);
  const toggleCommentRef = useRef(onToggleComment); toggleCommentRef.current = onToggleComment;
  const toggleBlockCommentRef = useRef(onToggleBlockComment); toggleBlockCommentRef.current = onToggleBlockComment;
  const runRef = useRef(onExecute); runRef.current = onExecute;
  const currentRunRef = useRef(onExecuteCurrent); currentRunRef.current = onExecuteCurrent;
  const selectCurrentRef = useRef(onSelectCurrent); selectCurrentRef.current = onSelectCurrent;
  const statusRef=useRef(onCompletionStatus);statusRef.current=onCompletionStatus;
  const referenceCompletionGuard = useRef(new SqlReferenceCompletionGuard());
  const suggestionsBlocked = () => referenceCompletionGuard.current.blocked(editorRef.current?.getDomNode() ?? null);
  /** 局部F2重命名独占分析线程；输入框焦点属于本widget，不能借树选择改变目标。 */
  useEffect(() => {
    if (readOnly || !contentReady || !dialect || dialect !== 'sqlite' && !completion) return;
    const current = () => aliveRef.current && dialectRef.current === dialect && !propsRef.current.readOnly && contentRef.current?.ready === true && !!(editorRef.current?.hasTextFocus() || editorRef.current?.hasWidgetFocus()) && !document.querySelector(appModalSelector) && (!completion || sameCompletionScope(completionRef.current, completion));
    const worker = createLocalRenameAnalysis({ dialect: dialect === 'sqlite' ? 'sqlite' : 'mysql', scope: completion, current,
      facts: () => completion ? completionServerFacts.get(completion.connectionId, completion.connectionVersion) : undefined,
      state: sessionId => invoke('query.completionState', { sessionId }), create: () => new LocalReferencesWorkerClient(() => dialect === 'sqlite' ? new SqliteLocalReferencesWorker() : new CompletionWorker(), dialect === 'sqlite' ? 'sqlite' : 'mysql'),
    });
    const rename = createSqlRenameProvider({ worker, current, model: () => editorRef.current?.getModel() ?? null, sourceLimit: dialect === 'sqlite' ? sqliteCompletionLimits.sourceUnits : completionLimits.sourceUnits,
      begin: signal => referenceCompletionGuard.current.acquire(signal), notify: setRenameMessage,
      prepare: () => { setRenameMessage(null); editorRef.current?.trigger('dbark.localRename', 'hideSuggestWidget', {}); },
    });
    const registration = monaco.languages.registerRenameProvider(languageSelector, rename.provider);
    return () => { registration.dispose(); void rename.dispose().catch(() => {}); };
  }, [dialect, readOnly, contentReady, languageSelector, completion?.connectionId, completion?.connectionVersion, completion?.database, completion?.databaseUnknown, completion?.sessionId]);
  /** 内置函数参数提示只分析当前模型；模式缓存之外没有数据库入口，与补全／声明线程独立。 */
  useEffect(() => {
    if (readOnly || !contentReady || !dialect || dialect !== 'sqlite' && !completion) return;
    const current = () => aliveRef.current && dialectRef.current === dialect && !propsRef.current.readOnly && contentRef.current?.ready === true && !!editorRef.current?.hasTextFocus() && !document.querySelector(appModalSelector) && (!completion || sameCompletionScope(completionRef.current, completion));
    const signatures = createSqlSignatureProvider({ model: () => editorRef.current?.getModel() ?? null, current, dialect, scope: completion, state: sessionId => invoke('query.completionState', { sessionId }) });
    const registration = monaco.languages.registerSignatureHelpProvider(languageSelector, signatures.provider);
    return () => { registration.dispose(); signatures.dispose(); };
  }, [dialect, readOnly, contentReady, languageSelector, completion?.connectionId, completion?.connectionVersion, completion?.database, completion?.databaseUnknown, completion?.sessionId]);
  /** 本文引用按方言复用声明语义，独占线程；SQLite不读取会话缓存或回退到MySQL解析器。 */
  useEffect(() => {
    if (readOnly || !contentReady || dialect !== 'sqlite' && !completion) return;
    const current = () => aliveRef.current && dialectRef.current === dialect && !propsRef.current.readOnly && contentRef.current?.ready === true && !!editorRef.current?.hasTextFocus() && !document.querySelector(appModalSelector) && (!completion || sameCompletionScope(completionRef.current, completion));
    const worker = dialect === 'sqlite' ? createSqliteLocalReferencesAnalysis({ current, create: () => new LocalReferencesWorkerClient(() => new SqliteLocalReferencesWorker(), 'sqlite') }) : createLocalReferencesAnalysis({ scope: completion!, current,
      facts: () => completionServerFacts.get(completion!.connectionId, completion!.connectionVersion),
      state: sessionId => invoke('query.completionState', { sessionId }), create: () => new LocalReferencesWorkerClient(() => new CompletionWorker()),
    });
    const references = createSqlReferencesProvider({ worker, current, sourceLimit: dialect === 'sqlite' ? sqliteCompletionLimits.sourceUnits : completionLimits.sourceUnits, model: () => editorRef.current?.getModel() ?? null,
      begin: signal => referenceCompletionGuard.current.acquire(signal),
      // 走Monaco正式命令收起尚未选择的候选，不改正文；避免候选框覆盖引用列表标题。
      prepare: () => editorRef.current?.trigger('dbark.localReferences', 'hideSuggestWidget', {}),
    });
    const registration = monaco.languages.registerReferenceProvider(languageSelector, references.provider);
    return () => { registration.dispose(); void references.dispose().catch(() => {}); };
  }, [dialect, readOnly, contentReady, languageSelector, completion?.connectionId, completion?.connectionVersion, completion?.database, completion?.databaseUnknown, completion?.sessionId]);
  /** 声明导航独立于元数据补全；MySQL只读既有会话模式缓存，不为F12建立连接或执行SQL。 */
  useEffect(() => {
    if (readOnly || !contentReady || dialect !== 'sqlite' && !completion) return;
    const current = () => aliveRef.current && !propsRef.current.readOnly && contentRef.current?.ready === true && !!editorRef.current?.hasTextFocus() && !document.querySelector(appModalSelector) && (dialect === 'sqlite' || sameCompletionScope(completionRef.current, completion));
    const worker = dialect === 'sqlite' ? new SqliteCompletionWorkerClient(() => new SqliteCompletionWorker()) : createMysqlDefinitionAnalysis({
      scope: completion!, current, facts: () => completionServerFacts.get(completion!.connectionId, completion!.connectionVersion),
      state: sessionId => invoke('query.completionState', { sessionId }), create: () => new CompletionWorkerClient(() => new CompletionWorker()),
    });
    const navigation = createSqlDefinitionProvider({ worker, model: () => editorRef.current?.getModel() ?? null,
      current, sourceLimit: dialect === 'sqlite' ? sqliteCompletionLimits.sourceUnits : completionLimits.sourceUnits,
    });
    const registration = monaco.languages.registerDefinitionProvider(languageSelector, navigation.provider);
    return () => { registration.dispose(); void navigation.dispose().catch(() => {}); };
  }, [dialect, readOnly, contentReady, languageSelector, completion?.connectionId, completion?.connectionVersion, completion?.database, completion?.databaseUnknown, completion?.sessionId]);
  useEffect(() => {
    const instance = editorRef.current;
    if (!snippetCompletion || readOnly || !contentReady || !requestedDialect || !instance) return;
    const original = postgresCompletion;
    const provider = createSnippetCompletionProvider({
      editor: instance, dialect: requestedDialect, standardStrings: postgresStandardStrings,
      current: () => {
        if (!aliveRef.current || contentRef.current?.ready !== true || propsRef.current.readOnly ||
            snippetScope.current.dialect !== requestedDialect || snippetScope.current.standardStrings !== postgresStandardStrings || !instance.hasTextFocus() || suggestionsBlocked() || document.querySelector(appModalSelector)) return false;
        if (requestedDialect !== 'postgresql') return true;
        const latest = snippetScope.current.postgres, workspace = useWorkspace.getState();
        const tab = workspace.settings.tabs.find(item => item.id === original?.tabId);
        const profile = workspace.connections.find(item => item.id === original?.connectionId);
        return !!original && latest?.tabId === original.tabId && latest.connectionId === original.connectionId &&
          latest.connectionVersion === original.connectionVersion && latest.database === original.database && latest.sessionId === original.sessionId &&
          workspace.settings.activeTabId === original.tabId && !workspace.activeJobs[original.tabId] &&
          tab?.connectionId === original.connectionId && profile?.dialect === 'postgresql' &&
          (tab.database || profile.database || 'postgres') === original.database &&
          (workspace.connectionVersions[original.connectionId] ?? 0) === original.connectionVersion;
      },
      list: () => snippetCatalog.list(), kind: monaco.languages.CompletionItemKind.Snippet,
      keepWhitespace: monaco.languages.CompletionItemInsertTextRule.KeepWhitespace,
    });
    // 导航及连接ABA也要撤销在途本地读取，不能仅靠回包时的同值判断。
    const stop = useWorkspace.subscribe((next, previous) => {
      if (original && (next.settings.activeTabId !== previous.settings.activeTabId || next.selection !== previous.selection ||
          next.activeJobs[original.tabId] !== previous.activeJobs[original.tabId] || next.connections !== previous.connections ||
          next.connectionVersions[original.connectionId] !== previous.connectionVersions[original.connectionId] ||
          next.settings.tabs.find(item => item.id === original.tabId) !== previous.settings.tabs.find(item => item.id === original.tabId))) provider.invalidate();
    });
    const registration = monaco.languages.registerCompletionItemProvider(languageSelector, provider);
    return () => { stop(); registration.dispose(); provider.dispose(); };
  }, [snippetCompletion, readOnly, contentReady, requestedDialect, postgresStandardStrings, languageSelector, postgresCompletion?.tabId,
    postgresCompletion?.connectionId, postgresCompletion?.connectionVersion, postgresCompletion?.database, postgresCompletion?.sessionId]);
  useEffect(() => {
    if (requestedDialect !== 'postgresql' || !postgresCompletion || readOnly || !contentReady) return;
    const original = postgresCompletion;
    const provider = createPostgresCompletionProvider({
      scope: original,
      model: () => editorRef.current?.getModel() ?? null,
      position: () => editorRef.current?.getPosition() ?? null,
      current: () => {
        const editor = editorRef.current, workspace = useWorkspace.getState();
        const tab = workspace.settings.tabs.find(item => item.id === original.tabId);
        const profile = workspace.connections.find(item => item.id === original.connectionId);
        return aliveRef.current && !propsRef.current.readOnly && !suggestionsBlocked() && contentRef.current?.ready === true &&
          !document.querySelector(appModalSelector) &&
          editor?.getSelections()?.length === 1 && editor.getSelection()?.isEmpty() === true &&
          workspace.settings.activeTabId === original.tabId && !workspace.activeJobs[original.tabId] && tab?.connectionId === original.connectionId &&
          profile?.dialect === 'postgresql' && (tab.database || profile.database || 'postgres') === original.database &&
          (workspace.connectionVersions[original.connectionId] ?? 0) === original.connectionVersion;
      },
      request: input => invoke('postgres.completion', input),
      kinds: { schema: monaco.languages.CompletionItemKind.Module, table: completionKinds.table, view: completionKinds.view,
        column: completionKinds.column, keyword: completionKinds.keyword, routine: monaco.languages.CompletionItemKind.Function },
      snippetRule: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      status: status => statusRef.current?.(status),
    });
    statusRef.current?.('idle');
    const registration = monaco.languages.registerCompletionItemProvider(postgresEditorLanguages, provider);
    const signatureRegistration = monaco.languages.registerSignatureHelpProvider(postgresEditorLanguages, provider.signatureHelp);
    const stop = useWorkspace.subscribe((next, previous) => {
      if (next.settings.activeTabId !== previous.settings.activeTabId ||
          next.activeJobs[original.tabId] !== previous.activeJobs[original.tabId] ||
          next.connectionVersions[original.connectionId] !== previous.connectionVersions[original.connectionId]) provider.invalidate();
    });
    return () => { stop(); registration.dispose(); signatureRegistration.dispose(); provider.dispose(); };
  }, [requestedDialect, readOnly, contentReady, postgresCompletion?.tabId, postgresCompletion?.connectionId,
    postgresCompletion?.database, postgresCompletion?.connectionVersion, postgresCompletion?.sessionId]);
  useEffect(() => {
    if (requestedDialect === 'postgresql') return;
    if(readOnly||!completion){statusRef.current?.('idle');return;}
    // SQLite使用自己的词法和目录，不能将其正文、临时对象或标识符预算交给MySQL分析器。
    if (dialect === 'sqlite') {
      const worker = new SqliteCompletionWorkerClient(() => new SqliteCompletionWorker());
      const provider = createSqliteCompletionProvider({ connectionId: completion.connectionId, sessionId: completion.sessionId,
        model: () => editorRef.current?.getModel() ?? null,
        current: () => aliveRef.current && !propsRef.current.readOnly && !suggestionsBlocked() && sameCompletionScope(completionRef.current, completion) && contentRef.current?.ready === true && !document.querySelector(appModalSelector),
        worker, request: input => invoke('sqlite.completion', input), cancel: taskId => invoke('query.cancel', { taskId }),
        state: sessionId => invoke('query.completionState', { sessionId }), id: () => sqliteCompletionTaskPrefix + uid(), status: status => statusRef.current?.(status),
      });
      const registration = monaco.languages.registerCompletionItemProvider(sqliteEditorLanguage, { triggerCharacters: provider.triggerCharacters,
        provideCompletionItems: async (model, position, context, token) => {
          const result = await provider.provideCompletionItems(model, position, context, token);
          return { ...result, suggestions: result.suggestions.map(item => ({ ...item, kind: completionKinds[item.kind], ...(item.trigger ? { command: { id: 'editor.action.triggerSuggest', title: '' } } : {}) })) };
        },
      });
      const hoverRegistration = monaco.languages.registerHoverProvider(sqliteEditorLanguage, { provideHover: (model, position, token) => provider.provideHover(model, position, token) });
      return () => { hoverRegistration.dispose(); registration.dispose(); void provider.dispose().catch(() => {}); };
    }
    const worker=new CompletionWorkerClient(()=>new CompletionWorker()),directory=new CompletionDirectory(completion.connectionId,completion.connectionVersion,{request:input=>invoke('metadata.completion',input),cancel:taskId=>invoke('query.cancel',{taskId}),id:uid});
    let active:AbortController|undefined,disposed=false;
    let hover: ReturnType<typeof createSqlFieldHoverProvider> | undefined;
    const scopeCurrent = () => aliveRef.current && !propsRef.current.readOnly && sameCompletionScope(completionRef.current, completion);
    const provider = monaco.languages.registerCompletionItemProvider(languageSelector, {
      triggerCharacters:['.','`'],
      provideCompletionItems: async (model, position,_context,token) => {
        if (disposed||readOnly||suggestionsBlocked()||!scopeCurrent()||editorRef.current?.getModel()!==model||model.isDisposed()||token.isCancellationRequested)return{suggestions:[]};
        hover?.cancel();
        active?.abort();const controller=new AbortController();active=controller;statusRef.current?.('idle');
        if(model.getValueLength()>completionLimits.sourceUnits){statusRef.current?.('limited');return{suggestions:[]};}
        const version=model.getVersionId(),source=model.getValue(),offset=model.getOffsetAt(position),cancel=token.onCancellationRequested(()=>controller.abort()),change=model.onDidChangeContent(()=>controller.abort());
        // 无会话草稿复用既有连接检查的事实；不为能力判断新增SQL或主动建立查询会话。
        const openedFacts=completion.sessionId?undefined:completionServerFacts.get(completion.connectionId,completion.connectionVersion);
        /** 每次await后核对模型与版本，标签切换、连接修订和编辑取消都不能交付旧建议。 */
        const current=()=>!disposed&&!suggestionsBlocked()&&scopeCurrent()&&!controller.signal.aborted&&!model.isDisposed()&&editorRef.current?.getModel()===model&&model.getVersionId()===version&&active===controller&&(!!completion.sessionId||completionServerFacts.get(completion.connectionId,completion.connectionVersion)===openedFacts);
        try{
          const cached=completion.sessionId?await invoke('query.completionState',{sessionId:completion.sessionId}):undefined;if(!current())return{suggestions:[]};
          const cachedDialect=cached?.dialect;if(cachedDialect==='sqlite')return{suggestions:[]};
          const scope=resolveCompletionContext(completion.database,cached,completion.databaseUnknown);if(!scope.available){statusRef.current?.(scope.reason==='broken'?'unavailable':'idle');return{suggestions:[]};}
          const capabilities=completionContextCapabilities(cached,openedFacts);
          const analysis=await worker.analyze(source,offset,scope.mode,controller.signal,capabilities);if(!current())return{suggestions:[]};
          if(analysis.status==='blocked'){statusRef.current?.(analysis.reason==='startup-timeout'?'startupTimeout':analysis.reason==='timeout'?'analysisTimeout':analysis.reason==='budget'?'limited':analysis.reason==='worker'?'unavailable':'idle');return{suggestions:[]};}
          const sourceDirectory=completion.sessionId?new SessionCompletionDirectory(directory,query=>{
            if(query.kind==='databases'||query.kind==='objects'&&query.objectKind!=='relation')throw new Error('会话目录目标无效');
            return invoke('query.temporaryCompletion',query.kind==='columns'?{sessionId:completion.sessionId!,kind:'columns',database:query.database,table:query.table,prefix:query.prefix,...(query.details?{details:true}:{})}:{sessionId:completion.sessionId!,kind:'objects',database:query.database,prefix:query.prefix});
          },cached?.objectsRevision??0):directory;
          const result=await completionSuggestions(analysis,scope.database,sourceDirectory,controller.signal,cachedDialect);if(!current())return{suggestions:[]};
          if(completion.sessionId){const latest=await invoke('query.completionState',{sessionId:completion.sessionId});if(!current()||latest.busy||latest.broken||latest.objectsRevision!==cached?.objectsRevision||latest.databaseKnown!==cached?.databaseKnown||latest.database!==cached?.database||latest.dialect!==cached?.dialect||latest.serverVersion!==cached?.serverVersion)return{suggestions:[]};}
          const start=model.getPositionAt(analysis.target.start),end=model.getPositionAt(analysis.target.end);if(start.lineNumber!==end.lineNumber)return{suggestions:[]};
          const range={startLineNumber:start.lineNumber,startColumn:start.column,endLineNumber:end.lineNumber,endColumn:end.column};
          statusRef.current?.(result.unavailable?'unavailable':result.sessionUncertain?'sessionUnknown':scope.databaseUnknown?'databaseUnknown':result.incomplete?'partial':'idle');
          return{incomplete:result.incomplete,suggestions:result.items.map((item,index)=>({label:item.label,kind:completionKinds[item.kind],insertText:item.insertText,detail:item.detail,range,filterText:analysis.target.quoted?source[analysis.target.start]+item.label:item.label,sortText:(item.kind==='keyword'?'9':'0')+String(index).padStart(4,'0'),...(item.trigger?{command:{id:'editor.action.triggerSuggest',title:''}}:{})}))};
        }catch{if(current())statusRef.current?.('unavailable');return{suggestions:[]};}
        finally{cancel.dispose();change.dispose();if(active===controller)active=undefined;}
      }
    });
    hover = createSqlFieldHoverProvider({
      scope: completion, model: () => editorRef.current?.getModel() ?? null,
      current: () => !disposed && scopeCurrent() && contentRef.current?.ready === true,
      completionBusy: () => !!active,
      facts: () => completionServerFacts.get(completion.connectionId, completion.connectionVersion),
      state: sessionId => invoke('query.completionState', { sessionId }), directory,
      analyze: (source, offset, mode, signal, capabilities) => worker.analyze(source, offset, mode, signal, capabilities, 'hover'),
      temporary: (sessionId, query) => {
        if (query.kind !== 'columns') throw Error('字段悬停只读取单字段目录');
        return invoke('query.temporaryCompletion', { sessionId, kind: 'columns', database: query.database, table: query.table, prefix: query.prefix, ...(query.details ? { details: true } : {}) });
      }
    });
    const hoverRegistration = monaco.languages.registerHoverProvider(languageSelector, hover.provider);
    return()=>{disposed=true;active?.abort();hoverRegistration.dispose();hover?.dispose();provider.dispose();worker.dispose();directory.dispose();};
  },[readOnly,dialect,requestedDialect,languageSelector,completion?.connectionId,completion?.connectionVersion,completion?.database,completion?.databaseUnknown,completion?.sessionId]);
  /** 字号与正文桥接可随布局恢复；执行动作及父层onReady不在这里重复发布。 */
  function attachContent(editor: monaco.editor.IStandaloneCodeEditor) {
    contentRef.current?.dispose(); editorRef.current = editor;
    // 布局恢复可能保留原model；显式选项先于正文桥接恢复，readonly仍交原桥接管理。
    widgetRef.current?.indentation?.sync();
    // 迟到挂载/布局恢复只应用最新已提交字号，readonly仍完全由原正文桥接管理。
    editor.updateOptions({ fontSize: optionsRef.current.fontSize, lineHeight: optionsRef.current.lineHeight });
    // 迟到挂载/恢复只取稳定optionsRef中最后提交的换行值，不动模型或readonly。
    editor.updateOptions({ wordWrap: optionsRef.current.wordWrap });
    const bridge = editorContentBridge(editor, () => propsRef.current, ready => {
      optionsRef.current.readOnly = !ready || propsRef.current.readOnly;
      if (aliveRef.current) setContentReady(ready);
    });
    contentRef.current = bridge;
    return bridge;
  }
  /** 只给显式可编辑入口注册格式化；布局隐藏保留同一动作，迟到回调须核当前widget与桥接。 */
  function syncFormatAction() {
    const widget = widgetRef.current;
    if (!aliveRef.current || !widget?.alive) return;
    if (propsRef.current.readOnly || !propsRef.current.onFormat) {
      widget.formatToken = undefined; widget.formatAction?.dispose(); widget.formatAction = undefined; return;
    }
    if (widget.formatAction) return;
    const token = {}; widget.formatToken = token;
    widget.formatAction = widget.editor.addAction({
      id: 'dbark-format-sql', label: sqlFormattingZh.action,
      keybindings: [monaco.KeyMod.Alt | monaco.KeyMod.Shift | monaco.KeyCode.KeyF],
      precondition: 'editorTextFocus && !editorReadonly',
      run: () => {
        // 回调只取最新已提交props；失效、只读、隐藏或尚未桥接的实例不能操作当前查询。
        if (!aliveRef.current || widgetRef.current !== widget || !widget.alive || widget.formatToken !== token || editorRef.current !== widget.editor || !contentRef.current?.ready || propsRef.current.readOnly || widget.editor.getRawOptions().readOnly) return;
        propsRef.current.onFormat?.();
      },
    });
  }
  /** 挂载时注册一次执行动作，编辑器销毁后 Monaco 自动释放该实例动作。 */
  const mounted: OnMount = editor => {
    // 已卸载组件的迟到挂载通知不得重新开放输入或调用父层。
    if (!aliveRef.current) { if (editor.getModel()) editor.updateOptions({ readOnly: true }); return; }
    widgetRef.current?.formatAction?.dispose(); widgetRef.current?.indentation?.dispose(); widgetRef.current?.disposal?.dispose();
    const widget: NonNullable<typeof widgetRef.current> = { editor, alive: true }; widgetRef.current = widget;
    widget.indentation = bindEditorIndentation(editor, () => editorIndentationOptions(optionsRef.current.tabSize, optionsRef.current.insertSpaces), () => aliveRef.current && widget.alive && widgetRef.current === widget);
    widget.disposal = editor.onDidDispose(() => { widget.alive = false; widget.formatToken = undefined; widget.formatAction?.dispose(); widget.indentation?.dispose(); if (editorRef.current === editor) editorRef.current = null; });
    const bridge = attachContent(editor);
    editor.addAction({ id: 'dbark-run', label: zh.editor.text001, keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter], run: () => runRef.current?.() });
    // 与原动作分开注册；按钮和快捷键最终进入同一个忙碌/模态守卫。
    if (currentRunRef.current) editor.addAction({ id: 'dbark-run-current', label: currentStatementZh.action, keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter], run: () => currentRunRef.current?.() });
    // 仅编辑区接收快捷键，结果网格、筛选输入和其它页面保留原按键语义。
    if (selectCurrentRef.current) editor.addAction({ id: 'dbark-select-current-statement', label: uiCommandLabels['select-current-statement'], precondition: '!editorReadonly && !editorHasMultipleSelections', keybindingContext: 'editorTextFocus', keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyE], run: () => selectCurrentRef.current?.() });
    // 编辑器快捷键和原生菜单走同一个方言检查，避免绕过 MySQL 双负号保护。
    if (toggleCommentRef.current) editor.addAction({ id: 'dbark-toggle-sql-comment', label: uiCommandLabels['sql-toggle-comment'], precondition: '!editorReadonly', keybindingContext: 'editorTextFocus', keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Slash], run: () => toggleCommentRef.current?.() });
    // 没有选区时也拦截 Monaco 的默认动作，统一由查询入口校验。
    if (toggleBlockCommentRef.current) editor.addAction({
      id: 'dbark-toggle-sql-block-comment', label: uiCommandLabels['sql-toggle-block-comment'],
      precondition: '!editorReadonly', keybindingContext: 'editorTextFocus',
      keybindings: [monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyA],
      run: () => toggleBlockCommentRef.current?.(),
    });
    if (propsRef.current.queryTabId) editor.addAction({
      id: sqlClipboardStackAction, label: uiCommandLabels['sql-clipboard-stack'], precondition: '!editorReadonly',
      keybindingContext: 'editorTextFocus', keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyV],
      contextMenuGroupId: '9_cutcopypaste', contextMenuOrder: 4,
      run: () => openClipboard(editor),
    });
    if (propsRef.current.queryTabId) editor.addAction({
      id: sqlQuotedCopyAction, label: uiCommandLabels['sql-copy-quoted'], precondition: 'editorHasSelection && !editorHasMultipleSelections && !editorReadonly',
      contextMenuGroupId: '9_cutcopypaste', contextMenuOrder: 5,
      run: () => openClipboard(editor, 'quoted'),
    });
    if (propsRef.current.queryTabId) {
      sqlSelectionFindCommandIds.forEach((id, index) => editor.addAction({
        id, label: uiCommandLabels[id], precondition: 'editorHasSelection && !editorHasMultipleSelections && !editorReadonly',
        contextMenuGroupId: '8_sql_find', contextMenuOrder: index,
        run: () => {
          const tabId = propsRef.current.queryTabId;
          const allowed = () => {
            const props = propsRef.current, current = useWorkspace.getState();
            const ownDialog = selectionFindHost.current?.closest(appModalSelector);
            return !!tabId && props.queryTabId === tabId && aliveRef.current && widgetRef.current === widget && widget.alive &&
              editorRef.current === editor && contentRef.current?.ready === true && current.settings.activeTabId === tabId &&
              !props.clipboardDisabled && !current.activeJobs[tabId] && !editor.getRawOptions().readOnly &&
              Array.from(document.querySelectorAll(appModalSelector)).every(dialog => dialog === ownDialog);
          };
          if (document.querySelector(appModalSelector)) return;
          const target = captureSqlClipboardSelection(editor, allowed);
          if (!target) return;
          try {
            const source = target.selectedText(sqlSelectionFindLimit);
            if (!source) { target.dispose(); return; }
            setSelectionFind({ mode: id, target, source, editor });
          } catch {
            target.dispose();
            useWorkspace.getState().notify(sqlSelectionFindZh.limit, true);
          }
        },
      }));
      // 保留应用缩放的原快捷键，编辑器快捷键只在此实例的文本区接收。
      const keys = [monaco.KeyCode.Equal, monaco.KeyCode.Minus, monaco.KeyCode.Digit0];
      sqlEditorZoomCommandIds.forEach((id, index) => editor.addAction({
        id, label: uiCommandLabels[id], keybindingContext: 'editorTextFocus',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | keys[index]],
        contextMenuGroupId: '10_sql_zoom', contextMenuOrder: index,
        run: () => {
          const props = propsRef.current, current = useWorkspace.getState();
          if (!aliveRef.current || widgetRef.current !== widget || !widget.alive || editorRef.current !== editor ||
              !contentRef.current?.ready || !props.queryTabId || current.settings.activeTabId !== props.queryTabId ||
              props.clipboardDisabled || document.querySelector(appModalSelector)) return;
          const base = readEditorFontSize(current.settings.editorFontSize);
          setZoomOffset(offset => nextSqlEditorZoomOffset(base, offset, id));
        },
      }));
    }
    if (propsRef.current.onFormat) syncFormatAction();
    // 正文订阅、受控同步与readonly解除均已完成，父层才可取得可交互实例。
    if (bridge.ready) propsRef.current.onReady?.(editor);
  };
  const quoted = clipboardDialog?.kind === 'quoted' ? quoteSqlForCode(clipboardDialog.sql, quoteFormat) : '';
  /** 只接管内部对象标记。行号、滚动条和编辑器弹层不作为 SQL 落点。 */
  function handleObjectDrop(event: DragEvent<HTMLDivElement>) {
    if (!event.dataTransfer.types.includes(objectIdentifierDragType)) return;
    event.preventDefault(); event.stopPropagation();
    const editor = editorRef.current;
    const target = editor?.getTargetAtClientPoint(event.clientX, event.clientY);
    if (!queryTabId || !editor || !contentReady || readOnly || clipboardDisabled || !target?.position ||
        (target.type !== monaco.editor.MouseTargetType.CONTENT_TEXT && target.type !== monaco.editor.MouseTargetType.CONTENT_EMPTY) ||
        !objectDrop?.canDropIdentifier(queryTabId)) {
      event.dataTransfer.dropEffect = 'none';
      return;
    }
    event.dataTransfer.dropEffect = 'copy';
    if (event.type === 'drop') objectDrop.dropIdentifier(queryTabId, event.dataTransfer, { editor, position: target.position });
  }

  return <div style={{ height, position: 'relative' }} aria-busy={!contentReady} onCopy={rememberSql} onCut={rememberSql} onDragOverCapture={handleObjectDrop} onDropCapture={handleObjectDrop} onKeyDown={event => { if (event.key === 'Escape') setRenameMessage(null); }}><div aria-hidden={!contentReady} inert={!contentReady} style={{ height: '100%', visibility: contentReady ? 'visible' : 'hidden' }}><Editor language={language} theme={theme === 'dark' ? 'vs-dark' : 'light'} defaultValue={value} onMount={mounted} height="100%" loading={<div className="editor-loading">{zh.editor.text002}</div>} options={optionsRef.current}/></div>{!contentReady && <div className="editor-loading" style={{ position: 'absolute', inset: 0 }}>{zh.editor.text002}</div>}{contentReady && renameMessage && <div className="sql-rename-message" role="status"><span>{renameMessage}</span><button aria-label={localRenameZh.dismiss} onClick={() => { setRenameMessage(null); editorRef.current?.focus(); }}>×</button></div>}{selectionFind && <SqlSelectionFindDialog mode={selectionFind.mode} target={selectionFind.target} source={selectionFind.source}
    setHost={node => { selectionFindHost.current = node; }} onClose={() => setSelectionFind(undefined)}
    focus={() => { if (editorRef.current === selectionFind.editor) selectionFind.editor.focus(); }}/>}{clipboardDialog?.kind === 'paste' && <div ref={clipboardHost}><Modal title={clipboardText.title} onClose={closeClipboard}>
    <div className="modal-content">
      <p>{clipboardText.hint}</p>
      {clipboardDialog.entries.length ? <>
        <label>{clipboardText.choose}<select aria-label={clipboardText.choose} value={clipboardIndex} onChange={event => setClipboardIndex(Number(event.target.value))}>
          {clipboardDialog.entries.map((entry, index) => <option value={index} key={index}>{clipboardText.item(index + 1, Array.from(entry).slice(0, 80).join('').replace(/\s+/g, ' '))}</option>)}
        </select></label>
        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 220, overflow: 'auto' }}>{clipboardDialog.entries[clipboardIndex]?.slice(0, 1200)}</pre>
      </> : <p>{clipboardText.empty}</p>}
      <ErrorBox message={clipboardError}/>
    </div>
    <footer className="modal-footer"><button disabled={!clipboardDialog.entries.length} onClick={() => { sqlClipboardStack.clear(); closeClipboard(); }}>{clipboardText.clear}</button><span className="grow"/>
      <button onClick={closeClipboard}>{zh.common.cancel}</button><button className="primary" disabled={!clipboardDialog.entries.length || !!clipboardError}
        onClick={() => pasteClipboard(clipboardDialog)}>{clipboardText.paste}</button></footer>
  </Modal></div>}{clipboardDialog?.kind === 'quoted' && <div ref={clipboardHost}><Modal title={quotedText.title} onClose={closeClipboard}>
    <div className="modal-content">
      <p>{quotedText.hint}</p>
      <label>{quotedText.format}<select aria-label={quotedText.format} value={quoteFormat} onChange={event => {
        const format = sqlQuoteFormats.find(value => value === event.target.value);
        if (format) setQuoteFormat(format);
      }}>{sqlQuoteFormats.map(format => <option key={format} value={format}>{quotedText.formats[format]}</option>)}</select></label>
      <pre aria-label={quotedText.preview} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 220, overflow: 'auto' }}>{quoted}</pre>
      <ErrorBox message={clipboardError}/>
    </div>
    <footer className="modal-footer"><span className="grow"/><button onClick={closeClipboard}>{zh.common.cancel}</button>
      <button className="primary" onClick={() => copyQuoted(clipboardDialog, quoted)}>{quotedText.copy}</button></footer>
  </Modal></div>}</div>;
}
