import { expect, it } from 'vitest';
import { mysqlViewRenameSql } from '../../src/shared/mysqlViewRename';
import { validateCommand } from '../../src/shared/validation';

it('固定同库单条改名 SQL，双写目标中的反引号', () => {
  const target = { connectionId: 'c', database: '库.名', name: '原`视图', newName: '新`视图' };
  expect(mysqlViewRenameSql(target)).toBe('RENAME TABLE `库.名`.`原``视图` TO `库.名`.`新``视图`;');
  for (const input of [{ ...target, newName: target.name }, { ...target, sql: 'DROP VIEW v' }])
    expect(() => validateCommand('mysql.view.renamePreview', input)).toThrow();
});

it('确认只接受单次令牌和明确同意，客户端不能附带目标或 SQL', () => {
  const input = { token: '0550f54a-5fc9-4447-a835-fd56f9e9a17f', confirmed: true };
  expect(validateCommand('mysql.view.renameApply', input)).toEqual(input);
  for (const invalid of [{ ...input, confirmed: false }, { ...input, stamp: 'forged' }, { ...input, newName: '另一个' }])
    expect(() => validateCommand('mysql.view.renameApply', invalid)).toThrow();
});
