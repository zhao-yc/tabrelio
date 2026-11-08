import type { QueryOutcome, QueryResult } from '../shared/contracts';
import { explainLimits } from '../shared/explain';
import { mysqlViewDraftQuery, mysqlViewSampleRows, type MysqlViewQueryInspectInput } from '../shared/mysqlViewFile';
import { explainQuery } from './queryExplain';
import { consumeQueryFrames } from './queryStreamProtocol';
import { identifier } from './sql';
import { structureTaskQuery, type StructureTaskContext } from './structureDefinition';

type ReadContext = Pick<StructureTaskContext, 'managed' | 'checkCancelled' | 'commandStarted'>;

/** 限额到达后结束原命令并等待终态。直接读查询可保留排序、同名列与用户指定的 LIMIT。 */
async function readPreview(context: ReadContext, sql: string, maxRows: number, maxBytes: number, stop: () => Promise<void>, aliases: string[] = []): Promise<QueryResult> {
  const started = performance.now();
  const result: QueryResult = { columns: [], rows: [], elapsedMs: 0, truncated: false, statement: sql };
  const limitReached = Error('达到视图预览上限');
  let bytes = 0;
  try {
    await consumeQueryFrames(context.managed, sql, 'binary', {
      statementOrdinal: 1, ordinals: { results: 0, rows: 0 }, stop,
      checkCancelled: context.checkCancelled, commandStarted: context.commandStarted,
      async consume(frame) {
        if (frame.resultOrdinal !== 1 || frame.kind === 'status') throw Error('视图预览只接受一个数据结果集。');
        if (frame.kind === 'rows-start') {
          if (aliases.length && aliases.length !== frame.columns.length) throw Error('视图列清单与查询结果列数不一致。');
          result.columns = frame.columns.map(({ key, name, type }, index) => ({ key, name: aliases[index] ?? name, type }));
          bytes = Buffer.byteLength(JSON.stringify(result.columns));
        } else if (frame.kind === 'row') {
          const row = Object.fromEntries(result.columns.map((column, index) => [column.key, frame.values[index]]));
          bytes += Buffer.byteLength(JSON.stringify(row));
          if (result.rows.length >= maxRows || bytes > maxBytes) throw limitReached;
          result.rows.push(row);
        } else result.warningCount = frame.warningCount;
      },
    });
  } catch (error) {
    if (error !== limitReached || context.managed.broken) throw error;
    result.truncated = true;
  }
  context.checkCancelled();
  if (!result.columns.length) throw Error('数据库未返回视图预览列。');
  result.elapsedMs = performance.now() - started;
  return result;
}

/** 在独立连接的原库中执行只读检查。使用当前连接身份，不执行 DDL 或切换到草稿 DEFINER。 */
export async function inspectMysqlViewQuery(context: StructureTaskContext, input: MysqlViewQueryInspectInput, stop: () => Promise<void>): Promise<QueryOutcome> {
  const { managed, checkCancelled } = context;
  if (managed.sqlMode === undefined) throw Error('无法确认视图预览连接的 SQL 模式。');
  const modes = managed.sqlMode.split(',');
  const mode = { ansiQuotes: modes.includes('ANSI_QUOTES'), noBackslashEscapes: modes.includes('NO_BACKSLASH_ESCAPES') };
  const { query, aliases } = mysqlViewDraftQuery(input, mode.ansiQuotes, mode.noBackslashEscapes);
  const control = (sql: string) => structureTaskQuery(context, sql);
  await control('USE ' + identifier(input.database));
  await control('SET SESSION lock_wait_timeout = 5');
  await control('START TRANSACTION READ ONLY');
  try {
    if (input.mode === 'explain') return await explainQuery(query, 'auto', {
      mode, status: managed.status, check: checkCancelled, reusable: () => !managed.broken,
      run: async sql => [await readPreview(context, sql, explainLimits.textRows, 512 * 1024, stop)],
    });
    const result = await readPreview(context, query, mysqlViewSampleRows, 512 * 1024, stop, aliases);
    return { results: [result], elapsedMs: result.elapsedMs };
  } finally {
    // 取消或断线时由外层关闭物理连接，不能在不确定状态上排队发送下一条命令。
    if (!managed.broken && !managed.signal?.aborted) await control('ROLLBACK AND NO CHAIN NO RELEASE');
  }
}
