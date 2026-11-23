import { DatabaseSync } from 'node:sqlite';
import { expect, it, vi } from 'vitest';
import { sqliteCompletionSuggestions } from '../../src/renderer/sqliteCompletionSuggestions';
import { analyzeSqliteCompletion, sqliteReferenceContext, validateSqliteCompletionAnalysis } from '../../src/shared/sqliteCompletionAnalysis';
import { analyzeSqliteLocalReferences } from '../../src/shared/sqliteLocalReferences';
import { analyzeSqliteLocalRename } from '../../src/shared/sqliteLocalRename';
import { validLocalRename } from '../../src/shared/localRename';

function input(marked: string) { return { source: marked.replace('|', ''), offset: marked.indexOf('|') }; }

function ready(marked: string) {
  const { source, offset } = input(marked), result = analyzeSqliteCompletion(source, offset);
  if (result.status !== 'ready') throw Error(result.reason);
  expect(validateSqliteCompletionAnalysis(result, source, offset)).toEqual(result);
  return result;
}

it('裸 OVER 包含有帧窗口，括号继承按 PARTITION、ORDER 和帧限制筛选', () => {
  const sql = 'SELECT row_number() OVER % FROM subject WINDOW parts AS (PARTITION BY category), ordered AS (parts ORDER BY id), framed AS (ordered ROWS BETWEEN 1 PRECEDING AND CURRENT ROW)';
  for (const [slot, names, inline] of [
    ['|', ['parts', 'ordered', 'framed'], undefined],
    ['(|)', ['parts', 'ordered'], true],
    ['(| ORDER BY id)', ['parts'], true],
    ['(| PARTITION BY category)', [], true],
    ['(| ROWS 1 PRECEDING)', ['parts', 'ordered'], true],
  ] as const) {
    const result = ready(sql.replace('%', slot));
    expect(result.windowNames?.names.map(item => item.name)).toEqual(names);
    expect(result.windowNames?.inline).toBe(inline);
    expect(result.relations).toEqual([]);
  }
  expect(ready('SELECT row_number() OVER (|) FROM subject WINDOW base AS (ORDER BY t.rows DESC)').windowNames?.names).toEqual([{ name: 'base' }]);
  expect(ready('SELECT row_number() OVER (|) FROM subject WINDOW base AS (ORDER BY id+rows+following)').windowNames?.names).toEqual([{ name: 'base' }]);
  expect(ready('SELECT row_number() OVER (|) FROM subject WINDOW base AS (ORDER BY id ROWS (1+0) PRECEDING)').windowNames?.names).toEqual([]);
});

it('窗口定义只能补此前可继承的名称，当前名称和后续名称不参与', () => {
  const sql = 'SELECT row_number() OVER child FROM subject WINDOW base AS (PARTITION BY category), child AS (ba|se ORDER BY id), later AS ()';
  expect(ready(sql).windowNames).toEqual({ names: [{ name: 'base' }], inline: true });
  expect(ready(sql.replace('ba|se', '|')).windowNames?.names).toEqual([{ name: 'base' }]);
  expect(ready('SELECT row_number() OVER | FROM subject WINDOW child AS (later), later AS ()').windowNames?.names).toEqual([{ name: 'later' }]);
});

it.each([
  'SELECT (SELECT row_number() OVER par|ent) FROM subject WINDOW parent AS (ORDER BY id)',
  'WITH c AS (SELECT row_number() OVER par|ent) SELECT row_number() OVER parent FROM c WINDOW parent AS ()',
  'SELECT row_number() OVER oth|er UNION ALL SELECT row_number() OVER other FROM subject WINDOW other AS ()',
])('独立 SELECT 不查父查询、CTE 外部或兄弟分支的声明：%s', marked => {
  expect(ready(marked).windowNames).toEqual({ names: [] });
});

