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
  ownDialog?(): Element | undefined;
  freeze?: GridHeaderFreeze;
  frozenThrough?: string;
}

interface WidthRequest {
  name: string;
  initial: number;
  apply(width: number): void;
}

function ColumnWidthDialog({ request, onClose, onApply }: { request: WidthRequest; onClose(): void; onApply(width: number): void }) {
  const [input, setInput] = useState(String(request.initial));
  const field = useRef<HTMLInputElement>(null);
  const { minWidth, maxWidth } = tablePreferencesLimits;
  const width = Number(input);
  const valid = /^\d+$/.test(input) && width >= minWidth && width <= maxWidth;
  return <Modal title={text.setWidth} onClose={onClose} initialFocus={field}>
    <form data-grid-header-width-dialog onSubmit={event => {
      event.preventDefault();
      const dialogs = document.querySelectorAll(appModalSelector);
      if (valid && event.currentTarget.closest(appModalSelector) === dialogs[dialogs.length - 1]) onApply(width);
    }}>
      <div className="modal-content">
        <p style={{ overflowWrap: 'anywhere' }}>{text.widthColumn(request.name)}</p>
        <Field label={text.width}><input ref={field} inputMode="numeric" maxLength={16} value={input}
          aria-invalid={!valid} aria-describedby="grid-header-width-range" onFocus={event => event.currentTarget.select()}
          onChange={event => setInput(event.target.value)}/></Field>
        <p id="grid-header-width-range" className="muted small">{text.widthRange(minWidth, maxWidth)}</p>
      </div>
      <footer className="modal-footer"><span className="grow"/><button type="button" onClick={onClose}>{text.cancelWidth}</button>
        <button type="submit" className="primary" disabled={!valid}>{text.applyWidth}</button></footer>
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
  const [widthRequest, setWidthRequest] = useState<WidthRequest>();
  const pendingWidth = useRef<{ request: WidthRequest; width: number }>(undefined);
  // 布局接纳门会拒绝模态后的网格操作。关闭并提交 DOM 后，重新验证原网格再写入。
  useLayoutEffect(() => {
    if (widthRequest || !pendingWidth.current) return;
    const { request, width } = pendingWidth.current;
    pendingWidth.current = undefined;
    try { request.apply(width); }
    catch (reason) { useWorkspace.getState().notify(errorMessage(reason), true); }
  }, [widthRequest]);

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
      setWidthRequest({ name: column.name, initial: Math.max(minWidth, Math.min(maxWidth, original)), apply(width) {
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
    widthDialog: widthRequest && <ColumnWidthDialog request={widthRequest} onClose={() => setWidthRequest(undefined)} onApply={width => {
      pendingWidth.current = { request: widthRequest, width };
      setWidthRequest(undefined);
    }}/>,
    onContextMenuCapture(event: MouseEvent) {
      if (event.defaultPrevented || !open(event.target, { x: event.clientX, y: event.clientY })) return;
      event.preventDefault();
      event.stopPropagation();
    },
    onKeyDownCapture(event: KeyboardEvent) {
      if (event.defaultPrevented || !(isGridContextKey(event) ? open(event.target) : sortFromKeyboard(event))) return;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}
