import { expect, it, vi } from 'vitest';
import { sqliteCompletionInputSchema, type SqliteCompletionLookup, type SqliteCompletionOutput } from '../../src/shared/sqliteCompletion';
import { analyzeSqliteCompletion, validateSqliteCompletionAnalysis, type SqliteAnalysisIntent } from '../../src/shared/sqliteCompletionAnalysis';
import { analyzeSqlitePhysicalObject } from '../../src/shared/sqlitePhysicalObject';
import { validPhysicalObjectAnalysis } from '../../src/shared/physicalObjectAnalysis';
import { sqliteCompletionSuggestions } from '../../src/renderer/sqliteCompletionSuggestions';
import { sqliteFieldHover } from '../../src/renderer/sqliteFieldHover';

function input(marked: string) { return { source: marked.replace('|', ''), offset: marked.indexOf('|') }; }
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
  ['ALTER TABLE |', []], ['ALTER TABLE su|bject RENAME TO new_name', []],
  ['ALTER TABLE "MaIn".su|bject DROP COLUMN v', ['MaIn']], ['SELECT 1; EXPLAIN ALTER TABLE temp.|', ['temp']],
] as const)('目标只能对应真实表和准确库：%s', (sql, qualifiers) => {
  expect(ready(sql)).toMatchObject({ syntax: ['relation'], alterTable: true, qualifiers, relations: [] });
});

it.each([
  ['ALTER TABLE subject RENAME co|l TO renamed', undefined, 'rename'],
  ['ALTER TABLE main.subject RENAME COLUMN [生|成列🚢] TO new_name', 'main', 'rename'],
  ['ALTER TABLE temp.subject DROP |', 'temp', 'drop'],
  ['EXPLAIN ALTER TABLE subject DROP COLUMN co|l', undefined, 'drop'],
  ['ALTER TABLE main.subject ALTER COLUMN co|l SET NOT NULL', 'main', 'nullability'],
  ['ALTER TABLE subject ALTER co|l DROP NOT NULL', undefined, 'nullability'],
] as const)('只补全原表的源字段：%s', (sql, schema, alterColumn) => {
  expect(ready(sql)).toMatchObject({ syntax: ['column'], unqualifiedColumns: true, relations: [{ kind: 'physical', name: 'subject', alterColumn, ...(schema ? { schema } : {}) }] });
});

it.each([
  'ALTER TABLE subject RENAME TO new|name', 'ALTER TABLE subject RENAME v TO new|name',
  'ALTER TABLE subject ADD COLUMN new|column TEXT', 'ALTER TABLE subject DROP COLUMN subject.va|lue',
  'ALTER TABLE subject ALTER value SET NO|T NULL', 'ALTER TABLE subject DROP INDEX index|name',
  'ALTER TABLE foreign.subject DROP co|l',
])('新名称、约束动作和无效列位置不读取目录：%s', sql => {
  // DROP 后实际的单列名可以恰好为 index，后续额外名称仍没有旧列角色。
  expect(analyze(sql).status).toBe('blocked');
});

it('ADD COLUMN 的 COLLATE 保留规则目录，删列和悬停只读取带动作的原列目录', async () => {
  const load = vi.fn(async (query: SqliteCompletionLookup): Promise<SqliteCompletionOutput> => ({ incomplete: false, stamp: '1:0', entries:
    query.kind === 'relations' ? [{ kind: 'table', schema: 'main', name: 'subject' }] : query.kind === 'columns' ?
      [{ kind: 'column', schema: 'main', table: 'subject', name: 'extra', declaredType: 'TEXT', generated: false, hidden: false }] : [] }));
  const ports = { load };
  expect(ready('ALTER TABLE subject ADD COLUMN new_value TEXT COLLATE n|ocase').syntax).toEqual(['collation']);
  expect((await sqliteCompletionSuggestions(ready('ALTER TABLE main.su|bject RENAME TO renamed'), ports)).items).toEqual([expect.objectContaining({ insertText: '"subject"' })]);
  expect(load).toHaveBeenCalledExactlyOnceWith({ kind: 'relations', alterTable: true, schema: 'main', prefix: 'su' });
  load.mockClear();
  expect((await sqliteCompletionSuggestions(ready('ALTER TABLE main.subject DROP COLUMN ex|suffix'), ports)).items).toEqual([expect.objectContaining({ insertText: '"extra"' })]);
  expect(load).toHaveBeenCalledExactlyOnceWith({ kind: 'columns', alterColumn: 'drop', schema: 'main', table: 'subject', prefix: 'ex' });
  load.mockClear();
  expect(await sqliteFieldHover(ready('ALTER TABLE main.subject RENAME COLUMN ex|tra TO next', 'hover'), ports)).toContain('"main"."subject"');
  expect(load).toHaveBeenCalledExactlyOnceWith({ kind: 'columns', alterColumn: 'rename', schema: 'main', table: 'subject', prefix: 'extra' });
});

it('对象定义只读取原表，显式库有准确 token；协议拒绝夹带写入参数', () => {
  const { source, offset } = input('ALTER TABLE main.sub|ject RENAME COLUMN value TO renamed');
  const result = analyzeSqlitePhysicalObject(source, offset);
  expect(result).toMatchObject({ status: 'ready', object: { table: 'subject', database: 'main' } });
  expect(validPhysicalObjectAnalysis(result, source, offset, 'sqlite')).toBe(true);
  const lookup = { kind: 'columns', table: 'subject', alterColumn: 'drop', prefix: 'v', connectionId: 'local', taskId: 'sqlite-completion:1' };
  expect(sqliteCompletionInputSchema.safeParse(lookup).success).toBe(true);
  for (const extra of [{ sql: 'DROP TABLE subject' }, { indexTable: true }, { tableFunction: true }, { alterColumn: 'write' }]) {
    expect(sqliteCompletionInputSchema.safeParse({ ...lookup, ...extra }).success).toBe(false);
  }
});