it.each([
  'SELECT row_number() OVER t.ba|se FROM subject t WINDOW base AS ()',
  'SELECT row_number() OVER (t.ba|se) FROM subject t WINDOW base AS ()',
  'SELECT row_number() OVER ba|se.tail FROM subject WINDOW base AS ()',
  'SELECT 1 FROM subject WHERE row_number() OVER ba|se > 1 WINDOW base AS ()',
  'SELECT row_number() OVER (ORDER BY row_number() OVER ba|se) FROM subject WINDOW base AS ()',
  'SELECT sum(1) FILTER (WHERE row_number() OVER ba|se > 1) OVER base FROM subject WINDOW base AS ()',
  'SELECT row_number() OVER ba|se FROM subject WINDOW base AS (), BASE AS ()',
  'SELECT 1 FROM subject WINDOW first AS (), sec|ond AS ()',
])('歧义或无效的窗口名称位置不回退到字段目录：%s', marked => {
  const { source, offset } = input(marked);
  expect(analyzeSqliteCompletion(source, offset)).toMatchObject({ status: 'blocked' });
});

it('窗口内分区、排序继续提供真实字段，开头保留窗口子句关键词', async () => {
  const order = ready('SELECT row_number() OVER (base ORDER BY s.i|d) FROM subject s WINDOW base AS (PARTITION BY s.category)');
  expect(order.windowNames).toBeUndefined();
  expect(order.relations).toEqual([{ kind: 'physical', name: 'subject', alias: 's' }]);
  const d = { load: vi.fn() };
  const result = await sqliteCompletionSuggestions(ready('SELECT row_number() OVER (par|) FROM subject'), d);
  expect(result.items.map(item => item.insertText)).toEqual(['PARTITION BY']);
  expect(d.load).not.toHaveBeenCalled();
});

it('从实际候选补入 Unicode 窗口名、继承和原帧，原生 SQLite 返回预期值', async () => {
  const db = new DatabaseSync(':memory:');
  const d = { load: vi.fn() };
  try {
    db.exec('CREATE TABLE subject(id, g); INSERT INTO subject VALUES (1,1),(2,1),(3,2)');
    for (const [marked, label, expected] of [
      ['SELECT id, sum(id) OVER "航""|窗🚢" AS n FROM subject WINDOW "航""窗🚢" AS (PARTITION BY g ORDER BY id ROWS 1 PRECEDING) ORDER BY id', '航"窗🚢', [1, 3, 3]],
      ['SELECT id, row_number() OVER (pa|rts ORDER BY id) AS n FROM subject WINDOW parts AS (PARTITION BY g) ORDER BY id', 'parts', [1, 2, 1]],
      ['SELECT id, row_number() OVER child AS n FROM subject WINDOW parts AS (PARTITION BY g), child AS (pa|rts ORDER BY id) ORDER BY id', 'parts', [1, 2, 1]],
    ] as const) {
      const { source } = input(marked), analysis = ready(marked);
      const { items, incomplete } = await sqliteCompletionSuggestions(analysis, d);
      expect(incomplete).toBe(false);
      const item = items.find(item => item.label === label);
      expect(item).toMatchObject({ kind: 'alias', detail: expect.stringContaining('命名窗口') });
      const sql = source.slice(0, analysis.target.start) + item!.insertText + source.slice(analysis.target.end);
      expect(db.prepare(sql).all().map(row => row.n)).toEqual(expected);
    }
    expect(d.load).not.toHaveBeenCalled();
  } finally { db.close(); }
});

it('同一显示名的方括号、双引号、反引号和未引用形式是独立窗口', async () => {
  const marked = 'SELECT row_number() OVER na|me WINDOW name AS (), [name] AS (), "name" AS (), `name` AS ()';
  const d = { load: vi.fn() }, { items } = await sqliteCompletionSuggestions(ready(marked), d);
  expect(items.map(item => item.insertText)).toEqual(['name', '[name]', '"name"', '`name`']);
  const { source, offset } = input('SELECT row_number() OVER [na|me] WINDOW name AS (), [name] AS ()');
  const start = source.indexOf('[name] AS');
  expect(analyzeSqliteCompletion(source, offset, 'definition')).toMatchObject({ status: 'ready', definition: { start, end: start + 6 } });
  const wrong = input('SELECT row_number() OVER "na|me" WINDOW name AS ()');
  expect(analyzeSqliteCompletion(wrong.source, wrong.offset, 'definition')).toMatchObject({ status: 'blocked' });
  expect(d.load).not.toHaveBeenCalled();
});

