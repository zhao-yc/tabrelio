import { expect, it } from 'vitest';
import { tableFindFilterRule } from '../../src/renderer/tableFindFilter';

const text = { kind: 'text', query: '前%_🚢 ', caseSensitive: true, wholeCell: false };
it.each(['mysql', 'postgresql', 'sqlite'] as const)('%s 只转换语义明确的单列查找', dialect => {
  const column = { name: 'note', type: 'varchar(24)' };
  expect(tableFindFilterRule(text, column, dialect)).toEqual({ column: 'note', operator: 'CONTAINS', value: text.query });
  expect(tableFindFilterRule({ ...text, wholeCell: true }, column, dialect)?.operator).toBe('TEXT EQUALS');
  expect(tableFindFilterRule({ ...text, kind: 'empty' }, column, dialect)).toEqual({ column: 'note', operator: 'TEXT EQUALS', value: '' });
  expect(tableFindFilterRule({ ...text, kind: 'null' }, { name: 'id', type: 'int' }, dialect))
    .toEqual({ column: 'id', operator: 'IS NULL' });
  for (const patch of [{ kind: 'default' }, { regex: true }, { caseSensitive: false }, { query: '' }, { query: '\ud800' }]) {
    expect(tableFindFilterRule({ ...text, ...patch }, column, dialect)).toBeUndefined();
  }
  expect(tableFindFilterRule(text, undefined, dialect)).toBeUndefined();
  if (dialect !== 'sqlite') expect(tableFindFilterRule(text, { name: 'id', type: 'int' }, dialect)).toBeUndefined();
});
