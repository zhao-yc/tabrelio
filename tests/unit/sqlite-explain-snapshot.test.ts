import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import type { QueryOutcome, QueryResult } from '../../src/shared/contracts';
import { capturePlanSnapshot, decodePlanSnapshot, encodePlanSnapshot, parseExplainSnapshot, parsePlanSnapshot, planSnapshotOutcome } from '../../src/shared/explainSnapshot';
import { buildSqliteExplainPlan, sqliteExplainMessages } from '../../src/shared/sqliteExplain';

const names = ['id', 'parent', 'notused', 'detail'];
const secretSql = 'SELECT 原草稿不进入文件';
const result = (rows: QueryResult['rows'], truncated = false): QueryResult => ({
  columns: names.map(name => ({ name, key: name, type: 'SQLITE' })), rows, truncated, statement: secretSql, elapsedMs: 17,
});
const outcome = (original: QueryResult): QueryOutcome => ({ results: [original], elapsedMs: 23, transactionOpen: true,
  sqliteExplain: { ...buildSqliteExplainPlan(original, '3.53.0'), sourceRange: { start: 2, end: 5 } } });

it('SQLite 原生索引和子查询计划四列可离线往返，文件不带派生树或执行信息', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE subject(id INTEGER PRIMARY KEY, tag TEXT); CREATE INDEX tag_index ON subject(tag);');
    const stmt = db.prepare('EXPLAIN QUERY PLAN SELECT * FROM subject INDEXED BY tag_index WHERE tag IN (SELECT tag FROM subject WHERE id=1)');
    stmt.setReadBigInts(true);
    const original = result(stmt.all().map(row => ({ id: String(row.id), parent: String(row.parent), notused: String(row.notused), detail: String(row.detail) })));
    const live = outcome(original), snapshot = capturePlanSnapshot(live), bytes = encodePlanSnapshot(snapshot);
    expect(snapshot).toMatchObject({ kind: 'dbark.sqlite-explain-snapshot', version: 1, dialect: 'sqlite', format: 'eqp', serverVersion: '3.53.0' });
    expect(Object.keys(snapshot).sort()).toEqual(['dialect', 'format', 'kind', 'result', 'serverVersion', 'version', 'warnings']);
    expect(bytes).not.toContain(secretSql);
    expect(bytes).not.toMatch(/sourceRange|statement|sessionId|elapsedMs|transactionOpen/);
    const opened = decodePlanSnapshot(bytes), restored = planSnapshotOutcome(opened);
    expect(encodePlanSnapshot(opened)).toBe(bytes);
    expect(restored.results).toEqual([{ ...original, elapsedMs: 0, statement: '' }]);
    expect(restored.sqliteExplain?.nodes).toEqual(live.sqliteExplain?.nodes);
    expect(restored.sqliteExplain?.raw).toBe(live.sqliteExplain?.raw);
    expect(restored.sqliteExplain?.nodes.some(node => node.detail.includes('tag_index'))).toBe(true);
    expect(restored.sqliteExplain?.sourceRange).toBeUndefined();
    expect(restored.transactionOpen).toBeUndefined();
    expect(() => parseExplainSnapshot(opened)).toThrow();
  } finally { db.close(); }
});

it('离线保持大整数精度，截断或无效父关系只显示原表格及诊断', () => {
  const rows = [{ id: '9007199254740993', parent: '0', notused: '0', detail: 'SCAN 表🚢' },
    { id: '9007199254740994', parent: '9007199254740993', notused: '-4', detail: 'SEARCH 子表' }];
  const valid = planSnapshotOutcome(capturePlanSnapshot(outcome(result(rows))));
  expect(valid.sqliteExplain?.nodes[1]).toEqual({ id: '9007199254740994', parent: '9007199254740993', auxiliary: '-4', depth: 1, detail: 'SEARCH 子表' });
  for (const [original, warning] of [[result(rows, true), sqliteExplainMessages.truncated], [result([rows[1]]), sqliteExplainMessages.relation]] as const) {
    const captured = capturePlanSnapshot(outcome(original));
    const restored = planSnapshotOutcome({ ...captured, warnings: ['原文件提示'] });
    expect(restored.sqliteExplain).toMatchObject({ initialView: 'table', nodes: [], warnings: ['原文件提示', warning] });
    expect(restored.results[0].rows).toEqual(original.rows);
    expect(restored.results[0].truncated).toBe(original.truncated);
  }
});

it('由原始四列重新计算原文展示截断，保留每个完整单元格', () => {
  const rows = [{ id: '1', parent: '0', notused: '0', detail: 'a'.repeat(100000) },
    { id: '2', parent: '0', notused: '0', detail: 'b'.repeat(100000) }];
  const live = outcome(result(rows));
  expect(live.sqliteExplain?.rawTruncated).toBe(true);
  const restored = planSnapshotOutcome(decodePlanSnapshot(encodePlanSnapshot(capturePlanSnapshot(live))));
  expect(restored.sqliteExplain).toEqual({ ...live.sqliteExplain, sourceRange: undefined });
  expect(restored.results[0]).toMatchObject({ rows, truncated: false });
});

it('文件版本、列顺序、附加字段与预算分别核验', () => {
  const captured = capturePlanSnapshot(outcome(result([])));
  expect(() => parsePlanSnapshot({ ...captured, version: 2 })).toThrow();
  expect(() => parsePlanSnapshot({ ...captured, dialect: 'postgresql' })).toThrow();
  expect(() => parsePlanSnapshot({ ...captured, format: 'text' })).toThrow();
  expect(() => parsePlanSnapshot({ ...captured, nodes: [] })).toThrow();
  expect(() => parsePlanSnapshot({ ...captured, sourceRange: { start: 0, end: 20 } })).toThrow();
  expect(() => parsePlanSnapshot({ ...captured, result: { ...captured.result, columns: [...captured.result.columns].reverse() } })).toThrow();
  expect(() => capturePlanSnapshot(outcome(result([{ id: '1', parent: '0', notused: '0', detail: '🚢'.repeat(49153) }])))).toThrow(/预算/);
});
