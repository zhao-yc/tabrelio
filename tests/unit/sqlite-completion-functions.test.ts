import { expect, it, vi } from 'vitest';
import { analyzeSqliteCompletion, validateSqliteCompletionAnalysis } from '../../src/shared/sqliteCompletionAnalysis';
import { sqliteCompletionInputSchema, sqliteCompletionOutputSchema, type SqliteCompletionLookup, type SqliteCompletionOutput } from '../../src/shared/sqliteCompletion';
import { sqliteCompletionSuggestions } from '../../src/renderer/sqliteCompletionSuggestions';
import { sqliteFieldHover } from '../../src/renderer/sqliteFieldHover';

function analyze(marked: string, intent?: 'hover') {
  const source = marked.replace('|', ''), offset = marked.indexOf('|');
  const value = analyzeSqliteCompletion(source, offset, intent);
  expect(validateSqliteCompletionAnalysis(value, source, offset, intent)).toEqual(value);
  return value;
}

function ready(marked: string, intent?: 'hover') {
  const value = analyze(marked, intent);
  if (value.status !== 'ready') throw Error(value.reason);
  return value;
}

it.each([
  ['EXPLAIN QUERY PLAN WITH c AS (SELECT 1 AS id) SELECT su|m FROM c', 'result'],
  ['SELECT id FROM t WHERE x > ab|s', 'scalar'],
  ['SELECT CASE ab|s(v) WHEN 1 THEN 1 END FROM t', 'result'],
  ['SELECT id FROM t GROUP BY ab|s(id) HAVING true', 'scalar'],
  ['SELECT id FROM t GROUP BY id HAVING su|m', 'aggregate'],
  ['SELECT id FROM t ORDER BY row_n|umber', 'result'],
  ['SELECT row_number() OVER (ORDER BY ab|s(id)) FROM t', 'scalar'],
  ['SELECT sum(id) FILTER (WHERE ab|s(x)) FROM t', 'scalar'],
  ['SELECT t.id FROM t JOIN u ON co|alesce(t.id,u.id)', 'scalar'],
  ['SELECT value FROM json_each(js|on_array(1,2))', 'scalar'],
  ['INSERT INTO t (id) VALUES (js|on_extract)', 'scalar'],
  ['UPDATE t SET v=co|alesce WHERE id=1', 'scalar'],
  ['DELETE FROM t WHERE id=1 RETURNING up|per', 'scalar'],
  ['INSERT INTO t VALUES(1) ON CONFLICT DO UPDATE SET v=co|alesce', 'scalar'],
] as const)('作用域和 SQL 子句约束函数候选：%s', (marked, mode) => {
  expect(ready(marked).functions).toMatchObject({ mode });
});

it.each([
  'SELECT * FROM js|on_extract', 'SELECT * FROM t JOIN u USING (ab|s)', 'SELECT t.ab|s FROM t',
  'SELECT "su|m" FROM t', 'SELECT v COLLATE no|case FROM t', 'SELECT v AS ab|s FROM t',
  'SELECT v ab|s FROM t', 'INSERT INTO t (ab|s) VALUES (1)', 'UPDATE t SET ab|s=1',
  'SELECT count(*) OVER wi|ndow1 FROM t WINDOW window1 AS ()', 'SELECT v FROM t INDEXED BY ix|name',
])('标识符专用位置不加载函数目录：%s', marked => {
  const value = analyze(marked);
  if (value.status === 'ready') expect(value.functions).toBeUndefined();
});

const entries: SqliteCompletionOutput['entries'] = [
  { kind: 'function', name: 'max', signatures: [{ arity: -3, type: 'scalar' }, { arity: 1, type: 'window' }] },
  { kind: 'function', name: 'row_number', signatures: [{ arity: 0, type: 'window' }] },
  { kind: 'function', name: 'lag', signatures: [{ arity: 1, type: 'window' }, { arity: 2, type: 'window' }] },
  { kind: 'function', name: 'json_extract', signatures: [{ arity: -1, type: 'scalar' }] },
];
function fixture() {
  return { load: vi.fn(async (query: SqliteCompletionLookup): Promise<SqliteCompletionOutput> => ({
    entries: query.kind === 'functions' ? entries.filter(entry => entry.name.startsWith(query.prefix.toLowerCase())) : [], incomplete: false, stamp: '1:0',
  })) };
}

