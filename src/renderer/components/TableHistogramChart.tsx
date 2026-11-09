import type { TableHistogram } from '../../shared/tableHistogram';
import type { PostgresTableHistogram } from '../../shared/postgresTableHistogram';
import type { QueryResultHistogram } from '../queryResultHistogram';
import { tableHistogramZh as text } from '../locales/tableHistogram.zh-CN';
import { queryResultStatisticsZh as queryText } from '../locales/queryResultStatistics.zh-CN';
import '../tableHistogram.css';

/** 只显示已核对的区间计数；条形比例有界转换，原计数和边界始终保留原文。 */
export function TableHistogramChart({ histogram }: { histogram: TableHistogram | PostgresTableHistogram | QueryResultHistogram }) {
  const local = 'nonNumeric' in histogram, finite = 'finite' in histogram;
  const included = finite ? histogram.finite : histogram.nonNull;
  const peak = histogram.ranges.reduce((largest, range) => BigInt(range.count) > largest ? BigInt(range.count) : largest, 0n);
  const total = BigInt(included);
  const percent = (count: string, total: bigint) => { const scaled = total ? BigInt(count) * 10000n / total : 0n; return `${scaled / 100n}.${(scaled % 100n).toString().padStart(2, '0')}%`; };
  return <section className="table-histogram" aria-label={text.title}>
    <h3>{text.title} · {histogram.column}</h3>
    <p>{local ? (histogram.approximate ? queryText.floatInput : queryText.histogramExact) : histogram.approximate ? text.approximate : finite ? text.postgresExact : text.exact}</p>
    <p>{local ? queryText.histogramHint : finite ? text.postgresScope : text.scope}</p>
    <p>{text.actual(histogram.ranges.length, histogram.requestedBins)} · {finite && !local ? text.postgresReduced : text.reduced}</p>
    <dl><dt>{finite ? text.finite : text.nonNull}</dt><dd>{included}</dd><dt>{text.nulls}</dt><dd>{histogram.nulls}</dd>
      {finite && <><dt>{text.nonFinite}</dt><dd>{histogram.nonFinite}</dd></>}
      {local && <><dt>{queryText.histogramNonNumeric}</dt><dd>{histogram.nonNumeric}</dd></>}</dl>
    {!histogram.ranges.length ? <p>{finite ? text.noFinite : text.empty}</p> : <>
      <table><caption>{text.title} · {histogram.column}</caption>
        <thead><tr>{[text.range, text.count, finite ? text.finitePercentage : text.percentage, text.bar]
          .map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{histogram.ranges.map((range, index) => <tr key={index}>
          <th scope="row">[{range.lower}, {range.upper}{range.upperInclusive ? ']' : ')'}</th>
          <td>{range.count}</td><td>{percent(range.count, total)}</td>
          <td className="table-histogram-plot"><div aria-hidden="true" style={{ width: percent(range.count, peak) }}/></td>
        </tr>)}</tbody>
      </table><p className="muted">{text.scale}</p>
    </>}
  </section>;
}
