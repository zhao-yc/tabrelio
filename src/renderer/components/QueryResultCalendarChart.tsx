import { useState } from 'react';
import type { QueryResultCalendarDistribution } from '../queryResultCalendar';
import { queryResultStatisticsZh as text } from '../locales/queryResultStatistics.zh-CN';
import { zh } from '../locales/zh-CN';
import '../tableHistogram.css';

const pageSize = 50;

/** 表级聚合可能超过 JS 安全整数。比例舍入前始终用精确计数。 */
function percentage(count: string | number, total: string | number): string {
  const denominator = BigInt(total);
  if (!denominator) return text.unavailable;
  const basis = (BigInt(count) * 10000n + denominator / 2n) / denominator;
  return `${basis / 100n}.${String(basis % 100n).padStart(2, '0')}%`;
}

/** 分页只限制绘制数量，所有区间的原计数仍可逐页核对。 */
export function QueryResultCalendarChart({ distribution }: { distribution: QueryResultCalendarDistribution<number | string> }) {
  const [page, setPage] = useState(0);
  const { column, buckets, grouped, peak, nulls, ungrouped } = distribution;
  const pages = Math.ceil(buckets.length / pageSize);
  const current = buckets.slice(page * pageSize, (page + 1) * pageSize);
  return <section className="table-histogram" aria-label={text.calendar}>
    <h3>{text.calendar} · {column}</h3>
    <p>{text.calendarHint}</p>
    <dl className="table-histogram-metrics">
      <div><dt>{text.calendarGrouped}</dt><dd aria-label={text.calendarGrouped}>{grouped}</dd></div>
      <div><dt>{text.nulls}</dt><dd aria-label={text.nulls}>{nulls}</dd></div>
      <div><dt>{text.calendarUngrouped}</dt><dd aria-label={text.calendarUngrouped}>{ungrouped}</dd></div>
    </dl>
    {!pages ? <p>{text.calendarEmpty}</p> : <table aria-label={text.calendar}>
      <thead><tr>{[text.calendarPeriod, text.frequencyRows, text.frequencyPercent, text.frequencyBar].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
      <tbody>{current.map(bucket => <tr key={bucket.label}>
        <th scope="row">{bucket.label}</th><td>{bucket.count}</td><td>{percentage(bucket.count, grouped)}</td>
        <td className="table-histogram-plot"><div aria-hidden="true" style={{ width: percentage(bucket.count, peak) }}/></td>
      </tr>)}</tbody>
    </table>}
    {pages > 1 && <div className="table-histogram-controls">
      <button type="button" disabled={page === 0} onClick={() => setPage(index => Math.max(0, index - 1))}>{zh.common.pagePrevious}</button>
      <span role="status">{text.calendarPage(page + 1, pages, buckets.length)}</span>
      <button type="button" disabled={page >= pages - 1} onClick={() => setPage(index => Math.min(pages - 1, index + 1))}>{zh.common.pageNext}</button>
    </div>}
  </section>;
}
