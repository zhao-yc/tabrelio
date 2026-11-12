import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { tableCellKeyIsComposing } from './tableCellKeyboard';

export interface GridRecordActions<Row> {
  add?(): void;
  remove?: { allowed(row: Row): boolean; run(row: Row): void };
}

type RecordKey = 'add' | 'remove';
type RecordKeyboardEvent = Pick<ReactKeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey' |
  'repeat' | 'defaultPrevented' | 'preventDefault' | 'stopPropagation'> & {
  nativeEvent: Parameters<typeof tableCellKeyIsComposing>[0];
  isGridDefaultPrevented?(): boolean;
  preventGridDefault?(): void;
};

/** 仅调用已核对焦点及记录的动作，长按只消费原快捷键，避免反复新增或删除。 */
export function handleGridRecordKey(event: RecordKeyboardEvent,
  resolve: (key: RecordKey) => (() => void) | undefined): boolean {
  if (event.defaultPrevented || event.ctrlKey === event.metaKey || event.altKey ||
      tableCellKeyIsComposing(event.nativeEvent) || event.isGridDefaultPrevented?.()) return false;
  const add = event.shiftKey && event.key.toLowerCase() === 'i';
  const remove = !event.shiftKey && (event.key === 'Delete' || event.metaKey && event.key === 'Backspace');
  if (!add && !remove) return false;
  const run = resolve(add ? 'add' : 'remove');
  if (!run) return false;
  event.preventDefault();
  event.stopPropagation();
  event.preventGridDefault?.();
  if (!event.repeat) run();
  return true;
}
