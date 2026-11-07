import { useRef, useState } from 'react';
import type { PostgresMembershipOutcome, PostgresRoleRef, PostgresTablePrivilege, PostgresTablePrivilegeDraft,
  PostgresTablePrivilegeEditor, PostgresTablePrivilegePreview } from '../../shared/postgresRoles';
import { errorMessage, invoke } from '../lib';
import { postgresRolesZh as roles } from '../locales/postgresRoles.zh-CN';
import { zh } from '../locales/zh-CN';
import { ErrorBox, Field, Modal } from './ui';

const t = roles.tablePrivileges;
type Action = PostgresTablePrivilegeDraft['action'];

export function PostgresTablePrivilegesDialog({connectionId, database, role, editor, privileges, current, onClose}: {
  connectionId: string; database: string; role: PostgresRoleRef; editor: PostgresTablePrivilegeEditor;
  privileges: PostgresTablePrivilege[]; current(): boolean; onClose(refresh: boolean): void;
}) {
  const [action, setAction] = useState<Action>('grant'), [selected, setSelected] = useState<PostgresTablePrivilege[]>([]);
  const [preview, setPreview] = useState<PostgresTablePrivilegePreview>(), [confirmed, setConfirmed] = useState(false);
  const [outcome, setOutcome] = useState<PostgresMembershipOutcome>();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const pending = useRef(false);
  const locked = busy || !!outcome || !current();
  const reset = () => {setPreview(undefined); setConfirmed(false); setError('');};
  function available(privilege: PostgresTablePrivilege) {
    const direct = editor.direct.find(item => item.privilege === privilege);
    switch (action) {
      case 'grant': return !direct;
      case 'grantOption': return !direct?.grantable;
      case 'revoke': return !!direct;
      case 'revokeOption': return !!direct?.grantable;
    }
  }

  async function prepare() {
    if (pending.current || locked || !selected.length) return;
    pending.current = true; setBusy(true); reset();
    try {
      const result = await invoke('postgres.roles.tablePrivileges.preview', {
        connectionId, database, role, table: editor.table, action, privileges: selected,
      });
      if (!current()) throw Error(roles.changed);
      setPreview(result);
    } catch (reason) {setError(errorMessage(reason));}
    finally {pending.current = false; setBusy(false);}
  }

  /** 确认只消费已展示的预览。回执未知时关闭后重新读取实际授权。 */
  async function apply() {
    if (pending.current || locked || !confirmed || !preview) return;
    pending.current = true; setBusy(true); setConfirmed(false); setError('');
    try {setOutcome(await invoke('postgres.roles.tablePrivileges.apply', {connectionId, database, token: preview.token, confirmed: true}));}
    catch (reason) {setOutcome({outcome: 'unknown', message: errorMessage(reason)});}
    finally {pending.current = false; setBusy(false);}
  }
  const close = () => {if (!pending.current) onClose(!!outcome);};

  return <Modal title={t.title} wide onClose={close}>
    <div className="modal-content postgres-roles" aria-busy={busy}>
      <p>{database} · {editor.table.schema} / {editor.table.name} · {roles.roleName} {role.name}</p>
      <p>{roles.grantor} {editor.grantor}</p>
      <p>{t.hint} {t.lockHint}</p>
      <p>{t.direct} · {editor.direct.map(item => item.privilege + (item.grantable ? ' WITH GRANT OPTION' : '')).join('、') || t.inherited}</p>
      <Field label={t.action}><select aria-label={t.action} value={action} disabled={locked} onChange={event => {
        setAction(event.target.value as Action); setSelected([]); reset();
      }}>{Object.entries(t.actions).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field>
      <fieldset><legend>{t.selection}</legend><div className="form-grid">
        {privileges.map(privilege => <label key={privilege}>
          <input type="checkbox" disabled={locked || !available(privilege)} checked={selected.includes(privilege)} onChange={event => {
            setSelected(event.target.checked ? [...selected, privilege] : selected.filter(item => item !== privilege)); reset();
          }}/>{privilege}
        </label>)}
      </div></fieldset>
      <button disabled={locked || !selected.length} onClick={() => void prepare()}>{t.preview}</button>
      {preview && <section>
        <p>{roles.actor} {preview.actor} · {roles.grantor} {preview.grantor}</p>
        <pre className="result-sql-preview" aria-label={t.sql}>{preview.sql}</pre>
        {!!preview.columns.length && <section aria-label={t.affected}>
          <h4>{t.affected}</h4><ul>{preview.columns.map(item => <li key={JSON.stringify([item.name, item.privilege])}>
            {item.name} · {item.privilege}
          </li>)}</ul>
        </section>}
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
