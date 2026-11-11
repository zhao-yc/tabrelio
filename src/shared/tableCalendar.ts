import { z } from 'zod';
import { calendarUnits } from './civilDate';
import { assertCalendarCounts, calendarCountSchema, calendarCountsShape } from './calendarDistribution';
import type { ColumnInfo } from './contracts';

export const tableCalendarRequestSchema = z.object({
  column: z.string().min(1).max(256),
  unit: z.enum(calendarUnits),
}).strict();
export type TableCalendarRequest = z.infer<typeof tableCalendarRequestSchema>;
export const tableCalendarTimeZoneSchema = z.string().min(1).max(128).refine(value => !/[\x00-\x1f\x7f]/.test(value));
const resultSchema = tableCalendarRequestSchema.extend({ ...calendarCountsShape, timeZone: tableCalendarTimeZoneSchema.optional() }).strict();
export type TableCalendar = z.infer<typeof resultSchema>;

/** 仅实际目录中的日历类型能参加分布。TIME 和 YEAR 有不同的列语义。 */
export function tableCalendarKind(type: string): 'date' | 'datetime' | 'timestamp' | undefined {
  const name = /^(date|datetime|timestamp)(?:\([0-6]\))?$/i.exec(type.trim())?.[1]?.toLowerCase();
  if (name === 'date' || name === 'datetime' || name === 'timestamp') return name;
}

export function assertTableCalendar(raw: unknown, request: TableCalendarRequest, column: ColumnInfo | undefined, rows: string): TableCalendar {
  const result = resultSchema.parse(raw), kind = column && tableCalendarKind(column.type);
  if (!kind || column?.name !== request.column || result.column !== request.column || result.unit !== request.unit ||
      (kind === 'timestamp') !== (result.timeZone !== undefined)) throw Error('日期分布回包与原字段、分组单位或统计时区不符');
  assertCalendarCounts(result, request.unit, calendarCountSchema.parse(rows));
  return result;
}
