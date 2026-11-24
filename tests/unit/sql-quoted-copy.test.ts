import { expect, it } from 'vitest';
import { quoteSqlForCode, sqlQuotedCopyMaxUnits, sqlQuotedStatementText } from '../../src/renderer/sqlQuotedCopy';
import { analyzeStatementNavigation } from '../../src/shared/statementNavigation';

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

it('从真实语句目录提取原文，保留标准分号并剥离自定义客户端分隔符', () => {
  const statement = "select '🚢',\r\n  7";
  for (const {source, expected} of [
    {source: 'SELECT 1;\r\n' + statement + ';\r\nSELECT 3;', expected: statement + ';'},
    {source: 'SELECT 1;\nDELIMITER $$\n' + statement + '$$\nDELIMITER ;\nSELECT 3;', expected: statement},
  ]) {
    const result = analyzeStatementNavigation(source, 'mysql');
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw Error('本例未取得原语句目录');
    expect(sqlQuotedStatementText({source, range: result.statements[1]})).toBe(expected);
  }
  const source = 'x'.repeat(sqlQuotedCopyMaxUnits + 1);
  expect(() => sqlQuotedStatementText({source, range: {start: 0, end: source.length, delimiterStart: source.length, delimiterEnd: source.length}})).toThrow('上限');
});
