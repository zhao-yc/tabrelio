import { useState } from 'react';
import type { QueryOutcome } from '../../shared/contracts';
import type { QueryFailure } from '../../shared/queryFailure';
import { queryContinueOnErrorZh as t } from '../locales/queryContinueOnError.zh-CN';
import { queryFailureSourceZh as sourceText } from '../locales/queryFailureSource.zh-CN';

/** 仅确认原模板的UTF16半开范围，不搜索SQL文字，不复制或插值参数模板。 */
export function confirmedQueryContinueRange(source: string, failure: Pick<QueryFailure, 'sourceRange'>): boolean {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(failure, 'sourceRange');
    if (!descriptor || !('value' in descriptor) || !descriptor.value || typeof descriptor.value !== 'object' || Reflect.ownKeys(descriptor.value).length !== 2) return false;
    const start = Object.getOwnPropertyDescriptor(descriptor.value, 'start'), end = Object.getOwnPropertyDescriptor(descriptor.value, 'end');
    if (!start || !end || !('value' in start) || !('value' in end)) return false;
    const from = start.value, to = end.value;
    /** 不允许在代理对中间定位，否则Monaco选区将偏离原语句。 */
    const boundary = (offset: unknown): offset is number => Number.isSafeInteger(offset) && (offset as number) >= 0 && (offset as number) <= source.length && !((offset as number) > 0 && (offset as number) < source.length && /[\ud800-\udbff]/u.test(source[(offset as number) - 1]) && /[\udc00-\udfff]/u.test(source[offset as number]));
    return boundary(from) && boundary(to) && from < to;
  } catch { return false; }
}

/** 展示固定统计与有界错误，不把消息解释为HTML，也不触发查询或自动定位。 */
export function QueryContinueOnErrorNotice({ report, completedResults, locateAvailable, onLocate, positionAvailable, onLocatePosition, positionLabel = sourceText.locatePositionFor }: {
  report: NonNullable<QueryOutcome['scriptReport']>; completedResults: number;
  locateAvailable?(failure: QueryFailure): boolean; onLocate?(failure: QueryFailure): boolean;
  positionAvailable?(failure: QueryFailure): boolean; onLocatePosition?(failure: QueryFailure): boolean; positionLabel?(ordinal: number): string;
}) {
  const [visited, setVisited] = useState<{report: typeof report; failure: QueryFailure}>();
  const entries = report.errors.slice(0, 100).map(failure => ({failure,
    statement: !!onLocate && !!locateAvailable?.(failure),
    position: !!failure.errorRange && !!onLocatePosition && !!positionAvailable?.(failure),
  }));
  const navigable = entries.filter(entry => entry.statement || entry.position);
  const index = visited?.report === report ? navigable.findIndex(entry => entry.failure === visited.failure) : -1;
  const active = navigable[index]?.failure;

  /** 只有编辑器确认已定位才推进游标。重新执行或原租约失效时，不沿用旧回执的位置。 */
  function locate(failure: QueryFailure, target: 'statement' | 'position' | 'best') {
    const precise = target !== 'statement' && !!failure.errorRange && positionAvailable?.(failure) && onLocatePosition?.(failure);
    if (precise || target !== 'position' && locateAvailable?.(failure) && onLocate?.(failure)) setVisited({report, failure});
  }
  function move(direction: -1 | 1) {
    if (!navigable.length) return;
    const next = index < 0 ? (direction === 1 ? 0 : navigable.length - 1) :
      (index + direction + navigable.length) % navigable.length;
    locate(navigable[next].failure, 'best');
  }
  /** 展示预算独立于服务端预算，防异常回包造成巨量DOM。 */
  function bounded(value: string): string {
    if (value.length <= 4096) return value;
    const end = /[\ud800-\udbff]/u.test(value[4095]) && /[\udc00-\udfff]/u.test(value[4096]) ? 4095 : 4096;
    return value.slice(0, end) + t.truncated;
  }
  return <section className="query-partial-outcome" role="status" aria-label={t.title} style={{ maxHeight: 'min(320px, 35vh)', overflow: 'auto', overflowWrap: 'anywhere' }}>
    <strong>{t.title}</strong><p>{t.counts(report.statementsAttempted, report.statementsCompleted, report.errors.length)}</p>
    <p>{report.reachedEnd ? t.reachedEnd : t.stopped}</p>{report.stopReason && <p>{t.stopReason}：{bounded(report.stopReason)}</p>}
    <p>{t.results(completedResults)}</p><p className="warning-text">{t.warning}</p>
    {entries.length > 1 && (onLocate || onLocatePosition) && <div className="query-failure-navigation" role="group" aria-label={t.navigation}>
      <button disabled={!navigable.length} onClick={() => move(-1)}>{t.previous}</button>
      <button disabled={!navigable.length} onClick={() => move(1)}>{t.next}</button>
      <span className="muted small">{active ? t.located(active.statementOrdinal, index + 1, navigable.length) : t.navigable(navigable.length)}</span>
    </div>}
    {!!entries.length && <ol>{entries.map(({failure, statement, position}, index) => {
      return <li key={`${failure.statementOrdinal}:${index}`} aria-current={active === failure || undefined}>
        <strong>{t.error(failure.statementOrdinal)} · {failure.kind === 'server' ? t.server : t.terminal}</strong>
        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{bounded(failure.message)}</pre>
        <button disabled={!statement} title={statement ? t.locate(failure.statementOrdinal) : t.unavailable}
          onClick={() => locate(failure, 'statement')}>{t.locate(failure.statementOrdinal)}</button>
        {failure.errorRange && onLocatePosition && <button disabled={!position} onClick={() => locate(failure, 'position')}>
          {positionLabel(failure.statementOrdinal)}</button>}
      </li>;
    })}</ol>}
  </section>;
}
