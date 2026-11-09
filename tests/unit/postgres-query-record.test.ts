import { describe, expect, it } from 'vitest';
import type { QueryResult } from '../../src/shared/contracts';
import { postgresQueryHasUniqueKeys, postgresQueryRecordTable } from '../../src/engine/postgres/queryRecord';
import { postgresQueryRecordPageSchema } from '../../src/shared/postgresQueryRecord';

describe('PostgreSQL 查询原记录', () => {
  it('识别带列别名、参数和注释的直接投影', () => {
    expect(postgresQueryRecordTable('SELECT t.id AS "编号", t.detail FROM Public.subject t /* 注释 */ WHERE t.id = $1 ORDER BY id;', true))
      .toEqual({ schema: 'public', name: 'subject' });
    expect(postgresQueryRecordTable('SELECT a.* FROM "Mixed" AS a LIMIT 3', true)).toEqual({ name: 'Mixed' });
  });

  it('表达式内 FROM、FOR 和标点不会被认成顶层关系子句', () => {
    expect(postgresQueryRecordTable(
      "SELECT substring(t.note FROM 1 FOR 2), t.note IS NOT DISTINCT FROM 'x', ARRAY[1,2], t.id FROM public.x t", true))
      .toEqual({ schema: 'public', name: 'x' });
    expect(postgresQueryRecordTable('SELECT $$FROM other;$$ AS literal, id FROM "真实表"', true)).toEqual({ name: '真实表' });
  });

  it.each([
    'SELECT a.id FROM x a JOIN x b ON a.id=b.id',
    'SELECT a.id FROM x a, y b',
    'SELECT id FROM (SELECT id FROM x) t',
    'SELECT id FROM x UNION ALL SELECT id FROM x',
    'SELECT id, coalesce(count(*) OVER (), 0) FROM x',
    'SELECT id FROM x GROUP BY id',
    'SELECT DISTINCT id FROM x',
    'SELECT id FROM x WHERE EXISTS (SELECT id FROM y)',
    'SELECT id FROM x; SELECT id FROM y',
  ])('拒绝不属于可定位单表范围的 SQL %s', sql => {
    expect(postgresQueryRecordTable(sql, true)).toBeUndefined();
  });

  it('复合主键按真实列位置保留精度，并拒绝返回值重复或缺少主键', () => {
    const result: QueryResult = {
      columns: ['derived', 'first', 'second'].map(key => ({ key, name: '同名', type: '' })),
      rows: [{ derived: 'A', first: '9223372036854775806', second: '区' }, { derived: 'B', first: '9223372036854775807', second: '区' }],
      elapsedMs: 1, truncated: false, statement: '',
    };
    const origins = [null, { relation: 5, attribute: 2 }, { relation: 5, attribute: 4 }];
    expect(postgresQueryHasUniqueKeys(result, origins, [4, 2])).toBe(true);
    expect(postgresQueryHasUniqueKeys(result, origins, [1, 2])).toBe(false);
    expect(postgresQueryHasUniqueKeys({ ...result, rows: [result.rows[0], { ...result.rows[0], derived: 'B' }] }, origins, [4, 2])).toBe(false);
  });

  it('只接收原执行和行位置，拒绝调用方提交 SQL 或表名', () => {
    const input = { connectionId: 'conn', database: 'db', sessionId: 'session', executionId: 'exec', tabId: 'tab', rowIndex: 0 };
    expect(postgresQueryRecordPageSchema.safeParse(input).success).toBe(true);
    for (const extra of [{ sql: 'SELECT * FROM x' }, { table: 'x' }, { rowIndex: -1 }])
      expect(postgresQueryRecordPageSchema.safeParse({ ...input, ...extra }).success).toBe(false);
  });

  it('保留网格顺序，拒绝重复、越界、超量或混用两种行引用', () => {
    const source = { connectionId: 'conn', database: 'db', sessionId: 'session', executionId: 'exec', tabId: 'tab' };
    expect(postgresQueryRecordPageSchema.parse({ ...source, rowIndices: [91, 7] })).toEqual({ ...source, rowIndices: [91, 7] });
    for (const rowIndices of [[], [7, 7], [100000], Array.from({ length: 101 }, (_, i) => i)])
      expect(postgresQueryRecordPageSchema.safeParse({ ...source, rowIndices }).success).toBe(false);
    expect(postgresQueryRecordPageSchema.safeParse({ ...source, rowIndex: 7, rowIndices: [91] }).success).toBe(false);
  });

  it('删除必须明确提交唯一的原行数组', () => {
    const source = { connectionId: 'conn', database: 'db', sessionId: 'session', executionId: 'exec', tabId: 'tab' };
    const deletion = { ...source, operation: 'delete', rowIndices: [2, 0] };
    expect(postgresQueryRecordPageSchema.parse(deletion)).toEqual(deletion);
    expect(postgresQueryRecordPageSchema.safeParse({ ...source, operation: 'delete', rowIndex: 2 }).success).toBe(false);
    expect(postgresQueryRecordPageSchema.safeParse({ ...deletion, rowIndices: [2, 2] }).success).toBe(false);
    expect(postgresQueryRecordPageSchema.safeParse({ ...deletion, operation: 'truncate' }).success).toBe(false);
  });
});
