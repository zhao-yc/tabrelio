import { useState } from 'react';
import type { QueryResult, ResultColumn } from '../../shared/contracts';
import { projectQueryResultKeyword, projectQueryResultRows } from '../queryResultKeyword';
import { queryResultFindZh as text } from '../locales/queryResultFind.zh-CN';
import '../queryResultKeyword.css';

interface Projection {
  source: QueryResult;
  result: QueryResult;
  columns: readonly ResultColumn[] | undefined;
  context: readonly unknown[];
}

/** 匹配视图只属于已经整理好的结果；切换任一来源后，不沿用旧行号。 */
export function useQueryResultMatchView(source: QueryResult | undefined, columns: readonly ResultColumn[] | undefined, context: readonly unknown[]) {
  const [projection, setProjection] = useState<Projection>();
  const active = projection && projection.source === source && projection.columns === columns &&
    projection.context.length === context.length && projection.context.every((value, index) => Object.is(value, context[index]))
    ? projection : undefined;
  if (projection && !active) setProjection(undefined);
  const result = active?.result ?? source;

  function apply(indices: ReadonlySet<number>, invalidate: () => void) {
    if (!source || !result) return;
    // 保留原显示顺序及 SQLite 逐格存储类型；投影成功后才撤销旧选择。
    const positions = [...indices].sort((left, right) => left - right);
    if (positions.some(index => !Number.isSafeInteger(index) || index < 0 || index >= result.rows.length)) throw Error(text.matchViewInvalid);
    const next = projectQueryResultRows(result, positions);
    invalidate();
    setProjection({ source, columns, context, result: next });
  }
  function clear(invalidate: () => void) {
    if (!active) return;
    invalidate();
    setProjection(undefined);
  }
  /** 同一批原行重排时沿用匹配成员，使用新顺序重新投影 SQLite 逐格类型。 */
  function reorder(sorted: QueryResult): void {
    if (active) setProjection({ source: sorted, columns, context,
      result: projectQueryResultKeyword(sorted, new Set(active.result.rows)) });
  }
  return { result, active, apply, clear, reorder };
}

export function QueryResultMatchView({ active, disabled, onClear }: { active: Projection; disabled: boolean; onClear(): void }) {
  return <div className="query-result-keyword">
    <span role="status">{text.matchViewCount(active.result.rows.length, active.source.rows.length)}</span>
    <button type="button" disabled={disabled} onClick={onClear}>{text.clearMatchView}</button>
  </div>;
}
