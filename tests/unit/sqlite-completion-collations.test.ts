import { expect, it, vi } from 'vitest';
import { sqliteCompletionInputSchema, sqliteCompletionOutputSchema, type SqliteCompletionLookup, type SqliteCompletionOutput } from '../../src/shared/sqliteCompletion';
import { analyzeSqliteCompletion, validateSqliteCompletionAnalysis, type SqliteAnalysisIntent } from '../../src/shared/sqliteCompletionAnalysis';
import { sqliteCompletionSuggestions } from '../../src/renderer/sqliteCompletionSuggestions';
import { sqliteFieldHover } from '../../src/renderer/sqliteFieldHover';

function analyze(marked: string, intent?: SqliteAnalysisIntent) {
  const offset = marked.lastIndexOf('|'), source = marked.slice(0, offset) + marked.slice(offset + 1);
  const result = analyzeSqliteCompletion(source, offset, intent);
  expect(validateSqliteCompletionAnalysis(result, source, offset, intent)).toEqual(result);
  return result;
}

function ready(marked: string, intent?: SqliteAnalysisIntent) {
  const result = analyze(marked, intent);
  if (result.status !== 'ready') throw Error(result.reason);
  return result;
}

it.each([
  'SELECT value COLLATE | FROM subject', 'SELECT * FROM subject WHERE value COLLATE n|ocase = \'a\'',
  'SELECT value FROM subject GROUP BY value COLLATE n|ocase HAVING count(*) > 0',
  'SELECT v FROM subject UNION ALL SELECT v FROM inbox ORDER BY v COLLATE n|ocase DESC',
  'SELECT row_number() OVER (ORDER BY value COLLATE n|ocase) FROM subject',
  'SELECT row_number() OVER w FROM subject WINDOW w AS (ORDER BY value COLLATE [no|case])',
  'SELECT a.id FROM subject a JOIN inbox b ON a.v COLLATE n|ocase = b.v',
  'SELECT value FROM json_each(\'[]\' COLLATE n|ocase)',
  'WITH v AS (SELECT x COLLATE n|ocase AS cx FROM subject) SELECT * FROM v',
  'UPDATE subject SET v = trim(v) COLLATE n|ocase WHERE id=1',
  'DELETE FROM subject WHERE v COLLATE n|ocase = \'a\' RETURNING v',
  'INSERT INTO subject(v) VALUES(\'a\' COLLATE n|ocase)',
  'INSERT INTO subject(v) VALUES(\'a\') RETURNING v COLLATE n|ocase',
  'INSERT INTO subject(v) VALUES(\'a\') ON CONFLICT(v COLLATE n|ocase) DO NOTHING',
  'INSERT INTO subject(v) VALUES(\'a\') ON CONFLICT(v) WHERE v COLLATE n|ocase = \'A\' DO NOTHING',
  'INSERT INTO subject(v) VALUES(\'a\') ON CONFLICT(v) DO UPDATE SET v=excluded.v COLLATE n|ocase',
  'EXPLAIN QUERY PLAN SELECT (v || v) COLLATE n|ocase FROM subject',
  'CREATE TEMP TABLE IF NOT EXISTS subject (v TEXT COLLATE n|ocase)',
  'CREATE UNIQUE INDEX IF NOT EXISTS main.by_name ON subject(lower(v) COLLATE n|ocase)',
  'CREATE INDEX by_name ON subject(v) WHERE v COLLATE n|ocase = \'A\'',
])('SQLite 排序规则只产出独立目录角色：%s', sql => {
  expect(ready(sql)).toMatchObject({ syntax: ['collation'], qualifiers: [], relations: [] });
});

