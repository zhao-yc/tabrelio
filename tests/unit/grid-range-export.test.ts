import { expect, it, vi } from 'vitest';
import { snapshotGridRangeExport } from '../../src/renderer/gridRangeExport';
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
