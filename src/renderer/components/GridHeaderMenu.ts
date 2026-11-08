import { useRef, type KeyboardEvent, type MouseEvent } from 'react';
import type { SortColumn } from 'react-data-grid';
import { gridHeaderMenuZh as text } from '../locales/gridHeaderMenu.zh-CN';
import { isGridContextKey, type GridCellAction, type useGridCellActionMenu } from './GridCellActionMenu';

export interface GridHeaderFreeze {
  current(): boolean;
  apply(key?: string): void;
}

interface HeaderMenuSource {
  owner: object | null | undefined;
  grid(): HTMLElement | null | undefined;
  column(index: number): { key: string; name: string } | undefined;
  sort: readonly SortColumn[];
  current(): boolean;
  canSort(key: string): boolean;
  applySort(next: readonly SortColumn[], current: () => boolean): void;
  freeze?: GridHeaderFreeze;
  frozenThrough?: string;
}

/** 修改命中列，保留其他列及其顺序。新增列放在最后，底层仍负责验证排序规则。 */
function changeHeaderSort(sort: readonly SortColumn[], key: string, direction?: SortColumn['direction']): SortColumn[] {
  if (direction === undefined) return sort.filter(rule => rule.columnKey !== key);
  const rule = { columnKey: key, direction };
  return sort.some(item => item.columnKey === key) ? sort.map(item => item.columnKey === key ? rule : item) : [...sort, rule];
}

/** 与单元格共用一个菜单，按原网格、列键和排序快照拒绝迟到的动作。 */
export function useGridHeaderMenu(openMenu: ReturnType<typeof useGridCellActionMenu>['open'], source: HeaderMenuSource) {
  const latest = useRef(source);
  latest.current = source;

  function open(target: EventTarget | null, point?: { x: number; y: number }): boolean {
    if (!(target instanceof Element)) return false;
    const grid = source.grid(), header = target.closest('[role="columnheader"]');
    if (!grid || !header || header.closest('[role="grid"]') !== grid) return false;
    const index = Number(header.getAttribute('aria-colindex')) - 1;
    const column = Number.isSafeInteger(index) && index >= 0 ? source.column(index) : undefined;
    if (!column || !source.owner || !source.current()) return false;
    const current = () => {
      const now = latest.current;
      return now.owner === source.owner && now.grid() === grid && now.column(index)?.key === column.key && now.current();
    };
    const actions: GridCellAction[] = [];
    if (source.canSort(column.key)) {
      const initial = source.sort.find(rule => rule.columnKey === column.key)?.direction;
      const sortCurrent = () => {
        const now = latest.current;
        return current() && now.canSort(column.key) && now.sort.length === source.sort.length &&
          now.sort.every((rule, i) => rule.columnKey === source.sort[i].columnKey && rule.direction === source.sort[i].direction);
      };
      const apply = (direction?: SortColumn['direction']) => {
        if (sortCurrent()) latest.current.applySort(changeHeaderSort(source.sort, column.key, direction), sortCurrent);
      };
      actions.push({ label: text.asc, disabled: initial === 'ASC', run: () => apply('ASC') },
        { label: text.desc, disabled: initial === 'DESC', run: () => apply('DESC') },
        { label: text.clear, disabled: initial === undefined, run: () => apply() });
    }
    if (source.freeze?.current()) {
      const apply = (key?: string) => {
        const now = latest.current;
        if (current() && now.frozenThrough === source.frozenThrough && now.freeze?.current()) now.freeze.apply(key);
      };
      actions.push({ label: text.freeze, disabled: source.frozenThrough === column.key, run: () => apply(column.key) },
        { label: text.unfreeze, disabled: source.frozenThrough === undefined, run: () => apply() });
    }
    return openMenu(target, grid, { title: column.name, label: text.menu, targetRole: 'columnheader', current, actions }, point);
  }

  return {
    onContextMenuCapture(event: MouseEvent) {
      if (event.defaultPrevented || !open(event.target, { x: event.clientX, y: event.clientY })) return;
      event.preventDefault();
      event.stopPropagation();
    },
    onKeyDownCapture(event: KeyboardEvent) {
      if (event.defaultPrevented || !isGridContextKey(event) || !open(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}
