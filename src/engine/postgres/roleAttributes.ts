import { createHash } from 'node:crypto';
import type { DataRow } from '../../shared/contracts';
import { postgresDdlLiteral } from '../../shared/postgresCreateTable';
import { postgresRoleAttributeFlags, type PostgresRole, type PostgresRoleAttributeEditor, type PostgresRoleAttributesDraft,
  type PostgresRoleRef, type PostgresRoleRenameDraft } from '../../shared/postgresRoles';
import { postgresIdentifier } from '../../shared/postgresSql';
import type { PostgresConnection } from './connection';

// 驱动会消耗传入的预算，每次目录读取需要独立实例。
const budget = () => ({rows: 1, bytes: 16 * 1024});
export const postgresRoleFields = 'r.oid::text,r.rolname::text,r.rolcanlogin,r.rolsuper,r.rolinherit,r.rolcreaterole,r.rolcreatedb,r.rolreplication,r.rolbypassrls,r.rolconnlimit::text,r.rolvaliduntil::text';

export function parsePostgresRole(row: DataRow): PostgresRole {
  const string = (value: unknown) => {
    if (typeof value !== 'string') throw Error('PostgreSQL 角色目录返回不完整');
    return value;
  };
  const flag = (value: unknown) => {
    if (value !== 't' && value !== 'f') throw Error('PostgreSQL 角色目录返回不完整');
    return value === 't';
  };
  const connectionLimit = Number(string(row.c9));
  if (!Number.isSafeInteger(connectionLimit)) throw Error('PostgreSQL 角色目录返回不完整');
  return {oid: string(row.c0), name: string(row.c1), login: flag(row.c2), superuser: flag(row.c3), inherit: flag(row.c4),
    createRole: flag(row.c5), createDatabase: flag(row.c6), replication: flag(row.c7), bypassRls: flag(row.c8),
    connectionLimit, validUntil: row.c10 === null ? null : string(row.c10)};
}

function roleStamp(role: PostgresRole) {
  return createHash('sha256').update(JSON.stringify(role)).digest('hex');
}

/** 执行者只能管理非自身角色，属性编辑和改名使用各自的服务端权限范围。 */
export async function readRoleManagementTarget(connection: PostgresConnection, role: PostgresRole) {
  if (role.name.startsWith('pg_')) return;
  const result = await connection.query(`SELECT a.oid::text,a.rolname::text,session_user::text,a.rolsuper,a.rolcreaterole,
    a.rolcreatedb,a.rolreplication,a.rolbypassrls,d.oid::text,d.datname::text,extract(epoch FROM pg_catalog.pg_postmaster_start_time())::text,
    CASE WHEN pg_catalog.current_setting('server_version_num')::int>=160000
      THEN pg_catalog.pg_has_role(a.oid,$1::oid,'MEMBER WITH ADMIN OPTION') ELSE false END,
    pg_catalog.current_setting('server_version_num')::int>=160000
    FROM pg_catalog.pg_roles a CROSS JOIN pg_catalog.pg_database d WHERE a.rolname=current_user AND d.datname=pg_catalog.current_database()`,
  [role.oid], budget());
  const row = result.rows[0];
  if (!row || result.truncated || typeof row.c1 !== 'string' || typeof row.c9 !== 'string' || row.c12 !== 't' ||
      row.c0 === role.oid || row.c2 === role.name) return;
  const superuser = row.c3 === 't';
  if (!superuser && (row.c4 !== 't' || row.c11 !== 't' || role.superuser)) return;
  const flags = postgresRoleAttributeFlags.filter(key => {
    switch (key) {
      case 'superuser': return superuser && role.oid !== '10';
      case 'createDatabase': return superuser || row.c5 === 't';
      case 'replication': return superuser || row.c6 === 't';
      case 'bypassRls': return superuser || row.c7 === 't';
      default: return true;
    }
  });
  const renameStamp = roleStamp(role);
  const attributeEditor: PostgresRoleAttributeEditor | undefined = superuser || !role.replication ? {stamp: renameStamp, flags} : undefined;
  return {attributeEditor, renameStamp, actor: row.c1, database: row.c9, stamp: JSON.stringify([row, role])};
}

async function readRole(connection: PostgresConnection, role: PostgresRoleRef) {
  const result = await connection.query(`SELECT ${postgresRoleFields},extract(epoch FROM r.rolvaliduntil)::text
    FROM pg_catalog.pg_roles r WHERE r.oid=$1::oid AND r.rolname::text COLLATE pg_catalog."C"=$2`, [role.oid, role.name], budget());
  const row = result.rows[0];
  if (!row || result.truncated) throw Error('原角色已变化，请重新读取角色目录');
  return {role: parsePostgresRole(row), expiryEpoch: row.c11};
}

