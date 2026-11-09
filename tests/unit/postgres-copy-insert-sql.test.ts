import { describe, expect, it } from 'vitest';
import type { PostgresTablePage } from '../../src/shared/postgresTable';
import { postgresCopyDeleteSql, postgresCopyInsertSql, postgresCopyPrimaryKeyQuery, postgresCopyUpdateSql } from '../../src/renderer/postgresCopyInsertSql';

const page: PostgresTablePage = {
  exportToken: '原页', truncated: false, hasNext: true, order: 'primary', relationKind: 'r',
  capabilities: { insert: false, update: false, delete: false },
  columns: ['id', 'a"b', 'raw', 'generated'].map((name, index) => ({
    key: 'c' + index, name, type: '测试类型', nullable: true, defaultValue: false, generated: index === 0 || index === 3,
    primary: index === 0, binary: index === 2, ...(index === 0 ? { identityAlways: true } : {}),
  })),
  rows: [
    { c0: '9007199254740993', c1: "引号'\\", c2: { type: 'binary', base64: 'AP8=' }, c3: '生成结果' },
    { c0: '9007199254740995', c1: '', c2: null, c3: '生成结果' },
  ],
  rowKeys: ['一', '二'],
};
const table = '"带点.schema"."表""名"';

it('PostgreSQL DELETE 保留 ONLY，拒绝 NULL、草稿和无法定位草稿归属的页', () => {
  const source = { ...page, primaryKey: ['id'] };
  const draft = { rowKey: '二', offset: 0, change: { kind: 'delete' as const, row: 1, pageToken: '旧页' } };
  const selected = new Set([0]);
  expect(postgresCopyDeleteSql(table, source, selected, [draft])).toBe(
    'DELETE FROM ONLY "带点.schema"."表""名"\nWHERE ("id" = E\'9007199254740993\');');
  expect(postgresCopyDeleteSql(table, { ...source, relationKind: 'p' }, selected, [])).toMatch(/^DELETE FROM "带点/);
  expect(() => postgresCopyDeleteSql(table, source, new Set([1]), [draft])).toThrow('草稿');
  expect(() => postgresCopyDeleteSql(table, { ...source, rowKeys: undefined }, selected, [draft])).toThrow('草稿');
  expect(() => postgresCopyDeleteSql(table, { ...source, rows: [{ ...source.rows[0], c0: null }] }, selected, [])).toThrow('缺少原主键值');
});

it('PostgreSQL UPDATE 保持 ONLY 及原键，排除标识和生成列，拒绝任一选中草稿', () => {
  const source = { ...page, primaryKey: ['id'] };
  const sql = postgresCopyUpdateSql(table, source, new Set([1, 0]), []);
  expect(sql.split('\n')).toEqual([
    'UPDATE ONLY "带点.schema"."表""名"',
    String.raw`SET "a""b" = E'引号''\\', "raw" = E'\\x00ff'`,
    'WHERE ("id" = E\'9007199254740993\');',
    'UPDATE ONLY "带点.schema"."表""名"',
    'SET "a""b" = E\'\', "raw" = NULL',
    'WHERE ("id" = E\'9007199254740995\');',
  ]);
  const draft = { rowKey: '二', offset: 0, change: { kind: 'delete' as const, row: 1, pageToken: '旧页' } };
  expect(() => postgresCopyUpdateSql(table, source, new Set([0, 1]), [draft])).toThrow('草稿');
  expect(postgresCopyUpdateSql(table, { ...source, relationKind: 'p' }, new Set([1]), [])).toMatch(/^UPDATE "带点/);
});

describe('PostgreSQL 表页 INSERT 复制', () => {
  it('按原页顺序保留精确文本、空串、NULL 和字节，引用名称并保留标识列', () => {
    const sql = postgresCopyInsertSql(table, page, new Set([1, 0]), []);
    expect(sql.split('\n')).toEqual([
      String.raw`INSERT INTO "带点.schema"."表""名" ("id", "a""b", "raw") OVERRIDING SYSTEM VALUE VALUES (E'9007199254740993', E'引号''\\', E'\\x00ff');`,
      `INSERT INTO "带点.schema"."表""名" ("id", "a""b", "raw") OVERRIDING SYSTEM VALUE VALUES (E'9007199254740995', E'', NULL);`,
    ]);
  });

  it('拒绝勾选草稿、视图、截断原页、越界及缺失列', () => {
    const deletion = { rowKey: '一', offset: 0, change: { kind: 'delete' as const, row: 0, pageToken: '旧页' } };
    expect(() => postgresCopyInsertSql(table, page, new Set([1, 0]), [deletion])).toThrow('草稿');
    expect(postgresCopyInsertSql(table, page, new Set([1]), [deletion])).toContain('9007199254740995');
    expect(() => postgresCopyInsertSql(table, { ...page, relationKind: 'v' }, new Set([0]), [])).toThrow('目标');
    expect(() => postgresCopyInsertSql(table, { ...page, truncated: true }, new Set([0]), [])).toThrow('目标');
    expect(() => postgresCopyInsertSql(table, page, new Set([2]), [])).toThrow('有效行');
    expect(() => postgresCopyInsertSql(table, { ...page, rows: [{ c0: '1', c2: null }] }, new Set([0]), [])).toThrow('缺少字段');
  });

  it('拒绝非规范 Base64、无效 Unicode 及最终 SQL 超出总字节预算', () => {
    const copyWith = (value: (typeof page.rows)[number]['c1']) =>
      postgresCopyInsertSql(table, { ...page, rows: [{ ...page.rows[0], c1: value }] }, new Set([0]), []);
    expect(() => copyWith({ type: 'binary', base64: 'Af==' })).toThrow('不保真');
    expect(() => copyWith('失效\uD800')).toThrow('不保真');
    const rows = Array.from({ length: 3 }, () => ({ ...page.rows[0], c1: "'".repeat(200000) }));
    expect(() => postgresCopyInsertSql(table, { ...page, rows }, new Set([0, 1, 2]), [])).toThrow('字节上限');
  });
});

describe('PostgreSQL 原主键查询复制', () => {
  const original: PostgresTablePage = {
    ...page, primaryKey: ['raw', 'id'], columns: page.columns.map(column => ({
      ...column, primary: column.name === 'raw' || column.name === 'id',
    })),
    rows: [page.rows[0], { ...page.rows[1], c2: { type: 'binary', base64: '' } }],
  };

  it('复合键用主键约束顺序，逐行成组，保留二进制和大整数', () => {
    expect(postgresCopyPrimaryKeyQuery(table, original, new Set([1, 0]))).toBe([
      'SELECT * FROM ONLY "带点.schema"."表""名"',
      String.raw`WHERE ("raw" = E'\\x00ff' AND "id" = E'9007199254740993')`,
      String.raw`   OR ("raw" = E'\\x' AND "id" = E'9007199254740995');`,
    ].join('\n'));
    expect(postgresCopyPrimaryKeyQuery(table, { ...original, relationKind: 'p' }, new Set([1])))
      .toMatch(/^SELECT \* FROM "带点\.schema"\."表""名"\nWHERE /);
  });

  it('拒绝缺失或不完整主键、空键值、非表来源与过期选择', () => {
    expect(() => postgresCopyPrimaryKeyQuery(table, { ...original, primaryKey: ['id'] }, new Set([0]))).toThrow('主键目录');
    expect(() => postgresCopyPrimaryKeyQuery(table, { ...original, relationKind: 'v' }, new Set([0]))).toThrow('主键目录');
    expect(() => postgresCopyPrimaryKeyQuery(table, { ...original, rows: page.rows }, new Set([0, 1]))).toThrow('缺少原主键值');
    expect(() => postgresCopyPrimaryKeyQuery(table, original, new Set([2]))).toThrow('有效行');
  });
});
