import { describe, expect, it } from 'vitest';
import type { SqliteTablePage } from '../../src/shared/sqliteTableBrowse';
import { collectSqliteCheckedExport } from '../../src/renderer/sqliteCheckedExport';

function fixture(offset: number): SqliteTablePage {
  return {
    schemaKey: 'a'.repeat(64), target: { connectionId: 'local', database: 'main', table: 'records', kind: 'table' },
    columns: [{ name: 'id', declaredType: 'INTEGER' }, { name: 'data', declaredType: 'BLOB' }],
    result: {
      columns: [{ key: 'id', name: 'id', type: 'INTEGER' }, { key: 'data', name: 'data', type: 'BLOB' }],
      rows: [{ id: '9223372036854775807', data: { type: 'binary', base64: 'AAE=' } }, { id: String(offset + 2), data: null }],
      statement: '', elapsedMs: 0, truncated: false,
    },
    offset, limit: 2, hasMore: true,
  };
}

describe('SQLite 跨页勾选导出', () => {
  it('按页偏移和页内位置输出独立快照，重收与移除同页不会改写旧快照', () => {
    const scope = {}, first = fixture(0), second = fixture(2);
    const late = collectSqliteCheckedExport(scope, undefined, second, second.result.columns, new Set([1]))!;
    const both = collectSqliteCheckedExport(scope, late, first, first.result.columns, new Set([1, 0]))!;
    expect(both.result.rows.map(row => row.id)).toEqual(['9223372036854775807', '2', '4']);
    first.result.rows[0].data = '变化';
    expect(both.result.rows[0].data).toEqual({ type: 'binary', base64: 'AAE=' });
    const replaced = collectSqliteCheckedExport(scope, both, first, first.result.columns, new Set([1]))!;
    expect(replaced.result.rows.map(row => row.id)).toEqual(['2', '4']);
    expect(both.result.rows).toHaveLength(3);
    const removed = collectSqliteCheckedExport(scope, replaced, second, second.result.columns, new Set())!;
    expect(removed.result.rows).toEqual([{ id: '2', data: null }]);
    expect(collectSqliteCheckedExport(scope, removed, first, first.result.columns, new Set())).toBeUndefined();
  });

  it('按可见列顺序收集并拒绝来源变化、越界选择和无效字段', () => {
    const scope = {}, first = fixture(0), second = fixture(2), columns = [first.result.columns[1]];
    const current = collectSqliteCheckedExport(scope, undefined, first, columns, new Set([0]))!;
    expect(current.result.rows).toEqual([{ data: { type: 'binary', base64: 'AAE=' } }]);
    expect(() => collectSqliteCheckedExport({}, current, first, columns, new Set([0]))).toThrow();
    expect(() => collectSqliteCheckedExport(scope, current, second, second.result.columns, new Set([0]))).toThrow();
    expect(() => collectSqliteCheckedExport(scope, current, first, columns, new Set([2]))).toThrow();
    first.result.rows[0].data = 'a'.repeat(256 * 1024 + 1);
    expect(() => collectSqliteCheckedExport(scope, current, first, columns, new Set([0]))).toThrow();
    expect(current.result.rows).toEqual([{ data: { type: 'binary', base64: 'AAE=' } }]);
  });
});
