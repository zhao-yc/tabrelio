import { useLayoutEffect, type RefObject } from 'react';
import './components/QueryInlineCell.css';

export interface QueryInlineCellAnchor {
  findAnchor(): HTMLElement | null;
  bounds: DOMRect;
}

/** 网格重建后重新找原显示位置，写入目标仍由原结果行与原列绑定。 */
export function captureQueryInlineCellAnchor(anchor: HTMLElement): QueryInlineCellAnchor | undefined {
  const grid = anchor.closest('.query-result-grid');
  const row = anchor.parentElement?.getAttribute('aria-rowindex'), column = anchor.getAttribute('aria-colindex');
  if (!grid || !row || !column) return;
  return {
    bounds: anchor.getBoundingClientRect(),
    findAnchor: () => grid.querySelector<HTMLElement>(
      `[role="row"][aria-rowindex="${CSS.escape(row)}"] > [role="gridcell"][aria-colindex="${CSS.escape(column)}"]`),
  };
}

/** 随滚动、窗口和内容尺寸变化更新位置，并将输入面板保持在视口内。 */
export function useQueryInlineCellPosition(panel: RefObject<HTMLFormElement | null>, cell: QueryInlineCellAnchor | undefined, visible: boolean) {
  const { findAnchor, bounds } = cell ?? {};
  useLayoutEffect(() => {
    const element = panel.current;
    if (!element || !visible || !findAnchor || !bounds) return;
    const position = () => {
      const current = findAnchor()?.getBoundingClientRect();
      const rect = current?.width && current.height ? current : bounds;
      element.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - element.offsetWidth - 8)) + 'px';
      element.style.top = Math.max(8, Math.min(rect.top, window.innerHeight - element.offsetHeight - 8)) + 'px';
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(element);
    window.addEventListener('resize', position);
    document.addEventListener('scroll', position, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', position);
      document.removeEventListener('scroll', position, true);
    };
  }, [panel, findAnchor, bounds, visible]);
}
