import { DatabaseSync } from 'node:sqlite';
import { expect, it, vi } from 'vitest';
import { sqliteParameterPlan } from '../../src/engine/sqlite/parameters';
import { analyzeSqliteCompletion, validateSqliteCompletionAnalysis, type SqliteAnalysisIntent } from '../../src/shared/sqliteCompletionAnalysis';
import type { SqliteCompletionLookup, SqliteCompletionOutput } from '../../src/shared/sqliteCompletion';
import { sqliteCompletionSuggestions } from '../../src/renderer/sqliteCompletionSuggestions';
import { sqliteFieldHover } from '../../src/renderer/sqliteFieldHover';

function analyze(marked: string, intent?: SqliteAnalysisIntent) {
  const offset = marked.indexOf('§'), source = marked.replace('§', '');
  const result = analyzeSqliteCompletion(source, offset, intent);
  expect(validateSqliteCompletionAnalysis(result, source, offset, intent)).toEqual(result);
  return { source, offset, result };
}

it('候选先列出本语句名称，保留大小写，忽略引号、注释及扩展占位符', async () => {
  const source = "SELECT :Script, ':string', ':ignored' AS \":alias\"; -- :comment\r :still_comment\r\n" +
    'SELECT :Local, :local, :Local, :Current(:nested), :§; /* :other */';
  const { result } = analyze(source);
  if (result.status !== 'ready') throw Error(result.reason);
  expect(result.syntax).toEqual(['parameter']);
  expect(result.parameter?.items).toEqual([
    { name: 'Local', occurrences: 2, statementCount: 2 },
    { name: 'local', occurrences: 1, statementCount: 1 },
    { name: 'Script', occurrences: 1, statementCount: 0 },
  ]);
  const load = vi.fn(async (_query: SqliteCompletionLookup): Promise<SqliteCompletionOutput> => { throw Error('参数补全不得读目录'); });
  expect((await sqliteCompletionSuggestions(result, { load })).items).toMatchObject([
    { label: ':Local', insertText: ':Local', kind: 'variable' }, { label: ':local', kind: 'variable' }, { label: ':Script', kind: 'variable' },
  ]);
  expect(load).not.toHaveBeenCalled();
});

it('替换完整占位符并能用 SQLite 同名绑定执行，悬停仅显示本地引用次数', async () => {
  const { source, offset, result } = analyze('SELECT :Text AS original, :Te§suffix AS reused, :text AS different');
  if (result.status !== 'ready') throw Error(result.reason);
  const load = vi.fn(async (_query: SqliteCompletionLookup): Promise<SqliteCompletionOutput> => { throw Error('参数悬停不得读目录'); });
  const [candidate] = (await sqliteCompletionSuggestions(result, { load })).items;
  expect(candidate.insertText).toBe(':Text');
  const { start, end } = result.target;
  const accepted = source.slice(0, start) + candidate.insertText + source.slice(end);
  expect(sqliteParameterPlan(accepted).names).toEqual(['Text', 'text']);
  expect(() => validateSqliteCompletionAnalysis({ ...result, target: { ...result.target, end: end - 1 } }, source, offset)).toThrow();
  const db = new DatabaseSync(':memory:');
  try { expect(db.prepare(accepted).get({ ':Text': '复用', ':text': '独立' })).toEqual({ original: '复用', reused: '复用', different: '独立' }); }
  finally { db.close(); }
  const hover = analyze('SELECT :Text; SELECT :Te§xt AS reused, :Text AS again', 'hover').result;
  if (hover.status !== 'ready') throw Error(hover.reason);
  expect(await sqliteFieldHover(hover, { load })).toContain('本语句 2 处');
  expect(await sqliteFieldHover(hover, { load })).toContain('当前草稿 3 处');
  expect(load).not.toHaveBeenCalled();
});

it('跨语句名称超出候选预算时仍保留本语句名称及其准确计数', () => {
  const previous = Array.from({ length: 200 }, (_, index) => ':n' + index).join(',');
  const { result } = analyze('SELECT ' + previous + '; SELECT :current, :n199, :§');
  if (result.status !== 'ready') throw Error(result.reason);
  expect(result.parameter?.incomplete).toBe(true);
  expect(result.parameter?.items).toHaveLength(200);
  expect(result.parameter?.items.slice(0, 2)).toEqual([
    { name: 'n199', occurrences: 2, statementCount: 1 }, { name: 'current', occurrences: 1, statementCount: 1 },
  ]);
});

it.each([
  'SELECT 1 IS DISTINCT FROM :Na§', 'INSERT INTO items(id) VALUES(:Na§)',
  'UPDATE items SET id=:Na§', 'DELETE FROM items WHERE id=:Na§',
  'WITH c AS (VALUES(:Na§)) SELECT * FROM c', 'CREATE TABLE items AS SELECT :Na§',
  'INSERT INTO items VALUES(1) RETURNING :Na§', 'VALUES(1) UNION ALL SELECT :Na§',
])('只在可绑定表达式提供候选 %s', sql => {
  const { result } = analyze('SELECT :Named; ' + sql);
  expect(result).toMatchObject({ status: 'ready', syntax: ['parameter'], parameter: { items: [{ name: 'Named', occurrences: 1, statementCount: 0 }] } });
});

it.each([
  'SELECT * FROM :Ta§ble', 'SELECT 1 AS :Na§me', 'SELECT x COLLATE :Ru§le FROM items', 'SELECT * FROM items AS :Al§ias',
  'INSERT INTO items(:Co§lumn) VALUES(1)', 'UPDATE items SET :Co§lumn=1',
  'INSERT INTO items VALUES(1) ON CONFLICT(:Ident§ity) DO NOTHING',
  'CREATE VIEW v AS SELECT :Na§me', 'PRAGMA :Na§me', 'SELECT :Na§me(suffix)', 'SELECT :Na§me::suffix',
  "SELECT ':Na§me'", 'SELECT -- :Na§me', 'SELECT @Na§me', 'SELECT ?1§', 'SELECT [$Na§me]',
])('标识符位置、其它形式、字符串及注释没有值参数候选 %s', sql => {
  const { result } = analyze('SELECT :Named; ' + sql);
  expect(result.status === 'blocked' || !result.parameter).toBe(true);
});
