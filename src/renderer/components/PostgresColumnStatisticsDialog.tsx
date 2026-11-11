import { useRef, useState } from 'react';
import type { PostgresColumnStatistics } from '../../shared/postgresColumnStatistics';
import { postgresHistogramBins, postgresHistogramKind, type PostgresHistogramBins, type PostgresTableHistogram } from '../../shared/postgresTableHistogram';
import { calendarUnits, type CalendarUnit } from '../../shared/civilDate';
import { assertPostgresTableCalendar, postgresCalendarKind, postgresCalendarUnitSchema, type PostgresTableCalendar } from '../../shared/postgresTableCalendar';
import type { PostgresTableStatisticsInput } from '../../shared/postgresTable';
import { assertStatisticsSample, statisticsRowCount } from '../../shared/tableStatistics';
import { errorMessage, invoke } from '../lib';
import { postgresColumnStatisticsZh as text } from '../locales/postgresColumnStatistics.zh-CN';
import { tableHistogramZh as histogramText } from '../locales/tableHistogram.zh-CN';
import { queryResultStatisticsZh as calendarText } from '../locales/queryResultStatistics.zh-CN';
import { tableStatisticsZh as scopeText } from '../locales/tableStatistics.zh-CN';
import { usePostgresColumnRead, type PostgresColumnReadSource } from '../postgresColumnRead';
import { ErrorBox, Field, Modal, Spinner } from './ui';
import { TableHistogramChart } from './TableHistogramChart';
import { QueryResultCalendarChart } from './QueryResultCalendarChart';
import { defaultStatisticsScope, readStatisticsSampleLimit, StatisticsSampleControls } from './StatisticsSampleControls';
import '../tableStatistics.css';

type Value = NonNullable<PostgresColumnStatistics['groups']>['min'];
type StatisticsResult = PostgresColumnStatistics | PostgresTableHistogram | PostgresTableCalendar;

function display(value: Value, quoted = false): string {
  if (!value) return 'NULL';
  return (quoted ? JSON.stringify(value.text) : value.text) + (value.clipped ? ` …（${text.clipped}）` : '');
}

