import type { KeyboardEvent } from 'react';
import { errorMessage } from './lib';
import { appModalSelector } from './modalSelectors';
import { useWorkspace } from './store';
import { uiCommands } from './uiCommands';

/** 复用当前查询的命令代次。执行只接受原 SQL 编辑焦点，停止还可从结果或工具栏触发。 */
export function handleQueryExecutionShortcut(event: KeyboardEvent<HTMLDivElement>, tabId: string,
  editorFocused: () => boolean): boolean {
  if (event.defaultPrevented || event.nativeEvent.defaultPrevented || event.nativeEvent.isComposing ||
      event.keyCode === 229 || event.repeat || event.altKey) return false;
  const key = event.key.toLowerCase();
  if (event.ctrlKey === event.metaKey || !['r', 't', '.'].includes(key)) return false;
  const mac = navigator.platform.startsWith('Mac');
  if (mac !== event.metaKey) return false;
  const id = key === 'r' ? event.shiftKey ? 'execute-current' : 'execute'
    : !event.shiftKey && key === (mac ? '.' : 't') ? 'stop' : undefined;
  if (!id || useWorkspace.getState().settings.activeTabId !== tabId || document.querySelector(appModalSelector)) return false;
  const target = event.target;
  if (!(target instanceof HTMLElement) || !event.currentTarget.contains(target) ||
      target.closest('.workspace-tab') !== event.currentTarget || target.closest('[role="menu"], [role="menuitem"]')) return false;
  const sqlFocus = !!target.closest('.query-layout-editor .monaco-editor') && editorFocused();
  if (id === 'stop') {
    if (!sqlFocus && (target.isContentEditable || target.closest('input, textarea, select, [role="textbox"]'))) return false;
  } else if (!sqlFocus) return false;
  const state = uiCommands.getSnapshot();
  if (!state.commands.some(command => command.id === id && command.enabled)) return false;
  event.preventDefault();
  event.stopPropagation();
  void uiCommands.execute({ id, revision: state.revision }).catch(reason => useWorkspace.getState().notify(errorMessage(reason), true));
  return true;
}
