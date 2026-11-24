import { z } from 'zod';
import { pngFileSchema, type PngFileInput } from './pngFile';

export const gridRangePngText = {
  title: '保存选区 PNG', filter: 'PNG 图像', name: 'grid-selection.png', extension: '请选择 .png 文件。',
  invalid: '选区 PNG 数据无效。', tooLarge: '选区超出图片导出上限，请缩小选区再导出。',
  targetExpired: '选区 PNG 保存位置已失效，请重新选择。',
} as const;

export type GridRangePngInput = PngFileInput & { fileToken?: string };

const png = pngFileSchema(gridRangePngText.invalid);
export const gridRangePngSchema = z.object({ base64: z.string(), fileToken: z.uuid().optional() }).strict()
  .refine(({ base64 }) => png.safeParse({ base64 }).success, gridRangePngText.invalid);
