import { useEffect, useRef, useState } from 'react';
import type { PostgresCreateTablePreview, PostgresCreateTableTarget } from '../../shared/postgresCreateTable';
import { postgresCreateViewPreviewSchema, postgresViewColumnsSchema, preparePostgresViewDefinition, postgresViewQuerySampleRows, type PostgresCreateViewKind } from '../../shared/postgresCreateView';
import { errorMessage, invoke } from '../lib';
import { postgresCreateViewZh as text } from '../locales/postgresCreateView.zh-CN';
import { zh } from '../locales/zh-CN';
import { useWorkspace } from '../store';
import { ErrorBox, Field, Modal, Spinner } from './ui';
import { ViewSqlFileImport } from './ViewSqlFileImport';
import { ViewOutputColumns } from './ViewOutputColumns';
import { ViewQueryInspect } from './ViewQueryInspect';
import { viewQueryInspectZh } from '../locales/viewQueryInspect.zh-CN';
import { viewSqlFileZh } from '../locales/viewSqlFile.zh-CN';
import './PostgresCreateTableDialog.css';

export interface PostgresCreateViewCopyDraft {
  version: number;
  schema: string;
  name: string;
  definition: string;
  comment: string;
  columnNames: string[];
  options?: string[];
}

/** 编辑、预览及确认绑定原数据库和连接修订，提交结果未知时停止再次发送。 */
export function PostgresCreateViewDialog({ target, kind, copy, onDirtyChange, onCreated, onClose }: {
  target: PostgresCreateTableTarget;
  kind: PostgresCreateViewKind;
  copy?: PostgresCreateViewCopyDraft;
  onDirtyChange(value: boolean): void;
  onCreated(view: string, version: number, message: string): void;
  onClose(): void;
}) {
  const materialized = kind === 'materialized';
  const { connectionId, database } = target;
  const version = useWorkspace(state => state.connectionVersions[connectionId] ?? 0);
  const stale = !!copy && version !== copy.version;
  const profile = useWorkspace(state => state.connections.find(item => item.id === connectionId));
  const dialect = profile?.dialect;
  const [schemas, setSchemas] = useState<string[]>([]);
  const [draft, setDraft] = useState(() => ({ schema: copy?.schema ?? '', view: '', definition: copy?.definition ?? '',
    comment: copy?.comment ?? '', populate: !copy, columnNames: copy?.columnNames ?? [] }));
  const [previewColumns, setPreviewColumns] = useState<{ owner: object; names: string[] }>();
  const [preview, setPreview] = useState<(PostgresCreateTablePreview & { version: number })>();
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false), [unknown, setUnknown] = useState(false), [error, setError] = useState('');
  const operation = useRef(false), lifecycle = useRef<object | undefined>(undefined);

  useEffect(() => {
    const owner = {};
    lifecycle.current = owner;
    setPreview(undefined);
    setLoading(true);
    setSchemas([]);
    setError('');
    queueMicrotask(async () => {
      if (lifecycle.current !== owner) return;
      try {
        if (stale || dialect !== 'postgresql') throw Error(text.changed);
        const list = await invoke('postgres.createTable.schemas', { connectionId, database });
        if (lifecycle.current !== owner) return;
        setSchemas(list);
        setDraft(previous => ({ ...previous, schema: list.includes(previous.schema) ? previous.schema : list[0] ?? '' }));
      } catch (reason) {
        if (lifecycle.current === owner) setError(errorMessage(reason));
      } finally {
        if (lifecycle.current === owner) setLoading(false);
      }
    });
    return () => { if (lifecycle.current === owner) lifecycle.current = undefined; };
  }, [connectionId, database, dialect, stale, version]);
  useEffect(() => { onDirtyChange(dirty || busy); }, [dirty, busy, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  /** 编辑只修改本地草稿，原预览不再可提交。 */
  function edit<K extends keyof typeof draft>(field: K, value: typeof draft[K]) {
    if (operation.current || unknown) return;
    setDraft(previous => ({ ...previous, [field]: value }));
    setDirty(true);
    setPreview(undefined);
    setError('');
  }

  /** 预览只读取目录，确认才消费准确令牌并请求创建。 */
  async function submit(apply: boolean) {
    const owner = lifecycle.current;
    if (!owner || operation.current || stale || unknown || loading || dialect !== 'postgresql' ||
        (useWorkspace.getState().connectionVersions[connectionId] ?? 0) !== version ||
        apply && preview?.version !== version) return;
    operation.current = true;
    setBusy(true);
    setError('');
    setPreview(undefined);
    let sent = false;
    try {
      if (!apply) {
        const { populate, ...fields } = draft;
        const input = postgresCreateViewPreviewSchema.parse({ connectionId, database, ...fields,
          ...(materialized ? { materialized: { populate } } : {}),
          ...(copy?.options ? { options: copy.options } : {}),
        });
        const result = await invoke('postgres.createView.preview', input);
        if (lifecycle.current === owner) setPreview({ ...result, version });
        return;
      }
      sent = true;
      const result = await invoke('postgres.createView.apply', { connectionId, database, token: preview!.token });
      if (result.outcome === 'committed' && result.table) {
        onCreated(result.table, version, result.message);
        onClose();
      } else {
        setUnknown(result.outcome === 'unknown');
        setError(result.outcome === 'unknown' ? text.unknown + ' ' + result.message : result.message);
      }
    } catch (reason) {
      if (sent) setUnknown(true);
      if (sent || lifecycle.current === owner)
        setError((sent ? text.unknown + ' ' : '') + errorMessage(reason));
    } finally {
      operation.current = false;
      if (lifecycle.current) setBusy(false);
    }
  }

  /** 等待原提交结算，关闭尚有草稿的窗口须明确丢弃。 */
  function close() {
    if (operation.current || dirty && !unknown && !window.confirm(text.discard)) return;
    onClose();
  }

  function importCurrent(): boolean {
    const state = useWorkspace.getState();
    return !!lifecycle.current && !operation.current && !stale && !unknown &&
      (state.connectionVersions[connectionId] ?? 0) === version &&
      state.connections.find(item => item.id === connectionId) === profile;
  }

  const title = copy ? materialized ? text.materializedCopyTitle : text.copyTitle : materialized ? text.materializedTitle : text.title;
  const editingDisabled = stale || busy || loading || unknown || !schemas.length;
  return <Modal title={title} wide onClose={close}>
    <div className="modal-content pg-create-content">
      <strong>PostgreSQL / {database}</strong>
      {copy && <p>{text.copySource(copy.schema, copy.name)}</p>}
      {copy && <p>{materialized ? text.materializedCopyHint : text.copyHint}</p>}
      <p>{preview ? text.review : materialized ? text.materializedHint : text.hint}</p>
      {loading && <Spinner text={text.wait} />}
      {busy && <Spinner text={text.working} />}
      <ErrorBox message={stale ? text.changed : error || (!loading && !schemas.length ? text.empty : '')} />
      {preview && !stale ? <pre className="pg-create-sql">{preview.statements.join(';\n\n') + ';'}</pre> :
        <fieldset disabled={editingDisabled}>
          <div className="pg-create-target">
            <Field label={text.schema}><select aria-label={text.schema} value={draft.schema} onChange={event => edit('schema', event.target.value)}>
              {schemas.map(schema => <option key={schema}>{schema}</option>)}</select></Field>
            <Field label={materialized ? text.materializedName : text.name}><input value={draft.view} maxLength={63} onChange={event => edit('view', event.target.value)} /></Field>
            <Field label={text.comment}><input value={draft.comment} maxLength={4096} onChange={event => edit('comment', event.target.value)} /></Field>
          </div>
          {!!copy?.options?.length && <p>{text.copyOptions} <code>{copy.options.join(', ')}</code></p>}
          <Field label={text.definition}><textarea className="pg-create-view-definition" value={draft.definition}
            spellCheck={false} rows={8} maxLength={128 * 1024} onChange={event => edit('definition', event.target.value)} /></Field>
          <ViewSqlFileImport owner={draft} name={draft.view} value={draft.definition} disabled={editingDisabled}
            hint={viewSqlFileZh.postgresHint} current={importCurrent} prepare={preparePostgresViewDefinition}
            apply={sql => edit('definition', sql)}/>
          {materialized && <label><input type="checkbox" checked={draft.populate}
            onChange={event => edit('populate', event.target.checked)} /> {text.populate}</label>}
          <ViewQueryInspect owner={draft} hint={viewQueryInspectZh.postgresHint(postgresViewQuerySampleRows)}
            disabled={editingDisabled || !draft.definition.trim()} current={importCurrent}
            read={mode => {
              if (mode === 'rows') setPreviewColumns(undefined);
              return invoke('postgres.createView.inspectQuery', { connectionId, database, definition: draft.definition, columnNames: draft.columnNames, mode });
            }} onRows={columns => setPreviewColumns({ owner: draft, names: columns.map(column => column.name) })}/>
          <ViewOutputColumns owner={draft} original={draft.columnNames} partial disabled={editingDisabled}
            current={importCurrent} previewColumns={previewColumns?.owner === draft ? previewColumns.names : undefined}
            applyNames={names => edit('columnNames', postgresViewColumnsSchema.parse(names))}/>
        </fieldset>}
    </div>
    <footer className="modal-footer">
      {preview && !stale && <button disabled={busy} onClick={() => setPreview(undefined)}>{text.edit}</button>}
      <span className="grow"/>
      <button disabled={busy} onClick={close}>{zh.common.close}</button>
      <button disabled={editingDisabled || !!preview} onClick={() => void submit(false)}>{text.preview}</button>
      <button className="primary" disabled={editingDisabled || !preview}
        onClick={() => void submit(true)}>{materialized ? text.materializedApply : text.apply}</button>
    </footer>
  </Modal>;
}
