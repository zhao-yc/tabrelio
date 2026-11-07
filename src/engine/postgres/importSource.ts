import type { PostgresCopySource } from './copyImportFile';
import type { PostgresRecordImportSource } from './recordImportFile';

export type PostgresImportFile = PostgresCopySource | PostgresRecordImportSource;
export interface PostgresImportBatch { header: string[]; files: PostgresImportFile[] }
export type PostgresImportSource = PostgresImportFile | PostgresImportBatch;

/** 返回当前文件各列在共用目录中的位置。有空名或重复名的原生 CSV 必须保持列序。 */
export function postgresImportColumnOrder(header: readonly string[], current: readonly string[]): number[] | undefined {
  if (header.length !== current.length) return;
  if (header.every((name, index) => name === current[index])) return header.map((_, index) => index);
  const lookup = new Map(header.map((name, index) => [name, index]));
  if (lookup.has('') || lookup.size !== header.length || new Set(current).size !== current.length) return;
  const order = current.map(name => lookup.get(name));
  if (order.some(index => index === undefined)) return;
  return order as number[];
}

export function postgresImportFileRecords(source: PostgresImportFile): number | undefined {
  return 'records' in source ? source.records : source.selection?.records;
}
