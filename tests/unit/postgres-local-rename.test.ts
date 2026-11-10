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

it('UPDATE 和 DELETE 分别绑定写入目标及 FROM/USING 来源', () => {
  expect(edited('UPDATE ONLY public.orders AS ¦dst SET total=src.total FROM incoming src WHERE dst.id=src.id RETURNING dst.total', 'target'))
    .toBe('UPDATE ONLY public.orders AS "target" SET total=src.total FROM incoming src WHERE "target".id=src.id RETURNING "target".total');
  expect(edited('WITH q AS (SELECT 1 id) DELETE FROM orders d USING ¦q WHERE d.id=q.id RETURNING d.id', '待删'))
    .toBe('WITH "待删" AS (SELECT 1 id) DELETE FROM orders d USING "待删" WHERE d.id="待删".id RETURNING d.id');
  expect(edited('DELETE FROM orders d USING incoming ¦i, facts f JOIN owner o ON f.owner_id=o.id WHERE d.id=i.id RETURNING i.*', 'source'))
    .toBe('DELETE FROM orders d USING incoming "source", facts f JOIN owner o ON f.owner_id=o.id WHERE d.id="source".id RETURNING "source".*');
});

it('写入 CTE 的 RETURNING 与外层查询保持各自绑定', () => {
  expect(edited('WITH removed AS (DELETE FROM orders ¦d WHERE d.closed RETURNING d.id) SELECT d.id FROM removed d', 'gone'))
    .toBe('WITH removed AS (DELETE FROM orders "gone" WHERE "gone".closed RETURNING "gone".id) SELECT d.id FROM removed d');
  expect(edited('WITH ¦removed AS (DELETE FROM orders d RETURNING d.id) SELECT removed.id FROM removed', 'archived'))
    .toBe('WITH "archived" AS (DELETE FROM orders d RETURNING d.id) SELECT "archived".id FROM "archived"');
});

it('拒绝把 SET 复合字段或 FROM/USING 中不可见的写入目标当成已确认引用', () => {
  expect(rename('UPDATE parent s SET s.field=1 WHERE ¦s.id=2', 'target')).toEqual({ status: 'blocked', reason: 'unresolved' });
  expect(rename('UPDATE parent s SET n=1 FROM LATERAL (SELECT s.id) x WHERE ¦s.id=x.id', 'target'))
    .toEqual({ status: 'blocked', reason: 'unresolved' });
  expect(rename('DELETE FROM parent s USING generate_series(1, s.id) x WHERE ¦s.id=x.x', 'target'))
    .toEqual({ status: 'blocked', reason: 'unresolved' });
  expect(edited('UPDATE parent s SET n=(SELECT ¦s.id) FROM incoming i, LATERAL (SELECT i.id) x WHERE s.id=x.id', 'target'))
    .toBe('UPDATE parent "target" SET n=(SELECT "target".id) FROM incoming i, LATERAL (SELECT i.id) x WHERE "target".id=x.id');
});

it('RETURNING 显式 OLD/NEW 别名可重命名，保留其他输出绑定和默认名称', () => {
  expect(edited('UPDATE orders d SET n=d.n+1 RETURNING WITH (OLD AS ¦before, NEW AS after) before.n, after.n, d.id', 'previous'))
    .toBe('UPDATE orders d SET n=d.n+1 RETURNING WITH (OLD AS "previous", NEW AS after) "previous".n, after.n, d.id');
  expect(rename('DELETE FROM orders d RETURNING ¦old.id', 'before')).toMatchObject({ status: 'blocked' });
  expect(rename('UPDATE orders ¦d SET n=1 RETURNING WITH (OLD AS d) d.n', 'target')).toMatchObject({ status: 'blocked' });
  expect(edited('UPDATE orders old SET n=1 RETURNING ¦old.id, new.n', 'target'))
    .toBe('UPDATE orders "target" SET n=1 RETURNING "target".id, new.n');
});

it('INSERT 来源和冲突更新各自解析，两个同名别名不会一起改写', () => {
  const source = 'INSERT INTO public.orders AS ¦d (id,n) SELECT d.id,d.n FROM incoming d ON CONFLICT (id) DO UPDATE SET n=excluded.n+d.n WHERE d.id=excluded.id RETURNING d.n';
  expect(edited(source, 'target'))
    .toBe('INSERT INTO public.orders AS "target" (id,n) SELECT d.id,d.n FROM incoming d ON CONFLICT (id) DO UPDATE SET n=excluded.n+"target".n WHERE "target".id=excluded.id RETURNING "target".n');
  expect(edited('INSERT INTO orders AS d SELECT ¦a.id FROM incoming a JOIN flags f ON conflict ON CONFLICT DO NOTHING RETURNING d.id', 'source'))
    .toBe('INSERT INTO orders AS d SELECT "source".id FROM incoming "source" JOIN flags f ON conflict ON CONFLICT DO NOTHING RETURNING d.id');
});

