import { statisticsSampleLimitSchema, tableStatisticsSampleMax } from '../../shared/tableStatistics';
import { tableStatisticsZh as text } from '../locales/tableStatistics.zh-CN';
import '../tableStatistics.css';

export const defaultStatisticsScope = { sampled: false, limit: '1000' };
type StatisticsScope = typeof defaultStatisticsScope;

/** 空值表示全量，输入无效时在显式开始统计前报告。 */
export function readStatisticsSampleLimit(scope: StatisticsScope): number | undefined {
  if (!scope.sampled) return undefined;
  const parsed = statisticsSampleLimitSchema.safeParse(/^[0-9]+$/.test(scope.limit) ? Number(scope.limit) : NaN);
  if (!parsed.success) throw Error(text.sampleLimitInvalid);
  return parsed.data;
}

export function StatisticsSampleControls({ scope, disabled, onChange }: {
  scope: StatisticsScope; disabled: boolean; onChange(value: StatisticsScope): void;
}) {
  return <>
    <div className="table-histogram-controls">
      <label>{text.scopeMode}<select aria-label={text.scopeMode} value={scope.sampled ? 'first' : 'all'} disabled={disabled} onChange={event => {
        const value = event.target.value;
        if (value === 'all' || value === 'first') onChange({ ...scope, sampled: value === 'first' });
      }}><option value="all">{text.allRows}</option><option value="first">{text.firstRows}</option></select></label>
      {scope.sampled && <label>{text.sampleLimit}<input type="number" aria-label={text.sampleLimit} min={1} max={tableStatisticsSampleMax}
        step={1} value={scope.limit} disabled={disabled} onChange={event => onChange({ ...scope, limit: event.target.value })}/></label>}
    </div>
    {scope.sampled && <p>{text.sampleHint}</p>}
  </>;
}
