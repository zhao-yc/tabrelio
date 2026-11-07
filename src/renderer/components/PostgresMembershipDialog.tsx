import { useRef, useState } from 'react';
import type { PostgresMembershipDraft, PostgresMembershipOptions, PostgresMembershipOutcome, PostgresMembershipPreview, PostgresRoleRef } from '../../shared/postgresRoles';
import { errorMessage, invoke } from '../lib';
import { postgresRolesZh as t } from '../locales/postgresRoles.zh-CN';
import { zh } from '../locales/zh-CN';
import { ErrorBox, Field, Modal } from './ui';

export type MembershipIntent = {action: 'grant'; member: PostgresRoleRef} |
  {action: 'revoke'; member: PostgresRoleRef; role: PostgresRoleRef; grantor: PostgresRoleRef};

/** 只提交已展示的预览令牌，状态未知时先保留回执并禁止重试同一次请求。 */
export function PostgresMembershipDialog({intent, connectionId, database, current, onClose}: {
  intent: MembershipIntent; connectionId: string; database: string; current(): boolean; onClose(refresh: boolean): void;
}) {
  const [roleName, setRoleName] = useState('');
  const [options, setOptions] = useState<PostgresMembershipOptions>({admin: false, inherit: true, set: true});
  const [preview, setPreview] = useState<PostgresMembershipPreview>();
  const [confirmed, setConfirmed] = useState(false);
  const [outcome, setOutcome] = useState<PostgresMembershipOutcome>();
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const grant = intent.action === 'grant';
  const reset = () => { setPreview(undefined); setConfirmed(false); setError(''); };
  const close = () => { if (!pending.current) onClose(outcome?.outcome === 'committed' || outcome?.outcome === 'unknown'); };
  async function prepare() {
    if (pending.current || outcome || !current() || grant && !roleName) return;
    pending.current = true; setBusy(true); reset();
    const draft: PostgresMembershipDraft = intent.action === 'grant'
      ? {...intent, connectionId, database, roleName, options}
      : {...intent, connectionId, database};
    try {
      const result = await invoke('postgres.roles.membership.preview', draft);
      if (!current()) throw Error(t.changed);
      setPreview(result);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { pending.current = false; setBusy(false); }
  }
  async function apply() {
    if (pending.current || outcome || !preview || !confirmed || !current()) return;
    pending.current = true; setBusy(true); setError(''); setConfirmed(false);
    try {
      setOutcome(await invoke('postgres.roles.membership.apply', {connectionId, database, token: preview.token, confirmed: true}));
    } catch (reason) {
      // 应答异常可能发生在后端提交之后，只通过重新读取目录确认。
      setOutcome({outcome: 'unknown', message: errorMessage(reason)});
    } finally { pending.current = false; setBusy(false); }
  }
  return <Modal title={t.membership} wide onClose={close}>
    <div className="modal-content" aria-busy={busy}>
      <p>{database} · {t.member} {intent.member.name}</p>
      <p>{grant ? t.grantHint : t.revokeHint}</p>
      {grant ? <>
        <Field label={t.targetRole}><input value={roleName} maxLength={256} disabled={busy || !!outcome}
          onChange={event => {setRoleName(event.target.value); reset();}}/></Field>
        <div className="form-grid">{([['admin', t.admin], ['inherit', t.memberInherit], ['set', t.memberSet]] as const).map(([key, label]) =>
          <label key={key}><input type="checkbox" checked={options[key]} disabled={busy || !!outcome}
            onChange={event => {setOptions({...options, [key]: event.target.checked}); reset();}}/>{label}</label>)}</div>
      </> : <p>{t.targetRole} {intent.role.name} · {t.grantor} {intent.grantor.name}</p>}
      <button disabled={busy || !!outcome || !current() || grant && !roleName} onClick={() => void prepare()}>{t.preview}</button>
      {preview && <section>
        <p>{preview.database} · {t.actor} {preview.actor}</p>
        <p>{t.targetRole} {preview.role.name} · {t.grantor} {preview.grantor.name}</p>
        <pre className="result-sql-preview" aria-label={t.sql}>{preview.sql}</pre>
        {!outcome && <label><input type="checkbox" checked={confirmed} disabled={busy || !current()}
          onChange={event => setConfirmed(event.target.checked)}/>{t.confirm}</label>}
      </section>}
      {outcome && <p role={outcome.outcome === 'committed' ? 'status' : 'alert'}>{t.result[outcome.outcome]} · {outcome.message}</p>}
      <ErrorBox message={error || (!current() ? t.changed : '')}/>
    </div>
    <footer className="modal-footer">
      <button disabled={busy} onClick={close}>{zh.common.close}</button>
      <button className="primary" disabled={busy || !!outcome || !preview || !confirmed || !current()} onClick={() => void apply()}>{t.execute}</button>
    </footer>
  </Modal>;
}
