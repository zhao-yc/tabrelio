import { useLayoutEffect, useRef, useState } from 'react';
import type { QueryOutcome } from '../../shared/contracts';
import type { PostgresCreateTableTarget } from '../../shared/postgresCreateTable';
import { postgresViewQuerySampleRows, type PostgresViewQueryInspectInput } from '../../shared/postgresCreateView';
import { errorMessage, invoke } from '../lib';
import { postgresViewQueryInspectZh as text } from '../locales/postgresViewQueryInspect.zh-CN';
import { ExplainPlanView } from './ExplainPlanView';
import { ResultsGrid } from './ResultsGrid';
import { ErrorBox, Spinner } from './ui';

/** 结果只归属发起时的定义。编辑、切换连接或离开面板后不发布迟到响应。 */
export function PostgresViewQueryInspect({ target, definition, owner, disabled, current }: {
  target: PostgresCreateTableTarget;
  definition: string;
  owner: object;
  disabled: boolean;
  current(): boolean;
}) {
  const lifetime = useRef<object | undefined>(undefined), pending = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [outcome, setOutcome] = useState<QueryOutcome>();
  useLayoutEffect(() => {
    const lease = {};
    lifetime.current = lease;
    setOutcome(undefined);
    setError('');
    return () => { if (lifetime.current === lease) lifetime.current = undefined; };
  }, [owner, disabled]);

  async function inspect(mode: PostgresViewQueryInspectInput['mode']) {
    const lease = lifetime.current;
    if (!lease || pending.current || disabled || !definition.trim() || !current()) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setOutcome(undefined);
    const live = () => lifetime.current === lease && current();
    try {
      const result = await invoke('postgres.createView.inspectQuery', {
        connectionId: target.connectionId, database: target.database, definition, mode,
      });
      if (live()) setOutcome(result);
    } catch (reason) {
      if (live()) setError(errorMessage(reason));
    } finally {
      pending.current = false;
      if (lifetime.current) setBusy(false);
    }
  }

  const result = outcome?.results[0];
  return <section aria-label={text.region} aria-busy={busy}>
    <p className="muted">{text.hint(postgresViewQuerySampleRows)}</p>
    <div className="pg-column-edit-actions">
      <button type="button" disabled={disabled || busy || !definition.trim()} onClick={() => void inspect('rows')}>{text.rows}</button>
      <button type="button" disabled={disabled || busy || !definition.trim()} onClick={() => void inspect('explain')}>{text.explain}</button>
      {busy && <Spinner text={text.working}/>}
    </div>
    <ErrorBox message={error}/>
    {outcome?.explain ? <ExplainPlanView outcome={outcome} busy={false}/> : result && <>
      <p role="status">{result.truncated ? text.truncated(result.rows.length) : text.count(result.rows.length)}</p>
      {result.columns.length > 0 && <div className="pg-view-sample-grid">
        <ResultsGrid key={definition} columns={result.columns} rows={result.rows} binaryFileActions={false}/>
      </div>}
    </>}
  </section>;
}
