import type { ResultExportData } from '../shared/contracts';
import { assertResultExcelData, resultArchiveIndexHeaders, resultArchiveSheetNames } from '../shared/resultExcel';
import { resultExportColumns, type ResultArchiveEntry } from '../shared/resultExport';
import { EXCEL_LIMITS } from '../shared/excelTransfer';
import type { AtomicFileIO } from './atomicFile';
import { encodeExcelCell, validateExcelHeaders } from './excelCellPolicy';
import { exportExcelFile, exportExcelWorkbook, type ExcelExportSheet } from './excelFiles';

export interface ResultExcelFileOptions {
  filePath: string; result: ResultExportData; checkCancelled(): void; onCommitStart(): void;
  onProgress?(rows: number): void; io?: AtomicFileIO;
}

/** 先完整运行原Excel单元格编码准入，再复用成熟流、背压、ZIP关闭和AtomicFile保护。 */
export async function exportResultExcelFile(input: ResultExcelFileOptions): Promise<{ rows: number; bytes: number }> {
  assertResultExcelData(input.result); input.checkCancelled();
  const columns = resultExportColumns(input.result.columns), metadata = columns.map(column => ({ name: column.exportName, type: '' }));
  validateExcelHeaders(metadata.map(column => column.name));
  for (const row of input.result.rows) {
    input.checkCancelled(); let bytes = 0;
    for (let index = 0; index < columns.length; index++) bytes += Buffer.byteLength(String(encodeExcelCell(row[columns[index].key], metadata[index])));
    if (bytes > EXCEL_LIMITS.maxRowBytes) throw Error('Excel 单行文本超过 1 MiB，请改用其他格式');
  }
  /** 每行仅投影实际列顺序；不预建整表工作簿或新数据副本，也不获得连接或SQL执行能力。 */
  async function* rows() { for (const row of input.result.rows) { input.checkCancelled(); yield columns.map(column => row[column.key]); } }
  return exportExcelFile({ filePath: input.filePath, columns: metadata, rows: rows(), io: input.io,
    checkCancelled: input.checkCancelled, onCommitStart: input.onCommitStart, onProgress: input.onProgress });
}

/** 已预检的批量结果按原顺序写出；清单行从进度和最终导出计数中扣除。 */
export async function exportResultExcelArchive(input: Omit<ResultExcelFileOptions, 'result'> & { entries: ResultArchiveEntry[] }): Promise<number> {
  const { entries, checkCancelled, onProgress } = input;
  const names = resultArchiveSheetNames(entries);
  async function* sheets(): AsyncGenerator<ExcelExportSheet> {
    yield {
      name: names[0], columns: resultArchiveIndexHeaders.map(name => ({ name, type: '' })),
      async writeRows(write) {
        for (const [index, entry] of entries.entries()) {
          await write([String(entry.sourceOrdinal), entry.label ?? '', names[index + 1], String(entry.result.rows.length), entry.result.truncated ? '是' : '否']);
        }
      },
    };
    for (const [index, { result }] of entries.entries()) {
      checkCancelled();
      const columns = resultExportColumns(result.columns);
      yield {
        name: names[index + 1],
        columns: columns.map(column => ({ name: column.exportName, type: '' })),
        async writeRows(write) {
          for (const row of result.rows) await write(columns.map(column => row[column.key]));
        },
      };
    }
  }
  const { rows } = await exportExcelWorkbook({ ...input, sheets: sheets(),
    onProgress: written => onProgress?.(Math.max(0, written - entries.length)) });
  return rows - entries.length;
}
