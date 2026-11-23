import { expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { analyzeSqliteCompletion, type SqliteCompletionAnalysis } from '../../src/shared/sqliteCompletionAnalysis';
import type { SqliteCompletionEntry, SqliteCompletionLookup } from '../../src/shared/sqliteCompletion';
import { sqliteCompletionSuggestions } from '../../src/renderer/sqliteCompletionSuggestions';

type Ready = Extract<SqliteCompletionAnalysis, { status: 'ready' }>;
const ready = (patch: Partial<Ready> = {}): Ready => ({ status: 'ready', target: { start: 9, end: 9, prefix: '', quoted: false }, syntax: ['column'], qualifiers: ['s'], relations: [{ kind: 'physical', name: 'subject', alias: 's' }], ...patch });
const column = (name: string, table = 'subject', schema: 'main' | 'temp' = 'main'): Extract<SqliteCompletionEntry, { kind: 'column' }> => ({ name, table, schema, kind: 'column', declaredType: 'TEXT', generated: false, hidden: false });
function directory(entries: SqliteCompletionEntry[], incomplete = false) { return { load: vi.fn(async (_query: SqliteCompletionLookup) => ({ entries, incomplete, stamp: '1:0' })) }; }
/** 真实分析结果直接进入候选生成，避免两个端口各自模拟而遗漏字段上下文契约。 */
it.each([
  ['SELECT s.na|suffix FROM main.subject AS s', '"name"', { kind: 'columns', table: 'subject', schema: 'main', prefix: 'na' }],
  ['INSERT INTO main.subject(na|suffix) VALUES(1)', '"name"', { kind: 'columns', table: 'subject', schema: 'main', prefix: 'na' }],
  ['UPDATE main.subject SET na|suffix=1', '"name"', { kind: 'columns', table: 'subject', schema: 'main', prefix: 'na' }],
] as const)('真实SQLite分析和候选合流：%s', async (marked, insertText, request) => {
  const offset = marked.indexOf('|'), source = marked.replace('|', ''), result = analyzeSqliteCompletion(source, offset);
  expect(result.status).toBe('ready'); if (result.status !== 'ready') throw Error(result.reason);
  const d = directory([column('name')]), candidates = await sqliteCompletionSuggestions(result, d);
  expect(d.load).toHaveBeenCalledExactlyOnceWith(request); expect(candidates.items.find(item => item.kind === 'column')?.insertText).toBe(insertText);
});
it('真实CTE显式输出列直接补全，既不查永久表也不读取用户行', async () => {
  const marked = 'WITH c(name) AS (SELECT 1) SELECT c.na| FROM c', result = analyzeSqliteCompletion(marked.replace('|', ''), marked.indexOf('|'));
  expect(result.status).toBe('ready'); if (result.status !== 'ready') throw Error(result.reason);
  const d = directory([]), candidates = await sqliteCompletionSuggestions(result, d);
  expect(d.load).not.toHaveBeenCalled(); expect(candidates.items).toEqual([expect.objectContaining({ label: 'name', kind: 'column', insertText: '"name"' })]);
});
it('CTE 与派生表逐层展开星号，实际 SQLite 接受重名后的字段，只读取原始表', async () => {
  const marked = 'WITH base AS (SELECT s.*, s.label AS label FROM temp.subject s), renamed AS (SELECT base.* FROM base) SELECT d."label:|suffix" FROM (SELECT renamed.* FROM renamed) d';
  const source = marked.replace('|', ''), analysis = analyzeSqliteCompletion(source, marked.indexOf('|'));
  if (analysis.status !== 'ready') throw Error(analysis.reason);
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE base(wrong); CREATE TABLE renamed(wrong); CREATE TABLE subject(wrong);
      CREATE TEMP TABLE subject(id INTEGER, label TEXT); INSERT INTO temp.subject VALUES(1,'来源列');`);
    const directory = { load: vi.fn(async (lookup: SqliteCompletionLookup) => {
      if (lookup.kind !== 'columns') throw Error('预期准确来源列');
      const entries = db.prepare('SELECT name,type,hidden FROM pragma_table_xinfo(?,?) ORDER BY cid').all(lookup.table, lookup.schema ?? 'main')
        .map(row => ({ ...column(String(row.name), lookup.table, lookup.schema ?? 'main'), declaredType: String(row.type), hidden: row.hidden === 1 }));
      return { entries, incomplete: false, stamp: '1:1' };
    }) };
    const result = await sqliteCompletionSuggestions(analysis, directory);
    expect(result.incomplete).toBe(false);
    expect(result.items.map(item => item.insertText)).toEqual(['"label:1"']);
    expect(directory.load).toHaveBeenCalledExactlyOnceWith({ kind: 'columns', table: 'subject', schema: 'temp', prefix: '' });
    const completed = source.slice(0, analysis.target.start) + result.items[0].insertText + source.slice(analysis.target.end);
    expect(db.prepare(completed).all()).toEqual([{ 'label:1': '来源列' }]);
  } finally { db.close(); }
});
it('局部星号复用嵌套 JOIN 的合并、重名与隐藏列输出规则', async () => {
  const marked = "WITH local AS (SELECT j.* FROM (SELECT 1 AS marker) a JOIN (source s JOIN json_each(s.payload) j ON 1) ON 1) SELECT local.| FROM local";
  const source = marked.replace('|', ''), analysis = analyzeSqliteCompletion(source, marked.indexOf('|'));
  if (analysis.status !== 'ready') throw Error(analysis.reason);
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE source(id INTEGER, payload TEXT); INSERT INTO source VALUES(1,'[7]');`);
    const directory = { load: vi.fn(async (lookup: SqliteCompletionLookup) => {
      if (lookup.kind !== 'columns') throw Error('预期准确来源列');
      const entries = db.prepare('SELECT name,hidden FROM pragma_table_xinfo(?,?) ORDER BY cid').all(lookup.table, lookup.schema ?? 'main')
        .map(row => ({ ...column(String(row.name), lookup.table), hidden: row.hidden === 1 }));
      return { entries, incomplete: false, stamp: '1:0' };
    }) };
    const result = await sqliteCompletionSuggestions(analysis, directory);
    const expanded = db.prepare(source.replace('local. FROM', '* FROM')).columns().map(({ name }) => name);
    expect(result.items.map(item => item.label)).toEqual(expanded);
    expect(expanded).toContain('id:1');
    expect(expanded).not.toContain('json');
    expect(directory.load.mock.calls).toEqual([[{ kind: 'columns', table: 'source', prefix: '' }],
      [{ kind: 'columns', table: 'json_each', tableFunction: true, prefix: '' }]]);
  } finally { db.close(); }
});
it('局部投影遇到未知表达式保留前序已知列，循环不会触发永久同名目录', async () => {
  const partial = 'WITH local AS (SELECT *, i+1, 1 AS later FROM src) SELECT local.| FROM local';
  const cyclic = 'WITH shadow AS (SELECT * FROM shadow) SELECT shadow.| FROM shadow';
  const d = directory([column('id', 'src')]);
  const analyze = (marked: string) => {
    const result = analyzeSqliteCompletion(marked.replace('|', ''), marked.indexOf('|'));
    if (result.status !== 'ready') throw Error(result.reason);
    return result;
  };
  const result = await sqliteCompletionSuggestions(analyze(partial), d);
  expect(result.items.map(item => item.label)).toEqual(['id']);
  expect(result.incomplete).toBe(true);
  d.load.mockClear();
  expect(await sqliteCompletionSuggestions(analyze(cyclic), d)).toEqual({ items: [], incomplete: true });
  expect(d.load).not.toHaveBeenCalled();
});

