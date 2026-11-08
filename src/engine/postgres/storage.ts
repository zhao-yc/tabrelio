import { createHash } from 'node:crypto';
import { z } from 'zod';
import { postgresRelationName } from '../../shared/postgresSql';
import {
  postgresStorageDetailResultSchema, postgresStoragePageSize, postgresStorageReportSchema, postgresStorageRowSchema,
  type PostgresStorageDetail, type PostgresStorageDetailInput, type PostgresStorageRead, type PostgresStorageReport,
} from '../../shared/postgresStorage';
import type { PostgresConnection } from './connection';

const internalRow = postgresStorageRowSchema.omit({ identity: true }).extend({
  oid: z.string().regex(/^\d+$/), namespace: z.string().regex(/^\d+$/),
  databaseOid: z.string().regex(/^\d+$/), started: z.string(),
});
const internalReport = postgresStorageReportSchema.extend({ rows: z.array(internalRow).max(postgresStoragePageSize) });
const internalDetail = postgresStorageDetailResultSchema.extend({ row: internalRow });
const reportBudget = 4000;

/** 目录、父表标签和明细共用相同的权限范围，维护授权也可查看空间统计。 */
const visible = `
  n.nspname !~ '^pg_' AND n.nspname <> 'information_schema' AND pg_catalog.has_schema_privilege(n.oid, 'USAGE')
  AND (pg_catalog.has_table_privilege(c.oid, 'SELECT') OR pg_catalog.pg_has_role(c.relowner, 'USAGE') OR
    CASE WHEN pg_catalog.current_setting('server_version_num')::int >= 170000
      THEN pg_catalog.has_table_privilege(c.oid, 'MAINTAIN') ELSE false END)
`;
const catalogColumns = `c.oid, n.oid AS namespace, n.nspname::text AS schema, c.relname::text AS name, c.relispartition,
  CASE WHEN c.relkind='m' THEN 'materialized' WHEN c.relispartition THEN 'partition' ELSE 'table' END AS kind`;
const physical = `c.relkind IN ('r','m') AND c.relpersistence IN ('p','u')`;
const metrics = `pg_catalog.pg_table_size(r.oid) AS data, pg_catalog.pg_indexes_size(r.oid) AS indexes,
  pg_catalog.pg_stat_get_live_tuples(r.oid) AS live, pg_catalog.pg_stat_get_dead_tuples(r.oid) AS dead,
  pg_catalog.pg_stat_get_numscans(r.oid) AS scans`;
const rowProjection = `pg_catalog.jsonb_build_object(
  'oid', m.oid::text, 'namespace', m.namespace::text, 'databaseOid', db.oid::text, 'started', db.started,
  'schema', m.schema, 'name', m.name, 'kind', m.kind,
  'data', m.data::text, 'indexes', m.indexes::text, 'total', (m.data::numeric+m.indexes)::text,
  'stats', pg_catalog.jsonb_build_object('live', m.live::text, 'dead', m.dead::text, 'scans', m.scans::text),
  'parent', CASE WHEN m.relispartition THEN (
    SELECT pg_catalog.jsonb_build_object('schema', n.nspname, 'name', c.relname)
    FROM pg_catalog.pg_inherits i JOIN pg_catalog.pg_class c ON c.oid=i.inhparent
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE i.inhrelid=m.oid AND ${visible} LIMIT 1
  ) END)`;
const databaseScope = `SELECT d.oid, d.datname, pg_catalog.pg_postmaster_start_time()::text AS started
  FROM pg_catalog.pg_database d WHERE d.datname=pg_catalog.current_database()`;

function publicRow(internal: z.infer<typeof internalRow>) {
  const { oid, namespace, databaseOid, started, ...row } = internal;
  const identity = createHash('sha256').update(JSON.stringify([databaseOid, started, namespace, oid, row.schema, row.name, row.kind])).digest('hex');
  return { ...row, identity };
}

async function readJson(connection: PostgresConnection, database: string, sql: string, values: unknown[]) {
  const result = await connection.query(sql, values, { rows: 2, bytes: 4 * 1024 * 1024 });
  const raw = result.rows[0]?.c0;
  if (connection.database !== database || result.truncated || result.rows.length !== 1 || typeof raw !== 'string')
    throw Error('空间目录回包不完整或原数据库已变化');
  return JSON.parse(raw) as unknown;
}

