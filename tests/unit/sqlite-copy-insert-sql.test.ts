import { expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import type { SqliteTablePage } from '../../src/shared/sqliteTableBrowse';
import { sqliteCopyDeleteDraftRows, sqliteCopyDeleteSql, sqliteCopyInsertDraftRows, sqliteCopyInsertSql, sqliteCopyPrimaryKeyDraftRows, sqliteCopyPrimaryKeyQuery, sqliteCopyUpdateSql } from '../../src/renderer/sqliteCopyInsertSql';

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

it('SQLite DELETE 回放只删除精确复合键，拒绝 NULL 与编辑草稿', () => {
  const source: SqliteTablePage = { ...page, primaryKey: [{ name: 'v"a', collation: 'BINARY' }, { name: 'id', collation: 'BINARY' }] };
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE "表""名"(id INTEGER, "v""a" TEXT COLLATE NOCASE, PRIMARY KEY("v""a" COLLATE BINARY,id));' +
      'INSERT INTO "表""名" VALUES (9223372036854775807,\'Key\'),(9223372036854775807,\'key\');');
    const loaded = { ...source, storageTypes: ['itbi'], result: { ...source.result, rows: [{ ...source.result.rows[0], c1: 'Key' }] } };
    db.exec(sqliteCopyDeleteSql(loaded, new Set([0])));
    expect(db.prepare('SELECT "v""a" AS label FROM "表""名"').all()).toEqual([{ label: 'key' }]);
    expect(() => sqliteCopyDeleteSql({ ...loaded, storageTypes: ['inbi'], result: { ...loaded.result, rows: [{ ...loaded.result.rows[0], c1: null }] } }, new Set([0]))).toThrow('缺少原主键值');
    if (page.edit?.kind !== 'editable') throw Error('缺少测试编辑页');
    const row = { id: 'original-0', index: 0, deleted: true, values: page.edit.rows[0] };
    expect(() => sqliteCopyDeleteDraftRows(source, [row])).toThrow('草稿');
  } finally { db.close(); }
});

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

it('原主键查询保留目录顺序和比较规则，复合值分别成组，使用原快照而非草稿', () => {
  const source: SqliteTablePage = { ...page, primaryKey: [{ name: 'v"a', collation: 'NOCASE' }, { name: 'id', collation: 'BINARY' }] };
  expect(sqliteCopyPrimaryKeyQuery(source, new Set([1, 0]))).toBe([
    'SELECT * FROM "main"."表""名"',
    `WHERE ("v""a" COLLATE NOCASE = -0.0 AND "id" COLLATE BINARY = 9223372036854775807)`,
    `   OR ("v""a" COLLATE NOCASE = '0''🙂' AND "id" COLLATE BINARY = 2);`,
  ].join('\n'));
  expect(sqliteCopyPrimaryKeyDraftRows(source, [{ id: 'original-0', index: 0, deleted: false, values: [{ kind: 'text', value: '修改' }] }]))
    .toBe(sqliteCopyPrimaryKeyQuery(source, new Set([0])));
  expect(() => sqliteCopyPrimaryKeyDraftRows(source, [{ id: 'local', deleted: false, values: [] }])).toThrow('有效行');
});

it('不复制可空主键上的 NULL，也拒绝无主键或不受支持的排序规则', () => {
  expect(() => sqliteCopyPrimaryKeyQuery({ ...page, primaryKey: [{ name: 'raw', collation: 'BINARY' }] }, new Set([0, 1])))
    .toThrow('缺少原主键值');
  expect(() => sqliteCopyPrimaryKeyQuery(page, new Set([0]))).toThrow('主键目录');
  expect(() => sqliteCopyPrimaryKeyQuery({ ...page, primaryKey: [{ name: 'unknown', collation: 'BINARY' }] }, new Set([0])))
    .toThrow('主键目录');
});

it('SQLite UPDATE 回放只更新索引规则下匹配的一行，保留精确类型并由表重算生成列', () => {
  const source: SqliteTablePage = { ...page, primaryKey: [{ name: 'v"a', collation: 'BINARY' }, { name: 'id', collation: 'BINARY' }],
    storageTypes: ['itbi', 'itni'], result: { ...page.result, rows: [{ ...page.result.rows[0], c1: 'Key' }, page.result.rows[1]] } };
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE "表""名"(id INTEGER, "v""a" TEXT COLLATE NOCASE, raw BLOB, g INTEGER AS (length(raw)) STORED, PRIMARY KEY("v""a" COLLATE BINARY,id));' +
      'INSERT INTO "表""名"(id,"v""a",raw) VALUES (9223372036854775807,\'Key\',NULL),(9223372036854775807,\'key\',X\'01\');');
    const sql = sqliteCopyUpdateSql(source, new Set([0]));
    expect(sql).toContain('SET "raw" = X\'00ff\'');
    expect(sql).toContain('"v""a" COLLATE BINARY = \'Key\' AND "id" COLLATE BINARY = 9223372036854775807');
    db.exec(sql);
    expect(db.prepare('SELECT hex(raw) AS raw, g FROM "表""名" ORDER BY "v""a" COLLATE BINARY').all())
      .toEqual([{ raw: '00FF', g: 2 }, { raw: '01', g: 1 }]);
  } finally { db.close(); }
});

it('勾满 1000 行的原主键查询可在 SQLite 默认表达式深度内执行', () => {
  const column = { name: 'id', declaredType: 'INTEGER' };
  const rows = Array.from({ length: 1000 }, (_, index) => ({ c0: String(index + 1) }));
  const source: SqliteTablePage = { ...page, columns: [column], limit: 1000,
    primaryKey: [{ name: 'id', collation: 'BINARY' }], storageTypes: rows.map(() => 'i'),
    result: { ...page.result, columns: [{ key: 'c0', name: 'id', type: 'SQLITE' }], rows },
  };
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE "表""名"(id INTEGER PRIMARY KEY); WITH RECURSIVE n(i) AS ' +
      '(VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<1001) INSERT INTO "表""名" SELECT i FROM n');
    const sql = sqliteCopyPrimaryKeyQuery(source, new Set(rows.keys()));
    expect(db.prepare(sql).all().map(row => row.id).sort((a, b) => Number(a) - Number(b))).toEqual(rows.map(row => Number(row.c0)));
  } finally { db.close(); }
});
