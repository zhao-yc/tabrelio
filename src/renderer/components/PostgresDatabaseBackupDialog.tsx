import { useEffect, useRef, useState } from 'react';
import type { FileChoice } from '../../shared/contracts';
import type { PostgresDatabaseBackupResult } from '../../shared/postgresDatabaseBackup';
import type { PostgresSchemaCatalog } from '../../shared/postgresSchemaManage';
import { errorMessage, invoke, uid } from '../lib';
import { postgresDatabaseBackupZh as text } from '../locales/postgresDatabaseBackup.zh-CN';
import { ErrorBox, Field, Modal } from './ui';
import '../databaseBackup.css';

export function PostgresDatabaseBackupDialog({ connections, onClose }: {
  connections: readonly { id: string; name: string }[];
  onClose(): void;
}) {
  const [connectionId, setConnection] = useState(connections.length === 1 ? connections[0].id : '');
  const [database, setDatabase] = useState('');
  const [databases, setDatabases] = useState<string[]>([]);
  const [format, setFormat] = useState<'sql' | 'custom'>('sql');
  const [scope, setScope] = useState<'database' | 'schemas'>('database');
  const [content, setContent] = useState<'all' | 'schema' | 'data'>('all');
  const [schemaAttempt, setSchemaAttempt] = useState(0);
  const [catalog, setCatalog] = useState<PostgresSchemaCatalog['schemas']>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [schemaQuery, setSchemaQuery] = useState('');
  const [loadingSchemas, setLoadingSchemas] = useState(false);
  const [portable, setPortable] = useState(false);
  const [tool, setTool] = useState<FileChoice | null>(null), [file, setFile] = useState<FileChoice | null>(null);
  const [result, setResult] = useState<PostgresDatabaseBackupResult>();
  const [busy, setBusy] = useState(false), [taskId, setTask] = useState<string>();
  const [cancelling, setCancelling] = useState(false), [error, setError] = useState('');
  const occupied = useRef(false);
  const locked = busy || !!taskId;
  const schemas = scope === 'schemas' ? catalog.filter(item => selected.includes(item.name)).map(({ name, stamp }) => ({ name, stamp })) : undefined;
  const ready = !!database && (scope !== 'schemas' || !loadingSchemas && !!schemas?.length);
  const filter = schemaQuery.trim().toLowerCase();
  const visible = catalog.filter(item => item.name.toLowerCase().includes(filter));

  useEffect(() => {
    if (!connectionId) return;
    let current = true;
    void invoke('postgres.compareData.catalogue', { connectionId }).then(items => {
      if (current) setDatabases(items);
    }).catch(reason => { if (current) setError(errorMessage(reason)); });
    return () => { current = false; };
  }, [connectionId]);

  useEffect(() => {
    if (!connectionId || !database || scope !== 'schemas') return;
    let current = true;
    setLoadingSchemas(true);
    void invoke('postgres.schemaManage.read', { connectionId, database }).then(result => {
      if (current) setCatalog(result.schemas.filter(item => item.usage));
    }).catch(reason => { if (current) setError(errorMessage(reason)); }).finally(() => {
      if (current) setLoadingSchemas(false);
    });
    return () => { current = false; };
  }, [connectionId, database, scope, schemaAttempt]);

  function resetFile() { setFile(null); setResult(undefined); setError(''); }
  function resetSchemas() { setCatalog([]); setSelected([]); setSchemaQuery(''); resetFile(); }
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
        setFile(await invoke('postgres.backup.chooseDatabaseFile', { connectionId, database, format, portable, content, schemas, toolToken: tool.token }));
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
      setResult(await invoke('postgres.backup.database', { connectionId, database, format, portable, content, schemas,
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
          setConnection(event.target.value); setDatabase(''); setDatabases([]); resetSchemas();
        }}><option value="">—</option>{connections.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
        <Field label={text.database}><select aria-label={text.database} value={database} disabled={!databases.length} onChange={event => {
          if (event.target.value === database) return;
          setDatabase(event.target.value); resetSchemas();
        }}><option value="">—</option>{databases.map(item => <option key={item}>{item}</option>)}</select></Field>
        <Field label={text.format}><select aria-label={text.format} value={format} onChange={event => {
          const value = event.target.value === 'custom' ? 'custom' : 'sql';
          if (value === format) return;
          setFormat(value); setPortable(false); resetFile();
        }}><option value="sql">{text.sql}</option><option value="custom">{text.custom}</option></select></Field>
        <Field label={text.selection}><select aria-label={text.selection} value={scope} onChange={event => {
          setScope(event.target.value as typeof scope); resetSchemas();
        }}><option value="database">{text.full}</option><option value="schemas">{text.selectedSchemas}</option></select></Field>
        <Field label={text.content}><select aria-label={text.content} value={content} onChange={event => {
          setContent(event.target.value as typeof content); resetFile();
        }}>{Object.entries(text.contents).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
      </fieldset>
      {scope === 'schemas' && database && <fieldset disabled={locked} className="database-backup-table-picker">
        <legend>{text.schemaList}</legend>
        <p>{text.schemaHint}</p>
        <div><button disabled={loadingSchemas} onClick={() => { resetSchemas(); setSchemaAttempt(value => value + 1); }}>{text.refreshSchemas}</button>
          <span>{text.selectedCount(selected.length)}</span></div>
        {loadingSchemas ? <p>{text.loadingSchemas}</p> : catalog.length ? <>
          <input aria-label={text.schemaSearch} placeholder={text.schemaSearch} value={schemaQuery}
            onChange={event => setSchemaQuery(event.target.value)}/>
          <div className="database-backup-table-list">
            {visible.map(item => <label key={item.name}><input type="checkbox" checked={selected.includes(item.name)}
              disabled={selected.length >= 64 && !selected.includes(item.name)} onChange={event => {
                const checked = event.target.checked;
                setSelected(value => checked ? [...value, item.name] : value.filter(name => name !== item.name));
                resetFile();
              }}/>{item.name}</label>)}
            {!visible.length && <p>{text.noMatchingSchemas}</p>}
          </div>
        </> : <p>{text.emptySchemas}</p>}
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