/** 先限制候选目录再读取物理文件大小。范围过大时保留可选 Schema，避免给出截断汇总。 */
export async function readPostgresStorage(connection: PostgresConnection, input: PostgresStorageRead): Promise<PostgresStorageReport> {
  const column = {
    total: '(m.data::numeric+m.indexes)', data: 'm.data', indexes: 'm.indexes', live: 'm.live', name: 'm.name COLLATE pg_catalog."C"',
  }[input.sort];
  const direction = input.direction === 'asc' ? 'ASC' : 'DESC';
  const order = `${column} ${direction} NULLS LAST, m.schema COLLATE pg_catalog."C", m.name COLLATE pg_catalog."C", m.oid`;
  const data = await readJson(connection, input.database, `
    WITH db AS (${databaseScope}), candidates AS MATERIALIZED (
      SELECT ${catalogColumns} FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE ${physical} AND ${visible} AND ($1::text IS NULL OR n.nspname::text COLLATE pg_catalog."C"=$1)
        AND ($2::text='' OR pg_catalog.strpos(pg_catalog.lower(c.relname::text), pg_catalog.lower($2))>0)
        AND ($3::text IS NULL OR $3=CASE WHEN c.relkind='m' THEN 'materialized' WHEN c.relispartition THEN 'partition' ELSE 'table' END)
      LIMIT ${reportBudget + 1}
    ), limits AS (
      SELECT count(*)::int AS count FROM candidates
    ), measured AS MATERIALIZED (
      SELECT r.*, ${metrics} FROM candidates r WHERE (SELECT count FROM limits)<=${reportBudget}
    ), page AS (
      SELECT ${rowProjection} AS item, row_number() OVER (ORDER BY ${order}) AS position
      FROM measured m CROSS JOIN db ORDER BY ${order} LIMIT ${postgresStoragePageSize} OFFSET $4
    ), rollup AS (
      SELECT m.schema, count(*)::int AS count, sum(m.data) AS data, sum(m.indexes) AS indexes
      FROM measured m GROUP BY m.schema
    )
    SELECT pg_catalog.jsonb_build_object(
      'database', db.datname, 'page', $5::int, 'tooBroad', limits.count>${reportBudget},
      'schemas', COALESCE((SELECT pg_catalog.jsonb_agg(s.name ORDER BY s.name COLLATE pg_catalog."C") FROM (
        SELECT n.nspname::text AS name FROM pg_catalog.pg_namespace n WHERE n.nspname !~ '^pg_'
          AND n.nspname <> 'information_schema' AND pg_catalog.has_schema_privilege(n.oid,'USAGE')
        ORDER BY n.nspname::text COLLATE pg_catalog."C" LIMIT 2001
      ) s), '[]'::jsonb),
      'summary', (SELECT pg_catalog.jsonb_build_object('count', limits.count,
        'data', COALESCE(sum(data),0)::text, 'indexes', COALESCE(sum(indexes),0)::text,
        'total', COALESCE(sum(data::numeric+indexes),0)::text) FROM measured),
      'bySchema', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'schema', schema, 'count', count, 'data', data::text, 'indexes', indexes::text, 'total', (data+indexes)::text)
        ORDER BY (data+indexes) DESC, schema COLLATE pg_catalog."C") FROM rollup), '[]'::jsonb),
      'rows', COALESCE((SELECT pg_catalog.jsonb_agg(item ORDER BY position) FROM page), '[]'::jsonb),
      'incomplete', EXISTS (SELECT FROM measured WHERE data IS NULL OR indexes IS NULL))
    FROM db CROSS JOIN limits
  `, [input.schema ?? null, input.query, input.kind ?? null, (input.page - 1) * postgresStoragePageSize, input.page]);
  const result = internalReport.extend({ incomplete: z.boolean() }).parse(data);
  if (result.database !== input.database || result.incomplete) throw Error('读取期间关系已变化，请刷新空间目录');
  const { rows, incomplete: _incomplete, ...report } = result;
  return { ...report, rows: rows.map(publicRow) };
}

/** 明细只认原数据库和关系身份，并按 OID 读取各实际索引的全部物理分支。 */
export async function readPostgresStorageDetail(connection: PostgresConnection, input: PostgresStorageDetailInput): Promise<PostgresStorageDetail> {
  const { schema, name } = postgresRelationName(input.table);
  const data = await readJson(connection, input.database, `
    WITH db AS (${databaseScope}), target AS MATERIALIZED (
      SELECT ${catalogColumns} FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE ${physical} AND ${visible} AND n.nspname::text COLLATE pg_catalog."C"=$1 AND c.relname::text COLLATE pg_catalog."C"=$2
    ), measured AS MATERIALIZED (SELECT r.*, ${metrics} FROM target r)
    SELECT pg_catalog.jsonb_build_object('row', ${rowProjection}, 'indexes',
      COALESCE((SELECT pg_catalog.jsonb_agg(x.item ORDER BY x.bytes DESC NULLS LAST, x.oid) FROM (
        SELECT i.oid, s.bytes, pg_catalog.jsonb_build_object('name', i.relname, 'bytes', s.bytes::text,
          'scans', pg_catalog.pg_stat_get_numscans(i.oid)::text, 'valid', pi.indisvalid) AS item
        FROM pg_catalog.pg_index pi JOIN pg_catalog.pg_class i ON i.oid=pi.indexrelid
        CROSS JOIN LATERAL (SELECT pg_catalog.pg_table_size(i.oid) AS bytes) s
        WHERE pi.indrelid=m.oid AND i.relkind='i' ORDER BY i.oid LIMIT 2001
      ) x), '[]'::jsonb))
    FROM measured m CROSS JOIN db
  `, [schema, name]);
  const detail = internalDetail.parse(data), row = publicRow(detail.row);
  if (row.identity !== input.identity) throw Error('原关系已变化，请刷新空间目录');
  return { row, indexes: detail.indexes };
}
