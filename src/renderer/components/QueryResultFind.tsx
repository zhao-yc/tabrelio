import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type Ref, type RefObject, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { DataGridHandle } from 'react-data-grid';
import type { DataRow, QueryResult, ResultColumn } from '../../shared/contracts';
import { isTextResultFind, QueryResultFindScan, type QueryResultFindMatch, type QueryResultFindMode, type QueryResultFindPhase, type QueryResultFindProgress } from '../queryResultFind';
import { QueryResultRegexWorkerClient } from '../queryResultRegexWorkerClient';
import { queryResultFindZh as text } from '../locales/queryResultFind.zh-CN';
import { gridFindDirection, gridFindModalBlocked } from '../gridFindKeys';
import { queryResultHost } from '../queryResultShortcut';
import { queryResultFindFilterRule, queryResultFindTextFilterable } from '../queryResultFindFilter';
import type { QueryResultFilterRule } from '../queryResultFilter';
import type { SortDialect } from '../queryResultSort';
import type { ResultCheckedRows } from '../resultExport';
import { postgresTableFindZh as checkedText } from '../locales/postgresTableFind.zh-CN';
import '../queryResultFind.css';

interface Run { owner: object; rowScope?: ResultCheckedRows | null; scan: QueryResultFindScan; timer?: ReturnType<typeof setTimeout>; index: number; }
export interface QueryResultFindHit { scan: QueryResultFindScan; match: QueryResultFindMatch; }
export interface QueryResultFindControl { openColumn(key: string): boolean; }
interface Props { owner: object; rows: DataRow[]; columns: ResultColumn[]; checkedRows?: ResultCheckedRows; grid: RefObject<DataGridHandle | null>; control?: Ref<QueryResultFindControl>; isCurrent(): boolean; onHit(hit: QueryResultFindHit | undefined): void; onHighlights(scan: QueryResultFindScan | undefined): void; onMatchingRows(indices: ReadonlySet<number>, checked: boolean): void; onShowMatchingRows?(indices: ReadonlySet<number>): void; onStageFindFilter?(rule: QueryResultFilterRule): void; findFilterSource?: QueryResult; filterDialect?: SortDialect; children: ReactNode; }
const regexErrors: Partial<Record<QueryResultFindPhase, string>> = text.regexErrors;
const findOpeners = new WeakMap<Element, (target: HTMLElement) => boolean>();

/** 原生菜单只派给当前查询结果的查找栏。结果内其它控件保留焦点。 */
export function openFocusedQueryResultFind(root: HTMLElement | null): boolean {
  const target = document.activeElement;
  const host = queryResultHost(root, target);
  if (!host || !(target instanceof HTMLElement)) return false;
  const region = target.closest('.query-result-find-region');
  if (region && host.contains(region)) findOpeners.get(region)?.(target);
  return true;
}

/** 对话框捕获 Escape 时，把它留给当前结果已展开的查找栏。 */
export function escapeTargetsQueryResultFind(event: KeyboardEvent, root: HTMLElement | null): boolean {
  const target = event.target;
  if (event.ctrlKey || event.metaKey || event.altKey || !(target instanceof HTMLElement) || !root?.contains(target)) return false;
  const region = target.closest<HTMLElement>('[data-query-result-find-open]');
  return !!region && root.contains(region) && !gridFindModalBlocked(region, true);
}

