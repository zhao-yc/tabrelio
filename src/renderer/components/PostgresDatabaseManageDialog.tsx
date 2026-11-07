import { useEffect, useRef, useState } from 'react';
import type { PostgresCreateTablePreview } from '../../shared/postgresCreateTable';
import { postgresDatabaseManagePreviewSchema, type PostgresDatabaseCatalog, type PostgresDatabaseManageInput } from '../../shared/postgresDatabaseManage';
import { errorMessage, invoke } from '../lib';
import { postgresDatabaseManageZh as text } from '../locales/postgresDatabaseManage.zh-CN';
import { useWorkspace } from '../store';
import { ErrorBox, Field, Modal, Spinner } from './ui';
import './PostgresStructureDialog.css';

type Action = PostgresDatabaseManageInput['action'];
type Database = PostgresDatabaseCatalog['databases'][number];

function formFor(action: Action, database?: Database) {
  return { name: '', owner: '', comment: action === 'comment' ? database?.comment ?? '' : '',
    limit: String(action === 'settings' ? database?.connectionLimit ?? -1 : -1), allow: database?.allowConnections ?? true };
}

/** 原连接、维护库和一次性预览保持绑定。建库回执未知时停止继续写入。 */
export function PostgresDatabaseManageDialog({ connectionId, initialDatabase, onClose, onDirtyChange, beforeApply, onResult }: {
  connectionId: string; initialDatabase: string; onClose(): void; onDirtyChange(value: boolean): void;
  beforeApply(draft: PostgresDatabaseManageInput): void;
  onResult(draft: PostgresDatabaseManageInput, version: number, message: string, unknown: boolean): void;
}) {
  const version = useWorkspace(state => state.connectionVersions[connectionId] ?? 0);
  const [database, setDatabase] = useState(initialDatabase), [maintenance, setMaintenance] = useState(initialDatabase);
  const [attempt, setAttempt] = useState(0), [catalog, setCatalog] = useState<PostgresDatabaseCatalog>();
  const [action, setAction] = useState<Action>('create'), [source, setSource] = useState('');
  const [template, setTemplate] = useState<'template0' | 'template1'>('template0');
  const [form, setForm] = useState(() => formFor('create'));
  const [preview, setPreview] = useState<{ draft: PostgresDatabaseManageInput; result: PostgresCreateTablePreview }>();
  const [busy, setBusy] = useState(false), [unknown, setUnknown] = useState(false), [error, setError] = useState('');
  const running = useRef(false), alive = useRef(false), initialVersion = useRef(version);
  const invalid = version !== initialVersion.current;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (invalid || unknown) return;
    let active = true;
    setCatalog(undefined); setError('');
    queueMicrotask(async () => {
      if (!active) return;
      try {
        const result = await invoke('postgres.databaseManage.read', { connectionId, database });
        if (!active) return;
        const first = result.databases.find(item => item.manageable);
        const next = result.canCreate ? 'create' : 'comment';
        setCatalog(result); setSource(first?.name ?? ''); setAction(next); setForm(formFor(next, first));
        setTemplate(result.templates[0]?.name ?? 'template0');
      } catch (reason) {
        if (active) setError(errorMessage(reason));
      }
    });
    return () => { active = false; };
  }, [connectionId, database, attempt, invalid, unknown]);
  const selected = catalog?.databases.find(item => item.name === source);
  const original = formFor(action, selected);
  const dirty = !!preview || Object.entries(form).some(([key, value]) => original[key as keyof typeof original] !== value);
  useEffect(() => { onDirtyChange(busy || dirty); }, [busy, dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  const protectedName = [database, initialDatabase, 'postgres'].includes(source);
  const forbidden = !catalog || maintenance !== database || action !== 'create' && !selected?.manageable ||
    (action === 'create' || action === 'rename' || action === 'owner') && !catalog?.canCreate ||
    action === 'rename' && protectedName || action === 'settings' && !form.allow && protectedName;
  const needName = action === 'create' || action === 'rename';
  const needLimit = action === 'create' || action === 'settings';
  const patch = (value: Partial<typeof form>) => setForm(previous => ({ ...previous, ...value }));
  function choose(next: Action, name: string) {
    setAction(next); setSource(name); setError('');
    setForm(formFor(next, catalog?.databases.find(item => item.name === name)));
  }
  function confirmDiscard() { return !dirty || unknown || window.confirm(text.discard); }
  function reload() {
    if (running.current || invalid || unknown || !maintenance.trim() || !confirmDiscard()) return;
    setDatabase(maintenance); setAttempt(value => value + 1);
    setForm(formFor(action, selected));
  }
  function close() {
    if (!running.current && confirmDiscard()) onClose();
  }
  async function submit(apply: boolean) {
    if (running.current || invalid || unknown || forbidden || apply && !preview) return;
    running.current = true; setBusy(true); setError('');
    let sent = false;
    try {
      if ((useWorkspace.getState().connectionVersions[connectionId] ?? 0) !== version) throw Error(text.changed);
      const target = { connectionId, database };
      if (!apply) {
        const old = { ...target, action, targetName: source, stamp: selected?.stamp };
        const connectionLimit = form.limit.trim() ? Number(form.limit) : Number.NaN;
        const draft = postgresDatabaseManagePreviewSchema.parse(action === 'create'
          ? { ...target, action, name: form.name, template, newOwner: form.owner || undefined, connectionLimit }
          : action === 'rename' ? { ...old, name: form.name } : action === 'comment' ? { ...old, comment: form.comment || null }
            : action === 'owner' ? { ...old, newOwner: form.owner } : { ...old, allowConnections: form.allow, connectionLimit });
        const result = await invoke('postgres.databaseManage.preview', draft);
        if (alive.current && (useWorkspace.getState().connectionVersions[connectionId] ?? 0) === version)
          setPreview({ draft, result });
        return;
      }
      const { draft, result } = preview!;
      beforeApply(draft);
      setPreview(undefined); sent = true;
      const reply = await invoke('postgres.databaseManage.apply', { ...target, token: result.token, confirmed: true });
      if (reply.outcome === 'committed') {
        onResult(draft, version, reply.message, false);
        if (alive.current) { setForm(formFor(action, selected)); setAttempt(value => value + 1); }
      } else if (reply.outcome === 'unknown') {
        if (alive.current) setUnknown(true);
        onResult(draft, version, reply.message, true);
      } else if (alive.current) setError(reply.message);
    } catch (reason) {
      const message = errorMessage(reason);
      if (alive.current) { setError(message); if (sent) setUnknown(true); }
      if (sent && preview) onResult(preview.draft, version, message, true);
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  }

  return <Modal title={text.title} wide onClose={close}>
    <div className="modal-content pg-structure-content">
      <div className="pg-column-edit-fields">
        <Field label={text.maintenance}><input value={maintenance} onChange={event => setMaintenance(event.target.value)}
          disabled={busy || !!preview || invalid || unknown}/></Field>
        <button onClick={reload} disabled={busy || !!preview || invalid || unknown || !maintenance.trim()}>{text.read}</button>
      </div>
      <ErrorBox message={invalid ? text.changed : unknown ? text.unknown : error}/>
      {!catalog && !error && !invalid && !unknown && <Spinner/>}
      {catalog && <section className="pg-column-edit">
        {preview ? <pre aria-label={text.sql} tabIndex={0}>{preview.result.statements.join(';\n') + ';'}</pre> : <>
          <div className="pg-structure-table-wrap"><table className="pg-structure-table"><thead><tr>
            {[text.name, text.owner, text.encoding, text.collation, text.allow, text.limit, text.comment]
              .map(label => <th key={label} scope="col">{label}</th>)}
          </tr></thead><tbody>{catalog.databases.map(item => <tr key={item.name}>
            <th scope="row">{item.name}</th><td>{item.owner}</td><td>{item.encoding}</td><td>{item.collation}</td>
            <td>{item.allowConnections ? text.yes : text.no}</td><td>{item.connectionLimit === -1 ? text.unlimited : item.connectionLimit}</td>
            <td>{item.comment ?? '—'}</td>
          </tr>)}</tbody></table>{!catalog.databases.length && <p>{text.empty}</p>}</div>
          <fieldset disabled={busy || invalid || unknown || maintenance !== database}>
            <div className="pg-column-edit-fields">
              <Field label={text.operation}><select aria-label={text.operation} value={action}
                onChange={event => choose(event.target.value as Action, source)}>
                {Object.entries(text.actions).map(([key, label]) => <option key={key} value={key}
                  disabled={(key === 'create' || key === 'owner' || key === 'rename') && !catalog.canCreate ||
                    key !== 'create' && !catalog.databases.some(item => item.manageable)}>{label}</option>)}
              </select></Field>
              {action !== 'create' && <Field label={text.source}><select aria-label={text.source} value={source}
                onChange={event => choose(action, event.target.value)}>
                {catalog.databases.filter(item => item.manageable).map(item => <option key={item.name}>{item.name}</option>)}
              </select></Field>}
              {needName && <Field label={text.name}><input value={form.name} maxLength={63}
                onChange={event => patch({ name: event.target.value })}/></Field>}
              {(action === 'owner' || action === 'create') && <Field label={text.newOwner}>
                <input value={form.owner} onChange={event => patch({ owner: event.target.value })}/>
              </Field>}
              {action === 'create' && <Field label={text.template}><select aria-label={text.template} value={template}
                onChange={event => setTemplate(event.target.value as typeof template)}>
                {catalog.templates.map(item => <option key={item.name} value={item.name}>
                  {item.name} · {item.encoding} · {item.collation}
                </option>)}
              </select></Field>}
              {needLimit && <Field label={text.limit}><input type="number" min={-1} max={2147483647} value={form.limit}
                onChange={event => patch({ limit: event.target.value })}/></Field>}
            </div>
            {action === 'comment' && <Field label={text.comment}><textarea rows={2} maxLength={4096} aria-label={text.comment}
              value={form.comment} onChange={event => patch({ comment: event.target.value })}/></Field>}
            {action === 'settings' && <label><input type="checkbox" checked={form.allow} disabled={protectedName}
              onChange={event => patch({ allow: event.target.checked })}/> {text.allow}</label>}
            {action === 'create' && <p>{text.newHint}</p>}
            {action === 'rename' && <p>{text.maintenanceHint}</p>}
            {action === 'settings' && <p>{text.changeHint}</p>}
          </fieldset>
        </>}
      </section>}
    </div>
    <footer className="modal-footer">
      <button disabled={busy} onClick={close}>{text.close}</button><span className="grow"/>
      {preview ? <>
        <button disabled={busy || unknown} onClick={() => setPreview(undefined)}>{text.back}</button>
        <button className="primary" disabled={busy || invalid || unknown} onClick={() => void submit(true)}>{text.apply}</button>
      </> : <button className="primary" disabled={busy || invalid || unknown || forbidden || needName && !form.name.trim() ||
        needLimit && !form.limit.trim() || action === 'owner' && !form.owner.trim() || action === 'create' && !catalog?.templates.length}
        onClick={() => void submit(false)}>{text.preview}</button>}
    </footer>
  </Modal>;
}
