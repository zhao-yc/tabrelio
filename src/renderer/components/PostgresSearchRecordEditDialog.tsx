import type { PostgresQueryRecordPageInput } from '../../shared/postgresQueryRecord';
import { postgresResultOriginsZh as queryText } from '../locales/postgresResultOrigins.zh-CN';
import { useEffect, useRef, useState } from 'react';
import { postgresTablePreviewSchema, type PostgresTableColumn, type PostgresTablePage, type PostgresTablePreview } from '../../shared/postgresTable';
import { errorMessage, invoke, ownCell, uid } from '../lib';
import { dataSearchRecordsZh as text } from '../locales/dataSearchRecords.zh-CN';
import { postgresTableZh as tableText } from '../locales/postgresTable.zh-CN';
import { postgresGridPasteZh as pasteText } from '../locales/postgresGridPaste.zh-CN';
import { postgresClipboardFieldValue } from '../postgresGridPaste';
import type { ClipboardCell } from '../gridClipboard';
import { useWorkspace } from '../store';
import { PostgresInlineCellEditor, type PostgresInlineCellValue } from './PostgresInlineCellEditor';
import { PostgresRecordForm, type PostgresEditableRecord } from './PostgresRecordFields';
import { ErrorBox, Modal, Spinner } from './ui';

interface BaseProps {
  connectionId: string;
  database: string;
  focusColumn?: string;
  onDirty(value: boolean): void;
  onDone(committed: boolean): void;
}

export type PostgresQueryRecordIntent = Pick<PostgresQueryRecordPageInput, 'sessionId' | 'executionId'> &
  ({ rowIndex: number } | { rowIndices: number[] });
type RecordUpdate = Extract<PostgresEditableRecord, { kind: 'update' }>;
export interface PostgresQueryCellEdit {
  columnIndex: number;
  anchor: HTMLElement;
  typed?: string;
}
export interface PostgresQueryPaste {
  columnIndices: number[];
  matrix: ClipboardCell[][];
  startRow: number;
}
type Props = BaseProps & ({ table: string; recordRef: string; queryRecord?: never; cell?: never; visible?: never; isCurrent?: never } |
  { table?: never; recordRef?: never; queryRecord: PostgresQueryRecordIntent; cell?: PostgresQueryCellEdit; paste?: PostgresQueryPaste;
    visible: boolean; isCurrent(): boolean });

