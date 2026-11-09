import type { CellValue, ResultExportData } from './contracts';
import { EXCEL_LIMITS, excelWorksheetNames } from './excelTransfer';
import { resultExportColumns, validateResultArchive, validateResultExportData, type ResultArchiveEntry, type ResultArchiveOptions } from './resultExport';
import { resultExcelZh as text } from './resultExcel.zh-CN';
import { binaryCellFileBytes } from './binaryCellFiles';

export const resultExcelProtocol = 'dbark-v1' as const;
const encoder = new TextEncoder();

/** 校验原标量和协议额外字符；不把孤立代理项或控制字符静默删除、替换或截断。 */
function validateText(value: string, overhead = 0): void {
  if (value.length + overhead > EXCEL_LIMITS.maxCellCharacters) throw Error(text.length);
  for (const character of value) {
    const point = character.codePointAt(0)!;
    if (point < 32 && point !== 9 && point !== 10 && point !== 13 || point >= 0xd800 && point <= 0xdfff || point === 0xfffe || point === 0xffff) throw Error(text.characters);
  }
}
/** 只量算dbark-v1输出长度，不复制既有engine编码器；实际编码仍由encodeExcelCell执行。 */
function cellBytes(value: CellValue): number {
  if (value === null) return 2;
  if (typeof value === 'boolean') return value ? 4 : 5;
  if (typeof value === 'object') {
    validateText(value.base64, 3);
    try { binaryCellFileBytes(value.base64); } catch { throw Error(text.binaryInvalid); }
    return value.base64.length + 3;
  }
  const raw = typeof value === 'number' && Object.is(value, -0) ? '-0' : String(value), escape = raw.startsWith('\\') ? 1 : 0;
  validateText(raw, escape); return encoder.encode(raw).byteLength + escape;
}
/** UI与IPC同用的完整预检；沿用原结果预算，并在创建文件前拒绝任何Excel额外限制。 */
export function assertResultExcelData(value: unknown): asserts value is ResultExportData {
  validateResultExportData(value);
  validateResultExcelCells(value);
}

function validateResultExcelCells(value: ResultExportData): void {
  const columns = resultExportColumns(value.columns);
  let headerBytes = 0;
  for (const column of columns) { validateText(column.exportName); headerBytes += encoder.encode(column.exportName).byteLength; }
  if (headerBytes > EXCEL_LIMITS.maxRowBytes) throw Error(text.rowBytes);
  for (const row of value.rows) {
    let bytes = 0;
    for (const column of columns) { bytes += cellBytes(row[column.key]); if (bytes > EXCEL_LIMITS.maxRowBytes) throw Error(text.rowBytes); }
  }
}

export const resultArchiveIndexHeaders = ['原结果序号', '原结果名称', '工作表', '行数', '已截断'] as const;
export const resultArchiveExcelMaxSets = EXCEL_LIMITS.maxSheets - 1;

/** 将清单页加入同一命名空间，保留原名称供清单对照。 */
export function resultArchiveSheetNames(entries: readonly ResultArchiveEntry[]): string[] {
  return excelWorksheetNames(['结果清单', ...entries.map(entry => entry.label ?? `结果 ${entry.sourceOrdinal}`)]);
}

/** CSV ZIP 继续兼容原请求；XLSX 先验证整份工作簿和每张工作表，再选择或打开文件。 */
export function validateResultArchiveOptions(input: Pick<ResultArchiveOptions, 'format' | 'encoding' | 'csvDelimiter' | 'entries'>): number {
  if (input.format !== undefined && input.format !== 'zip' && input.format !== 'xlsx') throw Error('已返回结果包格式无效');
  const rows = validateResultArchive(input.entries);
  if (input.format === 'xlsx') {
    if (input.encoding !== 'utf8') throw Error(text.utf8Only);
    if (Object.hasOwn(input, 'csvDelimiter')) throw Error(text.invalid);
    if (input.entries.length > resultArchiveExcelMaxSets) throw Error(`Excel 工作簿最多导出 ${resultArchiveExcelMaxSets} 个结果集，另含一张结果清单`);
    for (const entry of input.entries) validateResultExcelCells(entry.result);
    // 清单记录原名称，Excel 字符限制同样适用于这张表。
    for (const entry of input.entries) if (entry.label) validateText(entry.label);
  }
  return rows;
}
