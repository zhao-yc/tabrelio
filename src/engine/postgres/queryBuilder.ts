import type { DatabaseObject, QueryOutcome } from '../../shared/contracts';
import { buildPostgresQueryBuilderSql, postgresQueryBuilderLimits, type PostgresQueryBuilderInspectInput,
  type PostgresQueryBuilderSource, type PostgresQueryBuilderTarget } from '../../shared/postgresQueryBuilder';
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

/** 结构化输入复核后在原只读事务内生成 SQL；估算计划不会执行查询。 */
export function inspectPostgresQueryBuilder(connection: PostgresConnection, input: PostgresQueryBuilderInspectInput): Promise<QueryOutcome> {
  const { connectionId, database, table, inspect, ...design } = input;
  const target = { connectionId, database, table };
  return readOnly(connection, database, async () => {
    const source = await readSource(connection, target);
    const joined: PostgresQueryBuilderSource[] = [];
    for (const step of design.joins ?? []) joined.push(await readSource(connection, { ...target, table: step.table }));
    const query = buildPostgresQueryBuilderSql({ ...target, ...design }, source, joined);
    if (inspect === 'validate') return { results: [], elapsedMs: 0 };
    return readPostgresQueryPreview(connection, query, inspect, postgresQueryBuilderLimits.rows);
  });
}
