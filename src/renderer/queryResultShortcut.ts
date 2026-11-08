import type { KeyboardEvent } from 'react';

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
