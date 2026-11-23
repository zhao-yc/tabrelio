import { useLayoutEffect } from 'react';
import { editor, MarkerSeverity } from 'monaco-editor';
import type { QueryOutcome } from '../shared/contracts';
import { truncateQueryScriptMessage } from '../shared/queryContinueOnError';
import type { QueryFailureSourceLease } from './queryFailureSource';
import { queryFailureSourceZh as text } from './locales/queryFailureSource.zh-CN';

/** 每次执行独占一组 Monaco 标记。正文失效由原租约同步清理，语法检查和其他标签保留各自标记。 */
export function useQueryFailureMarkers(lease: QueryFailureSourceLease | undefined, outcome: QueryOutcome | null | undefined) {
  useLayoutEffect(() => {
    if (!lease || !outcome) return;
    const failures = outcome.scriptReport?.errors ?? (outcome.failure ? [outcome.failure] : []);
    return lease.markFailures(failures, (model, marks) => {
      const owner = 'dbark-query-failure:' + crypto.randomUUID();
      editor.setModelMarkers(model, owner, marks.map(({failure, range}) => ({...range, severity: MarkerSeverity.Error,
        source: text.markerSource, message: text.markerMessage(failure.statementOrdinal, truncateQueryScriptMessage(failure.message, 2048, 2048))})));
      return () => { if (!model.isDisposed()) editor.setModelMarkers(model, owner, []); };
    });
  }, [lease, outcome]);
}
