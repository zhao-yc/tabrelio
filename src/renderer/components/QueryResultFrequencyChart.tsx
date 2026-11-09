import { useState } from 'react';
import type { QueryResultFrequency, QueryResultFrequencyEntry } from '../queryResultFrequency';
import { queryResultPercentage } from '../queryResultStatistics';
import { queryResultStatisticsZh as text } from '../locales/queryResultStatistics.zh-CN';
import '../queryResultFrequency.css';

interface ChartRow { key: string; label: string; kind?: string; count: number; truncated?: boolean; entry?: QueryResultFrequencyEntry | null; }

/** 表格同时给出数值和可见条形；NULL和其余值参与比例，但永不冒充普通值。 */
export function QueryResultFrequencyChart({ frequency, count, nulls, onFilter }: {
  frequency: QueryResultFrequency;
  count: number;
  nulls: number;
  onFilter?(entries: readonly (QueryResultFrequencyEntry | null)[]): void;
}) {
  const [checked, setChecked] = useState<ReadonlySet<QueryResultFrequencyEntry | null>>(() => new Set());
  const rows: ChartRow[] = frequency.entries.map((entry, index) => ({ key: `value-${index}`, label: entry.label, kind: text.frequencyKinds[entry.kind], count: entry.count, truncated: entry.truncated, entry }));
  if (frequency.otherValues) rows.push({ key: 'other', label: text.frequencyOther(frequency.otherValues), count: frequency.otherRows });
  if (nulls) rows.push({ key: 'null', label: text.nulls, count: nulls, entry: null });
  const peak = Math.max(1, ...rows.map(row => row.count));
  return <section className="query-result-frequency" aria-label={text.frequencyTitle}>
    {!rows.length ? <p role="status">{text.frequencyEmpty}</p> : <>
      <div className="query-result-frequency-toolbar">
        <p>{text.frequencyCount(count)}</p>
        {onFilter && <button type="button" disabled={!checked.size} onClick={() => onFilter([...checked])}>{text.frequencyFilterChecked}</button>}
      </div>
      <table className={onFilter ? 'query-result-frequency-actions' : undefined}>
        <caption>{text.frequencyTitle}</caption>
        <thead><tr><th scope="col">{text.frequencyValue}</th><th scope="col">{text.frequencyRows}</th><th scope="col">{text.frequencyPercent}</th><th scope="col">{text.frequencyBar}</th>{onFilter && <th scope="col">{text.frequencyActions}</th>}</tr></thead>
        <tbody>{rows.map(({ entry, ...row }) => <tr key={row.key}>
          <th scope="row"><code>{row.label}</code>{row.kind && <span className="muted small">{row.kind}{row.truncated ? ` · ${text.frequencyTruncated}` : ''}</span>}</th>
          <td>{row.count}</td><td>{queryResultPercentage(row.count, count)}</td>
          <td><div className="query-result-frequency-bar" aria-hidden="true"><span style={{ width: `${row.count * 100 / peak}%` }}/></div></td>
          {onFilter && <td>{entry !== undefined && <div className="query-result-frequency-row-actions">
            <input type="checkbox" checked={checked.has(entry)} aria-label={text.frequencyCheck(row.label, row.kind)} onChange={event => {
              const selected = event.currentTarget.checked;
              setChecked(previous => {
                const next = new Set(previous);
                if (selected) next.add(entry); else next.delete(entry);
                return next;
              });
            }}/>
            <button type="button" onClick={() => onFilter([entry])}>{text.frequencyFilter}</button>
          </div>}</td>}
        </tr>)}</tbody>
      </table>
      <p className="muted small">{text.frequencyScale}</p>
    </>}
  </section>;
}
