import { useEffect, useId, useState } from 'react';
import { recordNavigatorZh as text } from '../locales/recordNavigator.zh-CN';
import { tableCellKeyIsComposing } from '../tableCellKeyboard';
import '../recordNavigator.css';

type SummaryColumn = { key: string; name: string };
const groupSize = 25;
const searchBatchSize = 512;
interface SearchResult { source: object; fields: string; needle: string; indices: number[]; }

export function useRecordNavigator() {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<readonly string[]>();
  const [search, setSearch] = useState('');
  const [matches, setMatches] = useState<SearchResult>();
  return { id, open, setOpen, fields, setFields, search, setSearch, matches, setMatches };
}

type NavigatorState = ReturnType<typeof useRecordNavigator>;

export function RecordNavigatorToggle({ state, title = text.title }: { state: NavigatorState; title?: string }) {
  return <button type="button" aria-controls={state.id} aria-expanded={state.open}
    onClick={() => state.setOpen(!state.open)}>{title}</button>;
}

/** 直接定位已加载记录，选中动作仍交给原表单的来源与暂存守卫。 */
export function RecordBoundaryButton({ label, index, active, disabled, onSelect }: {
  label: string;
  index: number;
  active: number;
  disabled?: boolean;
  onSelect(index: number): void;
}) {
  const unavailable = disabled || index < 0 || index === active;
  return <button type="button" disabled={unavailable} onClick={() => { if (!unavailable) onSelect(index); }}>{label}</button>;
}

interface Props {
  state: NavigatorState;
  source: object;
  title?: string;
  columns: readonly SummaryColumn[];
  count: number;
  active: number;
  value(index: number, key: string): string;
  canSelect?(index: number): boolean;
  disabled?: boolean;
  stage?: boolean;
  showToggle?: boolean;
  onSelect(index: number): void;
}

/** 列表只展开已加载页的一个小分组，记录身份和切换授权由原表单复核。 */
export function RecordNavigator({ state, source, title = text.title, columns, count, active, value, canSelect, disabled, stage, showToggle = true, onSelect }: Props) {
  const [group, setGroup] = useState<{ source: object; needle: string; active: number; index: number }>();
  const byKey = new Map(columns.map(column => [column.key, column]));
  const available = state.fields?.filter(key => byKey.has(key));
  const keys = available?.length ? available : columns.slice(0, 2).map(column => column.key);
  const needle = state.search.trim().toLowerCase(), fields = JSON.stringify(keys);
  const matches = state.matches?.source === source && state.matches.needle === needle && state.matches.fields === fields ? state.matches.indices : undefined;

  // 大查询结果分片检查摘要，换源、修改筛选或收起后取消原轮次。
  useEffect(() => {
    if (!state.open || !needle || matches) return;
    let start = 0;
    const indices: number[] = [];
    const scan = () => {
      const end = Math.min(start + searchBatchSize, count);
      for (; start < end; start++) {
        if (canSelect?.(start) !== false && keys.some(key => (value(start, key) || text.empty).toLowerCase().includes(needle))) indices.push(start);
      }
      if (start < count) timer = window.setTimeout(scan, 0);
      else state.setMatches({ source, fields, needle, indices });
    };
    let timer = window.setTimeout(scan, 0);
    return () => window.clearTimeout(timer);
  }, [state.open, source, count, fields, needle, matches]);

  const total = needle ? matches?.length ?? 0 : count;
  const last = Math.max(0, Math.ceil(total / groupSize) - 1);
  const activeIndex = matches ? matches.indexOf(active) : active;
  const index = group?.source === source && group.needle === needle && group.active === active ? Math.min(group.index, last) :
    Math.min(last, Math.max(0, Math.floor(activeIndex / groupSize)));
  const start = index * groupSize, end = Math.min(start + groupSize, total);
  function changeSearch(next: string) { setGroup(undefined); state.setSearch(next); }
  if (!count) return null;
  return <div className="record-navigator" hidden={!showToggle && !state.open}>
    {showToggle && <RecordNavigatorToggle state={state} title={title}/>}
    <section id={state.id} aria-label={title} hidden={!state.open}>
      {state.open && <>
        <details>
          <summary>{text.columns}</summary>
          <div className="record-navigator-fields">{Array.from({ length: Math.min(keys.length + 1, 3, columns.length) }, (_, slot) =>
            <select key={slot} aria-label={text.column(slot)} value={keys[slot] === undefined ? '' : 'field:' + keys[slot]} onChange={event => {
              const selection = event.target.value;
              const key = selection.slice(6);
              if (!selection && keys.length === 1 || selection && (!byKey.has(key) || keys.some((other, position) => position !== slot && key === other))) return;
              state.setFields(selection ? [...keys.slice(0, slot), key, ...keys.slice(slot + 1)] : keys.filter((_, position) => position !== slot));
            }}>
              <option value="" disabled={keys.length === 1 && slot === 0}>{text.none}</option>
              {columns.map(column => <option key={column.key} value={'field:' + column.key}
                disabled={keys.some((other, position) => position !== slot && other === column.key)}>{column.name || text.unnamed}</option>)}
            </select>)}</div>
        </details>
        <input className="record-navigator-search" type="search" aria-label={text.search} placeholder={text.search}
          maxLength={256} value={state.search} disabled={!keys.length} onChange={event => changeSearch(event.target.value)}
          onKeyDown={event => {
            if (tableCellKeyIsComposing(event.nativeEvent)) return;
            if (event.key === 'Enter' || event.key === 'Escape' && state.search) {
              event.preventDefault(); event.stopPropagation();
              if (event.key === 'Escape') changeSearch('');
            }
          }}/>
        {needle && !total && <p role="status">{matches ? text.noMatches : text.searching}</p>}
        <ol start={start + 1}>{Array.from({ length: end - start }, (_, offset) => {
          const position = start + offset, row = matches?.[position] ?? position;
          const unavailable = canSelect?.(row) === false;
          return <li key={row}><button type="button" aria-current={active === row ? 'true' : undefined}
            disabled={disabled || unavailable} onClick={() => { if (row !== active && !disabled && !unavailable) onSelect(row); }}>
            <strong>{stage && row !== active ? text.stageRow(row) : text.row(row)}</strong>
            {unavailable ? <span>{text.unavailable}</span> : keys.map(key => <span key={key}>
              {byKey.get(key)?.name || text.unnamed} · {value(row, key) || text.empty}
            </span>)}
          </button></li>;
        })}</ol>
        {last > 0 && <div className="record-navigator-paging">
          <button type="button" disabled={index === 0} onClick={() => setGroup({ source, needle, active, index: index - 1 })}>{text.previous}</button>
          <span>{text.range(start + 1, end, total)}</span>
          <button type="button" disabled={index === last} onClick={() => setGroup({ source, needle, active, index: index + 1 })}>{text.next}</button>
        </div>}
      </>}
    </section>
  </div>;
}
