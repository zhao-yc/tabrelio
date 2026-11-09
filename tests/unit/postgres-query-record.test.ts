import { describe, expect, it } from 'vitest';
import { postgresQueryRecordTable } from '../../src/engine/postgres/queryRecord';
import { postgresQueryRecordPageSchema } from '../../src/shared/postgresQueryRecord';

describe('PostgreSQL 查询原记录', () => {
  it('识别带列别名、参数和注释的直接投影', () => {
    expect(postgresQueryRecordTable('SELECT t.id AS "编号", t.detail FROM Public.subject t /* 注释 */ WHERE t.id = $1 ORDER BY id;', true))
      .toEqual({ schema: 'public', name: 'subject' });
    expect(postgresQueryRecordTable('SELECT a.* FROM "Mixed" AS a LIMIT 3', true)).toEqual({ name: 'Mixed' });
  });

  it.each([
    'SELECT a.id FROM x a JOIN x b ON a.id=b.id',
    'SELECT a.id FROM x a, y b',
    'SELECT id FROM (SELECT id FROM x) t',
    'SELECT id FROM x UNION ALL SELECT id FROM x',
    'SELECT count(id) FROM x',
    'SELECT id FROM x GROUP BY id',
    'SELECT DISTINCT id FROM x',
    'SELECT id FROM x WHERE EXISTS (SELECT id FROM y)',
    'SELECT id FROM x; SELECT id FROM y',
  ])('拒绝超出单表直接投影的 SQL %s', sql => {
    expect(postgresQueryRecordTable(sql, true)).toBeUndefined();
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
