import { z } from 'zod';
import { calendarUnits, isCivilDay, type CalendarUnit } from './civilDate';
import { assertCalendarCounts, calendarCountSchema, calendarCountsShape, calendarTimeZoneSchema } from './calendarDistribution';
import type { PostgresTableColumn } from './postgresTable';

export const postgresCalendarUnitSchema = z.enum(calendarUnits);
const resultSchema = z.object({
  ...calendarCountsShape, column: z.string(), unit: postgresCalendarUnitSchema,
  rows: calendarCountSchema, timeZone: calendarTimeZoneSchema.optional(),
}).strict();
export type PostgresTableCalendar = z.infer<typeof resultSchema>;

/** valueOptions 来自目录中的内置类型 OID，避免将同名用户类型当作原生日期。 */
export function postgresCalendarKind(column: Pick<PostgresTableColumn, 'type' | 'valueOptions'>) {
  if (!column.valueOptions) return;
  if (column.type === 'date') return 'date';
  const match = /^timestamp(?:\([0-6]\))? (with|without) time zone$/.exec(column.type);
  if (match) return match[1] === 'with' ? 'zoned' : 'local';
}

/** 延用查询结果的公元前标记和扩展年份，按实际日历顺序排序。 */
function postgresPeriodKey(label: string, unit: CalendarUnit): number | undefined {
  const match = /^(\d{4,7})(?:-(\d{2})(?:-(\d{2}))?)?( BC)?$/.exec(label);
  if (!match || match[0] !== label || (unit !== 'year') !== !!match[2] || (unit === 'day') !== !!match[3]) return;
  const year = Number(match[1]), month = Number(match[2] ?? 1), day = Number(match[3] ?? 1);
  const signed = match[4] ? 1 - year : year;
  if (year < 1 || match[1] !== String(year).padStart(4, '0') || !isCivilDay(signed, month, day)) return;
  return signed * 10000 + month * 100 + day;
}

/** 发布前核对所选列、粒度、时区及完整计数。 */
export function assertPostgresTableCalendar(raw: unknown, column: PostgresTableColumn, unit: CalendarUnit): PostgresTableCalendar {
  const value = resultSchema.parse(raw), kind = postgresCalendarKind(column);
  if (!kind || value.column !== column.name || value.unit !== unit || (kind === 'zoned') !== (value.timeZone !== undefined))
    throw Error('PostgreSQL 日期分布与所选字段、分组单位或统计时区不符');
  if (BigInt(value.rows) > 9223372036854775807n) throw Error('PostgreSQL 日期分布计数超出 bigint');
  assertCalendarCounts(value, unit, value.rows, postgresPeriodKey);
  return value;
}
