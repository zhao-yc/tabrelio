import { queryResultSortZh as text } from './locales/queryResultSort.zh-CN';

export type PostgresTemporalKind = 'pgDate' | 'pgTime' | 'pgTimeTz' | 'pgTimestamp' | 'pgTimestampTz';

const invalid = () => Error(text.postgresTemporalValue);
const microsecondsPerSecond = 1_000_000n;
const secondsPerDay = 86_400;
const offsetLimit = 16 * 3600;
const datePattern = /^(\d{4,7})-(\d{2})-(\d{2})(?:[ T](\d{2}:\S+))?( BC)?$/;
const timePattern = /^(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|([+-])(\d{2})(?::(\d{2})(?::(\d{2}))?)?)?$/;

/** 公元前 1 年按天文历法编号为 0。以三月为年首计算整数日，闰日落在年末。 */
function calendarDay(year: number, month: number, day: number): bigint {
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > monthDays[month - 1]) throw invalid();
  const marchYear = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(marchYear / 400), yearInEra = marchYear - era * 400;
  const marchMonth = month + (month > 2 ? -3 : 9);
  return BigInt(era * 146097 + yearInEra * 365 + Math.floor(yearInEra / 4) -
    Math.floor(yearInEra / 100) + Math.floor((153 * marchMonth + 2) / 5) + day - 1);
}

/** PostgreSQL ISO 输出的数字偏移可精确到秒。无偏移值不能借本机时区补全。 */
function clock(value: string, zoned: boolean): { micros: bigint; westSeconds: number } {
  const match = timePattern.exec(value);
  if (!match || !!match[5] !== zoned) throw invalid();
  const hour = Number(match[1]), minute = Number(match[2]), second = Number(match[3]);
  const fraction = Number((match[4] ?? '').padEnd(6, '0'));
  const zoneHour = Number(match[7] ?? 0), zoneMinute = Number(match[8] ?? 0), zoneSecond = Number(match[9] ?? 0);
  const offset = zoneHour * 3600 + zoneMinute * 60 + zoneSecond;
  if (hour > 24 || minute > 59 || second > 59 || hour === 24 && (minute || second || fraction) ||
      offset >= offsetLimit || zoneMinute > 59 || zoneSecond > 59) throw invalid();
  const westSeconds = match[6] === '-' ? offset : -offset;
  return { micros: BigInt(hour * 3600 + minute * 60 + second + westSeconds) * microsecondsPerSecond + BigInt(fraction), westSeconds };
}

/** 保留微秒和扩展年份；比较键仅用于排序，不覆盖数据库返回的文字。 */
export function postgresTemporalOrder(value: string, kind: PostgresTemporalKind): bigint | number {
  if (kind === 'pgTime' || kind === 'pgTimeTz') {
    const { micros, westSeconds } = clock(value, kind === 'pgTimeTz');
    // TIMETZ 先比较折算时刻，同一时刻再比较原偏移。低位区间不能越过一微秒。
    return kind === 'pgTimeTz' ? micros * BigInt(2 * offsetLimit) + BigInt(westSeconds + offsetLimit) : micros;
  }
  if (/^[+-]?infinity$/i.test(value)) return value[0] === '-' ? -Infinity : Infinity;
  const match = datePattern.exec(value);
  if (!match || (kind === 'pgDate') === !!match[4]) throw invalid();
  const year = Number(match[1]);
  if (!year) throw invalid();
  const day = calendarDay(match[5] ? 1 - year : year, Number(match[2]), Number(match[3]));
  if (kind === 'pgDate') return day;
  return day * BigInt(secondsPerDay) * microsecondsPerSecond + clock(match[4], kind === 'pgTimestampTz').micros;
}
