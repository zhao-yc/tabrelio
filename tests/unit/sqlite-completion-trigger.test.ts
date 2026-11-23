import { expect, it, vi } from 'vitest';
import { analyzeSqliteCompletion, sqliteReferenceContext, validateSqliteCompletionAnalysis, type SqliteAnalysisIntent } from '../../src/shared/sqliteCompletionAnalysis';
import type { SqliteCompletionLookup, SqliteCompletionOutput } from '../../src/shared/sqliteCompletion';
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
  expect(result.syntax).toEqual(['trigger']);
  return result;
}

it.each([
  ['CREATE TRIGGER tr AFTER INSERT ON so|urce', { kind: 'target', object: 'table' }],
  ['CREATE TRIGGER main.tr UPDATE ON so|urce', { kind: 'target', object: 'table', schema: 'main' }],
  ['CREATE TEMP TRIGGER tr INSTEAD OF UPDATE ON main.so|urce', { kind: 'target', object: 'view', schema: 'main' }],
  ['EXPLAIN CREATE TRIGGER IF NOT EXISTS tr DELETE ON temp.|', { kind: 'target', object: 'table', schema: 'temp' }],
])('ON 只建议相应类型的对象，并遵循声明或显式库：%s', (sql, context) => {
  expect(ready(sql).trigger).toEqual(context);
});

it.each([
  ['CREATE TRIGGER tr INSERT ON source WHEN NEW.va|lue IS NOT NULL BEGIN SELECT 1; END', 'new', { name: 'source' }],
  ['CREATE TRIGGER tr DELETE ON source BEGIN INSERT INTO log VALUES (OLD.va|lue); END', 'old', { name: 'source' }],
  ['CREATE TRIGGER tr AFTER UPDATE ON main.source FOR EACH ROW BEGIN UPDATE log SET message = NEW.va|lue; SELECT 1; END;', 'new', { name: 'source', schema: 'main' }],
  ['CREATE TRIGGER tr AFTER UPDATE ON main.source BEGIN SELECT CASE WHEN 1 THEN 2 END; SELECT OLD.en|d; END;', 'old', { name: 'source', schema: 'main' }],
  ["CREATE TRIGGER tr INSERT ON source BEGIN SELECT ';' end; SELECT NEW.va|lue; END;", 'new', { name: 'source' }],
  ['CREATE TRIGGER tr AFTER INSERT ON source WHEN NEW.begin > 0 BEGIN SELECT (SELECT NEW.va|lue); END;', 'new', { name: 'source' }],
  ['CREATE TEMP TRIGGER tr AFTER INSERT ON main.source BEGIN INSERT INTO log SELECT NEW.va|lue; END', 'new', { name: 'source', schema: 'main' }],
] as const)('WHEN 和动作表达式使用当前触发器实际事件的行：%s', (sql, row, source) => {
  expect(ready(sql).trigger).toEqual({ kind: 'row', source, row });
});

it.each([
  'CREATE TRIGGER tr INSERT ON source BEGIN SELECT OLD.i|d; END',
  'CREATE TRIGGER tr DELETE ON source WHEN NEW.va|lue IS NULL BEGIN SELECT 1; END',
  'CREATE TRIGGER tr UPDATE ON source BEGIN UPDATE log SET NEW.i|d = 2; END',
  'CREATE TRIGGER tr UPDATE ON source BEGIN INSERT INTO log(NEW.i|d) VALUES(1); END',
  'CREATE TRIGGER tr UPDATE ON source BEGIN SELECT NEW.i|d FROM other AS NEW; END',
  'CREATE TRIGGER tr UPDATE ON source BEGIN SELECT 1 FROM NEW.i|d; END',
  'CREATE TRIGGER tr UPDATE ON source BEGIN UPDATE log SET message = 2 RETURNING NEW.i|d; END',
  'CREATE TRIGGER main.tr UPDATE ON temp.so|urce',
  'CREATE TRIGGER tr UPDATE ON source BEGIN SELECT x.| FROM other x; END',
])('不可用事件、遮蔽和非表达式位置保留原隔离：%s', sql => {
  expect(analyze(sql).status).toBe('blocked');
});

it('UPDATE OF 从目标目录排除已选列，后继正文及局部重命名不复用触发器作用域', async () => {
  const sql = 'CREATE TRIGGER tr AFTER UPDATE OF id, va|lue, label ON main.source BEGIN SELECT NEW.value; END;';
  const context = ready(sql);
  expect(context.trigger).toEqual({ kind: 'update-of', source: { name: 'source', schema: 'main' }, used: ['id', 'label'] });
  const load = vi.fn(async (_query: SqliteCompletionLookup): Promise<SqliteCompletionOutput> => ({
    stamp: '1:0', incomplete: false, entries: [
      { kind: 'column', table: 'source', schema: 'main', name: 'value', declaredType: 'TEXT', hidden: false, generated: false },
      { kind: 'column', table: 'source', schema: 'main', name: 'value_derived', declaredType: 'TEXT', hidden: false, generated: true },
    ],
  }));
  expect((await sqliteCompletionSuggestions(context, { load })).items).toEqual([expect.objectContaining({ label: 'value', insertText: '"value"' })]);
  expect(load).toHaveBeenCalledExactlyOnceWith({ kind: 'columns', table: 'source', schema: 'main', prefix: 'va' });
  expect((await sqliteCompletionSuggestions(ready('CREATE TRIGGER tr UPDATE ON main.source BEGIN SELECT NEW.value|; END;'), { load })).items
    .map(item => item.label)).toEqual(['value', 'value_derived']);
  expect(await sqliteFieldHover(ready('CREATE TRIGGER tr UPDATE ON main.source BEGIN SELECT OLD.va|lue; END;', 'hover'), { load }))
    .toContain('SQLite 触发器 OLD 行');
  const model = sql.replace('|', '');
  expect(sqliteReferenceContext(model, model.indexOf('value'))).toMatchObject({ status: 'blocked', reason: 'trigger' });
  expect(analyze('EXPLAIN CREATE TRIGGER tr AFTER INSERT ON t BEGIN SELECT CASE WHEN 1 THEN 2 END; END; SELECT a.| FROM actual a'))
    .toMatchObject({ status: 'ready', relations: [{ name: 'actual', alias: 'a' }] });
});

it('行名候选可直接插入限定点号，直到请求字段才读原目标目录', async () => {
  const load = vi.fn<(_: SqliteCompletionLookup) => Promise<SqliteCompletionOutput>>();
  const context = ready('CREATE TRIGGER tr INSERT ON source BEGIN INSERT INTO log VALUES(NE|); END');
  expect((await sqliteCompletionSuggestions(context, { load })).items)
    .toEqual([expect.objectContaining({ label: 'NEW', insertText: 'NEW.', trigger: true })]);
  expect(load).not.toHaveBeenCalled();
});
