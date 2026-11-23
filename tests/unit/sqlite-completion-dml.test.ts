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
    expect(value.relations).toEqual([{ kind: 'physical', schema: 'main', name: 'subject', alias: 't', dmlRole: 'mutation-target' }]);
  }
  const lhs = ready('INSERT INTO main.subject(id,value) VALUES(1,\'new\') ON CONFLICT(id) DO UPDATE SET id=1, va|lue=excluded.value');
  expect(lhs.writableColumns).toBe(true);
  const rhs = ready('INSERT INTO main.subject(id,value) VALUES(1,\'new\') ON CONFLICT(id) DO UPDATE SET (id,value)=(excluded.id,excluded.va|lue)');
  expect(rhs.writableColumns).toBeUndefined();
  expect(rhs.relations).toContainEqual({ kind: 'physical', schema: 'main', name: 'subject', alias: 'excluded', dmlRole: 'excluded' });
});

it('输入、冲突条件及 RETURNING 保持各自的绑定，多条冲突分支可独立编辑', () => {
  const head = 'INSERT INTO main.subject AS t(id,value) VALUES(1,\'new\') ';
  const where = ready(head + 'ON CONFLICT(id) DO NOTHING ON CONFLICT DO UPDATE SET value=excluded.value WHERE excluded.va|lue<>t.value RETURNING subject.value');
  expect(where.relations.map(relation => relation.kind === 'physical' && relation.dmlRole)).toEqual(['mutation-target', 'excluded']);
  const result = ready(head + 'ON CONFLICT DO UPDATE SET value=excluded.value RETURNING subject.va|lue');
  expect(result.relations).toEqual([expect.objectContaining({ name: 'subject', dmlRole: 'returning-target' })]);
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
  expect(draft.relations).toEqual([expect.objectContaining({ name: 'subject', dmlRole: 'mutation-target' })]);
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

it('UPDATE FROM 的 ON 独立于更新目标，外连接的后续来源也保持隔离', () => {
  const sql = 'UPDATE main.subject AS t SET value=src.value FROM inbox src LEFT JOIN inbox aux ON % JOIN inbox later ON 1 WHERE t.id=src.id';
  for (const marked of ['(SELECT t.va|lue)=aux.value', 't.va|lue=aux.value', 'later.va|lue=aux.value']) {
    expect(ready(sql.replace('%', marked)).relations.map(relation => relation.alias)).toEqual(['src', 'aux']);
  }
  const inner = sql.replace('LEFT JOIN', 'JOIN').replace('%', 'later.va|lue=aux.value');
  expect(ready(inner).relations.map(relation => relation.alias)).toEqual(['src', 'aux', 'later']);
  const where = sql.replace('%', 'aux.id=src.id').replace('t.id=src.id', 't.i|d=src.id');
  expect(ready(where).relations.map(relation => relation.alias)).toEqual(['t', 'src', 'aux', 'later']);
});

it('UPDATE 单一表值调用可关联目标行，多来源和派生查询保持隔离', async () => {
  const { db, directory } = fixture();
  try {
    const marked = `UPDATE main.subject AS t SET value=j.value FROM (json_each((SELECT t.va|lue)) j) RETURNING subject.value`;
    const analysis = ready(marked);
    expect(analysis.relations).toEqual([{ kind: 'physical', schema: 'main', name: 'subject', alias: 't', dmlRole: 'mutation-target' }]);
    const { items } = await sqliteCompletionSuggestions(analysis, directory);
    expect(items.map(item => item.insertText)).toEqual(['"value"']);
    db.exec(`UPDATE main.subject SET value='["from-json"]'`);
    expect(db.prepare(input(marked).source).all()).toEqual([{ value: 'from-json' }]);
    expect(ready('UPDATE main.subject AS t SET value=j.value FROM inbox src JOIN json_each(t.va|lue) j ON 1').relations.map(relation => relation.alias)).toEqual(['src']);
    expect(ready('UPDATE main.subject AS t SET value=q.value FROM (SELECT t.va|lue) q').relations).toEqual([]);
  } finally { db.close(); }
});

it('SET 列组与 IS DISTINCT FROM 后的赋值保留可写目标，生成列只在读取位置出现', async () => {
  const { db, directory } = fixture();
  try {
    const marked = 'UPDATE main.subject AS t SET id=id IS DISTINCT FROM NULL, (id,vir|tual_value)=(src.id,src.value) FROM inbox src WHERE t.id=src.id';
    const lhs = ready(marked);
    expect(lhs.writableColumns).toBe(true);
    expect(lhs.relations).toEqual([{ kind: 'physical', schema: 'main', name: 'subject', alias: 't' }]);
    expect((await sqliteCompletionSuggestions(lhs, directory)).items).toEqual([]);
    const reads = ready('UPDATE main.subject AS t SET value=src.va|lue FROM inbox src WHERE t.id=src.id');
    expect(reads.writableColumns).toBeUndefined();
    expect((await sqliteCompletionSuggestions(reads, directory)).items.map(item => item.insertText)).toEqual(['"value"']);
    const invalid = input(marked.replace('id,vir|tual_value', 'id,t.va|lue'));
    expect(analyzeSqliteCompletion(invalid.source, invalid.offset)).toMatchObject({ status: 'blocked', reason: 'qualified-target' });
  } finally { db.close(); }
});

it('UPDATE FROM 实际使用来源值，返回字段读取改写后的实际目标', async () => {
  const { db, directory } = fixture();
  try {
    const marked = 'UPDATE main.subject AS t SET (id,value)=(src.id,src.value) FROM inbox src WHERE main.t.id=src.id RETURNING (SELECT subject.vir|tual_value) AS rendered';
    const { source } = input(marked), aimed = ready(marked);
    expect(aimed.relations).toEqual([{ kind: 'physical', schema: 'main', name: 'subject', dmlRole: 'returning-target' }]);
    const { items } = await sqliteCompletionSuggestions(aimed, directory);
    expect(items.map(item => item.insertText)).toEqual(['"virtual_value"']);
    expect(directory.load).toHaveBeenCalledExactlyOnceWith({ kind: 'columns', table: 'subject', schema: 'main', prefix: 'vir' });
    expect(db.prepare(source.slice(0, aimed.target.start) + items[0].insertText + source.slice(aimed.target.end)).all()).toEqual([{ rendered: 'new!' }]);
    for (const qualifier of ['src', 't', 'main.subject']) {
      directory.load.mockClear();
      const invalid = marked.replace('subject.vir|tual_value', qualifier + '.vir|tual_value');
      expect((await sqliteCompletionSuggestions(ready(invalid), directory)).items).toEqual([]);
      expect(await sqliteFieldHover(ready(invalid, 'hover'), directory)).toBeUndefined();
      expect(directory.load).not.toHaveBeenCalled();
      expect(() => db.prepare(input(invalid).source)).toThrow('no such column');
    }
    expect(db.prepare('SELECT value FROM temp.subject').get()).toEqual({ value: 'temp' });
  } finally { db.close(); }
});

it('DELETE 使用原目标别名过滤，RETURNING 的实际表名提供删除前字段', async () => {
  const { db, directory } = fixture();
  try {
    const marked = 'DELETE FROM subject AS t WHERE temp.t.i|d=1 RETURNING subject.value';
    expect((await sqliteCompletionSuggestions(ready(marked), directory)).items.map(item => item.insertText)).toEqual(['"id"']);
    const other = ready(marked.replace('temp.t.', 'main.t.'));
    expect((await sqliteCompletionSuggestions(other, directory)).items).toEqual([]);
    const returning = marked.replace('i|d', 'id').replace('subject.value', 'subject.va|lue');
    expect(await sqliteFieldHover(ready(returning, 'hover'), directory)).toContain('"temp"."subject"');
    expect(db.prepare(input(returning).source).all()).toEqual([{ value: 'temp' }]);
    expect(db.prepare('SELECT value FROM main.subject').get()).toEqual({ value: 'old' });
  } finally { db.close(); }
});
