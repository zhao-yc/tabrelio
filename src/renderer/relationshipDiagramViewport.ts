import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

const minimumZoom = .25;
const maximumZoom = 2;
const zoomStep = .25;

/** 图的像素缩放和滚动属于视图。保持指针下的原图坐标，直到触及滚动边界。 */
export function useRelationshipDiagramViewport() {
  const viewport = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const scale = useRef(1);
  const pending = useRef<{ left: number; top: number }>(undefined);
  const [pan, setPan] = useState(false);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ id: number; x: number; y: number; left: number; top: number }>(undefined);

  function changeZoom(value: number, point?: { x: number; y: number }) {
    const element = viewport.current;
    const next = Math.max(minimumZoom, Math.min(maximumZoom, value));
    if (!element || !Number.isFinite(next) || next === scale.current || drag.current) return;
    const anchor = point ?? { x: element.clientWidth / 2, y: element.clientHeight / 2 };
    const { left, top } = pending.current ?? { left: element.scrollLeft, top: element.scrollTop };
    const ratio = next / scale.current;
    pending.current = { left: Math.max(0, (left + anchor.x) * ratio - anchor.x), top: Math.max(0, (top + anchor.y) * ratio - anchor.y) };
    scale.current = next;
    setZoom(next);
  }

  // 浏览器先接纳新的滚动范围，再恢复缩放锚点。连续滚轮事件沿用尚未提交的位置。
  useLayoutEffect(() => {
    const element = viewport.current, target = pending.current;
    pending.current = undefined;
    if (element && target) element.scrollTo({ ...target, behavior: 'instant' });
  });
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if ((!event.ctrlKey && !event.metaKey) || event.altKey || !event.deltaY) return;
      event.preventDefault();
      const bounds = element.getBoundingClientRect();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1;
      changeZoom(scale.current * 2 ** (-event.deltaY * unit / 400), {
        x: event.clientX - bounds.left - element.clientLeft,
        y: event.clientY - bounds.top - element.clientTop,
      });
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, []);

  /** 指针捕获允许拖过视口边界。取消、失焦捕获或退出模式时释放原手势。 */
  function stopDrag(id?: number) {
    const previous = drag.current, element = viewport.current;
    if (!previous || (id !== undefined && previous.id !== id)) return;
    drag.current = undefined;
    if (element?.hasPointerCapture(previous.id)) element.releasePointerCapture(previous.id);
    setDragging(false);
  }
  function togglePan() {
    if (pan) stopDrag();
    setPan(!pan);
    viewport.current?.focus({ preventScroll: true });
  }
  function escape(event: Pick<globalThis.KeyboardEvent, 'target' | 'preventDefault' | 'stopPropagation'>): boolean {
    if (!pan || !(event.target instanceof Node) || !viewport.current?.contains(event.target)) return false;
    event.preventDefault(); event.stopPropagation();
    stopDrag();
    setPan(false);
    return true;
  }

  function keydown(event: KeyboardEvent<HTMLDivElement>, refresh?: () => void) {
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.keyCode === 229 || event.altKey) return;
    const command = event.ctrlKey || event.metaKey, key = event.key;
    if (!command && !event.shiftKey && key === 'Escape') { escape(event); return; }
    if (!command && !event.shiftKey && (key === 'h' || key === 'F5')) {
      event.preventDefault(); event.stopPropagation();
      if (event.repeat) return;
      if (key === 'h') togglePan();
      else refresh?.();
      return;
    }
    if (!command || !['=', '+', '-', '0'].includes(key)) return;
    event.preventDefault(); event.stopPropagation();
    changeZoom(key === '0' ? 1 : scale.current + (key === '-' ? -zoomStep : zoomStep));
  }

  const pointerHandlers = {
    onPointerDown(event: PointerEvent<HTMLDivElement>) {
      if (!pan || event.button !== 0 || !event.isPrimary || drag.current) return;
      const element = event.currentTarget;
      element.setPointerCapture(event.pointerId);
      drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: element.scrollLeft, top: element.scrollTop };
      setDragging(true);
      event.preventDefault();
      element.focus({ preventScroll: true });
    },
    onPointerMove(event: PointerEvent<HTMLDivElement>) {
      const active = drag.current;
      if (active?.id !== event.pointerId) return;
      event.currentTarget.scrollTo({ left: active.left + active.x - event.clientX, top: active.top + active.y - event.clientY, behavior: 'instant' });
    },
    onPointerUp(event: PointerEvent<HTMLDivElement>) { stopDrag(event.pointerId); },
    onPointerCancel(event: PointerEvent<HTMLDivElement>) { stopDrag(event.pointerId); },
    onLostPointerCapture(event: PointerEvent<HTMLDivElement>) { stopDrag(event.pointerId); },
  };

  return {
    viewport, zoom, pan, dragging, keydown, escape, togglePan, pointerHandlers,
    zoomIn: () => changeZoom(scale.current + zoomStep),
    zoomOut: () => changeZoom(scale.current - zoomStep),
    canZoomIn: zoom < maximumZoom,
    canZoomOut: zoom > minimumZoom,
    fit(width: number) {
      const available = viewport.current?.clientWidth;
      if (available) changeZoom(Math.min(1, (available - 20) / width));
    },
  };
}
