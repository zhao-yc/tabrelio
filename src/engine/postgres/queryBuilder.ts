import { createHash } from 'node:crypto';
import type { DatabaseObject, QueryOutcome } from '../../shared/contracts';
import { buildPostgresQueryBuilderSql, postgresQueryBuilderLimits, type PostgresQueryBuilderDescribeJoinInput, type PostgresQueryBuilderInspectInput, type PostgresQueryBuilderJoinKeysInput,
  type PostgresQueryBuilderSource, type PostgresQueryBuilderTarget } from '../../shared/postgresQueryBuilder';
import { queryBuilderForeignKeyChoiceSchema, queryBuilderForeignKeyLimit, queryBuilderJoinLimits,
  type QueryBuilderForeignKeys } from '../../shared/queryBuilderJoin';
import { postgresIdentifier, postgresRelationName } from '../../shared/postgresSql';
import type { PostgresConnection } from './connection';
import { startPostgresDdl } from './createTable';
import { readRelation } from './tableWorkspace';
import { readPostgresQueryPreview } from './viewQueryInspect';

/** 目录与预览都用短连接。失败时回滚，再由引擎等待该物理连接释放。 */
async function readOnly<T>(connection: PostgresConnection, database: string, read: () => Promise<T>): Promise<T> {
  if (connection.database !== database) throw Error('PostgreSQL 查询来源数据库已变化。');
  try {
    await startPostgresDdl(connection, true);
    return await read();
  } finally {
    if (connection.state().transactionOpen) await connection.query('ROLLBACK', undefined, { rows: 0, bytes: 0 }, undefined, 'extended');
  }
}

/** 仅返回有读取权限的用户关系，避免为选表加载例程和序列目录。 */
export function postgresQueryBuilderCatalogue(connection: PostgresConnection, database: string): Promise<DatabaseObject[]> {
  return readOnly(connection, database, async () => {
    const result = await connection.query(`SELECT n.nspname, c.relname, c.relkind
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r','p','v','m','f') AND n.nspname <> 'information_schema' AND n.nspname !~ '^pg_'
        AND pg_catalog.has_schema_privilege(n.oid, 'USAGE')
        AND (pg_catalog.has_table_privilege(c.oid, 'SELECT') OR pg_catalog.has_any_column_privilege(c.oid, 'SELECT'))
      ORDER BY n.nspname, c.relname LIMIT 10001`, undefined, { rows: 10001, bytes: 4 * 1024 * 1024 });
    if (result.truncated || result.rows.length > 10000) throw Error('PostgreSQL 查询来源目录超过读取预算。');
    return result.rows.map(row => ({
      name: postgresIdentifier(String(row.c0)) + '.' + postgresIdentifier(String(row.c1)),
      kind: row.c2 === 'v' || row.c2 === 'm' ? 'view' : 'table',
    }));
  });
}

/** 零行读取取得服务器的关系读锁，再读目录。同一事务内的 DDL 不能替换已核对的结构。 */
async function readSource(connection: PostgresConnection, target: PostgresQueryBuilderTarget): Promise<PostgresQueryBuilderSource> {
  const { schema, name } = postgresRelationName(target.table);
  if (schema === 'information_schema' || schema.startsWith('pg_')) throw Error('请选择 PostgreSQL 用户 schema 中的表或视图。');
  const probe = await connection.query('SELECT 1 FROM ' + postgresIdentifier(schema) + '.' + postgresIdentifier(name) + ' LIMIT 0',
    undefined, { rows: 0, bytes: 0 }, undefined, 'extended');
  if (probe.postgresCommand !== 'SELECT') throw Error('PostgreSQL 未确认查询来源。');
  const relation = await readRelation(connection, target.table, { catalogueOnly: true });
  return { target, fingerprint: relation.fingerprint, columns: relation.columns.map(({ name, type }) => ({ name, type })) };
}

export function describePostgresQueryBuilder(connection: PostgresConnection, target: PostgresQueryBuilderTarget): Promise<PostgresQueryBuilderSource> {
  return readOnly(connection, target.database, () => readSource(connection, target));
}

/** 同一只读事务取得全部关系的锁，按原序返回；同表复用目录，保留每个别名的位置。 */
async function readSources(connection: PostgresConnection, target: PostgresQueryBuilderTarget, joinTables: readonly string[]) {
  const found = new Map<string, PostgresQueryBuilderSource>(), ordered: PostgresQueryBuilderSource[] = [];
  for (const table of [target.table, ...joinTables]) {
    let source = found.get(table);
    if (!source) {
      source = await readSource(connection, { ...target, table });
      found.set(table, source);
    }
    ordered.push(source);
  }
  return ordered;
}

export function describePostgresQueryBuilderJoin(connection: PostgresConnection, input: PostgresQueryBuilderDescribeJoinInput) {
  const { joinTables, ...target } = input;
  return readOnly(connection, target.database, () => readSources(connection, target, joinTables));
}

