import { expect, it, vi } from 'vitest';
import { analyzeSqliteCompletion, validateSqliteCompletionAnalysis, type SqliteAnalysisIntent } from '../../src/shared/sqliteCompletionAnalysis';
import type { SqliteCompletionLookup, SqliteCompletionOutput } from '../../src/shared/sqliteCompletion';
import { sqliteCompletionSuggestions } from '../../src/renderer/sqliteCompletionSuggestions';
import { sqliteFieldHover } from '../../src/renderer/sqliteFieldHover';

function analyze(marked: string, intent?: SqliteAnalysisIntent) {
  const offset = marked.indexOf('|'), source = marked.replace('|', '');
  const result = analyzeSqliteCompletion(source, offset, intent);
  expect(validateSqliteCompletionAnalysis(result, source, offset, intent)).toEqual(result);
  return { source, offset, result };
}

it.each([
  ['PRAGMA |', { kind: 'name' }],
  ['EXPLAIN PRAGMA main.table_|xinfo(subject); SELECT 1;', { kind: 'name', schema: 'main', withArgument: true }],
  ["PRAGMA 'temp'.'table_xinfo'('旧|值')", { kind: 'object', pragma: 'table_xinfo', schema: 'temp' }],
  ['PRAGMA main.index_info = [现|有索引]', { kind: 'object', pragma: 'index_info', schema: 'main' }],
  ['PRAGMA foreign_key_check(|)', { kind: 'object', pragma: 'foreign_key_check' }],
  ['SELECT 1; PRAGMA quick_check(su|bject)', { kind: 'object', pragma: 'quick_check' }],
] as const)('按 SQLite 语法识别 PRAGMA 位置 %s', (marked, pragma) => {
  expect(analyze(marked).result).toMatchObject({ status: 'ready', syntax: ['pragma'], pragma, relations: [] });
});

it.each(['PRA|GMA', 'PRAGMA att.|table_info', 'PRAGMA temp.|.', 'PRAGMA table_info(main.|x)',
  'PRAGMA table_info(x, y|)', 'PRAGMA foreign_keys = O|N', 'PRAGMA journal_mode(WA|L)', "PRAGMA data_store = 'pr|ivate'", "SELECT 'PRAGMA table_info (sec|ret)'",
  "PRAGMA table_info(t); SELECT 'legac|y_alter_table'"])('隔离无关位置和字符串 %s', marked => {
  const { result } = analyze(marked);
  expect(result.status === 'blocked' || !result.pragma).toBe(true);
});

it('对象候选只替换参数，table_list 对跨库同名对象给出一个候选和两条悬停信息', async () => {
  const load = vi.fn(async (_query: SqliteCompletionLookup): Promise<SqliteCompletionOutput> => ({
    stamp: '1:2', incomplete: false,
    entries: [
      { kind: 'pragma-object', schema: 'temp', object: 'view', name: "user's view" },
      { kind: 'pragma-object', schema: 'main', object: 'table', name: "user's view" },
    ],
  }));
  const completion = analyze("PRAGMA table_list('user''|original'); SELECT 1;");
  const hover = analyze("PRAGMA table_list('user''s vi|ew')", 'hover');
  if (completion.result.status !== 'ready' || hover.result.status !== 'ready') throw Error('缺少 PRAGMA 位置');
  const { items } = await sqliteCompletionSuggestions(completion.result, { load });
  expect(items).toEqual([expect.objectContaining({ insertText: '"user\'s view"', detail: 'temp · SQLite 视图 / main · SQLite 表' })]);
  const { start, end } = completion.result.target;
  expect(completion.source.slice(0, start) + items[0].insertText + completion.source.slice(end))
    .toBe('PRAGMA table_list("user\'s view"); SELECT 1;');
  const content = await sqliteFieldHover(hover.result, { load });
  expect(content).toContain('"main"."user\'s view"');
  expect(content).toContain('"temp"."user\'s view"');
  expect(load.mock.calls.map(([query]) => query)).toEqual([
    { kind: 'pragma-objects', pragma: 'table_list', prefix: "user'" },
    { kind: 'pragma-objects', pragma: 'table_list', prefix: '', exact: "user's view" },
  ]);
});

