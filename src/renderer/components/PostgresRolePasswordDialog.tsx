import { useRef, useState } from 'react';
import { postgresRolePasswordApplySchema, type PostgresRoleChangeOutcome, type PostgresRoleChangePreview,
  type PostgresRolePasswordDraft, type PostgresRolePasswordResetDraft } from '../../shared/postgresRoles';
import { errorMessage, invoke } from '../lib';
import { postgresRolesZh as roles } from '../locales/postgresRoles.zh-CN';
import { zh } from '../locales/zh-CN';
import { ErrorBox, Field, Modal } from './ui';

export function PostgresRolePasswordDialog({target, current, onClose, onEditConnection}: {
  target: PostgresRolePasswordDraft | PostgresRolePasswordResetDraft;
  current(): boolean; onClose(invalidate: boolean): void; onEditConnection?(): void;
}) {
  const t = 'stamp' in target ? roles.passwordReset : roles.password;
  const [preview, setPreview] = useState<PostgresRoleChangePreview>();
  const [outcome, setOutcome] = useState<PostgresRoleChangeOutcome>();
  const [busy, setBusy] = useState(false), [confirmed, setConfirmed] = useState(false), [error, setError] = useState('');
  const pending = useRef(false), password = useRef<HTMLInputElement>(null), repeat = useRef<HTMLInputElement>(null);
  const retryable = outcome?.outcome === 'notSent' || outcome?.outcome === 'rolledBack';
  const close = () => {
    if (!pending.current) onClose(outcome?.outcome === 'committed' || outcome?.outcome === 'unknown');
  };

  async function prepare() {
    if (pending.current || outcome && !retryable || !current()) return;
    pending.current = true; setBusy(true); setError(''); setPreview(undefined); setConfirmed(false); setOutcome(undefined);
    try {
      const result = 'stamp' in target ? await invoke('postgres.roles.passwordReset.preview', target) :
        await invoke('postgres.roles.password.preview', target);
      if (!current()) throw Error(roles.changed);
      setPreview(result);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { pending.current = false; setBusy(false); }
  }

  /** 新密码只用于服务器变更。连接编辑需要用户重新明确输入。 */
  async function apply() {
    if (pending.current || outcome || !preview || !confirmed || !current() || !password.current || !repeat.current) return;
    const request = postgresRolePasswordApplySchema.safeParse({connectionId: target.connectionId, database: target.database,
      token: preview.token, confirmed: true, password: password.current.value});
    if (!request.success || request.data.password !== repeat.current.value) { setError(roles.create.passwordMismatch); return; }
    password.current.value = ''; repeat.current.value = '';
    pending.current = true; setBusy(true); setError(''); setConfirmed(false);
    try {
      setOutcome(await invoke('stamp' in target ? 'postgres.roles.passwordReset.apply' : 'postgres.roles.password.apply', request.data));
    }
    catch { setOutcome({outcome: 'unknown', message: t.unknown}); }
    finally { pending.current = false; setBusy(false); }
  }

  return <Modal title={t.title} wide onClose={close}>
    <div className="modal-content postgres-roles" aria-busy={busy}>
      <p>{t.hint}</p>
      <p>{roles.roleName} {target.role.name} · {roles.database} {target.database}</p>
      {(!preview || retryable) && <button disabled={busy || !current()} onClick={() => void prepare()}>{t.preview}</button>}
      {preview && <section>
        <pre className="result-sql-preview" aria-label={t.sql}>{preview.sql}</pre>
        {!outcome && <>
          <p>{roles.create.secretHint}</p>
          <div className="form-grid">
            <Field label={t.secret}><input type="password" autoComplete="new-password" ref={password} disabled={busy} maxLength={1024}/></Field>
            <Field label={roles.create.repeat}><input type="password" autoComplete="new-password" ref={repeat} disabled={busy} maxLength={1024}/></Field>
          </div>
          <label><input type="checkbox" checked={confirmed} disabled={busy || !current()} onChange={event => setConfirmed(event.target.checked)}/>{t.confirm}</label>
        </>}
      </section>}
      {outcome && <p role={outcome.outcome === 'committed' ? 'status' : 'alert'}>{outcome.outcome === 'committed' ? t.committed :
        outcome.outcome === 'unknown' ? t.unknown : roles.result[outcome.outcome] + ' · ' + outcome.message}</p>}
      <ErrorBox message={error || (!current() ? roles.changed : '')}/>
    </div>
    <footer className="modal-footer">
      <button disabled={busy} onClick={close}>{zh.common.close}</button>
      {outcome?.outcome === 'committed' && onEditConnection &&
        <button className="primary" disabled={!current()} onClick={onEditConnection}>{roles.password.editConnection}</button>}
      {outcome?.outcome !== 'committed' &&
        <button className="primary" disabled={busy || !!outcome || !preview || !confirmed || !current()} onClick={() => void apply()}>{t.apply}</button>}
    </footer>
  </Modal>;
}
