import { z } from 'zod';
import { binaryCellFileBytes, binaryCellFileSaveSchema } from './binaryCellFiles';

export interface PngFileInput { base64: string; }

function withinBudget(width: number, height: number): boolean {
  const maxDimension = 16_384, maxPixels = 16 * 1024 * 1024;
  return Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0 &&
    width <= maxDimension && height <= maxDimension && width * height <= maxPixels;
}

/** 尽可能用双倍像素保持文字清晰。超限时只回到原尺寸。 */
export function pngFileScale(width: number, height: number, tooLarge: string): number {
  if (!withinBudget(width, height)) throw Error(tooLarge);
  return withinBudget(width * 2, height * 2) ? 2 : 1;
}

/** 只解码固定长度的首尾，文件名和路径均由受限原生选择器提供。 */
export function pngFileSchema(invalid: string) {
  return binaryCellFileSaveSchema.pipe(z.object({ base64: z.string() }).strict())
    .superRefine(({ base64 }, context) => {
      const bytes = binaryCellFileBytes(base64);
      const header = atob(base64.slice(0, 44)), ending = atob(base64.slice(-20));
      const uint32 = (offset: number) => header.charCodeAt(offset) * 2 ** 24 + header.charCodeAt(offset + 1) * 2 ** 16 +
        header.charCodeAt(offset + 2) * 256 + header.charCodeAt(offset + 3);
      if (bytes < 57 || !header.startsWith('\x89PNG\r\n\x1a\n\0\0\0\x0dIHDR') ||
          !ending.endsWith('\0\0\0\0IEND\xaeB\x60\x82') || !withinBudget(uint32(16), uint32(20))) {
        context.addIssue({ code: 'custom', message: invalid });
      }
    });
}
