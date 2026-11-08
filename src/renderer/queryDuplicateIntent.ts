import type * as monaco from 'monaco-editor';
import type { ConnectionProfile } from '../shared/contracts';
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
  open(tab: Omit<WorkspaceTab, 'id'>): void;
  chooseTarget?(draft: QueryTargetDraft): void;
}
export interface QueryTargetDraft { sourceTabId: string; title: string; sql: string }
export type QueryDuplicateMode = 'all' | 'selection' | 'target';
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
  readonly #selected?: { key: string; sql: string };
  readonly #subscriptions: Array<{ dispose(): void }> = [];
  #valid = true;
  #started = false;
  #flushing = true;
  constructor(private readonly ports: QueryDuplicatePorts, private readonly mode: QueryDuplicateMode = 'all') {
    const editor = ports.editor(), model = editor?.getModel(), scope = ports.scope();
    if (!editor || !model || model.isDisposed() || editor.getRawOptions().readOnly || !scope.tab || scope.tab.kind !== 'query' || !scope.connection || !scope.present || !scope.active || scope.blocked) throw Error(text.unavailable);
    this.#editor = editor; this.#model = model; this.#version = model.getVersionId(); this.#sql = model.getValue(); this.#scope = scope; this.#source = { ...scope.tab }; this.#context = contextKey(scope.tab); this.#draft = scope.tab.sql ?? '';
    if (this.#sql.length > 20_000_000) throw Error(text.tooLarge);
    if (mode === 'selection') {
      const ranges = editor.getSelections();
      const range = ranges?.[0];
      if (ranges?.length !== 1 || !range || range.isEmpty()) throw Error(text.selectionRequired);
      const sql = model.getValueInRange(range);
      if (!sql.trim()) throw Error(text.selectionRequired);
      this.#selected = { key: selectionKey(range), sql };
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
    return !!tab && scope.present && scope.active && !scope.blocked && scope.connection === this.#scope.connection && scope.connectionVersion === this.#scope.connectionVersion && scope.sessionId === this.#scope.sessionId
      && tab.kind === 'query' && tab.id === this.#source.id && tab.connectionId === this.#source.connectionId && tab.title === this.#source.title && tab.sourceBinding === this.#source.sourceBinding && tab.fileSourceBinding === this.#source.fileSourceBinding && contextKey(tab) === this.#context
      && ((tab.sql ?? '') === this.#sql || this.#flushing && (tab.sql ?? '') === this.#draft);
  }
  /** 选区移动即撤销本次操作，移回同一范围也不会重新取得原意图。 */
  #selectionCurrent(): boolean {
    if (!this.#selected) return true;
    const ranges = this.#editor.getSelections();
    return ranges?.length === 1 && selectionKey(ranges[0]) === this.#selected.key;
  }
  /** 每个await后以及原子open前校验同一编辑器/模型/版本，恢复原值不能复活旧意图。 */
  #assert(): void {
    try { if (!this.#valid || !this.#matches() || this.ports.editor() !== this.#editor || this.#editor.getModel() !== this.#model || this.#model.isDisposed() || this.#model.getVersionId() !== this.#version || this.#model.getValue() !== this.#sql || this.#editor.getRawOptions().readOnly || !this.#selectionCurrent()) throw Error(); }
    catch { this.#valid = false; throw Error(text.changed); }
  }
  /** flush从既有正文桥取全文；只读协议缓存/显式上下文后创建未绑定草稿，不执行SQL或读文件。 */
  async run(): Promise<void> {
    if (this.#started) throw Error(text.changed); this.#started = true;
    try {
      this.#assert(); const sql = await this.ports.flush(this.#editor, this.#draft); this.#assert();
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
      const candidate: Omit<WorkspaceTab, 'id'> = { kind: 'query', title: copyTitle(this.#source.title, this.#selected ? text.selectionSuffix : text.suffix),
        connectionId: this.#source.connectionId, sql: this.#selected?.sql ?? sql, ...queryDatabasePatch({ state: 'known', database: context.database }) };
      this.#assert(); this.ports.open(candidate);
    } finally { this.dispose(); }
  }
  /** 卸载或终态释放模型/store观察；不改原模型、撤销栈、查询来源或会话。 */
  dispose(): void { this.#valid = false; for (const subscription of this.#subscriptions.splice(0)) subscription.dispose(); }
}