it('INSERT 支持 TABLE、括号中的 SELECT、VALUES 及 DEFAULT VALUES 来源', () => {
  expect(edited('WITH ¦q AS (SELECT 1 id) INSERT INTO orders AS q(id) TABLE q RETURNING q.id', 'rows'))
    .toBe('WITH "rows" AS (SELECT 1 id) INSERT INTO orders AS q(id) TABLE "rows" RETURNING q.id');
  expect(edited('INSERT INTO orders AS d (SELECT ¦s.id FROM incoming s) UNION ALL SELECT 2 RETURNING d.id', 'source'))
    .toBe('INSERT INTO orders AS d (SELECT "source".id FROM incoming "source") UNION ALL SELECT 2 RETURNING d.id');
  expect(edited('INSERT INTO orders AS d(id) OVERRIDING SYSTEM VALUE VALUES (1) RETURNING WITH (NEW AS ¦after) after.id', 'inserted'))
    .toBe('INSERT INTO orders AS d(id) OVERRIDING SYSTEM VALUE VALUES (1) RETURNING WITH (NEW AS "inserted") "inserted".id');
  expect(edited('INSERT INTO orders AS ¦d DEFAULT VALUES RETURNING d.id', 'target'))
    .toBe('INSERT INTO orders AS "target" DEFAULT VALUES RETURNING "target".id');
});

it('冲突索引表达式和谓词可以引用目标别名，约束名称保持独立', () => {
  expect(edited('INSERT INTO orders AS ¦d(id,n) VALUES(1,2) ON CONFLICT ((lower(d.n))) WHERE d.id>0 DO UPDATE SET n=d.n RETURNING d.id', 'target'))
    .toBe('INSERT INTO orders AS "target"(id,n) VALUES(1,2) ON CONFLICT ((lower("target".n))) WHERE "target".id>0 DO UPDATE SET n="target".n RETURNING "target".id');
  expect(edited('INSERT INTO orders AS ¦d VALUES(1) ON CONFLICT ON CONSTRAINT orders_pkey DO UPDATE SET n=d.n', 'target'))
    .toBe('INSERT INTO orders AS "target" VALUES(1) ON CONFLICT ON CONSTRAINT orders_pkey DO UPDATE SET n="target".n');
});

it('避免隐式 excluded 冲突并保留冲突更新左侧复合字段', () => {
  const source = 'INSERT INTO orders AS ¦d VALUES(1) ON CONFLICT (id) DO UPDATE SET n=d.n RETURNING d.id';
  expect(rename(source, 'excluded')).toEqual({ status: 'blocked', reason: 'collision' });
  expect(rename(source, 'Excluded')).toMatchObject({ status: 'ready' });
  expect(rename('INSERT INTO orders AS ¦d VALUES(1) ON CONFLICT (id) DO UPDATE SET d.field=1 RETURNING d.id', 'target'))
    .toEqual({ status: 'blocked', reason: 'unresolved' });
});

it('MERGE 中的嵌套 CASE 保留 ON、WHEN 条件及 UPDATE 表达式内的绑定', () => {
  const prefix = 'MERGE INTO public.orders AS d USING staging AS ¦s ON CASE WHEN s.active THEN d.id=s.id ELSE false END ';
  const clauses = 'WHEN MATCHED AND CASE WHEN d.active THEN s.n>0 ELSE false END THEN UPDATE SET ' +
    'n=CASE WHEN s.n>9 THEN CASE WHEN d.n>0 THEN s.n ELSE 0 END ELSE d.n END ' +
    'WHEN NOT MATCHED BY TARGET THEN INSERT (id,n) OVERRIDING SYSTEM VALUE VALUES (s.id,s.n) ' +
    'WHEN NOT MATCHED BY SOURCE AND d.n=0 THEN DELETE RETURNING d.id,s.id';
  expect(edited(prefix + clauses, '来源')).toBe((prefix + clauses).replace('¦s', '"来源"').replaceAll('s.', '"来源".'));
});

it('MERGE 可重命名 CTE 来源及显式输出别名，并保留来源内的同名局部关系', () => {
  expect(edited('WITH ¦q AS (SELECT 1 id) MERGE INTO orders d USING q ON d.id=q.id WHEN NOT MATCHED THEN INSERT DEFAULT VALUES RETURNING q.id', 'incoming'))
    .toBe('WITH "incoming" AS (SELECT 1 id) MERGE INTO orders d USING "incoming" ON d.id="incoming".id WHEN NOT MATCHED THEN INSERT DEFAULT VALUES RETURNING "incoming".id');
  expect(edited('MERGE INTO orders ¦d USING (SELECT d.id FROM staging d) AS s(id) ON d.id=s.id WHEN MATCHED THEN DELETE', 'target'))
    .toBe('MERGE INTO orders "target" USING (SELECT d.id FROM staging d) AS s(id) ON "target".id=s.id WHEN MATCHED THEN DELETE');
  expect(edited('MERGE INTO orders d USING staging s ON d.id=s.id WHEN MATCHED THEN UPDATE SET n=s.n RETURNING WITH (NEW AS after) ¦after.id,s.id', 'updated'))
    .toBe('MERGE INTO orders d USING staging s ON d.id=s.id WHEN MATCHED THEN UPDATE SET n=s.n RETURNING WITH (NEW AS "updated") "updated".id,s.id');
});

