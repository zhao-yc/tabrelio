import type { KeyboardEvent } from 'react';

/** 只消费实际位于当前编辑区的组合键。输入法、连按和从 Portal 冒泡的按键留给原控件。 */
export function tableApplyShortcut(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.nativeEvent.defaultPrevented || event.nativeEvent.isComposing || event.keyCode === 229 ||
      event.repeat || event.ctrlKey === event.metaKey || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'r' ||
      !event.currentTarget.contains(event.target as Node)) return false;
  event.preventDefault();
  event.stopPropagation();
  return true;
}

/** 只提交单行筛选输入，保留输入法确认、下拉选择和多行文本原有的 Enter。 */
export function tableFilterInputEnter(event: KeyboardEvent): boolean {
  const target = event.target as HTMLInputElement;
  if (event.key !== 'Enter' || event.defaultPrevented || event.nativeEvent.defaultPrevented ||
      event.nativeEvent.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey ||
      target.tagName !== 'INPUT' || !['text', 'search', 'number'].includes(target.type) ||
      target.disabled || target.readOnly || !event.currentTarget.contains(target)) return false;
  event.preventDefault();
  event.stopPropagation();
  return !event.repeat;
}
