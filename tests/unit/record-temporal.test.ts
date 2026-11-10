import { describe, expect, it } from 'vitest';
import { readRecordTemporal, recordTemporalSpec, writeRecordTemporal } from '../../src/renderer/recordTemporal';

describe('记录日期时间控件', () => {
  it('只识别各引擎的明确字段类型及精度', () => {
    expect(recordTemporalSpec('TIME(6)', 'mysql')).toMatchObject({ kind: 'duration', fractionDigits: 6 });
    expect(recordTemporalSpec('timestamp(3) with time zone', 'postgresql')).toMatchObject({ kind: 'datetime', fractionDigits: 3, zoned: true });
    expect(recordTemporalSpec('datetime', 'sqlite')).toMatchObject({ kind: 'datetime', fractionDigits: 6 });
    expect(recordTemporalSpec('TIME WITH TIME ZONE', 'mysql')).toBeUndefined();
    expect(recordTemporalSpec('enum(\'DATE\')', 'mysql')).toBeUndefined();
    expect(recordTemporalSpec('date[]', 'postgresql')).toBeUndefined();
    expect(recordTemporalSpec('INTEGER', 'sqlite')).toBeUndefined();
  });

  it('变更日期保留原小数秒、分隔符及偏移，不经过时区转换', () => {
    const spec = recordTemporalSpec('timestamp(6) with time zone', 'postgresql')!;
    const original = '2024-02-29T01:02:03.000009+05:45:30';
    expect(writeRecordTemporal(spec, { ...readRecordTemporal(original, spec)!, date: '2028-02-29' }))
      .toBe('2028-02-29T01:02:03.000009+05:45:30');
  });

  it.each(['0000-00-00', '2023-02-29', '1900-02-29', '4714-01-01 BC', 'infinity'])('特殊值或无效日历仍走原文本 %s', value => {
    expect(readRecordTemporal(value, recordTemporalSpec('date', 'postgresql')!)).toBeUndefined();
  });

  it('保持带符号长时长及端点，拒绝超出 838 小时的结构化值', () => {
    const spec = recordTemporalSpec('time(6)', 'mysql')!;
    const original = '-838:59:58.000009';
    expect(writeRecordTemporal(spec, readRecordTemporal(original, spec)!)).toBe(original);
    expect(readRecordTemporal('839:00:00', spec)).toBeUndefined();
    expect(readRecordTemporal('00:00:00+00', spec)).toBeUndefined();
  });

  it('支持时钟 24:00，空日期时间在明确选择日期后才补午夜', () => {
    const time = recordTemporalSpec('time without time zone', 'postgresql')!;
    expect(writeRecordTemporal(time, readRecordTemporal('24:00:00', time)!)).toBe('24:00:00');
    expect(readRecordTemporal('24:00:01', time)).toBeUndefined();
    const datetime = recordTemporalSpec('datetime(6)', 'mysql')!;
    expect(writeRecordTemporal(datetime, { ...readRecordTemporal('', datetime)!, date: '2000-02-29' })).toBe('2000-02-29 00:00:00');
    expect(readRecordTemporal('0999-12-31 00:00:00', datetime)).toBeUndefined();
  });
});
