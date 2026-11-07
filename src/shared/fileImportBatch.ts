import { z } from 'zod';
import { importFileSourceSchema } from './importNewTable';
import type { FileChoice } from './contracts';
import type { ExcelSheet } from './excelTransfer';

export const importBatchFormats = ['csv', 'txt', 'json', 'xml'] as const;
export const importBatchLimit = 16;
const id = z.string().min(1).max(200);
const name = z.string().min(1).max(512);
export const importBatchChooseSchema = z.object({
  connectionId: id, database: name, table: name, format: z.enum([...importBatchFormats, 'xlsx']),
}).strict();
export const importBatchReleaseSchema = z.object({ token: id }).strict();
const source = {
  expectedSource: importFileSourceSchema,
  records: z.number().int().positive(),
};
export const importBatchSchema = z.object({
  token: id, schemaFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  sources: z.array(z.object({ fileToken: id, ...source }).strict()).min(2).max(importBatchLimit),
}).strict().refine(value => new Set(value.sources.map(file => file.fileToken)).size === value.sources.length);

/** 工具进程只接收主进程从原生授权中解出的路径。 */
export const importBatchFilesSchema = z.array(z.object({ filePath: z.string().min(1), ...source }).strict()).min(2).max(importBatchLimit)
  .refine(value => new Set(value.map(file => file.filePath)).size === value.length);

export type ImportBatchChoose = z.infer<typeof importBatchChooseSchema>;
export type ImportBatch = z.infer<typeof importBatchSchema>;
export type ImportBatchFile = z.infer<typeof importBatchFilesSchema>[number];
export interface ImportBatchChoice { token: string; files: (FileChoice & { sheets?: ExcelSheet[] })[] }

export const excelWorkbookBatchSchema = z.object({
  token: id, sheets: z.array(z.object({ fileToken: id, sheetId: id }).strict()).min(2).max(importBatchLimit),
}).strict().refine(value => new Set(value.sheets.map(sheet => sheet.fileToken)).size === value.sheets.length);

export function validImportBatch(input: { batch?: ImportBatch; fileToken: string; format: string; transactionMode?: string }) {
  if (!Object.hasOwn(input, 'batch')) return true;
  return !!input.batch && importBatchFormats.some(format => format === input.format) &&
    input.transactionMode === 'atomic' && input.batch.sources[0]?.fileToken === input.fileToken &&
    !Object.hasOwn(input, 'expectedSource') && !Object.hasOwn(input, 'conflict');
}

export const importBatchInvalid = '批量导入须使用同一组已选择的数据文件及整批新增事务';