it('外层 USING 和复合排序直接使用实际 SQLite 局部投影的稳定重名列', async () => {
  const prefix = 'WITH base AS (SELECT s.*, s.label AS label FROM main.subject s) ';
  const cases = [
    [prefix + 'SELECT r."label:1" FROM base l JOIN (SELECT * FROM base) r USING (id, "label:|suffix")', ['A']],
    [prefix + 'SELECT d.* FROM (SELECT * FROM base) d JOIN main.subject m ON m.id=d.id UNION ALL SELECT 9,\'Z\',\'Z\' ORDER BY "label:|suffix" DESC', ['Z', 'A']],
  ] as const;
  const db = new DatabaseSync(':memory:');
  try {
    db.exec("CREATE TABLE subject(id INTEGER, label TEXT); INSERT INTO subject VALUES(1,'A'); CREATE TABLE base(wrong TEXT);");
    for (const [marked, expected] of cases) {
      const source = marked.replace('|', ''), analysis = analyzeSqliteCompletion(source, marked.indexOf('|'));
      if (analysis.status !== 'ready') throw Error(analysis.reason);
      const directory = { load: vi.fn(async (lookup: SqliteCompletionLookup) => {
        if (lookup.kind !== 'columns') throw Error('预期准确来源列');
        const entries = db.prepare('SELECT name,hidden FROM pragma_table_xinfo(?,?) ORDER BY cid').all(lookup.table, lookup.schema ?? 'main')
          .map(row => ({ ...column(String(row.name), lookup.table), hidden: row.hidden === 1 }));
        return { entries, incomplete: false, stamp: '1:0' };
      }) };
      const result = await sqliteCompletionSuggestions(analysis, directory);
      expect(result.incomplete).toBe(false);
      expect(result.items.map(item => item.insertText)).toEqual(['"label:1"']);
      expect(directory.load).toHaveBeenCalledExactlyOnceWith({ kind: 'columns', table: 'subject', schema: 'main', prefix: '' });
      const completed = source.slice(0, analysis.target.start) + result.items[0].insertText + source.slice(analysis.target.end);
      expect(db.prepare(completed).all().map(row => row['label:1'])).toEqual(expected);
    }
  } finally { db.close(); }
});

it('动态局部列参与裸星号和连接组，未投影的外层来源不读目录', async () => {
  const prefix = 'WITH c AS (SELECT s.* FROM base s) ';
  const d = directory([]);
  d.load.mockImplementation(async lookup => {
    if (lookup.kind !== 'columns') throw Error('预期来源列');
    const names = lookup.table === 'base' ? ['id', 'label'] : ['id', 'note'];
    return { entries: names.map(name => column(name, lookup.table)), incomplete: false, stamp: '1:0' };
  });
  const analyze = (sql: string) => {
    const marked = prefix + sql, value = analyzeSqliteCompletion(marked.replace('|', ''), marked.indexOf('|'));
    if (value.status !== 'ready') throw Error(value.reason);
    return value;
  };
  const output = await sqliteCompletionSuggestions(analyze('SELECT * FROM c JOIN side USING(id) UNION ALL SELECT 0,0,0 ORDER BY |'), d);
  expect(output.items.map(item => item.label)).toEqual(['id', 'label', 'note']);
  d.load.mockClear();
  const group = await sqliteCompletionSuggestions(analyze('SELECT grp."id:|suffix" FROM unrelated JOIN (c JOIN side ON 1) grp ON 1'), d);
  expect(group.items.map(item => item.label)).toEqual(['id:1']);
  expect(d.load.mock.calls).toEqual([[{ kind: 'columns', table: 'base', prefix: '' }], [{ kind: 'columns', table: 'side', prefix: '' }]]);
});

it('局部目录部分可知时保留普通 USING 的已证实项，外连接保留消歧门槛', async () => {
  const prefix = 'WITH c AS (SELECT *, id+1 FROM base) SELECT 1 FROM c ';
  const d = directory([column('id')]);
  const analyze = (operator: string) => {
    const marked = prefix + operator + ' peer USING(i|d)', value = analyzeSqliteCompletion(marked.replace('|', ''), marked.indexOf('|'));
    if (value.status !== 'ready') throw Error(value.reason);
    return value;
  };
  const inner = await sqliteCompletionSuggestions(analyze('JOIN'), d);
  expect(inner.items.map(item => item.label)).toEqual(['id']);
  expect(inner.incomplete).toBe(true);
  expect(await sqliteCompletionSuggestions(analyze('FULL JOIN'), d)).toEqual({ items: [], incomplete: true });
});