it('函数候选插入参数位置、窗口模板，并保留已有调用', async () => {
  const lookup = fixture();
  const items = async (marked: string) => (await sqliteCompletionSuggestions(ready(marked), lookup)).items.filter(item => item.kind === 'function');
  expect(await items('SELECT JSON_E|xsuffix')).toEqual([expect.objectContaining({ label: 'json_extract', insertText: 'json_extract($0)', snippet: true })]);
  expect(await items('SELECT row_n|umber')).toEqual([expect.objectContaining({ insertText: 'row_number() OVER ($0)', snippet: true })]);
  expect(await items('SELECT la|g')).toEqual([expect.objectContaining({ insertText: 'lag($1) OVER ($0)', snippet: true })]);
  const existing = await items('SELECT js|on_ex(1)');
  expect(existing).toEqual([expect.objectContaining({ insertText: 'json_extract' })]);
  expect(existing[0]).not.toHaveProperty('snippet');
  expect(await items('SELECT "js|on_ex"(1)')).toEqual([expect.objectContaining({ insertText: '"json_extract"' })]);
  expect(await items('SELECT 1 WHERE row_n|umber')).toEqual([]);
  expect(await items('SELECT 1 GROUP BY 1 HAVING la|g')).toEqual([]);
  const [scalar] = await items('SELECT 1 WHERE ma|x');
  expect(scalar.detail).toContain('标量函数');
  expect(scalar.detail).toContain('可变');
  const [aggregate] = await items('SELECT 1 GROUP BY 1 HAVING ma|x');
  expect(aggregate.detail).toContain('可变 / 1');
});

it('悬停准确命中调用名，读取变参资料而不把调用当作同名列', async () => {
  const lookup = fixture();
  const result = await sqliteFieldHover(ready('SELECT JSON_EX|TRACT(value,\'$.id\') FROM t', 'hover'), lookup);
  expect(result).toContain('SQLite 标量函数');
  expect(result).toContain('可变');
  expect(lookup.load).toHaveBeenCalledExactlyOnceWith({ kind: 'functions', prefix: 'JSON_EXTRACT' });
  expect(await sqliteFieldHover(ready('SELECT "json_ex|tract"(value,\'$.id\') FROM t', 'hover'), lookup)).toContain('可变');
  lookup.load.mockClear();
  expect(await sqliteFieldHover(ready('SELECT MY_F|UNC(value) FROM t', 'hover'), lookup)).toBeUndefined();
  expect(lookup.load).toHaveBeenCalledExactlyOnceWith({ kind: 'functions', prefix: 'MY_FUNC' });
});

it('函数目录协议只接收前缀，不携带调用、文件或命名空间', () => {
  const request = { connectionId: 'sqlite', taskId: 'sqlite-completion:1', kind: 'functions', prefix: 'json_ex' };
  expect(sqliteCompletionInputSchema.safeParse(request).success).toBe(true);
  for (const extra of [{ schema: 'main' }, { args: ['id'] }, { sql: 'SELECT 1' }, { prefix: '%_' }]) {
    expect(sqliteCompletionInputSchema.safeParse({ ...request, ...extra }).success).toBe(false);
  }
  expect(sqliteCompletionOutputSchema.safeParse({ entries, incomplete: false, stamp: '1:0' }).success).toBe(true);
  expect(sqliteCompletionOutputSchema.safeParse({ entries: [{ ...entries[0], name: 'max($0)' }], incomplete: false, stamp: '1:0' }).success).toBe(false);
});
