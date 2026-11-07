import { useEffect, useRef, useState } from 'react';
import type { PostgresCreateTablePreview, PostgresCreateTableTarget } from '../../shared/postgresCreateTable';
import { postgresExtensionPreviewSchema, type PostgresExtensionCatalog, type PostgresExtensionPreviewInput } from '../../shared/postgresExtensionManage';
import { errorMessage, invoke } from '../lib';
import { postgresExtensionManageZh as text } from '../locales/postgresExtensionManage.zh-CN';
import { useWorkspace } from '../store';
import { ErrorBox, Field, Modal, Spinner } from './ui';
import './PostgresStructureDialog.css';

type Action = PostgresExtensionPreviewInput['action'];

/** 预览绑定原库和目录指纹，回执待核对时阻止继续写入。 */
export function PostgresExtensionManageDialog({ target, onClose, onDirtyChange, onResult }: {
  target: PostgresCreateTableTarget; onClose(): void; onDirtyChange(value: boolean): void;
  onResult(target: PostgresCreateTableTarget, version: number, message: string, unknown: boolean): void;
}) {
  const { connectionId, database } = target;
  const connectionVersion = useWorkspace(state => state.connectionVersions[connectionId] ?? 0);
  const originalVersion = useRef(connectionVersion);
  const running = useRef(false), alive = useRef(false);
  const [catalog, setCatalog] = useState<PostgresExtensionCatalog>();
  const [attempt, setAttempt] = useState(0), [search, setSearch] = useState('');
  const [name, setName] = useState(''), [action, setAction] = useState<Action>('install');
  const [chosenVersion, setVersion] = useState(''), [chosenSchema, setSchema] = useState('');
  const [dropName, setDropName] = useState('');
  const [preview, setPreview] = useState<{ draft: PostgresExtensionPreviewInput; result: PostgresCreateTablePreview }>();
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [unknown, setUnknown] = useState(false);
  const invalid = connectionVersion !== originalVersion.current;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (invalid || unknown) return;
    let active = true;
    setCatalog(undefined); setError('');
    queueMicrotask(async () => {
      if (!active) return;
      try {
        const result = await invoke('postgres.extensionManage.read', { connectionId, database });
        if (active) setCatalog(result);
      } catch (reason) {
        if (active) setError(errorMessage(reason));
      }
    });
    return () => { active = false; };
  }, [connectionId, database, attempt, invalid, unknown]);
  useEffect(() => { onDirtyChange(busy || !!preview); }, [busy, preview, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  const selected = catalog?.extensions.find(item => item.name === name);
  const versions = action === 'install' ? selected?.versions.filter(item => item.installable) ?? [] : selected?.updates ?? [];
  const version = versions.some(item => item.version === chosenVersion) ? chosenVersion :
    versions.find(item => item.version === selected?.defaultVersion)?.version ?? versions[0]?.version ?? '';
  const metadata = action === 'install' ? selected?.versions.find(item => item.version === version) : undefined;
  const path = action === 'update' ? selected?.updates.find(item => item.version === version)?.path : undefined;
  const schemas = metadata?.schema ? [metadata.schema] :
    catalog?.schemas.filter(item => action !== 'move' || item !== selected?.installed?.schema) ?? [];
  const schema = schemas.includes(chosenSchema) ? chosenSchema : schemas.includes('public') ? 'public' : schemas[0] ?? '';
  const missing = metadata?.requires.filter(required => !catalog?.extensions.some(item => item.name === required && item.installed)) ?? [];
  const available = !!selected && (action === 'install' ? !selected.installed && !!schema && !!version && !missing.length :
    selected.installed?.manageable && (action === 'drop' || action === 'move' && selected.installed.relocatable && !!schema || action === 'update' && !!path));
  const locked = busy || invalid || unknown;
  const filter = search.trim().toLocaleLowerCase();
  const visible = catalog?.extensions.filter(item => (item.name + ' ' + (item.description ?? '')).toLocaleLowerCase().includes(filter)) ?? [];

  function reset(next: Action) {
    setAction(next); setVersion(''); setSchema(''); setError('');
  }
  function close() {
    if (!running.current && (!preview || unknown || window.confirm(text.discard))) onClose();
  }
  async function submit(apply: boolean) {
    if (running.current || invalid || unknown || !selected || !available || apply && !preview) return;
    running.current = true; setBusy(true); setError('');
    let sent = false;
    try {
      if ((useWorkspace.getState().connectionVersions[connectionId] ?? 0) !== connectionVersion) throw Error(text.changed);
      if (!apply) {
        const common = { ...target, name, stamp: selected.stamp, action };
        const draft = postgresExtensionPreviewSchema.parse(action === 'install' ? { ...common, schema, version }
          : action === 'move' ? { ...common, schema } : action === 'update' ? { ...common, version } : common);
        const result = await invoke('postgres.extensionManage.preview', draft);
        if (alive.current && (useWorkspace.getState().connectionVersions[connectionId] ?? 0) === connectionVersion) {
          setDropName(''); setPreview({ draft, result });
        }
        return;
      }
      const { draft, result } = preview!;
      if (draft.action === 'drop' && dropName !== draft.name) return;
      setPreview(undefined); sent = true;
      const receipt = await invoke('postgres.extensionManage.apply', { ...target, token: result.token, confirmed: true,
        ...(draft.action === 'drop' ? { dropName } : {}) });
      if (receipt.outcome === 'committed' || receipt.outcome === 'unknown') {
        const uncertain = receipt.outcome === 'unknown';
        onResult(target, connectionVersion, receipt.message, uncertain);
        if (alive.current) {
          setUnknown(uncertain);
          if (!uncertain) {
            reset(draft.action === 'install' ? 'update' : draft.action === 'drop' ? 'install' : draft.action);
            setAttempt(value => value + 1);
          }
        }
      } else if (alive.current) setError(receipt.message);
    } catch (reason) {
      const message = errorMessage(reason);
      if (alive.current) { setError(message); if (sent) setUnknown(true); }
      if (sent) onResult(target, connectionVersion, message, true);
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  }

  return <Modal title={text.title} wide onClose={close}>
    <div className="modal-content pg-structure-content">
      <strong>PostgreSQL / {database}</strong>
      <ErrorBox message={invalid ? text.changed : unknown ? text.unknown : error}/>
      {!catalog && !error && !invalid && !unknown && <Spinner/>}
      {catalog && <section className="pg-column-edit">
        {preview ? <>
          <pre aria-label={text.sql} tabIndex={0}>{preview.result.statements.join(';\n') + ';'}</pre>
          {preview.draft.action === 'drop' && <>
            <p>{text.dropHint}</p>
            <Field label={text.dropConfirm}><input value={dropName} disabled={locked}
              onChange={event => setDropName(event.target.value)}/></Field>
          </>}
        </> : <>
          <Field label={text.search}><input value={search} disabled={locked}
            onChange={event => setSearch(event.target.value)}/></Field>
          <div className="pg-structure-table-wrap"><table className="pg-structure-table"><thead><tr>
            {[text.name, text.installed, text.available, text.schema, text.owner, text.description]
              .map(label => <th key={label} scope="col">{label}</th>)}
          </tr></thead><tbody>{visible.map(item => <tr key={item.name}>
            <th scope="row"><button aria-pressed={name === item.name} disabled={locked} onClick={() => {
              setName(item.name); reset(item.installed ? 'update' : 'install');
            }}>{item.name}</button></th>
            <td>{item.installed?.version ?? '—'}</td><td>{item.defaultVersion ?? '—'}</td>
            <td>{item.installed?.schema ?? '—'}</td><td>{item.installed?.owner ?? '—'}</td><td>{item.description ?? '—'}</td>
          </tr>)}</tbody></table>{!visible.length && <p>{text.empty}</p>}</div>
          {selected ? <fieldset disabled={locked}>
            <div className="pg-column-edit-fields">
              <Field label={text.operation}><select value={action} onChange={event => reset(event.target.value as Action)}>
                {Object.entries(text.actions).map(([key, label]) => <option key={key} value={key}
                  disabled={key === 'install' ? !!selected.installed : !selected.installed?.manageable ||
                    key === 'move' && !selected.installed.relocatable}>{label}</option>)}
              </select></Field>
              {(action === 'install' || action === 'update') && <Field label={text.version}><select value={version}
                onChange={event => { setVersion(event.target.value); setSchema(''); }}>
                {versions.map(item => <option key={item.version}>{item.version}</option>)}
              </select></Field>}
              {(action === 'install' || action === 'move') && <Field label={text.targetSchema}><select value={schema}
                onChange={event => setSchema(event.target.value)}>
                {schemas.map(item => <option key={item}>{item}</option>)}
              </select></Field>}
            </div>
            {!!metadata?.requires.length && <p>{text.requirements}　{metadata.requires.join('、')}</p>}
            {path && <p>{text.updatePath}　<code>{path}</code></p>}
            {(action === 'install' || action === 'update') && <p>{text.installHint}</p>}
            {action === 'move' && <p>{text.moveHint}</p>}
            {!available && <p>{missing.length ? text.missing : text.unavailable}</p>}
          </fieldset> : <p>{text.select}</p>}
        </>}
      </section>}
    </div>
    <footer className="modal-footer">
      <button disabled={busy} onClick={close}>{text.close}</button>
      {!preview && <button disabled={locked} onClick={() => setAttempt(value => value + 1)}>{text.refresh}</button>}
      <span className="grow"/>
      {preview ? <>
        <button disabled={busy || unknown} onClick={() => setPreview(undefined)}>{text.back}</button>
        <button className={action === 'drop' ? 'danger' : 'primary'} disabled={locked ||
          (preview.draft.action === 'drop' && dropName !== preview.draft.name)} onClick={() => void submit(true)}>{text.apply}</button>
      </> : <button className="primary" disabled={locked || !available} onClick={() => void submit(false)}>{text.preview}</button>}
    </footer>
  </Modal>;
}
