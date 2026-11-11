/** 公历文本校验不经过 Date，也不使用系统时区。 */
export function isCivilDate(value: string, minimumYear = 1): boolean {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!parts) return false;
  const year = Number(parts[1]), month = Number(parts[2]), day = Number(parts[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return year >= minimumYear && month >= 1 && month <= 12 && day >= 1 &&
    day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

export const calendarUnits = ['day', 'month', 'year'] as const;
export type CalendarUnit = typeof calendarUnits[number];
export const calendarLabelLength: Record<CalendarUnit, number> = { day: 10, month: 7, year: 4 };
export const calendarTextLength = 64;

const dateTime = /^(\d{4}-\d\d-\d\d)([ T])(.+)$/;
const clockPattern = /^(\d{2}:[0-5]\d(?::[0-5]\d)?)(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::[0-5]\d(?::[0-5]\d)?)?)?$/;

export function splitCivilDatetime(value: string, minimumYear: number): { date: string; separator: ' ' | 'T'; time: string } | undefined {
  const match = dateTime.exec(value);
  if (!match || !isCivilDate(match[1], minimumYear)) return;
  return { date: match[1], separator: match[2] as ' ' | 'T', time: match[3] };
}

export function readCivilClock(value: string, zoned: boolean): { clock: string; fraction: string; offset: string } | undefined {
  const match = clockPattern.exec(value);
  if (!match || match[3] && !zoned || match[2] && match[1].length !== 8) return;
  const hours = Number(match[1].slice(0, 2));
  if (hours > 24 || hours === 24 && /[1-9]/.test(match[1].slice(3) + (match[2] ?? ''))) return;
  return { clock: match[1], fraction: match[2] ?? '', offset: match[3] ?? '' };
}

/** 统计使用返回值所示日期。SQLite 只在逐格存储类型确认为 TEXT 后调用。 */
export function readCalendarTextDate(value: string, kind: 'date' | 'datetime' | 'sqlite'): string | undefined {
  if (value.length > calendarTextLength || value !== value.trim()) return;
  if (kind !== 'datetime' && isCivilDate(value)) return value;
  if (kind === 'date') return;
  const parts = splitCivilDatetime(value, 1);
  const time = parts && readCivilClock(parts.time, kind === 'sqlite');
  if (!parts || !time) return;
  if (kind === 'datetime' && (time.clock.length !== 8 || time.clock.startsWith('24:'))) return;
  if (time.offset && time.offset !== 'Z' && Number(time.offset.slice(1, 3)) > 23) return;
  return parts.date;
}
