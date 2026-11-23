import { DatabaseSync } from 'node:sqlite';
import { expect, it, vi } from 'vitest';
import { sqliteCompletionInputSchema, type SqliteCompletionLookup, type SqliteCompletionOutput } from '../../src/shared/sqliteCompletion';
import { analyzeSqliteCompletion, validateSqliteCompletionAnalysis, type SqliteAnalysisIntent } from '../../src/shared/sqliteCompletionAnalysis';
import { analyzeSqlitePhysicalObject } from '../../src/shared/sqlitePhysicalObject';
import { validPhysicalObjectAnalysis } from '../../src/shared/physicalObjectAnalysis';
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
  ['CREATE INDEX picked ON |', {}],
  ['CREATE UNIQUE INDEX IF NOT EXISTS main.picked ON sub|suffix(value)', { schema: 'main' }],
  ['EXPLAIN CREATE INDEX "temp"."选中🚢" ON "sub|suffix"(value)', { schema: 'temp' }],
] as const)('索引库控制单段目标表候选：%s', (sql, indexTarget) => {
  expect(ready(sql)).toMatchObject({ syntax: ['relation'], qualifiers: [], relations: [], indexTarget });
});

it.each([
  ['CREATE INDEX picked ON subject(va|lue DESC)', undefined, true],
  ['CREATE UNIQUE INDEX main.picked ON subject(lower(va|lue) COLLATE NOCASE)', 'main', true],
  ['CREATE INDEX temp.picked ON subject("生|成列🚢")', 'temp', true],
  ['CREATE INDEX main.picked ON subject(value) WHERE subject.ac|tive=1', 'main', undefined],
  ['CREATE INDEX picked ON subject(value) WHERE temp.subject.ac|tive=1', undefined, undefined],
] as const)('索引键和谓词沿用准确目标字段范围：%s', (sql, schema, unqualified) => {
  const value = ready(sql);
  expect(value.syntax).toEqual(['column']);
  expect(value.relations).toEqual([{ kind: 'physical', name: 'subject', indexTable: true, ...(schema ? { schema } : {}) }]);
  expect(value.unqualifiedColumns).toBe(unqualified);
});

it.each([
  'CREATE INDEX pic|ked ON subject(value)', 'CREATE INDEX picked ON main.sub|ject(value)',
  'CREATE INDEX picked ON subject(s.va|lue)', 'CREATE INDEX picked ON subject(sub|ject.value)',
  'CREATE INDEX picked ON subject((SELECT va|lue FROM another))',
  'CREATE INDEX picked ON subject(value) WHERE EXISTS(SELECT ac|tive FROM another)',
  'CREATE INDEX picked ON subject(value) WHERE ?1=ac|tive', 'CREATE INDEX aux.picked ON subject(va|lue)',
  'CREATE INDEX picked ON subject(value) AS va|lue',
])('非法语法或索引名角色不进入目录：%s', sql => expect(analyze(sql).status).toBe('blocked'));

it('候选只读取索引表、索引字段和确定性函数，排序规则沿用原角色', async () => {
  const load = vi.fn(async (query: SqliteCompletionLookup): Promise<SqliteCompletionOutput> => {
    const entries: SqliteCompletionOutput['entries'] = query.kind === 'relations' ? [{ kind: 'table', name: 'subject', schema: 'main' }] :
      query.kind === 'functions' ? [{ kind: 'function', name: 'lower', signatures: [{ type: 'scalar', arity: 1 }] }] : [];
    return { entries, incomplete: false, stamp: '1:0' };
  });
  const table = await sqliteCompletionSuggestions(ready('CREATE INDEX main.picked ON |'), { load });
  expect(table.items).toEqual([expect.objectContaining({ label: 'subject', insertText: '"subject"' })]);
  expect(load).toHaveBeenCalledExactlyOnceWith({ kind: 'relations', prefix: '', schema: 'main', indexTable: true });
  load.mockClear();
  const fn = await sqliteCompletionSuggestions(ready('CREATE INDEX picked ON subject(lo|suffix)'), { load });
  expect(fn.items).toEqual([expect.objectContaining({ label: 'lower', insertText: 'lower($0)' })]);
  expect(load.mock.calls.map(([query]) => query)).toEqual([{ kind: 'columns', prefix: 'lo', table: 'subject', indexTable: true }, { kind: 'functions', prefix: 'lo', deterministicOnly: true }]);
  load.mockClear();
  const hover = await sqliteFieldHover(ready('CREATE INDEX picked ON subject(lo|wer(value))', 'hover'), { load });
  expect(hover).toContain('SQLite 标量函数');
  expect(load).toHaveBeenCalledExactlyOnceWith({ kind: 'functions', prefix: 'lower', deterministicOnly: true });
  expect(ready('CREATE INDEX picked ON subject(value COLLATE no|case)').syntax).toEqual(['collation']);
});

