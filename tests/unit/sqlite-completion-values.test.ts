import { DatabaseSync } from 'node:sqlite';
import { expect, it, vi } from 'vitest';
import { analyzeSqliteCompletion, validateSqliteCompletionAnalysis, type SqliteAnalysisIntent } from '../../src/shared/sqliteCompletionAnalysis';
import type { SqliteCompletionLookup, SqliteCompletionOutput } from '../../src/shared/sqliteCompletion';
import { sqliteCompletionSuggestions } from '../../src/renderer/sqliteCompletionSuggestions';
import { sqliteFieldHover } from '../../src/renderer/sqliteFieldHover';

function analyze(marked: string, intent?: SqliteAnalysisIntent) {
  const offset = marked.indexOf('§'), source = marked.replace('§', '');
  const result = analyzeSqliteCompletion(source, offset, intent);
  expect(validateSqliteCompletionAnalysis(result, source, offset, intent)).toEqual(result);
  return { source, result };
}

it.each([
  ["WITH seed AS (VALUES(1, '中,文'), (2, coalesce(NULL, '乙'))) SELECT seed.col§umn2 FROM seed", 'seed'],
  ["SELECT v.col§umn2 FROM (VALUES(CAST(1 AS INT), '一'),(2, '二')) AS v", 'v'],
  ["SELECT col§umn2 FROM (VALUES(1, '一'),(2, '二'))", ''],
  ["SELECT col§umn2 FROM (WITH seed AS (SELECT 1) VALUES(1, '一'))", ''],
  ['WITH seed AS (VALUES(1, 2) UNION ALL SELECT 3, 4) SELECT seed.col§umn2 FROM seed', 'seed'],
  ['WITH RECURSIVE seed AS (VALUES(1, 2) UNION ALL SELECT column1+1,column2 FROM seed WHERE column1<2) SELECT seed.col§umn2 FROM seed', 'seed'],
] as const)('本地 VALUES 列名与真实 SQLite 一致 %s', async (marked, name) => {
  const { source, result } = analyze(marked);
  if (result.status !== 'ready') throw Error(result.reason);
  expect(result.relations).toContainEqual(expect.objectContaining({ kind: 'local', name, columns: ['column1', 'column2'] }));
  const load = vi.fn(async (query: SqliteCompletionLookup): Promise<SqliteCompletionOutput> => {
    if (query.kind !== 'functions') throw Error('本地列无需关系目录');
    return { entries: [], incomplete: false, stamp: '1:0' };
  });
  const suggestions = await sqliteCompletionSuggestions(result, { load });
  expect(suggestions.items).toContainEqual(expect.objectContaining({ label: 'column2', insertText: '"column2"' }));
  if (name) expect(load).not.toHaveBeenCalled();
  else expect(load.mock.calls).toEqual([[{ kind: 'functions', prefix: 'col' }]]);
  const db = new DatabaseSync(':memory:');
  try {
    expect(db.prepare(source).columns().map(column => column.name)).toEqual(['column2']);
    expect(db.prepare(source).all().length).toBeGreaterThan(0);
  } finally { db.close(); }
});

it('显式 CTE 列清单优先，普通星号传递 VALUES 的输出', async () => {
  const explicit = analyze('WITH seed(id, note) AS (VALUES(1,2)) SELECT seed.no§te FROM seed').result;
  expect(explicit).toMatchObject({ status: 'ready', relations: [expect.objectContaining({ columns: ['id', 'note'] }), expect.anything()] });
  const { result } = analyze('WITH seed AS (VALUES(1,2)), outer_seed AS (SELECT * FROM seed) SELECT outer_seed.column§2 FROM outer_seed');
  if (result.status !== 'ready') throw Error(result.reason);
  const load = vi.fn(async (_query: SqliteCompletionLookup): Promise<SqliteCompletionOutput> => { throw Error('星号只读本地输出'); });
  expect((await sqliteCompletionSuggestions(result, { load })).items.map(item => item.label)).toEqual(['column1', 'column2']);
  expect(load).not.toHaveBeenCalled();
});