it('局部来源没有可展开列时，复合排序保留其他分支并提示部分结果', async () => {
  const marked = 'WITH c AS (SELECT * FROM missing) SELECT c.* FROM c UNION ALL SELECT 1 AS known ORDER BY |';
  const analysis = analyzeSqliteCompletion(marked.replace('|', ''), marked.indexOf('|'));
  if (analysis.status !== 'ready') throw Error(analysis.reason);
  const result = await sqliteCompletionSuggestions(analysis, directory([]));
  expect(result.items.map(item => item.label)).toEqual(['known']);
  expect(result.incomplete).toBe(true);
});
it('UNION ALL 的右分支只读取自己的物理表目录', async () => {
  const marked = 'SELECT s.name FROM main.first s UNION ALL SELECT s.na|suffix FROM temp.second s';
  const result = analyzeSqliteCompletion(marked.replace('|', ''), marked.indexOf('|'));
  if (result.status !== 'ready') throw Error(result.reason);
  const d = directory([column('name', 'second', 'temp')]), candidates = await sqliteCompletionSuggestions(result, d);
  expect(d.load).toHaveBeenCalledExactlyOnceWith({ kind: 'columns', table: 'second', schema: 'temp', prefix: 'na' });
  expect(candidates.items.map(item => item.insertText)).toEqual(['"name"']);
});
it('复合排序补入后一分支的明确别名，SQLite 实际按该输出列排序', async () => {
  const marked = 'SELECT 2 AS id, 9 AS cost UNION ALL SELECT 1 AS item, 10 AS price ORDER BY pr|suffix DESC';
  const source = marked.replace('|', ''), analysis = analyzeSqliteCompletion(source, marked.indexOf('|'));
  if (analysis.status !== 'ready') throw Error(analysis.reason);
  const d = directory([]), { items } = await sqliteCompletionSuggestions(analysis, d);
  expect(d.load).not.toHaveBeenCalled();
  expect(items).toEqual([{ label: 'price', kind: 'column', insertText: '"price"', detail: '复合查询输出列' }]);
  const sql = source.slice(0, analysis.target.start) + items[0].insertText + source.slice(analysis.target.end);
  const db = new DatabaseSync(':memory:');
  try {
    expect(sql).toContain('ORDER BY "price" DESC');
    expect(db.prepare(sql).all()).toEqual([{ id: 1, cost: 10 }, { id: 2, cost: 9 }]);
  } finally { db.close(); }
});
it('星号排序只请求投影来源并按 SQLite 目录保留生成列，补入结果可直接执行', async () => {
  const marked = 'SELECT * FROM main.subject UNION ALL SELECT s.* FROM temp.subject s JOIN ignored i ON 1 ORDER BY sco|suffix DESC';
  const source = marked.replace('|', ''), analysis = analyzeSqliteCompletion(source, marked.indexOf('|'));
  if (analysis.status !== 'ready') throw Error(analysis.reason);
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE main.subject(id INTEGER, score INTEGER GENERATED ALWAYS AS (id * 2) STORED);
      CREATE TEMP TABLE subject(id INTEGER, amount INTEGER);
      CREATE TABLE ignored(score INTEGER);
      INSERT INTO main.subject VALUES(1);
      INSERT INTO temp.subject VALUES(2, 99);
      INSERT INTO ignored VALUES(0);`);
    const load = vi.fn(async (request: SqliteCompletionLookup) => {
      if (request.kind !== 'columns' || !request.schema) throw Error('预期有明确来源的列目录');
      const { table, schema, prefix } = request;
      const entries: SqliteCompletionEntry[] = db.prepare('SELECT name, type, hidden FROM pragma_table_xinfo(?, ?) WHERE substr(name,1,length(?)) = ? COLLATE NOCASE ORDER BY cid')
        .all(table, schema, prefix, prefix).map(row => ({ kind: 'column', name: String(row.name), declaredType: String(row.type),
          hidden: row.hidden === 1, generated: row.hidden === 2 || row.hidden === 3, table, schema }));
      return { entries, incomplete: false, stamp: '1:1' };
    });
    const { items } = await sqliteCompletionSuggestions(analysis, { load });
    expect(load.mock.calls).toEqual([[{ kind: 'columns', table: 'subject', schema: 'main', prefix: 'sco' }],
      [{ kind: 'columns', table: 'subject', schema: 'temp', prefix: 'sco' }]]);
    expect(items.map(item => item.insertText)).toEqual(['"score"']);
    const completed = source.slice(0, analysis.target.start) + items[0].insertText + source.slice(analysis.target.end);
    expect(db.prepare(completed).all()).toEqual([{ id: 2, score: 99 }, { id: 1, score: 2 }]);
  } finally { db.close(); }
});

it('复合排序排除隐藏列并按 SQLite 名称去重，保留目录不完整状态', async () => {
  const marked = 'SELECT * FROM main.subject UNION ALL SELECT id AS ID, visible FROM local_table ORDER BY |';
  const analysis = analyzeSqliteCompletion(marked.replace('|', ''), marked.indexOf('|'));
  if (analysis.status !== 'ready') throw Error(analysis.reason);
  const d = directory([column('id'), column('gen'), { ...column('hidden'), hidden: true }], true);
  const result = await sqliteCompletionSuggestions(analysis, d);
  expect(result.items.map(item => item.insertText)).toEqual(['"ID"', '"visible"', '"gen"']);
  expect(result.incomplete).toBe(true);
});

it.each([
  ['SELECT * FROM anchor z JOIN (a x JOIN b y USING(id)) ON 1', ['a', 'b', 'anchor']],
  ['SELECT y.* FROM anchor z JOIN (a x JOIN b y USING(id)) ON 1', ['a', 'b']],
  ['SELECT x.* FROM anchor z JOIN (a x JOIN b y USING(id)) AS g ON 1', ['a', 'b']],
  ['SELECT * FROM outer_keys r NATURAL JOIN (a x JOIN b y USING(id)) AS g', ['a', 'b', 'outer_keys']],
  ['SELECT * FROM outer_keys r JOIN (a x JOIN b y USING(id)) AS g USING ("k:2")', ['a', 'b', 'outer_keys']],
  ['SELECT * FROM outer_keys r RIGHT JOIN (a x JOIN b y USING(id)) AS g USING ("k:2")', ['a', 'b', 'outer_keys']],
  ['SELECT * FROM (a x JOIN anchor z ON 1) AS g', ['a', 'anchor']],
  ['SELECT z.* FROM (a x JOIN anchor z ON 1) AS g', ['a', 'anchor']],
  ['SELECT y.* FROM anchor z JOIN ((a x JOIN b y USING(id)) AS mid JOIN extra e ON 1) AS g ON 1', ['a', 'b', 'extra']],
] as const)('复合排序按原生 SQLite 的嵌套星号结果给出可执行列名：%s', async (branch, expectedReads) => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE a(id,k,"k:1",av); CREATE TABLE b(id,k,bv); CREATE TABLE anchor(ck,cv);
      CREATE TABLE outer_keys(id,"k:2",rv); CREATE TABLE extra(e);
      INSERT INTO a VALUES(1,10,20,30); INSERT INTO b VALUES(1,40,50); INSERT INTO anchor VALUES(0,60);
      INSERT INTO outer_keys VALUES(1,40,70); INSERT INTO extra VALUES(1);`);
    const native = db.prepare(branch).columns();
    const marked = `${branch} UNION ALL SELECT ${native.map(() => '0').join(',')} ORDER BY |`;
    const analysis = analyzeSqliteCompletion(marked.replace('|', ''), marked.indexOf('|'));
    if (analysis.status !== 'ready') throw Error(analysis.reason);
    const directory = { load: vi.fn(async (lookup: SqliteCompletionLookup) => {
      if (lookup.kind !== 'columns') throw Error('预期准确来源列');
      const entries = db.prepare('SELECT name,hidden FROM pragma_table_xinfo(?,?) ORDER BY cid').all(lookup.table, lookup.schema ?? 'main')
        .map(row => ({ ...column(String(row.name), lookup.table), hidden: row.hidden === 1 }));
      return { entries, incomplete: false, stamp: '1:0' };
    }) };
    const result = await sqliteCompletionSuggestions(analysis, directory);
    expect(result.incomplete).toBe(false);
    expect(result.items.map(item => item.label)).toEqual([...new Set(native.map(({ name }) => name))]);
    for (const item of result.items) expect(db.prepare(marked.replace('|', item.insertText)).all()).toHaveLength(2);
    expect(directory.load.mock.calls.map(([lookup]) => lookup.kind === 'columns' && [lookup.table, lookup.prefix]))
      .toEqual(expectedReads.map(table => [table, '']));
  } finally { db.close(); }
});

