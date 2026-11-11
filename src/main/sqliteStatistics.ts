import { sqliteStatisticsInputSchema, assertSqliteStatistics, sqliteStatisticsLimits as limits, sqliteRowCountInputSchema, assertSqliteRowCount, type SqliteRowCountInput, type SqliteRowCountOutput, type SqliteStatisticsInput, type SqliteStatisticsOutput, type SqliteStatisticsValue, assertSqliteCalendar, sqliteCalendarInputSchema, sqliteCalendarLimits, type SqliteCalendarInput, type SqliteCalendarOutput } from '../shared/sqliteStatistics';
import type { SqliteDriverSession } from '../engine/sqlite/session';
import { sqliteCalendarDateFunction, type SqliteValue } from '../engine/sqlite/protocol';
import { calendarLabelLength, calendarTextLength } from '../shared/civilDate';
import { summarizeCalendarGroups } from '../shared/calendarDistribution';
import type { SqliteTableColumn } from '../shared/sqliteTableBrowse';
import { withSqliteReadSnapshot, readSqliteTableCatalogue, verifySqliteTableScope, countSqliteMatchingRows, buildSqliteTableSelect, quoteSqliteIdentifier, sqliteExactTextProjection, type SqliteTableBrowseControl } from './sqliteTableBrowse';

/** 原生聚合结果按真实存储类型传输；64位整数、REAL无穷和BLOB不经显示文本猜测。 */
function typed(value: SqliteValue): SqliteStatisticsValue {
  return value === null ? { kind: 'null' } : typeof value === 'string' ? { kind: 'text', value } : value.type === 'binary' ? { kind: 'blob', value: Buffer.from(value.base64, 'base64').toString('hex') } : { kind: value.type, value: value.value };
}
/** 样本在聚合前截取，沿用表页的筛选、关联和排序，起点固定为首条匹配行。 */
function statisticsSource(input: SqliteStatisticsInput, columns: readonly SqliteTableColumn[]) {
  const source = buildSqliteTableSelect({
    connectionId: input.connectionId, database: 'main', table: input.table, taskId: input.taskId, mode: input.mode,
    filters: input.filters, ...(input.relation ? { relation: input.relation } : {}), sort: input.sample?.sort ?? [], offset: 0, limit: 1,
  }, columns, [input.column], true);
  if (!input.sample) return source;
  return { sql: source.sql + ' LIMIT ?', parameters: [...source.parameters, { type: 'integer' as const, value: String(input.sample.limit) }] };
}

/** 同一独立只读快照内按存储类型聚合，最多回传五组，不借用用户事务。 */
export async function readSqliteStatistics(driver: SqliteDriverSession, raw: SqliteStatisticsInput, control: SqliteTableBrowseControl): Promise<SqliteStatisticsOutput> {
  const input = sqliteStatisticsInputSchema.parse(raw);
  return withSqliteReadSnapshot(driver, control, async () => {
    const catalogue = await readSqliteTableCatalogue(driver, input.table, control), field = catalogue.columns.find(column => column.name === input.column);
    if (catalogue.schemaKey !== input.schemaKey || !field) throw Error('SQLite表结构或字段已变化，请刷新后重新统计');
    await verifySqliteTableScope(driver, input, control);
    const source = statisticsSource(input, catalogue.columns);
    const column = '"__dbark_statistics".' + quoteSqliteIdentifier(input.column), rows: SqliteValue[][] = [];
    const sql = 'SELECT typeof(' + column + '), count(*), count(DISTINCT ' + column + '), ' + sqliteExactTextProjection('min(' + column + ')') + ', ' + sqliteExactTextProjection('max(' + column + ')') + ' FROM (' + source.sql + ') AS "__dbark_statistics" GROUP BY typeof(' + column + ') ORDER BY typeof(' + column + ')';
    const result = await driver.execute(sql, { parameters: source.parameters, maxRows: limits.groups, batchRows: limits.groups, maxBytes: limits.bytes,
      onStatement: statement => { control.check(); if (statement.index !== 0 || statement.columns.length !== 5) throw Error('SQLite字段概况返回非预期列'); },
      onBatch: batch => { control.check(); if (batch.index !== 0 || rows.length + batch.rows.length > limits.groups) throw Error('SQLite字段概况超过存储类型上限'); rows.push(...batch.rows); },
    });
    control.check(); if (result.statements.length !== 1 || result.statements[0].truncated || result.statements[0].rows !== rows.length) throw Error('SQLite字段概况未完整读取');
    const groups = rows.map(row => {
      const [kind, count, distinct, min, max] = row;
      if (row.length !== 5 || typeof kind !== 'string' || !count || typeof count !== 'object' || count.type !== 'integer' || !distinct || typeof distinct !== 'object' || distinct.type !== 'integer') throw Error('SQLite字段概况原生计数无效');
      return { kind, count: count.value, distinct: distinct.value, min: typed(min), max: typed(max) };
    });
    const total = groups.reduce((sum, group) => sum + BigInt(group.count), 0n), nulls = BigInt(groups.find(group => group.kind === 'null')?.count ?? '0');
    return assertSqliteStatistics({ request: input, declaredType: field.declaredType, rows: total.toString(), nulls: nulls.toString(), nonNull: (total - nulls).toString(), groups }, input);
  });
}

