import { useEffect, useRef, useState } from 'react';
import type { DataGridHandle } from 'react-data-grid';
import { gridColumnJumpZh as text } from '../locales/gridColumnJump.zh-CN';
import '../gridRowJump.css';

/** 保留当前行；没有有效行时只横向滚动并聚焦表头。索引由调用方排除辅助列后映射。 */
export function focusGridColumn(handle: DataGridHandle | null, idx: number, rowIdx: number): boolean {
  if (!handle?.element?.isConnected || idx < 0) return false;
  handle.scrollToCell(rowIdx < 0 ? { idx } : { idx, rowIdx });
  handle.setActivePosition({ idx, rowIdx }, { enableEditor: false, shouldFocus: true });
  // 虚拟网格对同一活动坐标不会再次请求焦点，显式定位时补上已渲染的准确格。
  handle.element.querySelector<HTMLElement>(`[role="row"][aria-rowindex="${rowIdx + 2}"] > [aria-colindex="${idx + 1}"][tabindex="0"]`)
    ?.focus({ preventScroll: true });
  return true;
}

/** 只筛当前可见列；选择用真实位置区分重复别名，来源变化时丢弃草稿。 */
export function GridColumnJump({ scope, columns, disabled, isCurrent, onJump }: {
  scope: object | number | string; columns: readonly { name: string }[]; disabled?: boolean;
  isCurrent(): boolean; onJump(index: number): boolean;
}) {
  const [draft, setDraft] = useState<{ scope: typeof scope; search: string; chosen?: number }>();
  const button = useRef<HTMLButtonElement>(null), input = useRef<HTMLInputElement>(null), restore = useRef(false);
  const composing = useRef(false);
  const available = !disabled && columns.length > 0;
  const opened = available && draft?.scope === scope;
  const search = opened ? draft.search.toLowerCase() : '';
  const byNumber = /^#[1-9]\d*$/.test(search);
  const matches = opened ? columns.flatMap((column, index) =>
    (byNumber ? '#' + (index + 1) === search : column.name.toLowerCase().includes(search)) ? [{ column, index }] : []) : [];
  const chosen = matches.length === 1 ? matches[0].index :
    matches.some(match => match.index === draft?.chosen) ? draft?.chosen : undefined;
  useEffect(() => {
    if (opened) input.current?.focus();
    else {
      composing.current = false;
      if (restore.current) { restore.current = false; button.current?.focus(); }
    }
  }, [opened]);
  useEffect(() => { if (draft && !opened) setDraft(undefined); }, [draft, opened]);
  function close() { restore.current = true; setDraft(undefined); }
  return opened ? <form className="grid-row-jump grid-column-jump" aria-label={text.open} onSubmit={event => {
    event.preventDefault();
    if (!composing.current && chosen !== undefined && isCurrent() && onJump(chosen)) setDraft(undefined);
  }} onKeyDown={event => {
    if (event.key !== 'Enter' && event.key !== 'Escape') return;
    event.stopPropagation();
    if (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
      if (event.key === 'Enter') event.preventDefault();
      return;
    }
    if (event.key === 'Escape' && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) close();
  }}>
    <input ref={input} aria-label={text.search} placeholder={text.placeholder} maxLength={1024} value={draft.search}
      onChange={event => setDraft({ scope, search: event.target.value })}
      onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={() => { composing.current = false; }} />
    <select aria-label={text.matches} disabled={!matches.length} value={chosen ?? ''}
      onChange={event => setDraft({ ...draft, chosen: event.target.value ? Number(event.target.value) : undefined })}>
      <option value="">{matches.length ? text.choose : text.none}</option>
      {matches.map(({ column, index }) => <option key={index} value={index}>{text.option(index + 1, column.name || text.unnamed)}</option>)}
    </select>
    <button type="submit" disabled={chosen === undefined}>{text.go}</button>
    <button type="button" aria-label={text.close} onClick={close}>×</button>
  </form> : <button type="button" ref={button} disabled={!available}
    onClick={() => { if (isCurrent()) setDraft({ scope, search: '' }); }}>{text.open}</button>;
}