it('分支复用嵌套组全列缓存，命中重复列前缀时保留上一分支的明确别名', async () => {
  const marked = 'SELECT 0 AS "id:custom", y.* FROM anchor JOIN (a x JOIN b y USING(id)) UNION ALL SELECT 0, y.* FROM other JOIN (a x JOIN b y USING(id)) ORDER BY "id:|suffix"';
  const analysis = analyzeSqliteCompletion(marked.replace('|', ''), marked.indexOf('|'));
  if (analysis.status !== 'ready') throw Error(analysis.reason);
  const d = directory([column('id')]);
  const result = await sqliteCompletionSuggestions(analysis, d);
  expect(result.items.map(item => item.insertText)).toEqual(['"id:custom"', '"id:2"']);
  expect(d.load.mock.calls).toEqual([[{ kind: 'columns', table: 'a', prefix: '' }], [{ kind: 'columns', table: 'b', prefix: '' }]]);
});

it('单一嵌套来源的非法重复项只标记部分结果，不把组别名猜作表', async () => {
  const marked = 'SELECT y.* FROM (a x JOIN b y USING(id)) g UNION ALL SELECT 0 AS known ORDER BY |';
  const analysis = analyzeSqliteCompletion(marked.replace('|', ''), marked.indexOf('|'));
  if (analysis.status !== 'ready') throw Error(analysis.reason);
  const d = directory([column('id')]);
  const result = await sqliteCompletionSuggestions(analysis, d);
  expect(result.incomplete).toBe(true);
  expect(result.items.map(item => item.label)).toEqual(['known']);
});

it('外层 FULL JOIN 的星号触发组内重名歧义时保留已知投影并标记部分结果', async () => {
  const branch = 'SELECT * FROM (a x JOIN b y USING(id)) g FULL JOIN keys USING(k)';
  const marked = `${branch} UNION ALL SELECT 0 AS known ORDER BY |`;
  const analysis = analyzeSqliteCompletion(marked.replace('|', ''), marked.indexOf('|'));
  if (analysis.status !== 'ready') throw Error(analysis.reason);
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE a(id,k);CREATE TABLE b(id,k);CREATE TABLE keys(id,k)');
    expect(() => db.prepare(branch)).toThrow(/ambiguous/i);
    const d = directory([column('id'), column('k')]);
    const result = await sqliteCompletionSuggestions(analysis, d);
    expect(result.incomplete).toBe(true);
    expect(result.items.map(item => item.label)).toEqual(['known']);
  } finally { db.close(); }
});

