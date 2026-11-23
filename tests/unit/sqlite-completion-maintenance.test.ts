import { expect, it, vi } from 'vitest';
import { analyzeSqliteCompletion, validateSqliteCompletionAnalysis, type SqliteAnalysisIntent } from '../../src/shared/sqliteCompletionAnalysis';
import { sqliteCompletionInputSchema, type SqliteCompletionLookup, type SqliteCompletionOutput } from '../../src/shared/sqliteCompletion';
import { sqliteCompletionSuggestions } from '../../src/renderer/sqliteCompletionSuggestions';
import { sqliteFieldHover } from '../../src/renderer/sqliteFieldHover';

function analyze(marked: string, intent?: SqliteAnalysisIntent) {
  const offset = marked.indexOf('|'), source = marked.replace('|', '');
  const result = analyzeSqliteCompletion(source, offset, intent);
  expect(validateSqliteCompletionAnalysis(result, source, offset, intent)).toEqual(result);
  return { source, offset, result };
}

it.each([
  ['ANALYZE |', { operation: 'analyze' }],
  ['EXPLAIN ANALYZE [TEMP].|; SELECT 1;', { operation: 'analyze', schema: 'temp' }],
  ['SELECT 1; REINDEX "MAIN".[id| old]', { operation: 'reindex', schema: 'main' }],
  ['REINDEX expre|ssions', { operation: 'reindex' }],
] as const)('识别 SQLite 维护目标位置 %s', (marked, maintenanceTarget) => {
  expect(analyze(marked).result).toMatchObject({ status: 'ready', syntax: ['maintenance'], maintenanceTarget, relations: [] });
});

it.each(['ANALY|ZE', 'REINDEX ma|in.subject', 'ANALYZE attached.|any', 'REINDEX main.x |y',
  'ANALYZE (|t)', "REINDEX 's|ql'", 'SELECT reindex(va|lue)', 'ANALYZE t; SELECT va|lue'])('拒绝将非维护对象位置作为目录入口 %s', marked => {
  const { result } = analyze(marked);
  expect(result.status === 'blocked' || !result.maintenanceTarget).toBe(true);
});

it('补入对象时保留既有库名，无库名时补入准确限定，悬停可展示同名的多个实际目标', async () => {
  const table = { kind: 'maintenance-object', object: 'table', schema: 'temp', name: 'no"case' } as const;
  const index = { kind: 'maintenance-object', object: 'index', schema: 'main', name: 'no"case', owner: 'subject' } as const;
  const load = vi.fn(async (query: SqliteCompletionLookup): Promise<SqliteCompletionOutput> => ({
    stamp: '1:2', incomplete: false,
    entries: query.kind === 'maintenance-objects' && query.schema === 'main' ? [index] : [table, index],
  }));
  const unqualified = analyze('REINDEX no|');
  const qualified = analyze('ANALYZE MAIN."no|suffix"; SELECT 1;');
  const hover = analyze('REINDEX "no""ca|se"', 'hover');
  if (unqualified.result.status !== 'ready' || qualified.result.status !== 'ready' || hover.result.status !== 'ready') throw Error('缺少维护目标');
  expect((await sqliteCompletionSuggestions(unqualified.result, { load })).items.map(item => item.insertText))
    .toEqual(['"temp"."no""case"', '"main"."no""case"']);
  const [item] = (await sqliteCompletionSuggestions(qualified.result, { load })).items;
  const { start, end } = qualified.result.target;
  expect(qualified.source.slice(0, start) + item.insertText + qualified.source.slice(end))
    .toBe('ANALYZE MAIN."no""case"; SELECT 1;');
  const content = await sqliteFieldHover(hover.result, { load });
  expect(content).toContain('重建表的所有索引');
  expect(content).toContain('重建单个索引');
  expect(content).toContain('"subject"');
  expect(load.mock.calls.map(([query]) => query)).toEqual([
    { kind: 'maintenance-objects', operation: 'reindex', prefix: 'no' },
    { kind: 'maintenance-objects', operation: 'analyze', schema: 'main', prefix: 'no' },
    { kind: 'maintenance-objects', operation: 'reindex', prefix: '', exact: 'no"case' },
  ]);
  expect(() => validateSqliteCompletionAnalysis({ ...qualified.result, qualifiers: [] }, qualified.source, qualified.offset)).toThrow();
  expect(analyze('ANALYZE main.ta|ble_name', 'object').result.status).toBe('blocked');
  expect(sqliteCompletionInputSchema.safeParse({ kind: 'maintenance-objects', operation: 'analyze', prefix: 'a', exact: 'a',
    connectionId: 'test', taskId: 'sqlite-completion:1' }).success).toBe(false);
});
