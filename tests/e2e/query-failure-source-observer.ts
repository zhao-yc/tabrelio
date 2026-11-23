/** 只通过Monaco官方getter保留原editor/model身份，不改正文、选区、撤销栈或SQL端口。 */
export function observeQueryFailureSource() {
  type Editor = import('monaco-editor').editor.ICodeEditor;
  type Model = import('monaco-editor').editor.ITextModel;
  const root = window as Window & { monaco?: typeof import('monaco-editor'); __queryFailureSourceObservation?: { editor: Editor; model: Model } };
  const editors = root.monaco?.editor.getEditors().filter(editor => {
    const node = editor.getContainerDomNode(); return node.isConnected && node.closest('.query-tab') && node.getClientRects().length > 0;
  });
  if (editors?.length !== 1) throw Error('失败定位当前查询编辑器不唯一');
  const editor = editors[0], model = editor.getModel();
  if (!model || model.isDisposed()) throw Error('失败定位原模型不可观察');
  const original = root.__queryFailureSourceObservation ??= { editor, model };
  if (original.editor !== editor || original.model !== model) throw Error('失败定位原editor/model身份已改变');
  const source = model.getValue();
  return { source, eol: model.getEOL(), version: model.getVersionId(), alternative: model.getAlternativeVersionId(), focused: editor.hasTextFocus(), selections: editor.getSelections()?.map(range => {
    const start = model.getOffsetAt(range.getStartPosition()), end = model.getOffsetAt(range.getEndPosition()); return { start, end, text: source.slice(start, end) };
  }) ?? null };
}

/** 仅读取当前查询页的实际 Monaco 标记和对应原文。 */
export function observeQueryMarkerText(label: string): string[] {
  const api = (window as Window & {monaco?: typeof import('monaco-editor')}).monaco;
  const editors = api?.editor.getEditors().filter(editor => {
    const node = editor.getContainerDomNode();
    return node.isConnected && !!node.closest('.query-tab') && node.getClientRects().length > 0;
  });
  const model = editors?.length === 1 && editors[0].getModel();
  if (!api || !model) throw Error('原查询模型不可观察');
  return api.editor.getModelMarkers({resource: model.uri}).filter(marker => marker.source === label)
    .map(marker => model.getValueInRange(marker));
}
