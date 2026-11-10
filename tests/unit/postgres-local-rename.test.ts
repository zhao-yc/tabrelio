import { expect, it } from 'vitest';
import { analyzePostgresLocalRename } from '../../src/renderer/postgresCompletionAnalysis';
import { quoteLocalRename } from '../../src/shared/localRename';

function rename(marked: string, name?: string, standardStrings?: boolean) {
  return analyzePostgresLocalRename(marked.replace('¦', ''), marked.indexOf('¦'), standardStrings, name);
}

function edited(marked: string, name: string) {
  const result = rename(marked, name);
  expect(result.status).toBe('ready');
  if (result.status !== 'ready') throw Error('未能确认待改写的绑定');
  return result.edits.reduceRight((sql, edit) => sql.slice(0, edit.start) + edit.text + sql.slice(edit.end), marked.replace('¦', ''));
}

it('只替换外层别名的声明和引用，保留子查询及相邻语句的同名绑定', () => {
  const source = 'SELECT ¦s.id, (SELECT s.id FROM child s) FROM parent s WHERE s.id=1; SELECT s.id FROM next s';
  const prepared = rename(source);
  expect(prepared).toMatchObject({ status: 'ready', kind: 'alias', name: 's', edits: [] });
  expect(edited(source, '外层')).toBe('SELECT "外层".id, (SELECT s.id FROM child s) FROM parent "外层" WHERE "外层".id=1; SELECT s.id FROM next s');
});

it('递归 CTE、来源及限定符成组替换，独立的同名显式别名保留', () => {
  const source = 'WITH RECURSIVE ¦q AS (SELECT 1 n UNION ALL SELECT q.n+1 FROM q WHERE q.n<3) SELECT q.n FROM q q';
  expect(rename(source)).toMatchObject({ status: 'ready', kind: 'cte', name: 'q' });
  expect(edited(source, '明细🚢')).toBe('WITH RECURSIVE "明细🚢" AS (SELECT 1 n UNION ALL SELECT "明细🚢".n+1 FROM "明细🚢" WHERE "明细🚢".n<3) SELECT q.n FROM "明细🚢" q');
});

it('双引号保留大小写，未引用标识符折叠 ASCII，名称中双引号正确转义', () => {
  expect(edited('SELECT ¦S.id, "S".id FROM a s, b "S"', '新"名'))
    .toBe('SELECT "新""名".id, "S".id FROM a "新""名", b "S"');
  expect(edited('SELECT ¦s.id FROM a s', 'S')).toBe('SELECT "S".id FROM a "S"');
  expect(rename('SELECT ¦S.id FROM a s', 's')).toMatchObject({ status: 'ready', edits: [] });
});

it('拒绝可能改变绑定的名称冲突及未确认的整行引用', () => {
  expect(rename('SELECT ¦s.id, x.id FROM parent s JOIN child x ON s.id=x.id', 'x')).toEqual({ status: 'blocked', reason: 'collision' });
  expect(rename('WITH ¦q AS (SELECT 1 id) SELECT q.id FROM q JOIN child ON child.id=q.id', 'child'))
    .toEqual({ status: 'blocked', reason: 'collision' });
  expect(rename('SELECT ¦s.id, row_to_json(s) FROM t s', 'alias')).toEqual({ status: 'blocked', reason: 'unresolved' });
  expect(rename('SELECT ¦s.id FROM t s WHERE EXISTS (SELECT s FROM child s)', 'alias')).toEqual({ status: 'blocked', reason: 'unresolved' });
  expect(rename('SELECT ¦t.id FROM t', 'alias')).toMatchObject({ status: 'blocked' });
});

it('字符串和注释不参与替换，离线只接收两种字符串模式一致的编辑', () => {
  expect(edited("SELECT ¦s.id, 's.id', $$s.id$$ FROM t s /* s */", 'next'))
    .toBe("SELECT \"next\".id, 's.id', $$s.id$$ FROM t \"next\" /* s */");
  const source = "SELECT '\\' AS literal, ¦s.id FROM t s";
  expect(rename(source, 'next', true)).toMatchObject({ status: 'ready', edits: expect.any(Array) });
  expect(rename(source, 'next')).toMatchObject({ status: 'blocked' });
});

it('限制为 63 个 UTF-8 字节，拒绝孤立代理、控制字符和空名称', () => {
  const source = 'SELECT ¦s.id FROM t s', fits = '🚢'.repeat(15) + '船';
  expect(quoteLocalRename(fits, 'postgresql')).toBe('"' + fits + '"');
  for (const name of ['🚢'.repeat(16), '汉'.repeat(22), '\uD800', 'a\nb', ' ']) {
    expect(rename(source, name)).toEqual({ status: 'blocked', reason: 'name' });
  }
});
