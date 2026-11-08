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

  function captureColumn(target: EventTarget | null, selector: string) {
    if (!(target instanceof Element)) return;
    const grid = source.grid(), cell = target.closest(selector);
    if (!grid || !cell || cell.closest('[role="grid"]') !== grid) return;
    const index = Number(cell.getAttribute('aria-colindex')) - 1;
    const column = Number.isSafeInteger(index) && index >= 0 ? source.column(index) : undefined;
    if (!column || !source.owner || !source.current()) return;
    const current = () => {
      const now = latest.current;
      return now.owner === source.owner && now.grid() === grid && now.column(index)?.key === column.key && now.current();
    };
    return { grid, column, current };
  }

  /** 菜单和快捷键共用排序快照，读取或确认草稿期间仍核对原列和规则。 */
  function captureSort(key: string, current: () => boolean) {
    if (!source.canSort(key)) return;
    const initial = source.sort.find(rule => rule.columnKey === key)?.direction;
    const sortCurrent = () => {
      const now = latest.current;
      return current() && now.canSort(key) && now.sort.length === source.sort.length &&
        now.sort.every((rule, i) => rule.columnKey === source.sort[i].columnKey && rule.direction === source.sort[i].direction);
    };
    return { initial, apply(direction?: SortColumn['direction']) {
      if (direction !== initial && sortCurrent()) latest.current.applySort(changeHeaderSort(source.sort, key, direction), sortCurrent);
    } };
  }

  function open(target: EventTarget | null, point?: { x: number; y: number }): boolean {
    const captured = captureColumn(target, '[role="columnheader"]');
    if (!captured) return false;
    const { grid, column, current } = captured;
    const actions: GridCellAction[] = [];
    const sort = captureSort(column.key, current);
    if (sort) {
      actions.push({ label: text.asc, disabled: sort.initial === 'ASC', run: () => sort.apply('ASC') },
        { label: text.desc, disabled: sort.initial === 'DESC', run: () => sort.apply('DESC') },
        { label: text.clear, disabled: sort.initial === undefined, run: () => sort.apply() });
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

  /** 只接管 macOS 网格的 Command+上下方向键，输入控件继续处理自己的按键。 */
  function sortFromKeyboard(event: KeyboardEvent): boolean {
    if ((event.key !== 'ArrowUp' && event.key !== 'ArrowDown') || !event.metaKey || event.ctrlKey || event.altKey ||
        event.shiftKey || event.repeat || event.nativeEvent.isComposing || event.keyCode === 229 ||
        !navigator.platform.startsWith('Mac')) return false;
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.isContentEditable ||
        target.closest('input, textarea, select, button, [role="textbox"]')) return false;
    const captured = captureColumn(target, '[role="columnheader"], [role="gridcell"]');
    const sort = captured && captureSort(captured.column.key, captured.current);
    if (!sort) return false;
    sort.apply(event.key === 'ArrowUp' ? 'ASC' : 'DESC');
    return true;
  }

  return {
    onContextMenuCapture(event: MouseEvent) {
      if (event.defaultPrevented || !open(event.target, { x: event.clientX, y: event.clientY })) return;
      event.preventDefault();
      event.stopPropagation();
    },
    onKeyDownCapture(event: KeyboardEvent) {
      if (event.defaultPrevented || !(isGridContextKey(event) ? open(event.target) : sortFromKeyboard(event))) return;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}
