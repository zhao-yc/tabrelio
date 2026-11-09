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
});
