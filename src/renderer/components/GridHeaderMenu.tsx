import { useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import type { SortColumn } from 'react-data-grid';
import type { ConnectionProfile } from '../../shared/contracts';
import { gridHeaderMenuZh as text } from '../locales/gridHeaderMenu.zh-CN';
import { isGridContextKey, type GridCellAction, type useGridCellActionMenu } from './GridCellActionMenu';
import { gridColumnName } from '../gridColumnName';
import { writeTableClipboardEvent } from '../gridClipboard';
import { errorMessage } from '../lib';
import { useWorkspace } from '../store';
import { tablePreferencesLimits } from '../../shared/tablePreferences';
import { gridRowHeightLimits } from '../../shared/gridRowHeight';
import { appModalSelector, gridDialogCurrent } from '../modalSelectors';
import { Field, Modal } from './ui';

export interface GridHeaderFreeze {
  current(): boolean;
  apply(key?: string): void;
}

interface HeaderMenuSource {
  owner: object | null | undefined;
  grid(): HTMLElement | null | undefined;
  column(index: number): { key: string; name: string } | undefined;
  columnNameDialect?: ConnectionProfile['dialect'];
  sort: readonly SortColumn[];
  current(): boolean;
  canSort(key: string): boolean;
  applySort(next: readonly SortColumn[], current: () => boolean): void;
  selectColumn?(index: number): GridCellAction | undefined;
  findColumn?(key: string): void;
  resizeColumn?(key: string, width: number): void;
  resizeRows?: { height: number; apply(height: number): void };
  ownDialog?(): Element | undefined;
  freeze?: GridHeaderFreeze;
  frozenThrough?: string;
}

interface SizeRequest {
  dimension: 'width' | 'height';
  description: string;
  initial: number;
  apply(size: number): void;
}

function GridSizeDialog({ request, onClose, onApply }: { request: SizeRequest; onClose(): void; onApply(size: number): void }) {
  const [input, setInput] = useState(String(request.initial));
  const field = useRef<HTMLInputElement>(null);
  const height = request.dimension === 'height';
  const min = height ? gridRowHeightLimits.min : tablePreferencesLimits.minWidth;
  const max = height ? gridRowHeightLimits.max : tablePreferencesLimits.maxWidth;
  const size = Number(input);
  const valid = /^\d+$/.test(input) && size >= min && size <= max;
  return <Modal title={height ? text.setHeight : text.setWidth} onClose={onClose} initialFocus={field}>
    <form data-grid-size-dialog onSubmit={event => {
      event.preventDefault();
      const dialogs = document.querySelectorAll(appModalSelector);
      if (valid && event.currentTarget.closest(appModalSelector) === dialogs[dialogs.length - 1]) onApply(size);
    }}>
      <div className="modal-content">
        <p style={{ overflowWrap: 'anywhere' }}>{request.description}</p>
        <Field label={height ? text.height : text.width}><input ref={field} inputMode="numeric" maxLength={16} value={input}
          aria-invalid={!valid} aria-describedby="grid-size-range" onFocus={event => event.currentTarget.select()}
          onChange={event => setInput(event.target.value)}/></Field>
        <p id="grid-size-range" className="muted small">{text.widthRange(min, max)}</p>
      </div>
      <footer className="modal-footer"><span className="grow"/><button type="button" onClick={onClose}>{text.cancelWidth}</button>
        <button type="submit" className="primary" disabled={!valid}>{height ? text.applyHeight : text.applyWidth}</button></footer>
    </form>
  </Modal>;
}

/** 修改命中列，保留其他列及其顺序。新增列放在最后，底层仍负责验证排序规则。 */
function changeHeaderSort(sort: readonly SortColumn[], key: string, direction?: SortColumn['direction']): SortColumn[] {
  if (direction === undefined) return sort.filter(rule => rule.columnKey !== key);
  const rule = { columnKey: key, direction };
  return sort.some(item => item.columnKey === key) ? sort.map(item => item.columnKey === key ? rule : item) : [...sort, rule];
}

/** 与单元格共用一个菜单，按原网格、列键和排序快照拒绝迟到的动作。 */
export function useGridHeaderMenu(openMenu: ReturnType<typeof useGridCellActionMenu>['open'], source: HeaderMenuSource) {
  const latest = useRef(source);
  latest.current = source;
  const [sizeRequest, setSizeRequest] = useState<SizeRequest>();
  const pendingSize = useRef<{ request: SizeRequest; size: number }>(undefined);
  // 布局接纳门会拒绝模态后的网格操作。关闭并提交 DOM 后，重新验证原网格再写入。
  useLayoutEffect(() => {
    if (sizeRequest || !pendingSize.current) return;
    const { request, size } = pendingSize.current;
    pendingSize.current = undefined;
    try { request.apply(size); }
    catch (reason) { useWorkspace.getState().notify(errorMessage(reason), true); }
  }, [sizeRequest]);

  /** 行高属于整个网格。只从行侧辅助格打开，应用前核对原网格和当前行高。 */
  function openRowHeader(target: EventTarget | null, point?: { x: number; y: number }): boolean {
    if (!source.resizeRows || !source.owner || !(target instanceof HTMLElement)) return false;
    const grid = source.grid(), cell = target.closest<HTMLElement>('[role="gridcell"]');
    if (!grid || !cell || cell.closest('[role="grid"]') !== grid) return false;
    const index = Number(cell.getAttribute('aria-colindex')) - 1;
    if (!Number.isSafeInteger(index) || index < 0 || source.column(index)) return false;
    const original = source.resizeRows.height;
    const current = () => {
      const now = latest.current;
      return now.owner === source.owner && now.grid() === grid && grid.isConnected &&
        now.resizeRows?.height === original && now.current() && gridDialogCurrent(grid, now.ownDialog);
    };
    return openMenu(cell, grid, { title: text.rowMenu, label: text.rowMenu, current,
      focusTarget: () => target.matches('button,input') && cell.contains(target) ? target : undefined,
      actions: [{ label: text.setHeight, run: () => {
        if (!current()) return;
        setSizeRequest({ dimension: 'height', description: text.heightScope, initial: original, apply(height) {
          if (!current()) { useWorkspace.getState().notify(text.staleHeight, true); return; }
          if (height !== original) latest.current.resizeRows?.apply(height);
        } });
      } }],
    }, point);
  }

  function captureColumn(target: EventTarget | null, selector: string) {
    if (!(target instanceof Element)) return;
    const grid = source.grid(), cell = target.closest(selector);
    if (!grid || !cell || cell.closest('[role="grid"]') !== grid) return;
    const index = Number(cell.getAttribute('aria-colindex')) - 1;
    const column = Number.isSafeInteger(index) && index >= 0 ? source.column(index) : undefined;
    if (!column || !source.owner || !source.current()) return;
    const { key, name } = column;
    const current = () => {
      const now = latest.current;
      const live = now.column(index);
      return now.owner === source.owner && now.grid() === grid && live?.key === key && live.name === name &&
        now.columnNameDialect === source.columnNameDialect && now.current();
    };
    return { grid, cell, column, index, current };
  }

  /** 菜单和快捷键共用排序快照，读取或确认草稿期间仍核对原列和规则。 */
  function captureSort(key: string, current: () => boolean) {
    if (!source.canSort(key)) return;
    const initial = source.sort.find(rule => rule.columnKey === key)?.direction;
    const sortCurrent = () => {
      const now = latest.current;
      return current() && now.canSort(key) && now.sort.length === source.sort.length &&
        now.sort.every((rule, i) => rule.columnKey === source.sort[i].columnKey && rule.direction === source.sort[i].direction);
    };
    return { initial, apply(direction?: SortColumn['direction']) {
      if (direction !== initial && sortCurrent()) latest.current.applySort(changeHeaderSort(source.sort, key, direction), sortCurrent);
    } };
  }

  function open(target: EventTarget | null, point?: { x: number; y: number }): boolean {
    const captured = captureColumn(target, '[role="columnheader"]');
    if (!captured) return false;
    const { grid, cell, column, index, current } = captured;
    const actions: GridCellAction[] = [];
    const selectColumn = source.selectColumn?.(index);
    if (selectColumn) actions.push(selectColumn);
    const sort = captureSort(column.key, current);
    if (sort) {
      actions.push({ label: text.asc, disabled: sort.initial === 'ASC', run: () => sort.apply('ASC') },
        { label: text.desc, disabled: sort.initial === 'DESC', run: () => sort.apply('DESC') },
        { label: text.clear, disabled: sort.initial === undefined, run: () => sort.apply() });
    }
    if (source.freeze?.current()) {
      const apply = (key?: string) => {
        const now = latest.current;
        if (current() && now.frozenThrough === source.frozenThrough && now.freeze?.current()) now.freeze.apply(key);
      };
      actions.push({ label: text.freeze, disabled: source.frozenThrough === column.key, run: () => apply(column.key) },
        { label: text.unfreeze, disabled: source.frozenThrough === undefined, run: () => apply() });
    }
    if (source.resizeColumn) actions.push({ label: text.setWidth, run: () => {
      if (!current() || !gridDialogCurrent(cell, source.ownDialog)) return;
      const measuredWidth = () => Math.round(cell.getBoundingClientRect().width);
      const original = measuredWidth();
      const { minWidth, maxWidth } = tablePreferencesLimits;
      setSizeRequest({ dimension: 'width', description: text.widthColumn(column.name), initial: Math.max(minWidth, Math.min(maxWidth, original)), apply(width) {
        const now = latest.current;
        if (now.resizeColumn && current() && cell.isConnected && cell.closest('[role="grid"]') === grid &&
            Number(cell.getAttribute('aria-colindex')) === index + 1 && measuredWidth() === original && gridDialogCurrent(cell, now.ownDialog)) {
          if (width !== original) now.resizeColumn(column.key, width);
        } else useWorkspace.getState().notify(text.staleWidth, true);
      } });
    } });
    const name = gridColumnName(column.name, source.columnNameDialect);
    // 标题复制只写纯文本，与网格单元格的类型化剪贴板格式分开。
    const copy = (value: string) => {
      try { writeTableClipboardEvent(current, data => data.setData('text/plain', value)); }
      catch (reason) { useWorkspace.getState().notify(errorMessage(reason), true); }
    };
    if (name) {
      actions.push({ label: text.copyName, run: () => copy(name.plain) });
      const quoted = name.quoted;
      if (quoted !== undefined) actions.push({ label: text.copyQuotedName, run: () => copy(quoted) });
    }
    if (source.findColumn) actions.push({ label: text.findColumn, run: () => {
      if (current()) latest.current.findColumn?.(column.key);
    } });
    return openMenu(target, grid, { title: column.name, label: text.menu, targetRole: 'columnheader', current, actions }, point);
  }

  /** 只接管 macOS 网格的 Command+上下方向键，输入控件继续处理自己的按键。 */
  function sortFromKeyboard(event: KeyboardEvent): boolean {
    if ((event.key !== 'ArrowUp' && event.key !== 'ArrowDown') || !event.metaKey || event.ctrlKey || event.altKey ||
        event.shiftKey || event.repeat || event.nativeEvent.isComposing || event.keyCode === 229 ||
        !navigator.platform.startsWith('Mac')) return false;
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.isContentEditable ||
        target.closest('input, textarea, select, button, [role="textbox"]')) return false;
    const captured = captureColumn(target, '[role="columnheader"], [role="gridcell"]');
    const sort = captured && captureSort(captured.column.key, captured.current);
    if (!sort) return false;
    sort.apply(event.key === 'ArrowUp' ? 'ASC' : 'DESC');
    return true;
  }

  return {
    sizeDialog: sizeRequest && <GridSizeDialog request={sizeRequest} onClose={() => setSizeRequest(undefined)} onApply={size => {
      pendingSize.current = { request: sizeRequest, size };
      setSizeRequest(undefined);
    }}/>,
    onContextMenuCapture(event: MouseEvent) {
      const point = { x: event.clientX, y: event.clientY };
      if (event.defaultPrevented || !(open(event.target, point) || openRowHeader(event.target, point))) return;
      event.preventDefault();
      event.stopPropagation();
    },
    onKeyDownCapture(event: KeyboardEvent) {
      if (event.defaultPrevented || !(isGridContextKey(event) ? open(event.target) || openRowHeader(event.target) : sortFromKeyboard(event))) return;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}
