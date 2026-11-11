import type { CellValue, TableInfo } from '../shared/contracts';
import { tableStatisticsLimits, tableStatisticsMessages, type TableStatisticsInput } from '../shared/tableStatistics';
import { calendarLabelLength } from '../shared/civilDate';
import { calendarDistributionLimit, summarizeCalendarGroups } from '../shared/calendarDistribution';
import { assertTableCalendar, tableCalendarKind, tableCalendarRequestSchema, tableCalendarTimeZoneSchema, type TableCalendar } from '../shared/tableCalendar';
import { buildTableFilterSql, identifier, inlineParameters, qualified } from './sql';

export const tableCalendarMaxRows = calendarDistributionLimit + 3;

/** 在原类型上取年月日并校验公历，不用会把零日期、无效日期转换成警告或 NULL 的日期运算。 */
export function planTableCalendar(source: TableInfo, input: TableStatisticsInput) {
  const request = tableCalendarRequestSchema.parse(input.calendar);
  const column = source.columns.find(item => item.name === request.column);
  const kind = column && tableCalendarKind(column.type);
  if (!column || !kind || input.columns.length || input.distinct || input.histogram) throw Error('日期分布须单独统计一个日期或时间戳字段');
  const name = identifier(column.name), year = `YEAR(${name})`, month = `MONTH(${name})`, day = `DAYOFMONTH(${name})`;
  const leap = `MOD(${year},4)=0 AND (MOD(${year},100)<>0 OR MOD(${year},400)=0)`;
  const days = `CASE ${month} WHEN 2 THEN 28 + (${leap}) WHEN 4 THEN 30 WHEN 6 THEN 30 WHEN 9 THEN 30 WHEN 11 THEN 30 ELSE 31 END`;
  const valid = `${year} BETWEEN 1 AND 9999 AND ${month} BETWEEN 1 AND 12 AND ${day} BETWEEN 1 AND (${days})`;
  const period = `CASE WHEN ${name} IS NULL THEN NULL WHEN ${valid}
    THEN LEFT(CAST(${name} AS CHAR CHARACTER SET ascii),${calendarLabelLength[request.unit]}) ELSE '' END`;
  const filter = buildTableFilterSql(source, input.filters, input.filterMode, input.filterGroup);
  const where = filter.where ? ' WHERE ' + filter.where : '';
  const sql = inlineParameters(`SELECT ${period} AS calendar_label,CAST(COUNT(*) AS CHAR) AS calendar_count
    FROM ${qualified(source.database, source.name)}${where} GROUP BY 1 ORDER BY 1 LIMIT ${tableCalendarMaxRows}`, filter.params);
  if (Buffer.byteLength(sql) > tableStatisticsLimits.bytes) throw Error(tableStatisticsMessages.budget);
  return { sql, aliases: ['calendar_label', 'calendar_count'], column, request, kind };
}

/** 一条聚合同时给出区间与总量。即使视图跨非事务表，也不将不同 SELECT 的计数合并。 */
export function decodeTableCalendar(plan: ReturnType<typeof planTableCalendar>, rows: CellValue[][], timeZone?: string): { rowCount: string; calendar: TableCalendar } {
  const groups = rows.map(row => {
    const [label, count] = row;
    if (row.length !== 2 || label !== null && typeof label !== 'string' || typeof count !== 'string') throw Error('日期分布原生回包无效');
    return [label, count] as const;
  });
  const { rows: rowCount, ...counts } = summarizeCalendarGroups(groups);
  const calendar = { ...plan.request, ...counts, ...(timeZone !== undefined ? { timeZone: tableCalendarTimeZoneSchema.parse(timeZone) } : {}) };
  return { rowCount, calendar: assertTableCalendar(calendar, plan.request, plan.column, rowCount) };
}
