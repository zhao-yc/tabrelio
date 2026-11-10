import type * as monaco from 'monaco-editor';
import type { ConnectionProfile } from '../shared/contracts';
import { SqlScriptScanner } from '../shared/sqlScriptScanner';
import { queryParameterLimits } from '../shared/queryParameters';
import type { NavigableStatement } from '../shared/statementNavigation';
import { queryDatabasePatch, type QueryDatabaseContext } from '../shared/queryContext';
import type { WorkspaceTab } from './store';
import { queryDuplicateZh as text } from './locales/queryDuplicate.zh-CN';

export interface QueryDuplicateScope {
  tab?: WorkspaceTab; connection?: ConnectionProfile; connectionVersion: number; sessionId: string;
  present: boolean; active: boolean; blocked: boolean;
}
export interface QueryDuplicatePorts {
  editor(): monaco.editor.IStandaloneCodeEditor | null;
  scope(): QueryDuplicateScope;
  subscribe(changed: () => void): () => void;
  flush(editor: monaco.editor.IStandaloneCodeEditor, expectedDraft: string): string | Promise<string>;
  database(scope: QueryDuplicateScope): QueryDatabaseContext | Promise<QueryDatabaseContext>;
  open(tab: Omit<WorkspaceTab, 'id'>): void | Promise<void>;
  openBatch?(tabs: readonly Omit<WorkspaceTab, 'id'>[]): void;
  chooseTarget?(draft: QueryTargetDraft): void;
}
export interface QueryTargetDraft { sourceTabId: string; title: string; sql: string }
export type QueryDuplicateMode = 'all' | 'selection' | 'target' | 'statement' | 'statements' | 'save-statements' | 'split-statements';
export const statementDraftBatchLimit = 20;
const contextKey = (tab?: WorkspaceTab) => JSON.stringify([tab?.database ?? null, tab?.databaseContext?.state ?? 'legacy', tab?.databaseContext?.state === 'known' ? tab.databaseContext.database : null]);
/** 标题保留Unicode字符边界，符合既有settings保存的256单元限制。 */
function copyTitle(title: string, suffix: string): string {
  let value = '';
  for (const char of title) {
    if (value.length + char.length > 256 - suffix.length) break;
    value += char;
  }
  return value + suffix;
}
function selectionKey(range: monaco.IRange): string {
  return [range.startLineNumber, range.startColumn, range.endLineNumber, range.endColumn].join(':');
}

function editorSelectionKey(editor: monaco.editor.IStandaloneCodeEditor): string {
  return editor.getSelections()?.map(selectionKey).join('|') ?? '';
}

/** 客户端分隔符随独立草稿保留，避免例程中的分号在新标签中被拆成多条。 */
function statementDraft(source: string, range: NavigableStatement | undefined, dialect: ConnectionProfile['dialect']): string {
  if (!range || ![range.start, range.end, range.delimiterStart, range.delimiterEnd].every(Number.isSafeInteger) ||
      range.start < 0 || range.start >= range.end || range.end > range.delimiterStart ||
      range.delimiterStart > range.delimiterEnd || range.delimiterEnd > source.length) throw Error(text.changed);
  const original = source.slice(range.start, range.delimiterStart === range.delimiterEnd ? range.end : range.delimiterEnd);
  if (dialect !== 'mysql' && dialect !== 'mariadb') return original;
  const delimiter = source.slice(range.delimiterStart, range.delimiterEnd);
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  if (delimiter && delimiter !== ';') return ['DELIMITER ' + delimiter, original, 'DELIMITER ;'].join(eol);
  if (delimiter || !original.includes(';')) return original;
  // 未终止的末条语句也可能沿用非标准分隔符。默认分段有歧义时补一个正文未使用的标记。
  try {
    const parts = new SqlScriptScanner(false, false, false, false).push(original, true, 2);
    if (parts.length === 1 && parts[0] === original.trim()) return original;
  } catch { /* 原语句由现有导航会话确定，此处只测试能否省略分隔符声明。 */ }
  const used = new Set(original.match(/__dbark_\d+!/g));
  let index = 0, marker = '__dbark_0!';
  while (used.has(marker)) marker = '__dbark_' + ++index + '!';
  return ['DELIMITER ' + marker, original, marker, 'DELIMITER ;'].join(eol);
}

