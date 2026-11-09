import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ColumnInfo, RowChange, SqlPreview } from '../../shared/contracts';
import type { MysqlSearchEditRecord } from '../../shared/dataSearchRecords';
import type { MysqlQueryRecordEditInput } from '../../shared/mysqlQueryRelation';
import { collectChanges, type DraftRow } from '../dataChanges';
import { isBinaryCell } from '../binaryCell';
import { errorMessage, invoke, ownCell, uid } from '../lib';
import { dataSearchRecordsZh as text } from '../locales/dataSearchRecords.zh-CN';
import { mysqlQueryRecordEditZh as queryText } from '../locales/mysqlQueryRecordEdit.zh-CN';
import { recordViewZh as recordText } from '../locales/recordViews.zh-CN';
import {
  beginRecordDraft, editRecordInput, initialRecordInput, recordFieldTooLarge, recordInputDirty, recordReadonlyReason,
  recordValueSummary, stageRecordDraft, type RecordContext, type RecordDraft, type RecordInput,
} from '../recordViews';
import { useWorkspace } from '../store';
import { RecordValueEditor } from './RecordValueEditor';
import { ErrorBox, Modal, Spinner } from './ui';
import { useQueryInlineCellPosition, type QueryInlineCellAnchor } from '../queryInlineCellAnchor';

interface BaseProps {
  connectionId: string;
  focusColumn?: string;
  onDirty(value: boolean): void;
  onDone(committed: boolean): void;
}
type Props = BaseProps & ({ database: string; table: string; recordRef: string; queryRecord?: never; isCurrent?: never; cell?: never; visible?: never; joined?: never } |
  { database?: never; table?: never; recordRef?: never; queryRecord: MysqlQueryRecordEditInput; isCurrent(): boolean;
    cell?: QueryInlineCellAnchor & { label: string; typed?: string }; visible?: boolean; joined?: boolean });

/** 独立表单复用普通表页的字段输入和草稿校验，提交继续走原事务回执。 */
export function MysqlSearchRecordEditDialog({ connectionId, database, table, recordRef, queryRecord, isCurrent, focusColumn, onDirty, onDone, cell, visible = true, joined }: Props) {
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
  const panel = useRef<HTMLFormElement>(null), cancelInline = useRef<HTMLButtonElement>(null), composing = useRef(false);
  useQueryInlineCellPosition(panel, cell, visible && !preview);
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
        if (cell && (!editable || writable?.length !== 1 || isBinaryCell(ownCell(record.row, name.name), name.type)))
          throw Error(queryText.inlineUnavailable);
        const initial = editable ? initialRecordInput(input, name) : undefined;
        const typed = cell?.typed;
        const mode = initial?.mode === 'null' ? (/json/i.test(name?.type ?? '') ? 'json' : 'text') : initial?.mode;
        const next = editable && initial && mode ? editRecordInput(input, name, typed === undefined ? initial : { mode, text: typed }) : input;
        setData(record); setRow(original); setField(name?.name);
        setDraft(next);
        callbacks.current.onDirty(true);
      } catch (reason) { if (active) setError(errorMessage(reason)); }
      finally { reading = false; if (active) { pending.current = false; setBusy(false); } }
    })();
    return () => {
      active = false; live.current = false;
      if (reading) void invoke('query.cancel', { taskId }).catch(reason => notify(errorMessage(reason), true));
      callbacks.current.onDirty(false);
    };
  }, [connectionId, database, table, recordRef, queryRecord, cell]);
  const inlineReady = !!draft;
  useEffect(() => {
    if (cell && visible && !preview && !inlineReady) cancelInline.current?.focus({ preventScroll: true });
    composing.current = false;
  }, [cell, visible, preview, inlineReady]);

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
      if (cell && !cell.findAnchor()?.getClientRects().length) throw Error(labels.stale);
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

  function updateField(column: ColumnInfo, next: RecordInput) {
    if (!draft) return;
    try { setDraft(editRecordInput(draft, column, next)); setError(''); }
    catch (failure) { setError(errorMessage(failure)); }
  }

  if (cell && !preview) {
    const column = data?.info.columns.find(item => item.name === field);
    const input = column && draft?.fields.get(column.name);
    const dirty = recordInputDirty(draft ?? null, context.info);
    const cancel = () => { if (!pending.current || !data) callbacks.current.onDone(false); };
    return createPortal(<form ref={panel} className="query-inline-cell" hidden={!visible} role="region" aria-label={queryText.inlineLabel(cell.label)}
      onSubmit={event => { event.preventDefault(); if (!composing.current && dirty) stage(); }}
      onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
      onKeyDown={event => {
        if (event.defaultPrevented || event.nativeEvent.isComposing || event.keyCode === 229 || composing.current || event.repeat) return;
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); }
        if (event.key === 'Enter' && event.target instanceof HTMLTextAreaElement && !event.shiftKey && !event.altKey) {
          event.preventDefault(); event.stopPropagation(); if (dirty) stage();
        }
      }}>
      <strong title={column?.name}>{cell.label}</strong>
      {busy && <Spinner text={text.reading}/>}
      {column && input && row && <RecordValueEditor column={column} input={input} inserted={false} reason={busy ? recordText.busy : ''}
        focus={visible} selectOnFocus={cell.typed === undefined} source={[row, column]} isCurrent={current} onChange={next => updateField(column, next)}/>}
      <ErrorBox message={error}/>
      <div className="query-inline-actions">
        <button ref={cancelInline} type="button" disabled={busy && !!data} onClick={cancel}>{queryText.inlineCancel}</button>
        <button type="submit" disabled={busy || !dirty} className="primary">{queryText.preview}</button>
      </div>
    </form>, document.body);
  }

  return <Modal title={preview ? labels.preview : joined ? queryText.editJoin : labels.edit} onClose={close} wide>
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
              onChange={next => updateField(column, next)}/>
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
