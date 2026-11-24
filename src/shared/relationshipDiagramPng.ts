import { pngFileScale, pngFileSchema, type PngFileInput } from './pngFile';

export type RelationshipDiagramPngInput = PngFileInput;
export const relationshipDiagramPngText = {
  title: '保存关系图 PNG', filter: 'PNG 图像', name: 'er-diagram.png', extension: '请选择 .png 文件。',
  invalid: '关系图 PNG 数据无效。', tooLarge: '关系图超出图片导出上限，请减少表或隐藏非关联字段。',
} as const;
export function relationshipDiagramPngScale(width: number, height: number): number {
  return pngFileScale(width, height, relationshipDiagramPngText.tooLarge);
}

/** 保存前核对规范 Base64、PNG 首尾和尺寸。预校验只解码固定长度的首尾，写盘复用原子文件服务。 */
export const relationshipDiagramPngSchema = pngFileSchema(relationshipDiagramPngText.invalid);
