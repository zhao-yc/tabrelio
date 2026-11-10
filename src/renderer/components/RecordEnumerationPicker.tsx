import { useEffect, useMemo, useRef, useState } from 'react';
import type { ColumnEnumeration } from '../../shared/contracts';
import { columnEnumerationZh as text } from '../locales/columnEnumeration.zh-CN';
import './RecordEnumerationPicker.css';

const pageSize = 100;

/** SET 只使用真实标签和定义顺序，当前手写文本有歧义时保留它，由用户决定是否修改。 */
export function setEnumerationMembers(values: readonly string[], value: string): ReadonlySet<string> | undefined {
  const members = value === '' ? [] : value.split(',');
  const selected = new Set(members);
  return selected.size === members.length && values.filter(member => selected.has(member)).length === selected.size ? selected : undefined;
}

export function RecordEnumerationPicker({ enumeration, value, focus, onChange }: { enumeration: ColumnEnumeration; value: string; focus: boolean; onChange(value: string): void }) {
  const [query, setQuery] = useState(''), [page, setPage] = useState(0);
  const host = useRef<HTMLFieldSetElement>(null);
  useEffect(() => {
    if (!focus) return;
    // 弹窗先安装焦点陷阱，再把初始焦点交给可操作的成员控件。
    const frame = requestAnimationFrame(() => host.current?.querySelector<HTMLElement>('input:not([disabled]),select:not([disabled])')?.focus());
    return () => cancelAnimationFrame(frame);
  }, [focus]);
  const matches = useMemo(() => {
    const needle = query.toLowerCase();
    return enumeration.values.flatMap((label, index) => label.toLowerCase().includes(needle) ? [index] : []);
  }, [enumeration, query]);
  const selected = enumeration.values.indexOf(value);
  if (enumeration.kind === 'SET') {
    const members = setEnumerationMembers(enumeration.values, value);
    return <fieldset className="record-enumeration" ref={host}>
      <legend>{text.set}</legend>
      {!members && <p>{text.unknownSet}</p>}
      {enumeration.values.map(label => <label key={label}>
        <input type="checkbox" checked={members?.has(label) ?? false} disabled={!members} onChange={event => {
          if (!members) return;
          const next = new Set(members);
          if (event.target.checked) next.add(label); else next.delete(label);
          onChange(enumeration.values.filter(member => next.has(member)).join(','));
        }}/>{label || text.empty}
      </label>)}
    </fieldset>;
  }
  const pages = Math.max(1, Math.ceil(matches.length / pageSize)), current = Math.min(page, pages - 1);
  const options = matches.slice(current * pageSize, (current + 1) * pageSize);
  if (selected >= 0 && !options.includes(selected)) options.unshift(selected);
  return <fieldset className="record-enumeration" ref={host}>
    <legend>{text.enum}</legend>
    {enumeration.values.length > pageSize && <input aria-label={text.filter} placeholder={text.filter} value={query} onChange={event => { setQuery(event.target.value); setPage(0); }}/>}
    <select aria-label={text.enum} value={selected >= 0 ? String(selected) : ''} onChange={event => {
      const label = enumeration.values[Number(event.target.value)];
      if (event.target.value !== '' && label !== undefined) onChange(label);
    }}>
      {selected < 0 && <option value="" disabled>{text.unknown}</option>}
      {options.map(index => <option key={index} value={index}>{enumeration.values[index] || text.empty}</option>)}
    </select>
    {pages > 1 && <div className="record-enumeration-pages">
      <button type="button" disabled={current === 0} onClick={() => setPage(current - 1)}>{text.previous}</button>
      <span>{text.position(current + 1, pages)}</span>
      <button type="button" disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>{text.next}</button>
    </div>}
  </fieldset>;
}