it('USING 只补全两侧共有的未选列，按原范围插入后 SQLite 可执行复合连接', async () => {
  const marked = 'SELECT a.tag, b.note FROM main.a JOIN temp.b USING (id, "Na|suffix")';
  const source = marked.replace('|', ''), analysis = analyzeSqliteCompletion(source, marked.indexOf('|'));
  if (analysis.status !== 'ready') throw Error(analysis.reason);
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE main.a(id INTEGER, name TEXT, tag TEXT); CREATE TEMP TABLE b(ID INTEGER, Name TEXT, note TEXT);
      INSERT INTO a VALUES(1,'同名','合并'), (2,'不同','不匹配'); INSERT INTO b VALUES(1,'同名','结果'), (2,'其它','丢弃');`);
    const load = vi.fn(async (request: SqliteCompletionLookup) => {
      if (request.kind !== 'columns' || !request.schema) throw Error('预期明确的连接侧');
      const entries = db.prepare('SELECT name FROM pragma_table_xinfo(?, ?)').all(request.table, request.schema)
        .map(row => column(String(row.name), request.table, request.schema));
      return { entries, incomplete: false, stamp: '1:1' };
    });
    const { items } = await sqliteCompletionSuggestions(analysis, { load });
    expect(items.map(item => item.insertText)).toEqual(['"Name"']);
    expect(load.mock.calls).toEqual([[{ kind: 'columns', table: 'a', schema: 'main', prefix: 'Na' }],
      [{ kind: 'columns', table: 'b', schema: 'temp', prefix: 'Na' }]]);
    const sql = source.slice(0, analysis.target.start) + items[0].insertText + source.slice(analysis.target.end);
    expect(db.prepare(sql).all()).toEqual([{ tag: '合并', note: '结果' }]);
  } finally { db.close(); }
});

it.each(['JOIN', 'RIGHT JOIN', 'FULL JOIN'])('USING 处理 %s 的左侧同名列和早期显式合并', async operator => {
  const marked = `SELECT * FROM a JOIN b USING (id) ${operator} c USING (|)`;
  const analysis = analyzeSqliteCompletion(marked.replace('|', ''), marked.indexOf('|'));
  if (analysis.status !== 'ready') throw Error(analysis.reason);
  const d = directory([column('ID'), column('duplicated')]);
  const result = await sqliteCompletionSuggestions(analysis, d);
  const labels = result.items.map(item => item.label);
  expect(labels).toEqual(operator === 'JOIN' ? ['ID', 'duplicated'] : ['ID']);
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE a(id,duplicated); CREATE TABLE b(id,duplicated); CREATE TABLE c(id,duplicated)');
    for (const item of result.items) expect(() => db.prepare(marked.replace('|', item.insertText))).not.toThrow();
    if (operator !== 'JOIN') expect(() => db.prepare(marked.replace('|', 'duplicated'))).toThrow(/ambiguous/i);
  } finally { db.close(); }
});

it('同层后续 RIGHT JOIN 也启用消歧，但其列不进入当前 USING', async () => {
  const marked = 'SELECT * FROM a JOIN b ON 1 JOIN c USING (|) RIGHT JOIN d ON 1';
  const analysis = analyzeSqliteCompletion(marked.replace('|', ''), marked.indexOf('|'));
  if (analysis.status !== 'ready') throw Error(analysis.reason);
  const load = vi.fn(async (query: SqliteCompletionLookup): Promise<{ entries: SqliteCompletionEntry[]; incomplete: boolean; stamp: string }> => {
    if (query.kind !== 'columns') throw Error('预期列目录');
    const names = query.table === 'a' ? ['id', 'key'] : query.table === 'b' ? ['id'] : ['id', 'key'];
    return { entries: names.map(name => column(name, query.table)), incomplete: false, stamp: '1:0' };
  });
  const { items } = await sqliteCompletionSuggestions(analysis, { load });
  expect(items.map(item => item.label)).toEqual(['key']);
  expect(load.mock.calls.map(([query]) => query.kind === 'columns' && query.table)).toEqual(['a', 'b', 'c']);
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE a(id,key); CREATE TABLE b(id); CREATE TABLE c(id,key); CREATE TABLE d(id)');
    expect(() => db.prepare(marked.replace('|', items[0].insertText))).not.toThrow();
    expect(() => db.prepare(marked.replace('|', 'id'))).toThrow(/ambiguous/i);
  } finally { db.close(); }
});

it('USING 排除其它槽位的列，重复物理关系只读取一次，未知左侧保留部分状态', async () => {
  const marked = "SELECT * FROM main.subject a JOIN main.SUBJECT b ON 1 JOIN missing_function('[]') j ON 1 JOIN temp.subject c USING(ID, |)";
  const analysis = analyzeSqliteCompletion(marked.replace('|', ''), marked.indexOf('|'));
  if (analysis.status !== 'ready') throw Error(analysis.reason);
  const d = directory([column('id'), column('shared')]);
  d.load.mockImplementation(async query => query.kind === 'columns' && query.tableFunction
    ? { entries: [], incomplete: true, stamp: '1:0' } : { entries: [column('id'), column('shared')], incomplete: false, stamp: '1:0' });
  const result = await sqliteCompletionSuggestions(analysis, d);
  expect(d.load.mock.calls).toEqual([[{ kind: 'columns', table: 'subject', schema: 'main', prefix: '' }],
    [{ kind: 'columns', table: 'missing_function', tableFunction: true, prefix: '' }],
    [{ kind: 'columns', table: 'subject', schema: 'temp', prefix: '' }]]);
  expect(result.items.map(item => item.label)).toEqual(['shared']);
  expect(result.incomplete).toBe(true);
});

it.each([
  ['SELECT * FROM outer_table JOIN (a JOIN b USING(id)) USING (|)', ['id', 'id:1', 'id:2', 'k', 'k:1', 'k:2', 'ax', 'bx']],
  ['SELECT * FROM (a JOIN b USING(id)) g FULL JOIN outer_table USING (|)', ['id', 'id:1', 'id:2', 'k:1', 'k:2', 'ax', 'bx']],
  ['SELECT 1 FROM (a JOIN b USING(id)) g FULL JOIN outer_table USING (|)', ['id', 'id:1', 'id:2', 'k', 'k:1', 'k:2', 'ax', 'bx']],
  ['SELECT * FROM outer_table RIGHT JOIN (a JOIN b USING(id)) USING (|)', ['id', 'id:1', 'id:2', 'k:1', 'k:2', 'ax', 'bx']],
  ['SELECT * FROM outer_table JOIN (a NATURAL JOIN b) USING (|)', ['id', 'id:1', 'id:2', 'k', 'k:1', 'k:2', 'k:3', 'ax', 'bx']],
  ['SELECT * FROM outer_table JOIN ((a JOIN b USING(id)) g JOIN c ON 1) USING (|)', ['id', 'id:1', 'id:2', 'id:3', 'k', 'k:1', 'k:2', 'ax', 'bx', 'cx']],
  ['SELECT * FROM outer_table JOIN (a RIGHT JOIN b USING(id)) USING (|)', ['id', 'id:1', 'id:2', 'k', 'k:1', 'k:2', 'ax', 'bx']],
] as const)('原生 SQLite 裁决嵌套组 USING 的可引用字段：%s', async (marked, expected) => {
  const analysis = analyzeSqliteCompletion(marked.replace('|', ''), marked.indexOf('|'));
  if (analysis.status !== 'ready') throw Error(analysis.reason);
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE a(id,k,"k:1",ax); CREATE TABLE b(id,k,bx); CREATE TABLE c(id,cx);
      CREATE TABLE outer_table(id,"id:1","id:2","id:3",k,"k:1","k:2","k:3",ax,bx,cx,unused);`);
    const directory = { load: vi.fn(async (lookup: SqliteCompletionLookup) => {
      if (lookup.kind !== 'columns') throw Error('预期连接输入列');
      const entries = db.prepare('SELECT name, hidden FROM pragma_table_xinfo(?,?) ORDER BY cid').all(lookup.table, lookup.schema ?? 'main')
        .filter(row => String(row.name).startsWith(lookup.prefix)).map(row => ({ ...column(String(row.name), lookup.table), hidden: row.hidden === 1 }));
      return { entries, incomplete: false, stamp: '1:0' };
    }) };
    const { items, incomplete } = await sqliteCompletionSuggestions(analysis, directory);
    const labels = items.map(item => item.label).sort();
    const native = ['id', 'id:1', 'id:2', 'id:3', 'k', 'k:1', 'k:2', 'k:3', 'ax', 'bx', 'cx', 'unused'].filter(name => {
      try { db.prepare(marked.replace('|', '"' + name + '"')); return true; } catch { return false; }
    });
    expect(incomplete).toBe(false);
    expect(native.sort()).toEqual([...expected].sort());
    expect(labels).toEqual(native.sort());
  } finally { db.close(); }
});

