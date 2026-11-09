import type { KeyboardEvent } from 'react';

export function queryResultHost(root: HTMLElement | null, target: EventTarget | null): HTMLElement | undefined {
  if (!(target instanceof HTMLElement) || !root?.contains(target)) return;
  const host = target.closest<HTMLElement>('.query-result-grid');
  if (host && root.contains(host)) return host;
}

/** 只有数据网格或它自己的替换面板接收结果替换，编辑格和其它输入保留原键盘行为。 */
function resultReplaceTarget(target: HTMLElement): boolean {
  if (target.closest('.pg-table-find')) return true;
  return !!target.closest('[role="grid"], [role="gridcell"], [role="columnheader"]') &&
    !target.isContentEditable && !target.closest('input, textarea, select, [role="textbox"], [role="combobox"]');
}

/** 原生编辑菜单按当前焦点派发；只读结果内也不回退到 SQL 编辑器。 */
export function runFocusedQueryReplace(root: HTMLElement | null, replaceResult: () => boolean, replaceSql: () => void | Promise<void>) {
  const target = document.activeElement;
  if (!queryResultHost(root, target)) return replaceSql();
  if (target instanceof HTMLElement && resultReplaceTarget(target)) replaceResult();
}

/** 已打开的面板复用原预览和输入，仅在可输入时把焦点放回替换字段。 */
export function focusQueryResultReplacement(root: HTMLElement | null): void {
  root?.querySelector<HTMLInputElement>('.query-result-grid [data-query-result-replace-input]:not(:disabled)')
    ?.focus({ preventScroll: true });
}

export function handleQueryResultReplaceShortcut(event: KeyboardEvent<HTMLDivElement>, replace: () => boolean): boolean {
  if (event.defaultPrevented || event.repeat || event.nativeEvent.isComposing || event.keyCode === 229 ||
      event.shiftKey || !event.metaKey && !event.ctrlKey) return false;
  const mac = globalThis.navigator?.platform?.startsWith('Mac');
  const key = event.key.toLowerCase();
  const matches = mac
    ? event.metaKey && event.altKey && !event.ctrlKey && (key === 'f' || event.code === 'KeyF')
    : event.ctrlKey && !event.altKey && !event.metaKey && key === 'h';
  const target = event.target;
  if (!matches || !(target instanceof HTMLElement) || !queryResultHost(event.currentTarget, target) ||
      !resultReplaceTarget(target) || !replace()) return false;
  event.preventDefault();
  event.stopPropagation();
  return true;
}

/** 仅响应当前查询的数字键。macOS 编辑区保留 Option 字符输入，切换后焦点留在结果区。 */
export function handleQueryResultShortcut(event: KeyboardEvent<HTMLDivElement>, editorFocused: () => boolean,
  resultCount: number, select: (index: number) => boolean): void {
  if (resultCount < 2 || event.defaultPrevented || event.repeat || event.nativeEvent.isComposing || event.keyCode === 229 ||
      !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !/^Digit[0-9]$/.test(event.code)) return;
  const target = event.target;
  if (!(target instanceof HTMLElement) || !event.currentTarget.contains(target) ||
      target.closest('[role="menu"], [role="menuitem"]')) return;
  const results = target.closest<HTMLElement>('.query-layout-results');
  if (!results && (navigator.platform.startsWith('Mac') || !target.closest('.query-layout-editor .monaco-editor') || !editorFocused())) return;
  if (results && (target.isContentEditable || target.closest('input, textarea, [role="textbox"]'))) return;
  const index = (Number(event.code.at(-1)) || 10) - 1;
  if (index >= resultCount || !select(index)) return;
  event.preventDefault();
  event.stopPropagation();
  // 切换后网格可能卸载，先把焦点移到稳定的容器，后续按键仍能切换。
  results?.querySelector<HTMLElement>(':scope > .result-body')?.focus({ preventScroll: true });
}
