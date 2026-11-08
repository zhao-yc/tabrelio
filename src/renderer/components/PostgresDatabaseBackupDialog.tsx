import { useEffect, useRef, useState } from 'react';
import type { FileChoice } from '../../shared/contracts';
import { postgresBackupRelationHasData, postgresBackupRelationName, postgresNativeBackupScopeLimit,
  type PostgresDatabaseBackupResult, type PostgresNativeBackupRelation } from '../../shared/postgresDatabaseBackup';
import type { PostgresSchemaCatalog } from '../../shared/postgresSchemaManage';
import { errorMessage, invoke, uid } from '../lib';
import { postgresDatabaseBackupZh as text } from '../locales/postgresDatabaseBackup.zh-CN';
import { ErrorBox, Field, Modal } from './ui';
import '../databaseBackup.css';

const entriesPerPage = 80;

export function PostgresDatabaseBackupDialog({ connections, onClose }: {
  connections: readonly { id: string; name: string }[];
  onClose(): void;
}) {
  const [connectionId, setConnection] = useState(connections.length === 1 ? connections[0].id : '');
  const [database, setDatabase] = useState('');
  const [databases, setDatabases] = useState<string[]>([]);
  const [format, setFormat] = useState<'sql' | 'custom'>('sql');
  const [scope, setScope] = useState<'database' | 'schemas' | 'relations'>('database');
  const [content, setContent] = useState<'all' | 'schema' | 'data'>('all');
  const [catalogueAttempt, setCatalogueAttempt] = useState(0);
  const [schemaCatalog, setSchemaCatalog] = useState<PostgresSchemaCatalog['schemas']>([]);
  const [relationCatalog, setRelationCatalog] = useState<PostgresNativeBackupRelation[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [catalogueQuery, setCatalogueQuery] = useState(''), [page, setPage] = useState(0);
  const [loadingCatalogue, setLoadingCatalogue] = useState(false);
  const [portable, setPortable] = useState(false);
  const [tool, setTool] = useState<FileChoice | null>(null), [file, setFile] = useState<FileChoice | null>(null);
  const [result, setResult] = useState<PostgresDatabaseBackupResult>();
  const [busy, setBusy] = useState(false), [taskId, setTask] = useState<string>();
  const [cancelling, setCancelling] = useState(false), [error, setError] = useState('');
  const occupied = useRef(false);
  const locked = busy || !!taskId;
  const selectedKeys = new Set(selected);
  const relationMode = scope === 'relations';
  const relationChoices = relationCatalog.filter(item => content !== 'data' || postgresBackupRelationHasData(item.kind));
  const schemas = scope === 'schemas' ? schemaCatalog.filter(item => selectedKeys.has(item.name)).map(({ name, stamp }) => ({ name, stamp })) : undefined;
  const relations = relationMode ? relationChoices.filter(item => selectedKeys.has(postgresBackupRelationName(item)))
    .map(({ schema, name, stamp }) => ({ schema, name, stamp })) : undefined;
  const ready = !!database && (scope === 'database' || !loadingCatalogue && !!(schemas?.length || relations?.length));
  const filter = catalogueQuery.trim().toLowerCase();
  const items = relationMode ? relationChoices.map(item => {
    const key = postgresBackupRelationName(item);
    return { key, label: key + ' · ' + (item.partition && item.kind === 'r' ? text.leafPartition : text.relationKinds[item.kind]) };
  }) : schemaCatalog.map(item => ({ key: item.name, label: item.name }));
  const visible = items.filter(item => item.label.toLowerCase().includes(filter));
  const pageCount = Math.max(1, Math.ceil(visible.length / entriesPerPage));
  const picker = relationMode ? text.relationPicker : text.schemaPicker;
  const selection = { connectionId, database, format, portable, content, schemas, relations };

  useEffect(() => {
    if (!connectionId) return;
    let current = true;
    void invoke('postgres.compareData.catalogue', { connectionId }).then(items => {
      if (current) setDatabases(items);
    }).catch(reason => { if (current) setError(errorMessage(reason)); });
    return () => { current = false; };
  }, [connectionId]);

  useEffect(() => {
    if (!connectionId || !database || scope === 'database') return;
    let current = true;
    setLoadingCatalogue(true);
    const load = scope === 'schemas' ? invoke('postgres.schemaManage.read', { connectionId, database }).then(result => {
      if (current) setSchemaCatalog(result.schemas.filter(item => item.usage));
    }) : invoke('postgres.backup.nativeCatalogue', { connectionId, database }).then(result => {
      if (current) setRelationCatalog(result);
    });
    void load.catch(reason => { if (current) setError(errorMessage(reason)); }).finally(() => {
      if (current) setLoadingCatalogue(false);
    });
    return () => { current = false; };
  }, [connectionId, database, scope, catalogueAttempt]);

  function resetFile() { setFile(null); setResult(undefined); setError(''); }
  function resetCatalogue() { setSchemaCatalog([]); setRelationCatalog([]); setSelected([]); setCatalogueQuery(''); setPage(0); resetFile(); }
  async function choose(which: 'tool' | 'file') {
    if (occupied.current || which === 'file' && (!tool || !ready)) return;
    occupied.current = true;
    setBusy(true);
    resetFile();
    try {
      if (which === 'tool') {
        setTool(null);
        setTool(await invoke('postgres.backup.chooseDumpTool', {}));
      } else if (tool) {
        setFile(await invoke('postgres.backup.chooseDatabaseFile', { ...selection, toolToken: tool.token }));
      }
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); occupied.current = false; }
  }
  async function start() {
    if (occupied.current || !tool || !file || !ready) return;
    occupied.current = true;
    const id = uid();
    setTask(id);
    resetFile();
    try {
      setResult(await invoke('postgres.backup.database', { ...selection,
        toolToken: tool.token, fileToken: file.token, taskId: id }));
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setTask(undefined); setCancelling(false); occupied.current = false; }
  }
  async function cancel() {
    if (!taskId || cancelling) return;
    setCancelling(true);
    try { await invoke('query.cancel', { taskId }); }
    catch (reason) { setError(errorMessage(reason)); }
  }
  const close = () => { if (!occupied.current) onClose(); };

  return <Modal title={text.title} wide onClose={close}>
    <div className="modal-content database-backup-content">
      <p>{text.scope}</p>
      <fieldset disabled={locked}>
        <Field label={text.connection}><select aria-label={text.connection} value={connectionId} onChange={event => {
          if (event.target.value === connectionId) return;
          setConnection(event.target.value); setDatabase(''); setDatabases([]); resetCatalogue();
        }}><option value="">—</option>{connections.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
        <Field label={text.database}><select aria-label={text.database} value={database} disabled={!databases.length} onChange={event => {
          if (event.target.value === database) return;
          setDatabase(event.target.value); resetCatalogue();
        }}><option value="">—</option>{databases.map(item => <option key={item}>{item}</option>)}</select></Field>
        <Field label={text.format}><select aria-label={text.format} value={format} onChange={event => {
          const value = event.target.value === 'custom' ? 'custom' : 'sql';
          if (value === format) return;
          setFormat(value); setPortable(false); resetFile();
        }}><option value="sql">{text.sql}</option><option value="custom">{text.custom}</option></select></Field>
        <Field label={text.selection}><select aria-label={text.selection} value={scope} onChange={event => {
          setScope(event.target.value as typeof scope); resetCatalogue();
        }}><option value="database">{text.full}</option><option value="schemas">{text.selectedSchemas}</option>
          <option value="relations">{text.selectedRelations}</option></select></Field>
        <Field label={text.content}><select aria-label={text.content} value={content} onChange={event => {
          const value = event.target.value as typeof content;
          if (relationMode && value === 'data') setSelected(relationCatalog.filter(item => postgresBackupRelationHasData(item.kind))
            .map(postgresBackupRelationName).filter(key => selectedKeys.has(key)));
          setContent(value); setPage(0); resetFile();
        }}>{Object.entries(text.contents).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
      </fieldset>
      {scope !== 'database' && database && <fieldset disabled={locked} className="database-backup-table-picker">
        <legend>{picker.title}</legend>
        <p>{picker.hint}</p>
        {relationMode && content === 'data' && <p>{text.relationDataHint}</p>}
        <div><button disabled={loadingCatalogue} onClick={() => { resetCatalogue(); setCatalogueAttempt(value => value + 1); }}>{picker.refresh}</button>
          <span>{picker.count(selected.length)}</span></div>
        {loadingCatalogue ? <p>{picker.loading}</p> : items.length ? <>
          <input aria-label={picker.search} placeholder={picker.search} value={catalogueQuery}
            onChange={event => { setCatalogueQuery(event.target.value); setPage(0); }}/>
          <div className="database-backup-table-list">
            {visible.slice(page * entriesPerPage, (page + 1) * entriesPerPage).map(item => <label key={item.key}><input type="checkbox" checked={selectedKeys.has(item.key)}
              disabled={selected.length >= postgresNativeBackupScopeLimit && !selectedKeys.has(item.key)} onChange={event => {
                const checked = event.target.checked;
                setSelected(value => checked ? [...value, item.key] : value.filter(key => key !== item.key));
                resetFile();
              }}/>{item.label}</label>)}
            {!visible.length && <p>{picker.noMatches}</p>}
          </div>
          {pageCount > 1 && <div>
            <button disabled={page === 0} onClick={() => setPage(page - 1)}>{text.previousPage}</button>
            <button disabled={page + 1 === pageCount} onClick={() => setPage(page + 1)}>{text.nextPage}</button>
            <span>{text.page(page + 1, pageCount)}</span>
          </div>}
        </> : <p>{picker.empty}</p>}
      </fieldset>}
      {content === 'data' && <p>{text.dataHint}</p>}
      {format === 'sql' && <label className="check"><input type="checkbox" checked={portable} disabled={locked} onChange={event => {
        setPortable(event.target.checked); resetFile();
      }}/>{text.portable}</label>}
      <p>{format === 'sql' ? text.portableHint : text.customHint}</p>
      <div>
        <button disabled={locked} onClick={() => void choose('tool')}>{text.tool}</button>
        {tool && <span> · {tool.name}</span>}
      </div>
      {file && <p>{file.name}</p>}
      {taskId && <p role="status">{cancelling ? text.cancelling : text.running}</p>}
      {result && <section className="database-backup-plan" role="status">
        <p>{text.done(result.bytes, result.toolVersion)}</p>
        {result.warning && <details><summary>{text.warnings}</summary><p>{result.warning}</p></details>}
      </section>}
      <ErrorBox message={error}/>
    </div>
    <footer className="modal-footer">
      <button disabled={locked || !ready || !tool} onClick={() => void choose('file')}>{text.choose}</button>
      {taskId ? <button disabled={cancelling} onClick={() => void cancel()}>{text.cancel}</button> :
        <button className="primary" disabled={locked || !ready || !file} onClick={() => void start()}>{text.start}</button>}
      <span className="grow"/>
      <button disabled={locked} onClick={close}>{text.close}</button>
    </footer>
  </Modal>;
}
