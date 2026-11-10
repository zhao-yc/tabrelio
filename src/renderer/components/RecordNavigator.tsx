import { useId, useState } from 'react';
import { recordNavigatorZh as text } from '../locales/recordNavigator.zh-CN';
import '../recordNavigator.css';

type SummaryColumn = { key: string; name: string };
const groupSize = 25;

export function useRecordNavigator() {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<readonly string[]>();
  return { id, open, setOpen, fields, setFields };
}

type NavigatorState = ReturnType<typeof useRecordNavigator>;

export function RecordNavigatorToggle({ state }: { state: NavigatorState }) {
  return <button type="button" aria-controls={state.id} aria-expanded={state.open}
    onClick={() => state.setOpen(!state.open)}>{text.title}</button>;
}

interface Props {
  state: NavigatorState;
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
export function RecordNavigator({ state, columns, count, active, value, canSelect, disabled, stage, showToggle = true, onSelect }: Props) {
  const [group, setGroup] = useState<{ active: number; index: number }>();
  const last = Math.max(0, Math.ceil(count / groupSize) - 1);
  const index = group?.active === active ? Math.min(group.index, last) : Math.min(last, Math.max(0, Math.floor(active / groupSize)));
  const start = index * groupSize, end = Math.min(start + groupSize, count);
  const byKey = new Map(columns.map(column => [column.key, column]));
  const available = state.fields?.filter(key => byKey.has(key));
  const keys = available?.length ? available : columns.slice(0, 2).map(column => column.key);
  if (!count) return null;
  return <div className="record-navigator" hidden={!showToggle && !state.open}>
    {showToggle && <RecordNavigatorToggle state={state}/>}
    <section id={state.id} aria-label={text.title} hidden={!state.open}>
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
        <ol start={start + 1}>{Array.from({ length: end - start }, (_, offset) => {
          const row = start + offset;
          const unavailable = canSelect?.(row) === false;
          return <li key={row}><button type="button" aria-current={active === row ? 'true' : undefined}
            disabled={disabled || unavailable} onClick={() => { if (row !== active) onSelect(row); }}>
            <strong>{stage && row !== active ? text.stageRow(row) : text.row(row)}</strong>
            {unavailable ? <span>{text.unavailable}</span> : keys.map(key => <span key={key}>
              {byKey.get(key)?.name || text.unnamed} · {value(row, key) || text.empty}
            </span>)}
          </button></li>;
        })}</ol>
        {last > 0 && <div className="record-navigator-paging">
          <button type="button" disabled={index === 0} onClick={() => setGroup({ active, index: index - 1 })}>{text.previous}</button>
          <span>{text.range(start + 1, end, count)}</span>
          <button type="button" disabled={index === last} onClick={() => setGroup({ active, index: index + 1 })}>{text.next}</button>
        </div>}
      </>}
    </section>
  </div>;
}
