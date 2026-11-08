import type { KeyboardEvent } from 'react';
import { appModalSelector } from './modalSelectors';

/** 只在本表的数据网格或刷新按钮内接管按键，保留筛选表单和单元格编辑器的输入。 */
export function tableRefreshShortcut(event: KeyboardEvent<HTMLDivElement>): boolean {
  if (event.defaultPrevented || event.nativeEvent.defaultPrevented || event.nativeEvent.isComposing ||
      event.keyCode === 229 || event.repeat || event.altKey || event.ctrlKey || event.shiftKey) return false;
  if (event.metaKey ? event.key.toLowerCase() !== 'r' || !navigator.platform.startsWith('Mac') : event.key !== 'F5')
    return false;
  const target = event.target;
  if (!(target instanceof HTMLElement) || !event.currentTarget.contains(target) ||
      target.closest('.workspace-tab') !== event.currentTarget ||
      !target.closest('[role="grid"], [data-table-refresh]') ||
      target.isContentEditable || target.closest('input, textarea, select, [role="textbox"], [role="menu"]') ||
      document.querySelector(appModalSelector)) return false;
  event.preventDefault();
  event.stopPropagation();
  return true;
}
