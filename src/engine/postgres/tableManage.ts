import { createHash } from 'node:crypto';
import type { PostgresConnection } from './connection';

const supported = "c.relkind IN ('r','p') AND c.relpersistence IN ('p','u')";
const move = `(${supported} AND pg_catalog.pg_has_role(c.relowner,'USAGE'))`;
const rename = `(${move} AND pg_catalog.has_schema_privilege(n.oid,'CREATE'))`;
export const postgresTableOwnerLockSql = `(pg_catalog.pg_has_role(c.relowner,'USAGE') AND
  (pg_catalog.has_table_privilege(c.oid,'UPDATE, DELETE, TRUNCATE') OR
    CASE WHEN pg_catalog.current_setting('server_version_num')::int >= 170000
      THEN pg_catalog.has_table_privilege(c.oid,'MAINTAIN') ELSE false END))`;
// 分区树可能在 RESTRICT 下被一起删除，表页只允许独立的普通表删除。
export const postgresTableCanDropSql = `(c.relkind='r' AND c.relpersistence IN ('p','u') AND NOT c.relispartition
  AND (pg_catalog.pg_has_role(c.relowner,'USAGE') OR pg_catalog.pg_has_role(n.nspowner,'USAGE')))`;
export const postgresTableCanTruncateSql = `(${supported} AND pg_catalog.has_table_privilege(c.oid,'TRUNCATE'))`;
export const postgresTableManageFactsSql = `CASE WHEN ${move} OR ${postgresTableCanDropSql} OR ${postgresTableCanTruncateSql} THEN
  pg_catalog.jsonb_build_array(c.oid::text,n.oid::text,${rename},${move},${postgresTableCanDropSql},${postgresTableCanTruncateSql},
    c.relkind,extract(epoch FROM pg_catalog.pg_postmaster_start_time()),c.relpersistence,c.relispartition,
    c.relowner::text,n.nspowner::text,current_user,session_user,pg_catalog.current_database())::text END`;

/** 摘要在目录展示、预览、锁定后复核和改名后回读间共用，保留权限及关系身份。 */
export function parsePostgresTableManageFacts(raw: string) {
  const [oid, namespace, rename, move, drop, truncate, kind, startedAt] = JSON.parse(raw);
  if (typeof oid !== 'string' || !/^\d+$/.test(oid) || typeof namespace !== 'string' || !/^\d+$/.test(namespace) ||
      typeof rename !== 'boolean' || typeof move !== 'boolean' || typeof drop !== 'boolean' || typeof truncate !== 'boolean' ||
      !move && !drop && !truncate || kind !== 'r' && kind !== 'p' ||
      typeof startedAt !== 'number' || !Number.isFinite(startedAt)) throw Error('PostgreSQL 表管理目录回包不完整');
  return { oid, namespace, rename, move, drop, truncate, kind, startedAt, stamp: createHash('sha256').update(raw).digest('hex') };
}

export async function readPostgresTableManageFacts(connection: PostgresConnection, schema: string, name: string) {
  const result = await connection.query(`SELECT ${postgresTableManageFactsSql}
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname::text COLLATE pg_catalog."C"=$1 AND c.relname::text COLLATE pg_catalog."C"=$2
      AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema' AND pg_catalog.has_schema_privilege(n.oid,'USAGE')`,
  [schema, name], { rows: 2, bytes: 8192 });
  const raw = result.rows[0]?.c0;
  if (result.truncated || result.rows.length !== 1 || typeof raw !== 'string') throw Error('原表已变化或当前角色没有表管理权限');
  return parsePostgresTableManageFacts(raw);
}
