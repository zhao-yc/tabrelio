import { DatabaseSync } from 'node:sqlite';
import { expect, it, vi } from 'vitest';
import { analyzeSqliteCompletion, validateSqliteCompletionAnalysis, type SqliteAnalysisIntent } from '../../src/shared/sqliteCompletionAnalysis';
import { analyzeSqlitePhysicalObject } from '../../src/shared/sqlitePhysicalObject';
import { validPhysicalObjectAnalysis } from '../../src/shared/physicalObjectAnalysis';
import type { SqliteCompletionLookup, SqliteCompletionOutput } from '../../src/shared/sqliteCompletion';
import { sqliteCompletionSuggestions } from '../../src/renderer/sqliteCompletionSuggestions';
import { sqliteFieldHover } from '../../src/renderer/sqliteFieldHover';

function input(marked: string) { const offset = marked.indexOf('|'); return { source: marked.replace('|', ''), offset }; }
function analyze(marked: string, intent?: SqliteAnalysisIntent) {
  const { source, offset } = input(marked), result = analyzeSqliteCompletion(source, offset, intent);
  expect(validateSqliteCompletionAnalysis(result, source, offset, intent)).toEqual(result);
  return result;
}
function ready(marked: string, intent?: SqliteAnalysisIntent) {
  const result = analyze(marked, intent);
  if (result.status !== 'ready') throw Error(result.reason);
  return result;
}

it.each([
  ['CREATE VIEW display AS SELECT s.ma|in_value FROM subject AS s', 'main', 'subject'],
  ['CREATE VIEW IF NOT EXISTS "MaIn"."显示🚢" ([v], `shown`) AS SELECT s.ma|in_value, 1 FROM subject s', 'main', 'subject'],
  ['CREATE TEMP VIEW display AS SELECT s.te|mp_value FROM subject s', undefined, 'subject'],
  ['CREATE VIEW temp.display AS SELECT s.te|mp_value FROM subject s', undefined, 'subject'],
  ['CREATE TEMPORARY VIEW temp.display AS SELECT s.ma|in_value FROM main.subject s', 'main', 'subject'],
  ['CREATE TABLE main.copied AS SELECT s.te|mp_value FROM subject s', undefined, 'subject'],
  ['CREATE TEMP TABLE IF NOT EXISTS copied AS SELECT s.ma|in_value FROM main.subject s', 'main', 'subject'],
  ['SELECT 0; EXPLAIN QUERY PLAN CREATE TABLE copied AS SELECT s.te|mp_value FROM subject s', undefined, 'subject'],
  ['CREATE VIEW display AS WITH c AS (SELECT s.ma|in_value FROM subject s) SELECT * FROM c', 'main', 'subject'],
  ['CREATE VIEW display AS SELECT j.va|lue FROM json_each(\'[1]\') j', 'main', 'json_each'],
] as const)('查询体沿用原作用域并采用准确的库约束：%s', (sql, schema, table) => {
  expect(ready(sql).relations).toContainEqual(expect.objectContaining({ kind: 'physical', name: table, ...(schema ? { schema } : {}) }));
  if (!schema) expect(ready(sql).relations.find(value => value.name === table)).not.toHaveProperty('schema');
});

it.each([
  'CREATE VIEW ou|tput AS SELECT id FROM subject', 'CREATE VIEW output(id, va|lue) AS SELECT id, value FROM subject',
  'CREATE VIEW output AS UP|DATE subject SET id=1', 'CREATE VIEW output AS WITH c AS (SELECT x| FROM subject) UPDATE subject SET id=1',
  'CREATE VIEW output AS SELECT t.v| FROM temp.subject t', 'CREATE VIEW output AS SELECT * FROM temp.|',
  'CREATE TEMP VIEW main.output AS SELECT * FROM sub|ject', 'CREATE TABLE output(v) AS SELECT * FROM sub|ject',
  'CREATE VIEW output(v,) AS SELECT * FROM sub|ject', 'CREATE VIEW output() AS SELECT * FROM sub|ject',
])('目标名称、列清单或非法查询体不触发目录：%s', sql => {
  expect(analyze(sql).status).toBe('blocked');
});

it('AS 后仅补全查询开头，之后保留 CTE、函数和索引表达式', async () => {
  const load = vi.fn(async (): Promise<SqliteCompletionOutput> => ({ entries: [], incomplete: false, stamp: '1:0' }));
  const body = (sql: string) => sqliteCompletionSuggestions(ready(sql), { load });
  expect((await body('CREATE VIEW display(v) AS |')).items.map(item => item.label)).toEqual(['SELECT', 'WITH', 'VALUES']);
  expect((await body('CREATE TABLE copied AS SE|suffix')).items.map(item => item.label)).toEqual(['SELECT']);
  expect(load).not.toHaveBeenCalled();
  expect(ready('CREATE TABLE copied AS VALUES (ab|s(42))').functions).toMatchObject({ mode: 'scalar', existingCall: true });
  expect(ready('CREATE VIEW display AS SELECT * FROM subject INDEXED BY in|dex_name').indexSource).toEqual({ name: 'subject', schema: 'main' });
  expect(ready('CREATE VIEW display AS SELECT * FROM subject ORDER BY value COLLATE n|ocase').syntax).toEqual(['collation']);
  const local = ready('CREATE VIEW display AS WITH subject(id) AS (SELECT 1) SELECT s.i|d FROM subject s');
  expect(local.relations.some(value => value.kind === 'local' && !value.declaration && value.name === 'subject')).toBe(true);
  expect(local.relations.some(value => value.kind === 'physical')).toBe(false);
});