/** 只聚合行数，投影为常量，避免解码无关列的大文本或 BLOB。 */
export async function readSqliteRowCount(driver: SqliteDriverSession, raw: SqliteRowCountInput, control: SqliteTableBrowseControl): Promise<SqliteRowCountOutput> {
  const input = sqliteRowCountInputSchema.parse(raw);
  return withSqliteReadSnapshot(driver, control, async () => {
    const catalogue = await readSqliteTableCatalogue(driver, input.table, control);
    if (catalogue.schemaKey !== input.schemaKey) throw Error('SQLite表结构已变化，请刷新后重新统计');
    return assertSqliteRowCount({ request: input, rows: await countSqliteMatchingRows(driver, input, catalogue.columns, control) }, input);
  });
}

/** 在数据库内聚合选定范围，只传出日期区间与计数，长文本和非 TEXT 值无需送入解析函数。 */
export async function readSqliteCalendar(driver: SqliteDriverSession, raw: SqliteCalendarInput, control: SqliteTableBrowseControl): Promise<SqliteCalendarOutput> {
  const input = sqliteCalendarInputSchema.parse(raw);
  return withSqliteReadSnapshot(driver, control, async () => {
    const catalogue = await readSqliteTableCatalogue(driver, input.table, control);
    if (catalogue.schemaKey !== input.schemaKey || !catalogue.columns.some(field => field.name === input.column))
      throw Error('SQLite表结构或字段已变化，请刷新后重新统计');
    await verifySqliteTableScope(driver, input, control);
    const source = statisticsSource(input, catalogue.columns);
    const column = '"__dbark_calendar".' + quoteSqliteIdentifier(input.column), bytes = 'CAST(' + column + ' AS BLOB)';
    const period = `CASE WHEN ${column} IS NULL THEN NULL ELSE coalesce(CASE WHEN typeof(${column}) = 'text'
      AND length(${bytes}) <= ${calendarTextLength * 2} THEN substr(${sqliteCalendarDateFunction}(${bytes}), 1, ${calendarLabelLength[input.calendarUnit]}) END, '') END`;
    // 两个特殊区间区分 NULL 与未分组，多读一行用于拒绝超限回包。
    const maxRows = sqliteCalendarLimits.buckets + 3;
    const sql = `SELECT ${period} AS "__dbark_period", count(*) FROM (${source.sql}) AS "__dbark_calendar"
      GROUP BY 1 ORDER BY "__dbark_period" COLLATE BINARY LIMIT ${maxRows}`;
    const rows: SqliteValue[][] = [];
    const result = await driver.execute(sql, {
      parameters: source.parameters, maxRows, batchRows: 200, maxBytes: limits.bytes, statementTimeoutMs: sqliteCalendarLimits.statementMs,
      onStatement: statement => { control.check(); if (statement.index !== 0 || statement.columns.length !== 2) throw Error('SQLite日期分布返回非预期列'); },
      onBatch: batch => { control.check(); if (batch.index !== 0 || rows.length + batch.rows.length > maxRows) throw Error('SQLite日期分布回包超过预算'); rows.push(...batch.rows); },
    });
    control.check();
    if (result.statements.length !== 1 || result.statements[0].truncated || result.statements[0].rows !== rows.length)
      throw Error('SQLite日期分布未完整读取');
    const groups = rows.map(row => {
      const [label, count] = row;
      if (row.length !== 2 || label !== null && typeof label !== 'string' || !count || typeof count !== 'object' || count.type !== 'integer')
        throw Error('SQLite日期分布原生计数无效');
      return [label, count.value] as const;
    });
    return assertSqliteCalendar({ request: input, ...summarizeCalendarGroups(groups) }, input);
  });
}
