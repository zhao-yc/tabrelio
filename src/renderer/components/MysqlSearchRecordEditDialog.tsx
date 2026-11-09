import { useEffect, useRef, useState } from 'react';
import type { RowChange, SqlPreview } from '../../shared/contracts';
import type { MysqlSearchEditRecord } from '../../shared/dataSearchRecords';
import type { MysqlQueryRelationInput } from '../../shared/mysqlQueryRelation';
import { collectChanges, type DraftRow } from '../dataChanges';
import { errorMessage, invoke, ownCell, uid } from '../lib';
import { dataSearchRecordsZh as text } from '../locales/dataSearchRecords.zh-CN';
import { mysqlQueryRecordEditZh as queryText } from '../locales/mysqlQueryRecordEdit.zh-CN';
import { recordViewZh as recordText } from '../locales/recordViews.zh-CN';
import {
  beginRecordDraft, editRecordInput, recordFieldTooLarge, recordInputDirty, recordReadonlyReason,
  recordValueSummary, stageRecordDraft, type RecordContext, type RecordDraft,
} from '../recordViews';
import { useWorkspace } from '../store';
import { RecordValueEditor } from './RecordValueEditor';
import { ErrorBox, Modal, Spinner } from './ui';

interface BaseProps {
  connectionId: string;
  focusColumn?: string;
  onDirty(value: boolean): void;
  onDone(committed: boolean): void;
}
type Props = BaseProps & ({ database: string; table: string; recordRef: string; queryRecord?: never; isCurrent?: never } |
  { database?: never; table?: never; recordRef?: never; queryRecord: MysqlQueryRelationInput; isCurrent(): boolean });

