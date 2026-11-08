import { expect, it } from 'vitest';
import { mysqlQuickValueAllowed, postgresQuickValueAllowed, sqliteQuickValueAllowed } from '../../src/renderer/gridQuickValue';

it('快速 NULL 只允许可空普通字段，SQLite 主键不进入快速置空', () => {
  const base = { name: 'value', nullable: true, generated: false };
  const mysql = { ...base, type: 'blob', defaultValue: null, extra: '', comment: '' };
  const pg = { ...base, key: 'c0', type: 'bytea', defaultValue: false, primary: false, binary: true };
  const sqlite = { ...base, declaredType: 'BLOB', hasDefault: false };
  expect(mysqlQuickValueAllowed(mysql, 'null')).toBe(true);
  expect(postgresQuickValueAllowed(pg, 'null')).toBe(true);
  expect(sqliteQuickValueAllowed(sqlite, true, 'null')).toBe(true);
  expect(mysqlQuickValueAllowed({ ...mysql, nullable: false }, 'null')).toBe(false);
  expect(postgresQuickValueAllowed({ ...pg, generated: true }, 'null')).toBe(false);
  expect(sqliteQuickValueAllowed({ ...sqlite, primary: true }, false, 'null')).toBe(false);
});

it('空字符串与 NULL 独立判断，明确排除非文本类型', () => {
  const base = { name: 'value', nullable: false, generated: false };
  const mysql = { ...base, type: 'varchar(17)', defaultValue: null, extra: '', comment: '' };
  const pg = { ...base, key: 'c0', type: 'character varying(17)', defaultValue: false, primary: false, binary: false };
  const sqlite = { ...base, declaredType: 'ANY', hasDefault: false };
  expect(mysqlQuickValueAllowed(mysql, 'empty')).toBe(true);
  expect(postgresQuickValueAllowed(pg, 'empty')).toBe(true);
  expect(sqliteQuickValueAllowed(sqlite, true, 'empty')).toBe(true);
  expect(sqliteQuickValueAllowed({ ...sqlite, declaredType: '' }, false, 'empty')).toBe(true);
  expect(mysqlQuickValueAllowed({ ...mysql, type: 'json' }, 'empty')).toBe(false);
  expect(postgresQuickValueAllowed({ ...pg, type: 'integer' }, 'empty')).toBe(false);
  expect(sqliteQuickValueAllowed({ ...sqlite, declaredType: 'BLOB' }, true, 'empty')).toBe(false);
});
