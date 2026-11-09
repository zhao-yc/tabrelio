import type { CellValue } from './contracts';

/** CSV 导出仅开放三个单字符；省略参数与显式逗号保持原输出字节。 */
export const csvExportDelimiters = [',', ';', '\t'] as const;
export type CsvExportDelimiter = typeof csvExportDelimiters[number];

/** 在文件创建和读取表数据前校验，不让内部调用绕过IPC后扩展解析规则。 */
export function csvExportDelimiter(format: string, delimiter?: CsvExportDelimiter): CsvExportDelimiter {
  if (delimiter !== undefined && (format !== 'csv' || !csvExportDelimiters.includes(delimiter))) throw new Error('分隔符仅适用于CSV导出，且必须为逗号、分号或Tab');
  return delimiter ?? ',';
}

/** 旧默认调用不新增字段；其他格式从不夹带隐藏的CSV状态。 */
export function csvExportOptions(format: string, delimiter: CsvExportDelimiter): { csvDelimiter?: CsvExportDelimiter } {
  return format === 'csv' && delimiter !== ',' ? { csvDelimiter: delimiter } : {};
}

/** CSV 中 \\N 表示 NULL，反斜线开头的文本以额外反斜线转义，保持往返无歧义。 */
export function csvCell(value: CellValue, delimiter: CsvExportDelimiter = ','): string {
  return csvHeader(delimitedCellText(value), delimiter);
}

/** CSV 与 TXT 共用可逆的 NULL、二进制和前导反斜线表示。 */
export function delimitedCellText(value: CellValue): string {
  const text = value === null ? '\\N' : typeof value === 'object' ? 'base64:' + value.base64 : String(value);
  return value !== null && text.startsWith('\\') ? '\\' + text : text;
}
/** 标题行只执行 CSV 引号处理，不采用数据字段的 NULL/反斜线协议。 */
export function csvHeader(name: string, delimiter: CsvExportDelimiter = ','): string { return !name.length || /["\r\n]/.test(name) || name.includes(delimiter) ? '"' + name.replaceAll('"', '""') + '"' : name; }
