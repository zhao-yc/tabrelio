import { z } from 'zod';
import { binaryCellFileBytes, binaryCellFileSaveSchema } from './binaryCellFiles';

export interface RelationshipDiagramPngInput { base64: string; }
export const relationshipDiagramPngText = {
  title: '保存关系图 PNG', filter: 'PNG 图像', name: 'er-diagram.png', extension: '请选择 .png 文件。',
  invalid: '关系图 PNG 数据无效。', tooLarge: '关系图超出图片导出上限，请减少表或隐藏非关联字段。',
} as const;
const dimensionLimit = 16384, pixelLimit = 16 * 1024 * 1024;

function withinBudget(width: number, height: number) {
  return Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0 &&
    width <= dimensionLimit && height <= dimensionLimit && width * height <= pixelLimit;
}

/** 尽可能用双倍像素保持文字清晰。超限时先回退到原尺寸，避免静默缩小到无法辨认。 */
export function relationshipDiagramPngScale(width: number, height: number): number {
  if (!withinBudget(width, height)) throw Error(relationshipDiagramPngText.tooLarge);
  return withinBudget(width * 2, height * 2) ? 2 : 1;
}

/** 保存前核对规范 Base64、PNG 首尾和尺寸。预校验只解码固定长度的首尾，写盘复用原子文件服务。 */
export const relationshipDiagramPngSchema = binaryCellFileSaveSchema.pipe(z.object({ base64: z.string() }).strict())
  .superRefine(({ base64 }, context) => {
    const bytes = binaryCellFileBytes(base64);
    const header = atob(base64.slice(0, 44)), ending = atob(base64.slice(-20));
    const uint32 = (offset: number) => header.charCodeAt(offset) * 2 ** 24 + header.charCodeAt(offset + 1) * 2 ** 16 +
      header.charCodeAt(offset + 2) * 256 + header.charCodeAt(offset + 3);
    if (bytes < 57 || !header.startsWith('\x89PNG\r\n\x1a\n\0\0\0\x0dIHDR') ||
        !ending.endsWith('\0\0\0\0IEND\xaeB\x60\x82') || !withinBudget(uint32(16), uint32(20))) {
      context.addIssue({ code: 'custom', message: relationshipDiagramPngText.invalid });
    }
  });
