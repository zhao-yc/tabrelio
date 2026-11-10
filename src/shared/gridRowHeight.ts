export const gridRowHeights = [24, 32, 56] as const;
export type GridRowHeight = number;
export const defaultGridRowHeight = 32;
export const gridRowHeightLimits = { min: 24, max: 120 } as const;

/** 只接纳有界整数，兼容原有三个预设和未设置行高的旧布局。 */
export function isGridRowHeight(value: unknown): value is GridRowHeight {
  return typeof value === 'number' && Number.isInteger(value) && value >= gridRowHeightLimits.min && value <= gridRowHeightLimits.max;
}

/** 虚拟网格和样式共用同一个高度来源。 */
export function readGridRowHeight(value: unknown): GridRowHeight {
  return isGridRowHeight(value) ? value : defaultGridRowHeight;
}