/** 选择字段只改变本地输入，显式开始才读取原筛选范围内的数据库快照。 */
export function PostgresColumnStatisticsDialog({ source, onClose }: { source: PostgresColumnReadSource; onClose(): void }) {
  const { origin, result, busy, error, read, reset, reading, setError } = usePostgresColumnRead<StatisticsResult>(source, text.expired);
  const [column, setColumn] = useState(origin.initialColumn ?? origin.columns[0]?.key ?? '');
  const [bins, setBins] = useState<PostgresHistogramBins>(10);
  const [unit, setUnit] = useState<CalendarUnit>('month');
  const [scope, setScope] = useState(defaultStatisticsScope), scopeRef = useRef(scope);
  const field = origin.columns.find(item => item.key === column);
  const summary = result && 'nonNull' in result ? result : undefined;
  const calendar = result && 'buckets' in result ? result : undefined;
  const histogram = result && 'ranges' in result ? result : undefined;
  const sampleLimit = result?.sampleLimit;
  const rowsLabel = sampleLimit === undefined ? text.rows : scopeText.sampledRows;
  const metrics: [string, string][] = [];
  if (summary && field) {
    const { groups, numeric } = summary;
    metrics.push([text.type, field.type], [rowsLabel, summary.rows], [text.nonNull, summary.nonNull], [text.nulls, summary.nulls]);
    if (summary.empty !== undefined) metrics.push([text.empty, summary.empty]);
    if (groups) metrics.push([text.distinct, groups.distinct], [text.unique, groups.unique], [text.repeated, groups.repeated],
      [text.min, display(groups.min, summary.empty !== undefined)], [text.max, display(groups.max, summary.empty !== undefined)]);
    if (numeric) metrics.push([text.zero, numeric.zero], [text.nonFinite, numeric.nonFinite],
      [text.sum, display(numeric.sum)], [text.average, display(numeric.average)], [text.deviation, display(numeric.deviation)]);
  }
  /** 范围选择只更新本地，拒绝同一帧内仍引用旧范围的读取。 */
  function changeScope(next: typeof scope): void {
    if (reading.current || scopeRef.current !== scope || !origin.current()) return;
    scopeRef.current = next; setScope(next); reset();
  }
  async function readStatistics(action: (input: PostgresTableStatisticsInput) => Promise<StatisticsResult>) {
    if (reading.current || scopeRef.current !== scope) return;
    let limit: number | undefined;
    try { limit = readStatisticsSampleLimit(scope); }
    catch (reason) { reset(); setError(errorMessage(reason)); return; }
    const input = { ...origin.input, column, ...(limit === undefined ? {} : { sampleLimit: limit }) };
    await read(async () => {
      const output = await action(input);
      assertStatisticsSample(limit, output.sampleLimit, statisticsRowCount(output));
      return output;
    });
  }
  return <Modal title={text.title} onClose={onClose} wide>
    <div className="modal-content">
      <p>{text.hint}</p>
      <StatisticsSampleControls scope={scope} disabled={busy} onChange={changeScope}/>
      <div className="pg-table-controls">
        <Field label={text.field}><select aria-label={text.field} value={column} disabled={busy} onChange={event => {
          setColumn(event.target.value); reset();
        }}>{origin.columns.map(item => <option key={item.key} value={item.key}>{item.name}</option>)}</select></Field>
        <button type="button" disabled={busy || !field} onClick={() => void readStatistics(input =>
          invoke('postgres.table.statistics', input))}>{text.read}</button>
        {field && postgresHistogramKind(field) && <>
          <Field label={histogramText.bins}><select aria-label={histogramText.bins} value={bins} disabled={busy} onChange={event => {
            setBins(postgresHistogramBins.parse(Number(event.target.value)));
            if (result && 'ranges' in result) reset();
          }}>
            {[5, 10, 20].map(value => <option key={value} value={value}>{value}</option>)}
          </select></Field>
          <button type="button" disabled={busy} onClick={() => void readStatistics(input =>
            invoke('postgres.table.histogram', { ...input, bins }))}>{text.readHistogram}</button>
        </>}
        {field && postgresCalendarKind(field) && <>
          <Field label={calendarText.calendarUnit}><select aria-label={calendarText.calendarUnit} value={unit} disabled={busy} onChange={event => {
            setUnit(postgresCalendarUnitSchema.parse(event.target.value));
            if (calendar) reset();
          }}>
            {calendarUnits.map(value => <option key={value} value={value}>{calendarText.calendarUnits[value]}</option>)}
          </select></Field>
          <button type="button" disabled={busy} onClick={() => void readStatistics(async input => assertPostgresTableCalendar(
            await invoke('postgres.table.calendar', { ...input, unit }), field, unit, input.sampleLimit))}>{text.readCalendar}</button>
        </>}
        {busy && <Spinner text={text.loading}/>}
      </div>
      <ErrorBox message={error}/>
      {sampleLimit !== undefined && <p>{scopeText.sampledScope(sampleLimit)}</p>}
      {summary && <div className="table-statistics-results">
        <table aria-label={text.title}><thead><tr><th>{text.metric}</th><th>{text.value}</th></tr></thead>
          <tbody>{metrics.map(([name, value]) => <tr key={name}><th scope="row">{name}</th><td>{value}</td></tr>)}</tbody>
        </table>
        {!summary.groups && <p className="muted small">{text.countsOnly}</p>}
      </div>}
      {histogram && <>
        {sampleLimit !== undefined && <p>{scopeText.sampledRows}：{statisticsRowCount(histogram).toString()}</p>}
        <TableHistogramChart histogram={histogram}/>
      </>}
      {calendar && <div className="table-statistics-results">
        <dl><dt>{rowsLabel}</dt><dd aria-label={rowsLabel}>{calendar.rows}</dd></dl>
        {calendar.timeZone && <p>{text.calendarZone(calendar.timeZone)}</p>}
        <QueryResultCalendarChart distribution={calendar}/>
      </div>}
    </div>
    <footer className="modal-footer"><button type="button" onClick={onClose}>{text.close}</button></footer>
  </Modal>;
}
