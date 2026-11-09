import { useEffect, useRef, useState } from 'react';
import { invoke, errorMessage, uid } from '../lib';
import { useWorkspace } from '../store';
import { SqliteTableEditor, type SqliteEditView } from '../sqliteTableEditor';
import { sqliteResultOriginsZh as queryText } from '../locales/sqliteResultOrigins.zh-CN';
import { dataSearchRecordsZh as text } from '../locales/dataSearchRecords.zh-CN';
import { SqliteTablePreviewDialog, SqliteTableValueDialog } from './SqliteTableEditDialog';
import type { SqliteOriginalValue } from '../../shared/sqliteTableEdit';
import { SqliteQueryInlineCellEditor, type SqliteQueryInlineCell } from './SqliteQueryInlineCellEditor';
import { ErrorBox, Modal, Spinner } from './ui';

interface BaseProps {
  connectionId: string;
  table: string;
  focusColumn?: string;
  onDirty(value: boolean): void;
  onDone(committed: boolean): void;
}

type QueryRecord = NonNullable<import('../../shared/sqliteTableBrowse').SqliteTablePageInput['queryRecord']>;
type Props = BaseProps & ({ recordRef: string; queryRecord?: never; isCurrent?: never } |
  { recordRef?: never; queryRecord: QueryRecord; isCurrent(): boolean; cell?: SqliteQueryInlineCell; visible?: boolean });

