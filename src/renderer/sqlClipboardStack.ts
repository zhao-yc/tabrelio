import type * as monaco from 'monaco-editor';

export const sqlClipboardLimits = { entries: 12, entryUnits: 64 * 1024, totalUnits: 256 * 1024 } as const;
export const sqlClipboardStackAction = 'dbark-sql-clipboard-stack';

/** 仅留在当前渲染器内存，去重后优先保留最近内容；超长复制不会挤掉原记录。 */
export class SqlClipboardStack {
  private entries: string[] = [];

  remember(value: string): void {
    if (!value.length || value.length > sqlClipboardLimits.entryUnits) return;
    const candidates = [value, ...this.entries.filter(entry => entry !== value)];
    let units = 0;
    this.entries = candidates.slice(0, sqlClipboardLimits.entries).filter(entry => {
      units += entry.length;
      return units <= sqlClipboardLimits.totalUnits;
    });
  }

  snapshot(): readonly string[] { return [...this.entries]; }
  clear(): void { this.entries = []; }
}

export const sqlClipboardStack = new SqlClipboardStack();

/** 对话框打开时冻结唯一选区与版本，模型或选区改变一次即撤销，禁止覆盖后来编辑。 */
export function captureSqlClipboardSelection(editor: monaco.editor.IStandaloneCodeEditor, allowed: () => boolean) {
  const model = editor.getModel(), selections = editor.getSelections();
  if (!model || model.isDisposed() || selections?.length !== 1 || !allowed()) return;
  let range = selections[0], version = model.getVersionId();
  let active = true, disposed = false;
  const invalidationListeners = new Set<() => void>();
  const matches = () => {
    const current = editor.getSelections();
    return editor.getModel() === model && !model.isDisposed() && model.getVersionId() === version &&
      current?.length === 1 && range.equalsSelection(current[0]) && allowed();
  };
  const invalidate = () => {
    if (!active) return;
    active = false;
    for (const listener of invalidationListeners) listener();
  };
  const current = () => {
    if (active && !matches()) invalidate();
    return active;
  };
  const subscriptions = [
    editor.onDidChangeModel(invalidate), editor.onDidDispose(invalidate),
    model.onDidChangeContent(invalidate), editor.onDidChangeCursorSelection(current),
  ];
  /** 暂停 Monaco 对待清理自动缩进行的处理，避免本次替换顺带改动选区外的文本。 */
  const executeExactEdit = (source: string, edit: monaco.IRange, text: string, cursor?: monaco.editor.ICursorStateComputer) => {
    const trim = model.getOptions().trimAutoWhitespace;
    if (trim) model.updateOptions({ trimAutoWhitespace: false });
    try { return editor.executeEdits(source, [{ range: edit, text, forceMoveMarkers: true }], cursor); }
    finally { if (trim && !model.isDisposed()) model.updateOptions({ trimAutoWhitespace: true }); }
  };
  /** 统一原选区的一步编辑；调用方分别校验粘贴或替换的输出预算。 */
  function replace(text: string, source: string): boolean {
    if (!current()) return false;
    active = false;
    editor.pushUndoStop();
    const edited = executeExactEdit(source, range, text);
    if (edited) editor.pushUndoStop();
    return edited;
  }
  return {
    current,
    replace,
    /** 单处替换只编辑本次命中。同步事务完成后，仅在同一模型和预期新选区上续领权限。 */
    replaceMatch(start: number, end: number, text: string, source: string, limit: number) {
      if (!current() || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > model.getValueLengthInRange(range)) return;
      const offset = model.getOffsetAt(range.getStartPosition());
      const from = model.getPositionAt(offset + start), to = model.getPositionAt(offset + end);
      // CRLF 中间的 UTF-16 偏移没有对应的 Monaco 光标位置，不能用向前取整的坐标修改文本。
      if (model.getOffsetAt(from) !== offset + start || model.getOffsetAt(to) !== offset + end) return;
      const value = text.replace(/\r\n|\r|\n/g, model.getEOL());
      const length = model.getValueLengthInRange(range) - (end - start) + value.length;
      if (length > limit) return { limited: true } as const;
      const edit = { startLineNumber: from.lineNumber, startColumn: from.column, endLineNumber: to.lineNumber, endColumn: to.column };
      if (value === model.getValueInRange(edit)) return { text: model.getValueInRange(range), nextOffset: start + value.length } as const;
      let nextRange = range;
      active = false;
      editor.pushUndoStop();
      const edited = executeExactEdit(source, edit, value, () => {
        const nextEnd = model.getPositionAt(offset + length);
        nextRange = range.setEndPosition(nextEnd.lineNumber, nextEnd.column);
        return [nextRange];
      });
      if (edited) editor.pushUndoStop();
      if (!edited || disposed || editor.getModel() !== model || model.isDisposed() || model.getVersionId() !== version + 1) return;
      range = nextRange;
      version = model.getVersionId();
      active = true;
      if (!current()) return;
      return { text: model.getValueInRange(range), nextOffset: start + value.length } as const;
    },
    /** 失效时撤销已展示的匹配和进行中的查找，主动提交或关闭无需发出失效通知。 */
    onInvalidated(listener: () => void) {
      invalidationListeners.add(listener);
      return () => { invalidationListeners.delete(listener); };
    },
    /** 查找结果是选区内的 UTF-16 偏移，定位前复核边界及原模型。 */
    locate(start: number, end: number): boolean {
      if (!current() || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > model.getValueLengthInRange(range)) return false;
      const offset = model.getOffsetAt(range.getStartPosition());
      const from = model.getPositionAt(offset + start), to = model.getPositionAt(offset + end);
      const match = { startLineNumber: from.lineNumber, startColumn: from.column, endLineNumber: to.lineNumber, endColumn: to.column };
      active = false;
      editor.setSelection(match);
      editor.revealRangeInCenterIfOutsideViewport(match);
      return true;
    },
    selectedText(limit: number): string | undefined {
      if (!current() || range.isEmpty()) return;
      if (model.getValueLengthInRange(range) > limit) throw new RangeError('原选区超过读取上限');
      return model.getValueInRange(range);
    },
    dispose() { disposed = true; active = false; invalidationListeners.clear(); for (const subscription of subscriptions) subscription.dispose(); },
    paste(text: string): boolean {
      return !!text.length && text.length <= sqlClipboardLimits.entryUnits && replace(text, sqlClipboardStackAction);
    },
  };
}
