import { resultInsertExactTextType } from '../shared/resultInsert';
import { sqliteTableImportAffinity } from '../shared/sqliteTableImport';
import type { ColumnInfo } from '../shared/contracts';
import type { PostgresTableColumn } from '../shared/postgresTable';
import type { SqliteEditColumn } from '../shared/sqliteTableEdit';

export type GridQuickValue = 'null' | 'empty';

/** 只接收已确认的字段类型，避免空字符串被数字、JSON 或二进制转换规则改写。 */
export function mysqlQuickValueAllowed(column: ColumnInfo, kind: GridQuickValue): boolean {
  return !column.generated && (kind === 'null' ? column.nullable : resultInsertExactTextType(column.type));
}
export function postgresQuickValueAllowed(column: PostgresTableColumn, kind: GridQuickValue): boolean {
  return !column.generated && (kind === 'null' ? column.nullable :
    !column.binary && /^(?:text|character varying(?:\(\d+\))?)$/.test(column.type));
}
export function sqliteQuickValueAllowed(column: SqliteEditColumn, strict: boolean, kind: GridQuickValue): boolean {
  if (column.generated) return false;
  if (kind === 'null') return column.nullable && !column.primary;
  // 无声明的普通字段和 STRICT ANY 能保留 TEXT，STRICT BLOB 不能。
  return sqliteTableImportAffinity(column.declaredType, strict) === 'text' ||
    (strict ? column.declaredType.toUpperCase() === 'ANY' : column.declaredType === '');
}
