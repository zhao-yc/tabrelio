import { expect, it, vi } from 'vitest';
import { readGridCellRange } from '../../src/renderer/useGridCellRange';
import { gridRangeIntegerSequence } from '../../src/renderer/gridRangeFill';
import { gridRangeFillZh } from '../../src/renderer/locales/gridRangeFill.zh-CN';

it('整数序列使用精确端点和非零步长，拒绝格式错误及越界', () => {
  const input = { kind: 'sequence', value: '18446744073709551615', step: '-2' } as const;
  const valueAt = gridRangeIntegerSequence(input, 3, 64, true);
  expect([valueAt(0), valueAt(1), valueAt(2)]).toEqual(['18446744073709551615', '18446744073709551613', '18446744073709551611']);
  expect(() => gridRangeIntegerSequence(input, 2)).toThrow(gridRangeFillZh.sequenceOverflow);
  expect(() => gridRangeIntegerSequence({ ...input, value: '-128', step: '-1' }, 2, 8)).toThrow(gridRangeFillZh.sequenceOverflow);
  expect(() => gridRangeIntegerSequence({ ...input, value: '0', step: '-1' }, 2, 8, true)).toThrow(gridRangeFillZh.sequenceOverflow);
  for (const step of ['', '0', '1.0', '1e3', '0x2'])
    expect(() => gridRangeIntegerSequence({ ...input, step }, 2)).toThrow(gridRangeFillZh.sequenceInput);
});

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
