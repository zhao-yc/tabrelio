import { gridRowSelectionZh as text } from '../locales/gridRowSelection.zh-CN';
import { queryResultFindZh as findText } from '../locales/queryResultFind.zh-CN';
import type { CellKeyboardEvent } from 'react-data-grid';

interface Props<Row, Key> {
  rows: readonly Row[];
  selected: ReadonlySet<Key>;
  disabled?: boolean;
  keyFor(row: Row, index: number): Key | undefined;
  isCurrent(): boolean;
  onChange(next: ReadonlySet<Key>): void;
}

/** 直接遍历完整页，包含虚拟滚动尚未渲染的行。 */
export function gridRowKeys<Row, Key>(rows: readonly Row[], keyFor: Props<Row, Key>['keyFor'], exclude?: ReadonlySet<Key>): Set<Key> {
  const keys = new Set<Key>();
  for (const [index, row] of rows.entries()) {
    const key = keyFor(row, index);
    if (key !== undefined && !exclude?.has(key)) keys.add(key);
  }
  return keys;
}

/** 只消费活动数据格的显式全选键，保留编辑器、组合输入及系统普通全选。 */
export function handleGridSelectAllKey(event: CellKeyboardEvent, isCurrent: () => boolean, select: () => void): boolean {
  if (!event.shiftKey || event.ctrlKey === event.metaKey || event.altKey || event.key !== ' ' ||
      event.defaultPrevented || event.isGridDefaultPrevented() || event.nativeEvent.isComposing || event.keyCode === 229) return false;
  const target = event.target;
  if (!(target instanceof HTMLElement) || target.isContentEditable || target.getAttribute('role') !== 'gridcell' ||
      target.closest('input,textarea,select,[role="textbox"]') || !isCurrent()) return false;
  event.preventGridDefault();
  event.preventDefault();
  event.stopPropagation();
  if (!event.repeat) select();
  return true;
}

/** 使用当前页完整行数组，虚拟滚动和活动数据格均不参与勾选计算。 */
export function GridRowSelectionActions<Row, Key>({ rows, selected, disabled, keyFor, isCurrent, onChange }: Props<Row, Key>) {
  function change(mode: 'all' | 'invert' | 'clear') {
    if (disabled || !isCurrent()) return;
    onChange(mode === 'clear' ? new Set<Key>() : gridRowKeys(rows, keyFor, mode === 'invert' ? selected : undefined));
  }

  return <>
    <button type="button" title={text.allHint} aria-keyshortcuts="Control+Shift+Space Meta+Shift+Space" disabled={disabled || !rows.length} onClick={() => change('all')}>{text.all}</button>
    <button type="button" title={text.invertHint} disabled={disabled || !rows.length} onClick={() => change('invert')}>{text.invert}</button>
    <button type="button" disabled={disabled || !selected.size} onClick={() => change('clear')}>{text.clear}</button>
  </>;
}

export type GridMatchRowsAction<Key> = (matches: ReadonlySet<Key>, checked: boolean) => void;

/** 同一命中行只调整一次，保留原有的其它勾选。无变化时不推进选择代次。 */
export function mergeGridMatchSelection<Key>(selected: ReadonlySet<Key>, matches: Iterable<Key>, checked: boolean): Set<Key> | undefined {
  const next = new Set(selected);
  for (const key of matches) {
    if (checked) next.add(key);
    else next.delete(key);
  }
  return next.size !== selected.size ? next : undefined;
}

export function GridFindMatchActions({ disabled, onChange }: { disabled: boolean; onChange(checked: boolean): void }) {
  return <>
    <button type="button" title={findText.checkRowsHint} disabled={disabled} onClick={() => onChange(true)}>{findText.checkRows}</button>
    <button type="button" title={findText.checkRowsHint} disabled={disabled} onClick={() => onChange(false)}>{findText.uncheckRows}</button>
  </>;
}