/** 精确匹配选定对象及所有既有别名。只读目录按约束原序展开字段，跳过不可读或超限的复合键。 */
export function readPostgresQueryBuilderJoinKeys(connection: PostgresConnection, input: PostgresQueryBuilderJoinKeysInput): Promise<QueryBuilderForeignKeys<PostgresQueryBuilderSource>> {
  const { priorTables, priorRevisions, nextTable, ...target } = input;
  return readOnly(connection, target.database, async () => {
    const tables = [target.table, ...priorTables];
    const sources = await readSources(connection, target, [...priorTables, nextTable]);
    const source = sources.pop()!;
    if (sources.some((item, index) => item.fingerprint !== priorRevisions[index]))
      throw Error('已加入的 PostgreSQL 来源结构已变化，请重新读取。');
    const result = await connection.query(`
      WITH selected AS (SELECT pg_catalog.to_regclass($2)::oid AS oid),
      earlier AS (SELECT (u.position - 1)::integer AS position, pg_catalog.to_regclass(u.name)::oid AS oid
        FROM pg_catalog.unnest($1::text[]) WITH ORDINALITY AS u(name, position))
      SELECT e.position, f.oid::text, f.conname, side.outgoing, mapped.pairs::text
      FROM earlier e CROSS JOIN selected r
      JOIN pg_catalog.pg_constraint f ON (f.conrelid = e.oid AND f.confrelid = r.oid)
        OR (f.conrelid = r.oid AND f.confrelid = e.oid)
      CROSS JOIN LATERAL (VALUES (true, f.conrelid, f.confrelid), (false, f.confrelid, f.conrelid)) side(outgoing, lhs, rhs)
      CROSS JOIN LATERAL (
        SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'left', CASE WHEN side.outgoing THEN child.attname ELSE parent.attname END,
          'right', CASE WHEN side.outgoing THEN parent.attname ELSE child.attname END) ORDER BY k.position) AS pairs,
          pg_catalog.bool_and(pg_catalog.has_column_privilege(child.attrelid, child.attnum, 'SELECT')
            AND pg_catalog.has_column_privilege(parent.attrelid, parent.attnum, 'SELECT')) AS readable,
          count(*) AS size
        FROM pg_catalog.unnest(f.conkey) WITH ORDINALITY AS k(attnum, position)
        JOIN pg_catalog.pg_attribute child ON child.attrelid = f.conrelid AND child.attnum = k.attnum AND NOT child.attisdropped
        JOIN pg_catalog.pg_attribute parent ON parent.attrelid = f.confrelid AND parent.attnum = f.confkey[k.position::integer] AND NOT parent.attisdropped
      ) mapped
      WHERE f.contype = 'f' AND side.lhs = e.oid AND side.rhs = r.oid
        AND COALESCE((pg_catalog.to_jsonb(f)->>'conperiod')::boolean, false) = false
        AND mapped.readable AND mapped.size = pg_catalog.cardinality(f.conkey) AND mapped.size BETWEEN 1 AND $3
      ORDER BY e.position, f.conname, f.oid, side.outgoing DESC LIMIT $4
    `, [tables, nextTable, queryBuilderJoinLimits.pairs, queryBuilderForeignKeyLimit + 1],
    { rows: queryBuilderForeignKeyLimit + 1, bytes: 2 * 1024 * 1024 });
    if (result.truncated || result.rows.length > queryBuilderForeignKeyLimit) throw Error('匹配的 PostgreSQL 外键超过读取预算。');
    const choices = result.rows.flatMap(row => {
      const position = Number(row.c0), direction = row.c3 === 't' ? 'outgoing' : 'incoming';
      const pairs: unknown = JSON.parse(String(row.c4));
      const key = createHash('sha256').update(JSON.stringify([source.fingerprint, position, row.c1, direction, pairs])).digest('hex');
      const choice = queryBuilderForeignKeyChoiceSchema.safeParse({ source: position, key, label: row.c2, direction, pairs });
      return choice.success ? [choice.data] : [];
    });
    return { source, choices };
  });
}

/** 结构化输入复核后在原只读事务内生成 SQL；估算计划不会执行查询。 */
export function inspectPostgresQueryBuilder(connection: PostgresConnection, input: PostgresQueryBuilderInspectInput): Promise<QueryOutcome> {
  const { connectionId, database, table, inspect, ...design } = input;
  const target = { connectionId, database, table };
  return readOnly(connection, database, async () => {
    const [source, ...joined] = await readSources(connection, target, (design.joins ?? []).map(step => step.table));
    const query = buildPostgresQueryBuilderSql({ ...target, ...design }, source, joined);
    if (inspect === 'validate') return { results: [], elapsedMs: 0 };
    return readPostgresQueryPreview(connection, query, inspect, postgresQueryBuilderLimits.rows);
  });
}
