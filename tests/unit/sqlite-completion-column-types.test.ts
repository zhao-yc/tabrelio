import { expect, it, vi } from 'vitest';
import { analyzeSqliteCompletion, validateSqliteCompletionAnalysis, type SqliteAnalysisIntent } from '../../src/shared/sqliteCompletionAnalysis';
import { sqliteCompletionInputSchema, type SqliteCompletionLookup, type SqliteCompletionOutput } from '../../src/shared/sqliteCompletion';
import { sqliteCompletionSuggestions } from '../../src/renderer/sqliteCompletionSuggestions';
import { sqliteFieldHover } from '../../src/renderer/sqliteFieldHover';

function analyze(marked: string, intent?: SqliteAnalysisIntent) {
  const offset = marked.indexOf('|'), source = marked.replace('|', ''), result = analyzeSqliteCompletion(source, offset, intent);
  expect(validateSqliteCompletionAnalysis(result, source, offset, intent)).toEqual(result);
  return result;
}
function ready(marked: string, intent?: SqliteAnalysisIntent) {
  const result = analyze(marked, intent);
  if (result.status !== 'ready') throw Error(result.reason);
  return result;
}

it.each([
  ['CREATE TABLE sample(value |)', false], ['CREATE TABLE strict(value TE|XT, second INTEGER)', false],
  ['CREATE TABLE "sample"(id INTEGER PRIMARY KEY,value TE|XT) WITHOUT ROWID, STRICT', true],
  ['CREATE TEMP TABLE IF NOT EXISTS t(v "TE|XT") STRICT', true],
  ['SELECT 1; EXPLAIN CREATE TABLE t(v DE|CIMAL(8,2), other TEXT DEFAULT \'STRICT\')', false],
] as const)('建表类型仅在列声明中识别准确的 STRICT 选项：%s', (marked, strict) => {
  expect(ready(marked)).toMatchObject({ syntax: ['column-type'], relations: [], qualifiers: [], columnType: { strict } });
});

it.each([
  'CREATE TABLE sample(val|ue TEXT)', 'CREATE TABLE sample(value TEXT DEFAULT str|ict)',
  'CREATE TABLE sample(value TEXT, CONSTRAINT named UNIQUE(va|lue))', 'CREATE TABLE sample(value INT CHECK(va|lue>0))',
  'CREATE TABLE sample(value TEXT) STR|ICT', 'CREATE TABLE sample AS SELECT va|lue FROM source',
  'ALTER TABLE sample ADD COLUMN val|ue TEXT', 'ALTER TABLE sample RENAME val|ue TO renamed',
])('列名、约束、表选项和查询表达式不冒充类型：%s', marked => {
  const value = analyze(marked);
  if (value.status === 'ready') expect(value.columnType).toBeUndefined();
});

function directory(strict?: boolean) {
  const load = vi.fn(async (_query: SqliteCompletionLookup): Promise<SqliteCompletionOutput> => ({ entries: strict === undefined ? [] :
    [{ kind: 'table-options', name: 'sample', schema: 'main', strict }], incomplete: false, stamp: '1:0' }));
  return { load };
}

it('候选读取普通表和 STRICT 的准确集合，建表声明无需访问目录', async () => {
  const port = directory(), plain = await sqliteCompletionSuggestions(ready('CREATE TABLE sample(v |)'), port);
  expect(plain.items.find(item => item.label === 'VARCHAR')?.detail).toContain('TEXT 亲和性');
  const strict = await sqliteCompletionSuggestions(ready('CREATE TABLE sample(v |) STRICT'), port);
  expect(strict.items.map(item => item.label)).toEqual(['INTEGER', 'INT', 'REAL', 'TEXT', 'BLOB', 'ANY']);
  expect(strict.items.find(item => item.label === 'ANY')?.detail).toContain('保留传入值的存储类型');
  expect(port.load).not.toHaveBeenCalled();
});

it('多词类型替换完整类型名并保留原有参数、约束和语句其余部分', async () => {
  const marked = 'CREATE TABLE t(amount DO|UBLE  PRECISION(10,2) NOT NULL)', value = ready(marked);
  const source = marked.replace('|', ''), [candidate] = (await sqliteCompletionSuggestions(value, directory())).items;
  expect(source.slice(value.target.start, value.target.end)).toBe('DOUBLE  PRECISION');
  expect(candidate.insertText).toBe('DOUBLE PRECISION');
  expect(source.slice(0, value.target.start) + candidate.insertText + source.slice(value.target.end)).toBe('CREATE TABLE t(amount DOUBLE PRECISION(10,2) NOT NULL)');
  expect(await sqliteFieldHover(ready('CREATE TABLE t(v DOUBLE PRECI|SION)', 'hover'), directory())).toContain('REAL 亲和性');
  const commented = analyze('CREATE TABLE t(v DOU|BLE /* 保留 */ PRECISION)');
  if (commented.status === 'ready') expect(commented.columnType).toBeUndefined();
});

it('加列只读取目标表选项，目录未确认时保持无候选', async () => {
  const value = ready('ALTER TABLE main.sample ADD COLUMN marker |');
  expect(value.columnType).toEqual({ source: { name: 'sample', schema: 'main' } });
  const strict = directory(true), ordinary = directory(false), empty = directory();
  expect((await sqliteCompletionSuggestions(value, strict)).items.map(item => item.label)).not.toContain('VARCHAR');
  expect((await sqliteCompletionSuggestions(value, ordinary)).items.map(item => item.label)).toContain('VARCHAR');
  expect((await sqliteCompletionSuggestions(value, empty)).items).toEqual([]);
  expect(strict.load).toHaveBeenCalledExactlyOnceWith({ kind: 'table-options', table: 'sample', schema: 'main', prefix: '' });
  expect(await sqliteFieldHover(ready('ALTER TABLE main.sample ADD marker A|NY', 'hover'), strict)).toContain('SQLite STRICT 类型');
  expect(sqliteCompletionInputSchema.safeParse({ kind: 'table-options', table: 'sample', prefix: '', connectionId: 'local', taskId: 'sqlite-completion:1', sql: 'SELECT 1' }).success).toBe(false);
});
