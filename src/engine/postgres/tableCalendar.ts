import { calendarDistributionLimit, calendarTimeZoneSchema, summarizeCalendarGroups } from '../../shared/calendarDistribution';
import type { CalendarUnit } from '../../shared/civilDate';
import { postgresIdentifier } from '../../shared/postgresSql';
import type { PostgresTableColumn } from '../../shared/postgresTable';
import { assertPostgresTableCalendar, postgresCalendarKind, postgresCalendarUnitSchema } from '../../shared/postgresTableCalendar';
import type { PostgresConnection } from './connection';

/** 直接提取原日期类型的年月日，避免 DATE 转 TIMESTAMP 时丢失可表示范围。 */
export async function readPostgresTableCalendar(connection: PostgresConnection, column: PostgresTableColumn,
  from: string, args: unknown[], requestedUnit: CalendarUnit) {
  const unit = postgresCalendarUnitSchema.parse(requestedUnit), kind = postgresCalendarKind(column);
  if (!kind) throw Error('当前 PostgreSQL 字段不支持日期分布');
  const name = postgresIdentifier(column.name);
  const finitePart = (part: 'YEAR' | 'MONTH' | 'DAY') => `WHEN pg_catalog.isfinite(${name}) THEN EXTRACT(${part} FROM ${name})::integer`;
  const month = unit === 'year' ? 'NULL::integer' : `CASE ${finitePart('MONTH')} END`;
  const day = unit === 'day' ? `CASE ${finitePart('DAY')} END` : 'NULL::integer';
  const maximum = calendarDistributionLimit + 3;
  let timeZone: string | undefined;
  if (kind === 'zoned') {
    // 复用独立读取会话的 TimeZone，原条件中的文字比较仍使用相同的会话设置。
    const zone = await connection.query("SELECT pg_catalog.current_setting('TimeZone')", undefined, { rows: 1, bytes: 1024 });
    if (zone.truncated || zone.rows.length !== 1) throw Error('PostgreSQL 统计会话时区未完整返回');
    timeZone = calendarTimeZoneSchema.parse(zone.rows[0].c0);
  }
  // 驱动给每个单元格计入固定开销，传输预算须容纳区间上限和超限判定行。
  const result = await connection.query(`
    SELECT CASE WHEN ${name} IS NULL THEN NULL ${finitePart('YEAR')} ELSE 0 END AS calendar_year,
      ${month} AS calendar_month, ${day} AS calendar_day, pg_catalog.count(*)::text AS calendar_count
    FROM ${from} GROUP BY 1, 2, 3 ORDER BY 1 NULLS FIRST, 2, 3 LIMIT ${maximum}
  `, args, { rows: maximum, bytes: maximum * 192 });
  const aliases = ['calendar_year', 'calendar_month', 'calendar_day', 'calendar_count'];
  if (result.truncated || result.columns.length !== aliases.length || result.columns.some((field, index) => field.name !== aliases[index]))
    throw Error('PostgreSQL 日期分布未完整返回');
  const groups = result.rows.map(({ c0: year, c1: month, c2: day, c3: count }) => {
    if (typeof count !== 'string' || year !== null && typeof year !== 'string' ||
        month !== null && typeof month !== 'string' || day !== null && typeof day !== 'string')
      throw Error('PostgreSQL 日期分布回包无效');
    const finite = year !== null && year !== '0';
    if (finite && !/^-?[1-9]\d{0,6}$/.test(year) ||
        (month !== null) !== (finite && unit !== 'year') || month !== null && !/^[1-9]\d?$/.test(month) ||
        (day !== null) !== (finite && unit === 'day') || day !== null && !/^[1-9]\d?$/.test(day))
      throw Error('PostgreSQL 日期分布回包无效');
    const label = year === null ? null : year === '0' ? '' :
      [year.replace(/^-/, '').padStart(4, '0'), month?.padStart(2, '0'), day?.padStart(2, '0')].filter(Boolean).join('-') +
      (year.startsWith('-') ? ' BC' : '');
    return [label, count] as const;
  });
  return assertPostgresTableCalendar({
    ...summarizeCalendarGroups(groups), column: column.name, unit, ...(timeZone !== undefined ? { timeZone } : {}),
  }, column, unit);
}
