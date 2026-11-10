import { isCivilDate } from '../shared/civilDate';

export type RecordTemporalDialect = 'mysql' | 'postgresql' | 'sqlite';
export interface RecordTemporalSpec {
  kind: 'date' | 'datetime' | 'clock' | 'duration';
  minimumYear: number;
  fractionDigits: number;
  zoned: boolean;
}
export interface RecordTemporalParts {
  date: string;
  clock: string;
  fraction: string;
  offset: string;
  separator: ' ' | 'T';
  negative: boolean;
}

/** 只识别明确的列类型。SQLite 使用声明类型提供入口，存储类型仍由调用方核对。 */
export function recordTemporalSpec(type: string, dialect: RecordTemporalDialect): RecordTemporalSpec | undefined {
  const match = /^(date|datetime|timestamp|timestamptz|time|timetz)(?:\(([0-6])\))?(?: (with|without) time zone)?$/i.exec(type.trim());
  if (!match) return;
  const name = match[1].toLowerCase(), qualifier = match[3]?.toLowerCase();
  if (name === 'date' && (match[2] !== undefined || qualifier) ||
      dialect === 'postgresql' && (name === 'datetime' || qualifier && name !== 'timestamp' && name !== 'time') ||
      dialect !== 'postgresql' && (qualifier || name === 'timestamptz' || name === 'timetz')) return;
  return {
    kind: name === 'date' ? 'date' : name === 'time' || name === 'timetz' ? dialect === 'mysql' ? 'duration' : 'clock' : 'datetime',
    minimumYear: dialect === 'mysql' ? 1000 : 1,
    fractionDigits: name === 'date' ? 0 : Number(match[2] ?? (dialect === 'mysql' ? 0 : 6)),
    zoned: dialect === 'sqlite' || qualifier === 'with' || name === 'timestamptz' || name === 'timetz',
  };
}

const dateTime = /^(\d{4}-\d\d-\d\d)([ T])(.+)$/;
const clock = /^(\d{2}:[0-5]\d(?::[0-5]\d)?)(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::[0-5]\d(?::[0-5]\d)?)?)?$/;
const duration = /^(-?)(\d{2,3}:[0-5]\d:[0-5]\d)(?:\.(\d{1,6}))?$/;

/** 只切分原文。无法可靠切分的零日期、特殊年份或数据库字面量仍交给原文本框。 */
export function readRecordTemporal(value: string, spec: RecordTemporalSpec): RecordTemporalParts | undefined {
  const parts: RecordTemporalParts = { date: '', clock: '', fraction: '', offset: '', separator: ' ', negative: false };
  if (value === '') return parts;
  if (spec.kind === 'date') return isCivilDate(value, spec.minimumYear) ? { ...parts, date: value } : undefined;
  if (spec.kind === 'duration') {
    const match = duration.exec(value);
    if (!match || Number(match[2].split(':')[0]) > 838) return;
    return { ...parts, clock: match[2], negative: match[1] === '-', fraction: match[3] ?? '' };
  }
  if (spec.kind === 'datetime') {
    const match = dateTime.exec(value);
    if (!match || !isCivilDate(match[1], spec.minimumYear)) return;
    parts.date = match[1];
    parts.separator = match[2] === 'T' ? 'T' : ' ';
    value = match[3];
  }
  const match = clock.exec(value);
  if (!match || match[3] && !spec.zoned || match[2] && match[1].length !== 8) return;
  const hours = Number(match[1].slice(0, 2));
  if (hours > 24 || hours === 24 && /[1-9]/.test(match[1].slice(3) + (match[2] ?? ''))) return;
  return { ...parts, clock: match[1], fraction: match[2] ?? '', offset: match[3] ?? '' };
}

/** 只替换由用户编辑的分量，日期改变时连分隔符和偏移原文都保留。 */
export function writeRecordTemporal(spec: RecordTemporalSpec, parts: RecordTemporalParts): string {
  if (spec.kind === 'date') return parts.date;
  const time = parts.clock || '00:00:00';
  const seconds = parts.fraction && time.length === 5 ? time + ':00' : time;
  const value = (parts.negative ? '-' : '') + seconds + (parts.fraction ? '.' + parts.fraction : '') + parts.offset;
  return spec.kind === 'datetime' ? parts.date + parts.separator + value : value;
}
