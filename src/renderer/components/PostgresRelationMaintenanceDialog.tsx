import { useEffect, useRef, useState } from 'react';
import type { PostgresCreateTablePreview } from '../../shared/postgresCreateTable';
import { postgresRelationMaintenanceAction, type PostgresRelationMaintenanceAction, type PostgresRelationMaintenanceCatalog } from '../../shared/postgresRelationMaintenance';
import type { PostgresStructureInput } from '../../shared/postgresStructure';
import { errorMessage, invoke } from '../lib';
import { postgresRelationMaintenanceZh as text } from '../locales/postgresRelationMaintenance.zh-CN';
import { useWorkspace } from '../store';
import { ErrorBox, Field, Modal, Spinner } from './ui';
import './PostgresStructureDialog.css';

const actions = postgresRelationMaintenanceAction.options;

/** 维护预览与独占会话只消费一次。未确认结果保留提示，重新打开后才可刷新目录。 */
export function PostgresRelationMaintenanceDialog({ target, onDirtyChange, beforeApply, onBack }: {
  target: PostgresStructureInput; onDirtyChange(value: boolean): void; beforeApply(): void; onBack(): void;
}) {
  const { connectionId, database, table } = target;
  const version = useWorkspace(state => state.connectionVersions[connectionId] ?? 0);
  const originalVersion = useRef(version), alive = useRef(false), running = useRef(false);
  const [catalog, setCatalog] = useState<PostgresRelationMaintenanceCatalog>(), [attempt, setAttempt] = useState(0);
  const [action, setAction] = useState<PostgresRelationMaintenanceAction>('analyze');
  const [preview, setPreview] = useState<PostgresCreateTablePreview>();
  const [busy, setBusy] = useState(false), [unknown, setUnknown] = useState(false), [error, setError] = useState('');
  const invalid = version !== originalVersion.current, locked = busy || invalid || unknown;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (invalid || unknown) return;
    let active = true;
    setCatalog(undefined); setError('');
    queueMicrotask(async () => {
      if (!active) return;
      try {
        const result = await invoke('postgres.relationMaintenance.read', { connectionId, database, table });
        if (active) {
          setCatalog(result);
          setAction(value => result.actions[value] ? value : actions.find(action => result.actions[action]) ?? 'analyze');
        }
      } catch (reason) {
        if (active) setError(errorMessage(reason));
      }
    });
    return () => { active = false; };
  }, [connectionId, database, table, attempt, invalid, unknown]);
  useEffect(() => { onDirtyChange(busy || !!preview); }, [busy, preview, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  function close() {
    if (!running.current && (!preview || unknown || window.confirm(text.discard))) onBack();
  }
  async function submit(apply: boolean) {
    if (running.current || invalid || unknown || !catalog?.actions[action] || apply && !preview) return;
    running.current = true; setBusy(true); setError('');
    let sent = false;
    try {
      if ((useWorkspace.getState().connectionVersions[connectionId] ?? 0) !== version) throw Error(text.changed);
      if (!apply) {
        const result = await invoke('postgres.relationMaintenance.preview', { ...target, action, stamp: catalog.stamp });
        if (alive.current && (useWorkspace.getState().connectionVersions[connectionId] ?? 0) === version) setPreview(result);
        return;
      }
      beforeApply();
      setPreview(undefined); sent = true;
      const receipt = await invoke('postgres.relationMaintenance.apply', { connectionId, database, token: preview!.token, confirmed: true });
      if (receipt.outcome === 'committed' || receipt.outcome === 'unknown') {
        const uncertain = receipt.outcome === 'unknown';
        useWorkspace.getState().notify(receipt.message, uncertain);
        if (alive.current) {
          setUnknown(uncertain);
          if (!uncertain) setAttempt(value => value + 1);
        }
      } else if (alive.current) setError(receipt.message);
    } catch (reason) {
      const message = errorMessage(reason);
      if (alive.current) { setError(message); if (sent) setUnknown(true); }
      if (sent) useWorkspace.getState().notify(message, true);
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  }

  return <Modal title={text.title} wide onClose={close}>
    <div className="modal-content pg-structure-content">
      <strong>{database} / {table}</strong>
      <ErrorBox message={invalid ? text.changed : unknown ? text.unknown : error}/>
      {!catalog && !error && !invalid && !unknown && <Spinner/>}
      {catalog && <section className="pg-column-edit">
        {preview ? <pre aria-label={text.sql} tabIndex={0}>{preview.statements.join(';\n') + ';'}</pre> : <>
          <div className="pg-structure-table-wrap"><table className="pg-structure-table"><tbody>
            {[[text.lastVacuum, catalog.lastVacuum], [text.lastAnalyze, catalog.lastAnalyze],
              [text.vacuumCount, catalog.vacuumCount], [text.analyzeCount, catalog.analyzeCount]].map(([label, value]) =>
              <tr key={label}><th scope="row">{label}</th><td>{value ?? '—'}</td></tr>)}
          </tbody></table></div>
          <Field label={text.operation}><select aria-label={text.operation} value={action} disabled={locked}
            onChange={event => { setAction(event.target.value as PostgresRelationMaintenanceAction); setError(''); }}>
            {actions.map(item => <option key={item} value={item} disabled={!catalog.actions[item]}>{text.actions[item]}</option>)}
          </select></Field>
          {!catalog.actions[action] && <p>{text.unavailable}</p>}
        </>}
        <p>{text.hints[action]}</p>
        {action === 'reindex' && (catalog.indexes.length ? <div className="pg-structure-table-wrap"><table className="pg-structure-table">
          <thead><tr><th scope="col">{text.indexName}</th><th scope="col">{text.indexStatus}</th></tr></thead>
          <tbody>{catalog.indexes.map(index => <tr key={index.name}><th scope="row">{index.name}</th>
            <td>{index.valid ? text.valid : text.invalid}</td></tr>)}</tbody>
        </table></div> : <p>{text.noIndexes}</p>)}
      </section>}
    </div>
    <footer className="modal-footer">
      <button disabled={busy} onClick={close}>{text.back}</button>
      {!preview && <button disabled={locked} onClick={() => setAttempt(value => value + 1)}>{text.refresh}</button>}
      <span className="grow"/>
      {preview ? <>
        <button disabled={busy || unknown} onClick={() => setPreview(undefined)}>{text.edit}</button>
        <button className="primary" disabled={locked} onClick={() => void submit(true)}>{text.apply}</button>
      </> : <button className="primary" disabled={locked || !catalog?.actions[action]} onClick={() => void submit(false)}>{text.preview}</button>}
    </footer>
  </Modal>;
}