/** 只编辑已核验的原行，沿用表页签发的编辑快照和原有预览提交链。 */
export function SqliteSearchRecordEditDialog(props: Props) {
  const { connectionId, table, recordRef, queryRecord, focusColumn } = props;
  const cell = props.queryRecord ? props.cell : undefined;
  const typedConsumed = useRef(false);
  const labels = queryRecord ? { title: queryText.editRecord, hint: queryText.editHint, discard: queryText.editDiscard, back: queryText.editBack, stale: queryText.editStale }
    : { title: text.edit, hint: text.editHint, discard: text.editDiscard, back: text.editBack, stale: text.editStale };
  const callbacks = useRef(props); callbacks.current = props;
  const editor = useRef<SqliteTableEditor | undefined>(undefined);
  const [view, setView] = useState<SqliteEditView>(), [error, setError] = useState('');
  const [loading, setLoading] = useState(true), [closing, setClosing] = useState(false);
  const [preview, setPreview] = useState(false);
  const saved = useRef(false), closingRef = useRef(false), closeWork = useRef<Promise<void> | undefined>(undefined);
  const load = useRef<{ id: string; sent: boolean; pending: boolean; done: Promise<void> } | undefined>(undefined);
  const ticket = useRef({}).current;
  const report = (reason: unknown) => useWorkspace.getState().notify(errorMessage(reason), true);

  useEffect(() => {
    const start = useWorkspace.getState(), profile = start.connections.find(item => item.id === connectionId);
    const version = start.connectionVersions[connectionId] ?? 0;
    let live = true, invalid = false, busy: object | undefined;
    const read = { id: uid(), sent: false, pending: true, done: Promise.resolve() };
    load.current = read;
    const current = () => {
      const state = useWorkspace.getState();
      if (!profile || profile.dialect !== 'sqlite' || profile.sqlite.readOnly ||
          callbacks.current.isCurrent?.() === false || !state.connections.includes(profile) || (state.connectionVersions[connectionId] ?? 0) !== version) invalid = true;
      return live && !invalid && !closingRef.current;
    };
    const unsubscribe = useWorkspace.subscribe(() => { current(); editor.current?.observe(); });
    read.done = (async () => {
      try {
        await Promise.resolve();
        if (!live || closingRef.current) return;
        if (!current()) throw Error(labels.stale);
        read.sent = true;
        const page = await invoke('sqlite.tablePage', {
          connectionId, database: 'main', table, taskId: read.id, ...(queryRecord ? { queryRecord } : { searchRecordRef: recordRef }), editing: true,
          offset: 0, limit: 1, mode: 'and', filters: [], sort: [],
        });
        if (page.edit?.kind !== 'editable') throw Error(page.edit?.reason ?? labels.stale);
        const release = () => invoke('sqlite.tableEdit.release', { snapshotId: page.edit?.kind === 'editable' ? page.edit.snapshotId : undefined });
        let accepted = false;
        try {
          if (!current() || page.target.connectionId !== connectionId || page.target.database !== 'main' ||
              page.target.table !== table || page.target.kind !== 'table' || page.result.rows.length !== 1 || page.hasMore)
            throw Error(labels.stale);
          const instance: SqliteTableEditor = new SqliteTableEditor(page, {
            current, active: () => editor.current === instance, available: () => !busy,
            acquire: () => {
              if (busy) throw Error(text.editBusy);
              const owner = {}; busy = owner;
              return { owns: () => busy === owner, release: () => {
                if (busy !== owner) return false;
                busy = undefined; return true;
              } };
            },
            id: uid, now: Date.now, changed: next => { if (live) setView(next); },
            dirty: value => { if (live) callbacks.current.onDirty(value); },
            preview: input => invoke('sqlite.tableEdit.preview', input), apply: input => invoke('sqlite.tableEdit.apply', input),
            release: input => invoke('sqlite.tableEdit.release', input), cancel: taskId => invoke('query.cancel', { taskId }),
            committed: () => {
              if (!live) return;
              useWorkspace.getState().notify(instance.view.message);
              callbacks.current.onDone(true);
            },
          });
          editor.current = instance; accepted = true; instance.inputOpen(true);
        } finally { if (!accepted) await release(); }
      } catch (reason) { if (live && !closingRef.current) setError(errorMessage(reason)); }
      finally { read.pending = false; if (live) setLoading(false); }
    })();
    return () => {
      live = false; unsubscribe();
      if (load.current === read) {
        if (read.sent && read.pending && !closingRef.current) void invoke('query.cancel', { taskId: read.id }).catch(report);
        editor.current?.dispose(); editor.current = undefined;
        callbacks.current.onDirty(false);
      }
    };
  }, [connectionId, table, recordRef, queryRecord]);

  function close() {
    if (closeWork.current || editor.current?.busy) return;
    const instance = editor.current;
    if (instance && (instance.changes.length || instance.view.unknown) && !window.confirm(labels.discard)) return;
    const read = load.current;
    closingRef.current = true; setClosing(true);
    const work = (async () => {
      try {
        if (read?.pending && read.sent) await invoke('query.cancel', { taskId: read.id });
        await read?.done;
        instance?.dispose();
        if (instance?.view.unknown) useWorkspace.getState().notify(instance.view.message, true);
        callbacks.current.onDone(false);
      } catch (reason) { closingRef.current = false; setClosing(false); setError(errorMessage(reason)); }
    })();
    closeWork.current = work;
    void work.finally(() => { if (closeWork.current === work) closeWork.current = undefined; });
  }

  const instance = editor.current;
  function stage(values: (SqliteOriginalValue | undefined)[]): boolean {
    const row = view?.rows[0];
    if (!instance || !row || !instance.canEdit()) return false;
    instance.save(row.id, values);
    saved.current = true;
    typedConsumed.current = true;
    if (instance.changes.length) { setPreview(true); void instance.preview(); }
    else close();
    return true;
  }

  if (view && instance && preview) return <SqliteTablePreviewDialog key={view.preview?.previewId ?? 'pending'} ticket={ticket} view={view}
    current={() => editor.current === instance && !closingRef.current}
    onApply={() => void instance.apply()} onStop={() => instance.stop()}
    onClose={() => {
      if (!instance.view.valid || instance.view.unknown) { close(); return; }
      instance.closePreview(); instance.inputOpen(true); saved.current = false; setPreview(false);
    }}/>;
  if (cell) {
    const columns = view?.page.edit?.kind === 'editable' ? view.page.edit.columns : [];
    const index = columns.findIndex(column => column.name === cell.column);
    const field = columns[index], row = view?.rows[0];
    const initial = field && !field.generated ? row?.values[index] : undefined;
    return <SqliteQueryInlineCellEditor cell={typedConsumed.current ? { ...cell, typed: undefined } : cell}
      initial={initial} nullable={field?.nullable ?? false} loading={loading || closing}
      error={error || (!loading && !initial ? queryText.inlineUnavailable : '')} visible={props.queryRecord ? props.visible !== false : false}
      onCancel={close} onStage={value => {
        if (!row || !initial || !cell.findAnchor()?.getClientRects().length) throw Error(labels.stale);
        // 只替换当前字段，未投影列及其原存储类继续使用独立读取的完整快照。
        const values = [...row.values];
        values[index] = value;
        if (!stage(values)) throw Error(labels.stale);
      }}/>;
  }
  if (view && instance && view.rows[0]) {
    const row = view.rows[0];
    return <SqliteTableValueDialog ticket={ticket} page={view.page} row={row} initialFocus={focusColumn}
      current={() => editor.current === instance && !closingRef.current && instance.canEdit()}
      onSave={stage}
      onClose={() => { if (!saved.current) close(); }}/>;
  }
  return <Modal title={labels.title} onClose={close} wide>
    <div className="modal-content"><p>{labels.hint}</p>{loading && <Spinner text={closing ? text.closing : text.reading}/>}<ErrorBox message={error}/></div>
    <footer className="modal-footer"><button disabled={closing} onClick={close}>{labels.back}</button></footer>
  </Modal>;
}
