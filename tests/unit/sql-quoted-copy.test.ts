import { expect, it } from 'vitest';
import { quoteSqlForCode, sqlQuotedCopyMaxUnits } from '../../src/renderer/sqlQuotedCopy';

it('保留 SQL 引号、反斜杠、行尾、控制字符和 Unicode', () => {
  const sql = "SELECT '船🚢', \"id\", '\\u000a';\r\n\t\u0000\u007f\u2028\ud800";
  const javascript = quoteSqlForCode(sql, 'javascript');
  expect(JSON.parse(javascript)).toBe(sql);
  expect(javascript).toContain('\\\\u000a');
  expect(javascript).toContain('\\r\\n\\t\\u0000\\u007f\\u2028\\ud800');
  expect(quoteSqlForCode(sql, 'java')).toBe(javascript);
  expect(quoteSqlForCode(sql, 'python')).toBe(String.raw`'SELECT \'船🚢\', "id", \'\\u000a\';\r\n\t\u0000\u007f\u2028\ud800'`);
});

it('允许边界内完整选区，超出时拒绝而不截断', () => {
  const limit = '列'.repeat(sqlQuotedCopyMaxUnits);
  expect(quoteSqlForCode(limit, 'java')).toBe('"' + limit + '"');
  expect(() => quoteSqlForCode(limit + '列', 'javascript')).toThrow('上限');
});
