import { useRef, useState } from 'react';
import { postgresColumnPrivilegeDraftSchema, postgresScopedPrivilegeDraftSchema, postgresTablePrivilegeDraftSchema, type PostgresMembershipOutcome,
  type PostgresColumnPrivilegeChange, type PostgresColumnPrivilegeEditor, type PostgresObjectPrivilege, type PostgresRoleRef, type PostgresScopedPrivilegeEditor, type PostgresTablePrivilegeDraft,
  type PostgresTablePrivilegeEditor, type PostgresTablePrivilegePreview } from '../../shared/postgresRoles';
import { errorMessage, invoke } from '../lib';
import { postgresRolesZh as roles } from '../locales/postgresRoles.zh-CN';
import { zh } from '../locales/zh-CN';
import { ErrorBox, Field, Modal } from './ui';
import { PostgresColumnPrivilegesGrid } from './PostgresColumnPrivilegesGrid';

const t = roles.tablePrivileges;
type Action = PostgresTablePrivilegeDraft['action'];

export function PostgresObjectPrivilegesDialog({connectionId, database, role, editor, privileges, current, onClose}: {
  connectionId: string; database: string; role: PostgresRoleRef; editor: PostgresTablePrivilegeEditor | PostgresScopedPrivilegeEditor | PostgresColumnPrivilegeEditor;
  privileges: readonly PostgresObjectPrivilege[]; current(): boolean; onClose(refresh: boolean): void;
}) {
  const [action, setAction] = useState<Action>('grant'), [selected, setSelected] = useState<PostgresObjectPrivilege[]>([]);
  const [changes, setChanges] = useState<PostgresColumnPrivilegeChange[]>([]);
  const [preview, setPreview] = useState<PostgresTablePrivilegePreview>(), [confirmed, setConfirmed] = useState(false);
  const [outcome, setOutcome] = useState<PostgresMembershipOutcome>();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const pending = useRef(false);
  const scope = 'columns' in editor ? 'column' : 'object' in editor ? editor.object.kind : 'table';
  const copy = scope === 'table' ? t : t[scope];
  const locked = busy || !!outcome || !current();
  const reset = () => {setPreview(undefined); setConfirmed(false); setError('');};
  const selectionCount = scope === 'column' ? changes.length : selected.length;
  function available(direct: boolean | null) {
    switch (action) {
      case 'grant': return direct === null;
      case 'grantOption': return direct !== true;
      case 'revoke': return direct !== null;
      case 'revokeOption': return direct === true;
    }
  }

  async function prepare() {
    if (pending.current || locked || !selectionCount) return;
    pending.current = true; setBusy(true); reset();
    try {
      const draft = {connectionId, database, role, action, privileges: selected};
      const result = 'columns' in editor
        ? await invoke('postgres.roles.columnPrivileges.preview', postgresColumnPrivilegeDraftSchema.parse({connectionId, database, role, action, table: editor.table, changes}))
        : 'table' in editor
          ? await invoke('postgres.roles.tablePrivileges.preview', postgresTablePrivilegeDraftSchema.parse({...draft, table: editor.table}))
          : await invoke('postgres.roles.scopedPrivileges.preview', postgresScopedPrivilegeDraftSchema.parse({...draft, object: editor.object}));
      if (!current()) throw Error(roles.changed);
      setPreview(result);
    } catch (reason) {setError(errorMessage(reason));}
    finally {pending.current = false; setBusy(false);}
  }

  /** 确认只消费已展示的预览。回执未知时关闭后重新读取实际授权。 */
  async function apply() {
    if (pending.current || locked || !confirmed || !preview) return;
    pending.current = true; setBusy(true); setConfirmed(false); setError('');
    try {
      const input = {connectionId, database, token: preview.token, confirmed: true as const};
      const command = scope === 'column' ? 'postgres.roles.columnPrivileges.apply' :
        scope === 'table' ? 'postgres.roles.tablePrivileges.apply' : 'postgres.roles.scopedPrivileges.apply';
      setOutcome(await invoke(command, input));
    }
    catch (reason) {setOutcome({outcome: 'unknown', message: errorMessage(reason)});}
    finally {pending.current = false; setBusy(false);}
  }
  const close = () => {if (!pending.current) onClose(!!outcome);};

  return <Modal title={copy.title} wide onClose={close}>
    <div className="modal-content postgres-roles" aria-busy={busy}>
      <p>{database}{'table' in editor ? ' · ' + editor.table.schema + ' / ' + editor.table.name : editor.object.kind === 'schema' ? ' · ' + editor.object.name : ''} · {roles.roleName} {role.name}</p>
      <p>{roles.grantor} {editor.grantor}</p>
      <p>{t.hint} {copy.lockHint}</p>
      {'direct' in editor && <p>{t.direct} · {editor.direct.map(item => item.privilege + (item.grantable ? ' WITH GRANT OPTION' : '')).join('、') || t.inherited}</p>}
      <Field label={t.action}><select aria-label={t.action} value={action} disabled={locked} onChange={event => {
        setAction(event.target.value as Action); setSelected([]); setChanges([]); reset();
      }}>{Object.entries(t.actions).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field>
      <fieldset><legend>{copy.selection}</legend>
        {'columns' in editor ? <PostgresColumnPrivilegesGrid rows={editor.columns} control={(column, privilege) => {
          const same = (item: PostgresColumnPrivilegeChange) => item.column.number === column.number && item.privilege === privilege.name;
          return <input type="checkbox" aria-label={column.name + ' ' + privilege.name} checked={changes.some(same)}
            disabled={locked || !available(privilege.direct)} onChange={event => {
              setChanges(event.target.checked ? [...changes, {column, privilege: privilege.name}] : changes.filter(item => !same(item)));
              reset();
            }}/>;
        }}/> : <div className="form-grid">
          {privileges.map(privilege => <label key={privilege}>
            <input type="checkbox" disabled={locked || !available(editor.direct.find(item => item.privilege === privilege)?.grantable ?? null)}
              checked={selected.includes(privilege)} onChange={event => {
                setSelected(event.target.checked ? [...selected, privilege] : selected.filter(item => item !== privilege)); reset();
              }}/>{privilege}
          </label>)}
        </div>}
      </fieldset>
      <button disabled={locked || !selectionCount} onClick={() => void prepare()}>{copy.preview}</button>
      {preview && <section>
        <p>{roles.actor} {preview.actor} · {roles.grantor} {preview.grantor}</p>
        <pre className="result-sql-preview" aria-label={copy.sql}>{preview.sql}</pre>
        {!!preview.columns.length && <section aria-label={t.affected}>
          <h4>{t.affected}</h4><ul>{preview.columns.map(item => <li key={JSON.stringify([item.name, item.privilege])}>
            {item.name} · {item.privilege}
          </li>)}</ul>
        </section>}
        {!outcome && <label><input type="checkbox" checked={confirmed} disabled={locked}
          onChange={event => setConfirmed(event.target.checked)}/>{copy.confirm}</label>}
      </section>}
      {outcome && <p role={outcome.outcome === 'committed' ? 'status' : 'alert'}>{roles.result[outcome.outcome]} · {outcome.message}</p>}
      <ErrorBox message={error || (!current() ? roles.changed : '')}/>
    </div>
    <footer className="modal-footer">
      <button disabled={busy} onClick={close}>{zh.common.close}</button>
      <button className="primary" disabled={locked || !confirmed || !preview} onClick={() => void apply()}>{copy.apply}</button>
    </footer>
  </Modal>;
}
