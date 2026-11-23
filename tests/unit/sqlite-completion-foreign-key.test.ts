import { expect, it, vi } from 'vitest';
import { analyzeSqliteCompletion, validateSqliteCompletionAnalysis, type SqliteAnalysisIntent } from '../../src/shared/sqliteCompletionAnalysis';
import { sqliteCompletionInputSchema, type SqliteCompletionLookup, type SqliteCompletionOutput } from '../../src/shared/sqliteCompletion';
import { sqliteCompletionSuggestions } from '../../src/renderer/sqliteCompletionSuggestions';
import { sqliteFieldHover } from '../../src/renderer/sqliteFieldHover';

function analyze(marked: string, intent?: SqliteAnalysisIntent) {
  const offset = marked.indexOf('|'), source = marked.replace('|', '');
  const result = analyzeSqliteCompletion(source, offset, intent);
  expect(validateSqliteCompletionAnalysis(result, source, offset, intent)).toEqual(result);
  return result;
}

function ready(marked: string, intent?: SqliteAnalysisIntent) {
  const result = analyze(marked, intent);
  if (result.status !== 'ready') throw Error(result.reason);
  expect(result.syntax).toEqual(['foreign-key']);
  return result;
}

it.each([
  ['CREATE TABLE child(owner TEXT REFERENCES pa|rent(id))', 'main'],
  ['CREATE TEMP TABLE child(owner TEXT CONSTRAINT owner_ref REFERENCES |)', 'temp'],
  ['CREATE TABLE temp.child(owner TEXT, CONSTRAINT fk FOREIGN KEY(owner) REFERENCES pa|rent)', 'temp'],
] as const)('父表固定使用当前建表命名空间并保留自引用：%s', (sql, schema) => {
  expect(ready(sql).foreignKey).toEqual({ kind: 'parent', owner: { schema }, self: 'child' });
});

it('父列按所属库查找，复合列同时排除光标两边已填写的名称', () => {
  expect(ready('CREATE TABLE child(a,b,c,FOREIGN KEY(a,b,c) REFERENCES [Parent](X, fo|o, Y))').foreignKey)
    .toEqual({ kind: 'parent-column', owner: { schema: 'main' }, table: 'Parent', used: ['x', 'y'] });
  expect(ready('ALTER TABLE TEMP.[child] ADD COLUMN Owner INTEGER REFERENCES parent(i|d)').foreignKey)
    .toEqual({ kind: 'parent-column', owner: { child: { name: 'child', schema: 'temp' } }, table: 'parent', used: [] });
  expect(ready('ALTER TABLE child ADD owner INTEGER REFERENCES par|ent').foreignKey)
    .toEqual({ kind: 'parent', owner: { child: { name: 'child' } } });
  expect(ready('CREATE TABLE child(owner INTEGER REFERENCES a(id) REFERENCES b(ke|y))').foreignKey)
    .toEqual({ kind: 'parent-column', owner: { schema: 'main' }, table: 'b', used: [] });
});

it.each([
  'CREATE TABLE child(a, CONSTRAINT ck CHECK (references_function(par|ent)))',
  'CREATE TABLE child(a TEXT REFERENCES other.pa|rent(id))',
  'CREATE TABLE child(a TEXT REFERENCES other.parent(i|d))',
  'CREATE TABLE archive.child(a TEXT REFERENCES pa|rent(id))',
  'CREATE TABLE child(a TEXT REFERENCES parent(id) ON DELETE CAS|CADE)',
  'CREATE TABLE child(a,b,FOREIGN KEY(a) REFERENCES parent(a+fo|o))',
])('其它表达式和跨库引用隔离出外键目录：%s', sql => {
  const result = analyze(sql);
  if (result.status === 'ready') expect(result.foreignKey).toBeUndefined();
});

it('子列和自引用父列取当前 DDL，接受候选时只替换当前标识符', async () => {
  const load = vi.fn<(_: SqliteCompletionLookup) => Promise<SqliteCompletionOutput>>();
  const local = ready('CREATE TABLE child("序号" INTEGER PRIMARY KEY, owner TEXT, backup TEXT, FOREIGN KEY(owner, |) REFERENCES child)');
  expect((await sqliteCompletionSuggestions(local, { load })).items.map(item => item.insertText)).toEqual(['"序号"', '"backup"']);
  const self = ready('CREATE TEMP TABLE child("序号" INTEGER PRIMARY KEY, parent INTEGER REFERENCES CHILD([序|号]))');
  expect((await sqliteCompletionSuggestions(self, { load })).items.map(item => item.insertText)).toEqual(['"序号"']);
  expect(await sqliteFieldHover(ready('CREATE TABLE child(id INTEGER PRIMARY KEY, owner INTEGER REFERENCES child(i|d))', 'hover'), { load }))
    .toContain('当前建表声明');
  expect(load).not.toHaveBeenCalled();
});

it('ALTER 以命中子表所在库读取父表，候选及悬停都采用同一命名空间', async () => {
  const load = vi.fn(async (query: SqliteCompletionLookup): Promise<SqliteCompletionOutput> => ({ stamp: '1:1', incomplete: false, entries: query.kind === 'table-options' ?
    [{ kind: 'table-options', name: 'child', schema: 'temp', strict: false }] :
    [{ kind: 'column', name: 'Id', schema: 'temp', table: 'parent', declaredType: 'INTEGER', generated: false, hidden: false }] }));
  const suggestion = ready('ALTER TABLE child ADD owner INTEGER REFERENCES parent(i|d)');
  expect((await sqliteCompletionSuggestions(suggestion, { load })).items[0]?.detail).toContain('temp.parent');
  expect(load.mock.calls.map(([query]) => query)).toEqual([
    { kind: 'table-options', table: 'child', prefix: '' }, { kind: 'columns', table: 'parent', schema: 'temp', foreignKey: true, prefix: 'i' },
  ]);
  expect(await sqliteFieldHover(ready('ALTER TABLE child ADD owner INTEGER REFERENCES parent(i|d)', 'hover'), { load })).toContain('"temp"."parent"."Id"');
  expect(sqliteCompletionInputSchema.safeParse({ kind: 'columns', foreignKey: true, table: 'parent', prefix: '', connectionId: 'test', taskId: 'sqlite-completion:1' }).success).toBe(false);
});
