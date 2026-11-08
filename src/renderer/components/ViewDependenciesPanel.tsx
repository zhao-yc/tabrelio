import { useLayoutEffect, useRef, useState } from 'react';
import type { ViewDependencies, ViewDependency } from '../../shared/viewDependencies';
import { errorMessage } from '../lib';
import { viewDependenciesZh as text } from '../locales/viewDependencies.zh-CN';
import { ErrorBox, Spinner } from './ui';

function DependenciesTable({ title, rows, unknown = false }: { title: string; rows: ViewDependency[]; unknown?: boolean }) {
  return <section aria-label={title}>
    <h3>{title}</h3>
    {rows.length ? <table className="design-table">
      <thead><tr><th>{text.database}</th><th>{text.name}</th></tr></thead>
      <tbody>{rows.map(row => <tr key={JSON.stringify([row.database, row.name])}><td>{row.database}</td><td>{row.name}</td></tr>)}</tbody>
    </table> : <p>{unknown ? text.referencedUnknown : text.empty}</p>}
  </section>;
}

/** 结果仅绑定已保存对象的原窗口和连接，草稿编辑不改变依赖来源。 */
export function ViewDependenciesPanel({ owner, current, disabled, load }: {
  owner: object; current(): boolean; disabled: boolean; load(): Promise<ViewDependencies>;
}) {
  const active = useRef<object | undefined>(undefined), pending = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [data, setData] = useState<ViewDependencies>();
  useLayoutEffect(() => {
    const lease = {};
    active.current = lease;
    setData(undefined);
    setError('');
    return () => { if (active.current === lease) active.current = undefined; };
  }, [owner, disabled]);

  async function read() {
    const lease = active.current;
    if (!lease || disabled || pending.current || !current()) return;
    const live = () => active.current === lease && current();
    pending.current = true;
    setBusy(true);
    setError('');
    setData(undefined);
    try {
      const result = await load();
      if (live()) setData(result);
    } catch (reason) {
      if (live()) setError(errorMessage(reason));
    } finally {
      pending.current = false;
      if (active.current) setBusy(false);
    }
  }

  return <section aria-label={text.title} aria-busy={busy}>
    <p className="muted">{text.hint}</p>
    <button type="button" disabled={busy || disabled} onClick={() => void read()}>{text.read}</button>
    {busy && <Spinner text={text.working}/>}
    <ErrorBox message={error}/>
    {data && <>
      <p>{data.source === 'catalogue' ? text.catalogue : text.definitions}</p>
      {data.skipped > 0 && <p className="warning-text">{text.skipped(data.skipped)}</p>}
      {data.truncated && <p className="warning-text">{text.truncated}</p>}
      <DependenciesTable title={text.referenced} rows={data.referenced} unknown={data.referencedUnknown}/>
      <DependenciesTable title={text.referencing} rows={data.referencing}/>
    </>}
  </section>;
}
