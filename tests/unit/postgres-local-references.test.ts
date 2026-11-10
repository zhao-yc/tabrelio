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

it('INSERT 区分来源、冲突动作和 RETURNING，避免把索引操作符类当字段', () => {
  for (const source of [
    'INSERT INTO orders AS d SELECT ¦d.id FROM incoming RETURNING d.id',
    'INSERT INTO orders AS d VALUES(1) ON CONFLICT (id ¦d.ops) DO UPDATE SET n=d.n RETURNING d.id',
    'INSERT INTO orders AS d VALUES(1) ON CONFLICT (id) DO UPDATE SET n=¦excluded.n RETURNING d.id',
    'INSERT INTO orders AS d VALUES(1) ON CONFLICT (id) DO UPDATE SET n=d.n RETURNING ¦excluded.id',
    'INSERT INTO orders AS excluded VALUES(1) ON CONFLICT (id) DO UPDATE SET n=¦excluded.n RETURNING excluded.id',
  ]) expect(at(source), source).toMatchObject({ status: 'blocked' });
  expect(at('INSERT INTO orders AS excluded VALUES(1) ON CONFLICT (id) DO UPDATE SET n=1 RETURNING ¦excluded.id'))
    .toMatchObject({ status: 'ready', declaration: { start: 'INSERT INTO orders AS '.length } });
});

it('MERGE 按 WHEN 类型限制条件和动作可见的关系', () => {
  const header = 'MERGE INTO orders d USING staging s ON d.id=s.id ';
  for (const clause of [
    'WHEN MATCHED AND ¦d.active THEN UPDATE SET n=s.n',
    'WHEN MATCHED THEN UPDATE SET n=¦s.n',
    'WHEN NOT MATCHED BY SOURCE AND ¦d.active THEN DELETE',
    'WHEN NOT MATCHED BY SOURCE THEN UPDATE SET n=¦d.n',
    'WHEN NOT MATCHED BY TARGET AND ¦s.active THEN INSERT (n) VALUES (s.n)',
    'WHEN NOT MATCHED THEN INSERT (n) VALUES (¦s.n)',
    'WHEN MATCHED THEN DO NOTHING RETURNING ¦s.id, d.id',
  ]) expect(at(header + clause), clause).toMatchObject({ status: 'ready' });
  for (const clause of [
    'WHEN NOT MATCHED BY SOURCE AND ¦s.active THEN DELETE',
    'WHEN NOT MATCHED BY SOURCE THEN UPDATE SET n=(SELECT ¦s.n)',
    'WHEN NOT MATCHED BY TARGET AND ¦d.active THEN DO NOTHING',
    'WHEN NOT MATCHED THEN INSERT (n) VALUES ((SELECT ¦d.n))',
    'WHEN MATCHED THEN UPDATE SET ¦s.n=d.n',
    'WHEN NOT MATCHED THEN INSERT (¦s.n) VALUES (s.n)',
  ]) expect(at(header + clause), clause).toMatchObject({ status: 'blocked' });
});

it('MERGE 的目标不参与来源查询，输出别名只在 RETURNING 可见', () => {
  expect(at('MERGE INTO ONLY (public.orders) d USING LATERAL (SELECT ¦d.id) s ON true WHEN MATCHED THEN DO NOTHING'))
    .toMatchObject({ status: 'blocked' });
  const header = 'MERGE INTO public.orders * d USING (VALUES (1)) s(id) ON d.id=s.id ';
  expect(at(header + 'WHEN MATCHED THEN DELETE RETURNING WITH (OLD AS previous) ¦previous.id, s.id'))
    .toMatchObject({ status: 'ready', declaration: { start: (header + 'WHEN MATCHED THEN DELETE RETURNING WITH (OLD AS ').length } });
  expect(at(header + 'WHEN MATCHED AND ¦previous.id=1 THEN DELETE RETURNING WITH (OLD AS previous) previous.id'))
    .toMatchObject({ status: 'blocked' });
});

it('MERGE 区分来源 JOIN ON 与合并 ON，也接受限定字段中的保留词', () => {
  const join = 'MERGE INTO orders d USING incoming s JOIN flags f ';
  expect(at(join + 'ON ¦s.on=f.id ON d.id=s.on WHEN MATCHED AND s.when=1 THEN UPDATE SET n=s.n RETURNING s.id'))
    .toMatchObject({ status: 'ready', declaration: { start: 'MERGE INTO orders d USING incoming '.length },
      references: Array.from({ length: 5 }, () => expect.any(Object)) });
  expect(at(join + 'ON ¦d.id=f.id ON d.id=s.id WHEN MATCHED THEN DELETE')).toMatchObject({ status: 'blocked' });
  expect(at(join + 'JOIN labels l ON ¦f.id=l.id ON s.id=f.id ON d.id=s.id WHEN MATCHED THEN DELETE'))
    .toMatchObject({ status: 'ready' });
  expect(at(join + 'JOIN labels l ON ¦s.id=l.id ON s.id=f.id ON d.id=s.id WHEN MATCHED THEN DELETE'))
    .toMatchObject({ status: 'blocked' });
});

