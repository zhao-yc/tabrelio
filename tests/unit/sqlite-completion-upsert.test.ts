import { DatabaseSync } from 'node:sqlite';
import { expect, it, vi } from 'vitest';
import { sqliteCompletionSuggestions } from '../../src/renderer/sqliteCompletionSuggestions';
import { sqliteFieldHover } from '../../src/renderer/sqliteFieldHover';
import { analyzeSqliteCompletion, validateSqliteCompletionAnalysis, type SqliteAnalysisIntent } from '../../src/shared/sqliteCompletionAnalysis';
import type { SqliteCompletionLookup, SqliteCompletionOutput } from '../../src/shared/sqliteCompletion';

function input(marked: string) { return { source: marked.replace('|', ''), offset: marked.indexOf('|') }; }

function ready(marked: string, intent?: SqliteAnalysisIntent) {
  const { source, offset } = input(marked), value = analyzeSqliteCompletion(source, offset, intent);
  if (value.status !== 'ready') throw Error(value.reason);
  expect(validateSqliteCompletionAnalysis(value, source, offset, intent)).toEqual(value);
  return value;
}

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE subject(id INTEGER PRIMARY KEY,value TEXT, virtual_value TEXT GENERATED ALWAYS AS (value||'!'));
    CREATE TEMP TABLE subject(id INTEGER PRIMARY KEY,value TEXT, temp_only TEXT);
    CREATE TABLE excluded(id INTEGER PRIMARY KEY,value TEXT);
    CREATE TABLE inbox(id INTEGER,value TEXT);
    INSERT INTO main.subject(id,value) VALUES(1,'old'); INSERT INTO temp.subject VALUES(1,'temp','here');
    INSERT INTO excluded VALUES(1,'original'); INSERT INTO inbox VALUES(1,'new');`);
  const load = vi.fn(async (query: SqliteCompletionLookup): Promise<SqliteCompletionOutput> => {
    const schema = query.kind === 'columns' ? query.schema ?? (query.table === 'subject' ? 'temp' : 'main') : 'main';
    const rows = query.kind === 'columns' ? db.prepare('SELECT name,type,hidden FROM pragma_table_xinfo(?,?)').all(query.table, schema) as { name: string; type: string; hidden: number }[] : [];
    const entries = query.kind === 'columns' ? rows.filter(row => row.name.startsWith(query.prefix)).map(row => ({
      kind: 'column' as const, schema, table: query.table, name: row.name, declaredType: row.type, generated: row.hidden === 2 || row.hidden === 3, hidden: row.hidden === 1,
    })) : [];
    return { entries, incomplete: false, stamp: '1:0' };
  });
  return { db, directory: { load } };
}

it('冲突目标、部分索引谓词和多列赋值左侧限定在物理目标', () => {
  for (const marked of [
    'INSERT INTO main.subject AS t(id,value) VALUES(1,\'new\') ON CONFLICT(i|d) DO UPDATE SET value=excluded.value',
    'INSERT INTO main.subject AS t(id,value) VALUES(1,\'new\') ON CONFLICT(lower(value)) WHERE val|ue IS NOT NULL DO UPDATE SET value=excluded.value',
    'INSERT INTO main.subject AS t(id,value) VALUES(1,\'new\') ON CONFLICT(id) DO UPDATE SET (id,va|lue)=(excluded.id,excluded.value)',
  ]) {
    const value = ready(marked);
    expect(value.unqualifiedColumns).toBe(true);
    expect(value.relations).toEqual([{ kind: 'physical', schema: 'main', name: 'subject', alias: 't', insertRole: 'upsert-target' }]);
  }
  const lhs = ready('INSERT INTO main.subject(id,value) VALUES(1,\'new\') ON CONFLICT(id) DO UPDATE SET id=1, va|lue=excluded.value');
  expect(lhs.writableColumns).toBe(true);
  const rhs = ready('INSERT INTO main.subject(id,value) VALUES(1,\'new\') ON CONFLICT(id) DO UPDATE SET (id,value)=(excluded.id,excluded.va|lue)');
  expect(rhs.writableColumns).toBeUndefined();
  expect(rhs.relations).toContainEqual({ kind: 'physical', schema: 'main', name: 'subject', alias: 'excluded', insertRole: 'excluded' });
});

it('输入、冲突条件及 RETURNING 保持各自的绑定，多条冲突分支可独立编辑', () => {
  const head = 'INSERT INTO main.subject AS t(id,value) VALUES(1,\'new\') ';
  const where = ready(head + 'ON CONFLICT(id) DO NOTHING ON CONFLICT DO UPDATE SET value=excluded.value WHERE excluded.va|lue<>t.value RETURNING subject.value');
  expect(where.relations.map(relation => relation.kind === 'physical' && relation.insertRole)).toEqual(['upsert-target', 'excluded']);
  const result = ready(head + 'ON CONFLICT DO UPDATE SET value=excluded.value RETURNING subject.va|lue');
  expect(result.relations).toEqual([expect.objectContaining({ name: 'subject', insertRole: 'insert-returning' })]);
  const nested = ready(head + 'ON CONFLICT DO UPDATE SET value=(SELECT excluded.va|lue FROM inbox AS t)');
  expect(nested.relations.map(relation => relation.alias)).toEqual(['t', 'excluded']);
  const shadowed = ready(head + 'ON CONFLICT DO UPDATE SET value=(SELECT excluded.va|lue FROM inbox AS excluded)');
  expect(shadowed.relations.filter(relation => relation.alias === 'excluded')).toEqual([{ kind: 'physical', name: 'inbox', alias: 'excluded' }]);
  const returning = ready(head + 'ON CONFLICT DO UPDATE SET value=excluded.value RETURNING (SELECT subject.va|lue)');
  expect(returning.relations.map(relation => relation.alias ?? relation.name)).toEqual(['subject']);
});

it('INSERT SELECT、WITH 与冲突动作独立，JOIN 里调用 conflict() 保持原来的来源', () => {
  const sql = 'INSERT INTO main.subject(id,value) WITH data AS (SELECT id,value FROM inbox) SELECT d.id,d.value FROM data d JOIN inbox i ON conflict(i.id) WHERE true ON CONFLICT(id) DO UPDATE SET value=excluded.value';
  const left = ready(sql.replace('d.value', 'd.va|lue'));
  expect(left.relations.map(relation => relation.alias).filter(Boolean)).toEqual(['d', 'i']);
  const right = ready(sql.replace('excluded.value', 'excluded.va|lue'));
  expect(right.relations.map(relation => relation.alias)).toEqual([undefined, 'excluded']);
  const draft = ready('INSERT INTO main.subject(id,value) SELECT id,value FROM inbox WHERE true ON CONFLICT(i|d)');
  expect(draft.relations).toEqual([expect.objectContaining({ name: 'subject', insertRole: 'upsert-target' })]);
  const nested = ready('INSERT INTO main.subject(id,value) VALUES(1,(SELECT i.va|lue FROM inbox i))');
  expect(nested.relations).toEqual([{ kind: 'physical', name: 'inbox', alias: 'i' }]);
});

it('待插入行与旧行共用一次真实列目录，接受候选后按原生语义写入并返回', async () => {
  const { db, directory } = fixture();
  try {
    const marked = `INSERT INTO main.subject AS t(id,value) VALUES(1,'new') ON CONFLICT(id) DO UPDATE SET value=concat(t.value,va|lue) WHERE excluded.value<>'skip' RETURNING subject.value,subject.virtual_value`;
    const { source } = input(marked), value = ready(marked);
    const { items, incomplete } = await sqliteCompletionSuggestions(value, directory);
    expect(incomplete).toBe(false);
    expect(directory.load).toHaveBeenCalledExactlyOnceWith({ kind: 'columns', table: 'subject', schema: 'main', prefix: 'va' });
    expect(items.map(item => item.insertText)).toEqual(['"t"."value"', '"excluded"."value"']);
    const candidate = items.find(item => item.detail.includes('待插入行'))!;
    const sql = source.slice(0, value.target.start) + candidate.insertText + source.slice(value.target.end);
    expect(db.prepare(sql).all()).toEqual([{ value: 'oldnew', virtual_value: 'oldnew!' }]);
    expect(db.prepare('SELECT value FROM temp.subject').get()).toEqual({ value: 'temp' });
  } finally { db.close(); }
});

it('只在写入目标隐藏生成列；冲突目标与待插入行仍能读取其声明类型', async () => {
  const { db, directory } = fixture();
  try {
    for (const marked of [
      'INSERT INTO main.subject(vir|tual_value) VALUES(1)',
      'INSERT INTO main.subject(id,value) VALUES(1,\'new\') ON CONFLICT DO UPDATE SET vir|tual_value=excluded.value',
    ]) expect((await sqliteCompletionSuggestions(ready(marked), directory)).items).toEqual([]);
    const insert = 'INSERT INTO main.subject(id,value) VALUES(1,\'new\') ON CONFLICT DO UPDATE SET value=';
    const hover = await sqliteFieldHover(ready(insert + 'excluded.vir|tual_value', 'hover'), directory);
    expect(hover).toContain('待插入行');
    expect(hover).toContain('"TEXT"');
    const original = await sqliteFieldHover(ready(insert + 'va|lue', 'hover'), directory);
    expect(original).toContain('"main"."subject"');
    expect(original).not.toContain('待插入行');
  } finally { db.close(); }
});

it('真实目标名 excluded 优先；给目标声明不同别名后才提供待插入行', async () => {
  const { db, directory } = fixture();
  try {
    const base = 'INSERT INTO excluded%s VALUES(1,\'new\') ON CONFLICT(id) DO UPDATE SET value=excluded.va|lue RETURNING value';
    for (const [alias, expected, incoming] of [['', 'original', false], [' AS t', 'new', true]] as const) {
      const marked = base.replace('%s', alias), { source } = input(marked);
      const result = await sqliteCompletionSuggestions(ready(marked), directory);
      expect(result.items.some(item => item.detail.includes('待插入行'))).toBe(incoming);
      expect(db.prepare(source).get()).toEqual({ value: expected });
    }
  } finally { db.close(); }
});

it('三段目标别名按原 INSERT 的 schema 验证，RETURNING 限定实际表名', async () => {
  const { db, directory } = fixture();
  try {
    const sql = 'INSERT INTO subject AS t(id,value) VALUES(1,\'new\') ON CONFLICT DO UPDATE SET value=%s RETURNING %v';
    const candidates = async (marked: string) => (await sqliteCompletionSuggestions(ready(marked), directory)).items.map(item => item.insertText);
    expect(await candidates(sql.replace('%s', 'temp.t.va|lue').replace('%v', 'value'))).toEqual(['"value"']);
    expect(await candidates(sql.replace('%s', 'main.t.va|lue').replace('%v', 'value'))).toEqual([]);
    expect(await candidates(sql.replace('%s', 'main.excluded.va|lue').replace('%v', 'value'))).toEqual([]);
    expect(await candidates(sql.replace('%s', 'excluded.value').replace('%v', 'subject.va|lue'))).toEqual(['"value"']);
    for (const qualifier of ['t', 'excluded', 'temp.subject']) {
      expect(await candidates(sql.replace('%s', 'excluded.value').replace('%v', qualifier + '.va|lue'))).toEqual([]);
    }
  } finally { db.close(); }
});

it.each([
  ['INSERT INTO subject(id,value) VALUES(1,va|lue) ON CONFLICT DO NOTHING', 'values'],
  ['INSERT INTO subject(id,value) VALUES(1,\'new\') ON CONFLICT(id COLLATE no|case) DO NOTHING', 'collation'],
  ['INSERT INTO subject(id,value) VALUES(1,\'new\') ON CONFLICT DO UP|DATE SET value=excluded.value', 'upsert-action'],
  ['INSERT INTO subject(id,value) VALUES(1,\'new\') ON CONFLICT DO UPDATE SET subject.va|lue=excluded.value', 'qualified-target'],
])('保护非字段、非限定赋值位置：%s', (marked, reason) => {
  const { source, offset } = input(marked);
  expect(analyzeSqliteCompletion(source, offset)).toEqual({ status: 'blocked', reason });
});
