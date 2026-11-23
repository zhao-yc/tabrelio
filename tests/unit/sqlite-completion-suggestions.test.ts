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
