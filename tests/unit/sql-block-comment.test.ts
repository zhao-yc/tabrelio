import { expect, it } from 'vitest';
import { toggleSqlBlockComment as toggle } from '../../src/renderer/sqlBlockComment';

it.each(['mysql', 'mariadb', 'sqlite', 'postgresql'] as const)('%s 包裹再解除保持空白、换行和 Unicode', dialect => {
  const source = ' \tSELECT\r\n  \'🚢\';\t ';
  const wrapped = toggle(source, dialect);
  expect(wrapped).toBe('/* ' + source + ' */');
  expect(toggle(wrapped, dialect)).toBe(source);
  expect(() => toggle(' \r\n\t', dialect)).toThrow('非空');
});

it('仅解除完整的普通块，保留块外空白', () => {
  expect(toggle('  /* 内容 */\n', 'sqlite')).toBe('  内容\n');
  expect(() => toggle('/* a */ SELECT 1; /* b */', 'sqlite')).toThrow('不能安全包裹');
  expect(toggle('! SELECT 1', 'mysql')).toBe('/* ! SELECT 1 */');
});

it.each(['/*!50100 SELECT 1 */', '/*M! SELECT 1 */', '/*+ INDEX(t i) */'])('拒绝解除 MySQL 及 MariaDB 指令 %s', source => {
  for (const dialect of ['mysql', 'mariadb'] as const) expect(() => toggle(source, dialect)).toThrow('执行指令或优化提示');
});

it('仅 PostgreSQL 支持包裹已配对的内层分隔符，任何早闭合或未闭合均拒绝', () => {
  const source = 'SELECT 1; /* 已有注释 */';
  expect(toggle(toggle(source, 'postgresql'), 'postgresql')).toBe(source);
  for (const dialect of ['mysql', 'mariadb', 'sqlite'] as const) expect(() => toggle(source, dialect)).toThrow('不能安全包裹');
  for (const unsafe of ['SELECT \'*/\';', '/* 未结束', '*/ /*']) expect(() => toggle(unsafe, 'postgresql')).toThrow('不能安全包裹');
});
