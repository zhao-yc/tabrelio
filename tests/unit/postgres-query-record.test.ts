import { describe, expect, it } from 'vitest';
import type { QueryResult } from '../../src/shared/contracts';
import { postgresQueryHasUniqueKeys, postgresQueryJoinTarget, postgresQueryRecordTable } from '../../src/engine/postgres/queryRecord';
import type { PostgresConnection } from '../../src/engine/postgres/connection';
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
    'SELECT a.id FROM x a, y b',
    'SELECT a.id FROM x a RIGHT JOIN y b ON a.id=b.id',
    'SELECT a.id FROM x a FULL JOIN y b ON a.id=b.id',
    'SELECT a.id FROM x a NATURAL JOIN y b',
    'SELECT a.id FROM x a JOIN y b ON a.id=b.id, z c',
    'SELECT b.*, a.id FROM x a JOIN y b ON a.id=b.id',
    'SELECT id FROM x a JOIN y b USING (id)',
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

  it('找到 JOIN 左表投影及真实关系，防止同名目录交换或遗漏参与表', async () => {
    const table = postgresQueryRecordTable('SELECT b.note AS 同名, a.*, c.note FROM "甲".x a ' +
      'LEFT OUTER JOIN "乙".x b ON left(b.note,2)=a.note INNER JOIN c USING (id) ORDER BY a.id', true)!;
    expect(table).toMatchObject({ schema: '甲', name: 'x', joins: [{ schema: '乙', name: 'x' }, { name: 'c' }], anchorIndex: 1 });
    const origins = [{ relation: 8, attribute: 1 }, { relation: 7, attribute: 1 }, { relation: 7, attribute: 2 }, { relation: 9, attribute: 1 }];
    const connection = (oids: number[]): Pick<PostgresConnection, 'query'> => ({ query: async () => ({
      rows: oids.map(oid => ({ c0: String(oid) })), truncated: false, columns: [], elapsedMs: 0, statement: '',
    }) });
    expect(await postgresQueryJoinTarget(connection([7, 8, 9]), table, origins)).toBe(7);
    expect(await postgresQueryJoinTarget(connection([8, 7, 9]), table, origins)).toBeUndefined();
    expect(await postgresQueryJoinTarget(connection([7, 8, 9]), table, origins.slice(0, -1))).toBeUndefined();
    expect(await postgresQueryJoinTarget(connection([7, 7, 9]), table, origins)).toBeUndefined();
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

  it('外键浏览只接收一个原行，拒绝表名、外键值和批量位置', () => {
    const source = { connectionId: 'conn', database: 'db', sessionId: 'session', executionId: 'exec', tabId: 'tab',
      operation: 'reference' };
    const request = { ...source, rowIndex: 91 };
    expect(postgresQueryRecordPageSchema.parse(request)).toEqual(request);
    expect(postgresQueryRecordPageSchema.safeParse(source).success).toBe(false);
    for (const extra of [{ table: 'public.other' }, { foreignKey: '2' }, { rowIndices: [91] }, { rowIndex: 100000 }])
      expect(postgresQueryRecordPageSchema.safeParse({ ...request, ...extra }).success).toBe(false);
  });

  it('删除和复制必须明确提交唯一的原行数组', () => {
    const source = { connectionId: 'conn', database: 'db', sessionId: 'session', executionId: 'exec', tabId: 'tab' };
    const deletion = { ...source, operation: 'delete', rowIndices: [2, 0] };
    expect(postgresQueryRecordPageSchema.parse(deletion)).toEqual(deletion);
    const duplication = { ...deletion, operation: 'insert' };
    expect(postgresQueryRecordPageSchema.parse(duplication)).toEqual(duplication);
    expect(postgresQueryRecordPageSchema.safeParse({ ...duplication, rowIndices: [] }).success).toBe(false);
    expect(postgresQueryRecordPageSchema.safeParse({ ...source, operation: 'delete', rowIndex: 2 }).success).toBe(false);
    expect(postgresQueryRecordPageSchema.safeParse({ ...deletion, rowIndices: [2, 2] }).success).toBe(false);
    expect(postgresQueryRecordPageSchema.safeParse({ ...deletion, operation: 'truncate' }).success).toBe(false);
  });

  it('新增仅绑定原执行，不接收行索引或调用方指定的表', () => {
    const source = { connectionId: 'conn', database: 'db', sessionId: 'session', executionId: 'exec', tabId: 'tab', operation: 'new' };
    expect(postgresQueryRecordPageSchema.parse(source)).toEqual(source);
    for (const extra of [{ rowIndices: [] }, { rowIndex: 0 }, { table: 'public.other' }])
      expect(postgresQueryRecordPageSchema.safeParse({ ...source, ...extra }).success).toBe(false);
  });
});
