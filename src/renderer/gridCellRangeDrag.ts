export interface GridRangePoint { row: number; column: number; }

function edgeStep(value: number, start: number, end: number): number {
  const zone = Math.min(28, (end - start) / 3);
  if (value < start + zone) return -Math.min(24, Math.ceil((start + zone - value) / 2));
  if (value > end - zone) return Math.min(24, Math.ceil((value - end + zone) / 2));
  return 0;
}

interface Options {
  grid: HTMLElement;
  start: MouseEvent;
  rowCount: number;
  columnCount: number;
  columnOffset: number;
  current(): boolean;
  extend(point: GridRangePoint): void;
  finish(cancel: boolean): void;
}

/** 按指针命中的真实网格坐标选取，屏外行随滚动渲染。抬键、失焦或来源失效时清理本次监听。 */
export function startGridCellRangeDrag({ grid, start, rowCount, columnCount, columnOffset, current, extend, finish }: Options) {
  const doc = grid.ownerDocument, view = doc.defaultView;
  if (!view) return;
  let x = start.clientX, y = start.clientY, dragging = false, frame = 0, closed = false;

  function stop() {
    if (!view || closed) return;
    closed = true;
    view.cancelAnimationFrame(frame);
    view.removeEventListener('mousemove', move, true);
    view.removeEventListener('mouseup', up, true);
    view.removeEventListener('blur', blur);
    doc.removeEventListener('selectstart', prevent, true);
    doc.removeEventListener('dragstart', prevent, true);
  }

  function end(cancel: boolean) {
    stop();
    finish(cancel);
  }

  function sample(scroll: boolean) {
    if (!view || closed) return;
    if (!current()) { end(true); return; }
    const rect = grid.getBoundingClientRect();
    // 所有接入网格只有一行表头，无汇总行。冻结表头上方不参与选区。
    const header = grid.querySelector('[role="row"][aria-rowindex="1"]');
    const left = rect.left + grid.clientLeft, right = left + grid.clientWidth;
    const top = Math.max(rect.top + grid.clientTop, header?.getBoundingClientRect().bottom ?? rect.top);
    const bottom = rect.top + grid.clientTop + grid.clientHeight;
    if (right - left < 2 || bottom - top < 2) return;
    const cell = doc.elementFromPoint(Math.max(left + 1, Math.min(x, right - 1)),
      Math.max(top + 1, Math.min(y, bottom - 1)))?.closest('[role="gridcell"]');
    if (cell?.closest('[role="grid"],[role="treegrid"]') === grid) {
      const row = Number(cell.closest('[role="row"]')?.getAttribute('aria-rowindex')) - 2;
      const column = Number(cell.getAttribute('aria-colindex')) - 1 - columnOffset;
      if (Number.isInteger(row) && row >= 0 && row < rowCount && Number.isInteger(column) && column >= 0 && column < columnCount)
        extend({ row, column });
    }
    if (!scroll) return;
    const beforeTop = grid.scrollTop, beforeLeft = grid.scrollLeft;
    grid.scrollTop += edgeStep(y, top, bottom);
    grid.scrollLeft += edgeStep(x, left, right);
    if (grid.scrollTop !== beforeTop || grid.scrollLeft !== beforeLeft)
      frame = view.requestAnimationFrame(() => { frame = 0; sample(true); });
  }

  function move(event: MouseEvent) {
    if (!view || closed) return;
    if ((event.buttons & 1) === 0) { end(true); return; }
    x = event.clientX; y = event.clientY;
    if (!dragging && Math.hypot(x - start.clientX, y - start.clientY) < 4) return;
    dragging = true;
    if (!frame) frame = view.requestAnimationFrame(() => { frame = 0; sample(true); });
  }

  function up(event: MouseEvent) {
    if (event.button !== 0) return;
    if (dragging) {
      x = event.clientX; y = event.clientY;
      sample(false);
    }
    if (!closed) end(!current());
  }

  function blur() { end(true); }
  function prevent(event: Event) { event.preventDefault(); }
  view.addEventListener('mousemove', move, true);
  view.addEventListener('mouseup', up, true);
  view.addEventListener('blur', blur);
  doc.addEventListener('selectstart', prevent, true);
  doc.addEventListener('dragstart', prevent, true);
  return stop;
}
