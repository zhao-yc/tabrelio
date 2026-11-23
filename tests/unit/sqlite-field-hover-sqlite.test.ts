import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { analyzeSqliteCompletion } from '../../src/shared/sqliteCompletionAnalysis';
import { foldSqliteCompletionName as fold, type SqliteCompletionLookup, type SqliteCompletionOutput } from '../../src/shared/sqliteCompletion';
import { sqliteFieldHover } from '../../src/renderer/sqliteFieldHover';
import { sqliteFieldHoverZh as text } from '../../src/renderer/locales/sqliteFieldHover.zh-CN';

/** 独立SQLite引擎裁决真实SQL语义；仅内存合成库，不把RAM目录当作数据库证明。 */
function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE outer_table(field TEXT); INSERT INTO outer_table VALUES('outer'); CREATE TABLE inner_table(field INTEGER); INSERT INTO inner_table VALUES(37); CREATE TABLE inner_empty(id INTEGER); INSERT INTO inner_empty VALUES(1); CREATE TABLE inner_second(field BLOB); INSERT INTO inner_second VALUES(X'3132');");
  const requests: SqliteCompletionLookup[] = [];
  const directory = { async load(query: SqliteCompletionLookup): Promise<SqliteCompletionOutput> {
    requests.push(query); if (query.kind !== 'columns') throw Error('悬停不应读取其它目录');
    const schema = query.schema ?? (db.prepare("SELECT 1 FROM temp.sqlite_schema WHERE name=? COLLATE NOCASE AND type IN ('table','view')").get(query.table) ? 'temp' : 'main');
    const rows = db.prepare('SELECT name,type,hidden FROM pragma_table_xinfo(?,?)').all(query.table, schema);
    return { entries: rows.filter(row => fold(String(row.name)).startsWith(fold(query.prefix))).map(row => ({ kind: 'column', name: String(row.name), table: query.table, schema, declaredType: String(row.type), generated: Number(row.hidden) >= 2, hidden: Number(row.hidden) === 1 })), incomplete: false, stamp: '1:0' };
  } };
  const hover = async (marked: string) => { const source = marked.replace('|', ''), analysis = analyzeSqliteCompletion(source, marked.indexOf('|'), 'hover'); if (analysis.status !== 'ready') throw Error('悬停分析失败：' + analysis.reason); return { source, content: await sqliteFieldHover(analysis, directory) }; };
  return { db, hover, requests };
}
it('真实相关子查询优先内层同名字段，悬停类型与实际37一致', async () => {
  const f = fixture(); try {
    const result = await f.hover('SELECT (SELECT fi|eld FROM inner_table LIMIT 1) AS chosen FROM outer_table');
    expect(f.db.prepare(result.source).get()?.chosen).toBe(37); expect(result.content).toContain('"inner_table"'); expect(result.content).toContain(text.declaredType + '："INTEGER"'); expect(f.requests).toHaveLength(1);
  } finally { f.db.close(); }
});
it('内层没有字段时真实回退外层TEXT；内层同名歧义与引擎一起拒绝', async () => {
  const f = fixture(); try {
    const result = await f.hover('SELECT (SELECT fi|eld FROM inner_empty LIMIT 1) AS chosen FROM outer_table');
    expect(f.db.prepare(result.source).get()?.chosen).toBe('outer'); expect(result.content).toContain('"outer_table"'); expect(result.content).toContain(text.declaredType + '："TEXT"');
    const ambiguous = await f.hover('SELECT (SELECT fi|eld FROM inner_table a JOIN inner_second b ON 1 LIMIT 1) AS chosen FROM outer_table');
    expect(() => f.db.prepare(ambiguous.source)).toThrow(/ambiguous/i); expect(ambiguous.content).toBeUndefined();
  } finally { f.db.close(); }
});
it('真实temp遮蔽main，显式main限定仍读取原声明', async () => {
  const f = fixture(); try {
    f.db.exec("CREATE TABLE subject(field TEXT); INSERT INTO main.subject VALUES('main'); CREATE TEMP TABLE subject(field INTEGER); INSERT INTO temp.subject VALUES(73);");
    const temp = await f.hover('SELECT s.fi|eld FROM subject s'); expect(f.db.prepare(temp.source).get()?.field).toBe(73); expect(temp.content).toContain(text.temporary); expect(temp.content).toContain(text.declaredType + '："INTEGER"');
    const main = await f.hover('SELECT s.fi|eld FROM main.subject s'); expect(f.db.prepare(main.source).get()?.field).toBe('main'); expect(main.content).toContain(text.permanent); expect(main.content).toContain(text.declaredType + '："TEXT"');
  } finally { f.db.close(); }
});
it('真实生成及无声明字段保持目录事实，动态存储类型不伪装声明类型', async () => {
  const f = fixture(); try {
    f.db.exec("CREATE TABLE subject(field INTEGER,computed TEXT GENERATED ALWAYS AS (field||'!') VIRTUAL,untyped); INSERT INTO subject(field,untyped) VALUES('text-in-integer',X'00FF');");
    const plain = await f.hover('SELECT s.fi|eld FROM subject s'); expect(f.db.prepare('SELECT typeof(field) AS kind FROM subject').get()?.kind).toBe('text'); expect(plain.content).toContain(text.declaredType + '："INTEGER"'); expect(plain.content).toContain(text.dynamic);
    const generated = await f.hover('SELECT s.com|puted FROM subject s'); expect(f.db.prepare(generated.source).get()?.computed).toBe('text-in-integer!'); expect(generated.content).toContain(text.generated + '：是'); expect(generated.content).toContain(text.hidden + '：否');
    const untyped = await f.hover('SELECT s.un|typed FROM subject s'); expect(untyped.content).toContain(text.noDeclaredType); expect(untyped.content).not.toContain(text.declaredType + '："BLOB"');
  } finally { f.db.close(); }
});
it('真实嵌套连接组的字段悬停只显示投影列，首来源展开仍可访问原隐藏列', async () => {
  const f = fixture();
  try {
    const grouped = " FROM outer_table o JOIN (inner_empty e JOIN json_each('[7]') j) ON 1";
    const visible = await f.hover('SELECT j.va|lue' + grouped);
    expect(f.db.prepare(visible.source).get()?.value).toBe(7);
    expect(visible.content).toContain('"json_each"');
    const hidden = await f.hover('SELECT j.js|on' + grouped);
    expect(() => f.db.prepare(hidden.source)).toThrow(/no such column/i);
    expect(hidden.content).toBeUndefined();
    const flattened = await f.hover("SELECT j.js|on FROM (inner_empty e JOIN json_each('[7]') j)");
    expect(f.db.prepare(flattened.source).get()?.json).toBe('[7]');
    expect(flattened.content).toContain(text.hidden + '：是');
  } finally { f.db.close(); }
});
it('组名和成员同名时按 SQLite 优先悬停成员，合并字段不猜测声明类型', async () => {
  const f = fixture();
  try {
    f.db.exec("CREATE TABLE lhs(id INTEGER, data TEXT); INSERT INTO lhs VALUES(1,'左'); CREATE TABLE rhs(id INTEGER, data INTEGER); INSERT INTO rhs VALUES(1,42);");
    const same = await f.hover('SELECT y.da|ta FROM (lhs x JOIN rhs y USING(id)) y');
    expect(f.db.prepare(same.source).get()?.['data:1']).toBe(42);
    expect(same.content).toContain('"rhs"');
    expect(same.content).toContain(text.declaredType + '："INTEGER"');
    const renamed = await f.hover('SELECT g."data:|1" FROM (lhs x JOIN rhs y USING(id)) g');
    expect(f.db.prepare(renamed.source).get()?.['data:1']).toBe(42);
    expect(renamed.content).toContain('"rhs"');
    const merged = await f.hover('SELECT g.i|d FROM (lhs x FULL JOIN rhs y USING(id)) g');
    expect(f.db.prepare(merged.source).get()?.id).toBe(1);
    expect(merged.content).toContain('连接组输出列');
    expect(merged.content).toContain(text.unknown);
  } finally { f.db.close(); }
});
it('CTE 与派生表星号悬停保留原会话物理来源和声明类型', async () => {
  const f = fixture();
  try {
    f.db.exec("CREATE TEMP TABLE data(field INTEGER); INSERT INTO temp.data VALUES(41); CREATE TABLE c(field TEXT);");
    const result = await f.hover('WITH c AS (SELECT * FROM temp.data), other AS (SELECT * FROM outer_table) SELECT d.fi|eld FROM (SELECT c.* FROM c) d');
    expect(f.db.prepare(result.source).get()?.field).toBe(41);
    expect(result.content).toContain('"temp"."data"');
    expect(result.content).toContain(text.declaredType + '："INTEGER"');
    expect(f.requests).toEqual([{ kind: 'columns', table: 'data', schema: 'temp', prefix: '' }]);
  } finally { f.db.close(); }
});
