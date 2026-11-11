import { describe, expect, it } from 'vitest';
import { postgresColumnStatistics } from '../../src/shared/postgresColumnStatistics';
import { postgresTableCalendarSchema, postgresTableColumnReadSchema, postgresTableHistogramSchema, postgresTableStatisticsSchema, type PostgresTableColumn } from '../../src/shared/postgresTable';
import { assertPostgresTableCalendar, postgresCalendarKind } from '../../src/shared/postgresTableCalendar';
import { assertStatisticsSample, statisticsRowCount } from '../../src/shared/tableStatistics';
import { validateCommand } from '../../src/shared/validation';

describe('PostgreSQL 字段概况', () => {
  it('以原精度计算 NULL 与重复组数，并标出已截断的极值', () => {
    const value = '🧪'.repeat(4097);
    expect(postgresColumnStatistics({
      rows: '9007199254740995', nonNull: '9007199254740993', empty: '1',
      groups: { distinct: '9007199254740991', unique: '9007199254740990', min: '', max: value },
    })).toMatchObject({ nulls: '2', empty: '1', groups: {
      repeated: '1', min: { text: '', clipped: false }, max: { text: '🧪'.repeat(4096), clipped: true },
    } });
  });

  it('拒绝不一致计数或极值，IPC 只允许原表页字段', () => {
    expect(() => postgresColumnStatistics({ rows: '1', nonNull: '2' })).toThrow('不一致');
    expect(() => postgresColumnStatistics({
      rows: '0', nonNull: '0', groups: { distinct: '0', unique: '0', min: '', max: null },
    })).toThrow('不一致');
    const request = { connectionId: '连接', database: '库', table: '表', tabId: '页',
      pageToken: 'd312a72b-fdfd-4a6e-8770-f5f1637af235', column: 'c1' };
    expect(postgresTableColumnReadSchema.safeParse(request).success).toBe(true);
    expect(postgresTableColumnReadSchema.safeParse({ ...request, search: '额外条件' }).success).toBe(false);
  });

  it('抽样限于统计命令及绑定表页，样本计数涵盖非有限值和 NULL', () => {
    const request = { connectionId: '连接', database: '库', table: '表', tabId: '页',
      pageToken: 'd312a72b-fdfd-4a6e-8770-f5f1637af235', column: 'c1', sampleLimit: 100000 };
    expect(validateCommand('postgres.table.statistics', request)).toEqual(request);
    expect(postgresTableHistogramSchema.parse({ ...request, bins: 5 })).toMatchObject(request);
    expect(postgresTableCalendarSchema.parse({ ...request, unit: 'day' })).toMatchObject(request);
    expect(postgresTableColumnReadSchema.safeParse(request).success).toBe(false);
    expect(postgresTableStatisticsSchema.safeParse({ ...request, sort: [] }).success).toBe(false);
    for (const sampleLimit of [0, 1.5, 100001])
      expect(postgresTableStatisticsSchema.safeParse({ ...request, sampleLimit }).success).toBe(false);
    const rows = statisticsRowCount({ finite: '5', nonFinite: '1', nulls: '1' });
    expect(rows).toBe(7n);
    expect(() => assertStatisticsSample(7, 7, rows)).not.toThrow();
    expect(() => assertStatisticsSample(6, 6, rows)).toThrow('原样本范围');
    expect(() => assertStatisticsSample(7, undefined, rows)).toThrow('原样本范围');
  });
});

describe('PostgreSQL 表级日期分布', () => {
  const field: PostgresTableColumn = { key: 'c1', name: '时间', type: 'timestamp(6) with time zone', valueOptions: true,
    nullable: true, defaultValue: false, generated: false, primary: false, binary: false };
  const result = { column: field.name, unit: 'day', timeZone: 'Europe/Paris', rows: '9007199254740998', grouped: '9007199254740995',
    nulls: '1', ungrouped: '2', peak: '9007199254740993', buckets: [
      { label: '0002-12-31 BC', count: '1' }, { label: '0001-02-29 BC', count: '1' },
      { label: '10000-02-29', count: '9007199254740993' },
    ] };

  it('保留公元前闰日、扩展年份和超过 JS 安全整数的原计数', () => {
    expect(assertPostgresTableCalendar(result, field, 'day')).toEqual(result);
    expect(() => assertPostgresTableCalendar({ ...result, buckets: [...result.buckets].reverse() }, field, 'day')).toThrow();
    expect(() => assertPostgresTableCalendar({ ...result, buckets: [{ ...result.buckets[0], label: '0002-02-29 BC' },
      ...result.buckets.slice(1)] }, field, 'day')).toThrow();
    expect(() => assertPostgresTableCalendar({ ...result, rows: '9007199254740997' }, field, 'day')).toThrow();
    expect(() => assertPostgresTableCalendar({ ...result, timeZone: undefined }, field, 'day')).toThrow();
  });

  it('只接收原表页字段及固定粒度，时间及同名用户类型不启用日期入口', () => {
    const request = { connectionId: '连接', database: '库', table: '表', tabId: '页',
      pageToken: 'd312a72b-fdfd-4a6e-8770-f5f1637af235', column: 'c1', unit: 'month' };
    expect(postgresTableCalendarSchema.parse(request)).toEqual(request);
    expect(postgresTableCalendarSchema.safeParse({ ...request, unit: 'week' }).success).toBe(false);
    expect(postgresTableCalendarSchema.safeParse({ ...request, filter: {} }).success).toBe(false);
    expect(postgresCalendarKind(field)).toBe('zoned');
    expect(postgresCalendarKind({ ...field, type: 'time with time zone' })).toBeUndefined();
    expect(postgresCalendarKind({ ...field, type: 'date', valueOptions: undefined })).toBeUndefined();
  });
});
