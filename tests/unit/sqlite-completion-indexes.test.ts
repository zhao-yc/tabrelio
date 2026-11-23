import { expect, it, vi } from 'vitest';
import { analyzeSqliteCompletion, validateSqliteCompletionAnalysis, type SqliteAnalysisIntent } from '../../src/shared/sqliteCompletionAnalysis';
import { sqliteCompletionInputSchema, sqliteCompletionOutputSchema, type SqliteCompletionEntry } from '../../src/shared/sqliteCompletion';
import { sqliteCompletionSuggestions } from '../../src/renderer/sqliteCompletionSuggestions';
import { sqliteFieldHover } from '../../src/renderer/sqliteFieldHover';

function input(marked: string) { return { source: marked.replace('|', ''), offset: marked.indexOf('|') }; }
function ready(marked: string, intent?: SqliteAnalysisIntent) {
  const { source, offset } = input(marked), value = analyzeSqliteCompletion(source, offset, intent);
  if (value.status !== 'ready') throw Error(value.reason);
  expect(validateSqliteCompletionAnalysis(value, source, offset, intent)).toEqual(value);
  return value;
}

it.each([
  ['SELECT * FROM main.subject AS t INDEXED BY ix|suffix WHERE t.id=1', 'main'],
  ['UPDATE temp.subject AS t INDEXED BY | SET value=1', 'temp'],
  ['DELETE FROM subject INDEXED BY ix|suffix WHERE id=1', undefined],
  ['SELECT * FROM (main.subject s INDEXED BY ix|suffix JOIN other o USING(id))', 'main'],
  ['WITH c AS (SELECT id FROM main.subject INDEXED BY ix|suffix) SELECT * FROM c', 'main'],
  ['EXPLAIN QUERY PLAN SELECT * FROM main.subject t INDEXED BY ix|suffix', 'main'],
  ['EXPLAIN UPDATE main.subject INDEXED BY ix|suffix SET value=1', 'main'],
  ['SELECT 1 UNION ALL SELECT id FROM temp.subject INDEXED BY ix|suffix', 'temp'],
] as const)('索引候选只承认准确的物理表及命名空间：%s', (marked, schema) => {
  expect(ready(marked)).toMatchObject({ syntax: ['index'], relations: [], qualifiers: [], indexSource: { name: 'subject', ...(schema ? { schema } : {}) } });
});

it.each([
  'WITH subject AS (SELECT 1 id) SELECT * FROM subject INDEXED BY ix|suffix',
  'SELECT * FROM json_each(\'[]\') AS x INDEXED BY ix|suffix',
  'SELECT * FROM (SELECT 1) x INDEXED BY ix|suffix',
  'SELECT * FROM (subject) INDEXED BY ix|suffix',
  'SELECT * FROM subject INDEXED BY main.ix|suffix',
  'SELECT * FROM subject INDEXED BY ix|suffix.resource',
  'SELECT * FROM subject NOT INDEXED ix|suffix',
  'SELECT * FROM subject AS "INDEXED BY" ix|suffix',
  'SELECT \'INDEXED BY\', ix|suffix FROM subject',
])('其它语法位置不会借用物理索引目录：%s', marked => {
  const { source, offset } = input(marked), value = analyzeSqliteCompletion(source, offset);
  if (value.status === 'ready') expect(value.indexSource).toBeUndefined();
});

it('EXPLAIN 包装后的字段、高亮目标和局部声明使用内层语句范围', () => {
  const value = ready('SELECT something FROM irrelevant; EXPLAIN QUERY PLAN WITH c AS (SELECT 1 AS v) SELECT t.n|ote,c.v FROM subject t JOIN c ON true');
  expect(value.relations.map(relation => relation.name)).toContain('subject');
  expect(value.relations.map(relation => relation.name)).not.toContain('irrelevant');
  const marked = 'EXPLAIN SELECT |t.note FROM subject AS t', { source } = input(marked);
  expect(ready(marked, 'definition').definition).toEqual({ start: source.lastIndexOf('t'), end: source.length });
  const using = ready('EXPLAIN QUERY PLAN SELECT * FROM subject a JOIN other b INDEXED BY other_ix USING(i|d)');
  expect(using.using?.right).toEqual({ source: { name: 'other' } });
});

it('候选保存完整索引替换范围，悬停显示真实表、唯一约束与部分索引', async () => {
  const entry: SqliteCompletionEntry = { kind: 'index', table: 'subject', schema: 'main', name: '索"引🚢', origin: 'c', unique: true, partial: true };
  const directory = { load: vi.fn(async () => ({ entries: [entry], stamp: '1:0', incomplete: false })) };
  const marked = 'SELECT * FROM main.subject INDEXED BY "索|suffix" WHERE active=1';
  const value = ready(marked), result = await sqliteCompletionSuggestions(value, directory);
  expect(result.items).toEqual([expect.objectContaining({ kind: 'index', label: entry.name, insertText: '"索""引🚢"', detail: expect.stringContaining('部分索引') })]);
  expect(input(marked).source.slice(value.target.start, value.target.end)).toBe('"索suffix"');
  expect(directory.load).toHaveBeenCalledExactlyOnceWith({ kind: 'indexes', table: 'subject', schema: 'main', prefix: '索' });
  directory.load.mockClear();
  const hover = await sqliteFieldHover(ready('SELECT * FROM main.subject INDEXED BY "索""|引🚢" WHERE active=1', 'hover'), directory);
  expect(hover).toContain('"main"."subject"');
  expect(hover).toContain('唯一');
  expect(hover).toContain('部分索引');
  expect(directory.load).toHaveBeenCalledExactlyOnceWith({ kind: 'indexes', table: 'subject', schema: 'main', prefix: '索"引🚢' });
});

it('索引请求和回包不接收任意 SQL、函数身份或混合字段上下文', () => {
  const marked = 'SELECT * FROM main.subject INDEXED BY ix|suffix', { source, offset } = input(marked), analysis = ready(marked);
  for (const raw of [{ ...analysis, syntax: ['index', 'column'] }, { ...analysis, indexSource: { name: 'subject', tableFunction: true } },
    { ...analysis, relations: [{ name: 'subject', kind: 'physical' }] }, { ...analysis, indexSource: undefined }]) {
    expect(() => validateSqliteCompletionAnalysis(raw, source, offset)).toThrow();
  }
  const lookup = { kind: 'indexes', table: 'subject', schema: 'main', prefix: 'ix', connectionId: 'test', taskId: 'sqlite-completion:test' };
  expect(sqliteCompletionInputSchema.safeParse(lookup).success).toBe(true);
  for (const extra of [{ sql: 'SELECT 1' }, { tableFunction: true }, { schema: 'aux' }]) expect(sqliteCompletionInputSchema.safeParse({ ...lookup, ...extra }).success).toBe(false);
  expect(sqliteCompletionOutputSchema.safeParse({ entries: [{ kind: 'index', name: 'index', table: 'subject', schema: 'main', unique: false, partial: true, origin: 'u', sql: 'SELECT 1' }], incomplete: false, stamp: '1:0' }).success).toBe(false);
});