it('永久视图的关系候选仅访问 main，未限定的 CTE 保持遮蔽优先', async () => {
  const load = vi.fn(async (_query: SqliteCompletionLookup): Promise<SqliteCompletionOutput> => ({ stamp: '1:0', incomplete: false,
    entries: [{ kind: 'table', name: 'subject', schema: 'main' }] }));
  const draft = ready('CREATE VIEW display AS WITH subject(id) AS (SELECT 1) SELECT * FROM sub|suffix');
  expect(draft.viewSchema).toBe('main');
  const implicit = await sqliteCompletionSuggestions(draft, { load });
  expect(load).toHaveBeenCalledExactlyOnceWith({ kind: 'relations', schema: 'main', prefix: 'sub' });
  expect(implicit.items).toEqual([expect.objectContaining({ label: 'subject', detail: '公共表表达式' })]);
  const explicit = await sqliteCompletionSuggestions(ready('CREATE VIEW display AS WITH subject(id) AS (SELECT 1) SELECT * FROM main.sub|suffix'), { load });
  expect(explicit.items).toEqual([expect.objectContaining({ label: 'subject', detail: 'SQLite 表 · main' })]);
  const empty = await sqliteCompletionSuggestions(ready('CREATE VIEW display AS SELECT * FROM |'), { load });
  expect(empty.items.filter(item => item.kind === 'database').map(item => item.label)).toEqual(['main']);
});

it('实际 SQLite 验证永久视图、临时视图与 CTAS 的同名临时表解析', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec("CREATE TABLE subject(main_value TEXT); INSERT INTO subject VALUES('主表'); CREATE TEMP TABLE subject(temp_value TEXT); INSERT INTO temp.subject VALUES('临时表')");
    const load = vi.fn(async (query: SqliteCompletionLookup): Promise<SqliteCompletionOutput> => {
      if (query.kind !== 'columns') throw Error('本例只允许列目录');
      const schema = query.schema ?? 'temp';
      const rows = db.prepare('SELECT name,type FROM pragma_table_xinfo(?,?) WHERE substr(name,1,length(?)) = ?').all(query.table, schema, query.prefix, query.prefix);
      return { stamp: '1:0', incomplete: false, entries: rows.map(row => ({ kind: 'column', schema, table: query.table,
        name: String(row.name), declaredType: String(row.type), generated: false, hidden: false })) };
    });
    for (const [statement, name, expected, schema] of [
      ['CREATE VIEW published(marker) AS SELECT s.ma|suffix FROM subject s', 'published', '主表', 'main'],
      ['CREATE TEMP VIEW temporary(marker) AS SELECT s.te|suffix FROM subject s', 'temporary', '临时表', undefined],
      ['CREATE TABLE copied AS SELECT s.te|suffix AS marker FROM subject s', 'copied', '临时表', undefined],
    ] as const) {
      const value = ready(statement), { source } = input(statement);
      load.mockClear();
      const items = (await sqliteCompletionSuggestions(value, { load })).items;
      expect(items).toHaveLength(1);
      expect(load).toHaveBeenCalledExactlyOnceWith({ kind: 'columns', table: 'subject', prefix: value.target.prefix, ...(schema ? { schema } : {}) });
      expect(db.prepare('SELECT name FROM sqlite_schema WHERE name=?').get(name)).toBeUndefined();
      db.exec(source.slice(0, value.target.start) + items[0].insertText + source.slice(value.target.end));
      expect(db.prepare('SELECT marker FROM ' + name).get()?.marker).toBe(expected);
    }
    const field = ready('CREATE VIEW detail AS SELECT s.ma|in_value FROM subject s', 'hover');
    expect(await sqliteFieldHover(field, { load })).toContain('"main"."subject"');
  } finally { db.close(); }
});

it('物理定位核对正文 token 和永久视图默认库，临时视图仍留给原会话判定', () => {
  for (const [marked, main] of [['CREATE VIEW display AS SELECT s.id FROM sub|ject s', true],
    ['CREATE TEMP VIEW display AS SELECT s.id FROM sub|ject s', false], ['CREATE TABLE copied AS SELECT s.id FROM sub|ject s', false]] as const) {
    const { source, offset } = input(marked), actual = analyzeSqlitePhysicalObject(source, offset);
    expect(actual).toMatchObject({ status: 'ready', object: { table: 'subject', ...(main ? { defaultDatabase: 'main' } : {}) } });
    expect(validPhysicalObjectAnalysis(actual, source, offset, 'sqlite')).toBe(true);
    if (actual.status !== 'ready') throw Error(actual.reason);
    const forged = { ...actual.object, defaultDatabase: 'main' };
    if (main) delete (forged as { defaultDatabase?: string }).defaultDatabase;
    expect(validPhysicalObjectAnalysis({ ...actual, object: forged }, source, offset, 'sqlite')).toBe(false);
  }
  const marked = 'CREATE VIEW display AS SELECT s.id FROM main.sub|ject s', { source, offset } = input(marked);
  const explicit = analyzeSqlitePhysicalObject(source, offset);
  expect(explicit).toMatchObject({ status: 'ready', object: { table: 'subject', database: 'main' } });
  expect(validPhysicalObjectAnalysis(explicit, source, offset, 'sqlite')).toBe(true);
});
