import { pngFileSchema } from './pngFile';

export const gridRangePngText = {
  title: '保存选区 PNG', filter: 'PNG 图像', name: 'grid-selection.png', extension: '请选择 .png 文件。',
  invalid: '选区 PNG 数据无效。', tooLarge: '选区超出图片导出上限，请缩小选区再导出。',
} as const;

export const gridRangePngSchema = pngFileSchema(gridRangePngText.invalid);
