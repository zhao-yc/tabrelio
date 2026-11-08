import { useLayoutEffect, useRef, useState } from 'react';
import type { QueryOutcome } from '../../shared/contracts';
import { errorMessage } from '../lib';
import { viewQueryInspectZh as text } from '../locales/viewQueryInspect.zh-CN';
import { ExplainPlanView } from './ExplainPlanView';
import { ResultsGrid } from './ResultsGrid';
import { SqliteExplainPlanView } from './SqliteExplainPlanView';
import { ErrorBox, Spinner } from './ui';
import '../viewQueryInspect.css';

/** 结果只归属发起时的定义。编辑、切换连接或离开面板后不发布迟到响应。 */
export function ViewQueryInspect({ read, hint, owner, disabled, current }: {
  read(mode: 'rows' | 'explain'): Promise<QueryOutcome>;
  hint: string;
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

  async function inspect(mode: 'rows' | 'explain') {
    const lease = lifetime.current;
    if (!lease || pending.current || disabled || !current()) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setOutcome(undefined);
    const live = () => lifetime.current === lease && current();
    try {
      const result = await read(mode);
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
    <p className="muted">{hint}</p>
    <div className="pg-column-edit-actions">
      <button type="button" disabled={disabled || busy} onClick={() => void inspect('rows')}>{text.rows}</button>
      <button type="button" disabled={disabled || busy} onClick={() => void inspect('explain')}>{text.explain}</button>
      {busy && <Spinner text={text.working}/>}
    </div>
    <ErrorBox message={error}/>
    {outcome?.explain ? <ExplainPlanView outcome={outcome} busy={false}/> :
      outcome?.sqliteExplain ? <SqliteExplainPlanView outcome={outcome} busy={false} isCurrent={current}/> : result && <>
      <p role="status">{result.truncated ? text.truncated(result.rows.length) : text.count(result.rows.length)}</p>
      {result.columns.length > 0 && <div className="view-query-sample-grid">
        <ResultsGrid columns={result.columns} rows={result.rows} binaryFileActions={false}/>
      </div>}
    </>}
  </section>;
}
