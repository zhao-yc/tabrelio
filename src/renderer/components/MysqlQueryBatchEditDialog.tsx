import { useEffect, useRef, useState } from 'react';
import type { CommandMap, RowChange, SqlPreview } from '../../shared/contracts';
import { mysqlQueryBatchLimits, type MysqlQueryBatchEditInput, type MysqlQueryRecordRef } from '../../shared/mysqlQueryRelation';
import { cellPreview, cellText, errorMessage, invoke, qualifiedName, uid } from '../lib';
import { collectChanges, type DraftRow } from '../dataChanges';
import { gridRangeFillZh } from '../locales/gridRangeFill.zh-CN';
import { mysqlQueryBatchEditZh as text } from '../locales/mysqlQueryBatchEdit.zh-CN';
import { mysqlQueryBatchChanges, type MysqlQueryBatchInput } from '../mysqlQueryBatchEdit';
import { useWorkspace } from '../store';
import { MysqlQueryInsertDraftEditor, prepareMysqlQueryInsert } from './MysqlQueryInsertDraftEditor';
import { ErrorBox, Modal, Spinner } from './ui';
import '../tableGrid.css';

interface Props {
  request: MysqlQueryBatchEditInput;
  operation: MysqlQueryBatchInput;
  displayRows: number[];
  isCurrent(): boolean;
  onDone(committed: boolean): void;
}

type Target = { connectionId: string; database: string; table: string; queryRecord: MysqlQueryRecordRef };
type Preview = { target: Target; changes: RowChange[]; plan: SqlPreview & { previewId: string };
  primaryKey: string[]; rows: { change: RowChange; position: number }[] };
type BatchRecord = CommandMap['mysql.queryBatchEdit']['output'];

