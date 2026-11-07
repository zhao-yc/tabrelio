import { useEffect, useRef, useState } from 'react';
import type { PostgresConnectionProfile } from '../../shared/contracts';
import { postgresDatabasePrivileges, postgresRoutinePrivileges, postgresSchemaPrivileges, postgresSequencePrivileges, postgresTablePrivileges, type PostgresObjectPrivilege,
  type PostgresColumnPrivilegeEditor, type PostgresScopedPrivilegeEditor, type PostgresTablePrivilegeEditor } from '../../shared/postgresRoles';
import type { PostgresRoleDetail, PostgresRoleMembership, PostgresRolePrivilege, PostgresRoleRef, PostgresRolesInput, PostgresRolesList, PostgresRolesOutput } from '../../shared/postgresRoles';
import { errorMessage, invoke, uid } from '../lib';
import { postgresRolesZh as t } from '../locales/postgresRoles.zh-CN';
import { zh } from '../locales/zh-CN';
import { useWorkspace } from '../store';
import { ErrorBox, Field, Modal } from './ui';
import { PostgresMembershipDialog, type MembershipIntent } from './PostgresMembershipDialog';
import { PostgresRoleCreateDialog } from './PostgresRoleCreateDialog';
import { PostgresRolePasswordDialog } from './PostgresRolePasswordDialog';
import { PostgresObjectPrivilegesDialog } from './PostgresObjectPrivilegesDialog';
import { PostgresColumnPrivilegesGrid } from './PostgresColumnPrivilegesGrid';
import '../postgresRoles.css';

const yesNo = (value: boolean | null) => value === null ? t.unknown : value ? t.yes : t.no;
type RoleQuery = Extract<PostgresRolesInput, {kind: 'list'}>;
type DetailQuery = Extract<PostgresRolesInput, {kind: 'detail'}>;
type Scope = DetailQuery['scope'];
type PrivilegeEditor = PostgresTablePrivilegeEditor | PostgresScopedPrivilegeEditor | PostgresColumnPrivilegeEditor;
type RoleSource = {connection: PostgresConnectionProfile; version: number; database: string};
function sourceCurrent({connection, version}: RoleSource) {
  const current = useWorkspace.getState();
  return current.connections.find(profile => profile.id === connection.id) === connection &&
    (current.connectionVersions[connection.id] ?? 0) === version;
}

function Privileges({label, rows}: {label: string; rows: PostgresRolePrivilege[] | null}) {
  const shared = rows?.filter(row => row.publicAllowed).map(row => row.name).join('、');
  return <section><h4>{label}</h4>{rows ? <table aria-label={label}><thead><tr>
    <th scope="col">{t.privilege}</th><th scope="col">{t.allowed}</th><th scope="col">{t.grantable}</th>
  </tr></thead><tbody>{rows.map(row => <tr key={row.name}>
    <th scope="row">{row.name}</th><td>{yesNo(row.allowed)}</td><td>{yesNo(row.grantable)}</td>
  </tr>)}</tbody></table> : <p>{t.missing}</p>}
    {rows?.some(row => row.publicAllowed !== undefined) && <p>{t.tablePrivileges.publicSummary} · {shared || t.tablePrivileges.publicNone}</p>}
  </section>;
}

