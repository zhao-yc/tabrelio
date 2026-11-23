import { DatabaseSync } from 'node:sqlite';
import { expect, it, vi } from 'vitest';
import { sqliteCompletionSuggestions } from '../../src/renderer/sqliteCompletionSuggestions';
import { sqliteFieldHover } from '../../src/renderer/sqliteFieldHover';
import { analyzeSqliteCompletion, validateSqliteCompletionAnalysis, type SqliteAnalysisIntent } from '../../src/shared/sqliteCompletionAnalysis';
import type { SqliteCompletionLookup, SqliteCompletionOutput } from '../../src/shared/sqliteCompletion';

function input(marked: string) { return { source: marked.replace('|', ''), offset: marked.indexOf('|') }; }

function ready(marked: string, intent?: SqliteAnalysisIntent) {
  const { source, offset } = input(marked);
  const value = analyzeSqliteCompletion(source, offset, intent);
  if (value.status !== 'ready') throw Error(value.reason);
  expect(validateSqliteCompletionAnalysis(value, source, offset, intent)).toEqual(value);
  return value;
}

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE a(id INTEGER,v INTEGER); CREATE TABLE b(id INTEGER,item TEXT);
    CREATE TABLE c(id INTEGER,future INTEGER,candidate INTEGER);
    INSERT INTO a VALUES(1,5); INSERT INTO b VALUES(1,'one'),(2,'two'); INSERT INTO c VALUES(1,1,0);`);
  const load = vi.fn(async (request: SqliteCompletionLookup): Promise<SqliteCompletionOutput> => {
    const entries = request.kind === 'columns' ? (db.prepare('SELECT name,type FROM pragma_table_xinfo(?)').all(request.table) as { name: string; type: string }[])
      .filter(row => row.name.startsWith(request.prefix)).map(({ name, type }) => ({
        kind: 'column' as const, schema: 'main' as const, table: request.table, name, declaredType: type, generated: false, hidden: false,
      })) : [];
    return { entries, incomplete: false, stamp: '1:0' };
  });
  return { db, directory: { load } };
}

it.each(['LEFT JOIN', 'LEFT OUTER JOIN', 'RIGHT JOIN', 'FULL JOIN'])('外连接后的来源不参与限定补全和定义：%s', join => {
  const source = `SELECT * FROM a x ${join} b y ON z.fu|ture=1 JOIN c z ON z.id=x.id`;
  expect(ready(source).relations.map(item => item.alias)).toEqual(['x', 'y']);
  const definition = input(source.replace('z.fu|ture', 'z|.future'));
  expect(analyzeSqliteCompletion(definition.source, definition.offset, 'definition')).toMatchObject({ status: 'blocked' });
  const eligible = input(source.replace('z.fu|ture', 'y|.id'));
  expect(analyzeSqliteCompletion(eligible.source, eligible.offset, 'definition')).toMatchObject({ status: 'ready' });
});

it.each(['JOIN', 'INNER JOIN', 'CROSS JOIN', ','])('内连接类的 ON 保留稍后可合法引用的表：%s', async join => {
  const { db, directory } = fixture();
  try {
    const marked = `SELECT a.id FROM a ${join} b ON c.fu|ture=1 JOIN c ON c.id=a.id`;
    const { source } = input(marked), value = ready(marked), result = await sqliteCompletionSuggestions(value, directory);
    const item = result.items.find(item => item.label === 'future');
    expect(item).toMatchObject({ insertText: '"future"' });
    expect(directory.load).toHaveBeenCalledExactlyOnceWith({ kind: 'columns', table: 'c', prefix: 'fu' });
    expect(db.prepare(source.slice(0, value.target.start) + item!.insertText + source.slice(value.target.end)).all()).toEqual([{ id: 1 }, { id: 1 }]);
    expect(() => db.prepare(source.replace(join + ' b', 'LEFT JOIN b')).all()).toThrow('ON clause references tables to its right');
  } finally { db.close(); }
});

it('外连接作用域包含当前组和此前来源，相关子查询也不借稍后的表', () => {
  for (const marked of [
    'SELECT * FROM a x LEFT JOIN b y ON EXISTS(SELECT z.fu|ture) JOIN c z ON z.id=x.id',
    'SELECT * FROM parent z WHERE EXISTS(SELECT 1 FROM a x LEFT JOIN b y ON z.fu|ture>0 JOIN c z ON 1)',
    'SELECT * FROM (a x LEFT JOIN b y ON z.fu|ture=1) JOIN c z ON z.id=x.id',
    'SELECT * FROM a x LEFT JOIN b y ON coalesce(y.id,0) IS DISTINCT FROM z.fu|ture JOIN c z ON z.id=x.id',
  ]) expect(ready(marked).relations.map(item => item.alias)).toEqual(['x', 'y']);
  const group = ready('SELECT * FROM external e JOIN (a x RIGHT JOIN b y ON z.fu|ture=1 JOIN c z ON 1) AS grp ON 1');
  expect(group.relations.map(item => item.alias)).toEqual(['x', 'y']);
  const outside = ready('SELECT * FROM a x LEFT JOIN b y ON 1 JOIN c z ON z.fu|ture=1');
  expect(outside.relations.map(item => item.alias)).toEqual(['x', 'y', 'z']);
});

it('外连接左输入中可证明的输出别名进入 ON，先排除同名列再插入', async () => {
  const { db, directory } = fixture();
  try {
    const marked = `SELECT coalesce(a.v,0) AS picked,b.item FROM a LEFT JOIN b ON pi|cked=5 JOIN c ON c.id=a.id`;
    const { source } = input(marked), value = ready(marked);
    expect(value.outputAliases).toEqual({ names: ['picked'], clause: 'on', scopeDepth: 0 });
    expect(value.relations.find(item => item.name === 'c')).toMatchObject({ afterOuterJoin: true });
    const { items } = await sqliteCompletionSuggestions(value, directory);
    const item = items.find(item => item.detail === '查询输出别名');
    expect(item).toMatchObject({ insertText: '"picked"' });
    expect(directory.load.mock.calls.map(([request]) => request)).toContainEqual({ kind: 'columns', table: 'c', prefix: 'pi' });
    const sql = source.slice(0, value.target.start) + item!.insertText + source.slice(value.target.end) + ' ORDER BY b.id';
    expect(db.prepare(sql).all()).toEqual([{ picked: 5, item: 'one' }, { picked: 5, item: 'two' }]);
    const collision = ready(marked.replace('AS picked', 'AS candidate').replace('pi|cked', 'ca|ndidate'));
    const next = await sqliteCompletionSuggestions(collision, directory);
    expect(next.items.filter(item => item.kind === 'column')).toEqual([]);
    const physical = ready('SELECT a.v AS item,b.id FROM a LEFT JOIN b ON it|em=a.v JOIN c ON 1');
    expect((await sqliteCompletionSuggestions(physical, directory)).items).toContainEqual(expect.objectContaining({ insertText: '"b"."item"' }));
  } finally { db.close(); }
});

it('普通和展平组的 ON 可用标量别名，隔离组、聚合和后续来源依赖不会借外层投影', () => {
  expect(ready('SELECT v AS picked FROM a JOIN b ON pi|cked=5').outputAliases?.names).toEqual(['picked']);
  expect(ready('SELECT v AS picked FROM a LEFT JOIN b ON pi|cked=5').outputAliases?.names).toEqual(['picked']);
  expect(ready('SELECT a.v AS picked FROM (a JOIN b ON pi|cked=5) JOIN c ON 1').outputAliases?.names).toEqual(['picked']);
  for (const marked of [
    'SELECT a.v AS picked FROM a JOIN (b JOIN c ON pi|cked=5) ON 1',
    'SELECT count(*) AS picked FROM a JOIN b ON pi|cked=5',
    'SELECT row_number() OVER () AS picked FROM a JOIN b ON pi|cked=5',
    'SELECT c.future AS picked FROM a LEFT JOIN b ON pi|cked=5 JOIN c ON 1',
    'SELECT future+1 AS picked FROM a LEFT JOIN b ON pi|cked=5 JOIN c ON 1',
  ]) expect(ready(marked).outputAliases).toBeUndefined();
});

it('未限定悬停用后续来源消歧，限定悬停只读取合法来源', async () => {
  const { db, directory } = fixture();
  try {
    const prefix = 'SELECT a.v AS picked FROM a LEFT JOIN b ON ', suffix = ' JOIN c ON c.id=a.id';
    const hover = (marked: string) => sqliteFieldHover(ready(prefix + marked + suffix, 'hover'), directory);
    expect(await hover('pi|cked=5')).toContain('查询输出别名');
    expect(await hover('it|em=5')).toContain('"main"."b"');
    expect(await hover('i|d=5')).toBeUndefined();
    expect(await hover('fu|ture=5')).toBeUndefined();
    directory.load.mockClear();
    expect(await hover('c.fu|ture=5')).toBeUndefined();
    expect(directory.load).not.toHaveBeenCalled();
    expect(await hover('b.it|em=5')).toContain('TEXT');
    expect(directory.load).toHaveBeenCalledExactlyOnceWith({ kind: 'columns', table: 'b', prefix: 'item' });
  } finally { db.close(); }
});

it('Worker 只在 ON 别名消歧或未限定悬停中携带后续来源', () => {
  const marked = 'SELECT a.v AS picked FROM a LEFT JOIN b ON pi|cked=5 JOIN c ON 1';
  const { source, offset } = input(marked), value = ready(marked);
  expect(() => validateSqliteCompletionAnalysis({ ...value, outputAliases: { ...value.outputAliases, clause: 'where' } }, source, offset)).toThrow();
  const plainSql = 'SELECT pi|cked FROM a JOIN b ON 1 JOIN c ON 1', plain = ready(plainSql), plainInput = input(plainSql);
  const relations = plain.relations.map(item => item.name === 'c' ? { ...item, afterOuterJoin: true } : item);
  expect(() => validateSqliteCompletionAnalysis({ ...plain, relations }, plainInput.source, plainInput.offset)).toThrow();
});