/** 单次预览绑定原执行和完整变更，提交失败保留差异及回执，禁止重放。 */
export function MysqlQueryBatchEditDialog({ request, operation, displayRows, isCurrent, onDone }: Props) {
  const [preview, setPreview] = useState<Preview>(), [error, setError] = useState('');
  const [insert, setInsert] = useState<{ record: BatchRecord; draft: ReturnType<typeof prepareMysqlQueryInsert> }>();
  const [busy, setBusy] = useState(true), [confirmed, setConfirmed] = useState(false), [attempted, setAttempted] = useState(false);
  const live = useRef(false), pending = useRef(true), submitted = useRef(false);
  const callbacks = useRef({ isCurrent, onDone });
  callbacks.current = { isCurrent, onDone };
  const deleting = operation.kind === 'delete';
  const copying = operation.kind === 'insert';
  const creating = operation.kind === 'new', inserting = copying || creating;

  async function makePreview(record: BatchRecord, changes: RowChange[]): Promise<Preview> {
    const target: Target = { connectionId: request.connectionId, database: record.info.database, table: record.info.name,
      queryRecord: { sessionId: request.sessionId, token: record.token, ...('operation' in request ? { operation: request.operation } : {}) } };
    const plan = await invoke('table.preview', { ...target, changes });
    if (!callbacks.current.isCurrent() || !plan.previewId) throw Error(text.stale);
    const positions = new Map(record.rows.map((row, index) => [row, displayRows[index]]));
    const rows = changes.map((change, index) => ({ change, position: change.kind === 'insert' ? displayRows[index] : positions.get(change.before)! }));
    return { target, changes, plan: { ...plan, previewId: plan.previewId }, rows, primaryKey: record.info.primaryKey };
  }

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
        if (operation.kind === 'insert' || operation.kind === 'new') {
          setInsert({ record, draft: prepareMysqlQueryInsert(record, request.connectionId, operation.kind === 'new') });
          return;
        }
        const changes = mysqlQueryBatchChanges(record.info, record.rows, record.columns, operation);
        const next = await makePreview(record, changes);
        if (active) setPreview(next);
      } catch (reason) { if (active) setError(errorMessage(reason)); }
      finally { reading = false; if (active) { pending.current = false; setBusy(false); } }
    })();
    return () => {
      active = false; live.current = false;
      if (reading) void invoke('query.cancel', { taskId: request.taskId }).catch(() => undefined);
    };
  }, [request, operation, displayRows]);

  function close() {
    if (!submitted.current || !pending.current) callbacks.current.onDone(false);
  }

  /** 同一份副本草稿可返回修改，预览成功后才替换当前显示的待提交计划。 */
  async function previewInsert(rows: DraftRow[]) {
    if (!insert || pending.current || !callbacks.current.isCurrent()) return;
    pending.current = true; setBusy(true); setError('');
    try {
      const fields = rows.reduce((count, row) => count + Object.keys(row.data).length, 0);
      if (fields > mysqlQueryBatchLimits.cells) throw Error(gridRangeFillZh.limit);
      const next = await makePreview(insert.record, collectChanges(rows));
      if (live.current) { setInsert({ ...insert, draft: { ...insert.draft, rows } }); setPreview(next); }
    } catch (reason) { if (live.current) setError(errorMessage(reason)); }
    finally { pending.current = false; if (live.current) setBusy(false); }
  }

  async function apply() {
    if (!preview || !confirmed || pending.current || submitted.current) return;
    if (!callbacks.current.isCurrent()) { setError(text.stale); return; }
    submitted.current = true; pending.current = true; setAttempted(true); setBusy(true); setError('');
    try {
      const result = await invoke('table.apply', { ...preview.target, changes: preview.changes, previewId: preview.plan.previewId, taskId: uid() });
      const message = creating ? text.created : (deleting ? text.deleted : copying ? text.copied : text.committed)(result.affectedRows);
      useWorkspace.getState().notify(message, result.receiptSaved === false);
      if (live.current) callbacks.current.onDone(true);
    } catch (reason) {
      if (live.current) { setConfirmed(false); setError(errorMessage(reason)); }
      else useWorkspace.getState().notify(errorMessage(reason), true);
    } finally { pending.current = false; if (live.current) setBusy(false); }
  }

  const count = preview?.rows.reduce((total, { change }) => total + (change.kind === 'update' ? Object.keys(change.values).length : 0), 0);
  const table = preview && qualifiedName(preview.target.database, preview.target.table);
  return <Modal title={inserting && preview ? (creating ? text.newPreview : text.copyPreview) : text[operation.kind]} onClose={close} wide>
    <div className="modal-content pg-table-preview">
      {'columnIndices' in request && <p>{text.scope(request.rowIndices.length, request.columnIndices.length)}</p>}
      {busy && <Spinner text={attempted ? text.applying : text.reading}/>}
      <ErrorBox message={error}/>
      {insert && !preview && <MysqlQueryInsertDraftEditor draft={insert.draft} displayRows={displayRows} creating={creating} busy={busy} isCurrent={isCurrent} onPreview={rows => void previewInsert(rows)}/>}
      {preview && <><p>{deleting ? text.deleteCount(preview.rows.length, table!) : inserting ? text.copyCount(preview.rows.length, table!) : text.count(preview.rows.length, count!)}</p>
        {deleting && <p>{text.deleteEffects}</p>}
        <div className="page-replace-preview"><table><thead><tr>{[text.row, ...(deleting ? preview.primaryKey : inserting ? [text.column, text.after] : [text.column, text.before, text.after])].map((label, index) => <th scope="col" key={index}>{label}</th>)}</tr></thead>
          <tbody>{preview.rows.flatMap(({ position, change }) => {
            if (change.kind === 'delete') return [<tr key={position}><td>{position}</td>{preview.primaryKey.map(column => <td key={column}><pre>{cellText(change.before[column])}</pre></td>)}</tr>];
            const values = Object.entries(change.values);
            if (!values.length) return [<tr key={position}><td>{position}</td><td colSpan={2}>{text.copyOmitted}</td></tr>];
            return values.map(([column, value]) => <tr key={JSON.stringify([position, column])}><td>{position}</td><td>{column}</td>
              {change.kind === 'update' && <td>{cellPreview(change.before[column])}</td>}<td>{cellPreview(value)}</td></tr>);
          })}</tbody>
        </table></div>
        <details><summary>{text.sql}</summary><pre>{preview.plan.sql}</pre></details>
        <label><input type="checkbox" checked={confirmed} disabled={busy || attempted} onChange={event => setConfirmed(event.target.checked)}/>{deleting ? text.deleteConfirm : creating ? text.newConfirm : copying ? text.copyConfirm : text.confirm}</label></>}
    </div>
    <footer className="modal-footer">
      <button onClick={close} disabled={busy && attempted}>{text.cancel}</button>
      {inserting && preview && !attempted && <button onClick={() => { setPreview(undefined); setConfirmed(false); }}>{creating ? text.newBack : text.copyBack}</button>}
      {preview && <button className={deleting ? 'danger' : 'primary'} disabled={busy || attempted || !confirmed} onClick={() => void apply()}>{deleting ? text.deleteApply : creating ? text.newApply : copying ? text.copyApply : text.apply}</button>}
    </footer>
  </Modal>;
}
