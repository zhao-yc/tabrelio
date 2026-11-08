import { gridRowSelectionZh as text } from '../locales/gridRowSelection.zh-CN';

interface Props<Row, Key> {
  rows: readonly Row[];
  selected: ReadonlySet<Key>;
  disabled?: boolean;
  keyFor(row: Row, index: number): Key | undefined;
  isCurrent(): boolean;
  onChange(next: ReadonlySet<Key>): void;
}

/** 使用当前页完整行数组，虚拟滚动和活动数据格均不参与勾选计算。 */
export function GridRowSelectionActions<Row, Key>({ rows, selected, disabled, keyFor, isCurrent, onChange }: Props<Row, Key>) {
  function change(invert: boolean) {
    if (disabled || !isCurrent()) return;
    const next = new Set<Key>();
    if (invert) {
      for (const [index, row] of rows.entries()) {
        const key = keyFor(row, index);
        if (key !== undefined && !selected.has(key)) next.add(key);
      }
    }
    onChange(next);
  }

  return <>
    <button type="button" title={text.invertHint} disabled={disabled || !rows.length} onClick={() => change(true)}>{text.invert}</button>
    <button type="button" disabled={disabled || !selected.size} onClick={() => change(false)}>{text.clear}</button>
  </>;
}
