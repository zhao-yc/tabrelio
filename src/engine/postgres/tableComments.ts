import { createHash } from 'node:crypto';
import { postgresDdlLiteral } from '../../shared/postgresCreateTable';
import type { PostgresTableManageInput } from '../../shared/postgresTableManage';
import { postgresIdentifier, postgresRelationName } from '../../shared/postgresSql';
import type { PostgresConnection } from './connection';
import { postgresTableOwnerLockSql } from './tableManage';

// 先取得 COMMENT 使用的表锁，再读取原注释，避免覆盖等锁期间其他会话的修改。
export const postgresCommentIdentitySql = `CASE WHEN c.relkind IN ('r','p') AND c.relpersistence IN ('p','u')
  AND ${postgresTableOwnerLockSql}
  THEN pg_catalog.jsonb_build_array(c.oid::text,n.oid::text,c.relkind,c.relpersistence,c.relowner::text,
    current_user,session_user,extract(epoch FROM pg_catalog.pg_postmaster_start_time()),pg_catalog.current_database())::text END`;

type Column = { position: number; name: string; comment: string | null };

export function postgresCommentStamp(identity: string, comment: string | null, columns: readonly Column[]) {
  return createHash('sha256').update(JSON.stringify([identity, comment, columns.map(column => [column.position, column.name, column.comment])])).digest('hex');
}

async function readComments(connection: PostgresConnection, schema: string, name: string) {
  const result = await connection.query(`SELECT ${postgresCommentIdentitySql},pg_catalog.obj_description(c.oid,'pg_class'),
    COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(a.attnum,a.attname,pg_catalog.col_description(c.oid,a.attnum))
      ORDER BY a.attnum) FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),'[]'::jsonb)::text
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname::text COLLATE pg_catalog."C"=$1 AND c.relname::text COLLATE pg_catalog."C"=$2
      AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema' AND pg_catalog.has_schema_privilege(n.oid,'USAGE')`,
  [schema, name], { rows: 2, bytes: 4 * 1024 * 1024 });
  const row = result.rows[0];
  if (result.truncated || result.rows.length !== 1 || typeof row.c0 !== 'string' || typeof row.c2 !== 'string' ||
      row.c1 !== null && typeof row.c1 !== 'string') throw Error('原表已变化、缺少注释管理权限或目录不完整');
  const identity = row.c0, comment = row.c1;
  const columns: Column[] = JSON.parse(row.c2).map(([position, name, comment]: [number, string, string | null]) => ({ position, name, comment }));
  return { identity, comment, columns, stamp: postgresCommentStamp(identity, comment, columns) };
}

/** 仅发送发生变化的注释。锁后复核列号和原文，提交前逐项回读原对象。 */
export async function postgresTableCommentPlan(connection: PostgresConnection, draft: Extract<PostgresTableManageInput, { action: 'comment' }>) {
  const { schema, name } = postgresRelationName(draft.table);
  const changed = '原表、字段或注释已变化，请刷新结构后重新编辑';
  const original = await readComments(connection, schema, name);
  if (connection.database !== draft.database || original.stamp !== draft.stamp) throw Error(changed);
  const table = postgresIdentifier(schema) + '.' + postgresIdentifier(name);
  const literal = (value: string | null) => value === null ? 'NULL' : postgresDdlLiteral(value);
  const value = draft.value === undefined ? original.comment : draft.value || null;
  const statements: string[] = [];
  if (value !== original.comment) statements.push('COMMENT ON TABLE ' + table + ' IS ' + literal(value));
  const selected = new Map(draft.columns.map(column => [column.position, column]));
  const columns = original.columns.map(column => {
    const change = selected.get(column.position);
    if (!change) return column;
    if (column.name !== change.name) throw Error(changed);
    selected.delete(column.position);
    const comment = change.value || null;
    if (comment !== column.comment)
      statements.push('COMMENT ON COLUMN ' + table + '.' + postgresIdentifier(column.name) + ' IS ' + literal(comment));
    return { ...column, comment };
  });
  if (selected.size) throw Error(changed);
  if (!statements.length) throw Error('注释没有变化');
  const expected = postgresCommentStamp(original.identity, value, columns);
  return {
    table, statements, protocol: 'extended' as const, readCommitted: true as const,
    lock: 'LOCK TABLE ONLY ' + table + ' IN SHARE UPDATE EXCLUSIVE MODE',
    success: 'PostgreSQL 表和字段注释已确认保存',
    async preflight(current: PostgresConnection) {
      const actual = await readComments(current, schema, name);
      if (actual.stamp !== original.stamp) throw Error(changed);
      return actual.stamp;
    },
    async verify(current: PostgresConnection) {
      if ((await readComments(current, schema, name)).stamp !== expected)
        throw Error('未确认原表及字段的预期注释');
    },
  };
}