it('名称候选和悬停以原生可读目录为准，名称前缀不能冒充准确悬停', async () => {
  const partial = analyze('PRAGMA main.table_|x(thing)'), near = analyze('PRAGMA table_|x', 'hover');
  if (partial.result.status !== 'ready' || near.result.status !== 'ready') throw Error('缺少 PRAGMA 位置');
  const load = vi.fn(async (_query: SqliteCompletionLookup): Promise<SqliteCompletionOutput> => ({
    stamp: '1:2', incomplete: false, entries: [{ kind: 'pragma', name: 'table_xinfo' }],
  }));
  expect((await sqliteCompletionSuggestions(partial.result, { load })).items.map(item => item.insertText)).toEqual(['table_xinfo']);
  expect(await sqliteFieldHover(near.result, { load })).toBeUndefined();
  expect(load.mock.calls.map(([query]) => query)).toEqual([
    { kind: 'pragmas', prefix: 'table_', withArgument: true },
    { kind: 'pragmas', prefix: 'table_x' },
  ]);
});

it.each([
  ['SELECT * FROM pragma_table_xi|', { kind: 'source' }],
  ["SELECT * FROM main.pragma_table_xi|nfo('x')", { kind: 'source', schema: 'main', existingCall: true }],
  ["SELECT * FROM temp.pragma_table_info('sub|ject','main')", { kind: 'argument', position: 0, name: 'pragma_table_info', schema: 'temp', objectSchema: 'main' }],
  ["SELECT * FROM pragma_table_info('subject','te|mp')", { kind: 'argument', position: 1, name: 'pragma_table_info' }],
  ['SELECT * FROM pragma_page_count(|)', { kind: 'argument', position: 0, name: 'pragma_page_count' }],
] as const)('表值 PRAGMA 识别函数名和参数槽 %s', (marked, pragmaFunction) => {
  expect(analyze(marked).result).toMatchObject({ status: 'ready', pragmaFunction });
});

it.each([
  "SELECT pragma_table_info('pri|vate')", "SELECT * FROM pragma_table_info('sub|ject', source.schema)",
  "WITH pragma_table_info AS (SELECT 1) SELECT * FROM pragma_table_info('sub|ject')",
  'UPDATE pragma_table_in|fo SET x=1', 'SELECT * FROM subject s JOIN pragma_table_info(s.na|me) i ON 1',
])('不把标量字符串、动态参数或写入表名送入表值 PRAGMA 目录 %s', marked => {
  const { result } = analyze(marked);
  expect(result.status === 'blocked' || !result.pragmaFunction).toBe(true);
});

it('模块参数按原生签名补入 SQL 字符串，并区分函数库限定和对象所属库', async () => {
  const load = vi.fn(async (query: SqliteCompletionLookup): Promise<SqliteCompletionOutput> => ({
    stamp: '1:2', incomplete: false,
    entries: query.kind === 'pragma-functions' ? [
      { kind: 'pragma-function', name: 'pragma_table_info', objectArgument: true, schemaArgument: true },
    ] : query.kind === 'pragma-objects' ? [
      { kind: 'pragma-object', schema: 'main', object: 'table', name: "subject's table" },
    ] : [],
  }));
  const source = analyze('SELECT * FROM pragma_table_i| AS t').result;
  const argument = analyze("SELECT * FROM temp.pragma_table_info('sub|suffix','main')").result;
  const schema = analyze("SELECT * FROM pragma_table_info('x','te|suffix')").result;
  const hover = analyze("SELECT * FROM temp.pragma_table_info('subject''s ta|ble','main')", 'hover').result;
  if (source.status !== 'ready' || argument.status !== 'ready' || schema.status !== 'ready' || hover.status !== 'ready') throw Error('缺少表值 PRAGMA 位置');
  expect((await sqliteCompletionSuggestions(source, { load })).items).toContainEqual(expect.objectContaining({ insertText: "pragma_table_info('$1')$0", snippet: true }));
  expect((await sqliteCompletionSuggestions(argument, { load })).items).toEqual([expect.objectContaining({ insertText: "'subject''s table'" })]);
  expect((await sqliteCompletionSuggestions(schema, { load })).items).toEqual([expect.objectContaining({ insertText: "'temp'" })]);
  expect(await sqliteFieldHover(hover, { load })).toContain('"main"."subject\'s table"');
  expect(load.mock.calls.map(([query]) => query)).toEqual([
    { kind: 'relations', prefix: 'pragma_table_i' }, { kind: 'pragma-functions', prefix: 'pragma_table_i' },
    { kind: 'pragma-functions', prefix: 'pragma_table_info', schema: 'temp' },
    { kind: 'pragma-objects', pragma: 'table_info', schema: 'main', prefix: 'sub' },
    { kind: 'pragma-functions', prefix: 'pragma_table_info' },
    { kind: 'pragma-functions', prefix: 'pragma_table_info', schema: 'temp' },
    { kind: 'pragma-objects', pragma: 'table_info', schema: 'main', prefix: '', exact: "subject's table" },
  ]);
});