it('MERGE 拒绝改写不完整的分支、重名关系和未确认的同名词', () => {
  const header = 'MERGE INTO orders ¦d USING staging s ON d.id=s.id ';
  expect(rename(header + 'WHEN MATCHED THEN DELETE', 's')).toEqual({ status: 'blocked', reason: 'collision' });
  expect(rename(header + 'WHEN NOT MATCHED THEN INSERT (id) VALUES (d.id)', 'target'))
    .toEqual({ status: 'blocked', reason: 'unresolved' });
  expect(rename(header + 'WHEN MATCHED THEN UPDATE SET d.n=1', 'target'))
    .toEqual({ status: 'blocked', reason: 'unresolved' });
  for (const clause of ['WHEN MATCHED', 'WHEN MATCHED AND THEN DELETE', 'WHEN NOT MATCHED THEN DELETE',
    'WHEN MATCHED THEN UPDATE SET n=CASE WHEN d.n=1 THEN 2', 'WHEN MATCHED THEN DELETE RETURNING']) {
    expect(rename(header + clause, 'target'), clause).toMatchObject({ status: 'blocked' });
  }
});

it('MERGE 来源 JOIN 重命名同时修改来源内部与外部引用', () => {
  const sql = 'WITH incoming AS (SELECT 1 id, 3 n) MERGE INTO orders d ' +
    'USING incoming ¦s LEFT JOIN flags f ON s.id=f.id ON d.id=s.id ' +
    'WHEN MATCHED THEN UPDATE SET n=s.n WHEN NOT MATCHED THEN INSERT (id,n) VALUES(s.id,s.n) RETURNING s.id';
  expect(edited(sql, '来源')).toBe(sql.replace('¦s', '"来源"').replaceAll('s.', '"来源".'));
  expect(edited('MERGE INTO orders d USING (incoming s JOIN flags f ON s.id=f.id) AS ¦j(sid,n,fid,flag) ' +
      'ON d.id=j.sid WHEN MATCHED THEN UPDATE SET n=j.n RETURNING j.sid', 'source'))
    .toBe('MERGE INTO orders d USING (incoming s JOIN flags f ON s.id=f.id) AS "source"(sid,n,fid,flag) ' +
      'ON d.id="source".sid WHEN MATCHED THEN UPDATE SET n="source".n RETURNING "source".sid');
  expect(edited('MERGE INTO orders d USING incoming s JOIN flags f USING(id) AS ¦j ON d.id=j.id ' +
      'WHEN MATCHED THEN UPDATE SET n=s.n RETURNING j.id', 'key'))
    .toBe('MERGE INTO orders d USING incoming s JOIN flags f USING(id) AS "key" ON d.id="key".id ' +
      'WHEN MATCHED THEN UPDATE SET n=s.n RETURNING "key".id');
});

it('MERGE 重命名保护服务器自动生成的来源关系名', () => {
  expect(rename('MERGE INTO orders ¦d USING incoming s JOIN flags f ON s.id=f.id ON d.id=s.id WHEN MATCHED THEN DELETE', 'unnamed_join'))
    .toEqual({ status: 'blocked', reason: 'collision' });
  expect(rename('MERGE INTO orders ¦d USING (SELECT 1 id) ON d.id=id WHEN MATCHED THEN DELETE', 'unnamed_subquery'))
    .toEqual({ status: 'blocked', reason: 'collision' });
  expect(rename('MERGE INTO orders ¦d USING (incoming s JOIN flags f ON s.id=f.id) j ON d.id=1 WHEN MATCHED THEN DELETE', 'unnamed_join'))
    .toMatchObject({ status: 'ready' });
});

it('重命名跨 ROWS FROM 的各个实参，但保留函数名和列定义', () => {
  expect(edited('SELECT s.id FROM incoming ¦s CROSS JOIN ROWS FROM (get_records(s.doc) AS (id int), generate_series(1,s.n)) WITH ORDINALITY AS r(id,n,seq) WHERE s.id=r.id', '来源'))
    .toBe('SELECT "来源".id FROM incoming "来源" CROSS JOIN ROWS FROM (get_records("来源".doc) AS (id int), generate_series(1,"来源".n)) WITH ORDINALITY AS r(id,n,seq) WHERE "来源".id=r.id');
  expect(edited('MERGE INTO orders d USING get_records() AS ¦r(id int, n numeric(12,3)) ON d.id=r.id WHEN MATCHED THEN UPDATE SET n=r.n RETURNING r.id', 'records'))
    .toBe('MERGE INTO orders d USING get_records() AS "records"(id int, n numeric(12,3)) ON d.id="records".id WHEN MATCHED THEN UPDATE SET n="records".n RETURNING "records".id');
});
