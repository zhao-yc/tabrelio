import { useRef, useState } from 'react';
import { postgresRoleCreateApplySchema, postgresRoleCreateDraftSchema, type PostgresRoleCreateDraft, type PostgresRoleChangeOutcome, type PostgresRoleChangePreview } from '../../shared/postgresRoles';
import { errorMessage, invoke } from '../lib';
import { postgresRolesZh as roles } from '../locales/postgresRoles.zh-CN';
import { zh } from '../locales/zh-CN';
import { ErrorBox, Field, Modal } from './ui';

const t = roles.create;
const flags = [
  ['inherit', roles.inherit], ['createDatabase', roles.createDatabase], ['createRole', roles.createRole],
  ['superuser', roles.superuser], ['replication', roles.replication], ['bypassRls', roles.bypassRls],
] as const;

export function PostgresRoleCreateDialog({connectionId, database, current, onClose}: {
  connectionId: string; database?: string; current(): boolean; onClose(name?: string): void;
}) {
  const [draft, setDraft] = useState<PostgresRoleCreateDraft>({
    connectionId, ...(database ? {database} : {}), name: '', auth: 'group', inherit: true, createDatabase: false,
    createRole: false, superuser: false, replication: false, bypassRls: false, connectionLimit: -1,
  });
  const [connectionLimit, setConnectionLimit] = useState('-1'), [expiry, setExpiry] = useState('');
  const [preview, setPreview] = useState<PostgresRoleChangePreview>(), [confirmed, setConfirmed] = useState(false);
  const [outcome, setOutcome] = useState<PostgresRoleChangeOutcome>();
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const pending = useRef(false), password = useRef<HTMLInputElement>(null), repeated = useRef<HTMLInputElement>(null);
  const disabled = busy || !!outcome;
  const clearPreview = () => { setPreview(undefined); setConfirmed(false); setError(''); };
  const close = () => { if (!pending.current) onClose(outcome?.role?.name ?? (outcome?.outcome === 'unknown' ? draft.name : undefined)); };

  async function prepare() {
    if (pending.current || outcome || !current()) return;
    clearPreview();
    const valid = postgresRoleCreateDraftSchema.safeParse({...draft, connectionLimit: connectionLimit.trim() === '' ? NaN : Number(connectionLimit),
      ...(draft.auth === 'password' && expiry ? {validUntil: expiry + ':00.000Z'} : {})});
    if (!valid.success) { setError(valid.error.issues[0]?.message || t.invalid); return; }
    pending.current = true; setBusy(true);
    try {
      const result = await invoke('postgres.roles.create.preview', valid.data);
      if (!current()) throw Error(roles.changed);
      setPreview(result);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { pending.current = false; setBusy(false); }
  }

  /** 密码只读取一次，清空原输入后提交，不进入预览、React 状态或错误。 */
  async function apply() {
    if (pending.current || outcome || !confirmed || !preview || !current()) return;
    const secret = draft.auth === 'password' ? password.current?.value : undefined;
    const request = postgresRoleCreateApplySchema.safeParse({connectionId, ...(database ? {database} : {}),
      token: preview.token, confirmed: true, ...(secret === undefined ? {} : {password: secret})});
    if (!request.success || draft.auth === 'password' && (!secret || secret !== repeated.current?.value)) {
      setError(t.passwordMismatch); return;
    }
    if (password.current) password.current.value = '';
    if (repeated.current) repeated.current.value = '';
    pending.current = true; setBusy(true); setConfirmed(false); setError('');
    try { setOutcome(await invoke('postgres.roles.create.apply', request.data)); }
    catch { setOutcome({outcome: 'unknown', message: roles.changed}); }
    finally { pending.current = false; setBusy(false); }
  }

  return <Modal title={t.title} wide onClose={close}>
    <div className="modal-content postgres-roles" aria-busy={busy}>
      <p>{t.hint}</p>
      <div className="form-grid">
        <Field label={roles.roleName}><input value={draft.name} maxLength={63} disabled={disabled}
          onChange={event => {setDraft({...draft, name: event.target.value}); clearPreview();}}/></Field>
        <Field label={t.auth}><select aria-label={t.auth} value={draft.auth} disabled={disabled}
          onChange={event => {setDraft({...draft, auth: event.target.value as PostgresRoleCreateDraft['auth']}); setExpiry(''); clearPreview();}}>
          <option value="group">{t.group}</option><option value="password">{t.password}</option><option value="external">{t.external}</option>
        </select></Field>
        <Field label={roles.connectionLimit}><input type="number" min={-1} max={2147483647} value={connectionLimit} disabled={disabled}
          onChange={event => {setConnectionLimit(event.target.value); clearPreview();}}/></Field>
        {draft.auth === 'password' && <Field label={t.expiry}><input type="datetime-local" value={expiry} disabled={disabled}
          onChange={event => {setExpiry(event.target.value); clearPreview();}}/></Field>}
      </div>
      <div className="form-grid">{flags.map(([key, label]) => <label key={key}>
        <input type="checkbox" checked={draft[key]} disabled={disabled}
          onChange={event => {setDraft({...draft, [key]: event.target.checked}); clearPreview();}}/>{label}
      </label>)}</div>
      <button disabled={disabled || !draft.name || !current()} onClick={() => void prepare()}>{t.preview}</button>
      {preview && <section>
        <p>{preview.database} · {roles.actor} {preview.actor}</p>
        <pre className="result-sql-preview" aria-label={t.sql}>{preview.sql}</pre>
        {!outcome && <>
          {draft.auth === 'password' && <div className="form-grid">
            <p>{t.secretHint}</p>
            <Field label={t.secret}><input type="password" autoComplete="new-password" ref={password} disabled={busy} maxLength={1024}/></Field>
            <Field label={t.repeat}><input type="password" autoComplete="new-password" ref={repeated} disabled={busy} maxLength={1024}/></Field>
          </div>}
          <label><input type="checkbox" checked={confirmed} disabled={busy || !current()} onChange={event => setConfirmed(event.target.checked)}/>{t.confirm}</label>
        </>}
      </section>}
      {outcome && <p role={outcome.outcome === 'committed' ? 'status' : 'alert'}>{roles.result[outcome.outcome]} · {outcome.message}</p>}
      <ErrorBox message={error || (!current() ? roles.changed : '')}/>
    </div>
    <footer className="modal-footer">
      <button disabled={busy} onClick={close}>{zh.common.close}</button>
      <button className="primary" disabled={disabled || !preview || !confirmed || !current()} onClick={() => void apply()}>{t.apply}</button>
    </footer>
  </Modal>;
}
