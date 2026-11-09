import type { CellValue, ResultExportData } from '../shared/contracts';
import { resultExportLimits, validateResultExportData } from '../shared/resultExport';
import { gridRangeExportZh as text } from './locales/gridRangeExport.zh-CN';
import type { GridRangeTarget } from './useGridCellRange';

/** 冻结准确可见行列的文件快照，沿用已有导出预算和类型校验。 */
export function snapshotGridRangeExport<Row>(target: GridRangeTarget<Row>, columns: ResultExportData['columns'],
  read: (row: Row, key: string) => CellValue | undefined, skip?: (row: Row) => boolean): ResultExportData {
  const source = target.rows.filter(row => !skip?.(row));
  if (!source.length || !target.keys.length) throw Error(text.empty);
  if (source.length > resultExportLimits.rows || target.keys.length > resultExportLimits.columns ||
      source.length * target.keys.length > resultExportLimits.cells) throw Error(text.limit);
  const metadata = new Map(columns.map(column => [column.key, column.name]));
  const visible = target.keys.map(key => {
    const name = metadata.get(key);
    if (name === undefined) throw Error(text.stale);
    return { key, name };
  });
  const rows = source.map(row => Object.fromEntries(visible.map(({ key }) => {
    const value = read(row, key);
    if (value === undefined) throw Error(text.missing);
    return [key, value];
  })));
  const result = { columns: visible, rows, truncated: false };
  validateResultExportData(result);
  return structuredClone(result);
}
