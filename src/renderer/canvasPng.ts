import { binaryCellFileLimits } from '../shared/binaryCellFiles';

/** 先完成有界编码，再交给原生选择器；画布内存不会跨文件选择保留。 */
export async function canvasPngBase64(canvas: HTMLCanvasElement, invalid: string, tooLarge: string): Promise<string> {
  let blob: Blob | null;
  try { blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png')); }
  finally { canvas.width = canvas.height = 0; }
  if (!blob || blob.type !== 'image/png') throw Error(invalid);
  if (blob.size > binaryCellFileLimits.saveBytes) throw Error(tooLarge);
  const prefix = 'data:image/png;base64,';
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string' && reader.result.startsWith(prefix)) resolve(reader.result.slice(prefix.length));
      else reject(Error(invalid));
    };
    reader.onerror = () => reject(Error(invalid));
    reader.readAsDataURL(blob);
  });
}

/** 按码点截断，避免省略号前留下半个 Unicode 代理对。 */
export function fitCanvasText(line: string, width: number, context: CanvasRenderingContext2D): string {
  if (context.measureText(line).width <= width) return line;
  const points = [...line];
  let low = 0, high = points.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (context.measureText(points.slice(0, middle).join('') + '…').width <= width) low = middle;
    else high = middle - 1;
  }
  return points.slice(0, low).join('') + '…';
}
