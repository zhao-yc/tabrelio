import { z } from 'zod';
import { importRecordRange, importRecordRangeFields, importRecordRangeZh, validImportRecordRange, type ImportRecordRange } from './importRecordRange';

export const txtRecordDelimiters = { lf: '\n', crlf: '\r\n', cr: '\r' } as const;
export const txtFieldDelimiter = z.string().min(1).max(16).refine(value => [...value].length <= 8 && !/[\u0000\r\n\ud800-\udfff]/u.test(value));
export const txtTextQualifier = z.enum(['double', 'single', 'none']);
const recordDelimiter = z.enum(['auto', 'lf', 'crlf', 'cr']);
const base = { recordDelimiter, hasHeader: z.boolean(), ...importRecordRangeFields };
export const txtImportMaxOptions = 8;

/** 保留旧配置的默认位置，结束记录包含在导入范围内。 */
export function txtImportRange(options: ImportRecordRange & { hasHeader: boolean }) {
  return importRecordRange(options.hasHeader, options);
}

export function txtFixedWidths(value: string): number[] {
  return value.split(',').map(part => Number(part.trim()));
}

export const txtImportOptionsSchema = z.discriminatedUnion('mode', [
  z.object({ ...base, mode: z.literal('delimited'),
    delimiter: txtFieldDelimiter, quote: txtTextQualifier,
  }).strict(),
  z.object({ ...base, mode: z.literal('fixed'), trimPadding: z.boolean(),
    widths: z.string().max(8192).regex(/^ *[1-9]\d{0,4}(?: *, *[1-9]\d{0,4})* *$/).refine(value => {
      const widths = txtFixedWidths(value);
      return widths.length <= 1000 && widths.reduce((sum, width) => sum + width, 0) <= 65536;
    }),
  }).strict(),
]).refine(value => value.mode !== 'delimited' || compatibleTxtQualifier(value))
  .refine(value => validImportRecordRange(value.hasHeader, value));
export type TxtImportOptions = z.infer<typeof txtImportOptionsSchema>;

export function txtQualifier(quote: z.infer<typeof txtTextQualifier>): string {
  return quote === 'single' ? "'" : quote === 'double' ? '"' : '';
}

export function compatibleTxtQualifier({ delimiter, quote }: { delimiter: string; quote: z.infer<typeof txtTextQualifier> }): boolean {
  return quote === 'none' || !delimiter.includes(txtQualifier(quote));
}

export const txtImportDefaults: TxtImportOptions = { mode: 'delimited', delimiter: '\t', quote: 'double', recordDelimiter: 'auto', hasHeader: false };
export const txtImportZh = {
  format: 'TXT 文本', layout: 'TXT 布局', delimited: '分隔文本', fixed: '固定宽度', delimiter: 'TXT 字段分隔符',
  custom: '自定义', tab: '制表符', comma: '逗号', semicolon: '分号', pipe: '竖线', space: '空格',
  quote: '文本限定符', double: '双引号', single: '单引号', none: '无',
  record: '记录换行', auto: '自动识别', hasHeader: 'TXT 包含字段名记录',
  ...importRecordRangeZh,
  widths: '固定列宽（逗号分隔）', trim: '去除字段两端填充空格',
  widthHint: '按 Unicode 字符计数。例如 4,8,12 表示三列，每条记录必须符合所填总宽度。',
  hint: '空字段保留为空字符串，\\N 表示 NULL。关闭表头时，按选中记录的列位置映射。',
  invalid: '请核对 TXT 布局、分隔符、固定列宽和记录范围',
  missingHeader: 'TXT 文件没有指定的字段名记录',
  invalidWidth: 'TXT 记录长度与固定列宽不符',
} as const;

export function validTxtImport(input: { format: string; txtOptions?: unknown }): boolean {
  return input.format === 'txt' ? txtImportOptionsSchema.safeParse(input.txtOptions).success : !Object.hasOwn(input, 'txtOptions');
}
