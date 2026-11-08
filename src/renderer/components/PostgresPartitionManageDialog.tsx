import { useEffect, useRef, useState } from 'react';
import type { PostgresCreateTablePreview } from '../../shared/postgresCreateTable';
import { postgresPartitionManagePreviewSchema, type PostgresPartitionCatalog, type PostgresPartitionManagePreview } from '../../shared/postgresPartitionManage';
import { postgresIdentifier, postgresRelationName } from '../../shared/postgresSql';
import type { PostgresStructureInput } from '../../shared/postgresStructure';
import { errorMessage, invoke } from '../lib';
import { postgresPartitionManageZh as text } from '../locales/postgresPartitionManage.zh-CN';
import { useWorkspace } from '../store';
import { compilePostgresPartitionBound, newPostgresPartitionBound, PostgresPartitionBoundFields } from './PostgresPartitionFields';
import { ErrorBox, Field, Modal, Spinner } from './ui';
import './PostgresCreateTableDialog.css';
import './PostgresStructureDialog.css';

type Action = PostgresPartitionManagePreview['action'];
const relationKey = (child: { schema: string; name: string }) => JSON.stringify([child.schema, child.name]);

/** 原文档、连接修订和实际父表目录共同约束子分区预览。 */
export function PostgresPartitionManageDialog({ target, readOnly, onDirtyChange, beforeApply, onResult, onBack }: {
  target: PostgresStructureInput; readOnly?: boolean; onDirtyChange(value: boolean): void;
  beforeApply(child: string): void; onResult(child: string, message: string, unknown: boolean, version: number): void;
  onBack(): void;
}) {
  const { connectionId, database, table } = target;
  const version = useWorkspace(state => state.connectionVersions[connectionId] ?? 0);
  const initialVersion = useRef(version), running = useRef(false), alive = useRef(false);
  const [catalog, setCatalog] = useState<PostgresPartitionCatalog>(), [attempt, setAttempt] = useState(0);
  const [action, setAction] = useState<Action>('create'), [schema, setSchema] = useState(() => postgresRelationName(table).schema);
  const [name, setName] = useState(''), [selected, setSelected] = useState('');
  const [boundary, setBoundary] = useState(newPostgresPartitionBound);
  const [preview, setPreview] = useState<{ draft: PostgresPartitionManagePreview; plan: PostgresCreateTablePreview }>();
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [unknown, setUnknown] = useState(false);
  const invalid = initialVersion.current !== version;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (invalid || unknown) return;
    let current = true;
    setCatalog(undefined); setError('');
    queueMicrotask(async () => {
      if (!current) return;
      try {
        const result = await invoke('postgres.partitionManage.read', { connectionId, database, table });
        if (current) setCatalog(result);
      } catch (reason) {
        if (current) setError(errorMessage(reason));
      }
    });
    return () => { current = false; };
  }, [connectionId, database, table, attempt, invalid, unknown]);
  useEffect(() => { onDirtyChange(busy || !!preview); }, [busy, preview, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  const children = catalog?.children ?? [];
  const detachable = children.filter(child => child.kind !== 'f' && !child.pending);
  const chosen = detachable.find(child => relationKey(child) === selected);
  const keys = catalog?.keys.map((key, index) => ({ id: String(index), name: key ?? text.expressionKey(index + 1) })) ?? [];
  const pending = children.some(child => child.pending);
  const writable = !readOnly && catalog?.manageable && !pending && !invalid && !unknown;
  const available = writable && (action === 'detach' ? !!chosen : !!name.trim() && !!schema.trim());
  const defaultUnavailable = children.some(child => child.bound === 'DEFAULT');

  function reset(next: Action) {
    setAction(next); setName(''); setSelected(''); setBoundary(newPostgresPartitionBound()); setError('');
  }
  function close() {
    if (!running.current && (!preview || unknown || window.confirm(text.discard))) onBack();
  }
  async function submit(apply: boolean) {
    if (running.current || !available || !catalog || apply && !preview) return;
    running.current = true; setBusy(true); setError('');
    let child = '', sent = false;
    try {
      if ((useWorkspace.getState().connectionVersions[connectionId] ?? 0) !== version) throw Error(text.changed);
      if (!apply) {
        const common = { ...target, action, stamp: catalog.stamp };
        const bound = compilePostgresPartitionBound(catalog.strategy, boundary, keys);
        const draft = postgresPartitionManagePreviewSchema.parse(action === 'detach' ?
          { ...common, schema: chosen!.schema, existingName: chosen!.name } :
          action === 'attach' ? { ...common, schema, existingName: name, bound } :
            { ...common, schema, child: { ...bound, name } });
        const plan = await invoke('postgres.partitionManage.preview', draft);
        if (alive.current && (useWorkspace.getState().connectionVersions[connectionId] ?? 0) === version)
          setPreview({ draft, plan });
        return;
      }
      const { draft, plan } = preview!;
      child = postgresIdentifier(draft.schema) + '.' + postgresIdentifier(draft.action === 'create' ? draft.child.name : draft.existingName);
      beforeApply(child);
      setPreview(undefined); sent = true;
      const receipt = await invoke('postgres.partitionManage.apply', { connectionId, database, token: plan.token, confirmed: true });
      if (receipt.outcome === 'committed' || receipt.outcome === 'unknown') {
        const uncertain = receipt.outcome === 'unknown';
        onResult(child, receipt.message, uncertain, version);
        if (alive.current) {
          setUnknown(uncertain);
          if (!uncertain) { reset(action); setAttempt(value => value + 1); }
        }
      } else if (alive.current) setError(receipt.message);
    } catch (reason) {
      const message = errorMessage(reason);
      if (alive.current) { setError(message); if (sent) setUnknown(true); }
      if (sent) onResult(child, message, true, version);
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  }

  return <Modal title={text.title} wide onClose={close}>
    <div className="modal-content pg-structure-content pg-create-content">
      <strong>{database} / {table}</strong>
      <ErrorBox message={invalid ? text.changed : unknown ? text.unknown : error}/>
      {!catalog && !error && !invalid && !unknown && <Spinner/>}
      {catalog && <section className="pg-column-edit">
        <p><code>{catalog.keyDefinition}</code></p>
        {preview ? <>
          <pre aria-label={text.sql} tabIndex={0}>{preview.plan.statements.join(';\n') + ';'}</pre>
          <p>{text.lock}</p>
          {preview.draft.action === 'detach' && <p>{text.detach}</p>}
        </> : <>
          {children.length ? <div className="pg-structure-table-wrap"><table className="pg-structure-table">
            <thead><tr>{[text.child, text.bound, text.kind, text.state].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
            <tbody>{children.map(child => <tr key={relationKey(child)}>
              <th scope="row">{postgresIdentifier(child.schema)}.{postgresIdentifier(child.name)}</th>
              <td><code>{child.bound}</code></td><td>{text.kinds[child.kind]}</td><td>{child.pending ? text.pending : text.attached}</td>
            </tr>)}</tbody>
          </table></div> : <p>{text.empty}</p>}
          {!writable && <p>{pending ? text.pendingHint : text.readonly}</p>}
          <fieldset className="pg-create-field" disabled={busy || !writable}>
            <Field label={text.operation}><select aria-label={text.operation} value={action}
              onChange={event => reset(event.target.value as Action)}>
              {Object.entries(text.actions).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select></Field>
            {action === 'detach' ? <Field label={text.child}>
              <select aria-label={text.child} value={selected} onChange={event => setSelected(event.target.value)}>
                <option value="">{text.choose}</option>
                {detachable.map(child => <option key={relationKey(child)} value={relationKey(child)}>
                  {postgresIdentifier(child.schema)}.{postgresIdentifier(child.name)}
                </option>)}
              </select>
            </Field> : <>
              <Field label={text.schema}><input list="partition-manage-schemas" value={schema} onChange={event => setSchema(event.target.value)}/>
                <datalist id="partition-manage-schemas">{catalog.schemas.map(schema => <option key={schema} value={schema}/>)}</datalist>
              </Field>
              <Field label={action === 'create' ? text.name : text.existing}><input value={name}
                onChange={event => setName(event.target.value)}/></Field>
              <PostgresPartitionBoundFields strategy={catalog.strategy} keys={keys} child={boundary}
                defaultUnavailable={defaultUnavailable} patch={change => setBoundary(previous => ({ ...previous, ...change }))}/>
            </>}
          </fieldset>
          {action === 'attach' && <p>{text.attach}</p>}
        </>}
      </section>}
    </div>
    <footer className="modal-footer">
      <button disabled={busy} onClick={close}>{text.back}</button>
      {!preview && <button disabled={busy || invalid || unknown} onClick={() => setAttempt(value => value + 1)}>{text.refresh}</button>}
      <span className="grow"/>
      {preview ? <>
        <button disabled={busy || unknown} onClick={() => setPreview(undefined)}>{text.edit}</button>
        <button className="primary" disabled={busy || !available} onClick={() => void submit(true)}>{text.apply}</button>
      </> : <button className="primary" disabled={busy || !available} onClick={() => void submit(false)}>{text.preview}</button>}
    </footer>
  </Modal>;
}
