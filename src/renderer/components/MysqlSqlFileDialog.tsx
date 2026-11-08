import { useEffect, useRef, useState } from 'react';
import { mysqlSqlFileEncodings, mysqlSqlInspectionVersion, type MysqlSqlFileChoice, type MysqlSqlFileChooseInput,
  type MysqlSqlFileInspection, type MysqlSqlFileInspectionInput } from '../../shared/mysqlSqlFile';
import { sqlFileImportReceiptSchema, type SqlFileImportReceipt } from '../../shared/sqlFileImport';
import { mysqlSqlFileZh as text } from '../locales/mysqlSqlFile.zh-CN';
import { sqlFileImportZh } from '../locales/sqlFileImport.zh-CN';
import { errorMessage, invoke, uid } from '../lib';
import { SqlFileImportReport } from './SqlFileImportReport';
import { ErrorBox, Field, Modal } from './ui';
import '../databaseBackup.css';

const referenceVersions = { mysql: '8.4.0', mariadb: '11.4.0' } as const;

export function MysqlSqlFileDialog({ connections, onRefresh, onClose }: {
  connections: readonly { id: string; name: string; database?: string | null; dialect: 'mysql' | 'mariadb' }[];
  onRefresh(connectionId: string): void;
  onClose(): void;
}) {
  const [connectionId, setConnection] = useState(connections.length === 1 ? connections[0].id : '');
  const [database, setDatabase] = useState('');
  const [databases, setDatabases] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [encoding, setEncoding] = useState<MysqlSqlFileChooseInput['encoding']>('utf8');
  const [family, setFamily] = useState<MysqlSqlFileInspectionInput['family']>(connections.length === 1 ? connections[0].dialect : 'mysql');
  const [version, setVersion] = useState<string>(referenceVersions[family]);
  const [file, setFile] = useState<MysqlSqlFileChoice | null>(null);
  const [inspection, setInspection] = useState<MysqlSqlFileInspection>();
  const [inspectionId, setInspectionId] = useState<string>();
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<SqlFileImportReceipt | null>();
  const [choosing, setChoosing] = useState(false);
  const [taskId, setTaskId] = useState<string>();
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState('');
  const occupied = useRef(false);
  const locked = choosing || !!taskId || !!inspectionId;
  const versionValid = mysqlSqlInspectionVersion.safeParse(version).success;
  const connection = connections.find(item => item.id === connectionId);
  const defaultDatabase = connection?.database;

  useEffect(() => {
    if (!connectionId) return;
    let current = true;
    setLoading(true);
    void invoke('mysql.compareData.catalogue', { connectionId }).then(items => {
      if (!current) return;
      setDatabases(items);
      if (defaultDatabase && items.includes(defaultDatabase)) setDatabase(defaultDatabase);
    }).catch(reason => { if (current) setError(errorMessage(reason)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [connectionId, defaultDatabase]);

  const target = { connectionId, database: database || null, encoding };
  function reset() { setFile(null); setConfirmed(false); setResult(undefined); setInspection(undefined); setError(''); }
  function changeFamily(next: MysqlSqlFileInspectionInput['family']) {
    setFamily(next); setVersion(referenceVersions[next]); setInspection(undefined);
  }

  async function choose() {
    if (occupied.current || connection && loading) return;
    occupied.current = true;
    setChoosing(true);
    reset();
    try { setFile(await invoke('mysql.sqlFile.choose', connection ? target : { encoding })); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { occupied.current = false; setChoosing(false); }
  }

  async function inspect() {
    if (occupied.current || !file || !versionValid) return;
    occupied.current = true;
    const operationId = uid();
    setInspectionId(operationId); setInspection(undefined); setError('');
    try { setInspection(await invoke('mysql.sqlFile.inspect', { fileToken: file.token, operationId, family, version })); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setInspectionId(undefined); setCancelling(false); occupied.current = false; }
  }

  async function run() {
    if (occupied.current || !connection || !file || !confirmed || loading) return;
    occupied.current = true;
    const id = uid();
    setTaskId(id);
    reset();
    try {
      const response = await invoke('mysql.sqlFile.execute', { ...target, taskId: id, fileToken: file.token, acknowledgeScript: true });
      const receipt = sqlFileImportReceiptSchema.safeParse(response.sql);
      setResult(receipt.success && receipt.data.taskId === id && receipt.data.encoding === encoding ? receipt.data : null);
      onRefresh(connectionId);
    } catch (reason) {
      setError(errorMessage(reason));
      onRefresh(connectionId);
    } finally {
      occupied.current = false;
      setTaskId(undefined);
      setCancelling(false);
    }
  }

  async function cancel() {
    if ((!taskId && !inspectionId) || cancelling) return;
    setCancelling(true);
    try {
      if (inspectionId) await invoke('mysql.sqlFile.cancelInspection', { operationId: inspectionId });
      else if (taskId) await invoke('query.cancel', { taskId });
    }
    catch (reason) { setError(errorMessage(reason)); }
  }

  const close = () => { if (!occupied.current) onClose(); };
  return <Modal title={text.title} wide onClose={close}>
    <div className="modal-content database-backup-content">
      <p>{text.scope}</p>
      <p>{text.transaction}</p>
      <fieldset disabled={locked}>
        <Field label={text.connection}><select aria-label={text.connection} value={connection?.id ?? ''} onChange={event => {
          const next = connections.find(item => item.id === event.target.value);
          setConnection(event.target.value); setDatabase(''); setDatabases([]); setLoading(!!next); reset();
          if (next && next.dialect !== family) changeFamily(next.dialect);
        }}>
          <option value="">—</option>{connections.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
        </select></Field>
        <Field label={text.database}><select aria-label={text.database} value={database} disabled={!connection || loading} onChange={event => {
          setDatabase(event.target.value); reset();
        }}>
          <option value="">{loading ? text.catalogue : text.noDatabase}</option>
          {databases.map(name => <option key={name}>{name}</option>)}
        </select></Field>
        <Field label={text.encoding}><select aria-label={text.encoding} value={encoding} onChange={event => {
          setEncoding(event.target.value as typeof encoding); reset();
        }}>
          {mysqlSqlFileEncodings.map(value => <option key={value} value={value}>{sqlFileImportZh.encodings[value]}</option>)}
        </select></Field>
      </fieldset>
      {file && <section className="database-backup-plan">
        <p>{file.name} · {file.bytes.toLocaleString()} 字节</p>
        {connection && <label className="check"><input type="checkbox" checked={confirmed} disabled={locked}
          onChange={event => setConfirmed(event.target.checked)}/>{text.trust}</label>}
        <fieldset disabled={locked}>
          <Field label={text.family}><select value={family} onChange={event => changeFamily(event.target.value === 'mariadb' ? 'mariadb' : 'mysql')}>
            <option value="mysql">MySQL</option><option value="mariadb">MariaDB</option>
          </select></Field>
          <Field label={text.version}><input value={version} maxLength={8} aria-invalid={!versionValid}
            onChange={event => { setVersion(event.target.value); setInspection(undefined); }}/></Field>
        </fieldset>
        {!versionValid && <p>{text.versionHint}</p>}
      </section>}
      {!connection && <p>{text.offline}</p>}
      {inspectionId && <p role="status">{cancelling ? text.inspectCancelling : text.inspecting}</p>}
      {inspection && <section className="database-backup-plan" aria-label={text.inspectTitle}>
        <strong>{text.inspectTitle}</strong>
        <p>{inspection.issue ? text.inspectionIssues[inspection.issue.reason] : text.inspectionDone}</p>
        {inspection.issue && !['cancelled', 'file'].includes(inspection.issue.reason) && <p>{text.inspectionAt(inspection.issue.nextStatement)}</p>}
        <p>{text.inspectionCounts(inspection.statements, inspection.structure, inspection.changes, inspection.destructive)}</p>
        {inspection.databaseActions.length ? <details open><summary>{text.databaseActions}</summary>
          <ul>{inspection.databaseActions.map(item => <li key={JSON.stringify([item.action, item.name])}>{text.action[item.action]} · {item.name}</li>)}</ul>
          {inspection.moreDatabases && <p>{text.moreDatabases}</p>}
        </details> : <p>{text.noDatabaseActions}</p>}
        <p>{text.inspectionScope}</p>
      </section>}
      {taskId && <p role="status">{cancelling ? text.cancelling : text.running}</p>}
      {result !== undefined && <SqlFileImportReport receipt={result}/>}
      <ErrorBox message={error}/>
    </div>
    <footer className="modal-footer">
      <button disabled={locked || !!connection && loading} onClick={() => void choose()}>{text.choose}</button>
      <button disabled={locked || !file || !versionValid} onClick={() => void inspect()}>{text.inspect}</button>
      {taskId || inspectionId ? <button disabled={cancelling} onClick={() => void cancel()}>{inspectionId ? text.inspectCancel : text.cancel}</button> :
        <button className="primary" disabled={locked || loading || !connection || !file || !confirmed} onClick={() => void run()}>{text.run}</button>}
      <span className="grow"/>
      <button disabled={locked} onClick={close}>{text.close}</button>
    </footer>
  </Modal>;
}