it.each([
  'SELECT COLLATE n|ocase', 'SELECT 1 FROM subject COLLATE n|ocase', 'SELECT 1 FROM subject a COLLATE n|ocase',
  'SELECT 1 FROM subject JOIN inbox COLLATE n|ocase', 'SELECT 1 FROM subject JOIN inbox USING(v COLLATE n|ocase)',
  'SELECT v COLLATE main.no|case FROM subject', 'SELECT v COLLATE no|case.other FROM subject',
  'SELECT v COLLATE no|case() FROM subject', 'SELECT \'v COLLATE n|ocase\' FROM subject',
  'UPDATE subject SET v COLLATE n|ocase = 1', 'INSERT INTO subject(v COLLATE n|ocase) VALUES (1)',
  'CREATE INDEX by_name ON subject COLLATE n|ocase (v)', 'CREATE VIEW v COLLATE n|ocase AS SELECT 1',
])('非排序规则位置不会查询目录：%s', sql => {
  const result = analyze(sql);
  if (result.status === 'ready') expect(result.syntax).not.toContain('collation');
});

const entries: SqliteCompletionOutput['entries'] = [{ kind: 'collation', name: 'NOCASE' }, { kind: 'collation', name: '自"定🚢' }];
const directory = () => ({ load: vi.fn(async (_query: SqliteCompletionLookup): Promise<SqliteCompletionOutput> => ({ entries, incomplete: false, stamp: '1:0' })) });

it('替换整个规则名，兼容普通、方括号及 SQLite 接受的单引号形式', async () => {
  for (const marked of ['SELECT v COLLATE no|suffix FROM t', 'SELECT v COLLATE [no|suffix] FROM t', "SELECT v COLLATE 'no|suffix' FROM t"]) {
    const value = ready(marked), port = directory();
    expect((await sqliteCompletionSuggestions(value, port)).items).toEqual([expect.objectContaining({ kind: 'collation', label: 'NOCASE', insertText: '"NOCASE"' })]);
    expect(port.load).toHaveBeenCalledExactlyOnceWith({ kind: 'collations', prefix: 'no' });
    expect(marked.replace('|', '').slice(value.target.start, value.target.end)).toMatch(/^(?:nosuffix|\[nosuffix\]|'nosuffix')$/);
  }
  const custom = await sqliteCompletionSuggestions(ready('SELECT v COLLATE "自|suffix" FROM t'), directory());
  expect(custom.items).toEqual([expect.objectContaining({ label: '自"定🚢', insertText: '"自""定🚢"' })]);
});

it('悬停显示准确目录及 ASCII 比较语义，规则名不提供字段或对象定位', async () => {
  const sql = "SELECT value FROM subject ORDER BY value COLLATE 'no|case'";
  const value = ready(sql, 'hover'), port = directory();
  expect(await sqliteFieldHover(value, port)).toContain('忽略 ASCII 字母的大小写');
  expect(port.load).toHaveBeenCalledExactlyOnceWith({ kind: 'collations', prefix: 'nocase' });
  const bare = 'SELECT value FROM subject ORDER BY value COLLATE no|case';
  expect(analyze(bare, 'definition').status).toBe('blocked');
  expect(analyze(bare, 'object').status).toBe('blocked');
});

it('排序规则 IPC 无对象或 SQL 字段，Worker 回包必须是独占角色', () => {
  const lookup = { kind: 'collations', prefix: '', connectionId: 'local', taskId: 'sqlite-completion:test' };
  expect(sqliteCompletionInputSchema.safeParse(lookup).success).toBe(true);
  for (const extra of [{ schema: 'main' }, { table: 'subject' }, { sql: 'SELECT 1' }]) expect(sqliteCompletionInputSchema.safeParse({ ...lookup, ...extra }).success).toBe(false);
  expect(sqliteCompletionOutputSchema.safeParse({ entries, incomplete: false, stamp: '1:0' }).success).toBe(true);
  const marked = 'SELECT v COLLATE n|ocase FROM t', source = marked.replace('|', ''), offset = marked.indexOf('|'), value = ready(marked);
  for (const raw of [{ ...value, syntax: ['collation', 'column'] }, { ...value, relations: [{ kind: 'physical', name: 't' }] },
    { ...value, qualifiers: ['main'] }]) expect(() => validateSqliteCompletionAnalysis(raw, source, offset)).toThrow();
});
