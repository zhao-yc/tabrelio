import { binaryCellFileBytes, binaryCellFileSaveOutputSchema, textCellFileBytes } from '../shared/binaryCellFiles';
import type { CellValue } from '../shared/contracts';
import { decodeBinaryCell, inspectBinaryImage } from './binaryCell';
import { errorMessage, invoke } from './lib';
import { gridCellFileZh as text } from './locales/gridCellFile.zh-CN';
import { useWorkspace } from './store';

/** 只给可辨认的图片建议扩展名，实际落盘始终使用原字节。 */
function binaryFilename(value: Extract<CellValue, object>): string {
  try {
    const format = inspectBinaryImage(decodeBinaryCell(value)!).format;
    return 'cell.' + (format === 'JPEG' ? 'jpg' : format.toLowerCase());
  } catch {
    return 'cell.bin';
  }
}

/** 在打开系统对话框前捕获准确原值；异步完成后不向已切换的格发布提示。 */
export async function saveGridCell(read: () => CellValue | undefined, current: () => boolean): Promise<void> {
  if (!current()) return;
  try {
    const value = read();
    if (value === undefined || value === null) throw Error(text.noValue);
    let bytes: number;
    let operation: ReturnType<typeof invoke<'cellFiles.saveText'>>;
    if (typeof value === 'object') {
      bytes = binaryCellFileBytes(value.base64);
      const suggestedName = binaryFilename(value);
      if (!current()) return;
      operation = invoke('binaryCellFiles.save', { base64: value.base64, suggestedName });
    } else {
      const raw = Object.is(value, -0) ? '-0' : String(value);
      bytes = textCellFileBytes(raw);
      if (!current()) return;
      operation = invoke('cellFiles.saveText', { text: raw });
    }
    const receipt = binaryCellFileSaveOutputSchema.parse(await operation);
    if (!receipt || !current()) return;
    if (receipt.bytes !== bytes) throw Error('单元格文件保存回执与原值长度不一致');
    useWorkspace.getState().notify(text.saved(bytes));
  } catch (reason) {
    if (current()) useWorkspace.getState().notify(errorMessage(reason), true);
  }
}
