import { useMemo, useRef, useState } from 'react';
import type { CellKeyDownArgs, CellKeyboardEvent, CellMouseArgs, CellMouseEvent } from 'react-data-grid';
import { appModalSelector } from './modalSelectors';
import { maxClipboardCells } from './gridClipboard';
import { zh } from './locales/zh-CN';

interface Point { row: number; column: number; }
interface Rectangle { top: number; bottom: number; left: number; right: number; }

function samePoint(left: Point | undefined, right: Point | undefined): boolean {
  return left?.row === right?.row && left?.column === right?.column;
}

function bounds(anchor: Point, focus: Point): Rectangle {
  return { top: Math.min(anchor.row, focus.row), bottom: Math.max(anchor.row, focus.row),
    left: Math.min(anchor.column, focus.column), right: Math.max(anchor.column, focus.column) };
}

/** 在读取原值前检查格数预算；以当前可见顺序输出，待删除行由调用方排除。 */
export function readGridCellRange<Row, Key, Value>(rectangle: Rectangle, rows: readonly Row[], keys: readonly Key[],
  read: (row: Row, key: Key) => Value, skip?: (row: Row) => boolean) {
  const columns = keys.slice(rectangle.left, rectangle.right + 1);
  const selected = rows.slice(rectangle.top, rectangle.bottom + 1).filter(row => !skip?.(row));
  if (selected.length * columns.length > maxClipboardCells) throw Error(zh.clipboard.copyLimit);
  return { columns, values: selected.map(row => columns.map(key => read(row, key))) };
}

/** 矩形只绑定当前行数组、可见字段和网格来源。虚拟化只决定绘制，不决定范围。 */
export function useGridCellRange<Row>(rows: readonly Row[], keys: readonly string[], source: unknown, columnOffset: number) {
  const scope = useMemo(() => ({}), [rows, keys, source, columnOffset]);
  const live = useRef<{ scope: object; active?: Point; anchor?: Point; focus?: Point }>({ scope });
  if (live.current.scope !== scope) live.current = { scope };
  const [shown, setShown] = useState<{ scope: object; rectangle: Rectangle }>();
  const rectangle = shown?.scope === scope ? shown.rectangle : undefined;

  function position(row: Row | undefined, rowIndex: number, key: string | undefined): Point | undefined {
    const column = key === undefined ? -1 : keys.indexOf(key);
    if (row === undefined || rows[rowIndex] !== row || column < 0) return;
    return { row: rowIndex, column };
  }

  function clear() {
    if (live.current.scope !== scope || !live.current.anchor) return;
    live.current = { scope, active: live.current.active };
    setShown(undefined);
  }

  function move(row: Row | undefined, rowIndex: number, key: string | undefined) {
    if (live.current.scope !== scope) return;
    const active = position(row, rowIndex, key);
    if (!samePoint(live.current.focus, active)) clear();
    live.current.active = active;
  }

  function select(anchor: Point, focus: Point) {
    live.current = { scope, active: focus, anchor, focus };
    setShown({ scope, rectangle: bounds(anchor, focus) });
  }

  function allowed(event: CellKeyboardEvent | CellMouseEvent): boolean {
    const target = event.target;
    return live.current.scope === scope && !event.defaultPrevented && !event.isGridDefaultPrevented() &&
      target instanceof HTMLElement && !target.isContentEditable && !!target.closest('[role="gridcell"]') &&
      !target.closest('input,textarea,select,button,[role="textbox"]') && !target.ownerDocument.querySelector(appModalSelector);
  }

  function mouse(args: CellMouseArgs<Row>, event: CellMouseEvent, current: () => boolean) {
    if (live.current.scope !== scope || !current() || event.button !== 0) return;
    const active = position(args.row, args.rowIdx, args.column.key), anchor = live.current.anchor ?? live.current.active;
    if (event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && active && anchor && allowed(event)) {
      event.preventDefault();
      select(anchor, active);
      event.currentTarget.focus({ preventScroll: true });
    } else {
      clear();
      live.current.active = active;
    }
  }

  function key(args: Extract<CellKeyDownArgs<Row>, { mode: 'ACTIVE' }>, event: CellKeyboardEvent, current: () => boolean): boolean {
    const direction = arrowDirections.get(event.key);
    const cancel = event.key === 'Escape' && !!live.current.anchor;
    if ((!event.shiftKey || !direction) && !cancel || event.altKey || event.ctrlKey || event.metaKey ||
        event.nativeEvent.isComposing || event.keyCode === 229 || !allowed(event) || !current()) return false;
    const active = position(args.row, args.rowIdx, args.column?.key);
    if (!active) return false;
    event.preventDefault(); event.preventGridDefault(); event.stopPropagation();
    if (cancel) clear();
    else if (direction) {
      const next = { row: Math.max(0, Math.min(rows.length - 1, active.row + direction.row)),
        column: Math.max(0, Math.min(keys.length - 1, active.column + direction.column)) };
      if (!samePoint(active, next)) {
        select(live.current.anchor ?? active, next);
        args.setActivePosition({ rowIdx: next.row, idx: next.column + columnOffset }, { shouldFocus: true });
      }
    }
    return true;
  }

  /** 只允许在本矩形端点复制；活动格已变化时交还原勾选或单格复制。 */
  function copy<Value>(row: Row, column: string, read: (row: Row, key: string) => Value, skip?: (row: Row) => boolean) {
    const { scope: owned, anchor, focus } = live.current;
    if (owned !== scope || !anchor || !focus || rows[focus.row] !== row || keys[focus.column] !== column) return;
    return readGridCellRange(bounds(anchor, focus), rows, keys, read, skip);
  }

  return { rectangle, mouse, key, move, copy };
}

const arrowDirections = new Map<string, Point>([
  ['ArrowUp', { row: -1, column: 0 }], ['ArrowDown', { row: 1, column: 0 }],
  ['ArrowLeft', { row: 0, column: -1 }], ['ArrowRight', { row: 0, column: 1 }],
]);

export function gridCellRangeClass(rectangle: Rectangle | undefined, row: number | undefined, column: number): string | undefined {
  if (rectangle && row !== undefined && row >= rectangle.top && row <= rectangle.bottom && column >= rectangle.left && column <= rectangle.right)
    return 'grid-cell-in-range';
}