it('MERGE 按服务器命名空间区分 JOIN 输入、整体别名和 USING 列别名', () => {
  const start = 'MERGE INTO orders d USING ';
  const bySource = 'WHEN NOT MATCHED BY SOURCE AND ';
  const grouped = '((SELECT 1 id) AS s JOIN flags f ON s.id=f.id) AS j(sid,fid,flag) ';
  expect(at(start + 'incoming s JOIN flags f ON s.id=f.id ON d.id=s.id ' + bySource + '¦s.id IS NULL THEN DELETE'))
    .toMatchObject({ status: 'ready' });
  expect(at(start + grouped + 'ON d.id=j.sid ' + bySource + '¦j.sid IS NULL THEN DELETE')).toMatchObject({ status: 'blocked' });
  expect(at(start + grouped + 'ON d.id=j.sid WHEN MATCHED THEN DELETE RETURNING ¦s.id')).toMatchObject({ status: 'blocked' });
  expect(at(start + grouped + 'ON d.id=j.sid WHEN MATCHED THEN DELETE RETURNING ¦j.sid')).toMatchObject({ status: 'ready' });
  const using = 'incoming s JOIN flags f USING(id) AS j ON d.id=j.id ';
  expect(at(start + using + 'WHEN NOT MATCHED THEN INSERT (id) VALUES (¦j.id)')).toMatchObject({ status: 'ready' });
  expect(at(start + using + 'WHEN MATCHED THEN UPDATE SET n=¦j.n')).toMatchObject({ status: 'blocked' });
  expect(at(start + using + bySource + '¦j.id IS NULL THEN DELETE')).toMatchObject({ status: 'blocked' });
});

it('MERGE 表函数与 LATERAL 查询只能关联可见的 JOIN 左侧', () => {
  const join = 'MERGE INTO orders d USING incoming s ';
  const tail = ' ON d.id=s.id WHEN MATCHED THEN UPDATE SET n=g.n';
  expect(at(join + 'CROSS JOIN pg_catalog.generate_series(1,¦s.n) WITH ORDINALITY AS g(n,seq)' + tail))
    .toMatchObject({ status: 'ready' });
  expect(at(join + 'CROSS JOIN LATERAL (SELECT ¦s.n) g' + tail)).toMatchObject({ status: 'ready' });
  expect(at(join + 'CROSS JOIN (SELECT ¦s.n) g' + tail)).toMatchObject({ status: 'blocked' });
  expect(at(join + 'RIGHT JOIN LATERAL (SELECT ¦s.n) g ON true' + tail)).toMatchObject({ status: 'blocked' });
  expect(at('MERGE INTO orders d USING generate_series(1,¦d.n) g(n) ON d.id=g.n WHEN MATCHED THEN DELETE'))
    .toMatchObject({ status: 'blocked' });
});

it('表函数识别带类型的列定义及 ROWS FROM 的外层关系别名', () => {
  expect(at('SELECT ¦r.n FROM get_records() AS r(n numeric(12,3), names text[], label text COLLATE "C")'))
    .toMatchObject({ status: 'ready' });
  expect(at('SELECT r.n FROM get_records() AS r(n ¦r.money_type)')).toMatchObject({ status: 'blocked' });
  const rows = 'ROWS FROM (get_records() AS (id int), generate_series(1,2)) WITH ORDINALITY AS r(id,n,seq)';
  expect(at('SELECT ¦r.seq FROM ' + rows)).toMatchObject({ status: 'ready' });
  expect(at('DELETE FROM orders d USING ' + rows + ' WHERE d.id=r.id RETURNING ¦r.seq')).toMatchObject({ status: 'ready' });
  expect(at('MERGE INTO orders d USING ' + rows + ' ON d.id=r.id WHEN MATCHED THEN UPDATE SET n=¦r.n'))
    .toMatchObject({ status: 'ready' });
  for (const invalid of ['get_records() (id int)', 'get_records() WITH ORDINALITY AS r(id int)',
    'ROWS FROM (get_records() AS (id int), generate_series(1,2)) AS r(id int)',
    'ROWS FROM (get_records() AS (id int),) AS r', 'ROWS FROM (get_records() AS (id)) AS r']) {
    expect(at('SELECT ¦s.id FROM orders s, ' + invalid), invalid).toMatchObject({ status: 'blocked' });
  }
});

it('ROWS FROM 只用第一个函数的默认名称遮蔽外层关系', () => {
  expect(at('SELECT (SELECT ¦get_records.id FROM ROWS FROM (get_records() AS (id int), generate_series(1,2))) FROM orders get_records'))
    .toMatchObject({ status: 'blocked' });
  expect(at('SELECT (SELECT ¦get_records.id FROM ROWS FROM (generate_series(1,2), get_records() AS (id int))) FROM orders get_records'))
    .toMatchObject({ status: 'ready' });
  expect(at('SELECT (SELECT ¦get_records.id FROM pg_catalog.get_records() AS (id int)) FROM orders get_records'))
    .toMatchObject({ status: 'blocked' });
});

it('ROWS FROM 的实参共用外层范围，并遵守 JOIN 和写入目标的关联限制', () => {
  expect(at('SELECT r.id FROM incoming p, incoming s RIGHT JOIN ROWS FROM (generate_series(1,¦p.n)) AS r(id) ON true'))
    .toMatchObject({ status: 'ready' });
  expect(at('SELECT r.id FROM incoming p, incoming s RIGHT JOIN ROWS FROM (generate_series(1,¦s.n)) AS r(id) ON true'))
    .toMatchObject({ status: 'blocked' });
  expect(at('SELECT r.id FROM incoming s CROSS JOIN ROWS FROM (get_records(¦s.n) AS (id int), generate_series(1,s.n)) r'))
    .toMatchObject({ status: 'ready' });
  expect(at('UPDATE orders d SET n=1 FROM ROWS FROM (generate_series(1,¦d.n)) r(id) WHERE d.id=r.id'))
    .toMatchObject({ status: 'blocked' });
  expect(at('MERGE INTO orders d USING ROWS FROM (generate_series(1,¦d.n)) r(id) ON d.id=r.id WHEN MATCHED THEN DELETE'))
    .toMatchObject({ status: 'blocked' });
});
