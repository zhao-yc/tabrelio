import { useLayoutEffect, useMemo, useRef } from 'react';
import { SelectCellFormatter, SelectColumn, useRowSelection, type CellMouseEvent, type Column } from 'react-data-grid';

interface Selection<Row, Key> {
  keyFor(row: Row, index: number): Key | undefined;
  selected(): ReadonlySet<Key>;
  isCurrent(): boolean;
  onChange(next: ReadonlySet<Key>): void;
}

function RowCheckbox({ tabIndex, onChange }: { tabIndex: number; onChange(checked: boolean, shift: boolean): void }) {
  const { isRowSelected, isRowSelectionDisabled } = useRowSelection();
  return <SelectCellFormatter aria-label="Select" tabIndex={tabIndex} value={isRowSelected}
    disabled={isRowSelectionDisabled} onChange={onChange}/>;
}

/** 复选框与修饰键点击共用实际行和勾选来源。翻页、重新排序及其它勾选动作撤销旧范围起点。 */
export function useGridCheckedRange<Row, Key>(rows: readonly Row[], scope: unknown, selection: Selection<Row, Key>) {
  const owner = useMemo(() => ({}), [rows, scope]);
  const current = useRef<(Selection<Row, Key> & { owner: object }) | undefined>(undefined);
  const anchor = useRef<{ row: Row; index: number; selected: ReadonlySet<Key> } | undefined>(undefined);
  useLayoutEffect(() => {
    if (current.current?.owner !== owner) anchor.current = undefined;
    current.current = { ...selection, owner };
  });
  useLayoutEffect(() => () => { current.current = undefined; }, []);

  function change(row: Row, index: number, checked?: boolean, shift = false) {
    const source = current.current;
    if (source?.owner !== owner || rows[index] !== row || !source.isCurrent()) return;
    const key = source.keyFor(row, index);
    if (key === undefined) return;
    const selected = source.selected(), previous = anchor.current;
    const start = shift && previous?.selected === selected && rows[previous.index] === previous.row &&
      source.keyFor(previous.row, previous.index) !== undefined ? previous.index : index;
    const add = checked ?? !selected.has(key), next = new Set(selected);
    for (let i = Math.min(index, start); i <= Math.max(index, start); i++) {
      const candidate = source.keyFor(rows[i], i);
      if (candidate === undefined) continue;
      if (add) next.add(candidate);
      else next.delete(candidate);
    }
    if (next.size !== selected.size) {
      source.onChange(next);
      // 父工作区拒绝本次勾选时不签发新起点。
      if (source.selected() === selected) return;
    }
    anchor.current = { row: rows[start], index: start, selected: source.selected() };
  }

  const column = useMemo<Column<Row>>(() => ({ ...SelectColumn,
    renderCell: ({ row, rowIdx, tabIndex }) => <RowCheckbox tabIndex={tabIndex}
      onChange={(checked, shift) => change(row, rowIdx, checked, shift)}/>,
  }), [owner]);

  function toggle(row: Row, index: number, event?: CellMouseEvent) {
    if (event?.button !== 0 || event.defaultPrevented || event.ctrlKey === event.metaKey || event.altKey || event.shiftKey) return;
    const target = event.target as Element | null;
    if (target?.closest?.('input,textarea,select,button,a,[contenteditable="true"],[role="textbox"]')) return;
    change(row, index);
  }

  return { column, toggle };
}