it('分组后缀在过滤前推导，已选项去重，同一目录仅完整读取一次', async () => {
  const marked = 'SELECT * FROM keys JOIN (source a JOIN source b ON 1 JOIN source c ON 1) USING ("id:1", "id:|suffix")';
  const analysis = analyzeSqliteCompletion(marked.replace('|', ''), marked.indexOf('|'));
  if (analysis.status !== 'ready') throw Error(analysis.reason);
  const d = directory([]);
  d.load.mockImplementation(async query => ({ entries: query.kind === 'columns' && query.table === 'source'
    ? [column('id', 'source')] : [column('id:1', 'keys'), column('id:2', 'keys')], incomplete: false, stamp: '1:0' }));
  const result = await sqliteCompletionSuggestions(analysis, d);
  expect(d.load.mock.calls).toEqual([[{ kind: 'columns', table: 'source', prefix: '' }], [{ kind: 'columns', table: 'keys', prefix: 'id:' }]]);
  expect(result.incomplete).toBe(false);
  expect(result.items.map(item => item.insertText)).toEqual(['"id:2"']);
});

it('随机重名后缀、行号别名和不完整的成员目录不会伪造候选', async () => {
  const marked = 'SELECT * FROM keys JOIN (a JOIN b JOIN c JOIN d JOIN e JOIN f) USING (|)';
  const analysis = analyzeSqliteCompletion(marked.replace('|', ''), marked.indexOf('|'));
  if (analysis.status !== 'ready') throw Error(analysis.reason);
  const d = directory([]);
  d.load.mockImplementation(async lookup => {
    if (lookup.kind !== 'columns') throw Error('预期连接输入列');
    const names = lookup.table === 'keys' ? ['id:4', 'id:5', '_rowid_', 'stable'] : lookup.table === 'a' ? ['id', 'stable'] : ['id'];
    return { entries: names.map(name => column(name, lookup.table)), incomplete: false, stamp: '1:0' };
  });
  const result = await sqliteCompletionSuggestions(analysis, d);
  expect(result.incomplete).toBe(true);
  expect(result.items.map(item => item.label)).toEqual(['stable', 'id:4']);
  const load = d.load.getMockImplementation()!;
  d.load.mockImplementation(async lookup => ({ ...await load(lookup), incomplete: lookup.kind === 'columns' && lookup.table === 'b' }));
  expect(await sqliteCompletionSuggestions(analysis, d)).toEqual({ items: [], incomplete: true });
});

