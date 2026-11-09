import { expect, it, vi } from 'vitest';
import { readGridCellRange } from '../../src/renderer/useGridCellRange';

it('按可见列顺序读取完整行区间，排除待删除行', () => {
  const rows = [{ id: 1, text: '甲' }, { id: 2, text: '待删除' }, { id: 3, text: null }];
  const keys = ['text', 'id'] as const;
  expect(readGridCellRange({ top: 0, bottom: 2, left: 0, right: 1 }, rows, keys,
    (row, key) => row[key], row => row.id === 2)).toEqual({ columns: keys, values: [['甲', 1], [null, 3]] });
});

it('矩形超出剪贴板格数预算时不读取任何原值', () => {
  const read = vi.fn();
  expect(() => readGridCellRange({ top: 0, bottom: 500, left: 0, right: 99 },
    Array.from({ length: 501 }, (_, row) => row), Array.from({ length: 100 }, (_, column) => column), read)).toThrow();
  expect(read).not.toHaveBeenCalled();
});
