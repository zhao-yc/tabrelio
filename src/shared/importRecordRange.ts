import { z } from 'zod';

const recordIndex = z.number().int().positive();
export const importRecordRangeFields = {
  headerRow: recordIndex.max(Number.MAX_SAFE_INTEGER - 1).optional(),
  firstDataRow: recordIndex.optional(),
  lastDataRow: recordIndex.optional(),
};
export const importRecordRangeSchema = z.object(importRecordRangeFields).strict();
export type ImportRecordRange = z.infer<typeof importRecordRangeSchema>;

/** 未设置时沿用首条表头及随后的数据，结束记录包含在范围内。 */
export function importRecordRange(hasHeader: boolean, range?: ImportRecordRange) {
  const headerRow = hasHeader ? range?.headerRow ?? 1 : 0;
  const firstDataRow = range?.firstDataRow ?? headerRow + 1;
  const lastDataRow = range?.lastDataRow ?? Infinity;
  return { headerRow, firstDataRow, lastDataRow,
    skipsRecords: headerRow > 1 || firstDataRow > headerRow + 1 || lastDataRow < Infinity };
}

export function validImportRecordRange(hasHeader: boolean, range?: ImportRecordRange): boolean {
  const { headerRow, firstDataRow, lastDataRow } = importRecordRange(hasHeader, range);
  return (hasHeader || range?.headerRow === undefined) && headerRow < firstDataRow && firstDataRow <= lastDataRow;
}

export const importRecordRangeZh = {
  headerRow: '字段名记录号', firstDataRow: '首条数据记录号', lastDataRow: '最后数据记录号',
  throughEnd: '默认读到文件末尾',
  rangeHint: '记录从 1 开始计数，包含最后一条。空白记录计数，限定符内的换行属于同一条记录。',
} as const;