it('匿名 VALUES 的已知列参与 USING，两侧来源均为本地投影时无需目录', async () => {
  const { source, result } = analyze('WITH seed AS (VALUES(1)) SELECT * FROM seed JOIN (VALUES(1,2)) USING (col§umn1)');
  if (result.status !== 'ready') throw Error(result.reason);
  const load = vi.fn(async (_query: SqliteCompletionLookup): Promise<SqliteCompletionOutput> => { throw Error('USING 两侧都是本地投影'); });
  expect((await sqliteCompletionSuggestions(result, { load })).items).toMatchObject([{ label: 'column1', insertText: '"column1"' }]);
  expect(load).not.toHaveBeenCalled();
  const db = new DatabaseSync(':memory:');
  try { expect(db.prepare(source).get()).toEqual({ column1: 1, column2: 2 }); }
  finally { db.close(); }
});

it.each(['VALUES(1,2),(3)', 'VALUES(1,,2)', 'VALUES()',
  'VALUES(1,2) ORDER BY 1', 'VALUES(1,2),', 'VALUES(1 AS id,2)', "VALUES(1, 'unfinished"])('行宽或边界无效时保留未知来源 %s', values => {
  const { result } = analyze('WITH seed AS (' + values + ') SELECT seed.col§umn2 FROM seed');
  expect(result.status === 'blocked' || !result.relations.some(relation => relation.kind === 'local' && relation.columns.length)).toBe(true);
});

it('保留 VALUES 可能继承的相关字段名，且不把隐式列当成复合查询 ORDER BY 别名', () => {
  const correlated = analyze('SELECT (WITH seed AS (VALUES((p.z) COLLATE NOCASE)) SELECT seed.col§umn1 FROM seed) FROM p').result;
  expect(correlated.status === 'blocked' || !correlated.relations.some(relation => relation.kind === 'local' && relation.columns.includes('column1'))).toBe(true);
  const order = analyze('VALUES(1, 2) UNION ALL SELECT 3 AS real_name, 4 AS other ORDER BY col§umn1').result;
  expect(order).toMatchObject({ status: 'ready', output: { columns: ['real_name', 'other'] } });
  const db = new DatabaseSync(':memory:');
  try {
    expect(() => db.prepare('VALUES(1,2) UNION ALL SELECT 3 AS real_name,4 ORDER BY column1')).toThrow(/does not match/);
  } finally { db.close(); }
});

it('匿名 VALUES 的裸列补全与悬停按最近作用域消歧', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE source(column1 TEXT); INSERT INTO source VALUES('物理来源')");
  const load = vi.fn(async (query: SqliteCompletionLookup): Promise<SqliteCompletionOutput> => ({
    stamp: '1:0', incomplete: false, entries: query.kind === 'columns' && 'column1'.startsWith(query.prefix) ? [
      { kind: 'column', table: 'source', name: 'column1', schema: 'main', declaredType: 'TEXT', generated: false, hidden: false },
    ] : [],
  }));
  const document = " FROM source CROSS JOIN (VALUES(7, '匿名来源'))";
  const names = analyze('SELECT col§' + document).result;
  const first = analyze('SELECT column§1' + document, 'hover').result;
  const second = analyze('SELECT column§2' + document, 'hover').result;
  const nested = analyze("SELECT (SELECT column§1 FROM (VALUES('内层'))) FROM source", 'hover').result;
  if (names.status !== 'ready' || first.status !== 'ready' || second.status !== 'ready' || nested.status !== 'ready') throw Error('无法解析 VALUES 来源');
  expect((await sqliteCompletionSuggestions(names, { load })).items.map(item => item.insertText))
    .toEqual(['"source"."column1"', '"column2"']);
  expect(await sqliteFieldHover(first, { load })).toBeUndefined();
  expect(await sqliteFieldHover(second, { load })).toContain('派生表局部输出');
  expect(await sqliteFieldHover(nested, { load })).toContain('派生表局部输出');
  try {
    expect(() => db.prepare('SELECT column1' + document)).toThrow(/ambiguous column/);
    expect(db.prepare('SELECT column2' + document).get()?.column2).toBe('匿名来源');
  } finally { db.close(); }
});
