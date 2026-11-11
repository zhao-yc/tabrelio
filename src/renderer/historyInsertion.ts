import type * as monaco from 'monaco-editor';
import type { WorkspaceTab } from './store';
import { snippetEdit } from './snippetInsertion';
import { historyInsertionZh as text } from './locales/historyInsertion.zh-CN';

export interface HistoryInsertionScope {
  tab: WorkspaceTab | undefined; activeTabId: string | undefined; connection: object | undefined; connectionVersion: number;
  selection: object | undefined; session: string; execution: string; alive: boolean; busy: boolean; closing: boolean;
}
export interface HistoryInsertionTarget {
  readonly title: string;
  readonly connectionId: string;
  current(): boolean;
  insert(sql: string, drop?: ObjectIdentifierDrop, applyBuiltin?: () => void): void;
  dispose(): void;
  subscribe(listener: () => void): () => void;
}
export interface ObjectIdentifierDrop { editor: HistoryInsertionEditor; position: monaco.IPosition }
interface Model {
  isDisposed(): boolean;
  getVersionId(): number;
  getValueLength(): number;
  getValueLengthInRange(range: monaco.IRange): number;
  onDidChangeContent(listener: () => void): monaco.IDisposable;
}
export interface HistoryInsertionEditor {
  getModel(): Model | null;
  getSelection(): monaco.IRange | null;
  getSelections?(): monaco.Selection[] | null;
  getDomNode?(): HTMLElement | null;
  getRawOptions?(): { readOnly?: boolean };
  focus?(): void;
  onDidChangeModel(listener: () => void): monaco.IDisposable;
  onDidChangeCursorSelection(listener: () => void): monaco.IDisposable;
  onDidDispose(listener: () => void): monaco.IDisposable;
  pushUndoStop(): boolean;
  executeEdits(source: string, edits: monaco.editor.IIdentifiedSingleEditOperation[], cursor?: monaco.editor.ICursorStateComputer): boolean;
}

export type QueryInsertionMode = 'object-identifier' | 'snippet';

/** 注册只删除自身工厂；StrictMode的旧清理不能撤销后来注册的编辑器。 */
export class HistoryInsertionRegistry {
  private readonly factories = new Map<string, (mode?: QueryInsertionMode) => HistoryInsertionTarget | null>();
  register(tabId: string, capture: (mode?: QueryInsertionMode) => HistoryInsertionTarget | null): () => void {
    this.factories.set(tabId, capture);
    return () => { if (this.factories.get(tabId) === capture) this.factories.delete(tabId); };
  }
  capture(tabId: string, mode?: QueryInsertionMode): HistoryInsertionTarget | null { return this.factories.get(tabId)?.(mode) ?? null; }
}

/** 捕获原模型版本和选区；任何导航/编辑/选区变化都永久撤销，恢复同值也不复活。 */
export function captureHistoryInsertion(editor: HistoryInsertionEditor, read: () => HistoryInsertionScope, subscribe: (listener: () => void) => () => void, mode?: QueryInsertionMode): HistoryInsertionTarget | null {
  const initial = read(), model = editor.getModel(), selected = editor.getSelection();
  if (!initial.alive || initial.busy || initial.closing || initial.tab?.kind !== 'query' || initial.activeTabId !== initial.tab.id || !initial.connection || !model || model.isDisposed() || !selected) return null;
  // 侧栏和片段只接受可见的单一选区，不对结果专注模式、只读正文或多光标作隐式编辑。
  const cursor = mode === 'object-identifier' ? editor.getSelections?.()?.[0] : undefined;
  const editable = () => !mode || (editor.getSelections?.()?.length === 1 &&
    !!editor.getDomNode?.()?.getClientRects().length && !editor.getRawOptions?.().readOnly);
  if (!editable()) return null;
  const version = model.getVersionId();
  const range = { startLineNumber: selected.startLineNumber, startColumn: selected.startColumn, endLineNumber: selected.endLineNumber, endColumn: selected.endColumn };
  let valid = true, disposed = false;
  const listeners = new Set<() => void>(), cleanup: Array<() => void> = [];
  const invalidate = () => { if (!valid) return; valid = false; for (const listener of [...listeners]) listener(); };
  /** 比较实际对象及会话/执行编号，不把相同标题、SQL或标签ID当原编辑器身份。 */
  const matches = () => {
    try {
      const now = read(), selection = editor.getSelection();
      return !disposed && editable() && now.alive && !now.busy && !now.closing && now.tab === initial.tab && now.activeTabId === initial.activeTabId
        && now.connection === initial.connection && now.connectionVersion === initial.connectionVersion && now.selection === initial.selection
        && now.session === initial.session && now.execution === initial.execution && editor.getModel() === model && !model.isDisposed() && model.getVersionId() === version
        && !!selection && selection.startLineNumber === range.startLineNumber && selection.startColumn === range.startColumn && selection.endLineNumber === range.endLineNumber && selection.endColumn === range.endColumn;
    } catch { return false; }
  };
  const current = () => { if (valid && !matches()) invalidate(); return valid && !disposed; };
  cleanup.push(subscribe(() => { current(); }));
  for (const event of [model.onDidChangeContent.bind(model), editor.onDidChangeModel.bind(editor), editor.onDidChangeCursorSelection.bind(editor), editor.onDidDispose.bind(editor)]) {
    const disposable = event(invalidate); cleanup.push(() => disposable.dispose());
  }
  /** 消费前解除监听，随后的一次真实编辑不能被自己的store通知误当作外部变化。 */
  const dispose = () => { if (disposed) return; disposed = true; invalidate(); for (const release of cleanup.splice(0)) release(); listeners.clear(); };
  return {
    title: initial.tab.title,
    connectionId: initial.tab.connectionId,
    current,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispose,
    insert(sql, drop, applyBuiltin) {
      if (!current() || (drop && (!cursor || drop.editor !== editor)) || (applyBuiltin && mode !== 'snippet')) throw Error(text.changed);
      // 拖入的位置来自原编辑器的命中测试，只插入文本，保留拖动前已选中的文字。
      const destination = drop ? {
        startLineNumber: drop.position.lineNumber, startColumn: drop.position.column,
        endLineNumber: drop.position.lineNumber, endColumn: drop.position.column,
      } : range;
      if (typeof sql !== 'string' || sql.length > 20_000_000 || model.getValueLength() - model.getValueLengthInRange(destination) + sql.length > 20_000_000) throw Error(text.tooLarge);
      dispose();
      if (applyBuiltin) { applyBuiltin(); return; }
      editor.pushUndoStop();
      const edit = snippetEdit(destination, sql);
      const accepted = cursor
        ? editor.executeEdits('dbark-object-identifier-insertion', [edit], changes => changes.map(({ range: inserted }) =>
          cursor.setEndPosition(inserted.endLineNumber, inserted.endColumn).setStartPosition(inserted.endLineNumber, inserted.endColumn)
            .setEndPosition(inserted.endLineNumber, inserted.endColumn)))
        : editor.executeEdits('dbark-history-insertion', [edit]);
      editor.pushUndoStop();
      if (!accepted) throw Error(text.failed);
      if (cursor) editor.focus?.();
    },
  };
}
