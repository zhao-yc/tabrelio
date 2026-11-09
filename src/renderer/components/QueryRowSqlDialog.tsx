import { useEffect, useRef, useState } from 'react';
import type { QueryRowSqlInput, QueryRowSqlOutput } from '../../shared/queryRowSql';
import { quoteSqliteIdentifier } from '../../shared/sqliteReadSql';
import { writeTableClipboardEvent } from '../gridClipboard';
import { errorMessage, invoke, qualifiedName, uid } from '../lib';
import { queryRowSqlZh as text } from '../locales/queryRowSql.zh-CN';
import { useWorkspace } from '../store';
import { ErrorBox, Modal, Spinner } from './ui';

type Kind = QueryRowSqlInput['kind'];
type Prepared = QueryRowSqlOutput;
const kinds: Kind[] = ['select', 'insert', 'update', 'delete'];

/** 查询快照只在所属窗口展示。切换语句类型或关闭窗口时不保留迟到 SQL。 */
export function QueryRowSqlDialog({ command, request, keyed, isCurrent, onClose, onDraft }: {
  command: 'sqlite.queryRowSql' | 'mysql.queryRowSql';
  request: Omit<QueryRowSqlInput, 'kind' | 'taskId'>; keyed: boolean; isCurrent(): boolean;
  onClose(): void; onDraft(kind: Kind, prepared: Prepared): void;
}) {
  const [kind, setKind] = useState<Kind>(keyed ? 'select' : 'insert');
  const [prepared, setPrepared] = useState<Prepared>(), [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef<string | undefined>(undefined);
  useEffect(() => () => {
    const taskId = pending.current;
    pending.current = undefined;
    if (taskId) void invoke('query.cancel', { taskId }).catch(() => undefined);
  }, []);

  async function prepare() {
    if (pending.current || !isCurrent()) return;
    const taskId = uid();
    pending.current = taskId;
    setBusy(true); setPrepared(undefined); setError('');
    try {
      const next = await invoke(command, { ...request, kind, taskId });
      if (pending.current === taskId && isCurrent()) setPrepared(next);
    } catch (reason) {
      if (pending.current === taskId && isCurrent()) setError(errorMessage(reason));
    } finally {
      if (pending.current === taskId) { pending.current = undefined; setBusy(false); }
    }
  }
  function useSql(destination: 'clipboard' | 'draft') {
    if (!prepared || pending.current || !isCurrent()) { setError(text.stale); return; }
    try {
      if (destination === 'draft') onDraft(kind, prepared);
      else {
        writeTableClipboardEvent(isCurrent, data => data.setData('text/plain', prepared.sql));
        useWorkspace.getState().notify(text.copied);
      }
    } catch (reason) { setError(errorMessage(reason)); }
  }
  const target = prepared && (command === 'sqlite.queryRowSql'
    ? quoteSqliteIdentifier(prepared.database) + '.' + quoteSqliteIdentifier(prepared.table)
    : qualifiedName(prepared.database, prepared.table));
  return <Modal title={text.title} wide onClose={onClose}>
    <div className="modal-content">
      <p>{text.scope(request.rowIndices.length)}</p>
      <label>{text.kind} <select aria-label={text.kind} value={kind} disabled={busy} onChange={event => {
        setKind(event.target.value as Kind); setPrepared(undefined); setError('');
      }}>{kinds.filter(value => keyed || value === 'insert').map(value => <option key={value} value={value}>{text[value]}</option>)}</select></label>
      {busy && <Spinner text={text.reading}/>}
      <ErrorBox message={error}/>
      {prepared && <><p>{target}</p><pre className="result-sql-preview">{prepared.sql}</pre></>}
    </div>
    <footer className="modal-footer">
      <button onClick={onClose}>{text.close}</button><span className="grow"/>
      <button disabled={busy} onClick={() => void prepare()}>{text.prepare}</button>
      <button disabled={!prepared || busy} onClick={() => useSql('clipboard')}>{text.copy}</button>
      <button className="primary" disabled={!prepared || busy} onClick={() => useSql('draft')}>{text.draft}</button>
    </footer>
  </Modal>;
}
