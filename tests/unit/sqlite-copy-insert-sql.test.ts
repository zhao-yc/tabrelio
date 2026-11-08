import { expect, it } from 'vitest';
import type { SqliteTablePage } from '../../src/shared/sqliteTableBrowse';
import { sqliteCopyInsertDraftRows, sqliteCopyInsertSql } from '../../src/renderer/sqliteCopyInsertSql';

const columns = ['id', 'v"a', 'raw', 'g'].map((name, index) => ({ name, declaredType: '', ...(index === 3 ? { generated: true } : {}) }));
const page: SqliteTablePage = {
  target: { connectionId: 'c', database: 'main', table: '表"名', kind: 'table' },
  schemaKey: '目录', columns, insertCopy: true, offset: 0, limit: 2, hasMore: false,
  storageTypes: ['irbi', 'itni'],
  result: { columns: columns.map(({ name }, index) => ({ name, key: 'c' + index, type: 'SQLITE' })),
    rows: [{ c0: '9223372036854775807', c1: '-0', c2: { type: 'binary', base64: 'AP8=' }, c3: '3' },
      { c0: '2', c1: "0'🙂", c2: null, c3: '3' }], truncated: false, elapsedMs: 0, statement: '' },
  edit: { kind: 'editable', snapshotId: 's', expiresAt: new Date().toISOString(), locator: { kind: 'rowid', columns: [] },
    columns: columns.map(column => ({ ...column, generated: !!column.generated, nullable: true, hasDefault: false })),
    rows: [[{ kind: 'integer', value: '9223372036854775807' }, { kind: 'real', value: '-0' },
      { kind: 'blob', value: '00ff' }, { kind: 'integer', value: '3' }]] },
};

it('按存储标记生成 INTEGER、REAL、TEXT、BLOB 与 NULL，省略生成列', () => {
  expect(sqliteCopyInsertSql(page, new Set([1, 0])).split('\n')).toEqual([
    `INSERT INTO "main"."表""名" ("id", "v""a", "raw") VALUES (9223372036854775807, -0.0, X'00ff');`,
    `INSERT INTO "main"."表""名" ("id", "v""a", "raw") VALUES (2, '0''🙂', NULL);`,
  ]);
});

it('拒绝非普通表、缺少类型、损坏原值、无效行号与超限内容', () => {
  expect(() => sqliteCopyInsertSql({ ...page, insertCopy: undefined }, new Set([0]))).toThrow('目标');
  expect(() => sqliteCopyInsertSql({ ...page, storageTypes: undefined }, new Set([0]))).toThrow('目标');
  expect(() => sqliteCopyInsertSql({ ...page, storageTypes: ['iibi', 'itni'] }, new Set([0]))).toThrow('不保真');
  expect(() => sqliteCopyInsertSql(page, new Set([2]))).toThrow('有效行');
  const rows = [{ ...page.result.rows[0], c1: "'".repeat(300000) }];
  expect(() => sqliteCopyInsertSql({ ...page, storageTypes: ['itbi'], result: { ...page.result, rows } }, new Set([0]))).toThrow('字节上限');
});

it('编辑页仅接受与原存储类型和值一致的原行，新增、删除与修改整批拒绝', () => {
  if (page.edit?.kind !== 'editable') throw Error('缺少测试编辑页');
  const row = { id: 'original-0', index: 0, deleted: false, values: structuredClone(page.edit.rows[0]) };
  expect(sqliteCopyInsertDraftRows(page, [row])).toContain('9223372036854775807');
  expect(() => sqliteCopyInsertDraftRows(page, [{ ...row, index: undefined }])).toThrow('草稿');
  expect(() => sqliteCopyInsertDraftRows(page, [{ ...row, deleted: true }])).toThrow('草稿');
  row.values[1] = { kind: 'text', value: '-0' };
  expect(() => sqliteCopyInsertDraftRows(page, [row])).toThrow('草稿');
});
