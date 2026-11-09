import type { CellKeyboardEvent } from 'react-data-grid';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gridRowKeys, handleGridSelectAllKey, mergeGridMatchSelection } from '../../src/renderer/components/GridRowSelectionActions';

class DataCell {
  constructor(readonly role = 'gridcell', readonly isContentEditable = false) {}
  getAttribute() { return this.role; }
  closest() { return null; }
}

function key(overrides: Record<string, unknown> = {}) {
  return { key: ' ', shiftKey: true, ctrlKey: true, metaKey: false, altKey: false, keyCode: 32, target: new DataCell(),
    nativeEvent: { isComposing: false }, isGridDefaultPrevented: () => false,
    preventDefault: vi.fn(), preventGridDefault: vi.fn(), stopPropagation: vi.fn(), ...overrides } as unknown as CellKeyboardEvent;
}

describe('当前页网格勾选', () => {
  beforeEach(() => vi.stubGlobal('HTMLElement', DataCell));
  afterEach(() => vi.unstubAllGlobals());

  it('遍历整页并跳过待删除行，反选只排除当前勾选', () => {
    const rows = Array.from({ length: 100 }, (_, id) => ({ id, deleted: id === 1 }));
    const keyFor = (row: typeof rows[number]) => row.deleted ? undefined : row.id;
    const selected = gridRowKeys(rows, keyFor);
    expect([...selected]).toEqual(rows.filter(row => !row.deleted).map(row => row.id));
    expect([...gridRowKeys(rows, keyFor, new Set([0, 1, 2]))]).toEqual(rows.slice(3).map(row => row.id));
  });

  it('仅更新命中行并保留原勾选，重复命中和重复操作不会推进选择', () => {
    const selected = new Set([2]);
    const matches = [1, 1, 3];
    const next = mergeGridMatchSelection(selected, matches, true)!;
    expect(next).toEqual(new Set([1, 2, 3]));
    expect(selected).toEqual(new Set([2]));
    expect(mergeGridMatchSelection(next, matches, true)).toBeUndefined();
    expect(mergeGridMatchSelection(next, matches, false)).toEqual(selected);
    expect(mergeGridMatchSelection(selected, matches, false)).toBeUndefined();
  });

  it('只消费修饰键匹配的当前数据格，长按不重复修改', () => {
    const select = vi.fn(), current = vi.fn(() => true);
    for (const event of [key(), key({ ctrlKey: false, metaKey: true }), key({ repeat: true })]) {
      expect(handleGridSelectAllKey(event, current, select)).toBe(true);
      expect(event.preventGridDefault).toHaveBeenCalledOnce();
      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(event.stopPropagation).toHaveBeenCalledOnce();
    }
    expect(select).toHaveBeenCalledTimes(2);
    expect(handleGridSelectAllKey(key(), () => false, select)).toBe(false);
    expect(select).toHaveBeenCalledTimes(2);
  });

  it.each([{ key: 'A' }, { shiftKey: false }, { ctrlKey: false }, { altKey: true }, { metaKey: true }, { keyCode: 229 }, { nativeEvent: { isComposing: true } },
    { defaultPrevented: true }, { isGridDefaultPrevented: () => true }, { target: new DataCell('textbox') }, { target: new DataCell('gridcell', true) }])('保留原事件 %j', patch => {
    const event = key(patch), select = vi.fn();
    expect(handleGridSelectAllKey(event, () => true, select)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
  });
});
