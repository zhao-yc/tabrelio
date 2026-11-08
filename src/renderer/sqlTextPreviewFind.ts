import { sqlSyntaxBoundary } from '../shared/sqlSyntaxCheck';

/** 只查找下一处原文位置，不为长脚本建立命中数组，也不切开 CRLF 或代理对。 */
export function findSqlPreviewMatch(sql: string, needle: string, previous: number | null | undefined, backward: boolean): number | null {
  if (!needle || /[\uD800-\uDFFF]/u.test(needle)) return null;
  const edge = backward ? sql.length : 0;
  const step = backward ? -1 : 1;
  const scan = (from: number): number => {
    while (from >= 0 && from <= sql.length) {
      const start = backward ? sql.lastIndexOf(needle, from) : sql.indexOf(needle, from);
      if (start < 0 || (sqlSyntaxBoundary(sql, start) && sqlSyntaxBoundary(sql, start + needle.length))) return start;
      from = start + step;
    }
    return -1;
  };
  const next = scan(previous == null ? edge : previous + step);
  const match = next < 0 && previous != null ? scan(edge) : next;
  return match < 0 ? null : match;
}
