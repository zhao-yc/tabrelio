import { useRef, useState } from 'react';
import { postgresRoleAttributeFlags, postgresRoleAttributesDraftSchema, type PostgresRole, type PostgresRoleAttributeEditor,
  type PostgresRoleAttributesDraft, type PostgresRoleChangeOutcome, type PostgresRoleChangePreview } from '../../shared/postgresRoles';
import { errorMessage, invoke } from '../lib';
import { postgresRolesZh as roles } from '../locales/postgresRoles.zh-CN';
import { zh } from '../locales/zh-CN';
import { ErrorBox, Field, Modal } from './ui';

const t = roles.editAttributes;
type Patch = PostgresRoleAttributesDraft['patch'];

export function PostgresRoleAttributesDialog({role, editor, connectionId, database, current, onClose}: {
  role: PostgresRole; editor: PostgresRoleAttributeEditor; connectionId: string; database: string;
  current(): boolean; onClose(refresh: boolean): void;
}) {
  const [changes, setChanges] = useState<Patch>({});
  const [limit, setLimit] = useState(String(role.connectionLimit));
  const [expiryMode, setExpiryMode] = useState('keep'), [expiry, setExpiry] = useState('');
  const [preview, setPreview] = useState<PostgresRoleChangePreview>(), [outcome, setOutcome] = useState<PostgresRoleChangeOutcome>();
  const [busy, setBusy] = useState(false), [confirmed, setConfirmed] = useState(false), [error, setError] = useState('');
  const pending = useRef(false);
  const locked = busy || !!outcome || !current();
  const reset = () => {setPreview(undefined); setConfirmed(false); setError('');};

  async function prepare() {
    if (pending.current || locked) return;
    reset();
    const patch: Patch = {...changes};
    if (limit !== String(role.connectionLimit)) patch.connectionLimit = limit.trim() ? Number(limit) : NaN;
    if (expiryMode !== 'keep') patch.validUntil = expiryMode === 'never' ? 'infinity' : expiry + ':00.000Z';
    const draft = postgresRoleAttributesDraftSchema.safeParse({connectionId, database,
      role: {oid: role.oid, name: role.name}, stamp: editor.stamp, patch});
    if (!draft.success) {setError(draft.error.issues[0].message); return;}
    pending.current = true; setBusy(true);
    try {
      const result = await invoke('postgres.roles.attributes.preview', draft.data);
      if (!current()) throw Error(roles.changed);
      setPreview(result);
    } catch (reason) {setError(errorMessage(reason));}
    finally {pending.current = false; setBusy(false);}
  }

  /** 只提交已核对的预览令牌。退出回执后重新读取角色，不自动重放。 */
  async function apply() {
    if (pending.current || locked || !preview || !confirmed) return;
    pending.current = true; setBusy(true); setConfirmed(false); setError('');
    try {setOutcome(await invoke('postgres.roles.attributes.apply', {connectionId, database, token: preview.token, confirmed: true}));}
    catch (reason) {setOutcome({outcome: 'unknown', message: errorMessage(reason)});}
    finally {pending.current = false; setBusy(false);}
  }
  const close = () => {if (!pending.current) onClose(!!outcome);};

  return <Modal title={t.title} wide onClose={close}>
    <div className="modal-content postgres-roles" aria-busy={busy}>
      <p>{database} · {roles.roleName} {role.name}</p>
      <p>{t.hint}</p>
      <div className="form-grid">
        {postgresRoleAttributeFlags.map(key => <label key={key}>
          <input type="checkbox" checked={changes[key] ?? role[key]} disabled={locked || !editor.flags.includes(key)}
            onChange={event => {
              const value = event.target.checked, patch = {...changes};
              if (value === role[key]) delete patch[key];
              else patch[key] = value;
              setChanges(patch); reset();
            }}/>{key === 'login' ? t.login : roles[key]}
        </label>)}
        <Field label={roles.connectionLimit}><input type="number" value={limit} min={-1} max={2147483647} disabled={locked}
          onChange={event => {setLimit(event.target.value); reset();}}/></Field>
        <Field label={t.expiryAction}><select aria-label={t.expiryAction} value={expiryMode} disabled={locked}
          onChange={event => {setExpiryMode(event.target.value); reset();}}>
          <option value="keep">{t.keep}</option><option value="never">{t.never}</option><option value="until">{t.until}</option>
        </select></Field>
        {expiryMode === 'until' && <Field label={t.expiry}><input type="datetime-local" value={expiry} disabled={locked}
          onChange={event => {setExpiry(event.target.value); reset();}}/></Field>}
      </div>
      <p>{roles.validUntil} · {role.validUntil === 'infinity' ? roles.noExpiry : role.validUntil ?? roles.noExpiry}</p>
      <button disabled={locked} onClick={() => void prepare()}>{t.preview}</button>
      {preview && <section>
        <p>{roles.actor} {preview.actor} · {preview.database}</p>
        <pre className="result-sql-preview" aria-label={t.sql}>{preview.sql}</pre>
        {!outcome && <label><input type="checkbox" checked={confirmed} disabled={locked}
          onChange={event => setConfirmed(event.target.checked)}/>{t.confirm}</label>}
      </section>}
      {outcome && <p role={outcome.outcome === 'committed' ? 'status' : 'alert'}>{roles.result[outcome.outcome]} · {outcome.message}</p>}
      <ErrorBox message={error || (!current() ? roles.changed : '')}/>
    </div>
    <footer className="modal-footer">
      <button disabled={busy} onClick={close}>{zh.common.close}</button>
      <button className="primary" disabled={locked || !confirmed || !preview} onClick={() => void apply()}>{t.apply}</button>
    </footer>
  </Modal>;
}
