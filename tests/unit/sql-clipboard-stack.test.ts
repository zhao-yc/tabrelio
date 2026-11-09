import { expect, it } from 'vitest';
import { SqlClipboardStack, sqlClipboardLimits } from '../../src/renderer/sqlClipboardStack';

it('只保留最近的有界文本，去重不改 SQL、换行和 Unicode', () => {
  const stack = new SqlClipboardStack();
  const sql = "SELECT '船🚢';\r\n";
  stack.remember(sql);
  stack.remember('SELECT 2');
  stack.remember(sql);
  const captured = stack.snapshot();
  expect(captured).toEqual([sql, 'SELECT 2']);
  stack.remember('');
  stack.remember('x'.repeat(sqlClipboardLimits.entryUnits + 1));
  expect(stack.snapshot()).toEqual(captured);
  for (let i = 0; i < 20; i++) stack.remember(String(i));
  expect(stack.snapshot()).toEqual(Array.from({ length: 12 }, (_, i) => String(19 - i)));
  for (let i = 0; i < 6; i++) stack.remember(String(i).repeat(sqlClipboardLimits.entryUnits));
  expect(stack.snapshot().map(item => item[0])).toEqual(['5', '4', '3', '2']);
  stack.clear();
  expect(stack.snapshot()).toEqual([]);
  expect(captured).toEqual([sql, 'SELECT 2']);
});
