import { calendarTextLength, readCalendarTextDate, type CalendarUnit } from '../shared/civilDate';
import { postgresTemporalOrder, type PostgresTemporalKind } from './postgresResultTemporal';
export type QueryResultCalendarKind = 'date' | 'datetime' | 'sqlite' | Extract<PostgresTemporalKind, 'pgDate' | 'pgTimestamp' | 'pgTimestampTz'>;
export interface QueryResultCalendarDistribution<Count extends number | string = number> {
  readonly column: string;
  readonly grouped: Count;
  readonly nulls: Count;
  readonly ungrouped: Count;
  readonly peak: Count;
  readonly buckets: readonly Readonly<{ label: string; count: Count }>[];
}

type CalendarDate = { year: number; month: number; day: number; beforeCommonEra: boolean };

/** 使用返回值的日历日期。解析只核实日期时间，不套用本机时区或换算原偏移。 */
function calendarDate(value: string, kind: QueryResultCalendarKind): CalendarDate | undefined {
  let date: string | undefined;
  let beforeCommonEra = false;
  if (kind === 'pgDate' || kind === 'pgTimestamp' || kind === 'pgTimestampTz') {
    if (value.length > calendarTextLength || value !== value.trim()) return;
    try { if (typeof postgresTemporalOrder(value, kind) !== 'bigint') return; }
    catch { return; }
    date = value.split(/[ T]/, 1)[0];
    beforeCommonEra = value.endsWith(' BC');
  } else date = readCalendarTextDate(value, kind);
  if (!date) return;
  const [year, month, day] = date.split('-').map(Number);
  return { year, month, day, beforeCommonEra };
}

/** 每个日历区间只保留标签与计数。上层分批核对原格，完成后才按日历顺序发布。 */
export class QueryResultCalendarCounter {
  private readonly buckets = new Map<number, { label: string; count: number }>();
  private grouped = 0;
  private peak = 0;

  constructor(private readonly unit: CalendarUnit, private readonly kind: QueryResultCalendarKind) {}

  add(value: unknown): void {
    if (typeof value !== 'string') return;
    const date = calendarDate(value, this.kind);
    if (!date) return;
    const { year, month, day, beforeCommonEra } = date;
    const monthKey = this.unit === 'year' ? 0 : month, dayKey = this.unit === 'day' ? day : 0;
    // 公元前 1 年以天文历法编号 0 排序，同年月份仍按正常日历顺序。
    const key = (beforeCommonEra ? 1 - year : year) * 10000 + monthKey * 100 + dayKey;
    let bucket = this.buckets.get(key);
    if (!bucket) {
      const label = String(year).padStart(4, '0') + (monthKey ? '-' + String(monthKey).padStart(2, '0') : '') +
        (dayKey ? '-' + String(dayKey).padStart(2, '0') : '') + (beforeCommonEra ? ' BC' : '');
      bucket = { label, count: 0 };
      this.buckets.set(key, bucket);
    }
    bucket.count++;
    this.grouped++;
    this.peak = Math.max(this.peak, bucket.count);
  }

  result(column: string, total: number, nulls: number): QueryResultCalendarDistribution {
    const buckets = [...this.buckets].sort(([a], [b]) => a - b).map(([, bucket]) => Object.freeze(bucket));
    return Object.freeze({ column, grouped: this.grouped, nulls, ungrouped: total - nulls - this.grouped, peak: this.peak, buckets: Object.freeze(buckets) });
  }

  clear(): void { this.buckets.clear(); }
}
