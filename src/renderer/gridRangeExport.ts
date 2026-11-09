import type { CellValue, DataRow, QueryResult, ResultExportData } from '../shared/contracts';
import { resultExportLimits, validateResultExportData } from '../shared/resultExport';
import { copySqliteResultStorage } from '../shared/sqliteResultStorage';
import { gridRangeExportZh as text } from './locales/gridRangeExport.zh-CN';
import type { GridRangeTarget } from './useGridCellRange';

export type GridRangeExportData = ResultExportData & Pick<QueryResult, 'sqliteStorage'>;

/** 按原始列键及行位置取类型，避免隐藏列、冻结列或同名列导致类型错配。 */
export function gridRangeSqliteStorage(source: QueryResult | undefined, rows: DataRow[]) {
  const storage = source?.sqliteStorage;
  if (!source || source.rows !== rows || storage?.version !== 1 || storage.rows.length !== rows.length) return undefined;
  const positions = new Map(source.columns.map((column, index) => [column.key, index]));
  return (row: DataRow, key: string, index: number) => {
    const position = positions.get(key), codes = storage.rows[index];
    if (rows[index] === row && position !== undefined && codes?.length === source.columns.length) return codes[position];
  };
}

/** 冻结准确可见行列的文件快照，SQLite 类型缺失时仍保留其它文件格式。 */
export function snapshotGridRangeExport<Row>(target: GridRangeTarget<Row>, columns: ResultExportData['columns'],
  read: (row: Row, key: string) => CellValue | undefined, skip?: (row: Row) => boolean,
  readStorage?: (row: Row, key: string, index: number) => string | undefined): GridRangeExportData {
  const source: number[] = [];
  target.rows.forEach((row, index) => { if (!skip?.(row)) source.push(index); });
  if (!source.length || !target.keys.length) throw Error(text.empty);
  if (source.length > resultExportLimits.rows || target.keys.length > resultExportLimits.columns ||
      source.length * target.keys.length > resultExportLimits.cells) throw Error(text.limit);
  const metadata = new Map(columns.map(column => [column.key, column.name]));
  const visible = target.keys.map(key => {
    const name = metadata.get(key);
    if (name === undefined) throw Error(text.stale);
    return { key, name };
  });
  const rows = source.map(index => Object.fromEntries(visible.map(({ key }) => {
    const value = read(target.rows[index], key);
    if (value === undefined) throw Error(text.missing);
    return [key, value];
  })));
  const result: GridRangeExportData = { columns: visible, rows, truncated: false };
  validateResultExportData(result);
  if (readStorage) {
    try {
      const codes = source.map(index => visible.map(({ key }) => readStorage(target.rows[index], key, target.startRow + index)).join(''));
      result.sqliteStorage = copySqliteResultStorage({ version: 1, rows: codes },
        visible.map(column => ({ ...column, type: 'SQLITE' })), rows);
    } catch { /* 缺失、不匹配或超预算的类型不得用于 INSERT。 */ }
  }
  return structuredClone(result);
}