/** 查找栏与快捷键仅包住当前结果网格；私有代次负责取消。 */
export function QueryResultFind({ owner, rows, columns, checkedRows, grid, control, isCurrent, onHit, onHighlights, onMatchingRows, onShowMatchingRows, onStageFindFilter, findFilterSource, filterDialect, children }: Props) {
  const latest = useRef({ owner, rows, columns, isCurrent }); latest.current = { owner, rows, columns, isCurrent };
  const alive = useRef(true), run = useRef<Run | undefined>(undefined), input = useRef<HTMLInputElement>(null);
  const region = useRef<HTMLDivElement>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const modeSelect = useRef<HTMLSelectElement>(null);
  const panel = useRef<object | undefined>(undefined), mountOwner = useRef<object | undefined>({});
  const [opened, setOpened] = useState<{ owner: object; token: object }>();
  const [query, setQuery] = useState(''), [sensitive, setSensitive] = useState(false);
  const [columnKey, setColumnKey] = useState<string>();
  const [mode, setMode] = useState<QueryResultFindMode>('contains');
  const [checkedOnly, setCheckedOnly] = useState(false);
  const checkedScope = checkedOnly ? checkedRows ?? null : undefined;
  const emptyChecked = checkedScope === null;
  const usesText = isTextResultFind(mode);
  const [highlightAll, setHighlightAll] = useState(false);
  const [incremental, setIncremental] = useState(true), [composing, setComposing] = useState(false);
  const composingInput = useRef(false);
  const [view, setView] = useState<{ run: Run; progress: QueryResultFindProgress; index: number }>();
  /** 原scope或父接纳门变化时仅撤销本地查找，不改变选择或业务资源。 */
  function own(): boolean { try { return alive.current && latest.current.owner === owner && latest.current.rows === rows && latest.current.columns === columns && isCurrent(); } catch { return false; } }
  function cancel() { const previous = run.current; if (!previous) return; previous.scan.cancel(); clearTimeout(previous.timer); run.current = undefined; }
  useEffect(() => { alive.current = true; mountOwner.current ??= {}; return () => { alive.current = false; mountOwner.current = undefined; cancel(); panel.current = undefined; }; }, []);
  useEffect(() => () => { if (run.current?.owner === owner) cancel(); }, [owner]);
  useEffect(() => { if (opened?.owner === owner && panel.current === opened.token && own()) input.current?.focus(); }, [opened, owner]);
  const visible = opened?.owner === owner && panel.current === opened.token;
  // 渲染本身也观察撤销，忙碌/模态等恢复后旧代次仍保持stopped。
  const active = visible && view && view.run === run.current && view.run.scan.current() ? view : undefined;
  const available = own();
  if (view?.run.owner === owner && !available) view.run.scan.cancel();
  const panelCurrent = () => visible && panel.current === opened?.token && own();
  const markCount = highlightAll ? active?.progress.count : undefined;
  const markScan = markCount ? active?.run.scan : undefined;
  // 只在有新增命中或显示开关变化时刷新网格样式，复用原扫描和原坐标。
  useLayoutEffect(() => { onHighlights(markScan); }, [markScan, markCount, onHighlights]);

  /** 条件变化同步撤销旧命中；手动或组词状态只保存新条件，不创建扫描。 */
  function start(value: string, caseSensitive: boolean, selectedColumn: string | undefined, nextMode: QueryResultFindMode, restrict = checkedOnly, scan = incremental) {
    if (!panelCurrent()) return;
    cancel(); setQuery(value); setSensitive(caseSensitive); setColumnKey(selectedColumn); setMode(nextMode); setCheckedOnly(restrict); onHit(undefined);
    if (!scan || composingInput.current) { setView(undefined); return; }
    // RDG每次render重发handle；实例以本挂载/原scope及可取得的原宿主核验，导航使用最新handle。
    const originalMount = mountOwner.current, originalElement = grid.current?.element;
    const rowScope = restrict ? checkedRows ?? null : undefined;
    const next = { owner, rowScope, index: -1 } as Run;
    const regex = nextMode === 'regex' ? new QueryResultRegexWorkerClient(() => new Worker(new URL('../queryResultRegex.worker.ts', import.meta.url), { type: 'module' })) : undefined;
    next.scan = new QueryResultFindScan(rows, columns, value, caseSensitive, () => run.current === next && own() && (!rowScope || rowScope.isCurrent()) && originalMount !== undefined && mountOwner.current === originalMount && grid.current !== null && originalElement !== undefined && (originalElement === null || grid.current.element === originalElement && originalElement.ownerDocument.contains(originalElement)), selectedColumn, nextMode, regex, restrict ? rowScope?.indices ?? [] : undefined);
    run.current = next;
    const progress = next.scan.progress();
    setView({ run: next, progress, index: -1 });
    const advance = async () => {
      if (run.current !== next || !alive.current) return;
      const progress = regex ? await next.scan.stepRegex() : next.scan.step();
      if (run.current !== next || !alive.current) return;
      setView({ run: next, progress, index: next.index });
      if (next.scan.current() && progress.phase === 'searching') next.timer = setTimeout(advance, 0);
    };
    if (progress.phase === 'searching') next.timer = setTimeout(advance, 0);
  }
  // 勾选换代立即撤销旧坐标，并保留原查找条件重新扫描；空勾选不会扩大范围。
  useLayoutEffect(() => {
    if (checkedOnly && run.current && run.current.rowScope !== checkedScope && panelCurrent()) start(query, sensitive, columnKey, mode);
  }, [checkedOnly, checkedScope, visible]);
  /** 列标题带入实际列键。只有切列才撤销旧命中，普通再次打开保留当前定位。 */
  function open(key?: string): boolean {
    if (!own() || !grid.current || !region.current || gridFindModalBlocked(region.current, true)) return false;
    if (key !== undefined && !columns.some(column => column.key === key)) return false;
    if (panelCurrent()) {
      if (key !== undefined && columnKey !== key) start(query, sensitive, key, mode);
      (usesText ? input.current : modeSelect.current)?.focus({ preventScroll: true });
      return true;
    }
    cancel(); composingInput.current = false; setComposing(false); onHit(undefined); panel.current = {}; setOpened({ owner, token: panel.current }); setView(undefined); setQuery(''); setColumnKey(key); setMode('contains'); setCheckedOnly(false);
    return true;
  }
  useImperativeHandle(control, () => ({ openColumn: open }));
  function openFromFocus(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    const host = grid.current?.element;
    const fromGrid = host === target || host?.contains(target) && !target.isContentEditable &&
      !target.closest('input, textarea, select, [role="textbox"], [role="combobox"]');
    return !!(fromGrid || toolbar.current?.contains(target)) && open();
  }
  useLayoutEffect(() => {
    const element = region.current;
    if (!element) return;
    findOpeners.set(element, openFromFocus);
    return () => { findOpeners.delete(element); };
  });
  /** 关闭时把即将卸载的查找控件焦点还给网格。 */
  function close() {
    if (!alive.current || latest.current.owner !== owner || !visible || panel.current !== opened?.token || run.current !== view?.run) return;
    if (toolbar.current?.contains(document.activeElement)) grid.current?.element?.focus({ preventScroll: true });
    cancel(); panel.current = undefined; setOpened(undefined); setView(undefined); onHit(undefined);
  }
  /** 只滚动并标记坐标，不调用setActivePosition或行选择，不改变复制/导出所选行。 */
  function navigate(direction: -1 | 1, keepGridFocus = false) {
    if (!panelCurrent() || !active || run.current !== active.run || !active.run.scan.current()) return;
    const progress = active.run.scan.progress(); if (!progress.count) return;
    const index = active.run.index < 0 ? direction === 1 ? 0 : progress.count - 1 : (active.run.index + direction + progress.count) % progress.count;
    const match = active.run.scan.match(index); if (!match || !grid.current || !own()) return;
    // 大跨度跳转会卸载原数据格，先保留网格宿主焦点以便继续按 F3。
    if (keepGridFocus) grid.current.element?.focus({ preventScroll: true });
    grid.current.scrollToCell({ rowIdx: match.row, idx: match.column + 1 });
    if (!active.run.scan.current() || run.current !== active.run) return;
    active.run.index = index; setView({ run: active.run, progress, index }); onHit({ scan: active.run.scan, match });
  }
  function applyMatchingRows(apply: (indices: ReadonlySet<number>) => void) {
    if (emptyChecked || !panelCurrent() || !active || run.current !== active.run) return;
    const indices = active.run.scan.matchingRows();
    if (indices) apply(indices);
  }
  /** 快捷键只在本包围元素中冒泡；输入法、Alt组合及其它按键均交还原控件。 */
  function keyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (composingInput.current || event.nativeEvent.isComposing || event.keyCode === 229 || event.altKey || !own()) return;
    const direction = visible && !event.defaultPrevented && gridFindDirection(event.nativeEvent, event.currentTarget, toolbar.current, true);
    if (direction) { event.preventDefault(); event.stopPropagation(); if (!event.repeat) navigate(direction, !toolbar.current?.contains(event.target as Node)); return; }
    if (!event.defaultPrevented && !event.repeat && !event.shiftKey && !!event.ctrlKey !== !!event.metaKey &&
        event.key.toLowerCase() === 'f' && openFromFocus(event.target)) { event.preventDefault(); event.stopPropagation(); }
    else if (visible && event.key === 'Escape' && !event.ctrlKey && !event.metaKey) { event.preventDefault(); event.stopPropagation(); close(); }
    else if (visible && event.target === input.current && event.key === 'Enter' && !event.ctrlKey && !event.metaKey) {
      event.preventDefault(); event.stopPropagation();
      if (active) navigate(event.shiftKey ? -1 : 1);
      else if (!event.repeat && canSearch) start(query, sensitive, columnKey, mode, checkedOnly, true);
    }
  }
  const progress = active?.progress;
  const canSearch = available && !emptyChecked && !composing && (!usesText || !!query);
  const canCheckMatches = available && progress?.phase === 'complete' && progress.count > 0;
  const status = composing ? text.composing : emptyChecked ? text.checkedEmpty : usesText && !query ? text.empty : !active ? (incremental ? text.stopped : text.awaitingSearch) : progress?.phase === 'invalid' ? text.invalid :
    progress?.phase === 'searching' ? text.searching(progress.count, progress.scannedCells, progress.totalCells) :
      (progress && regexErrors[progress.phase]) ?? (progress?.count ? text.count(progress.count, active.index) : text.noMatch);
  const hit = active && active.index >= 0 ? active.run.scan.match(active.index) : undefined;
  const filterColumn = visible && findFilterSource ? columns.find(column => column.key === columnKey) : undefined;
  const textFilterable = useMemo(() => queryResultFindTextFilterable(filterColumn, findFilterSource, filterDialect), [filterColumn, findFilterSource, filterDialect]);
  const filterRule = onStageFindFilter && available && active && !checkedOnly && queryResultFindFilterRule(filterColumn, mode, query, sensitive, textFilterable);
  /** 转换当前条件本身，不依赖命中数量或查找上限。旧条件或旧网格不得打开草稿。 */
  function stageFilter() {
    if (!filterRule || !active || !panelCurrent() || run.current !== active.run || !active.run.scan.current()) return;
    onStageFindFilter?.(filterRule);
  }
  return <div ref={region} className="query-result-find-region" data-query-result-find-open={visible ? '' : undefined} onKeyDown={keyDown}>
    <div className="query-result-find-toolbar" ref={toolbar}><button type="button" disabled={!available} aria-expanded={!!visible} onClick={() => open()} title="Ctrl / ⌘ + F">{text.open}</button>
      {visible && <>
        <select ref={modeSelect} aria-label={text.mode} value={mode} disabled={!available}
          onChange={event => start(query, sensitive, columnKey, event.target.value as QueryResultFindMode)}>
          {Object.entries(text.modes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <input ref={input} type="text" aria-label={text.input} value={query} disabled={!usesText}
          onCompositionStart={() => {
            if (!panelCurrent()) return;
            composingInput.current = true; setComposing(true); cancel(); setView(undefined); onHit(undefined);
          }} onCompositionEnd={event => {
            if (!composingInput.current) return;
            composingInput.current = false; setComposing(false);
            start(event.currentTarget.value, sensitive, columnKey, mode);
          }} onChange={event => start(event.target.value, sensitive, columnKey, mode)}/>
        <select aria-label={text.columns} value={columnKey === undefined ? '' : 'column:' + columnKey} disabled={!available}
          onChange={event => { const value = event.target.value; start(query, sensitive, value ? value.slice('column:'.length) : undefined, mode); }}>
          <option value="">{text.allColumns}</option>
          {columns.map((column, index) => <option key={column.key} value={'column:' + column.key}>{text.columnOption(column.name, index + 1)}</option>)}
        </select>
        <label className="check"><input type="checkbox" checked={sensitive} disabled={!usesText} onChange={event => start(query, event.target.checked, columnKey, mode)}/>{text.sensitive}</label>
        <label className="check"><input type="checkbox" checked={highlightAll} onChange={event => setHighlightAll(event.target.checked)}/>{text.highlightAll}</label>
        <label className="check"><input type="checkbox" checked={incremental} disabled={!available || composing} onChange={event => {
          const enabled = event.target.checked;
          setIncremental(enabled); start(query, sensitive, columnKey, mode, checkedOnly, enabled);
        }}/>{text.incremental}</label>
        <label className="check"><input type="checkbox" checked={checkedOnly} disabled={!available}
          onChange={event => start(query, sensitive, columnKey, mode, event.target.checked)}/>{checkedText.checkedOnly}</label>
        {!incremental && <button type="button" disabled={!canSearch} onClick={() => start(query, sensitive, columnKey, mode, checkedOnly, true)}>{text.search}</button>}
        <button type="button" aria-label={text.previous} disabled={!active?.progress.count || !available} onClick={() => navigate(-1)}>↑</button>
        <button type="button" aria-label={text.next} disabled={!active?.progress.count || !available} onClick={() => navigate(1)}>↓</button>
        <button type="button" title={text.checkRowsHint} disabled={!canCheckMatches || checkedOnly} onClick={() => applyMatchingRows(indices => onMatchingRows(indices, true))}>{text.checkRows}</button>
        <button type="button" title={text.checkRowsHint} disabled={!canCheckMatches} onClick={() => applyMatchingRows(indices => onMatchingRows(indices, false))}>{text.uncheckRows}</button>
        {onShowMatchingRows && <button type="button" disabled={!available || emptyChecked || progress?.phase !== 'complete' || usesText && !query}
          onClick={() => applyMatchingRows(onShowMatchingRows)}>{text.showMatchingRows}</button>}
        {onStageFindFilter && <button type="button" disabled={!filterRule} title={checkedOnly ? text.stageFilterChecked : filterRule ? text.stageFilterHint : text.stageFilterUnavailable}
          onClick={stageFilter}>{text.stageFilter}</button>}
        <button type="button" aria-label={text.close} onClick={close}>×</button>
      </>}
    </div>
    {visible && <div className="query-result-find-status"><span role="status" aria-live="polite">{status}</span>{hit && <span>{text.location(hit.row, hit.column)}</span>}{progress?.phase === 'limited' && <strong>{text.limited}</strong>}<span className="muted" title={text.hint}>{checkedOnly ? checkedText.checkedScope(checkedScope?.indices.length ?? 0) : text.scope(rows.length, columnKey === undefined ? columns.length : 1)}</span></div>}
    <div className="query-result-find-grid">{children}</div>
  </div>;
}
