import { valueDistributionRemainder, type ValueDistribution } from '../../shared/valueDistribution';
import { valueDistributionZh as text } from '../locales/valueDistribution.zh-CN';
import { statisticsPercentage } from '../statisticsPercentage';
import '../queryResultFrequency.css';

/** 其余组只展示合计，筛选仍由各表页的原候选控件处理。 */
export function ValueDistributionSummary({ totals, options, truncated }: {
  totals: ValueDistribution; options: readonly { count: string }[]; truncated: boolean;
}) {
  const { hiddenGroups, hiddenRows } = valueDistributionRemainder(totals, options, truncated);
  return <div role="group" aria-label={text.title}>
    <p>{text.totals(totals.rows, totals.groups)}</p>
    {truncated && <p>{text.remainder(hiddenRows, hiddenGroups, statisticsPercentage(hiddenRows, totals.rows))}</p>}
  </div>;
}

export function ValueDistributionCells({ count, total }: { count: string; total: string }) {
  const percentage = statisticsPercentage(count, total);
  return <><td>{percentage}</td><td>
    <div className="query-result-frequency-bar" aria-hidden="true"><span style={{ width: percentage }}/></div>
  </td></>;
}
