import { useRef, useState } from 'react';
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

interface FailureLocation {
  locateAvailable?(failure: QueryFailure): boolean; onLocate?(failure: QueryFailure): boolean;
  positionAvailable?(failure: QueryFailure): boolean; onLocatePosition?(failure: QueryFailure): boolean;
}

/** 菜单、快捷键和摘要只跟踪本次执行。连续导航在同一帧内也以最近一次成功定位为起点。 */
export function useQueryFailureNavigation(outcome: QueryOutcome | null | undefined, {locateAvailable, onLocate, positionAvailable, onLocatePosition}: FailureLocation) {
  // 只保留回执身份，避免上一次导航延长整批查询结果的寿命。
  const receipt = outcome?.scriptReport ?? outcome?.failure;
  type Visit = {receipt: NonNullable<typeof receipt>; failure: QueryFailure};
  const [visited, setVisited] = useState<Visit>();
  const latest = useRef<Visit | undefined>(undefined);
  const failures: readonly (QueryFailure & {kind?: 'server' | 'stopped'})[] =
    outcome?.scriptReport?.errors ?? (outcome?.failure ? [outcome.failure] : []);
  const entries = failures.slice(0, 100).map(failure => ({failure,
    statement: !!onLocate && !!locateAvailable?.(failure),
    position: !!failure.errorRange && !!onLocatePosition && !!positionAvailable?.(failure),
  }));
  const navigable = entries.filter(entry => entry.statement || entry.position);
  const indexOf = (visit: Visit | undefined) => visit && visit.receipt === receipt ? navigable.findIndex(entry => entry.failure === visit.failure) : -1;
  const index = indexOf(visited);

  /** 只有编辑器确认已定位才推进游标。重新执行或原租约失效时，不沿用旧回执的位置。 */
  function locate(failure: QueryFailure, target: 'statement' | 'position' | 'best') {
    if (!receipt) return;
    const precise = target !== 'statement' && !!failure.errorRange && positionAvailable?.(failure) && onLocatePosition?.(failure);
    if (precise || target !== 'position' && locateAvailable?.(failure) && onLocate?.(failure)) {
      latest.current = {receipt, failure};
      setVisited(latest.current);
    }
  }
  function move(direction: -1 | 1) {
    if (!navigable.length) return;
    const current = indexOf(latest.current);
    const next = current < 0 ? (direction === 1 ? 0 : navigable.length - 1) :
      (current + direction + navigable.length) % navigable.length;
    locate(navigable[next].failure, 'best');
  }
  return {entries, count: navigable.length, index, active: navigable[index]?.failure, locate, move,
    canLocate: !!onLocate || !!onLocatePosition, canLocatePosition: !!onLocatePosition};
}

/** 展示固定统计与有界错误，不把消息解释为HTML，也不触发查询或自动定位。 */
export function QueryContinueOnErrorNotice({ report, completedResults, navigation, positionLabel = sourceText.locatePositionFor }: {
  report: NonNullable<QueryOutcome['scriptReport']>; completedResults: number;
  navigation: ReturnType<typeof useQueryFailureNavigation>; positionLabel?(ordinal: number): string;
}) {
  const {entries, count, active, index, locate, move, canLocate, canLocatePosition} = navigation;
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
    {entries.length > 1 && canLocate && <div className="query-failure-navigation" role="group" aria-label={t.navigation}>
      <button disabled={!count} onClick={() => move(-1)}>{t.previous}</button>
      <button disabled={!count} onClick={() => move(1)}>{t.next}</button>
      <span className="muted small">{active ? t.located(active.statementOrdinal, index + 1, count) : t.navigable(count)}</span>
    </div>}
    {!!entries.length && <ol>{entries.map(({failure, statement, position}, index) => {
      return <li key={`${failure.statementOrdinal}:${index}`} aria-current={active === failure || undefined}>
        <strong>{t.error(failure.statementOrdinal)} · {failure.kind === 'server' ? t.server : t.terminal}</strong>
        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{bounded(failure.message)}</pre>
        <button disabled={!statement} title={statement ? t.locate(failure.statementOrdinal) : t.unavailable}
          onClick={() => locate(failure, 'statement')}>{t.locate(failure.statementOrdinal)}</button>
        {failure.errorRange && canLocatePosition && <button disabled={!position} onClick={() => locate(failure, 'position')}>
          {positionLabel(failure.statementOrdinal)}</button>}
      </li>;
    })}</ol>}
  </section>;
}
