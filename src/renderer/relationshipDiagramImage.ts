import { binaryCellFileLimits } from '../shared/binaryCellFiles';
import { relationshipDiagramPngScale, relationshipDiagramPngText } from '../shared/relationshipDiagramPng';
import { relationshipDiagramZh as text } from './locales/relationshipDiagram.zh-CN';
import { sqliteRelationshipsZh } from './locales/sqliteRelationships.zh-CN';
import type { RelationshipDiagram } from './relationshipDiagram';

/** 按已布局图的逻辑坐标绘制。滚动、窗口大小和查看缩放均不影响图片范围。 */
export async function relationshipDiagramPng(graph: RelationshipDiagram, viewport: HTMLElement, selectedId?: string, localDatabase?: string): Promise<string> {
  const scale = relationshipDiagramPngScale(graph.width, graph.height);
  const canvas = document.createElement('canvas');
  canvas.width = graph.width * scale;
  canvas.height = graph.height * scale;
  const context = canvas.getContext('2d');
  if (!context) throw Error(text.exportFailed);
  context.scale(scale, scale);
  context.textBaseline = 'middle';
  const css = getComputedStyle(viewport);
  const palette = {
    background: css.getPropertyValue('--bg').trim(), panel: css.getPropertyValue('--surface').trim(),
    header: css.getPropertyValue('--surface-2').trim(), text: css.getPropertyValue('--text').trim(),
    muted: css.getPropertyValue('--muted').trim(), accent: css.getPropertyValue('--accent').trim(),
    border: css.getPropertyValue('--line').trim(),
  };
  context.fillStyle = palette.background;
  context.fillRect(0, 0, graph.width, graph.height);

  for (const edge of graph.edges) {
    const emphasized = selectedId && (edge.source === selectedId || edge.target === selectedId);
    const color = emphasized ? palette.accent : palette.muted;
    context.strokeStyle = color;
    context.lineWidth = emphasized ? 3 : 2;
    context.lineJoin = 'round';
    context.stroke(new Path2D(edge.path));
    context.save();
    context.translate(edge.end.x, edge.end.y);
    if (edge.source === edge.target) context.rotate(Math.PI / 2);
    context.fillStyle = color;
    context.beginPath();
    context.moveTo(0, 0);
    context.lineTo(-10, -5);
    context.lineTo(-10, 5);
    context.closePath();
    context.fill();
    context.restore();
  }

  const label = (value: string, x: number, y: number, width: number, color: string, size: number, weight = '400') => {
    context.font = `${weight} ${size}px ${css.fontFamily}`;
    context.fillStyle = color;
    context.fillText(fitDiagramLabel(value, width, context), x, y);
  };
  for (const node of graph.nodes) {
    const { x, y, width, height } = node;
    const selected = node.id === selectedId;
    const outline = new Path2D();
    outline.roundRect(x, y, width, height, 6);
    context.save();
    context.clip(outline);
    context.fillStyle = palette.panel;
    context.fillRect(x, y, width, height);
    context.fillStyle = palette.header;
    context.fillRect(x, y, width, 50);
    context.fillStyle = palette.border;
    context.fillRect(x, y + 49, width, 1);
    const name = node.database === localDatabase ? node.name : node.database + '.' + node.name;
    label(name, x + 12, y + 25, width - 24, palette.text, 13, '600');
    if (node.external || !node.columns.length) {
      label(node.external ? text.external : text.noKeys, x + 10, y + 64, width - 20, palette.muted, 12);
    }
    for (const [index, column] of node.columns.entries()) {
      const line = y + 67 + index * 26;
      const key = [node.primaryKey.includes(column.name) && 'PK', node.foreignColumns.includes(column.name) && 'FK'].filter(Boolean).join(' ');
      label(key, x + 8, line, 36, palette.accent, 10);
      label(column.name, x + 52, line, width - 154, palette.text, 12);
      label(column.type || sqliteRelationshipsZh.undeclaredType, x + width - 96, line, 88, palette.muted, 10);
    }
    context.restore();
    context.strokeStyle = selected ? palette.accent : palette.border;
    context.lineWidth = selected ? 2 : 1;
    context.setLineDash(node.external ? [5, 4] : []);
    context.stroke(outline);
    context.setLineDash([]);
  }
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
  canvas.width = 0;
  canvas.height = 0;
  if (!blob || blob.type !== 'image/png') throw Error(text.exportFailed);
  if (blob.size > binaryCellFileLimits.saveBytes) throw Error(relationshipDiagramPngText.tooLarge);
  const prefix = 'data:image/png;base64,';
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string' && reader.result.startsWith(prefix)) resolve(reader.result.slice(prefix.length));
      else reject(Error(text.exportFailed));
    };
    reader.onerror = () => reject(Error(text.exportFailed));
    reader.readAsDataURL(blob);
  });
}

/** 与图中单行标题一致。按码点截断，避免拆开 Unicode 代理对。 */
function fitDiagramLabel(value: string, width: number, context: CanvasRenderingContext2D) {
  const line = value.replace(/[\t\r\n]/g, ' ');
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
