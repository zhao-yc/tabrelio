import { useEffect, useRef, useState } from 'react';
import type { PostgresConnectionProfile } from '../../shared/contracts';
import type { PostgresRoleDetail, PostgresRoleMembership, PostgresRolePrivilege, PostgresRoleRef, PostgresRolesInput, PostgresRolesList, PostgresRolesOutput } from '../../shared/postgresRoles';
import { errorMessage, invoke, uid } from '../lib';
import { postgresRolesZh as t } from '../locales/postgresRoles.zh-CN';
import { zh } from '../locales/zh-CN';
import { useWorkspace } from '../store';
import { ErrorBox, Field, Modal } from './ui';
import '../postgresRoles.css';

const yesNo = (value: boolean | null) => value === null ? t.unknown : value ? t.yes : t.no;
type RoleQuery = Extract<PostgresRolesInput, {kind: 'list'}>;
type DetailQuery = Extract<PostgresRolesInput, {kind: 'detail'}>;
type Scope = DetailQuery['scope'];

function Privileges({label, rows}: {label: string; rows: PostgresRolePrivilege[] | null}) {
  return <section><h4>{label}</h4>{rows ? <table aria-label={label}><thead><tr>
    <th scope="col">{t.privilege}</th><th scope="col">{t.allowed}</th><th scope="col">{t.grantable}</th>
  </tr></thead><tbody>{rows.map(row => <tr key={row.name}>
    <th scope="row">{row.name}</th><td>{yesNo(row.allowed)}</td><td>{yesNo(row.grantable)}</td>
  </tr>)}</tbody></table> : <p>{t.missing}</p>}</section>;
}

function Memberships({label, edges, busy, read}: {label: string; edges: PostgresRoleMembership[]; busy: boolean; read(role: PostgresRoleRef): void}) {
  return <section><h4>{label}</h4>{edges.length ? <table aria-label={label}><thead><tr>
    <th scope="col">{t.roleName}</th><th scope="col">{t.grantor}</th><th scope="col">{t.admin}</th>
    <th scope="col">{t.memberInherit}</th><th scope="col">{t.memberSet}</th>
  </tr></thead><tbody>{edges.map((edge, index) => <tr key={index}>
    <th scope="row"><button disabled={busy} onClick={() => read(edge.peer)}>{edge.peer.name}</button></th>
    <td>{edge.grantor ?? t.unknown}</td><td>{yesNo(edge.admin)}</td><td>{yesNo(edge.inherit)}</td><td>{yesNo(edge.set)}</td>
  </tr>)}</tbody></table> : <p>{t.noMembership}</p>}</section>;
}

