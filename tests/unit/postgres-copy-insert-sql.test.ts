import { describe, expect, it } from 'vitest';
import type { PostgresTablePage } from '../../src/shared/postgresTable';
import { postgresCopyInsertSql } from '../../src/renderer/postgresCopyInsertSql';

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
