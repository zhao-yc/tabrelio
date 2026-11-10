import { createContext, useContext, useState, type CSSProperties, type ReactNode } from 'react';

export const gridZoomLevels = [80, 90, 100, 110, 125, 150] as const;
type GridZoomLevel = typeof gridZoomLevels[number];
interface GridZoom {
  percent: GridZoomLevel;
  setPercent(percent: GridZoomLevel): void;
}

const GridZoomContext = createContext<GridZoom | undefined>(undefined);

/** 缩放归当前标签或快照查看器，翻页换网格仍保留，关闭时随视图释放。 */
export function GridZoomProvider({ children }: { children: ReactNode }) {
  const [percent, setPercent] = useState<GridZoomLevel>(100);
  return <GridZoomContext.Provider value={{ percent, setPercent }}>{children}</GridZoomContext.Provider>;
}

export function useGridZoom() {
  const shared = useContext(GridZoomContext);
  const [percent, setPercent] = useState<GridZoomLevel>(100);
  return shared ?? { percent, setPercent };
}

/** 虚拟行与实际行样式用同一高度，保存的基准行高始终以 100% 为准。 */
export function gridZoomDimensions(percent: GridZoomLevel, rowHeight: number, headerHeight: number) {
  const scale = percent / 100;
  const height = Math.round(rowHeight * scale);
  const style = { '--grid-zoom': scale, '--grid-data-row-height': `${height}px` } as CSSProperties;
  return { rowHeight: height, headerHeight: Math.round(headerHeight * scale), style };
}
