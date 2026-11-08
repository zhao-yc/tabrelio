import type { SqliteValue } from '../engine/sqlite/protocol';
import { sqliteDataCompareZh as text } from '../shared/sqliteDataCompare';

/** 不混淆空值、缺行、文本和原生数值。二进制显示为原始 Base64。 */
export function displaySqliteCompareValue(value: SqliteValue | undefined): string {
  if (value === undefined) return text.absent;
  if (value === null) return 'NULL';
  if (typeof value === 'string') return 'TEXT ' + JSON.stringify(value);
  if (value.type === 'binary') return 'BLOB Base64 ' + value.base64;
  return (value.type === 'integer' ? 'INTEGER ' : 'REAL ') + value.value;
}

export function sqliteCompareKeyLabel(key: SqliteValue[]): string {
  const value = key.map(displaySqliteCompareValue).join(' / ');
  return value.length <= 200 ? value : value.slice(0, 200) + '…';
}