it('原生 SQLite 使用正确库的生成列创建部分索引，并且查询计划可以选它', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec("CREATE TABLE subject(id INTEGER PRIMARY KEY,value TEXT,active INTEGER,generated TEXT GENERATED ALWAYS AS (lower(value))); INSERT INTO subject(id,value,active) VALUES(1,'Y',1),(2,'N',0); CREATE TEMP TABLE subject(temp_only TEXT)");
    const load = vi.fn(async (query: SqliteCompletionLookup): Promise<SqliteCompletionOutput> => {
      if (query.kind !== 'columns' || !query.indexTable || query.schema !== 'main') throw Error('本例只允许 main 的索引目标列');
      const rows = db.prepare('SELECT name,type,hidden FROM pragma_table_xinfo(?,?) WHERE substr(name,1,length(?))=?').all(query.table, query.schema, query.prefix, query.prefix);
      return { stamp: '1:0', incomplete: false, entries: rows.map(row => ({ kind: 'column', schema: 'main', table: query.table,
        name: String(row.name), declaredType: String(row.type), generated: row.hidden === 2 || row.hidden === 3, hidden: false })) };
    });
    const marked = 'CREATE INDEX main.picked ON subject("gen|suffix") WHERE subject.active=1';
    const value = ready(marked), { source } = input(marked), items = (await sqliteCompletionSuggestions(value, { load })).items;
    expect(items).toEqual([expect.objectContaining({ insertText: '"generated"', detail: expect.stringContaining('生成列') })]);
    expect(db.prepare("SELECT name FROM sqlite_schema WHERE name='picked'").get()).toBeUndefined();
    db.exec(source.slice(0, value.target.start) + items[0].insertText + source.slice(value.target.end));
    expect(db.prepare("SELECT partial FROM pragma_index_list('subject','main') WHERE name='picked'").get()?.partial).toBe(1);
    expect(db.prepare("EXPLAIN QUERY PLAN SELECT id FROM main.subject INDEXED BY picked WHERE subject.active=1 AND generated='y'").get()?.detail).toContain('picked');
  } finally { db.close(); }
});

it.each(['main', 'temp'] as const)('对象结构根据索引名核对 %s 而不虚构表的库名 token', schema => {
  const marked = `CREATE INDEX ${schema}.picked ON sub|ject(value)`, { source, offset } = input(marked);
  const result = analyzeSqlitePhysicalObject(source, offset);
  expect(result).toMatchObject({ status: 'ready', object: { table: 'subject', defaultDatabase: schema } });
  expect(validPhysicalObjectAnalysis(result, source, offset, 'sqlite')).toBe(true);
  if (result.status !== 'ready') throw Error(result.reason);
  expect(result.object).not.toHaveProperty('databaseRange');
  expect(validPhysicalObjectAnalysis({ ...result, object: { ...result.object, defaultDatabase: schema === 'main' ? 'temp' : 'main' } }, source, offset, 'sqlite')).toBe(false);
});

it('索引目录协议禁止混用表值函数、任意 SQL 或未经验证的作用域', () => {
  const lookup = { kind: 'columns', indexTable: true, prefix: 'v', table: 'subject', taskId: 'sqlite-completion:1', connectionId: 'local' };
  expect(sqliteCompletionInputSchema.safeParse(lookup).success).toBe(true);
  for (const extra of [{ tableFunction: true }, { sql: 'SELECT 1' }, { indexTable: false }]) expect(sqliteCompletionInputSchema.safeParse({ ...lookup, ...extra }).success).toBe(false);
});
