import { useEffect, useRef, useState } from 'react';
import type { PostgresCreateTablePreview, PostgresCreateTableTarget } from '../../shared/postgresCreateTable';
import { postgresSchemaPreviewSchema, type PostgresSchemaCatalog, type PostgresSchemaPreviewInput } from '../../shared/postgresSchemaManage';
import { errorMessage, invoke } from '../lib';
import { postgresSchemaManageZh as text } from '../locales/postgresSchemaManage.zh-CN';
import { useWorkspace } from '../store';
import { ErrorBox, Field, Modal, Spinner } from './ui';
import './PostgresStructureDialog.css';

/** 目录、草稿和一次性预览绑定原数据库。未知回执停止后续提交，等待重新读取。 */
export function PostgresSchemaManageDialog({ target, onClose, onDirtyChange, beforeApply, onResult }: {
  target: PostgresCreateTableTarget; onClose(): void; onDirtyChange(value: boolean): void;
  beforeApply(draft: PostgresSchemaPreviewInput): void;
  onResult(draft: PostgresSchemaPreviewInput, version: number, message: string, unknown: boolean): void;
}) {
  const { connectionId, database } = target;
  const version = useWorkspace(state => state.connectionVersions[connectionId] ?? 0);
  const [attempt, setAttempt] = useState(0);
  const [catalog, setCatalog] = useState<PostgresSchemaCatalog>();
  const [action, setAction] = useState<PostgresSchemaPreviewInput['action']>('create');
  const [source, setSource] = useState('');
  const [name, setName] = useState(''), [owner, setOwner] = useState(''), [comment, setComment] = useState('');
  const [dropName, setDropName] = useState('');
  const [preview, setPreview] = useState<{ draft: PostgresSchemaPreviewInput; result: PostgresCreateTablePreview }>();
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [unknown, setUnknown] = useState(false);
  const operation = useRef(false), alive = useRef(false), initialVersion = useRef(version);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (initialVersion.current !== version || unknown) return;
    let current = true;
    setCatalog(undefined);
    setError('');
    queueMicrotask(async () => {
      if (!current) return;
      try {
        const result = await invoke('postgres.schemaManage.read', { connectionId, database });
        if (!current) return;
        setCatalog(result);
        const first = result.schemas.find(item => item.manageable);
        setSource(first?.name ?? '');
        setAction(result.canCreate ? 'create' : 'comment');
        setComment(result.canCreate ? '' : first?.comment ?? '');
      } catch (reason) {
        if (current) setError(errorMessage(reason));
      }
    });
    return () => { current = false; };
  }, [connectionId, database, version, attempt, unknown]);
  const selected = catalog?.schemas.find(item => item.name === source);
  const dirty = !!preview || !!name || !!owner || (action === 'create' || action === 'comment') && comment !== (action === 'comment' ? selected?.comment ?? '' : '');
  useEffect(() => { onDirtyChange(busy || dirty); }, [busy, dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  const invalid = initialVersion.current !== version;
  const nameChange = action === 'rename' || action === 'drop';
  const forbidden = (action === 'create' || action === 'rename' || action === 'owner') && !catalog?.canCreate ||
    action !== 'create' && (!selected?.manageable || nameChange && source === 'public');
  function choose(next: PostgresSchemaPreviewInput['action'], schema: string) {
    setAction(next); setSource(schema); setName(''); setOwner(''); setError('');
    setComment(next === 'comment' ? catalog?.schemas.find(item => item.name === schema)?.comment ?? '' : '');
  }
  function close() {
    if (operation.current || dirty && !unknown && !window.confirm(text.discard)) return;
    onClose();
  }

  function refresh() {
    if (operation.current || invalid || unknown || dirty && !window.confirm(text.discard)) return;
    setPreview(undefined); setName(''); setOwner(''); setComment('');
    setAttempt(value => value + 1);
  }

  async function submit(apply: boolean) {
    if (operation.current || unknown || invalid || !catalog || forbidden || apply && !preview) return;
    operation.current = true;
    setBusy(true);
    setError('');
    let sent = false;
    try {
      if ((useWorkspace.getState().connectionVersions[connectionId] ?? 0) !== version) throw Error(text.changed);
      if (!apply) {
        const original = { ...target, schema: source, stamp: selected?.stamp, action };
        const draft = postgresSchemaPreviewSchema.parse(action === 'create'
          ? { ...target, action, name, newOwner: owner || undefined, comment: comment || null }
          : action === 'rename' ? { ...original, name } : action === 'comment' ? { ...original, comment: comment || null }
            : action === 'owner' ? { ...original, newOwner: owner } : original);
        const result = await invoke('postgres.schemaManage.preview', draft);
        if (alive.current && (useWorkspace.getState().connectionVersions[connectionId] ?? 0) === version) {
          setDropName(''); setPreview({ draft, result });
        }
        return;
      }
      const { draft, result } = preview!;
      if (draft.action === 'drop' && dropName !== draft.schema) return;
      beforeApply(draft);
      setPreview(undefined);
      sent = true;
      const reply = await invoke('postgres.schemaManage.apply', { ...target, token: result.token, confirmed: true });
      if (reply.outcome === 'committed') {
        onResult(draft, version, reply.message, false);
        if (alive.current) {
          setName(''); setOwner(''); setComment(''); setAttempt(value => value + 1);
        }
      } else if (reply.outcome === 'unknown') {
        if (alive.current) setUnknown(true);
        onResult(draft, version, reply.message, true);
      } else if (alive.current) setError(reply.message);
    } catch (reason) {
      const message = errorMessage(reason);
      if (alive.current) { setError(message); if (sent) setUnknown(true); }
      if (sent && preview) onResult(preview.draft, version, message, true);
    } finally {
      operation.current = false;
      if (alive.current) setBusy(false);
    }
  }

  return <Modal title={text.title} wide onClose={close}>
    <div className="modal-content pg-structure-content">
      <strong>PostgreSQL / {database}</strong>
      <ErrorBox message={invalid ? text.changed : unknown ? text.unknown : error}/>
      {!catalog && !error && !unknown && !invalid && <Spinner/>}
      {catalog && <section className="pg-column-edit">
        {preview ? <>
          <pre aria-label={text.sql} tabIndex={0}>{preview.result.statements.join(';\n') + ';'}</pre>
          {preview.draft.action === 'drop' && <Field label={text.dropConfirm}>
            <input value={dropName} onChange={event => setDropName(event.target.value)} disabled={busy || invalid}/>
          </Field>}
        </> : <>
          <div className="pg-structure-table-wrap"><table className="pg-structure-table"><thead><tr>
            {[text.name, text.owner, text.usage, text.create, text.comment].map(value => <th key={value} scope="col">{value}</th>)}
          </tr></thead><tbody>{catalog.schemas.map(item => <tr key={item.name}>
            <th scope="row">{item.name}</th><td>{item.owner}</td><td>{item.usage ? text.yes : text.no}</td>
            <td>{item.create ? text.yes : text.no}</td><td>{item.comment ?? '—'}</td>
          </tr>)}</tbody></table>{!catalog.schemas.length && <p>{text.empty}</p>}</div>
          <fieldset disabled={busy || unknown || invalid}>
            <div className="pg-column-edit-fields">
              <Field label={text.operation}><select aria-label={text.operation} value={action}
                onChange={event => choose(event.target.value as PostgresSchemaPreviewInput['action'], source)}>
                {Object.entries(text.actions).map(([key, label]) => <option value={key} key={key}
                  disabled={(key === 'create' || key === 'rename' || key === 'owner') && !catalog.canCreate ||
                    key !== 'create' && !catalog.schemas.some(item => item.manageable)}>{label}</option>)}
              </select></Field>
              {action !== 'create' && <Field label={text.source}><select aria-label={text.source} value={source}
                onChange={event => choose(action, event.target.value)}>
                <option value="" disabled>—</option>
                {catalog.schemas.filter(item => item.manageable && (!nameChange || item.name !== 'public')).map(item =>
                  <option key={item.name}>{item.name}</option>)}
              </select></Field>}
              {(action === 'create' || action === 'rename') && <Field label={text.name}>
                <input value={name} maxLength={63} onChange={event => setName(event.target.value)}/>
              </Field>}
              {(action === 'create' || action === 'owner') && <Field label={text.newOwner}>
                <input value={owner} onChange={event => setOwner(event.target.value)}/>
              </Field>}
            </div>
            {(action === 'create' || action === 'comment') && <Field label={text.comment}>
              <textarea aria-label={text.comment} rows={2} maxLength={4096} value={comment} onChange={event => setComment(event.target.value)}/>
            </Field>}
            {action === 'create' && <p>{text.createOwnerHint}</p>}
            {action === 'owner' && <p>{text.ownerHint}</p>}
            {nameChange && <p>{text.renameTabs}</p>}
            {action === 'drop' && <p>{text.dropHint}</p>}
          </fieldset>
        </>}
      </section>}
    </div>
    <footer className="modal-footer">
      <button disabled={busy} onClick={close}>{text.close}</button>
      {!preview && <button disabled={busy || invalid || unknown} onClick={refresh}>{text.refresh}</button>}
      <span className="grow"/>
      {preview ? <>
        <button disabled={busy || unknown} onClick={() => setPreview(undefined)}>{text.back}</button>
        <button className={action === 'drop' || action === 'owner' ? 'danger' : 'primary'} disabled={busy || invalid ||
          (preview.draft.action === 'drop' && dropName !== preview.draft.schema)} onClick={() => void submit(true)}>{text.apply}</button>
      </> : <button className="primary" disabled={busy || invalid || unknown || !catalog || forbidden ||
        (action === 'create' || action === 'rename') && !name.trim() || action === 'owner' && !owner.trim()}
        onClick={() => void submit(false)}>{text.preview}</button>}
    </footer>
  </Modal>;
}