/** 目录勾选按原顺序输出，各语句独立保留必要的终止符和客户端分隔符。 */
function statementDraftParts(source: string, ranges: readonly NavigableStatement[], dialect: ConnectionProfile['dialect']): string[] {
  if (!ranges.length) throw Error(text.selectionRequired);
  let previous = 0;
  return ranges.map(range => {
    if (range.start < previous) throw Error(text.changed);
    const sql = statementDraft(source, range, dialect);
    previous = range.delimiterEnd;
    return sql;
  });
}
export function statementDraftSql(source: string, ranges: readonly NavigableStatement[], dialect: ConnectionProfile['dialect']): string {
  return statementDraftParts(source, ranges, dialect).join(source.includes('\r\n') ? '\r\n' : '\n');
}

/** 结果来源只提供语句范围。用原目录的打包方式保留例程体所需的客户端分隔符。 */
export function resultStatementTargetDraft(tab: Pick<WorkspaceTab, 'id' | 'title'>, source: string, dialect: ConnectionProfile['dialect']): QueryTargetDraft {
  if (!source.trim()) throw Error(text.changed);
  const sql = statementDraftSql(source, [{ start: 0, end: source.length, delimiterStart: source.length, delimiterEnd: source.length }], dialect);
  if (sql.length > 20_000_000 || new TextEncoder().encode(sql).byteLength > queryParameterLimits.sqlBytes) throw Error(text.tooLarge);
  return { sourceTabId: tab.id, title: copyTitle(tab.title, text.resultStatementSuffix), sql };
}

