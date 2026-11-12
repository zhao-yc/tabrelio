import { describe, expect, it, vi } from 'vitest';
import { handleGridRecordKey } from '../../src/renderer/gridRecordActions';

function keyEvent(overrides: object) {
  return {
    key: 'Delete', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, repeat: false,
    defaultPrevented: false, nativeEvent: {},
    preventDefault: vi.fn(), stopPropagation: vi.fn(), preventGridDefault: vi.fn(), isGridDefaultPrevented: () => false,
    ...overrides,
  };
}

describe('网格记录快捷键', () => {
  it.each([
    [{ key: 'I', shiftKey: true }, 'add'],
    [{ key: 'I', shiftKey: true, ctrlKey: false, metaKey: true }, 'add'],
    [{}, 'remove'],
    [{ key: 'Backspace', ctrlKey: false, metaKey: true }, 'remove'],
  ])('只派发已接纳的快捷键 %o', (input, kind) => {
    const event = keyEvent(input), run = vi.fn(), resolve = vi.fn(() => run);
    expect(handleGridRecordKey(event, resolve)).toBe(true);
    expect(resolve).toHaveBeenCalledExactlyOnceWith(kind);
    expect(run).toHaveBeenCalledOnce();
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.preventGridDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
  });

  it.each([
    { ctrlKey: false }, { metaKey: true }, { altKey: true }, { shiftKey: true },
    { key: 'Backspace' }, { key: 'n' }, { defaultPrevented: true },
    { nativeEvent: { isComposing: true } }, { nativeEvent: { keyCode: 229 } }, { isGridDefaultPrevented: () => true },
  ])('保留普通编辑、组合输入及其它命令 %o', input => {
    const event = keyEvent(input), resolve = vi.fn();
    expect(handleGridRecordKey(event, resolve)).toBe(false);
    expect(resolve).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('长按不重复执行，失效目标不消费按键', () => {
    const event = keyEvent({ repeat: true }), run = vi.fn();
    expect(handleGridRecordKey(event, () => run)).toBe(true);
    expect(run).not.toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalledOnce();
    const stale = keyEvent({});
    expect(handleGridRecordKey(stale, () => undefined)).toBe(false);
    expect(stale.preventDefault).not.toHaveBeenCalled();
  });
});
