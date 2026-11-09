import { queryResultSortZh as text } from './locales/queryResultSort.zh-CN';

const integer = '[+-]?\\d{1,10}';
const seconds = '[+-]?\\d{1,2}(?:\\.\\d{1,6})?';
const clock = '([+-]?)(\\d{1,10}):([0-5]\\d):([0-5]\\d(?:\\.\\d{1,6})?)';
const calendar = `(?: (${integer}) years?)?(?: (${integer}) mons?)?(?: (${integer}) days?)?`;
const postgres = new RegExp(`^${calendar}(?: (\\S+:\\S+))?$`);
const verbose = new RegExp(`^@${calendar}(?: (${integer}) hours?)?(?: (${integer}) mins?)?(?: (${seconds}) secs?)?( ago)?$`);
const iso = new RegExp(`^P(?:(${integer})Y)?(?:(${integer})M)?(?:(${integer})D)?(?:(T)(?:(${integer})H)?(?:(${integer})M)?(?:(${seconds})S)?)?$`);
const yearMonth = /^([+-]?)(\d{1,10})-(\d{1,2})(?: ([+-]\d{1,10}) ([+-]\S+))?$/;
const dayTime = new RegExp(`^(?:(${integer}) )?${clock}$`);
const microsecond = 1_000_000n;
const dayMicros = 86_400n * microsecond;
const invalid = () => Error(text.postgresIntervalValue);
const units = (value?: string) => BigInt(value ?? 0);
const sign = (value: string) => value.startsWith('-') ? -1n : 1n;

function secondMicros(value = '0'): bigint {
  const [whole, fraction = ''] = value.replace(/^[+-]/, '').split('.');
  return sign(value) * (BigInt(whole) * microsecond + BigInt(fraction.padEnd(6, '0')));
}

function timeMicros(hours?: string, minutes?: string, secs?: string): bigint {
  return (units(hours) * 3600n + units(minutes) * 60n) * microsecond + secondMicros(secs);
}

/** 还原 SQL 标准格式的共享符号。混合格式与 postgres 格式的时分秒各自带符号。 */
function clockFields(value: string): { days: bigint; micros: bigint } {
  const match = dayTime.exec(value);
  if (!match) throw invalid();
  const [, day, timeSign, hours, minutes, secs] = match;
  return { days: units(day), micros: sign(timeSign || day || '') * timeMicros(hours, minutes, secs) };
}

/** 解读 PostgreSQL 四种 IntervalStyle 原文，按服务端比较规则以 30 天折算一月。 */
export function postgresIntervalOrder(value: string): bigint | number {
  if (/^[+-]?infinity$/i.test(value)) return value[0] === '-' ? -Infinity : Infinity;
  if (value === '0' || value === '@ 0') return 0n;

  let months: bigint, days: bigint, micros: bigint;
  if (value.startsWith('P')) {
    const match = iso.exec(value);
    if (!match || (match[4] ? !match.slice(5).some(Boolean) : !match.slice(1, 4).some(Boolean))) throw invalid();
    const [, years, mons, day, , hours, minutes, secs] = match;
    months = units(years) * 12n + units(mons);
    days = units(day);
    micros = timeMicros(hours, minutes, secs);
  } else if (value.startsWith('@')) {
    const match = verbose.exec(value);
    if (!match || !match.slice(1, 7).some(Boolean)) throw invalid();
    const [, years, mons, day, hours, minutes, secs, ago] = match;
    // postgres_verbose 的 ago 翻转每个字段，混合符号值也按同一规则还原。
    const direction = ago ? -1n : 1n;
    months = direction * (units(years) * 12n + units(mons));
    days = direction * units(day);
    micros = direction * timeMicros(hours, minutes, secs);
  } else {
    const standard = yearMonth.exec(value);
    const traditional = postgres.exec(' ' + value);
    if (standard) {
      const [, monthSign, years, mons, day, time] = standard;
      months = sign(monthSign) * (units(years) * 12n + units(mons));
      days = units(day);
      micros = time ? clockFields(time).micros : 0n;
    } else if (traditional?.slice(1).some(Boolean)) {
      const [, years, mons, day, time] = traditional;
      months = units(years) * 12n + units(mons);
      days = units(day);
      micros = time ? clockFields(time).micros : 0n;
    } else {
      months = 0n;
      ({ days, micros } = clockFields(value));
    }
  }

  // 原生结构分别用两个 int32 存月和天、int64 存微秒，累加后仍用整数。
  if (months < -2147483648n || months > 2147483647n || days < -2147483648n || days > 2147483647n ||
      micros < -9223372036854775808n || micros > 9223372036854775807n) throw invalid();
  return (months * 30n + days) * dayMicros + micros;
}