it('表值函数只发送名称和前缀，接受字段后 SQLite 查询可执行', async () => {
  const marked = "SELECT j.va|suffix FROM main.json_each('[3,7]') j ORDER BY j.key";
  const source = marked.replace('|', ''), analysis = analyzeSqliteCompletion(source, marked.indexOf('|'));
  if (analysis.status !== 'ready') throw Error(analysis.reason);
  const d = directory([column('value', 'json_each')]);
  const { items } = await sqliteCompletionSuggestions(analysis, d);
  expect(d.load).toHaveBeenCalledExactlyOnceWith({ kind: 'columns', table: 'json_each', schema: 'main', prefix: 'va', tableFunction: true });
  expect(items).toMatchObject([{ insertText: '"value"', detail: expect.stringContaining('表值函数') }]);
  const sql = source.slice(0, analysis.target.start) + items[0].insertText + source.slice(analysis.target.end);
  const db = new DatabaseSync(':memory:');
  try { expect(db.prepare(sql).all()).toEqual([{ value: 3 }, { value: 7 }]); }
  finally { db.close(); }
});
it('嵌套连接组在外侧只补投影列，接受表值函数字段后 SQLite 查询可执行', async () => {
  const marked = "SELECT j.| FROM anchor a JOIN (document d JOIN json_each(d.payload) j ON 1) ON 1 ORDER BY j.key";
  const source = marked.replace('|', ''), analysis = analyzeSqliteCompletion(source, marked.indexOf('|'));
  if (analysis.status !== 'ready') throw Error(analysis.reason);
  const d = directory([column('value', 'json_each'), { ...column('json', 'json_each'), hidden: true }]);
  const { items } = await sqliteCompletionSuggestions(analysis, d);
  expect(d.load).toHaveBeenCalledExactlyOnceWith({ kind: 'columns', table: 'json_each', prefix: '', tableFunction: true });
  expect(items.map(item => item.insertText)).toEqual(['"value"']);
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE anchor(id); INSERT INTO anchor VALUES(1); CREATE TABLE document(payload); INSERT INTO document VALUES('[3,7]');`);
    expect(db.prepare(marked.replace('|', items[0].insertText)).all()).toEqual([{ value: 3 }, { value: 7 }]);
    expect(() => db.prepare(marked.replace('|', 'json'))).toThrow(/no such column/i);
  } finally { db.close(); }
});
it('组别名从真实成员推导输出，稳定重名按引用范围插入且不会读组名目录', async () => {
  const marked = 'SELECT "组🚢"."va|suffix" FROM (main.a x JOIN temp.b y USING(id)) AS "组🚢" JOIN (other c JOIN unused d) n ON 1';
  const source = marked.replace('|', ''), analysis = analyzeSqliteCompletion(source, marked.indexOf('|'));
  if (analysis.status !== 'ready') throw Error(analysis.reason);
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE a(id, value TEXT,"value:1" TEXT); INSERT INTO a VALUES(1,'A','A1');
      CREATE TEMP TABLE b(id,value INTEGER); INSERT INTO b VALUES(1,42);
      CREATE TABLE other(id); INSERT INTO other VALUES(1); CREATE TABLE unused(id); INSERT INTO unused VALUES(1);`);
    const directory = { load: vi.fn(async (lookup: SqliteCompletionLookup) => {
      if (lookup.kind !== 'columns' || !lookup.schema) throw Error('预期准确成员来源');
      const entries = db.prepare('SELECT name,type FROM pragma_table_xinfo(?,?) ORDER BY cid').all(lookup.table, lookup.schema)
        .map(row => ({ ...column(String(row.name), lookup.table, lookup.schema), declaredType: String(row.type) }));
      return { entries, incomplete: false, stamp: '1:1' };
    }) };
    const result = await sqliteCompletionSuggestions(analysis, directory);
    expect(result.incomplete).toBe(false);
    expect(result.items.map(item => item.label)).toEqual(['value', 'value:1', 'value:2']);
    expect(directory.load.mock.calls).toEqual([[{ kind: 'columns', table: 'a', schema: 'main', prefix: '' }], [{ kind: 'columns', table: 'b', schema: 'temp', prefix: '' }]]);
    const selected = result.items[2];
    expect(selected.detail).toContain('INTEGER');
    const sql = source.slice(0, analysis.target.start) + selected.insertText + source.slice(analysis.target.end);
    expect(db.prepare(sql).all()).toEqual([{ 'value:2': 42 }]);
  } finally { db.close(); }
});
it('组别名作为触发候选；明确的匿名派生列无需为派生表发出目录查询', async () => {
  const marked = 'SELECT grp| FROM ((SELECT 1 AS local) JOIN other o) grp';
  const source = marked.replace('|', ''), analysis = analyzeSqliteCompletion(source, marked.indexOf('|'));
  if (analysis.status !== 'ready') throw Error(analysis.reason);
  const d = directory([column('id', 'other')]);
  expect((await sqliteCompletionSuggestions(analysis, d)).items).toEqual([{ label: 'grp', kind: 'alias', insertText: '"grp".', detail: '连接组输出列', trigger: true }]);
  const qualified = analyzeSqliteCompletion(source.replace('grp FROM', 'grp. FROM'), marked.indexOf('|') + 1);
  if (qualified.status !== 'ready') throw Error(qualified.reason);
  d.load.mockClear();
  expect((await sqliteCompletionSuggestions(qualified, d)).items.map(item => item.label)).toEqual(['local', 'id']);
  expect(d.load).toHaveBeenCalledExactlyOnceWith({ kind: 'columns', table: 'other', prefix: '' });
});
it('准确别名字段只替最后标识符，Unicode引号和片段语法保持普通文本', async () => {
  const d = directory([column('字段"🚢.${x}')]), result = await sqliteCompletionSuggestions(ready(), d);
  expect(d.load).toHaveBeenCalledExactlyOnceWith({ kind: 'columns', table: 'subject', prefix: '' }); expect(result.items[0]).toMatchObject({ label: '字段"🚢.${x}', insertText: '"字段""🚢.${x}"', kind: 'column' });
});
it('表达式用各自别名限定同名列，优先级不把两表id错误去重', async () => {
  const result = await sqliteCompletionSuggestions(ready({ qualifiers: [], relations: [{ kind: 'physical', name: 'subject', alias: 'a' }, { kind: 'physical', name: 'subject', alias: 'b' }] }), directory([column('id')]));
  expect(result.items.filter(i => i.kind === 'column').map(i => i.insertText)).toEqual(['"a"."id"', '"b"."id"']); expect(result.items.filter(i => i.kind === 'alias').map(i => i.label)).toEqual(['a', 'b']);
});
it('INSERT列清单与SET左侧不插入非法table.column', async () => {
  const result = await sqliteCompletionSuggestions(ready({ qualifiers: [], unqualifiedColumns: true }), directory([column('name')])); expect(result.items[0].insertText).toBe('"name"');
});
it('ASCII别名折叠正确，明确main表不借同名temp绑定或别名', async () => {
  const d = directory([column('main_marker')]); await sqliteCompletionSuggestions(ready({ qualifiers: ['MAIN', 'SUBJECT'], relations: [{ kind: 'physical', name: 'subject', schema: 'main' }] }), d); expect(d.load).toHaveBeenCalledWith({ kind: 'columns', table: 'subject', schema: 'main', prefix: '' });
  const other = directory([column('wrong')]); expect((await sqliteCompletionSuggestions(ready({ qualifiers: ['subject'] }), other)).items).toEqual([]); expect(other.load).not.toHaveBeenCalled();
});
it('局部CTE声明遮蔽永久关系，未FROM声明不会泄成字段', async () => {
  const relations: Ready['relations'] = [{ kind: 'local', source: 'cte', name: 'subject', columns: ['local_column'], declaration: true }];
  const d = directory([{ name: 'subject', kind: 'table', schema: 'main' }, { name: 'other', kind: 'view', schema: 'main' }]);
  const result = await sqliteCompletionSuggestions(ready({ syntax: ['relation'], qualifiers: [], relations }), d);
  expect(result.items.find(i => i.label === 'subject')?.detail).toBe('公共表表达式'); expect(result.items.filter(i => i.label === 'subject')).toHaveLength(1);
  const columns = directory([column('leak')]); expect((await sqliteCompletionSuggestions(ready({ qualifiers: [], relations }), columns)).items).toEqual([]); expect(columns.load).not.toHaveBeenCalled();
});
it('显式main限定不受CTE同名遮蔽；未知schema不请求目录', async () => {
  const relation: Ready['relations'] = [{ kind: 'local', source: 'cte', name: 'subject', columns: [], declaration: true }], d = directory([{ name: 'subject', kind: 'table', schema: 'main' }]);
  const result = await sqliteCompletionSuggestions(ready({ syntax: ['relation'], qualifiers: ['main'], relations: relation }), d); expect(result.items).toHaveLength(1); expect(result.items[0].detail).toContain('SQLite 表');
  d.load.mockClear(); expect((await sqliteCompletionSuggestions(ready({ syntax: ['relation'], qualifiers: ['other'] }), d)).items).toEqual([]); expect(d.load).not.toHaveBeenCalled();
});
it('已FROM的CTE／派生输出直接用已分析列，不请求同名永久表', async () => {
  const d = directory([column('leak')]), result = await sqliteCompletionSuggestions(ready({ qualifiers: ['C'], relations: [{ kind: 'local', source: 'cte', name: 'c', columns: ['local_🚢'] }] }), d);
  expect(result.items[0].insertText).toBe('"local_🚢"'); expect(d.load).not.toHaveBeenCalled();
});
it('歧义别名不猜其中一张表；名称中的点不被拆成schema', async () => {
  const d = directory([column('wrong')]); const result = await sqliteCompletionSuggestions(ready({ relations: [{ kind: 'physical', name: 'a', alias: 's' }, { kind: 'physical', name: 'b', alias: 'S' }] }), d); expect(result.items).toEqual([]); expect(result.incomplete).toBe(true); expect(d.load).not.toHaveBeenCalled();
  await sqliteCompletionSuggestions(ready({ relations: [{ kind: 'physical', name: 'a.b', alias: 's' }] }), d); expect(d.load).toHaveBeenCalledWith({ kind: 'columns', table: 'a.b', prefix: '' });
});
it('目录不完整传播，前缀只折ASCII；生成／隐藏列有准确说明', async () => {
  const result = await sqliteCompletionSuggestions(ready({ target: { start: 0, end: 2, prefix: 'a', quoted: false } }), directory([{ ...column('A_列'), generated: true, hidden: true }, column('Ä')], true)); expect(result.items).toHaveLength(1); expect(result.items[0].detail).toContain('生成列'); expect(result.items[0].detail).toContain('隐藏列'); expect(result.incomplete).toBe(true);
});
it('最多256项建议不截断标识符，更多结果明确incomplete；quoted不混关键字', async () => {
  const d = directory(Array.from({ length: 256 }, (_, i) => column('field_' + i))), result = await sqliteCompletionSuggestions(ready({ qualifiers: [], syntax: ['column', 'keyword'] }), d); expect(result.items).toHaveLength(256); expect(result.incomplete).toBe(true);
  const quoted = await sqliteCompletionSuggestions(ready({ syntax: ['keyword'], target: { start: 0, end: 1, prefix: '', quoted: true } }), directory([])); expect(quoted.items).toEqual([]);
});
it('窗口函数和聚合筛选位置提供SQLite关键字补全', async () => {
  const result = await sqliteCompletionSuggestions(ready({ qualifiers: [], syntax: ['keyword'], target: { start: 0, end: 0, prefix: 'w', quoted: false } }), directory([]));
  expect(result.items.map(item => item.label)).toContain('WINDOW');
  const frame = await sqliteCompletionSuggestions(ready({ qualifiers: [], syntax: ['keyword'], target: { start: 0, end: 0, prefix: 'pre', quoted: false } }), directory([]));
  expect(frame.items.map(item => item.label)).toContain('PRECEDING');
  const filter = await sqliteCompletionSuggestions(ready({ qualifiers: [], syntax: ['keyword'], target: { start: 0, end: 0, prefix: 'fil', quoted: false } }), directory([]));
  expect(filter.items.map(item => item.label)).toContain('FILTER');
});
