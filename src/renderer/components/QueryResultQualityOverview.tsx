import { useEffect, useRef, useState } from 'react';
import type { DataRow, QueryResult, ResultColumn } from '../../shared/contracts';
import { errorMessage } from '../lib';
import { queryResultStatisticsZh as text } from '../locales/queryResultStatistics.zh-CN';
import type { SortDialect } from '../queryResultSort';
import { QueryResultQualityOverviewScan, queryResultPercentage, type QueryResultQualityColumn, type QueryResultQualityFilter } from '../queryResultStatistics';
import { ErrorBox } from './ui';
import '../queryResultFrequency.css';

interface Props {
  columns: readonly ResultColumn[];
  rows: readonly DataRow[];
  indices?: ReadonlySet<number>;
  sqliteSource?: QueryResult;
  dialect?: SortDialect;
  isCurrent(): boolean;
  onOpenColumn(key: string): void;
  onFilter?(column: Readonly<ResultColumn>, operator: QueryResultQualityFilter): void;
}

/** 概览按请求挂载，换范围或关闭时撤销定时器与所有原格快照。 */
export function QueryResultQualityOverview(props: Props) {
  const origin = useRef(props).current;
  const latest = useRef(props);
  latest.current = props;
  const scanRef = useRef<QueryResultQualityOverviewScan | undefined>(undefined);
  const [view, setView] = useState<{ processed: number; result?: readonly QueryResultQualityColumn[]; error?: string }>({ processed: 0 });
  const current = () => latest.current.columns === origin.columns && latest.current.rows === origin.rows
    && latest.current.indices === origin.indices && latest.current.sqliteSource === origin.sqliteSource
    && latest.current.dialect === origin.dialect && latest.current.isCurrent();

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    try {
      if (!current()) return;
      const scan = new QueryResultQualityOverviewScan(origin.columns, origin.rows, origin.indices, origin.sqliteSource, origin.dialect);
      scanRef.current = scan;
      const tick = () => {
        if (scanRef.current !== scan) return;
        try {
          if (!current()) throw Error(text.stale);
          const progress = scan.step();
          const result = scan.result();
          if (progress.done && !result) throw Error(text.stale);
          setView({ processed: progress.processed, result });
          if (!progress.done) timer = setTimeout(tick, 0);
        } catch (reason) {
          scan.cancel();
          setView({ processed: 0, error: errorMessage(reason) });
        }
      };
      timer = setTimeout(tick, 0);
      return () => { scanRef.current = undefined; clearTimeout(timer); scan.cancel(); };
    } catch (reason) {
      setView({ processed: 0, error: errorMessage(reason) });
    }
  }, [origin]);

  const result = view.result && current() ? scanRef.current?.result() : undefined;
  if (view.error || view.result && !result) return <ErrorBox message={view.error ?? text.stale}/>;
  if (!result) return <p role="status">{text.overviewProgress(view.processed, origin.columns.length)}</p>;
  /** 明细和筛选都绑定当前已发布整张概览，复用同一次原值校验。 */
  function usePublishedOverview(action: () => void) {
    if (current() && scanRef.current?.result() === result) action();
    else setView({ processed: 0, error: text.stale });
  }
  return <div className="query-result-overview">
    <table>
      <caption>{text.overview}</caption>
      <thead><tr>{[text.overviewColumn, text.overviewType, text.count, text.nulls, text.nullShare, text.emptyText,
        text.distinct, text.singletonRows, text.repeatedRows, text.overviewDetails].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
      <tbody>{result.map(({ column, count, nulls, emptyText, distinct, singletonRows, repeatedRows }) => {
        const name = column.name ? `${column.name} · ${column.key}` : column.key;
        const filterCount = (value: number | undefined, operator: QueryResultQualityFilter) => {
          const label = text.qualityFilterColumn(text.qualityFilter[operator], name);
          return props.onFilter && value ? <button type="button" className="query-result-quality-filter"
            aria-label={label} title={label} onClick={() => usePublishedOverview(() => latest.current.onFilter?.(column, operator))}>{value}</button>
            : value ?? text.unavailable;
        };
        return <tr key={column.key}>
          <th scope="row">{name}</th><td>{column.type}</td><td>{count}</td><td>{filterCount(nulls, 'null')}</td>
          <td>{queryResultPercentage(nulls, count)}</td><td>{filterCount(emptyText, 'empty')}</td>
          {[distinct, singletonRows, repeatedRows]
            .map((value, index) => <td key={index}>{value ?? text.unavailable}</td>)}
          <td><button type="button" aria-label={text.overviewOpenColumn(name)}
            onClick={() => usePublishedOverview(() => latest.current.onOpenColumn(column.key))}>{text.overviewDetails}</button></td>
        </tr>;
      })}</tbody>
    </table>
  </div>;
}
