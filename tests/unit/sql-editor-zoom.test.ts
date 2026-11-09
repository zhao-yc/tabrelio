import { expect, it } from 'vitest';
import { nextSqlEditorZoomOffset, sqlEditorZoomSize } from '../../src/renderer/sqlEditorZoom';

it('根据全局字号计算可见字号、限制边界并从上限或下限立即反向缩放', () => {
  expect(nextSqlEditorZoomOffset(13, 0, 'sql-editor-zoom-in')).toBe(1);
  expect(nextSqlEditorZoomOffset(13, 0, 'sql-editor-zoom-out')).toBe(-1);
  expect(sqlEditorZoomSize(32, 3)).toBe(32);
  expect(nextSqlEditorZoomOffset(32, 3, 'sql-editor-zoom-out')).toBe(-1);
  expect(sqlEditorZoomSize(8, -3)).toBe(8);
  expect(nextSqlEditorZoomOffset(8, -3, 'sql-editor-zoom-in')).toBe(1);
  expect(nextSqlEditorZoomOffset(18, 5, 'sql-editor-zoom-reset')).toBe(0);
});
