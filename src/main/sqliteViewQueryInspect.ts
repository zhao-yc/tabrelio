import type { QueryOutcome, QueryResult } from '../shared/contracts';
import { buildSqliteExplainPlan, sqliteExplainLimits } from '../shared/sqliteExplain';
import { sqliteViewDraftQuery, sqliteViewSampleRows, type SqliteViewQueryInspectInput } from '../shared/sqliteObjects';
import type { SqliteDriverSession } from '../engine/sqlite/session';
import { sqliteWorkspaceValue } from './sqliteQuerySession';

/** 只投递一条读取语句。样本限制原生步数，计划直接读取 SQLite 的四列结果。 */
export async function inspectSqliteViewQuery(driver: SqliteDriverSession, input: SqliteViewQueryInspectInput): Promise<QueryOutcome> {
  if (!driver.readOnly) throw Error('SQLite 视图预览需要独立只读连接');
  const { query, columns } = sqliteViewDraftQuery(input.sql, input.name);
  const explain = input.mode === 'explain';
  const sql = explain ? 'EXPLAIN QUERY PLAN\n' + query :
    'SELECT * FROM (\n' + query + '\n) LIMIT ' + (sqliteViewSampleRows + 1);
  const started = performance.now();
  const result: QueryResult = { columns: [], rows: [], truncated: false, elapsedMs: 0, statement: sql.slice(0, 32768) };
  const outcome = await driver.execute(sql, {
    parameters: [],
    maxRows: explain ? sqliteExplainLimits.rows : sqliteViewSampleRows,
    maxBytes: explain ? sqliteExplainLimits.rawBytes : 512 * 1024,
    batchRows: 100,
    statementTimeoutMs: 5000,
    onStatement: statement => {
      result.columns = statement.columns.map((column, index) => ({
        key: 'c' + index, name: !explain && columns.length ? columns[index] ?? column.name : column.name, type: column.type ?? '',
      }));
    },
    onBatch: batch => {
      for (const row of batch.rows)
        result.rows.push(Object.fromEntries(row.map((value, index) => ['c' + index, sqliteWorkspaceValue(value)])));
    },
  });
  if (outcome.statements.length !== 1 || outcome.transaction) throw Error('SQLite 未确认单条视图预览');
  if (!explain && columns.length && columns.length !== result.columns.length) throw Error('SQLite 视图列清单与查询列数不一致');
  result.truncated = outcome.statements[0].truncated;
  result.elapsedMs = performance.now() - started;
  return { results: [result], elapsedMs: result.elapsedMs,
    ...(explain ? { sqliteExplain: buildSqliteExplainPlan(result, driver.version) } : {}) };
}
