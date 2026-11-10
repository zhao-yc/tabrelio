import type { editor } from 'monaco-editor';
import type { LocalReferenceRange, LocalReferences } from '../shared/localReferences';

type Editor = Pick<editor.IStandaloneCodeEditor, 'getModel' | 'getPosition' | 'getSelections' | 'createDecorationsCollection' |
  'onDidChangeCursorSelection' | 'onDidChangeModelContent' | 'onDidChangeModel' | 'onDidFocusEditorText' | 'onDidBlurEditorText' | 'onDidDispose'>;
type Source = { model: editor.ITextModel; version: number; offset: number };

/** 仅在光标停稳后分析当前模型；不使用同字回退，也不与显式查找引用共用取消句柄。 */
export function bindSqlReferenceHighlights(instance: Editor, ports: {
  current(): boolean;
  sourceLimit: number;
  analyze(source: string, offset: number, signal: AbortSignal): Promise<LocalReferences>;
}) {
  const decorations = instance.createDecorationsCollection();
  let disposed = false, timer: ReturnType<typeof setTimeout> | undefined, active: AbortController | undefined;
  let shown: (Source & { ranges: LocalReferenceRange[] }) | undefined;

  function invalidate(): void {
    clearTimeout(timer); timer = undefined;
    active?.abort(); active = undefined;
    if (shown) { shown = undefined; decorations.clear(); }
  }
  function capture(): Source | undefined {
    if (disposed || !ports.current()) return undefined;
    const model = instance.getModel(), position = instance.getPosition(), selections = instance.getSelections();
    if (!model || model.isDisposed() || !position || selections?.length !== 1 || !selections[0].isEmpty() ||
        model.getValueLength() > ports.sourceLimit || !model.getWordAtPosition(position)) return undefined;
    return { model, version: model.getVersionId(), offset: model.getOffsetAt(position) };
  }
  async function analyze(source: Source): Promise<void> {
    const { model, version, offset } = source;
    const sameSource = () => {
      const latest = capture();
      return latest?.model === model && latest.version === version && latest.offset === offset;
    };
    if (!sameSource()) return;
    const controller = new AbortController(); active = controller;
    try {
      const sql = model.getValue(), result = await ports.analyze(sql, offset, controller.signal);
      if (active !== controller || controller.signal.aborted || !sameSource() || result.status !== 'ready') return;
      const ranges = [result.declaration, ...result.references];
      if (!result.references.length || ranges.some(range => !Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) ||
          range.start < 0 || range.start >= range.end || range.end > sql.length)) return;
      const values = ranges.map((range, index) => {
        const start = model.getPositionAt(range.start), end = model.getPositionAt(range.end);
        return { range: { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column },
          options: { description: 'sql-local-reference', inlineClassName: index === 0 ? 'sql-local-declaration' : 'sql-local-reference' } };
      });
      decorations.set(values);
      shown = { ...source, ranges };
    } catch { /* 分析失败不影响编辑，也不以相同文字冒充绑定。 */ }
    finally { if (active === controller) active = undefined; }
  }
  function refresh(): void {
    const source = capture();
    // 同一绑定的声明和引用之间移动时复用高亮，避免重复起线程。
    if (source && shown?.model === source.model && shown.version === source.version &&
        shown.ranges.some(range => source.offset >= range.start && source.offset <= range.end)) return;
    invalidate();
    if (source) timer = setTimeout(() => { timer = undefined; void analyze(source); }, 280);
  }

  const listeners = [instance.onDidChangeCursorSelection(refresh), instance.onDidChangeModelContent(invalidate),
    instance.onDidChangeModel(invalidate), instance.onDidFocusEditorText(refresh), instance.onDidBlurEditorText(invalidate), instance.onDidDispose(dispose)];
  function dispose(): void {
    if (disposed) return;
    disposed = true;
    invalidate();
    for (const listener of listeners) listener.dispose();
  }
  refresh();
  return { invalidate, dispose };
}
