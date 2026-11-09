import { useEffect, useRef, useState } from 'react';
import type { RowChange, SqlPreview } from '../../shared/contracts';
import type { MysqlQueryBatchEditInput } from '../../shared/mysqlQueryRelation';
import { cellPreview, errorMessage, invoke, uid } from '../lib';
import { mysqlQueryBatchEditZh as text } from '../locales/mysqlQueryBatchEdit.zh-CN';
import { mysqlQueryBatchChanges, type MysqlQueryBatchInput } from '../mysqlQueryBatchEdit';
import { useWorkspace } from '../store';
import { ErrorBox, Modal, Spinner } from './ui';
import '../tableGrid.css';

interface Props {
  request: MysqlQueryBatchEditInput;
  operation: MysqlQueryBatchInput;
  firstRow: number;
  isCurrent(): boolean;
  onDone(committed: boolean): void;
}

type Target = { connectionId: string; database: string; table: string; queryRecord: { sessionId: string; token: string } };
type Change = Extract<RowChange, { kind: 'update' }>;
type Preview = { target: Target; changes: RowChange[]; plan: SqlPreview & { previewId: string }; rows: { change: Change; position: number }[] };

/** 单次预览绑定原执行和完整变更，提交失败保留差异及回执，禁止重放。 */
export function MysqlQueryBatchEditDialog({ request, operation, firstRow, isCurrent, onDone }: Props) {
  const [preview, setPreview] = useState<Preview>(), [error, setError] = useState('');
  const [busy, setBusy] = useState(true), [confirmed, setConfirmed] = useState(false), [attempted, setAttempted] = useState(false);
  const live = useRef(false), pending = useRef(true), submitted = useRef(false);
  const callbacks = useRef({ isCurrent, onDone });
  callbacks.current = { isCurrent, onDone };

  useEffect(() => {
    let active = true, reading = false;
    live.current = true;
    void (async () => {
      try {
        await Promise.resolve();
        if (!active) return;
        reading = true;
        const record = await invoke('mysql.queryBatchEdit', request);
        reading = false;
        if (!active) return;
        if (!callbacks.current.isCurrent()) throw Error(text.stale);
        const changes = mysqlQueryBatchChanges(record.info, record.rows, record.columns, operation);
        const target = { connectionId: request.connectionId, database: record.info.database, table: record.info.name,
          queryRecord: { sessionId: request.sessionId, token: record.token } };
        const plan = await invoke('table.preview', { ...target, changes });
        if (!active) return;
        if (!callbacks.current.isCurrent() || !plan.previewId) throw Error(text.stale);
        const positions = new Map(record.rows.map((row, index) => [row, firstRow + index]));
        const rows = changes.flatMap(change => change.kind === 'update' ? [{ change, position: positions.get(change.before)! }] : []);
        setPreview({ target, changes, plan: { ...plan, previewId: plan.previewId }, rows });
      } catch (reason) { if (active) setError(errorMessage(reason)); }
      finally { reading = false; if (active) { pending.current = false; setBusy(false); } }
    })();
    return () => {
      active = false; live.current = false;
      if (reading) void invoke('query.cancel', { taskId: request.taskId }).catch(() => undefined);
    };
  }, [request, operation, firstRow]);

  function close() {
    if (!submitted.current || !pending.current) callbacks.current.onDone(false);
  }

  async function apply() {
    if (!preview || !confirmed || pending.current || submitted.current) return;
    if (!callbacks.current.isCurrent()) { setError(text.stale); return; }
    submitted.current = true; pending.current = true; setAttempted(true); setBusy(true); setError('');
    try {
      const result = await invoke('table.apply', { ...preview.target, changes: preview.changes, previewId: preview.plan.previewId, taskId: uid() });
      useWorkspace.getState().notify(text.committed(result.affectedRows), result.receiptSaved === false);
      if (live.current) callbacks.current.onDone(true);
    } catch (reason) {
      if (live.current) { setConfirmed(false); setError(errorMessage(reason)); }
      else useWorkspace.getState().notify(errorMessage(reason), true);
    } finally { pending.current = false; if (live.current) setBusy(false); }
  }

  const count = preview?.rows.reduce((total, { change }) => total + Object.keys(change.values).length, 0);
  return <Modal title={text[operation.kind]} onClose={close} wide>
    <div className="modal-content pg-table-preview">
      <p>{text.scope(request.rowIndices.length, request.columnIndices.length)}</p>
      {busy && <Spinner text={attempted ? text.applying : text.reading}/>}
      <ErrorBox message={error}/>
      {preview && <><p>{text.count(preview.rows.length, count!)}</p>
        <div className="page-replace-preview"><table><thead><tr>{[text.row, text.column, text.before, text.after].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
          <tbody>{preview.rows.flatMap(({ position, change }) => Object.entries(change.values).map(([column, value]) =>
            <tr key={JSON.stringify([position, column])}><td>{position}</td><td>{column}</td><td>{cellPreview(change.before[column])}</td><td>{cellPreview(value)}</td></tr>))}</tbody>
        </table></div>
        <details><summary>{text.sql}</summary><pre>{preview.plan.sql}</pre></details>
        <label><input type="checkbox" checked={confirmed} disabled={busy || attempted} onChange={event => setConfirmed(event.target.checked)}/>{text.confirm}</label></>}
    </div>
    <footer className="modal-footer">
      <button onClick={close} disabled={busy && attempted}>{text.cancel}</button>
      {preview && <button className="primary" disabled={busy || attempted || !confirmed} onClick={() => void apply()}>{text.apply}</button>}
    </footer>
  </Modal>;
}
