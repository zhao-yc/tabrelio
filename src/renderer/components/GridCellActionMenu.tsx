import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { gridDialogCurrent } from '../modalSelectors';
import { gridQuickValueZh } from '../locales/gridQuickValue.zh-CN';
import { useWorkspace } from '../store';
import '../sidebarContextMenu.css';

export interface GridCellAction { label: string; disabled?: boolean; run(): void; }
interface Request { title: string; label?: string; targetRole?: 'columnheader'; actions: readonly GridCellAction[]; current(): boolean; focusTarget?(): HTMLElement | undefined; }
interface Owner extends Request { cell: HTMLElement; grid: HTMLElement; dialog?: Element; anchorLeft: number; anchorTop: number; scrollLeft: number; scrollTop: number; x: number; y: number; }

export function isGridContextKey(event: { key: string; shiftKey: boolean; repeat: boolean; keyCode: number; nativeEvent: { isComposing: boolean } }): boolean {
  const key = event.key.toLowerCase();
  return (key === 'contextmenu' || event.shiftKey && key === 'f10') && !event.repeat && !event.nativeEvent.isComposing && event.keyCode !== 229;
}

/** 菜单归属按物理格、工作区和调用方数据快照共同核对。动作失效时关闭，禁止迟到点击。 */
export function useGridCellActionMenu(ownDialog?: () => Element | undefined) {
  const [owner, setOwner] = useState<Owner>();
  const active = useRef<Owner | undefined>(undefined);

  function close(request = active.current, focus = false): void {
    if (!request || active.current !== request) return;
    active.current = undefined;
    setOwner(undefined);
    if (focus && request.current()) (request.focusTarget?.() ?? request.cell).focus({ preventScroll: true });
  }

  useLayoutEffect(() => { if (owner && !owner.current()) close(owner); });
  useLayoutEffect(() => {
    if (!owner) return;
    const stop = useWorkspace.subscribe(() => { if (!owner.current()) close(owner); });
    return stop;
  }, [owner]);
  useLayoutEffect(() => () => { active.current = undefined; }, []);

  function open(target: EventTarget | null, grid: HTMLElement | null | undefined, request: Request, point?: { x: number; y: number }): boolean {
    if (!grid || !(target instanceof Element) || !request.actions.length ||
        target.closest('input,textarea,select,button,[contenteditable="true"]')) return false;
    const cell = target.closest<HTMLElement>(request.targetRole ? '[role="columnheader"]' : '[role="gridcell"]'), row = cell?.closest('[role="row"]');
    if (!cell || !row || cell.closest('[role="grid"]') !== grid) return false;
    const rowIndex = row.getAttribute('aria-rowindex'), columnIndex = cell.getAttribute('aria-colindex');
    const dialog = ownDialog?.();
    if (ownDialog && !dialog) return false;
    const state = useWorkspace.getState(), tab = state.settings.tabs.find(item => item.id === state.settings.activeTabId);
    if (!dialog && !tab) return false;
    const version = tab && state.connectionVersions[tab.connectionId];
    const current = () => {
      try {
        if (dialog) {
          if (ownDialog?.() !== dialog) return false;
        } else {
          const now = useWorkspace.getState();
          if (!tab || now.settings.activeTabId !== tab.id || now.settings.tabs.find(item => item.id === tab.id) !== tab ||
              now.connectionVersions[tab.connectionId] !== version || now.activeJobs[tab.id]) return false;
        }
        return cell.isConnected && cell.closest('[role="grid"]') === grid && cell.closest('[role="row"]') === row &&
          row.getAttribute('aria-rowindex') === rowIndex && cell.getAttribute('aria-colindex') === columnIndex &&
          gridDialogCurrent(cell, ownDialog) && request.current();
      } catch { return false; }
    };
    if (!current()) return false;
    const rect = cell.getBoundingClientRect();
    const next = { ...request, ...(point ?? { x: rect.left, y: rect.bottom }), cell, grid, dialog,
      anchorLeft: rect.left, anchorTop: rect.top, scrollLeft: grid.scrollLeft, scrollTop: grid.scrollTop, current };
    active.current = next;
    setOwner(next);
    return true;
  }

  const menu = owner && <GridCellMenu owner={owner}
    close={focus => close(owner, focus)} choose={action => {
      if (active.current !== owner || !owner.current() || action.disabled) { close(owner); return; }
      close(owner, true);
      if (owner.current()) action.run();
    }}/>;
  return { open, menu };
}

function GridCellMenu({ owner, close, choose }: { owner: Owner; close(focus: boolean): void; choose(action: GridCellAction): void; }) {
  const menu = useRef<HTMLDivElement>(null), closeRef = useRef(close);
  closeRef.current = close;
  useLayoutEffect(() => {
    const element = menu.current!, rect = element.getBoundingClientRect();
    element.style.left = `${Math.max(8, Math.min(owner.x, window.innerWidth - rect.width - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(owner.y, window.innerHeight - rect.height - 8))}px`;
    (element.querySelector<HTMLElement>('button:not(:disabled)') ?? element).focus({ preventScroll: true });
    const outside = (event: Event) => { if (!(event.target instanceof Node) || !element.contains(event.target)) closeRef.current(false); };
    // 聚焦行标题可能先滚动外层查询页，后派发事件。只在菜单打开后网格或锚点实际移动时关闭。
    const scroll = (event: Event) => {
      const rect = owner.cell.getBoundingClientRect();
      if (rect.left === owner.anchorLeft && rect.top === owner.anchorTop &&
          owner.grid.scrollLeft === owner.scrollLeft && owner.grid.scrollTop === owner.scrollTop) return;
      outside(event);
    };
    const dismiss = () => closeRef.current(false);
    const observer = new MutationObserver(() => { if (!owner.current()) dismiss(); });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['role', 'aria-rowindex', 'aria-colindex'] });
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('scroll', scroll, true);
    window.addEventListener('blur', dismiss);
    window.addEventListener('resize', dismiss);
    return () => {
      observer.disconnect();
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('scroll', scroll, true);
      window.removeEventListener('blur', dismiss);
      window.removeEventListener('resize', dismiss);
    };
  }, [owner]);
  return createPortal(<div ref={menu} role="menu" data-grid-cell-menu aria-label={owner.label ?? gridQuickValueZh.context} tabIndex={-1} className="sidebar-context-menu"
    style={{ left: owner.x, top: owner.y }} onContextMenu={event => event.preventDefault()} onKeyDown={event => {
      if (event.key === 'Escape' || event.key === 'Tab') {
        event.preventDefault(); event.stopPropagation(); close(true);
      } else if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        const selected = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 :
          event.key === 'ArrowUp' ? (selected <= 0 ? buttons.length - 1 : selected - 1) : (selected + 1) % buttons.length;
        buttons[index]?.focus();
      }
    }}>
    <div className="sidebar-context-menu-title" title={owner.title}>{owner.title}</div>
    {owner.actions.map(action => <button type="button" role="menuitem" key={action.label} disabled={action.disabled}
      onClick={() => choose(action)}>{action.label}</button>)}
  </div>, owner.dialog ?? document.body);
}
