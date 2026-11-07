import { useRef, useState } from 'react';
import { postgresRoleRenameDraftSchema, type PostgresRoleChangeOutcome, type PostgresRoleChangePreview,
  type PostgresRoleRef } from '../../shared/postgresRoles';
import { errorMessage, invoke } from '../lib';
import { postgresRolesZh as roles } from '../locales/postgresRoles.zh-CN';
import { zh } from '../locales/zh-CN';
import { ErrorBox, Field, Modal } from './ui';

const t = roles.rename;

export function PostgresRoleRenameDialog({role, stamp, connectionId, database, current, onClose}: {
  role: PostgresRoleRef; stamp: string; connectionId: string; database: string;
  current(): boolean; onClose(outcome?: PostgresRoleChangeOutcome): void;
}) {
  const [name, setName] = useState('');
  const [preview, setPreview] = useState<PostgresRoleChangePreview>(), [outcome, setOutcome] = useState<PostgresRoleChangeOutcome>();
  const [busy, setBusy] = useState(false), [confirmed, setConfirmed] = useState(false), [error, setError] = useState('');
  const pending = useRef(false);
  const locked = busy || !!outcome || !current();
  const reset = () => {setPreview(undefined); setConfirmed(false); setError('');};

  async function prepare() {
    if (pending.current || locked) return;
    reset();
    const draft = postgresRoleRenameDraftSchema.safeParse({connectionId, database, role, stamp, name});
    if (!draft.success) {setError(draft.error.issues[0].message); return;}
    pending.current = true; setBusy(true);
    try {
      const result = await invoke('postgres.roles.rename.preview', draft.data);
      if (!current()) throw Error(roles.changed);
      setPreview(result);
    } catch (reason) {setError(errorMessage(reason));}
    finally {pending.current = false; setBusy(false);}
  }

  /** 旧连接的用户名需要由用户明确调整，角色重命名只消费服务器预览。 */
  async function apply() {
    if (pending.current || locked || !preview || !confirmed) return;
    pending.current = true; setBusy(true); setConfirmed(false); setError('');
    try {setOutcome(await invoke('postgres.roles.rename.apply', {connectionId, database, token: preview.token, confirmed: true}));}
    catch (reason) {setOutcome({outcome: 'unknown', message: errorMessage(reason)});}
    finally {pending.current = false; setBusy(false);}
  }
  const close = () => {if (!pending.current) onClose(outcome);};

  return <Modal title={t.title} wide onClose={close}>
    <div className="modal-content postgres-roles" aria-busy={busy}>
      <p>{database} · {roles.roleName} {role.name} · OID {role.oid}</p>
      <p>{t.hint}</p>
      <Field label={t.name}><input value={name} maxLength={63} disabled={locked} onChange={event => {
        setName(event.target.value); reset();
      }}/></Field>
      <button disabled={locked || !name} onClick={() => void prepare()}>{t.preview}</button>
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
