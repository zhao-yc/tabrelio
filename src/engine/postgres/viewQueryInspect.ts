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
  const control = (sql: string) => connection.query(sql, undefined, { rows: 0, bytes: 0 }, undefined, 'extended');
  try {
    await startPostgresDdl(connection, true);
    if (input.mode === 'rows') {
      await control('DECLARE tabrelio_view_sample NO SCROLL CURSOR FOR\n' + query);
      const result = await connection.query('FETCH FORWARD ' + (postgresViewQuerySampleRows + 1) + ' FROM tabrelio_view_sample',
        undefined, { rows: postgresViewQuerySampleRows, bytes: 512 * 1024 }, undefined, 'extended');
      if (result.postgresCommand !== 'FETCH') throw Error('PostgreSQL 未确认视图数据预览');
      return { results: [result], elapsedMs: result.elapsedMs };
    }
    const result = await connection.query('EXPLAIN (ANALYZE FALSE, VERBOSE TRUE, FORMAT JSON)\n' + query,
      undefined, { rows: 1, bytes: explainLimits.jsonBytes }, undefined, 'extended');
    const raw = result.rows[0]?.c0;
    if (result.postgresCommand !== 'EXPLAIN' || result.columns.length !== 1 ||
        typeof raw !== 'string' && !result.truncated) throw Error('PostgreSQL 未返回视图估算计划');
    const explain = parsePostgresExplain(typeof raw === 'string' ? raw : '', connection.version, 'json', result.truncated);
    return { results: [result], elapsedMs: result.elapsedMs, explain };
  } finally {
    // 只读连接由外层释放；无论成功或失败都不把游标或事务交给用户查询标签。
    if (connection.state().transactionOpen) await control('ROLLBACK');
  }
}
