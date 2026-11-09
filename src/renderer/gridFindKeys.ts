import { useLayoutEffect, type RefObject } from 'react';
import { appModalSelector } from './modalSelectors';

/** 仅查找栏和本作用域的数据格接收导航键，保留单元格编辑器及其他控件的输入。 */
export function gridFindDirection(event: KeyboardEvent, scope: HTMLElement, panel: HTMLElement | null): -1 | 1 | undefined {
  const target = event.target;
  if (event.key !== 'F3' || event.defaultPrevented || event.isComposing || event.keyCode === 229 ||
      event.ctrlKey || event.metaKey || event.altKey || !(target instanceof Element) ||
      !scope.contains(target) || scope.ownerDocument.querySelector(appModalSelector)) return;
  if (!panel?.contains(target) && ((!target.matches('[role="grid"],[role="treegrid"]') &&
      !target.closest('[role="gridcell"],[role="columnheader"]')) ||
      target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]'))) return;
  return event.shiftKey ? -1 : 1;
}

/** 查找栏和网格是同一表页下的兄弟节点，只在打开的面板所属表页监听。 */
export function useTableFindKeys(panel: RefObject<HTMLElement | null>, navigate: (direction: -1 | 1, focusGrid: boolean) => void) {
  useLayoutEffect(() => {
    const element = panel.current, scope = element?.closest?.<HTMLElement>('[data-table-find-scope]');
    if (!element || !scope) return;
    const keyDown = (event: KeyboardEvent) => {
      const direction = gridFindDirection(event, scope, element);
      if (!direction) return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) navigate(direction, !element.contains(event.target as Node));
    };
    scope.addEventListener('keydown', keyDown);
    return () => scope.removeEventListener('keydown', keyDown);
  }, [panel, navigate]);
}
