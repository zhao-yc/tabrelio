import { expect, it, vi } from 'vitest';
import { analyzeSqliteCompletion, validateSqliteCompletionAnalysis, type SqliteAnalysisIntent } from '../../src/shared/sqliteCompletionAnalysis';
import { sqliteCompletionInputSchema, type SqliteCompletionLookup, type SqliteCompletionOutput } from '../../src/shared/sqliteCompletion';
import { analyzeSqlitePhysicalObject } from '../../src/shared/sqlitePhysicalObject';
import { validPhysicalObjectAnalysis } from '../../src/shared/physicalObjectAnalysis';
import { sqliteCompletionSuggestions } from '../../src/renderer/sqliteCompletionSuggestions';
import { sqliteFieldHover } from '../../src/renderer/sqliteFieldHover';

function sourceAt(text: string) { return { source: text.replace('|', ''), offset: text.indexOf('|') }; }
function analyze(marked: string, intent?: SqliteAnalysisIntent) {
  const { source, offset } = sourceAt(marked), value = analyzeSqliteCompletion(source, offset, intent);
  expect(validateSqliteCompletionAnalysis(value, source, offset, intent)).toEqual(value);
  return value;
}

it.each([
  ['DROP TABLE |', { object: 'table' }],
  ['DROP VIEW IF EXISTS [v|iew]', { object: 'view' }],
  ['DROP INDEX IF EXISTS MaIn.ind|ex_', { object: 'index', schema: 'main' }],
  ['EXPLAIN DROP TRIGGER temp.|; SELECT 1;', { object: 'trigger', schema: 'temp' }],
] as const)('准确识别 DROP 对象替换位置：%s', (marked, dropTarget) => {
  expect(analyze(marked)).toMatchObject({ status: 'ready', syntax: ['drop'], dropTarget, relations: [] });
});

it.each(['DROP TABLE aux.ob|ject', 'DROP VIEW IF EX|ISTS v', 'DROP TABLE ma|in.table_name', 'DROP TRIGGER t unex|pected',
  'ALTER TABLE target DROP COLUMN val|ue', 'DROP TABLE t; SELECT x.| FROM other x'])('DROP 目录与其它输入隔离：%s', marked => {
  const result = analyze(marked);
  if (result.status === 'ready') expect(result.dropTarget).toBeUndefined();
});

it('接受候选只替换对象名，悬停使用完整名称进行准确查找', async () => {
  const load = vi.fn(async (_query: SqliteCompletionLookup): Promise<SqliteCompletionOutput> => ({
    stamp: '1:0', incomplete: false,
    entries: [{ kind: 'drop-object', schema: 'main', object: 'index', name: 'id"lookup', owner: 'subject' }],
  }));
  const sql = 'DROP INDEX IF EXISTS main."id|""oldsuffix"; SELECT 1;', value = analyze(sql);
  if (value.status !== 'ready') throw Error(value.reason);
  const result = await sqliteCompletionSuggestions(value, { load });
  expect(result.items).toEqual([expect.objectContaining({ label: 'id"lookup', kind: 'index', insertText: '"id""lookup"' })]);
  const { source } = sourceAt(sql);
  expect(source.slice(0, value.target.start) + result.items[0].insertText + source.slice(value.target.end))
    .toBe('DROP INDEX IF EXISTS main."id""lookup"; SELECT 1;');
  const hover = analyze('DROP INDEX IF EXISTS main."id""loo|kup"', 'hover');
  if (hover.status !== 'ready') throw Error(hover.reason);
  expect(await sqliteFieldHover(hover, { load })).toContain('关联对象');
  expect(load.mock.calls.map(([query]) => query)).toEqual([
    { kind: 'drop-objects', object: 'index', schema: 'main', prefix: 'id' },
    { kind: 'drop-objects', object: 'index', schema: 'main', prefix: '', exact: 'id"lookup' },
  ]);
  expect(sqliteCompletionInputSchema.safeParse({ kind: 'drop-objects', object: 'index', prefix: 'x', exact: 'y',
    connectionId: 'test', taskId: 'sqlite-completion:1' }).success).toBe(false);
});

it.each(['TABLE', 'VIEW', 'INDEX', 'TRIGGER'])('查看定义绑定 DROP %s 的实际类型、单个词与显式库', kind => {
  const { source, offset } = sourceAt('DROP ' + kind + ' IF EXISTS temp.[带|空格 值]; SELECT 1;'), value = analyzeSqlitePhysicalObject(source, offset);
  expect(value).toMatchObject({ status: 'ready', object: { table: '带空格 值', database: 'temp', dropKind: kind.toLowerCase() } });
  if (value.status !== 'ready') throw Error(value.reason);
  expect(validPhysicalObjectAnalysis(value, source, offset, 'sqlite')).toBe(true);
  for (const patch of [{ dropKind: undefined }, { dropKind: 'unknown' }, { database: undefined, databaseRange: undefined }]) {
    expect(validPhysicalObjectAnalysis({ ...value, object: { ...value.object, ...patch } }, source, offset, 'sqlite')).toBe(false);
  }
  const { database: _database, databaseRange: _databaseRange, ...unqualified } = value.object;
  expect(validPhysicalObjectAnalysis({ ...value, object: { ...unqualified, defaultDatabase: 'temp' } }, source, offset, 'sqlite')).toBe(false);
});