it('原生继承查询区分排序表达式中同名字段与真正的帧', async () => {
  const marked = `SELECT row_number() OVER (w|suffix) AS n
    FROM (SELECT id rows,id following FROM subject) p
    WINDOW [w] AS (ORDER BY rows+following), with_frame AS (ORDER BY rows ROWS 1 PRECEDING)
    ORDER BY rows`;
  const { source } = input(marked), analysis = ready(marked);
  const d = { load: vi.fn() }, { items } = await sqliteCompletionSuggestions(analysis, d);
  expect(items.map(item => item.insertText)).toEqual(['[w]']);
  expect(d.load).not.toHaveBeenCalled();
  const sql = source.slice(0, analysis.target.start) + items[0].insertText + source.slice(analysis.target.end);
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE subject(id INTEGER PRIMARY KEY); INSERT INTO subject VALUES(1),(2)');
    expect(db.prepare(sql).all().map(row => row.n)).toEqual([1, 2]);
  } finally { db.close(); }
});

it('导航、引用及 F2 编辑复用当前窗口声明，改名后 SQLite 保持结果', () => {
  const { source, offset } = input('SELECT id, row_number() OVER (pa|rts ORDER BY id) AS n, sum(id) OVER PARTS AS amount FROM subject WINDOW parts AS (PARTITION BY g), child AS (parts ORDER BY id) ORDER BY id');
  const definition = analyzeSqliteCompletion(source, offset, 'definition');
  expect(definition).toMatchObject({ status: 'ready', definition: { start: source.indexOf('parts AS'), end: source.indexOf('parts AS') + 5 }, relations: [] });
  expect(validateSqliteCompletionAnalysis(definition, source, offset, 'definition')).toEqual(definition);
  const references = analyzeSqliteLocalReferences(source, offset);
  expect(references).toMatchObject({ status: 'ready', references: [expect.anything(), expect.anything(), expect.anything()] });
  const rename = analyzeSqliteLocalRename(source, offset, '新"窗🚢');
  expect(rename).toMatchObject({ status: 'ready', kind: 'window', edits: Array(4).fill(expect.objectContaining({ text: '"新""窗🚢"' })) });
  expect(validLocalRename(rename, sqliteReferenceContext(source, offset), 'sqlite', '新"窗🚢')).toBe(true);
  expect(validLocalRename(rename, sqliteReferenceContext(source, offset), 'mysql', '新"窗🚢')).toBe(false);
  expect(analyzeSqliteLocalRename(source, offset, 'child')).toEqual({ status: 'blocked', reason: 'collision' });
  if (rename.status !== 'ready') throw Error(rename.reason);
  const updated = [...rename.edits].reverse().reduce((text, { start, end, text: name }) => text.slice(0, start) + name + text.slice(end), source);
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE subject(id, g); INSERT INTO subject VALUES (1,1),(2,1),(3,2)');
    expect(db.prepare(updated).all()).toEqual(db.prepare(source).all());
  } finally { db.close(); }
});

it('同名物理字段或内层窗口不作为外层引用，F2 停在无法确认的同名词', () => {
  const { source, offset } = input('SELECT row_number() OVER ou|ter_name, outer_name, (SELECT row_number() OVER outer_name WINDOW outer_name AS ()) FROM subject WINDOW outer_name AS ()');
  const references = analyzeSqliteLocalReferences(source, offset);
  expect(references).toMatchObject({ status: 'ready', references: [expect.anything()] });
  expect(analyzeSqliteLocalRename(source, offset, 'different')).toEqual({ status: 'blocked', reason: 'unresolved' });
});

it('窗口候选回包禁止附带目录绑定、错误前缀或越出窗口位置类别', () => {
  const marked = 'SELECT row_number() OVER pa|rts FROM subject WINDOW parts AS ()', { source, offset } = input(marked), value = ready(marked);
  for (const patch of [
    { syntax: ['column'] }, { relations: [{ kind: 'physical', name: 'subject' }] },
    { windowNames: { names: [{ name: 'extra' }] } }, { windowNames: { names: [{ name: 'pa]', quote: '[' }] } },
    { windowNames: { names: [{ name: 'parts' }, { name: 'PARTS' }] } },
  ]) {
    expect(() => validateSqliteCompletionAnalysis({ ...value, ...patch }, source, offset)).toThrow();
  }
});
