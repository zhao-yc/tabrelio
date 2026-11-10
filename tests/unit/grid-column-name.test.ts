import { expect, it } from 'vitest';
import { gridColumnName } from '../../src/renderer/gridColumnName';

it.each(['mysql', 'mariadb'] as const)('%s 把点号、空白和反引号作为一个列名处理', dialect => {
  expect(gridColumnName(' 别名.`列 ', dialect)).toEqual({ plain: ' 别名.`列 ', quoted: '` 别名.``列 `' });
});

it.each(['postgresql', 'sqlite'] as const)('%s 保留原 Unicode 并转义名称中的双引号', dialect => {
  expect(gridColumnName('分组."列" 🚢', dialect)).toEqual({ plain: '分组."列" 🚢', quoted: '"分组.""列"" 🚢"' });
});

it('未知方言或超出 MySQL 别名范围时只提供原名，空名或坏 Unicode 不写剪贴板', () => {
  expect(gridColumnName(' a.b\n')).toEqual({ plain: ' a.b\n' });
  expect(gridColumnName('含表情 🚢', 'mysql')).toEqual({ plain: '含表情 🚢' });
  expect(gridColumnName('x'.repeat(257), 'mysql')).toEqual({ plain: 'x'.repeat(257) });
  for (const name of ['', 'a\0b', '\ud800']) expect(gridColumnName(name, 'sqlite')).toBeUndefined();
});
