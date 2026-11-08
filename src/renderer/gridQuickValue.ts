import { resultInsertExactTextType } from '../shared/resultInsert';
import { sqliteTableImportAffinity } from '../shared/sqliteTableImport';
import type { ColumnInfo } from '../shared/contracts';
import type { PostgresTableColumn } from '../shared/postgresTable';
import type { SqliteEditColumn } from '../shared/sqliteTableEdit';
import { uid } from './lib';

export const gridQuickValueKinds = ['null', 'empty', 'uuid'] as const;
export type GridQuickValue = typeof gridQuickValueKinds[number];

/** 在原活动格验证通过后才生成，每次操作一个新的本地 UUID v4。 */
export function gridQuickValueAssignment(kind: GridQuickValue): string | null {
  if (kind === 'uuid') return uid();
  return kind === 'null' ? null : '';
}

/** 只接收已确认的字段类型，避免空字符串被数字、JSON 或二进制转换规则改写。 */
export function mysqlQuickValueAllowed(column: ColumnInfo, kind: GridQuickValue): boolean {
  if (column.generated) return false;
  if (kind === 'null') return column.nullable;
  if (kind === 'empty') return resultInsertExactTextType(column.type);
  const width = /^(?:char|varchar)\((\d+)\)$/i.exec(column.type);
  return width ? Number(width[1]) >= 36 : /^(?:uuid|tinytext|text|mediumtext|longtext)$/i.test(column.type);
}
export function postgresQuickValueAllowed(column: PostgresTableColumn, kind: GridQuickValue): boolean {
  if (column.generated) return false;
  if (kind === 'null') return column.nullable;
  if (column.binary) return false;
  if (kind === 'empty') return /^(?:text|character varying(?:\(\d+\))?)$/.test(column.type);
  const width = /^character varying\((\d+)\)$/.exec(column.type);
  return width ? Number(width[1]) >= 36 : /^(?:uuid|text|character varying|character\(36\))$/.test(column.type);
}
export function sqliteQuickValueAllowed(column: SqliteEditColumn, strict: boolean, kind: GridQuickValue): boolean {
  if (column.generated) return false;
  if (kind === 'null') return column.nullable && !column.primary;
  // 无声明的普通字段和 STRICT ANY 能保留 TEXT，STRICT BLOB 不能。
  return sqliteTableImportAffinity(column.declaredType, strict) === 'text' ||
    (strict ? column.declaredType.toUpperCase() === 'ANY' : column.declaredType === '');
}