function Memberships({label, edges, busy, read, revoke, protectedPeer}: {
  label: string; edges: PostgresRoleMembership[]; busy: boolean; read(role: PostgresRoleRef): void; revoke?(edge: PostgresRoleMembership): void;
  protectedPeer(name: string): boolean;
}) {
  return <section><h4>{label}</h4>{edges.length ? <table aria-label={label}><thead><tr>
    <th scope="col">{t.roleName}</th><th scope="col">{t.grantor}</th><th scope="col">{t.admin}</th>
    <th scope="col">{t.memberInherit}</th><th scope="col">{t.memberSet}</th>{revoke && <th scope="col">{t.membership}</th>}
  </tr></thead><tbody>{edges.map((edge, index) => <tr key={index}>
    <th scope="row"><button disabled={busy} onClick={() => read(edge.peer)}>{edge.peer.name}</button></th>
    <td>{edge.grantor ?? t.unknown}</td><td>{yesNo(edge.admin)}</td><td>{yesNo(edge.inherit)}</td><td>{yesNo(edge.set)}</td>
    {revoke && <td>{edge.grantor && edge.grantorOid && edge.set !== null && !protectedPeer(edge.peer.name) &&
      <button disabled={busy} aria-label={t.revoke + ' ' + edge.peer.name} onClick={() => revoke(edge)}>{t.revoke}</button>}</td>}
  </tr>)}</tbody></table> : <p>{t.noMembership}</p>}</section>;
}

