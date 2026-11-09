import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject, type KeyboardEvent } from 'react';
import type { DataGridHandle } from 'react-data-grid';
import type { DataRow, ResultColumn } from '../../shared/contracts';
import { isTextResultFind, QueryResultFindScan, type QueryResultFindMatch, type QueryResultFindMode, type QueryResultFindPhase, type QueryResultFindProgress } from '../queryResultFind';
import { QueryResultRegexWorkerClient } from '../queryResultRegexWorkerClient';
import { queryResultFindZh as text } from '../locales/queryResultFind.zh-CN';
import { gridFindDirection } from '../gridFindKeys';
import '../queryResultFind.css';

interface Run { owner: object; scan: QueryResultFindScan; timer?: ReturnType<typeof setTimeout>; index: number; }
export interface QueryResultFindHit { scan: QueryResultFindScan; match: QueryResultFindMatch; }
interface Props { owner: object; rows: DataRow[]; columns: ResultColumn[]; grid: RefObject<DataGridHandle | null>; isCurrent(): boolean; onHit(hit: QueryResultFindHit | undefined): void; onHighlights(scan: QueryResultFindScan | undefined): void; children: ReactNode; }
const regexErrors: Partial<Record<QueryResultFindPhase, string>> = text.regexErrors;

/** 查找栏与快捷键仅包住当前结果Grid；私有代次负责取消，绝不注册全局快捷键。 */
export function QueryResultFind({ owner, rows, columns, grid, isCurrent, onHit, onHighlights, children }: Props) {
  const latest = useRef({ owner, rows, columns, isCurrent }); latest.current = { owner, rows, columns, isCurrent };
  const alive = useRef(true), run = useRef<Run | undefined>(undefined), input = useRef<HTMLInputElement>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const modeSelect = useRef<HTMLSelectElement>(null);
  const panel = useRef<object | undefined>(undefined), mountOwner = useRef<object | undefined>({});
  const [opened, setOpened] = useState<{ owner: object; token: object }>();
  const [query, setQuery] = useState(''), [sensitive, setSensitive] = useState(false);
  const [columnKey, setColumnKey] = useState<string>();
  const [mode, setMode] = useState<QueryResultFindMode>('contains');
  const usesText = isTextResultFind(mode);
  const [highlightAll, setHighlightAll] = useState(false);
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

  /** 条件变化都开启新查找，旧定时器不能发布或导航。 */
  function start(value: string, caseSensitive: boolean, selectedColumn: string | undefined, nextMode: QueryResultFindMode) {
    if (!panelCurrent() || run.current !== view?.run) return;
    cancel(); setQuery(value); setSensitive(caseSensitive); setColumnKey(selectedColumn); setMode(nextMode); onHit(undefined);
    // RDG每次render重发handle；实例以本挂载/原scope及可取得的原宿主核验，导航使用最新handle。
    const originalMount = mountOwner.current, originalElement = grid.current?.element;
    const next = { owner, index: -1 } as Run;
    const regex = nextMode === 'regex' ? new QueryResultRegexWorkerClient(() => new Worker(new URL('../queryResultRegex.worker.ts', import.meta.url), { type: 'module' })) : undefined;
    next.scan = new QueryResultFindScan(rows, columns, value, caseSensitive, () => run.current === next && own() && originalMount !== undefined && mountOwner.current === originalMount && grid.current !== null && originalElement !== undefined && (originalElement === null || grid.current.element === originalElement && originalElement.ownerDocument.contains(originalElement)), selectedColumn, nextMode, regex);
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
  function open() {
    if (!own() || !grid.current) return;
    cancel(); onHit(undefined); panel.current = {}; setOpened({ owner, token: panel.current }); setView(undefined); setQuery(''); setColumnKey(undefined); setMode('contains');
  }
  function close() { if (!alive.current || latest.current.owner !== owner || !visible || panel.current !== opened?.token || run.current !== view?.run) return; cancel(); panel.current = undefined; setOpened(undefined); setView(undefined); onHit(undefined); }
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
  /** 快捷键只在本包围元素中冒泡；输入法、Alt组合及其它按键均交还原控件。 */
  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.nativeEvent.isComposing || event.altKey || !own()) return;
    const direction = visible && !event.defaultPrevented && gridFindDirection(event.nativeEvent, event.currentTarget, toolbar.current);
    if (direction) { event.preventDefault(); event.stopPropagation(); if (!event.repeat) navigate(direction, !toolbar.current?.contains(event.target as Node)); return; }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); event.stopPropagation(); if (panelCurrent()) (usesText ? input.current : modeSelect.current)?.focus(); else open(); }
    else if (visible && event.key === 'Escape' && !event.ctrlKey && !event.metaKey) { event.preventDefault(); event.stopPropagation(); close(); }
    else if (visible && event.target === input.current && event.key === 'Enter' && !event.ctrlKey && !event.metaKey) { event.preventDefault(); event.stopPropagation(); navigate(event.shiftKey ? -1 : 1); }
  }
  const progress = active?.progress;
  const status = usesText && !query ? text.empty : !active ? text.stopped : progress?.phase === 'invalid' ? text.invalid :
    progress?.phase === 'searching' ? text.searching(progress.count, progress.scannedCells, progress.totalCells) :
      (progress && regexErrors[progress.phase]) ?? (progress?.count ? text.count(progress.count, active.index) : text.noMatch);
  const hit = active && active.index >= 0 ? active.run.scan.match(active.index) : undefined;
  return <div className="query-result-find-region" onKeyDown={keyDown}>
    <div className="query-result-find-toolbar" ref={toolbar}><button type="button" disabled={!available} aria-expanded={!!visible} onClick={open} title="Ctrl / ⌘ + F">{text.open}</button>
      {visible && <>
        <select ref={modeSelect} aria-label={text.mode} value={mode} disabled={!available}
          onChange={event => start(query, sensitive, columnKey, event.target.value as QueryResultFindMode)}>
          {Object.entries(text.modes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <input ref={input} type="text" aria-label={text.input} value={query} disabled={!usesText}
          onChange={event => start(event.target.value, sensitive, columnKey, mode)}/>
        <select aria-label={text.columns} value={columnKey === undefined ? '' : 'column:' + columnKey} disabled={!available}
          onChange={event => { const value = event.target.value; start(query, sensitive, value ? value.slice('column:'.length) : undefined, mode); }}>
          <option value="">{text.allColumns}</option>
          {columns.map((column, index) => <option key={column.key} value={'column:' + column.key}>{text.columnOption(column.name, index + 1)}</option>)}
        </select>
        <label className="check"><input type="checkbox" checked={sensitive} disabled={!usesText} onChange={event => start(query, event.target.checked, columnKey, mode)}/>{text.sensitive}</label>
        <label className="check"><input type="checkbox" checked={highlightAll} onChange={event => setHighlightAll(event.target.checked)}/>{text.highlightAll}</label>
        <button type="button" aria-label={text.previous} disabled={!active?.progress.count || !available} onClick={() => navigate(-1)}>↑</button>
        <button type="button" aria-label={text.next} disabled={!active?.progress.count || !available} onClick={() => navigate(1)}>↓</button>
        <button type="button" aria-label={text.close} onClick={close}>×</button>
      </>}
    </div>
    {visible && <div className="query-result-find-status"><span role="status" aria-live="polite">{status}</span>{hit && <span>{text.location(hit.row, hit.column)}</span>}{progress?.phase === 'limited' && <strong>{text.limited}</strong>}<span className="muted" title={text.hint}>{text.scope(rows.length, columnKey === undefined ? columns.length : 1)}</span></div>}
    <div className="query-result-find-grid">{children}</div>
  </div>;
}
