import { useLayoutEffect, type RefObject } from 'react';
import { appModalSelector } from './modalSelectors';

/** 结果查看器可以在自己的单层对话框查找。其它弹窗打开时，原网格不能接收按键。 */
export function gridFindModalBlocked(scope: HTMLElement, allowOwnDialog = false): boolean {
  const dialogs = scope.ownerDocument.querySelectorAll(appModalSelector);
  return dialogs.length > 0 && !(allowOwnDialog && dialogs.length === 1 && dialogs[0].contains(scope));
}

/** 仅查找栏和本作用域的数据格接收导航键，保留单元格编辑器及其他控件的输入。 */
export function gridFindDirection(event: KeyboardEvent, scope: HTMLElement, panel: HTMLElement | null, allowOwnDialog = false): -1 | 1 | undefined {
  const target = event.target;
  if (event.key !== 'F3' || event.defaultPrevented || event.isComposing || event.keyCode === 229 ||
      event.ctrlKey || event.metaKey || event.altKey || !(target instanceof Element) ||
      !scope.contains(target) || gridFindModalBlocked(scope, allowOwnDialog)) return;
  if (!panel?.contains(target) && ((!target.matches('[role="grid"],[role="treegrid"]') &&
      !target.closest('[role="gridcell"],[role="columnheader"]')) ||
      target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]'))) return;
  return event.shiftKey ? -1 : 1;
}

/** 查找栏和网格是同一表页下的兄弟节点，只在打开的面板所属表页监听。 */
export function useTableFindKeys(panel: RefObject<HTMLElement | null>, navigate: (direction: -1 | 1, focusGrid: boolean) => void, enabled = true) {
  useLayoutEffect(() => {
    const element = panel.current, scope = element?.closest?.<HTMLElement>('[data-table-find-scope]');
    if (!enabled || !element || !scope) return;
    const keyDown = (event: KeyboardEvent) => {
      const direction = gridFindDirection(event, scope, element);
      if (!direction) return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) navigate(direction, !element.contains(event.target as Node));
    };
    scope.addEventListener('keydown', keyDown);
    return () => scope.removeEventListener('keydown', keyDown);
  }, [panel, navigate, enabled]);
}
