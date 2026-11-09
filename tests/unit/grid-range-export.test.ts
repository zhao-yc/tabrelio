import { expect, it, vi } from 'vitest';
import { gridRangeSqliteStorage, snapshotGridRangeExport } from '../../src/renderer/gridRangeExport';
import { resultExportLimits } from '../../src/shared/resultExport';

it('只冻结选区中的可见列和保留行，原二进制变化不会修改已打开快照', () => {
  const payload = { type: 'binary' as const, base64: 'AP8=' };
  const rows = [{ id: '9223372036854775807', payload }, { id: '删除', payload }];
  const columns = [{ key: 'id', name: '编号' }, { key: 'payload', name: '字节' }, { key: 'hidden', name: '隐藏' }];
  const result = snapshotGridRangeExport({ startRow: 0, rows, keys: ['payload', 'id'] }, columns,
    (row, key) => row[key as 'payload' | 'id'], row => row.id === '删除');
  payload.base64 = 'AA==';
  expect(result.columns).toEqual([columns[1], columns[0]]);
  expect(result.rows).toEqual([{ payload: { type: 'binary', base64: 'AP8=' }, id: '9223372036854775807' }]);
});

it('拒绝尚未赋值的 DEFAULT 和超出上限的矩形', () => {
  const columns = [{ key: 'c', name: '列' }];
  expect(() => snapshotGridRangeExport({ startRow: 0, rows: [{}], keys: ['c'] }, columns, () => undefined)).toThrow(/DEFAULT/);
  const read = vi.fn();
  expect(() => snapshotGridRangeExport({ startRow: 0, rows: Array(resultExportLimits.rows + 1).fill({}), keys: ['c'] }, columns, read))
    .toThrow(/上限/);
  expect(read).not.toHaveBeenCalled();
});

it('SQLite 类型跟随原行位置及列键投影，跳过的行和重排的同名列不会串位', () => {
  const value = '9223372036854775807';
  const columns = ['a', 'b'].map(key => ({ key, name: '同名', type: 'SQLITE' }));
  const rows = Array.from({ length: 4 }, () => ({ a: value, b: value }));
  const source = { rows, columns, sqliteStorage: { version: 1 as const, rows: ['tt', 'it', 'tt', 'ti'] }, truncated: false, elapsedMs: 0, statement: '' };
  const result = snapshotGridRangeExport({ startRow: 1, rows: rows.slice(1), keys: ['b', 'a'] }, columns,
    (row, key) => row[key as 'a' | 'b'], row => row === rows[2], gridRangeSqliteStorage(source, rows));
  source.sqliteStorage.rows[1] = 'tt';
  expect(result.sqliteStorage?.rows).toEqual(['ti', 'it']);
  expect(result.rows).toEqual([{ b: value, a: value }, { b: value, a: value }]);
  expect(gridRangeSqliteStorage(source, [...rows])).toBeUndefined();
});

it('缺失或不匹配的 SQLite 类型不影响普通选区导出', () => {
  const columns = [{ key: 'a', name: '编号' }], rows = [{ a: '001' }];
  const target = { startRow: 0, rows, keys: ['a'] };
  expect(snapshotGridRangeExport(target, columns, row => row.a, undefined, () => 'i')).toEqual({ columns, rows, truncated: false });
});