/** 一次复制只借用原模型读取权；任何失效永久撤销，创建目标时严格挑选草稿字段。 */
export class QueryDuplicateIntent {
  readonly #editor: monaco.editor.IStandaloneCodeEditor;
  readonly #model: monaco.editor.ITextModel;
  readonly #version: number;
  readonly #sql: string;
  readonly #scope: QueryDuplicateScope;
  readonly #source: WorkspaceTab;
  readonly #context: string;
  readonly #draft: string;
  readonly #readOnlySource: boolean;
  readonly #batch?: readonly string[];
  readonly #selected?: { key: string; sql: string; suffix: string };
  readonly #subscriptions: Array<{ dispose(): void }> = [];
  #valid = true;
  #started = false;
  #flushing = true;
  constructor(private readonly ports: QueryDuplicatePorts, private readonly mode: QueryDuplicateMode = 'all', statements?: readonly NavigableStatement[]) {
    const editor = ports.editor(), model = editor?.getModel(), scope = ports.scope();
    if (!editor || !model || model.isDisposed() || editor.getRawOptions().readOnly || !scope.tab || scope.tab.kind !== 'query' || !scope.connection || !scope.present || !scope.active || scope.blocked) throw Error(text.unavailable);
    this.#editor = editor; this.#model = model; this.#version = model.getVersionId(); this.#sql = model.getValue(); this.#scope = scope; this.#source = { ...scope.tab }; this.#context = contextKey(scope.tab); this.#draft = scope.tab.sql ?? '';
    this.#readOnlySource = mode === 'save-statements' || mode === 'split-statements';
    if (this.#sql.length > 20_000_000) throw Error(text.tooLarge);
    if (mode === 'split-statements') {
      const ranges = statements ?? [];
      if (ranges.length > statementDraftBatchLimit) throw Error(text.batchTooLarge(statementDraftBatchLimit));
      this.#batch = statementDraftParts(this.#sql, ranges, scope.connection.dialect);
    } else if (mode === 'statement' || mode === 'statements' || mode === 'save-statements') {
      const ranges = statements ?? [];
      this.#selected = { key: editorSelectionKey(editor), sql: statementDraftSql(this.#sql, ranges, scope.connection.dialect),
        suffix: mode === 'statement' ? text.statementSuffix : text.statementsSuffix };
    } else if (mode === 'selection') {
      const ranges = editor.getSelections();
      const range = ranges?.[0];
      if (ranges?.length !== 1 || !range || range.isEmpty()) throw Error(text.selectionRequired);
      const sql = model.getValueInRange(range);
      if (!sql.trim()) throw Error(text.selectionRequired);
      this.#selected = { key: selectionKey(range), sql, suffix: text.selectionSuffix };
    }
    try {
      const changed = () => { if (model.isDisposed() || model.getVersionId() !== this.#version || model.getValue() !== this.#sql) this.#valid = false; };
      this.#subscriptions.push(model.onDidChangeContent(changed), model.onWillDispose(() => { this.#valid = false; }), editor.onDidChangeModel(() => { this.#valid = false; }), editor.onDidDispose(() => { this.#valid = false; }));
      if (this.#selected) this.#subscriptions.push(editor.onDidChangeCursorSelection(() => {
        if (!this.#selectionCurrent()) this.#valid = false;
      }));
      this.#subscriptions.push({ dispose: ports.subscribe(() => { if (!this.#matches()) this.#valid = false; }) });
      this.#assert();
    } catch (error) { this.dispose(); throw error; }
  }
  /** 只允许flush自身把旧store正文推进到点击时已捕获的当前模型正文，其它来源不变。 */
  #matches(): boolean {
    const scope = this.ports.scope(), tab = scope.tab;
    const sql = tab?.sql ?? '';
    // 独立保存和批量打开均不写回原草稿，保留工作区存下的原始换行。
    const draftMatches = this.#readOnlySource ? sql === this.#draft : sql === this.#sql || this.#flushing && sql === this.#draft;
    return !!tab && scope.present && scope.active && !scope.blocked && scope.connection === this.#scope.connection && scope.connectionVersion === this.#scope.connectionVersion && scope.sessionId === this.#scope.sessionId
      && tab.kind === 'query' && tab.id === this.#source.id && tab.connectionId === this.#source.connectionId && tab.title === this.#source.title && tab.sourceBinding === this.#source.sourceBinding && tab.fileSourceBinding === this.#source.fileSourceBinding && contextKey(tab) === this.#context
      && draftMatches;
  }
  /** 选区移动即撤销本次操作，移回同一范围也不会重新取得原意图。 */
  #selectionCurrent(): boolean {
    if (!this.#selected) return true;
    return editorSelectionKey(this.#editor) === this.#selected.key;
  }
  /** 每个await后以及原子open前校验同一编辑器/模型/版本，恢复原值不能复活旧意图。 */
  #assert(): void {
    try { if (!this.#valid || !this.#matches() || this.ports.editor() !== this.#editor || this.#editor.getModel() !== this.#model || this.#model.isDisposed() || this.#model.getVersionId() !== this.#version || this.#model.getValue() !== this.#sql || this.#editor.getRawOptions().readOnly || !this.#selectionCurrent()) throw Error(); }
    catch { this.#valid = false; throw Error(text.changed); }
  }
  /** 复制前同步既有正文桥，独立保存只读原模型；获取数据库上下文后交付目标。 */
  async run(): Promise<void> {
    if (this.#started) throw Error(text.changed); this.#started = true;
    try {
      this.#assert();
      const sql = this.#readOnlySource ? this.#sql : await this.ports.flush(this.#editor, this.#draft);
      this.#assert();
      if (sql !== this.#sql) throw Error(text.changed);
      this.#flushing = false; this.#assert();
      // 指定目标时不读取原会话的默认库。选择器只接收已核对的正文快照。
      if (this.mode === 'target') {
        if (!this.ports.chooseTarget) throw Error(text.unavailable);
        this.ports.chooseTarget({ sourceTabId: this.#source.id, title: copyTitle(this.#source.title, text.suffix), sql });
        return;
      }
      const context = await this.ports.database(this.#scope); this.#assert();
      if (context.state !== 'known') throw Error(text.contextUnknown);
      const candidate = (body: string, suffix: string): Omit<WorkspaceTab, 'id'> => ({
        kind: 'query', title: copyTitle(this.#source.title, suffix), connectionId: this.#source.connectionId, sql: body,
        ...queryDatabasePatch(context),
      });
      if (this.#batch) {
        if (!this.ports.openBatch) throw Error(text.unavailable);
        const drafts = this.#batch.map((body, index) => candidate(body, text.splitSuffix(index + 1)));
        this.#assert(); this.ports.openBatch(drafts);
        return;
      }
      const draft = candidate(this.#selected?.sql ?? sql, this.#selected?.suffix ?? text.suffix);
      this.#assert(); await this.ports.open(draft);
    } finally { this.dispose(); }
  }
  /** 卸载或终态释放模型/store观察；不改原模型、撤销栈、查询来源或会话。 */
  dispose(): void { this.#valid = false; for (const subscription of this.#subscriptions.splice(0)) subscription.dispose(); }
}
