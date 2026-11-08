import { useEffect, useRef, useState } from 'react';
import type { FileChoice } from '../../shared/contracts';
import { mysqlBackupDatabase, mysqlBackupTableLimit, type MysqlBackupTableScope,
  type MysqlDatabaseBackupFormat, type MysqlDatabaseBackupResult } from '../../shared/mysqlDatabaseBackup';
import { errorMessage, invoke, uid } from '../lib';
import { mysqlDatabaseBackupZh as text } from '../locales/mysqlDatabaseBackup.zh-CN';
import { ErrorBox, Field, Modal } from './ui';
import '../databaseBackup.css';

const tablesPerPage = 80;

export function MysqlDatabaseBackupDialog({ connections, onClose }: {
  connections: readonly { id: string; name: string }[];
  onClose(): void;
}) {
  const [connectionId, setConnection] = useState(connections.length === 1 ? connections[0].id : '');
  const [format, setFormat] = useState<MysqlDatabaseBackupFormat>('sql');
  const [database, setDatabase] = useState('');
  const [databases, setDatabases] = useState<string[]>([]);
  const [scope, setScope] = useState<'whole' | 'tables'>('whole');
  const [content, setContent] = useState<MysqlBackupTableScope['content']>('all');
  const [tables, setTables] = useState<string[]>([]), [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState(''), [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false), [attempt, setAttempt] = useState(0);
  const [tool, setTool] = useState<FileChoice | null>(null);
  const [file, setFile] = useState<FileChoice | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<MysqlDatabaseBackupResult>();
  const [busy, setBusy] = useState(false), [taskId, setTask] = useState<string>();
  const [cancelling, setCancelling] = useState(false), [error, setError] = useState('');
  const occupied = useRef(false);
  const locked = busy || !!taskId;
  const connection = connections.find(item => item.id === connectionId);
  const scoped = scope === 'tables';
  const ready = !!connection && !!database && (!scoped || !loading && !!selected.length);
  const fileOptions = { connectionId, database, format, ...(scoped ? { tableScope: { tables: selected, content } } : {}) };
  const visible = tables.filter(name => name.toLowerCase().includes(filter.trim().toLowerCase()));
  const pages = Math.max(1, Math.ceil(visible.length / tablesPerPage));

  useEffect(() => {
    if (!connectionId) return;
    let current = true;
    void invoke('mysql.compareData.catalogue', { connectionId }).then(items => {
      if (current) setDatabases(items.filter(item => mysqlBackupDatabase.safeParse(item).success));
    }).catch(reason => { if (current) setError(errorMessage(reason)); });
    return () => { current = false; };
  }, [connectionId]);

  useEffect(() => {
    if (!connectionId || !database || !scoped) return;
    let current = true;
    setLoading(true);
    void invoke('mysql.backup.tables', { connectionId, database }).then(names => {
      if (current) setTables(names);
    }).catch(reason => { if (current) setError(errorMessage(reason)); }).finally(() => {
      if (current) setLoading(false);
    });
    return () => { current = false; };
  }, [connectionId, database, scoped, attempt]);

  function resetFile() { setFile(null); setConfirmed(false); setResult(undefined); setError(''); }
  function resetTables() { setTables([]); setSelected([]); setFilter(''); setPage(0); resetFile(); }

  async function choose(which: 'tool' | 'file') {
    if (occupied.current || which === 'file' && (!tool || !ready)) return;
    occupied.current = true;
    setBusy(true);
    resetFile();
    try {
      if (which === 'tool') {
        setTool(null);
        setTool(await invoke('mysql.backup.chooseTool', {}));
      } else if (tool) {
        setFile(await invoke('mysql.backup.chooseFile', { ...fileOptions, toolToken: tool.token }));
      }
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); occupied.current = false; }
  }

  async function start() {
    if (occupied.current || !ready || !tool || !file || !confirmed) return;
    occupied.current = true;
    const id = uid();
    setTask(id);
    resetFile();
    try {
      setResult(await invoke('mysql.backup.database', {
        ...fileOptions, toolToken: tool.token, fileToken: file.token, taskId: id, acknowledgeSnapshot: true,
      }));
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setTask(undefined); setCancelling(false); occupied.current = false; }
  }

  async function cancel() {
    if (!taskId || cancelling) return;
    setCancelling(true);
    try { await invoke('query.cancel', { taskId }); }
    catch (reason) { setError(errorMessage(reason)); }
  }

  return <Modal title={text.title} wide onClose={() => { if (!occupied.current) onClose(); }}>
    <div className="modal-content database-backup-content">
      <p>{text.scope}</p><p>{text.snapshot}</p>
      <fieldset disabled={locked}>
        <Field label={text.connection}><select aria-label={text.connection} value={connection?.id ?? ''} onChange={event => {
          setConnection(event.target.value); setDatabase(''); setDatabases([]); resetTables();
        }}>
          <option value="">—</option>{connections.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></Field>
        <Field label={text.database}><select aria-label={text.database} value={database} disabled={!databases.length} onChange={event => {
          setDatabase(event.target.value); resetTables();
        }}>
          <option value="">—</option>{databases.map(item => <option key={item}>{item}</option>)}
        </select></Field>
        <Field label={text.selection}><select aria-label={text.selection} value={scope} onChange={event => {
          const value = event.target.value === 'tables' ? 'tables' : 'whole';
          setScope(value);
          if (value === 'tables') setFormat('sql');
          resetTables();
        }}><option value="whole">{text.whole}</option><option value="tables">{text.selected}</option></select></Field>
        <Field label={text.format}><select aria-label={text.format} value={format} disabled={scoped} onChange={event => {
          setFormat(event.target.value === 'archive' ? 'archive' : 'sql'); resetFile();
        }}>
          <option value="sql">{text.sql}</option><option value="archive">{text.archive}</option>
        </select></Field>
        {scoped && <Field label={text.content}><select aria-label={text.content} value={content} onChange={event => {
          setContent(event.target.value as MysqlBackupTableScope['content']); resetFile();
        }}>{Object.entries(text.contents).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>}
      </fieldset>
      {scoped ? database && <fieldset disabled={locked} className="database-backup-table-picker">
        <legend>{text.tableList}</legend>
        <p>{text.tableHint}</p>
        {content === 'data' && <p>{text.dataHint}</p>}
        <div><button disabled={loading} onClick={() => { resetTables(); setAttempt(value => value + 1); }}>{text.refreshTables}</button>
          <span>{text.tableCount(selected.length)}</span></div>
        {loading ? <p>{text.loadingTables}</p> : tables.length ? <>
          <input aria-label={text.tableSearch} placeholder={text.tableSearch} value={filter} onChange={event => {
            setFilter(event.target.value); setPage(0);
          }}/>
          <div className="database-backup-table-list">
            {visible.slice(page * tablesPerPage, (page + 1) * tablesPerPage).map(name => <label key={name}>
              <input type="checkbox" checked={selected.includes(name)} disabled={selected.length >= mysqlBackupTableLimit && !selected.includes(name)}
                onChange={event => { setSelected(event.target.checked ? [...selected, name] : selected.filter(item => item !== name)); resetFile(); }}/>{name}
            </label>)}
            {!visible.length && <p>{text.noMatches}</p>}
          </div>
          {pages > 1 && <div>
            <button disabled={page === 0} onClick={() => setPage(page - 1)}>{text.previous}</button>
            <button disabled={page + 1 === pages} onClick={() => setPage(page + 1)}>{text.next}</button><span>{text.page(page + 1, pages)}</span>
          </div>}
        </> : <p>{text.noTables}</p>}
      </fieldset> : <p>{text.wholeHint}</p>}
      {format === 'archive' && <p>{text.archiveScope}</p>}
      <div>
        <button disabled={locked} onClick={() => void choose('tool')}>{text.tool}</button>
        {tool && <span> · {tool.name}</span>}
      </div>
      {file && <section className="database-backup-plan">
        <p>{file.name}</p>
        <label className="check"><input type="checkbox" disabled={locked} checked={confirmed}
          onChange={event => setConfirmed(event.target.checked)}/>{text.confirm}</label>
      </section>}
      {taskId && <p role="status">{cancelling ? text.cancelling : text.running}</p>}
      {result && <section role="status" className="database-backup-plan">
        <p>{text.saved(result.bytes, result.toolVersion, Boolean(result.archiveSha256), scoped)}</p><p>{result.serverVersion}</p>
        {result.archiveSha256 && <p>{text.archiveHash}　<code>{result.archiveSha256}</code></p>}
      </section>}
      <ErrorBox message={error}/>
    </div>
    <footer className="modal-footer">
      <button disabled={locked || !ready || !tool} onClick={() => void choose('file')}>{text.choose}</button>
      {taskId ? <button disabled={cancelling} onClick={() => void cancel()}>{text.cancel}</button> :
        <button className="primary" disabled={locked || !ready || !file || !confirmed} onClick={() => void start()}>{text.start}</button>}
      <span className="grow"/>
      <button disabled={locked} onClick={onClose}>{text.close}</button>
    </footer>
  </Modal>;
}
