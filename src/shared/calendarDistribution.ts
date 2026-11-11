import { z } from 'zod';
import { calendarLabelLength, isCivilDate, type CalendarUnit } from './civilDate';

export const calendarDistributionLimit = 4096;
const maxCount = 18446744073709551615n;
const countPattern = /^(?:0|[1-9]\d{0,19})$/;
export const calendarCountSchema = z.string().refine(value => countPattern.test(value) && value === value.trim() && BigInt(value) <= maxCount);
export const calendarCountsShape = {
  grouped: calendarCountSchema, nulls: calendarCountSchema, ungrouped: calendarCountSchema, peak: calendarCountSchema,
  buckets: z.array(z.object({ label: z.string().max(10), count: calendarCountSchema }).strict()).max(calendarDistributionLimit),
};
export type CalendarCounts = z.infer<z.ZodObject<typeof calendarCountsShape>>;
export const calendarDistributionError = '日期区间超过 4096 个，请改用更大的分组单位或缩小筛选范围';

/** 计数、区间及顺序必须完整守恒。零日期和无效日期不能成为日期区间。 */
export function assertCalendarCounts(value: CalendarCounts, unit: CalendarUnit, rows: string): void {
  let grouped = 0n, peak = 0n, previous = '';
  for (const { label, count } of value.buckets) {
    const date = unit === 'year' ? label + '-01-01' : unit === 'month' ? label + '-01' : label;
    const size = BigInt(count);
    if (label.length !== calendarLabelLength[unit] || !isCivilDate(date) || label <= previous || size === 0n)
      throw Error('日期区间或计数无效');
    grouped += size; if (size > peak) peak = size; previous = label;
  }
  if (grouped !== BigInt(value.grouped) || peak !== BigInt(value.peak) || grouped + BigInt(value.nulls) + BigInt(value.ungrouped) !== BigInt(rows))
    throw Error('日期分布数量不完整');
}

/** 数据库聚合仅返回有界区间。NULL 与空标签分别保留为两个特殊计数组。 */
export function summarizeCalendarGroups(rows: readonly (readonly [string | null, string])[]): CalendarCounts & { rows: string } {
  let nulls: bigint | undefined, ungrouped: bigint | undefined, grouped = 0n, peak = 0n;
  const buckets: CalendarCounts['buckets'] = [];
  for (const [label, count] of rows) {
    const size = BigInt(calendarCountSchema.parse(count));
    if (size === 0n) throw Error('日期分布原生计数无效');
    if (label === null && nulls === undefined) nulls = size;
    else if (label === '' && ungrouped === undefined) ungrouped = size;
    else if (label) {
      grouped += size;
      if (size > peak) peak = size;
      buckets.push({ label, count });
    } else throw Error('日期分布包含重复计数');
  }
  if (buckets.length > calendarDistributionLimit) throw Error(calendarDistributionError);
  return { rows: (grouped + (nulls ?? 0n) + (ungrouped ?? 0n)).toString(),
    grouped: grouped.toString(), peak: peak.toString(), nulls: (nulls ?? 0n).toString(), ungrouped: (ungrouped ?? 0n).toString(), buckets };
}
