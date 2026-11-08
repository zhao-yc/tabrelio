import type { CellValue } from '../shared/contracts';
import { postgresDataCompareZh } from '../shared/postgresDataCompare';

export function displayServerCompareValue(value: CellValue | undefined, dialect: 'postgres' | 'mysql'): string {
  if (value === undefined) return postgresDataCompareZh.absent;
  if (value === null) return 'NULL';
  return typeof value === 'object' ? (dialect === 'postgres' ? 'BYTEA Base64 ' : '字节 Base64 ') + value.base64 : JSON.stringify(value);
}
