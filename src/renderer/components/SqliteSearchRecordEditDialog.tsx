import { useEffect, useRef, useState } from 'react';
import { invoke, errorMessage, uid } from '../lib';
import { useWorkspace } from '../store';
import { SqliteTableEditor, type SqliteEditView } from '../sqliteTableEditor';
import { sqliteResultOriginsZh as queryText } from '../locales/sqliteResultOrigins.zh-CN';
import { dataSearchRecordsZh as text } from '../locales/dataSearchRecords.zh-CN';
import { SqliteTablePreviewDialog, SqliteTableValueDialog } from './SqliteTableEditDialog';
import { sqliteQueryRecordIndices, type SqliteQueryRecordInput } from '../../shared/sqliteTableBrowse';
import { stageSqliteQueryRangeFill, type SqliteQueryRangeFill } from '../sqliteQueryRangeFill';
import type { SqliteOriginalValue } from '../../shared/sqliteTableEdit';
import { SqliteQueryInlineCellEditor, type SqliteQueryInlineCell } from './SqliteQueryInlineCellEditor';
import { SqlitePasteRangeDialog } from './SqlitePasteRangeDialog';
import { sqliteRangePastePlanValues, type SqlitePasteAnchor } from '../sqliteTableRangePaste';
import type { SqliteClipboardSource } from '../sqliteTableClipboard';
import type { GridPasteShape } from '../gridRangePaste';
import { sqliteTableRangePasteZh as pasteText } from '../locales/sqliteTableRangePaste.zh-CN';
import { ErrorBox, Modal, Spinner } from './ui';

interface BaseProps {
  connectionId: string;
  table: string;
  focusColumn?: string;
  onDirty(value: boolean): void;
  onDone(committed: boolean): void;
}

export interface SqliteQueryRangePaste {
  columns: string[];
  shape: GridPasteShape;
  position: { row: number; column: number };
  source: SqliteClipboardSource;
}

type Props = BaseProps & ({ recordRef: string; queryRecord?: never; isCurrent?: never } |
  { recordRef?: never; queryRecord: SqliteQueryRecordInput; isCurrent(): boolean; cell?: SqliteQueryInlineCell; rangeFill?: SqliteQueryRangeFill; rangePaste?: SqliteQueryRangePaste; visible?: boolean });

/** 只编辑已核验的原行，沿用表页签发的编辑快照和原有预览提交链。 */
export function SqliteSearchRecordEditDialog(props: Props) {
  const { connectionId, table, recordRef, queryRecord, focusColumn } = props;
  const cell = props.queryRecord ? props.cell : undefined;
  const rangeFill = props.queryRecord ? props.rangeFill : undefined;
  const rangePaste = props.queryRecord ? props.rangePaste : undefined;
  const [pasteAnchor, setPasteAnchor] = useState<SqlitePasteAnchor>();
  const typedConsumed = useRef(false);
  const labels = rangeFill || rangePaste ? { title: rangePaste ? pasteText.title : queryText.rangeTitle, hint: rangePaste ? queryText.pasteHint : queryText.rangeHint, discard: queryText.rangeDiscard, back: queryText.editBack, stale: queryText.editStale }
    : queryRecord ? { title: queryText.editRecord, hint: queryText.editHint, discard: queryText.editDiscard, back: queryText.editBack, stale: queryText.editStale }
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
        const limit = queryRecord ? sqliteQueryRecordIndices(queryRecord).length : 1;
        const page = await invoke('sqlite.tablePage', {
          connectionId, database: 'main', table, taskId: read.id, ...(queryRecord ? { queryRecord } : { searchRecordRef: recordRef }), editing: true,
          offset: 0, limit, mode: 'and', filters: [], sort: [],
        });
        if (page.edit?.kind !== 'editable') throw Error(page.edit?.reason ?? labels.stale);
        const release = () => invoke('sqlite.tableEdit.release', { snapshotId: page.edit?.kind === 'editable' ? page.edit.snapshotId : undefined });
        let accepted = false;
        try {
          if (!current() || page.target.connectionId !== connectionId || page.target.database !== 'main' ||
              page.target.table !== table || page.target.kind !== 'table' || page.result.rows.length !== limit || page.hasMore)
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
          editor.current = instance;
          if (rangeFill) {
            if (!stageSqliteQueryRangeFill(instance, rangeFill)) throw Error(queryText.rangeUnchanged);
            accepted = true;
            setPreview(true);
            void instance.preview();
          } else {
            if (rangePaste) {
              const edit = page.edit;
              const columns = rangePaste.columns.map(name => edit.columns.findIndex(column => column.name === name));
              if (columns.some(index => index < 0) || new Set(columns).size !== columns.length) throw Error(pasteText.anchorRequired);
              if (columns.some(index => edit.columns[index].generated)) throw Error(pasteText.generated);
              setPasteAnchor({ row: instance.view.rows[0], column: columns[0], columns });
            }
            accepted = true;
            instance.inputOpen(true);
          }
        } finally {
          if (!accepted) {
            editor.current = undefined;
            await release();
          }
        }
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
  }, [connectionId, table, recordRef, queryRecord, rangeFill, rangePaste]);

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
      if (rangeFill || rangePaste || !instance.view.valid || instance.view.unknown) { close(); return; }
      instance.closePreview(); instance.inputOpen(true); saved.current = false; setPreview(false);
    }}/>;
  if (view && instance && rangePaste && pasteAnchor) return <SqlitePasteRangeDialog page={view.page} rows={view.rows} anchor={pasteAnchor}
    shape={rangePaste.shape} queryPosition={rangePaste.position} initial={rangePaste.source}
    current={() => editor.current === instance && instance.view.rows === view.rows && !closingRef.current && instance.canEdit()}
    onStage={plan => {
      // 先消费核验过的旧值／新值计划，再交表编辑器暂存，数据库写入仍须单独确认。
      const values = sqliteRangePastePlanValues(plan, view.page, view.rows, pasteAnchor);
      if (!instance.pasteCells(pasteAnchor.row.id, pasteAnchor.column, values, pasteAnchor.columns)) return false;
      saved.current = true;
      setPreview(true);
      void instance.preview();
      return true;
    }} onClose={() => { if (!saved.current) close(); }}/>;
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
