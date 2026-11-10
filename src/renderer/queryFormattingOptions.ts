import type * as monaco from 'monaco-editor';
import { appModalSelector, isAppModalNode } from './modalSelectors';
import { DeferredUpperSqlFormatting } from './sqlFormattingDeferred';
import type { FormattingPreferences } from './sqlFormatting';
import { sqlFormattingZh as text } from './locales/sqlFormatting.zh-CN';
import { useWorkspace } from './store';

/** 同一选区的格式化授权，窗口只可设置本次偏好。 */
export function captureQueryFormattingOptions(tabId: string, editor: () => monaco.editor.IStandaloneCodeEditor | null, dialect: NonNullable<FormattingPreferences['dialect']>, canEdit: () => boolean) {
  const origin = useWorkspace.getState(), tab = origin.settings.tabs.find(item => item.id === tabId);
  const instance = editor(), model = instance?.getModel();
  if (!tab || tab.kind !== 'query' || !model || model.getValue() !== (tab.sql ?? '').replace(/\r\n|\r|\n/g, model.getEOL())) throw Error(text.unavailable);
  const profile = origin.connections.find(item => item.id === tab.connectionId), version = origin.connectionVersions[tab.connectionId] ?? 0;
  let dialog: Element | undefined, observer: MutationObserver | undefined, otherModal = false;
  function inspect(records: MutationRecord[]) {
    for (const record of records) for (const node of record.addedNodes) {
      if (node.nodeType !== 1) continue;
      const element = node as Element;
      const matches = [...(isAppModalNode(node) ? [element] : []), ...element.querySelectorAll(appModalSelector)];
      if (matches.some(match => match !== dialog)) otherModal = true;
    }
  }
  const intent = new DeferredUpperSqlFormatting({
    editor,
    assertCurrent() {
      if (observer) inspect(observer.takeRecords());
      const now = useWorkspace.getState();
      const modals = document.querySelectorAll(appModalSelector);
      if (!canEdit() || otherModal || [...modals].some(modal => modal !== dialog) || now.settings.activeTabId !== tabId || now.activeJobs[tabId]
        || now.settings.tabs.find(item => item.id === tabId) !== tab || now.connections.find(item => item.id === tab.connectionId) !== profile
        || (now.connectionVersions[tab.connectionId] ?? 0) !== version) throw Error(text.unavailable);
    },
    subscribe(changed) {
      const off = useWorkspace.subscribe(changed);
      if (typeof MutationObserver !== 'undefined') {
        observer = new MutationObserver(records => { inspect(records); if (otherModal) changed(); });
        observer.observe(document.body, { childList: true, subtree: true });
      }
      return () => { off(); observer?.disconnect(); observer = undefined; };
    },
  });
  const preferences = { dialect, tabSize: origin.settings.editorTabSize, insertSpaces: origin.settings.editorInsertSpaces, expressionWidth: origin.settings.sqlExpressionWidth, keywordCase: dialect === 'mysql' ? origin.settings.sqlKeywordCase : 'preserve' };
  return {
    intent, preferences,
    setDialog(element: Element | null) { dialog = element?.closest(appModalSelector) ?? undefined; },
    focus() { if (editor() === instance && useWorkspace.getState().settings.activeTabId === tabId) instance?.focus(); },
  };
}

export type QueryFormattingOptions = ReturnType<typeof captureQueryFormattingOptions>;
