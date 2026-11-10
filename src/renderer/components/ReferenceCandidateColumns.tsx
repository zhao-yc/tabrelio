import { useMemo, useState, type ReactNode } from 'react';
import type { ResultColumn } from '../../shared/contracts';
import { referenceCandidateColumnsZh as text } from '../locales/referenceCandidateColumns.zh-CN';
import '../references.css';

const emptyCandidateColumns: ResultColumn[] = [];
const emptyNames: string[] = [];

/** 只投影当前候选网格的列，保持整行原值、搜索字段和复合键映射。由约束身份决定设置的生命周期。 */
export function ReferenceCandidateColumns({ columns = emptyCandidateColumns, keyNames = emptyNames, children }: {
  columns?: ResultColumn[];
  keyNames?: readonly string[];
  children(visible: ResultColumn[]): ReactNode;
}) {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const { optional, visible } = useMemo(() => {
    const keys = new Set(keyNames), names = new Set(columns.map(column => column.name));
    if (!keys.size || [...keys].some(name => !names.has(name))) return { optional: [], visible: columns };
    const optional = columns.filter(column => !keys.has(column.name));
    const visible = hidden.size ? columns.filter(column => keys.has(column.name) || !hidden.has(column.name)) : columns;
    return { optional, visible };
  }, [columns, hidden, keyNames]);
  const shown = optional.filter(column => !hidden.has(column.name)).length;
  return <>
    {optional.length > 0 && <details className="usage-help reference-columns">
      <summary>{text.title}</summary>
      <div className="usage-help-content">
        <div className="reference-column-actions">
          <button type="button" disabled={shown === optional.length} onClick={() => setHidden(new Set())}>{text.showAll}</button>
          <button type="button" disabled={shown === 0} onClick={() => setHidden(new Set(optional.map(column => column.name)))}>{text.keysOnly}</button>
        </div>
        {optional.map(column => <label className="check" key={column.key}>
          <input type="checkbox" aria-label={text.show(column.name)} checked={!hidden.has(column.name)} onChange={event => {
            const next = new Set(hidden);
            if (event.target.checked) next.delete(column.name);
            else next.add(column.name);
            setHidden(next);
          }}/>{column.name}
        </label>)}
      </div>
    </details>}
    {children(visible)}
  </>;
}
