import { describe, expect, it } from 'vitest';
import { findSqlPreviewMatch } from '../../src/renderer/sqlTextPreviewFind';

describe('只读 SQL 预览正文定位', () => {
  it('按字面和大小写查找，双向循环并保留重叠位置', () => {
    const sql = 'aAaAa [Q?] [q?]';
    expect(findSqlPreviewMatch(sql, 'aAa', undefined, false)).toBe(0);
    expect(findSqlPreviewMatch(sql, 'aAa', 0, false)).toBe(2);
    expect(findSqlPreviewMatch(sql, 'aAa', 2, false)).toBe(0);
    expect(findSqlPreviewMatch(sql, 'aAa', 0, true)).toBe(2);
    expect(findSqlPreviewMatch(sql, 'aAa', 2, true)).toBe(0);
    expect(findSqlPreviewMatch(sql, '[Q?]', undefined, true)).toBe(6);
    expect(findSqlPreviewMatch(sql, '[Q*]', undefined, false)).toBeNull();
  });

  it('查找以原 UTF-16 偏移为准，跳过被切开的 CRLF 和代理对', () => {
    const prefix = 'x'.repeat(65535);
    const sql = prefix + 'K😀Y\r\n\n';
    expect(findSqlPreviewMatch(sql, 'K😀Y', undefined, false)).toBe(prefix.length);
    expect(findSqlPreviewMatch(sql, '\r\n', undefined, false)).toBe(prefix.length + 4);
    expect(findSqlPreviewMatch(sql, '\n', undefined, false)).toBe(prefix.length + 6);
    expect(findSqlPreviewMatch(sql, '\uDE00', undefined, false)).toBeNull();
    expect(findSqlPreviewMatch(sql, '', undefined, false)).toBeNull();
  });
});