/** 独立表单复用普通表页的字段输入和草稿校验，提交继续走原事务回执。 */
export function MysqlSearchRecordEditDialog({ connectionId, database, table, recordRef, queryRecord, isCurrent, focusColumn, onDirty, onDone }: Props) {
  const labels = queryRecord ? queryText : { edit: text.edit, hint: text.mysqlEditHint, stale: text.mysqlEditStale,
    preview: text.mysqlPreview, confirm: text.mysqlConfirm, apply: text.mysqlApply, back: text.editBack, discard: text.editDiscard };
  const [version] = useState(() => useWorkspace.getState().connectionVersions[connectionId] ?? 0);
  const [data, setData] = useState<MysqlSearchEditRecord & { token?: string; writable?: string[] }>();
  const target = { connectionId, database: database ?? data?.info.database ?? '', table: table ?? data?.info.name ?? '' };
  const [row, setRow] = useState<DraftRow>(), [draft, setDraft] = useState<RecordDraft>();
  const [preview, setPreview] = useState<SqlPreview & { previewId: string }>(), [changes, setChanges] = useState<RowChange[]>();
  const [field, setField] = useState<string>(), [busy, setBusy] = useState(true), [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false), [frozen, setFrozen] = useState(false);
  const pending = useRef(true), live = useRef(false), callbacks = useRef({ onDirty, onDone, isCurrent });
  callbacks.current = { onDirty, onDone, isCurrent };
  const context: RecordContext = { target, generation: 0, connectionVersion: version, info: data?.info ?? null, loaded: !!data, stale: false, busy: false };
  const current = () => live.current && (useWorkspace.getState().connectionVersions[connectionId] ?? 0) === version &&
    callbacks.current.isCurrent?.() !== false;
  const notify = (message: string, failure = false) => useWorkspace.getState().notify(message, failure);

  useEffect(() => {
    let active = true, reading = false;
    const taskId = queryRecord?.taskId ?? uid();
    live.current = true;
    void (async () => {
      try {
        await Promise.resolve();
        if (!active) return;
        reading = true;
        const record: MysqlSearchEditRecord & { token?: string; writable?: string[] } =
          queryRecord ? await invoke('mysql.queryRecordEdit', queryRecord) :
          await invoke('search.recordEditRead', { connectionId, taskId, recordRef });
        if (!active) return;
        if (!current() || !queryRecord && (record.info.database !== database || record.info.name !== table)) throw Error(labels.stale);
        const original = { id: uid(), original: record.row, data: record.row, inserted: false, deleted: false };
        const context = { target: { connectionId, database: record.info.database, table: record.info.name }, generation: 0,
          connectionVersion: version, info: record.info, loaded: true, stale: false, busy: false };
        const writable = record.writable;
        const name = record.info.columns.find(column => column.name === focusColumn && (!writable || writable.includes(column.name))) ??
          record.info.columns.find(column => !writable || writable.includes(column.name));
        const input = beginRecordDraft(original, context);
        const editable = name && !recordReadonlyReason(context, original, name.name) && !recordFieldTooLarge(ownCell(record.row, name.name));
        setData(record); setRow(original); setDraft(editable ? editRecordInput(input, name) : input); setField(name?.name);
        callbacks.current.onDirty(true);
      } catch (reason) { if (active) setError(errorMessage(reason)); }
      finally { reading = false; if (active) { pending.current = false; setBusy(false); } }
    })();
    return () => {
      active = false; live.current = false;
      if (reading) void invoke('query.cancel', { taskId }).catch(reason => notify(errorMessage(reason), true));
      callbacks.current.onDirty(false);
    };
  }, [connectionId, database, table, recordRef, queryRecord]);

  const source = () => {
    if (!queryRecord) return { searchRecordRef: recordRef };
    if (!data?.token) throw Error(labels.stale);
    return { queryRecord: { sessionId: queryRecord.sessionId, token: data.token } };
  };

  async function run(action: () => Promise<void>) {
    if (pending.current) return;
    if (!current()) { setError(labels.stale); return; }
    pending.current = true; setBusy(true); setError('');
    try { await action(); }
    catch (reason) { if (live.current) setError(errorMessage(reason)); }
    finally { pending.current = false; if (live.current) setBusy(false); }
  }

  function close() {
    if (pending.current || ((changes || recordInputDirty(draft ?? null, context.info)) && !window.confirm(labels.discard))) return;
    callbacks.current.onDone(false);
  }

  function stage() {
    if (!draft || !row) return;
    void run(async () => {
      const next = collectChanges(stageRecordDraft([row], draft, context));
      if (next.length !== 1 || next[0].kind !== 'update') throw Error(text.mysqlNoChange);
      const plan = await invoke('table.preview', { ...target, changes: next, ...source() });
      if (!current() || !plan.previewId) throw Error(labels.stale);
      setChanges(next); setPreview({ ...plan, previewId: plan.previewId }); setConfirmed(false);
    });
  }

  function apply() {
    if (!preview || !changes || !confirmed || frozen) return;
    void run(async () => {
      try {
        const result = await invoke('table.apply', { ...target, changes, previewId: preview.previewId, taskId: uid(), ...source() });
        notify(queryRecord ? queryText.committed : text.mysqlCommitted(result.affectedRows), result.receiptSaved === false);
        if (live.current) callbacks.current.onDone(true);
      } catch (reason) {
        if (live.current) { setFrozen(true); setConfirmed(false); throw reason; }
        notify(errorMessage(reason), true);
      }
    });
  }

  return <Modal title={preview ? labels.preview : labels.edit} onClose={close} wide>
    <div className="modal-content pg-table-preview">
      <p>{labels.hint}</p>
      {busy && <Spinner text={text.reading}/>}
      <ErrorBox message={error}/>
      {preview ? <><pre>{preview.sql}</pre><label>
        <input type="checkbox" checked={confirmed} disabled={busy || frozen} onChange={event => setConfirmed(event.target.checked)}/>
        {labels.confirm}
      </label></> : data && row && draft && <div className="record-fields">
        {data.info.columns.map(column => {
          const value = ownCell(row.data, column.name), input = draft.fields.get(column.name);
          const reason = recordReadonlyReason(context, row, column.name) ||
            (data.writable && !data.writable.includes(column.name) ? queryText.readOnly : '') ||
            (recordFieldTooLarge(value) ? recordText.fieldTooLarge : '');
          return <section className="record-field" key={column.name} aria-label={column.name}>
            <h3>{column.name}<small>{column.type}</small></h3>
            <p>{recordValueSummary(value)}</p>
            {reason ? <p>{reason}</p> : field === column.name && input ? <RecordValueEditor column={column} input={input} inserted={false}
              reason={busy ? recordText.busy : ''} focus source={[row, column]} isCurrent={current}
              onChange={next => { try { setDraft(editRecordInput(draft, column, next)); setError(''); } catch (failure) { setError(errorMessage(failure)); } }}/>
              : <button disabled={busy} onClick={() => {
                try { setDraft(editRecordInput(draft, column)); setField(column.name); setError(''); }
                catch (failure) { setError(errorMessage(failure)); }
              }}>{recordText.editField}</button>}
          </section>;
        })}
      </div>}
    </div>
    <footer className="modal-footer">
      <button disabled={busy} onClick={close}>{labels.back}</button>
      {draft && !preview && <button className="primary" disabled={busy || !recordInputDirty(draft, context.info)} onClick={stage}>{labels.preview}</button>}
      {preview && !frozen && <button disabled={busy} onClick={() => { setPreview(undefined); setChanges(undefined); }}>{recordText.editField}</button>}
      {preview && <button className="primary" disabled={busy || frozen || !confirmed} onClick={apply}>{labels.apply}</button>}
    </footer>
  </Modal>;
}
