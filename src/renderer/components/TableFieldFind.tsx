import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { gridFindModalBlocked, useTableFindKeys } from '../gridFindKeys';
import { queryResultFindZh as text } from '../locales/queryResultFind.zh-CN';
import { tableCellKeyIsComposing } from '../tableCellKeyboard';
import type { ResultColumn } from '../../shared/contracts';
import { Field } from './ui';

export interface TableFieldFindDisplay {
  current?: { row: -1; key: string; focus: boolean };
  marks?: ReadonlySet<string>;
}

interface Props {
  columns: readonly Pick<ResultColumn, 'key' | 'name'>[];
  kind: ReactNode;
  disabled: boolean;
  focusRequest: object;
  initialQuery: string;
  initialSensitive: boolean;
  initialHighlight: boolean;
  initialIncremental: boolean;
  isCurrent?(): boolean;
  onDisplay?(display: TableFieldFindDisplay | undefined): void;
  onClose?(): void;
}

export function tableFieldFindClass(display: TableFieldFindDisplay | undefined, key: string): string | undefined {
  return display?.current?.key === key ? 'query-result-find-hit' : display?.marks?.has(key) ? 'query-result-find-match' : undefined;
}

/** 字段查找只读取可见列的原名称。命中和手动搜索结果都绑定到当前列投影。 */
export function TableFieldFind({ columns, kind, disabled, focusRequest, initialQuery, initialSensitive, initialHighlight, initialIncremental, isCurrent, onDisplay, onClose }: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [sensitive, setSensitive] = useState(initialSensitive);
  const [highlight, setHighlight] = useState(initialHighlight);
  const [incremental, setIncremental] = useState(initialIncremental);
  const [manual, setManual] = useState<object>();
  const [selection, setSelection] = useState<{ matches: typeof matches; target: NonNullable<TableFieldFindDisplay['current']> }>();
  const [composing, setComposing] = useState(false);
  const composingRef = useRef(false);
  const panel = useRef<HTMLElement>(null), input = useRef<HTMLInputElement>(null);
  const source = useMemo(() => ({ columns, query, sensitive }), [columns, query, sensitive]);
  const ready = !disabled && !composing && (incremental || manual === source);
  const matches = useMemo(() => {
    const needle = sensitive ? query : query.toLowerCase();
    return ready && needle ? columns.filter(column => (sensitive ? column.name : column.name.toLowerCase()).includes(needle)) : [];
  }, [ready, source]);
  const current = selection?.matches === matches ? selection.target : undefined;
  const index = current ? matches.findIndex(column => column.key === current.key) : -1;
  const marks = useMemo(() => highlight && matches.length ? new Set(matches.map(column => column.key)) : undefined, [highlight, matches]);
  useLayoutEffect(() => {
    onDisplay?.(!disabled && (current || marks) && isCurrent?.() !== false ? { current, marks } : undefined);
  }, [onDisplay, disabled, current, marks]);
  useLayoutEffect(() => () => onDisplay?.(undefined), [onDisplay]);
  useLayoutEffect(() => { input.current?.focus(); }, [focusRequest]);

  function command(direction: -1 | 1, focus = false) {
    if (disabled || composingRef.current || !panel.current || gridFindModalBlocked(panel.current) || isCurrent?.() === false || !query) return;
    if (!ready) { setManual(source); return; }
    if (!matches.length) return;
    setSelection(previous => {
      const active = previous?.matches === matches ? matches.findIndex(column => column.key === previous.target.key) : -1;
      const next = active < 0 ? direction > 0 ? 0 : matches.length - 1 : (active + direction + matches.length) % matches.length;
      return { matches, target: { row: -1, key: matches[next].key, focus } };
    });
  }
  useTableFindKeys(panel, command);
  return <section ref={panel} className="page-find-panel" aria-label={text.modes.field}>
    <div className="page-find-fields">{kind}
      <Field label={text.modes.field}><input ref={input} value={query} disabled={disabled} maxLength={512}
        onChange={event => { setManual(undefined); setQuery(event.target.value); }}
        onCompositionStart={() => { composingRef.current = true; setComposing(true); setManual(undefined); }}
        onCompositionEnd={() => { composingRef.current = false; setComposing(false); }}
        onKeyDown={event => {
          if (event.key !== 'Enter' || event.ctrlKey || event.metaKey || event.altKey || composingRef.current || tableCellKeyIsComposing(event.nativeEvent)) return;
          event.preventDefault(); event.stopPropagation();
          if (!event.repeat) command(event.shiftKey ? -1 : 1);
        }}/></Field>
      <label><input type="checkbox" checked={sensitive} disabled={disabled} onChange={event => { setManual(undefined); setSensitive(event.target.checked); }}/>{text.sensitive}</label>
      <label><input type="checkbox" checked={highlight} disabled={disabled} onChange={event => setHighlight(event.target.checked)}/>{text.highlightAll}</label>
      <label><input type="checkbox" checked={incremental} disabled={disabled || composing} onChange={event => { setManual(undefined); setIncremental(event.target.checked); }}/>{text.incremental}</label>
    </div>
    <div className="page-find-actions">
      <span role="status">{composing ? text.composing : !query ? text.fieldEmpty : !ready ? text.awaitingSearch : matches.length ? text.fieldCount(matches.length, index) : text.fieldNone}</span>
      <button type="button" disabled={disabled || composing || !query} onClick={() => { setSelection(undefined); setManual(source); }}>{text.search}</button>
      <button type="button" disabled={!matches.length} onClick={() => command(-1)}>{text.previous}</button>
      <button type="button" disabled={!matches.length} onClick={() => command(1)}>{text.next}</button>
      {current && <span>{text.fieldLocation(columns.indexOf(matches[index]))} · {matches[index].name}</span>}
      <span className="grow"/>{onClose && <button type="button" onClick={onClose}>{text.closeFields}</button>}
    </div>
  </section>;
}
