import type { QueryOutcome } from '../../shared/contracts';
import { explainLimits } from '../../shared/explain';
import { postgresViewQuery, postgresViewQueryInspectSchema, postgresViewQuerySampleRows } from '../../shared/postgresCreateView';
import { parsePostgresExplain } from '../../shared/postgresExplain';
import type { PostgresConnection } from './connection';
import { startPostgresDdl } from './createTable';

/** 独占连接复用建视图的解析设置。采样用游标限行，估算计划始终关闭 ANALYZE。 */
export async function inspectPostgresViewQuery(connection: PostgresConnection, raw: unknown): Promise<QueryOutcome> {
  const input = postgresViewQueryInspectSchema.parse(raw);
  if (connection.database !== input.database) throw Error('原 PostgreSQL 视图数据库已变化');
  const query = postgresViewQuery(input.definition);
  try {
    await startPostgresDdl(connection, true);
    return await readPostgresQueryPreview(connection, query, input.mode, postgresViewQuerySampleRows, input.columnNames);
  } finally {
    // 只读连接由外层释放；无论成功或失败都不把游标或事务交给用户查询标签。
    if (connection.state().transactionOpen) await connection.query('ROLLBACK', undefined, { rows: 0, bytes: 0 }, undefined, 'extended');
  }
}

/** 在调用方拥有的只读事务中读取已校验的单条查询，保留查询自己的排序及行数限制。 */
export async function readPostgresQueryPreview(connection: PostgresConnection, query: string, mode: 'rows' | 'explain',
  sampleRows: number, names: readonly string[] = []): Promise<QueryOutcome> {
  if (mode === 'rows') {
    await connection.query('DECLARE tabrelio_view_sample NO SCROLL CURSOR FOR\n' + query,
      undefined, { rows: 0, bytes: 0 }, undefined, 'extended');
    const result = await connection.query('FETCH FORWARD ' + (sampleRows + 1) + ' FROM tabrelio_view_sample',
      undefined, { rows: sampleRows, bytes: 512 * 1024 }, undefined, 'extended');
    if (result.postgresCommand !== 'FETCH') throw Error('PostgreSQL 未确认数据预览');
    if (names.length > result.columns.length) throw Error('显式列名数量超过查询输出列数');
    result.columns = result.columns.map((column, index) => ({ ...column, name: names[index] ?? column.name }));
    return { results: [result], elapsedMs: result.elapsedMs };
  }
  const result = await connection.query('EXPLAIN (ANALYZE FALSE, VERBOSE TRUE, FORMAT JSON)\n' + query,
    undefined, { rows: 1, bytes: explainLimits.jsonBytes }, undefined, 'extended');
  const raw = result.rows[0]?.c0;
  if (result.postgresCommand !== 'EXPLAIN' || result.columns.length !== 1 ||
      typeof raw !== 'string' && !result.truncated) throw Error('PostgreSQL 未返回估算计划');
  const explain = parsePostgresExplain(typeof raw === 'string' ? raw : '', connection.version, 'json', result.truncated);
  return { results: [result], elapsedMs: result.elapsedMs, explain };
}