/** 所有结果跟随一次明确读取。切换连接或关闭窗口时，不展示旧任务的迟到结果。 */
export function PostgresRolesDialog({connections, preferred, versions, onClose}: {
  connections: PostgresConnectionProfile[]; preferred?: {connectionId: string; database?: string};
  versions: Record<string, number>; onClose(): void;
}) {
  const initial = connections.find(profile => profile.id === preferred?.connectionId) ?? connections[0];
  const [connectionId, setConnectionId] = useState(initial?.id ?? '');
  const [database, setDatabase] = useState(preferred?.connectionId === initial?.id ? preferred?.database ?? '' : '');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState<{key: string; snapshot: PostgresRolesList; search: string; trail: string[]}>();
  const [inspection, setInspection] = useState<{key: string; snapshot: PostgresRoleDetail; scope?: Scope}>();
  const [schema, setSchema] = useState(''), [relation, setRelation] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const running = useRef<string | undefined>(undefined);
  const connection = connections.find(profile => profile.id === connectionId);
  const version = versions[connectionId] ?? 0;
  const key = JSON.stringify([connectionId, version, database]);
  const directory = page?.key === key ? page : undefined;
  const detail = inspection?.key === key ? inspection : undefined;
  useEffect(() => () => {
    const taskId = running.current;
    running.current = undefined;
    if (taskId) void invoke('query.cancel', {taskId}).catch(() => {});
  }, []);

  async function run(request: Omit<RoleQuery, 'connectionId' | 'database' | 'taskId'> | Omit<DetailQuery, 'connectionId' | 'database' | 'taskId'>,
    accept: (result: PostgresRolesOutput) => void) {
    if (!connection || running.current) return;
    const taskId = uid();
    running.current = taskId;
    setBusy(true); setError('');
    try {
      const result = await invoke('postgres.roles.read', {connectionId, taskId, ...(database ? {database} : {}), ...request});
      if (running.current !== taskId) return;
      const current = useWorkspace.getState();
      if (current.connections.find(profile => profile.id === connectionId) !== connection ||
          (current.connectionVersions[connectionId] ?? 0) !== version) throw Error(t.changed);
      accept(result);
    } catch (reason) { if (running.current === taskId) setError(errorMessage(reason)); }
    finally { if (running.current === taskId) { running.current = undefined; setBusy(false); } }
  }
  function readList(value: string, trail: string[] = []) {
    setInspection(undefined);
    const after = trail.at(-1);
    void run({kind: 'list', search: value, ...(after ? {after} : {})}, snapshot => {
      if (snapshot.kind === 'list') setPage({key, snapshot, search: value, trail});
    });
  }
  function readDetail({oid, name}: PostgresRoleRef, scope?: Scope) {
    setInspection(undefined);
    void run({kind: 'detail', role: {oid, name}, ...(scope ? {scope} : {})}, snapshot => {
      if (snapshot.kind === 'detail') setInspection({key, snapshot, scope});
    });
  }
  const context = detail?.snapshot ?? directory?.snapshot;
  const role = detail?.snapshot.role;
  const reset = () => { setError(''); setPage(undefined); setInspection(undefined); };
  return <Modal title={t.title} wide onClose={onClose}>
    <div className="modal-content postgres-roles" aria-busy={busy}>
      <p>{t.hint}</p>
      <form onSubmit={event => {event.preventDefault(); readList(search);}}>
        <div className="form-grid">
          <Field label={t.connection}><select value={connectionId} disabled={busy} onChange={event => {
            setConnectionId(event.target.value); setDatabase(''); reset();
          }}>{connections.map(profile => <option value={profile.id} key={profile.id}>{profile.name}</option>)}</select></Field>
          <Field label={t.database}><input value={database} maxLength={256} placeholder={t.defaultDatabase} disabled={busy}
            onChange={event => {setDatabase(event.target.value); reset();}}/></Field>
          <Field label={t.search}><input value={search} maxLength={128} disabled={busy} onChange={event => setSearch(event.target.value)}/></Field>
          <div className="postgres-roles-actions"><button type="submit" disabled={!connection || busy}>{t.read}</button></div>
        </div>
      </form>
      {busy && <p role="status">{t.busy}</p>}
      <ErrorBox message={error}/>
      {context && <p>{t.session(context.database, context.login, context.current.name)}{' '}
        <button disabled={busy} onClick={() => readDetail(context.current)}>{t.current}</button></p>}
      {directory && <section aria-label={t.directory}>
        <h3>{t.directory}</h3>
        {directory.snapshot.roles.length ? <ul className="postgres-roles-list">{directory.snapshot.roles.map(item =>
          <li key={item.oid}><button aria-pressed={role?.oid === item.oid} disabled={busy} onClick={() => readDetail(item)}>{item.name}</button>
            <span>{item.login ? t.login : t.noLogin}{item.superuser ? ' · ' + t.superuser : ''}</span></li>)}</ul> : <p>{t.empty}</p>}
        <div className="postgres-roles-actions">
          <button disabled={busy || !directory.trail.length} onClick={() => readList(directory.search, directory.trail.slice(0, -1))}>{t.previous}</button>
          <button disabled={busy || !directory.snapshot.next} onClick={() => readList(directory.search, [...directory.trail, directory.snapshot.next!])}>{t.next}</button>
        </div>
      </section>}
      {detail && role && <section aria-label={t.attributes}>
        <h3>{role.name}</h3>
        <dl className="postgres-roles-attributes">{[
          [t.login, yesNo(role.login)], [t.superuser, yesNo(role.superuser)], [t.inherit, yesNo(role.inherit)], [t.createRole, yesNo(role.createRole)],
          [t.createDatabase, yesNo(role.createDatabase)], [t.replication, yesNo(role.replication)], [t.bypassRls, yesNo(role.bypassRls)],
          [t.connectionLimit, role.connectionLimit < 0 ? t.unlimited : role.connectionLimit], [t.validUntil, role.validUntil ?? t.noExpiry],
        ].map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>
        <div className="postgres-roles-sections">
          <Memberships label={t.granted} edges={detail.snapshot.memberships.granted} busy={busy} read={readDetail}/>
          <Memberships label={t.members} edges={detail.snapshot.memberships.members} busy={busy} read={readDetail}/>
        </div>
        {detail.snapshot.memberships.limited && <p>{t.limited}</p>}
        <Privileges label={t.databasePrivileges} rows={detail.snapshot.databasePrivileges}/>
        <form className="form-grid" onSubmit={event => {event.preventDefault(); if (schema) readDetail(role, {schema, ...(relation ? {relation} : {})});}}>
          <Field label={t.schema}><input value={schema} maxLength={256} disabled={busy} onChange={event => setSchema(event.target.value)}/></Field>
          <Field label={t.relation}><input value={relation} maxLength={256} disabled={busy} onChange={event => setRelation(event.target.value)}/></Field>
          <div className="postgres-roles-actions"><button type="submit" disabled={!schema || busy}>{t.probe}</button></div>
        </form>
        {detail.scope && detail.snapshot.scope && <div className="postgres-roles-sections">
          <Privileges label={t.schemaPrivileges + ' · ' + detail.scope.schema} rows={detail.snapshot.scope.schema}/>
          {detail.scope.relation && <div><Privileges label={t.relationPrivileges + ' · ' + detail.scope.relation}
            rows={detail.snapshot.scope.relation?.privileges ?? null}/>
            {detail.snapshot.scope.relation && <p>{t.rowSecurity} · {yesNo(detail.snapshot.scope.relation.rls)} ／ {t.forceRls} · {yesNo(detail.snapshot.scope.relation.forceRls)}</p>}</div>}
        </div>}
      </section>}
    </div>
    <footer className="modal-footer"><button onClick={onClose}>{zh.common.close}</button></footer>
  </Modal>;
}