/** 独立于工作台表页的单行编辑，迟到的快照与提交回执分别清理和报告。 */
export function PostgresSearchRecordEditDialog(props: Props) {
  const { connectionId, database, table: initialTable, recordRef, focusColumn, queryRecord, cell } = props;
  const paste = 'paste' in props ? props.paste : undefined;
  const [table, setTable] = useState(initialTable ?? '');
  const labels = queryRecord ? { title: queryText.edit, hint: queryText.editHint, stale: queryText.editStale, back: queryText.editBack, discard: queryText.editDiscard }
    : { title: text.edit, hint: text.postgresEditHint, stale: text.postgresEditStale, back: text.editBack, discard: text.editDiscard };
  const [tabId] = useState(uid);
  const target = { connectionId, database, table, tabId };
  const callbacks = useRef(props); callbacks.current = props;
  const [source] = useState(() => {
    const state = useWorkspace.getState();
    return { profile: state.connections.find(item => item.id === connectionId), version: state.connectionVersions[connectionId] ?? 0 };
  });
  const [page, setPage] = useState<PostgresTablePage & { pageToken: string }>();
  const [inline, setInline] = useState<{ column: PostgresTableColumn; raw: string | null }>();
  const [draft, setDraft] = useState<RecordUpdate[]>(), [preview, setPreview] = useState<PostgresTablePreview>();
  const [form, setForm] = useState(false), [busy, setBusy] = useState(true), [error, setError] = useState('');
  const [frozen, setFrozen] = useState(false), [confirmed, setConfirmed] = useState(false);
  const live = useRef(false), pending = useRef(true), token = useRef<{ pageToken: string; table: string } | undefined>(undefined);
  const notify = (message: string, failure = false) => useWorkspace.getState().notify(message, failure);

  function current() {
    const state = useWorkspace.getState();
    return live.current && callbacks.current.isCurrent?.() !== false && source.profile?.dialect === 'postgresql' && state.connections.includes(source.profile) &&
      (state.connectionVersions[connectionId] ?? 0) === source.version;
  }

  function release(snapshot: { pageToken: string; table: string }) {
    return invoke('postgres.table.release', { ...target, ...snapshot }).catch(reason => notify(errorMessage(reason), true));
  }

  useEffect(() => {
    let active = true;
    live.current = true;
    void (async () => {
      try {
        await Promise.resolve();
        if (!active) return;
        if (!current()) throw Error(labels.stale);
        const loaded = queryRecord
          ? await invoke('postgres.queryRecordPage', { connectionId, database, tabId, ...queryRecord })
          : { table: initialTable!, page: await invoke('postgres.table.page', { ...target, searchRecordRef: recordRef, limit: 1, offset: 0 }), columnKeys: [] };
        const result = loaded.page;
        if (result.pageToken && (!active || !current() || result.rows.length !== (paste?.matrix.length ?? 1) ||
            result.truncated || result.hasNext || !result.capabilities.update || result.capabilities.insert || result.capabilities.delete))
          await release({ pageToken: result.pageToken, table: loaded.table });
        else if (result.pageToken) {
          token.current = { pageToken: result.pageToken, table: loaded.table };
          if (paste) {
            const columns = paste.columnIndices.map(index => {
              const column = result.columns.find(item => item.key === loaded.columnKeys[index]);
              if (!column) throw Error(labels.stale);
              if (column.generated) throw Error(pasteText.generated(column.name));
              return column;
            });
            if (new Set(columns).size !== columns.length) throw Error(queryText.pasteDuplicateColumn);
            const changes: RecordUpdate[] = paste.matrix.map((values, row) => ({
              kind: 'update', row,
              fields: values.map((value, index) => ({
                column: columns[index].key, value: postgresClipboardFieldValue(value, columns[index]),
              })),
            }));
            const request = postgresTablePreviewSchema.parse({ ...target, table: loaded.table, pageToken: result.pageToken, changes });
            const next = await invoke('postgres.table.preview', request);
            if (!active || !current()) throw Error(labels.stale);
            setDraft(changes);
            setPreview(next);
          } else if (cell) {
            const key = loaded.columnKeys[cell.columnIndex];
            const column = result.columns.find(item => item.key === key);
            const raw = column && ownCell(result.rows[0], column.key);
            if (!column || column.generated || column.binary || (raw !== null && typeof raw !== 'string')) {
              void release(token.current);
              token.current = undefined;
              throw Error(queryText.cellReadOnly);
            }
            setInline({ column, raw });
          }
          setTable(loaded.table);
          setPage({ ...result, pageToken: result.pageToken });
          setForm(!paste);
          callbacks.current.onDirty(true);
          return;
        }
        throw Error(labels.stale);
      } catch (reason) {
        if (active && token.current) { void release(token.current); token.current = undefined; }
        if (active) setError(errorMessage(reason));
      } finally {
        if (active) { pending.current = false; setBusy(false); }
      }
    })();
    return () => {
      active = false; live.current = false;
      if (token.current) { void release(token.current); token.current = undefined; }
      callbacks.current.onDirty(false);
    };
  }, [connectionId, database, initialTable, recordRef, queryRecord, tabId, cell, paste]);

  async function run(action: () => Promise<void>) {
    if (pending.current) return;
    if (!current()) { setError(labels.stale); return; }
    pending.current = true; setBusy(true); setError('');
    try { await action(); }
    catch (reason) { if (live.current) setError(errorMessage(reason)); }
    finally { pending.current = false; if (live.current) setBusy(false); }
  }

  function close() {
    if (pending.current || ((draft || frozen) && !window.confirm(paste ? queryText.pasteDiscard : labels.discard))) return;
    callbacks.current.onDone(false);
  }

  function stage(change: PostgresEditableRecord) {
    if (!page || !current() || change.kind !== 'update') throw Error(labels.stale);
    const request = { ...target, pageToken: page.pageToken, changes: [change] };
    postgresTablePreviewSchema.parse(request);
    setDraft([change]); setForm(false); setPreview(undefined); setConfirmed(false);
    void run(async () => {
      const next = await invoke('postgres.table.preview', request);
      if (!current()) throw Error(labels.stale);
      setPreview(next);
    });
  }

  function apply() {
    if (!page || !preview || !confirmed || frozen) return;
    void run(async () => {
      try {
        const result = await invoke('postgres.table.apply', { ...target, pageToken: page.pageToken, previewToken: preview.previewToken });
        if (result.outcome === 'committed') {
          notify(result.message);
          if (live.current) callbacks.current.onDone(true);
          return;
        }
        if (live.current) {
          setConfirmed(false);
          if (!paste && result.outcome === 'rolledBack' && result.draftsRetained && current()) setPreview(undefined);
          else setFrozen(true);
          setError(result.outcome === 'unknown' ? tableText.unknown + ' ' + result.message : result.message);
        } else notify(result.message, true);
      } catch (reason) {
        if (live.current) { setFrozen(true); setConfirmed(false); throw Error(tableText.unknown + ' ' + errorMessage(reason)); }
        notify(tableText.unknown + ' ' + errorMessage(reason), true);
      }
    });
  }

  if (page && form && cell && inline) {
    const { column, raw } = inline;
    const saved = draft?.[0].fields[0]?.value;
    const initial: PostgresInlineCellValue = saved && saved.mode !== 'binary' ? saved : raw === null ? { mode: 'null' } : { mode: 'text', value: raw };
    return <PostgresInlineCellEditor anchor={cell.anchor} column={column} originalText={raw ?? ''} initial={initial}
      typed={draft ? undefined : cell.typed} visible={props.visible} onCancel={() => draft ? setForm(false) : close()}
      onStage={value => {
        if (!draft && (value.mode === 'null' && raw === null || value.mode === 'text' && value.value === raw)) { close(); return; }
        stage({ kind: 'update', row: 0, fields: [{ column: column.key, value }] });
      }}/>;
  }

  if (page && form) return <PostgresRecordForm page={page} row={0} initial={draft?.[0]} initialFocus={focusColumn}
    current={() => current() && !pending.current} onSave={stage} onClose={() => draft ? setForm(false) : close()}/>;

  return <Modal title={paste ? queryText.pasteTitle : draft ? tableText.preview : labels.title} onClose={close} wide>
    <div className="modal-content pg-table-preview">
      <p>{paste ? queryText.pasteHint : labels.hint}</p>
      {busy && <Spinner text={text.reading}/>}
      <ErrorBox message={error}/>
      {page && draft?.map((change, index) => <div key={change.row}>
        {paste && <strong>{queryText.pasteRow(paste.startRow + index + 1)}</strong>}
        <dl>{change.fields.map(field => <div key={field.column}>
          <dt>{page.columns.find(column => column.key === field.column)?.name}</dt>
          <dd>{'value' in field.value ? field.value.value : field.value.mode.toUpperCase()}</dd>
        </div>)}</dl>
      </div>)}
      {preview && <><pre>{preview.statements.join(';\n')}</pre><label>
        <input type="checkbox" checked={confirmed} disabled={busy || frozen} onChange={event => setConfirmed(event.target.checked)}/>
        {paste ? queryText.pasteConfirm(preview.counts.update) : text.postgresConfirm}
      </label></>}
    </div>
    <footer className="modal-footer">
      <button disabled={busy} onClick={close}>{labels.back}</button>
      {draft && !paste && !frozen && <button disabled={busy} onClick={() => { setConfirmed(false); setForm(true); }}>{tableText.edit}</button>}
      {preview && <button className="primary" disabled={busy || frozen || !confirmed} onClick={apply}>{tableText.apply}</button>}
    </footer>
  </Modal>;
}
