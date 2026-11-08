import { expect, it } from 'vitest';
import { postgresNewIdentifier } from '../../src/shared/postgresCreateTable';
import { duplicateNewTableColumn } from '../../src/renderer/newTableColumnCopy';

const postgresName = (name: string) => postgresNewIdentifier.safeParse(name).success;

it('把独立的字段副本插在原字段后，保留精确默认值及原字段身份', () => {
  const source = { name: 'amount', default: { value: '9007199254740993.0001' }, primary: true };
  const other = { ...source, name: 'amount_COPY' };
  const result = duplicateNewTableColumn([source, other], source, postgresName, { primary: false })!;
  expect(result.columns).toEqual([source, { ...source, name: 'amount_copy_2', primary: false }, other]);
  expect(result.columns[0]).toBe(source);
  expect(result.columns[2]).toBe(other);
  expect(result.copy.default).not.toBe(source.default);
  expect(source.primary).toBe(true);
});

it('按目标 UTF-8 字节数截取完整字符，空名也可复制，失效的原列不可复制', () => {
  const source = { name: '字段'.repeat(10) + '🚢' };
  const copy = duplicateNewTableColumn([source], source, postgresName)!.copy;
  expect(copy.name).toMatch(/_copy$/);
  expect(postgresName(copy.name)).toBe(true);
  expect(copy.name).not.toContain('�');
  const empty = { name: '' };
  expect(duplicateNewTableColumn([empty], empty, postgresName)?.copy.name).toBe('column_copy');
  expect(duplicateNewTableColumn([source], { ...source }, postgresName)).toBeUndefined();
});
