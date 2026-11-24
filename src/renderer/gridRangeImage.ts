import type { ResultExportData } from '../shared/contracts';
import { gridRangePngText as text } from '../shared/gridRangePng';
import { pngFileScale } from '../shared/pngFile';
import { canvasPngBase64, fitCanvasText } from './canvasPng';
import { cellPreview, ownCell } from './lib';

/** 使用导出窗口冻结的行列绘制全选区，范围与屏幕滚动及虚拟网格无关。 */
export function gridRangePng(data: ResultExportData): Promise<string> {
  if (!data.columns.length || !data.rows.length) throw Error(text.invalid);
  const columnWidth = 200, rowHeight = 28, padding = 10;
  const width = data.columns.length * columnWidth + 1, height = (data.rows.length + 1) * rowHeight + 1;
  const scale = pngFileScale(width, height, text.tooLarge);
  const canvas = document.createElement('canvas');
  canvas.width = width * scale; canvas.height = height * scale;
  const context = canvas.getContext('2d');
  if (!context) throw Error(text.invalid);
  context.scale(scale, scale);
  context.textBaseline = 'middle';
  const fonts = '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
  const label = (value: string, column: number, row: number, color: string) => {
    const line = value.replace(/\r\n|[\r\n]/g, ' ↵ ').replace(/\t/g, ' ⇥ ');
    context.fillStyle = color;
    context.fillText(fitCanvasText(line, columnWidth - 2 * padding, context), column * columnWidth + padding, (row + 0.5) * rowHeight);
  };
  const band = (row: number, color: string) => {
    context.fillStyle = color; context.fillRect(0, row * rowHeight, width, rowHeight);
    context.fillStyle = '#d7dee8'; context.fillRect(0, row * rowHeight, width, 1);
  };

  band(0, '#dae5f2');
  context.font = `600 14px ${fonts}`;
  data.columns.forEach(({ name }, index) => label(cellPreview(name), index, 0, '#122235'));
  context.font = `14px ${fonts}`;
  data.rows.forEach((row, index) => {
    const position = index + 1;
    band(position, index % 2 ? '#f4f7fa' : '#ffffff');
    data.columns.forEach(({ key }, column) => {
      const value = ownCell(row, key);
      label(cellPreview(value), column, position, value === null ? '#526172' : '#182532');
    });
  });
  context.fillStyle = '#d7dee8';
  context.fillRect(0, height - 1, width, 1);
  for (let x = 0; x < width; x += columnWidth) context.fillRect(x, 0, 1, height);
  return canvasPngBase64(canvas, text.invalid, text.tooLarge);
}