/** 所有结果跟随一次明确读取。切换连接或关闭窗口时，不展示旧任务的迟到结果。 */
export function PostgresRolesDialog({connections, preferred, versions, onClose, onEditConnection}: {
  connections: PostgresConnectionProfile[]; preferred?: {connectionId: string; database?: string};
  versions: Record<string, number>; onClose(): void; onEditConnection(profile: PostgresConnectionProfile): void;
}) {
  const initial = connections.find(profile => profile.id === preferred?.connectionId) ?? connections[0];
  const [connectionId, setConnectionId] = useState(initial?.id ?? '');
  const [database, setDatabase] = useState(preferred?.connectionId === initial?.id ? preferred?.database ?? '' : '');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState<{key: string; snapshot: PostgresRolesList; search: string; trail: string[]}>();
  const [inspection, setInspection] = useState<{key: string; snapshot: PostgresRoleDetail; scope?: Scope; columnTrail: number[]}>();
  const [schema, setSchema] = useState(''), [relation, setRelation] = useState('');
  const [membership, setMembership] = useState<RoleSource & {intent: MembershipIntent; role: PostgresRoleRef; scope?: Scope}>();
  const [creation, setCreation] = useState<RoleSource>();
  const [objectAccess, setObjectAccess] = useState<RoleSource & {role: PostgresRoleRef; scope: Scope; editor: PrivilegeEditor; privileges: readonly PostgresObjectPrivilege[]}>();
  const [rotation, setRotation] = useState<RoleSource & {role: PostgresRoleRef}>();
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
      if (!sourceCurrent({connection, version, database})) throw Error(t.changed);
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
  function readDetail({oid, name}: PostgresRoleRef, scope?: Scope, columnTrail = scope?.columns ? detail?.columnTrail ?? [] : []) {
    setInspection(undefined);
    void run({kind: 'detail', role: {oid, name}, ...(scope ? {scope} : {})}, snapshot => {
      if (snapshot.kind === 'detail') setInspection({key, snapshot, scope, columnTrail});
    });
  }
  const context = detail?.snapshot ?? directory?.snapshot;
  const role = detail?.snapshot.role;
  const reset = () => { setError(''); setPage(undefined); setInspection(undefined); };
  if (objectAccess) return <PostgresObjectPrivilegesDialog connectionId={objectAccess.connection.id} database={objectAccess.database}
    role={objectAccess.role} editor={objectAccess.editor} privileges={objectAccess.privileges}
    current={() => sourceCurrent(objectAccess)} onClose={refresh => {
      setObjectAccess(undefined);
      if (refresh && sourceCurrent(objectAccess)) readDetail(objectAccess.role, objectAccess.scope);
    }}/>;
  if (rotation) return <PostgresRolePasswordDialog
    target={{connectionId: rotation.connection.id, database: rotation.database, role: rotation.role}}
    current={() => sourceCurrent(rotation)} onClose={invalidate => {
      setRotation(undefined);
      if (invalidate) reset();
    }} onEditConnection={() => {
      if (sourceCurrent(rotation)) onEditConnection(rotation.connection);
    }}/>;
  if (creation) return <PostgresRoleCreateDialog connectionId={creation.connection.id} database={creation.database}
    current={() => sourceCurrent(creation)} onClose={name => {
      setCreation(undefined);
      if (name && sourceCurrent(creation)) { setSearch(name); readList(name); }
    }}/>;
  if (membership) return <PostgresMembershipDialog intent={membership.intent} connectionId={membership.connection.id}
      database={membership.database} current={() => sourceCurrent(membership)} onClose={refresh => {
        setMembership(undefined);
        if (refresh && sourceCurrent(membership)) readDetail(membership.role, membership.scope);
      }}/>;
  const edit = (intent: MembershipIntent) => {
    if (!connection || !detail || !role || running.current) return;
    setMembership({intent, connection, version, database: detail.snapshot.database, role, scope: detail.scope});
  };
  function editPrivileges(editor: PrivilegeEditor, privileges: readonly PostgresObjectPrivilege[] = []) {
    if (!connection || !detail || !role || running.current) return;
    setObjectAccess({connection, version, database: detail.snapshot.database, role: {oid: role.oid, name: role.name},
      scope: detail.scope, editor, privileges});
  }
  function readColumns(trail: number[]) {
    const relation = detail?.snapshot.scope?.relation;
    if (!role || !detail?.scope || !relation) return;
    readDetail(role, {...detail.scope, columns: {relationOid: relation.oid, after: trail.at(-1) ?? 0}}, trail);
  }
  const protectedRole = (name: string) => name === context?.login || name === context?.current.name;
  const revoke = (edge: PostgresRoleMembership, target: PostgresRoleRef, member: PostgresRoleRef) => {
    if (!edge.grantor || !edge.grantorOid || protectedRole(target.name) || protectedRole(member.name)) return;
    edit({action: 'revoke', member: {oid: member.oid, name: member.name}, role: {oid: target.oid, name: target.name},
      grantor: {oid: edge.grantorOid, name: edge.grantor}});
  };
  return <Modal title={t.title} wide onClose={onClose}>
    <div className="modal-content postgres-roles" aria-busy={busy}>
      <p>{t.hint}</p>
      <form onSubmit={event => {event.preventDefault(); readList(search);}}>
        <div className="form-grid">
          <Field label={t.connection}><select aria-label={t.connection} value={connectionId} disabled={busy} onChange={event => {
            setConnectionId(event.target.value); setDatabase(''); reset();
          }}>{connections.map(profile => <option value={profile.id} key={profile.id}>{profile.name}</option>)}</select></Field>
          <Field label={t.database}><input value={database} maxLength={256} placeholder={t.defaultDatabase} disabled={busy}
            onChange={event => {setDatabase(event.target.value); reset();}}/></Field>
          <Field label={t.search}><input value={search} maxLength={128} disabled={busy} onChange={event => setSearch(event.target.value)}/></Field>
          <div className="postgres-roles-actions"><button type="submit" disabled={!connection || busy}>{t.read}</button>
            <button type="button" disabled={!connection || busy} onClick={() => {
              if (connection && !running.current) setCreation({connection, version, database});
            }}>{t.create.open}</button></div>
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
        {connection && role.login && role.oid === detail.snapshot.current.oid && role.name === detail.snapshot.login && role.name === connection.user &&
          <button disabled={busy} onClick={() => {
            setRotation({connection, version, database: detail.snapshot.database, role: {oid: role.oid, name: role.name}});
          }}>{t.password.open}</button>}
        {!protectedRole(role.name) && <button disabled={busy}
          onClick={() => edit({action: 'grant', member: {oid: role.oid, name: role.name}})}>{t.grant}</button>}
        <dl className="postgres-roles-attributes">{[
          [t.login, yesNo(role.login)], [t.superuser, yesNo(role.superuser)], [t.inherit, yesNo(role.inherit)], [t.createRole, yesNo(role.createRole)],
          [t.createDatabase, yesNo(role.createDatabase)], [t.replication, yesNo(role.replication)], [t.bypassRls, yesNo(role.bypassRls)],
          [t.connectionLimit, role.connectionLimit < 0 ? t.unlimited : role.connectionLimit], [t.validUntil, role.validUntil ?? t.noExpiry],
        ].map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>
        <div className="postgres-roles-sections">
          <Memberships label={t.granted} edges={detail.snapshot.memberships.granted} busy={busy} read={readDetail} protectedPeer={protectedRole}
            revoke={protectedRole(role.name) ? undefined : edge => revoke(edge, edge.peer, role)}/>
          <Memberships label={t.members} edges={detail.snapshot.memberships.members} busy={busy} read={readDetail} protectedPeer={protectedRole}
            revoke={protectedRole(role.name) ? undefined : edge => revoke(edge, role, edge.peer)}/>
        </div>
        {detail.snapshot.memberships.limited && <p>{t.limited}</p>}
        <Privileges label={t.databasePrivileges} rows={detail.snapshot.databasePrivileges}/>
        {detail.snapshot.databaseEditor && <button disabled={busy} onClick={() =>
          editPrivileges(detail.snapshot.databaseEditor!, postgresDatabasePrivileges)}>{t.tablePrivileges.database.open}</button>}
        {detail.snapshot.databasePublicEditor && <button disabled={busy} onClick={() =>
          editPrivileges(detail.snapshot.databasePublicEditor!, postgresDatabasePrivileges)}>{t.tablePrivileges.database.publicOpen}</button>}
        <form className="form-grid" onSubmit={event => {event.preventDefault(); if (schema) readDetail(role, {schema, ...(relation ? {relation} : {})});}}>
          <Field label={t.schema}><input value={schema} maxLength={256} disabled={busy} onChange={event => setSchema(event.target.value)}/></Field>
          <Field label={t.relation}><input value={relation} maxLength={256} disabled={busy} onChange={event => setRelation(event.target.value)}/></Field>
          <div className="postgres-roles-actions"><button type="submit" disabled={!schema || busy}>{t.probe}</button>
            <button type="button" disabled={!schema || !relation || busy} onClick={() => readDetail(role, {schema, routine: relation})}>
              {t.tablePrivileges.routine.inspect}
            </button>
          </div>
        </form>
        {detail.scope && detail.snapshot.scope && <div className="postgres-roles-sections">
          <div><Privileges label={t.schemaPrivileges + ' · ' + detail.scope.schema} rows={detail.snapshot.scope.schema}/>
            {detail.snapshot.scope.schemaEditor && <button disabled={busy} onClick={() =>
              editPrivileges(detail.snapshot.scope!.schemaEditor!, postgresSchemaPrivileges)}>{t.tablePrivileges.schema.open}</button>}
            {detail.snapshot.scope.schemaPublicEditor && <button disabled={busy} onClick={() =>
              editPrivileges(detail.snapshot.scope!.schemaPublicEditor!, postgresSchemaPrivileges)}>{t.tablePrivileges.schema.publicOpen}</button>}
          </div>
          {detail.snapshot.scope.sequence && <div>
            <Privileges label={t.tablePrivileges.sequence.effective + ' · ' + detail.scope.relation} rows={detail.snapshot.scope.sequence.privileges}/>
            {detail.snapshot.scope.sequence.editor && <button disabled={busy} onClick={() =>
              editPrivileges(detail.snapshot.scope!.sequence!.editor!, postgresSequencePrivileges)}>{t.tablePrivileges.sequence.open}</button>}
          </div>}
          {detail.scope.relation && !detail.snapshot.scope.sequence && <div><Privileges label={t.relationPrivileges + ' · ' + detail.scope.relation}
            rows={detail.snapshot.scope.relation?.privileges ?? null}/>
            {connection && detail.snapshot.scope.relation?.editor && <button disabled={busy} onClick={() => {
              const relation = detail.snapshot.scope?.relation;
              if (relation?.editor) editPrivileges(relation.editor, postgresTablePrivileges.filter(name => relation.privileges.some(item => item.name === name)));
            }}>{t.tablePrivileges.open}</button>}
            {detail.snapshot.scope.relation && !detail.scope.columns && <button disabled={busy} onClick={() => readColumns([])}>
              {t.tablePrivileges.column.inspect}
            </button>}
            {detail.snapshot.scope.relation && <p>{t.rowSecurity} · {yesNo(detail.snapshot.scope.relation.rls)} ／ {t.forceRls} · {yesNo(detail.snapshot.scope.relation.forceRls)}</p>}</div>}
        </div>}
        {detail.snapshot.scope?.routines && <section aria-label={t.tablePrivileges.routine.label}>
          <h4>{t.tablePrivileges.routine.label}</h4>
          {detail.snapshot.scope.routines.rows.length ? <div className="postgres-column-privileges">
            <table aria-label={t.tablePrivileges.routine.label}><thead><tr>
              <th scope="col">{t.tablePrivileges.routine.signature}</th><th scope="col">{t.tablePrivileges.routine.kind}</th>
              <th scope="col">{t.allowed}</th><th scope="col">{t.grantable}</th>
              <th scope="col">{t.tablePrivileges.routine.direct}</th><th scope="col">{t.tablePrivileges.routine.publicExecute}</th>
              <th scope="col">{t.tablePrivileges.action}</th>
            </tr></thead><tbody>{detail.snapshot.scope.routines.rows.map(row => <tr key={row.oid}>
              <th scope="row"><code>{row.signature}</code></th><td>{t.tablePrivileges.routine.kinds[row.kind]}</td>
              <td>{yesNo(row.effective.allowed)}</td><td>{yesNo(row.effective.grantable)}</td>
              <td>{row.direct ? t.tablePrivileges.routine.withOption : yesNo(row.direct !== null)}</td><td>{yesNo(row.publicExecute)}</td>
              <td><div className="postgres-roles-actions">
                {row.editor && <button disabled={busy} onClick={() => editPrivileges(row.editor!, postgresRoutinePrivileges)}>
                  {t.tablePrivileges.routine.open}
                </button>}
                {row.publicEditor && <button disabled={busy} onClick={() => editPrivileges(row.publicEditor!, postgresRoutinePrivileges)}>
                  {t.tablePrivileges.routine.publicOpen}
                </button>}
              </div></td>
            </tr>)}</tbody></table>
          </div> : <p>{t.tablePrivileges.routine.empty}</p>}
          {detail.snapshot.scope.routines.limited && <p>{t.tablePrivileges.routine.limited}</p>}
        </section>}
        {detail.snapshot.scope?.relation?.columns && <section aria-label={t.tablePrivileges.column.label}>
          <h4>{t.tablePrivileges.column.label} · {detail.scope?.relation}</h4>
          <p>{t.tablePrivileges.column.legend}</p>
          <PostgresColumnPrivilegesGrid rows={detail.snapshot.scope.relation.columns.rows}/>
          <div className="postgres-roles-actions">
            <button disabled={busy || !detail.columnTrail.length} onClick={() => readColumns(detail.columnTrail.slice(0, -1))}>{t.previous}</button>
            <button disabled={busy || detail.snapshot.scope.relation.columns.next === undefined} onClick={() => {
              const next = detail.snapshot.scope?.relation?.columns?.next;
              if (next !== undefined) readColumns([...detail.columnTrail, next]);
            }}>{t.next}</button>
            {detail.snapshot.scope.relation.editor && <button disabled={busy || !detail.snapshot.scope.relation.columns.rows.length} onClick={() => {
              const relation = detail.snapshot.scope?.relation;
              if (relation?.editor && relation.columns)
                editPrivileges({table: relation.editor.table, grantor: relation.editor.grantor, columns: relation.columns.rows});
            }}>{t.tablePrivileges.column.open}</button>}
          </div>
        </section>}
      </section>}
    </div>
    <footer className="modal-footer"><button onClick={onClose}>{zh.common.close}</button></footer>
  </Modal>;
}
