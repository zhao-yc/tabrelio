import { expect, it } from 'vitest';
import { analyzePostgresLocalReferences } from '../../src/renderer/postgresCompletionAnalysis';

function at(marked: string, standardStrings?: boolean) {
  const offset = marked.indexOf('¦'), sql = marked.replace('¦', '');
  return analyzePostgresLocalReferences(sql, offset, standardStrings);
}

it('同名内外层及集合分支各自归到原声明位置', () => {
  const sql = 'SELECT s.id, (SELECT s.id FROM child s) FROM parent s WHERE s.id=1 UNION ALL SELECT s.id FROM third s';
  const [first, inner, last, branch] = [...sql.matchAll(/s\.id/g)].map(match => match.index!);
  const range = (start: number) => ({ start, end: start + 1 });
  expect(analyzePostgresLocalReferences(sql, first)).toEqual({ status: 'ready', target: range(first),
    declaration: range(sql.indexOf('parent s') + 7), references: [range(first), range(last)] });
  expect(analyzePostgresLocalReferences(sql, inner)).toEqual({ status: 'ready', target: range(inner),
    declaration: range(sql.indexOf('child s') + 6), references: [range(inner)] });
  expect(analyzePostgresLocalReferences(sql, branch)).toEqual({ status: 'ready', target: range(branch),
    declaration: range(sql.length - 1), references: [range(branch)] });
});

it('相关子查询和 LATERAL 可引用外层，普通派生表不继承同层来源', () => {
  expect(at('SELECT (SELECT ¦p.id FROM child) FROM parent p')).toMatchObject({ status: 'ready' });
  expect(at('SELECT * FROM parent p, LATERAL (SELECT ¦p.id) d')).toMatchObject({ status: 'ready' });
  expect(at('SELECT * FROM parent p, (SELECT ¦p.id) d')).toMatchObject({ status: 'blocked' });
  expect(at('SELECT * FROM parent p, generate_series(1, ¦p.id) g')).toMatchObject({ status: 'ready' });
  expect(at('SELECT * FROM parent p, child c JOIN other o ON ¦p.id=o.id')).toMatchObject({ status: 'blocked' });
  expect(at('SELECT * FROM parent p JOIN child c ON ¦p.id=c.id')).toMatchObject({ status: 'ready' });
});

it('CTE 来源、引用限定符和别名是不同绑定，嵌套 WITH 会遮蔽外层声明', () => {
  const sql = 'WITH q AS (SELECT 1 id), r AS (WITH q AS (SELECT 2 id) SELECT q.id FROM q) SELECT a.id FROM q a';
  const outer = analyzePostgresLocalReferences(sql, sql.indexOf('q'));
  expect(outer).toMatchObject({ status: 'ready', declaration: { start: sql.indexOf('q') },
    references: [{ start: sql.lastIndexOf('FROM q') + 5 }] });
  const inner = analyzePostgresLocalReferences(sql, sql.indexOf('q.id'));
  expect(inner).toMatchObject({ status: 'ready', declaration: { start: sql.lastIndexOf('WITH q') + 5 },
    references: [{ start: sql.indexOf('q.id') }, { start: sql.indexOf('FROM q') + 5 }] });
  expect(analyzePostgresLocalReferences(sql, sql.indexOf('a.id'))).toMatchObject({ status: 'ready',
    declaration: { start: sql.length - 1 }, references: [{ start: sql.indexOf('a.id') }] });
  expect(at('WITH RECURSIVE ¦q AS (SELECT 1 n UNION ALL SELECT q.n+1 FROM q WHERE q.n<3) SELECT q.n FROM q'))
    .toMatchObject({ status: 'ready', references: Array.from({ length: 5 }, () => expect.any(Object)) });
});

it('未引用名称折叠 ASCII，双引号名称区分大小写并保留完整 UTF-16 范围', () => {
  expect(at('SELECT ¦A.id FROM t "a"')).toMatchObject({ status: 'ready', declaration: { start: 19, end: 22 } });
  expect(at('SELECT ¦A.id FROM t "A"')).toMatchObject({ status: 'blocked' });
  const sql = 'SELECT "舟🚢".id FROM t AS "舟🚢"';
  expect(analyzePostgresLocalReferences(sql, sql.indexOf('舟'))).toMatchObject({ status: 'ready',
    target: { start: 7, end: 12 }, declaration: { start: sql.lastIndexOf('"舟'), end: sql.length } });
});

it('跳过字符串、注释、模式限定函数和类型，并停在当前语句', () => {
  for (const sql of ["SELECT '¦s.id' FROM t s", 'SELECT $f$¦s.id$f$, s.id FROM t s', 'SELECT /* ¦s.id */ s.id FROM t s',
    'SELECT ¦s.fn(1), s.id FROM t s', 'SELECT 1::¦s.type, s.id FROM t s', "SELECT ¦s.type '1', s.id FROM t s",
    'SELECT * FROM ¦s.table t, x s', 'SELECT ¦s.t.id, s.id FROM t s']) {
    expect(at(sql), sql).toMatchObject({ status: 'blocked' });
  }
  expect(at('SELECT s.id FROM a s; SELECT ¦s.id FROM b s; SELECT s.id FROM c s')).toMatchObject({ status: 'ready',
    references: [{ start: 'SELECT s.id FROM a s; SELECT '.length }] });
});

it('离线拒绝依赖字符串模式的绑定，并拒绝尚未支持的关系结构', () => {
  const mode = "SELECT '\\' AS literal, ¦s.id FROM t s";
  expect(at(mode, true)).toMatchObject({ status: 'ready' });
  expect(at(mode, false)).toMatchObject({ status: 'blocked' });
  expect(at(mode)).toMatchObject({ status: 'blocked' });
  for (const sql of ['SELECT ¦s.id FROM (t s JOIN other o ON s.id=o.id)',
    'SELECT ¦s.id FROM a JOIN b USING (id) AS s', 'SELECT ¦s.id FROM t s WHERE (s.id=1',
    'SELECT ¦s.id FROM t U&"\\0073"', 'SELECT ¦s.id FROM a s JOIN b s ON true']) {
    expect(at(sql), sql).toMatchObject({ status: 'blocked' });
  }
});

it('写入目标仅在赋值、条件及输出表达式可见，SET 左侧不绑定关系', () => {
  expect(at('UPDATE parent s SET ¦s.field=1 WHERE s.id=2')).toMatchObject({ status: 'blocked' });
  expect(at('UPDATE parent s SET n=1 FROM LATERAL (SELECT ¦s.id) x WHERE s.id=x.id')).toMatchObject({ status: 'blocked' });
  expect(at('DELETE FROM parent s USING incoming i JOIN other o ON ¦s.id=o.id WHERE s.id=i.id')).toMatchObject({ status: 'blocked' });
  expect(at('UPDATE parent s SET n=(SELECT ¦s.id) FROM child c WHERE s.id=c.id RETURNING s.id'))
    .toMatchObject({ status: 'ready', references: Array.from({ length: 3 }, () => expect.any(Object)) });
  expect(at('DELETE FROM parent s USING incoming i WHERE s.id=i.id RETURNING WITH (OLD AS before) ¦before.id'))
    .toMatchObject({ status: 'ready', declaration: { start: 'DELETE FROM parent s USING incoming i WHERE s.id=i.id RETURNING WITH (OLD AS '.length } });
});
