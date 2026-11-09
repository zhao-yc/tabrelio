import { editorFontLimits } from '../shared/editorFont';
import type { sqlEditorZoomCommandIds } from '../shared/uiCommandIds';

type ZoomCommand = typeof sqlEditorZoomCommandIds[number];

/** 临时缩放只改变当前实例，字号和行高仍走全局字号的合法范围与比例。 */
export function sqlEditorZoomSize(base: number, offset: number): number {
  return Math.max(editorFontLimits.min, Math.min(editorFontLimits.max, base + offset));
}

/** 从实际可见字号计算下一步，触顶之后一次反向缩放就能立即生效。 */
export function nextSqlEditorZoomOffset(base: number, offset: number, command: ZoomCommand): number {
  if (command === 'sql-editor-zoom-reset') return 0;
  const visible = sqlEditorZoomSize(base, offset);
  return sqlEditorZoomSize(visible, command === 'sql-editor-zoom-in' ? 1 : -1) - base;
}