const keywords = {login: 'LOGIN', inherit: 'INHERIT', createDatabase: 'CREATEDB', createRole: 'CREATEROLE', superuser: 'SUPERUSER',
  replication: 'REPLICATION', bypassRls: 'BYPASSRLS'} as const;

export async function prepareRoleAttributes(connection: PostgresConnection, draft: PostgresRoleAttributesDraft) {
  const {role: original, expiryEpoch} = await readRole(connection, draft.role);
  const target = await readRoleManagementTarget(connection, original);
  if (!target?.attributeEditor) throw Error('当前角色无权编辑此角色，或目标是当前登录角色');
  if (target.database !== draft.database || target.attributeEditor.stamp !== draft.stamp)
    throw Error('原角色属性或数据库已变化，请重新读取角色目录');
  const expected = {...original};
  const clauses: string[] = [];
  for (const key of postgresRoleAttributeFlags) {
    const value = draft.patch[key];
    if (value === undefined || value === original[key]) continue;
    if (!target.attributeEditor.flags.includes(key)) throw Error('当前角色无权修改 ' + keywords[key]);
    expected[key] = value;
    clauses.push((value ? '' : 'NO') + keywords[key]);
  }
  if (draft.patch.connectionLimit !== undefined && draft.patch.connectionLimit !== original.connectionLimit) {
    expected.connectionLimit = draft.patch.connectionLimit;
    clauses.push('CONNECTION LIMIT ' + expected.connectionLimit);
  }
  const requestedExpiry = draft.patch.validUntil;
  const expiryUnchanged = requestedExpiry === 'infinity' ? original.validUntil === null || original.validUntil === 'infinity' :
    requestedExpiry !== undefined && expiryEpoch !== null && Number(expiryEpoch) === Date.parse(requestedExpiry) / 1000;
  const expiry = expiryUnchanged ? undefined : requestedExpiry;
  if (expiry !== undefined) clauses.push('VALID UNTIL ' + postgresDdlLiteral(expiry));
  if (!clauses.length) throw Error('角色属性没有变化');
  return {...target, expected, expiry, sql: 'ALTER ROLE ' + postgresIdentifier(draft.role.name) + ' WITH\n  ' + clauses.join('\n  ')};
}

export async function prepareRoleRename(connection: PostgresConnection, draft: PostgresRoleRenameDraft) {
  const {role: original} = await readRole(connection, draft.role);
  const target = await readRoleManagementTarget(connection, original);
  if (!target) throw Error('当前角色无权重命名此角色，或目标是当前登录角色');
  if (target.database !== draft.database || target.renameStamp !== draft.stamp)
    throw Error('原角色属性或数据库已变化，请重新读取角色目录');
  const availability = await connection.query(`SELECT
    NOT EXISTS(SELECT FROM pg_catalog.pg_roles WHERE rolname::text COLLATE pg_catalog."C"=$1::text),
    pg_catalog.octet_length($1::text)<=pg_catalog.current_setting('max_identifier_length')::int`, [draft.name], budget());
  if (availability.rows[0]?.c0 !== 't') throw Error('新角色名称已存在，请重新选择');
  if (availability.rows[0]?.c1 !== 't') throw Error('新角色名称超过服务器标识符长度限制');
  return {...target, expected: {...original, name: draft.name},
    sql: 'ALTER ROLE ' + postgresIdentifier(original.name) + ' RENAME TO ' + postgresIdentifier(draft.name)};
}

/** 在重复读快照中核对原 OID 的完整属性。本事务以外的同名变更不能提供提交证据。 */
export async function verifyRoleAttributes(connection: PostgresConnection, {expected, expiry}: {expected: PostgresRole; expiry?: string}) {
  const {role, expiryEpoch} = await readRole(connection, expected);
  const actualExpiry = expiry === 'infinity' ? role.validUntil === 'infinity'
    : expiry === undefined ? role.validUntil === expected.validUntil : expiryEpoch !== null && Number(expiryEpoch) === Date.parse(expiry) / 1000;
  if (!actualExpiry || roleStamp({...role, validUntil: expected.validUntil}) !== roleStamp(expected))
    throw Error('服务器未确认原角色的预期属性');
  return {oid: role.oid, name: role.name};
}
