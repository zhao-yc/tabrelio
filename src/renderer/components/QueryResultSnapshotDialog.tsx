import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ColumnWidths } from 'react-data-grid';
import type { QueryResult, ResultColumn } from '../../shared/contracts';
import { parseQueryResultSnapshot, type QueryResultSnapshotDocument } from '../../shared/queryResultSnapshot';
import { queryResultSnapshotViewerZh as text } from '../locales/queryResultSnapshotViewer.zh-CN';
import { errorMessage, invoke, uid } from '../lib';
import { useWorkspace } from '../store';
import { appModalSelector } from '../modalSelectors';
import { ResultExportSelection, type ResultGridSelection, type ResultSelectionBinding } from '../resultExport';
import { frozenQueryResultKeys, queryResultColumnKeys, queryResultColumnWidth, queryResultVisibleColumns, type QueryResultColumnLayout } from '../queryResultColumns';
import type { GridRangeExportData } from '../gridRangeExport';
import { QueryResultSort, type QueryResultSortBinding, type QueryResultSortRule, type QueryResultSortView, type SortDialect } from '../queryResultSort';
import { appendQueryResultFilterNode, QueryResultFilter, type QueryResultFilterBinding, type QueryResultFilterGroup, type QueryResultFilterRule, type QueryResultFilterView } from '../queryResultFilter';
import { captureQueryResultCellFilter, queryResultCellFilterNode, type CellFilterOperator } from '../queryResultCellFilter';
import type { QueryResultCopyCell } from '../queryResultHeaderCopy';
import { QueryRowDetails, type QueryRowDetailsView } from '../queryRowDetails';
import { currentQueryResultSelectedFilter, queryResultSelectedFilterNode, type QueryResultSelectedFilterCapture, type QueryResultSelectedFilterMode } from '../queryResultSelectedFilter';
import { prepareQueryResultOrganization, QueryResultHistory } from '../queryResultHistory';
import { queryResultFilterZh as filterText } from '../locales/queryResultFilter.zh-CN';
import { queryResultSortZh as sortText } from '../locales/queryResultSort.zh-CN';
import { queryResultStatisticsZh as statisticsText } from '../locales/queryResultStatistics.zh-CN';
import { queryResultHistoryZh as historyText } from '../locales/queryResultHistory.zh-CN';
import { queryRowDetailsZh as detailText } from '../locales/queryRowDetails.zh-CN';
import { queryResultColumnsZh as columnText } from '../locales/queryResultColumns.zh-CN';
import { ResultsGrid } from './ResultsGrid';
import { ResultExportDialog } from './ResultExportDialog';
import { QueryResultSortPanel } from './QueryResultSortPanel';
import { QueryResultComparisonDialog, type QueryResultComparisonSource } from './QueryResultComparisonDialog';
import { QueryResultFilterPanel } from './QueryResultFilterPanel';
import { QueryResultStatisticsDialog } from './QueryResultStatisticsDialog';
import { QueryRowDetailsPanel } from './QueryRowDetailsPanel';
import { QueryResultColumnsDialog } from './QueryResultColumnsDialog';
import { escapeTargetsQueryResultFind } from './QueryResultFind';
import { QueryResultMatchView, useQueryResultMatchView } from './QueryResultMatchView';
import { SqlEditor } from './SqlEditor';
import { UsageHelp, ErrorBox, Modal, Spinner  } from './ui';
import '../queryResultSnapshotViewer.css';

export interface QueryResultSnapshotViewerServices {
  open(): Promise<{ name: string; snapshot: QueryResultSnapshotDocument } | null>;
  save(snapshot: QueryResultSnapshotDocument): Promise<{ name: string } | null>;
}
export const queryResultSnapshotViewerServices: QueryResultSnapshotViewerServices = {
  open: () => invoke('resultSnapshotFiles.open', {}), save: snapshot => invoke('resultSnapshotFiles.save', { snapshot }),
};
interface Loaded { name: string; snapshot: QueryResultSnapshotDocument; scope: object; }
type FileMode = 'open' | 'save' | 'compare';
interface Operation { mode: FileMode; epoch: number; source: Loaded | undefined; }
type SnapshotSort = { kind: 'sort'; binding: QueryResultSortBinding; initial: QueryResultSortView };
type SnapshotFilter = { kind: 'filter'; binding: QueryResultFilterBinding; initial: QueryResultFilterView; seed?: QueryResultFilterGroup };
type SnapshotComparison = { kind: 'compare'; owner: string; source: Loaded; files: readonly QueryResultComparisonSource[]; dialect?: SortDialect };
type SnapshotStatistics = { kind: 'statistics'; owner: string; source: Loaded; result: QueryResult; column: ResultColumn; indices: ReadonlySet<number> };
type SnapshotRowDetail = { kind: 'row-detail'; source: Loaded; view: QueryRowDetailsView };
type SnapshotColumns = { kind: 'columns'; owner: string; binding: ResultSelectionBinding; initial: QueryResultColumnLayout };
type SnapshotOverlay = SnapshotSort | SnapshotFilter | SnapshotComparison | SnapshotStatistics | SnapshotRowDetail | SnapshotColumns |
  { kind: 'export'; scope: 'snapshot' | 'rectangle'; result: GridRangeExportData; selected: boolean };

/** 全局查看只持有文件内容，不创建查询、连接或会话；原文件Promise包括主进程清理。 */
export function QueryResultSnapshotDialog({ onClose, services = queryResultSnapshotViewerServices }: { onClose(): void; services?: QueryResultSnapshotViewerServices }) {
  const [loaded, setLoaded] = useState<Loaded>(), loadedRef = useRef(loaded);
  const [busy, setBusy] = useState<FileMode>(), [error, setError] = useState(''), [message, setMessage] = useState(''), [showSql, setShowSql] = useState(false);
  const [overlay, setOverlay] = useState<SnapshotOverlay>(), overlayRef = useRef<SnapshotOverlay | undefined>(undefined);
  const exportSelection = useMemo(() => new ResultExportSelection(), []);
  const [history] = useState(() => new QueryResultHistory());
  const [rowDetails] = useState(() => new QueryRowDetails());
  const [activeDetail, setActiveDetail] = useState<{ scope: object; result: QueryResult; index: number }>();
  const [columnLayout, setColumnLayout] = useState<{ layout: QueryResultColumnLayout; columns: ResultColumn[] }>();
  const [, refreshSelection] = useState(0);
  const returnFocus = useRef<HTMLElement | null>(null);
  const exportTrigger = useRef<HTMLButtonElement | null>(null);
  const filterTrigger = useRef<HTMLButtonElement | null>(null);
  const [interaction, setInteraction] = useState(0), interactionRef = useRef(0), operation = useRef<Operation | null>(null);
  const alive = useRef(false), lifetime = useRef(0), committed = useRef<object | null>(null), host = useRef<HTMLDivElement | null>(null), ticket = {};
  const callbacks = useRef({ onClose, services }); callbacks.current = { onClose, services };
  const sourceResult = loaded?.snapshot.result;
  const dialect = loaded?.snapshot.version === 3 ? 'postgresql' : undefined;
  const initial = useMemo(() => ({ filter: new QueryResultFilter(dialect), sorter: new QueryResultSort(dialect) }), [dialect]);
  const [organization, setOrganization] = useState<typeof initial>();
  const { filter, sorter } = organization ?? initial;
  const filterBinding = filter.bind(sourceResult, [loaded?.scope]);
  const filterView = filter.view(filterBinding);
  const sortBinding = sorter.bind(filterView?.result ?? sourceResult, [loaded?.scope]);
  const sortView = sorter.view(sortBinding);
  const historyBinding = loaded && sourceResult && filterView && sortView ? history.bind(sourceResult, sourceResult.columns, [loaded.scope],
    { expression: filterView.expression, sort: sortView.rules }) : undefined;
  const matches = useQueryResultMatchView(sortView?.result ?? filterView?.result ?? sourceResult, sourceResult?.columns, [loaded?.scope]);
  const displayed = matches.result;
  const visibleColumns = columnLayout?.columns ?? displayed?.columns;
  const frozenKeys = useMemo(() => displayed && columnLayout ? frozenQueryResultKeys(displayed.columns, columnLayout.layout) : undefined,
    [displayed, columnLayout]);
  const detailBinding = rowDetails.bind(displayed, [loaded?.scope]);
  const detailIndex = loaded && displayed && detailBinding && activeDetail?.scope === loaded.scope && activeDetail.result === displayed
    ? activeDetail.index : undefined;
  const binding = exportSelection.bind(displayed, [loaded?.scope], visibleColumns);
  const checkedCount = exportSelection.count(binding);
  useLayoutEffect(() => { alive.current = true; lifetime.current++; return () => { alive.current = false; lifetime.current++; }; }, []);
  useLayoutEffect(() => { committed.current = ticket; return () => { if (committed.current === ticket) committed.current = null; }; });
  useLayoutEffect(() => {
    if (!overlay && returnFocus.current) {
      returnFocus.current.focus({ preventScroll: true });
      returnFocus.current = null;
      // 渲染阶段旧模态仍在 DOM，提交后重新核准网格工具，取消时可继续使用原勾选。
      refreshSelection(value => value + 1);
    }
  }, [overlay]);
  /** 逐级核可见性和真实挂载；内存测试不需要伪造浏览器几何。 */
  function visible(): boolean {
    const element = host.current; if (!element || !document.body.contains(element)) return false;
    for (let node: HTMLElement | null = element; node && node.nodeType === 1; node = node.parentNode as HTMLElement | null) {
      if (node.hidden || node.getAttribute('hidden') !== null || node.getAttribute('aria-hidden') === 'true' || node.style.display === 'none' || node.style.visibility === 'hidden') return false;
    }
    return true;
  }
  /** 等价于host.closest(dialog)，不依赖测试DOM的CSS class选择器或几何实现。 */
  function ownDialog(): Element | undefined { for (let node: HTMLElement | null = host.current; node && node.nodeType === 1; node = node.parentNode as HTMLElement | null) if (node.getAttribute('role') === 'dialog') return node; return undefined; }
  /** 只有当前最上层模态可以关闭或领文件，alertdialog同样阻止穿透。 */
  function topmost(): boolean { const dialogs = document.querySelectorAll(appModalSelector); return !!ownDialog() && dialogs[dialogs.length - 1] === ownDialog(); }
  /** 已提交DOM、可见窗口与同步IO槽必须同时有效，旧按钮不能领取新操作。 */
  function editable(): boolean { return alive.current && committed.current === ticket && !operation.current && !overlayRef.current && visible() && topmost(); }
  /** 开始和结束都推进网格回调代次；同一文件selectionScope保持稳定，旧回调永不复活。 */
  function advance(): void { interactionRef.current++; if (alive.current) setInteraction(interactionRef.current); }
  /** 普通网格拒绝任何其它模态；纯字节显示只认可本查看器内部的嵌套窗口。 */
  function gridCurrent(source: Loaded, epoch: number, binary: boolean): boolean {
    if (!alive.current || operation.current || overlayRef.current || loadedRef.current !== source || interactionRef.current !== epoch || !visible()) return false;
    const own = ownDialog(), dialogs = Array.from(document.querySelectorAll(appModalSelector));
    return !!own && dialogs.every(dialog => dialog === own || binary && !!host.current?.contains(dialog));
  }
  const binaryIdentity = useMemo(() => loaded ? [loaded.scope, interaction] : [], [loaded, interaction]);
  /** Header、footer和Escape共用原IO门；嵌套字节窗口的Escape不能穿透关闭外层。 */
  function close(): void {
    if (!alive.current || committed.current !== ticket || overlayRef.current || !visible() || !topmost()) return;
    if (operation.current) { setMessage(text.waiting); return; }
    callbacks.current.onClose();
  }
  function escape(event: KeyboardEvent): void {
    if (!topmost() || escapeTargetsQueryResultFind(event, host.current)) return;
    // 菜单、定位表单和选区先处理 Escape，避免从捕获阶段关闭整个快照。
    if (event.target instanceof Element && ownDialog()?.contains(event.target) &&
        event.target.closest('[data-grid-cell-menu], .grid-row-jump, [role="gridcell"].grid-cell-in-range')) return;
    event.stopPropagation();
    close();
  }
  /** 匹配筛看只改变当前网格，另存始终读取完整文件。换行视图时同步撤销旧网格回调。 */
  function changeMatchView(indices?: ReadonlySet<number>): void {
    if (!loaded || !gridCurrent(loaded, interaction, false)) return;
    const invalidate = () => {
      advance();
      host.current?.querySelector<HTMLElement>('.query-result-snapshot-viewer-grid [role="grid"]')?.focus({ preventScroll: true });
    };
    try {
      if (indices) matches.apply(indices, invalidate);
      else matches.clear(invalidate);
    } catch (reason) { setError(errorMessage(reason)); }
  }
  /** 勾选回执绑定当前显示顺序，筛看或重开文件后不能把旧索引交给新结果。 */
  function selectRows(selection: ResultGridSelection): boolean {
    if (!loaded || !gridCurrent(loaded, interaction, false)) return false;
    try {
      if (!exportSelection.select(binding, selection)) return false;
      refreshSelection(value => value + 1);
      return true;
    } catch (reason) {
      exportSelection.invalidate();
      refreshSelection(value => value + 1); setError(errorMessage(reason));
      return false;
    }
  }
  /** 打开导出时冻结数据并暂时隐藏查看器，避免两个模态同时接管焦点。 */
  function openExport(selected: boolean, trigger: HTMLButtonElement): void {
    if (!editable() || !loaded || loadedRef.current !== loaded || !binding) return;
    try {
      const result = selected ? exportSelection.snapshot(binding) : exportSelection.allSnapshot(binding);
      openOverlay({ kind: 'export', scope: 'snapshot', result, selected }, trigger);
    } catch (reason) { setError(errorMessage(reason)); }
  }
  /** 网格已冻结显示矩形，交给既有文件导出。结束后回到菜单归还焦点的原格。 */
  function openRangeExport(result: GridRangeExportData): void {
    if (!loaded || !editable() || !gridCurrent(loaded, interaction, false)) return;
    const active = document.activeElement;
    const trigger = active instanceof HTMLElement && active.getAttribute('role') === 'gridcell' && host.current?.contains(active)
      ? active : exportTrigger.current;
    if (trigger) openOverlay({ kind: 'export', scope: 'rectangle', result, selected: false }, trigger);
  }
  function openOverlay(view: SnapshotOverlay, trigger: HTMLElement): void {
    returnFocus.current = trigger;
    overlayRef.current = view;
    advance(); setOverlay(view); setError('');
  }
  function closeOverlay(view: SnapshotOverlay): void {
    if (!alive.current || overlayRef.current !== view) return;
    if (view.kind === 'row-detail') rowDetails.close(view.view);
    overlayRef.current = undefined;
    advance(); setOverlay(undefined);
  }
  /** 活动数据格只指定显示行，不借用勾选或原文件行号。 */
  function selectDetailRow(cell: QueryResultCopyCell | undefined): void {
    if (!loaded || !displayed || !gridCurrent(loaded, interaction, false)) return;
    const index = cell?.column && displayed.rows[cell.index] === cell.row ? cell.index : undefined;
    setActiveDetail(previous => index === undefined ? undefined :
      previous?.scope === loaded.scope && previous.result === displayed && previous.index === index ? previous :
      { scope: loaded.scope, result: displayed, index });
  }
  function openRowDetail(trigger: HTMLButtonElement): void {
    if (!loaded || detailIndex === undefined || !editable()) return;
    try { openOverlay({ kind: 'row-detail', source: loaded, view: rowDetails.open(detailBinding, detailIndex) }, trigger); }
    catch (reason) { setError(errorMessage(reason)); }
  }
  /** 翻行只更换本窗口的行租约，保留字段搜索和查看模式。 */
  function moveRowDetail(draft: SnapshotRowDetail, index: number): void {
    if (!detailCurrent(draft)) return;
    try {
      const next = { ...draft, view: rowDetails.move(draft.view, index) };
      overlayRef.current = next;
      setOverlay(next); setError('');
    } catch (reason) { setError(errorMessage(reason)); }
  }
  function detailCurrent(draft: SnapshotRowDetail): boolean {
    return alive.current && overlayRef.current === draft && loadedRef.current === draft.source &&
      displayed === draft.view.binding.result && !operation.current;
  }
  /** 列布局只改变网格投影，原结果仍用于筛选、排序、详情和完整另存。 */
  function openColumns(trigger: HTMLButtonElement): void {
    if (!editable() || !binding || !exportSelection.current(binding)) return;
    try {
      const keys = queryResultColumnKeys(binding.columns);
      openOverlay({ kind: 'columns', owner: uid(), binding, initial: columnLayout?.layout ?? { order: keys, visible: keys } }, trigger);
    } catch (reason) { setError(errorMessage(reason)); }
  }
  function columnsCurrent(draft: SnapshotColumns): boolean {
    if (!alive.current || overlayRef.current !== draft || !exportSelection.current(draft.binding) || operation.current) return false;
    const viewer = ownDialog();
    const owned = document.querySelector(`[data-query-columns-owner="${draft.owner}"]`)?.querySelector(appModalSelector);
    return !!viewer && Array.from(document.querySelectorAll(appModalSelector)).every(dialog => dialog === viewer || dialog === owned);
  }
  /** 仅列身份或顺序变化才清空网格勾选，宽度和行高不会改动选择。 */
  function applyColumns(draft: SnapshotColumns, layout: QueryResultColumnLayout): void {
    if (!columnsCurrent(draft)) return;
    const columns = queryResultVisibleColumns(draft.binding.columns, layout), previous = draft.binding.visibleColumns;
    const changed = columns.length !== previous.length || columns.some((column, index) => column !== previous[index]);
    if (changed) exportSelection.invalidate();
    setColumnLayout({ layout, columns: changed ? columns : previous });
    closeOverlay(draft);
  }
  /** 拖动只更新已显示列的像素值，保留当前显示行、列序及勾选。 */
  function resizeColumns(sizes: ColumnWidths): void {
    if (!loaded || !displayed || !visibleColumns || !gridCurrent(loaded, interaction, false)) return;
    const widths = new Map(columnLayout?.layout.widths);
    let changed = false;
    for (const { key } of visibleColumns) {
      const size = sizes.get(key);
      if (size?.type !== 'resized' || !Number.isFinite(size.width)) continue;
      const width = Math.max(queryResultColumnWidth.min, Math.min(queryResultColumnWidth.max, Math.round(size.width)));
      if (width === widths.get(key)) continue;
      widths.set(key, width); changed = true;
    }
    if (!changed) return;
    const keys = displayed.columns.map(column => column.key);
    setColumnLayout({ layout: { ...(columnLayout?.layout ?? { order: keys, visible: keys }), widths }, columns: visibleColumns });
  }
  function sortDraftCurrent(draft: SnapshotSort): boolean {
    return alive.current && overlayRef.current === draft && sorter.view(draft.binding) === draft.initial;
  }
  /** 只重排内存中的原行，匹配范围跟随行身份；文件和完整快照仍保留原序。 */
  function publishSort(binding: QueryResultSortBinding, initial: QueryResultSortView, rules: QueryResultSortRule[]): void {
    if (!historyBinding || !filterView) throw Error(historyText.stale);
    const next = sorter.apply(binding, initial, rules);
    history.record(historyBinding, { expression: filterView.expression, sort: next.rules });
    matches.reproject(next.result);
    exportSelection.invalidate();
    advance(); setError('');
  }
  function sortGrid(rules: QueryResultSortRule[]): void {
    if (!loaded || !sortBinding || !sortView || !gridCurrent(loaded, interaction, false)) return;
    try { publishSort(sortBinding, sortView, rules); }
    catch (reason) { setError(errorMessage(reason)); }
  }
  function openSort(trigger: HTMLButtonElement): void {
    if (!editable() || !sortBinding || !sortView || sorter.view(sortBinding) !== sortView) return;
    openOverlay({ kind: 'sort', binding: sortBinding, initial: sortView }, trigger);
  }
  function applySort(draft: SnapshotSort, rules: QueryResultSortRule[]): boolean {
    if (!sortDraftCurrent(draft)) return false;
    publishSort(draft.binding, draft.initial, rules);
    closeOverlay(draft);
    return true;
  }
  function filterDraftCurrent(draft: SnapshotFilter): boolean {
    return alive.current && overlayRef.current === draft && filter.view(draft.binding) === draft.initial;
  }
  function openFilter(trigger: HTMLButtonElement, seed?: QueryResultFilterGroup): void {
    if (!editable() || !filterBinding || !filterView || filter.view(filterBinding) !== filterView) return;
    openOverlay({ kind: 'filter', binding: filterBinding, initial: filterView, seed }, trigger);
  }
  /** 用显示投影里的原格构造条件，SQLite 仍以投影后的逐格存储类型为准。 */
  function openCellFilter(cell: QueryResultCopyCell, operator: CellFilterOperator): void {
    if (!editable() || !displayed || !visibleColumns || !filterView || !filterTrigger.current) return;
    try {
      const capture = captureQueryResultCellFilter(visibleColumns, displayed.rows, cell,
        displayed.sqliteStorage ? displayed : undefined, dialect);
      openFilterRule(queryResultCellFilterNode(capture, operator));
    } catch (reason) { setError(errorMessage(reason)); }
  }
  /** 单格与查找条件追加到当前筛选，原文件及已应用视图保留至明确应用。 */
  function openFilterRule(node: QueryResultFilterRule | QueryResultFilterGroup): void {
    if (!editable() || !filterView || !filterTrigger.current) return;
    try { openFilter(filterTrigger.current, appendQueryResultFilterNode(filterView.expression, node)); }
    catch (reason) { setError(errorMessage(reason)); }
  }
  /** 选区和勾选各核自己的显示范围，草稿追加到完整快照的既有条件。 */
  function openSelectedFilter(capture: QueryResultSelectedFilterCapture, rangeCurrent?: () => boolean, mode: QueryResultSelectedFilterMode = false): void {
    if (!loaded || !displayed || !visibleColumns || !filterBinding || !filterView || !filterTrigger.current) return;
    const current = () => editable() && loadedRef.current === loaded && filter.view(filterBinding) === filterView &&
      (rangeCurrent ? rangeCurrent() : exportSelection.matchesIndices(binding, capture.indices)) &&
      currentQueryResultSelectedFilter(capture, visibleColumns, displayed.rows, displayed);
    if (!current()) return;
    try {
      const seed = appendQueryResultFilterNode(filterView.expression, queryResultSelectedFilterNode(capture, mode));
      if (current() && filterTrigger.current) openFilter(filterTrigger.current, seed);
    } catch (reason) { setError(errorMessage(reason)); }
  }
  /** 冻结本次显示范围，只接受网格与父层共同认定的勾选。 */
  function openStatistics(column: ResultColumn, indices: ReadonlySet<number>): void {
    if (!editable() || !loaded || !displayed?.columns.includes(column) || !filterTrigger.current) return;
    const checked = exportSelection.checkedIndices(binding);
    if (checked.length !== indices.size || checked.some(index => !indices.has(index))) return;
    const active = document.activeElement;
    const trigger = active instanceof HTMLButtonElement && host.current?.contains(active) ? active : filterTrigger.current;
    openOverlay({ kind: 'statistics', owner: uid(), source: loaded, result: displayed, column, indices: new Set(checked) }, trigger);
  }
  /** 扫描和派生筛选只认准确快照与统计模态，字节窗口等其它模态会撤销来源。 */
  function statisticsCurrent(draft: SnapshotStatistics): boolean {
    if (!alive.current || overlayRef.current !== draft || loadedRef.current !== draft.source || displayed !== draft.result || operation.current) return false;
    const viewer = ownDialog();
    const owned = document.querySelector(`[data-query-result-statistics-owner="${draft.owner}"]`)?.querySelector(appModalSelector);
    // 统计组件首次渲染早于自己的 DOM 提交，此时只允许原查看器存在。
    return !!viewer && Array.from(document.querySelectorAll(appModalSelector)).every(dialog => dialog === viewer || dialog === owned);
  }
  /** 统计只提供筛选条件，应用仍由既有面板完成。保留统计入口作为返回焦点。 */
  function filterFromStatistics(draft: SnapshotStatistics, node: QueryResultFilterRule | QueryResultFilterGroup): void {
    if (!statisticsCurrent(draft) || !filterBinding || !filterView || filter.view(filterBinding) !== filterView) throw Error(statisticsText.stale);
    const seed = appendQueryResultFilterNode(filterView.expression, node);
    const next: SnapshotFilter = { kind: 'filter', binding: filterBinding, initial: filterView, seed };
    overlayRef.current = next;
    advance(); setOverlay(next); setError('');
  }
  /** 在独立控制器完整验证筛选和现有排序，失败时原网格和条件草稿均保持。 */
  function publishFilter(expression: QueryResultFilterGroup): boolean {
    if (!loaded || !sourceResult || !historyBinding) return false;
    try {
      const next = prepareQueryResultOrganization(sourceResult, [loaded.scope], sourceResult.columns,
        { expression, sort: sortView?.rules ?? [] }, dialect);
      history.record(historyBinding, { expression: next.filter.view(next.filterBinding)!.expression, sort: next.sorter.view(next.sortBinding)!.rules });
      publishOrganization(next);
      return true;
    } catch (reason) { setError(errorMessage(reason)); return false; }
  }
  function applyFilter(draft: SnapshotFilter, expression: QueryResultFilterGroup): void {
    if (filterDraftCurrent(draft) && publishFilter(expression)) closeOverlay(draft);
  }
  function clearFilter(): void {
    if (loaded && gridCurrent(loaded, interaction, false)) publishFilter({ mode: 'AND', children: [] });
  }
  /** 先试算整套配置，成功后才移动历史游标；按原行身份保留查找筛看的范围。 */
  function travelHistory(direction: -1 | 1): void {
    if (!loaded || !sourceResult || !editable() || !gridCurrent(loaded, interaction, false)) return;
    const target = history.target(historyBinding, direction);
    if (!target) return;
    try {
      const next = prepareQueryResultOrganization(sourceResult, [loaded.scope], sourceResult.columns, target.configuration, dialect);
      history.commit(target);
      publishOrganization(next);
    } catch (reason) { setError(errorMessage(reason)); }
  }
  function publishOrganization(next: ReturnType<typeof prepareQueryResultOrganization>): void {
    matches.reproject(next.sorter.view(next.sortBinding)!.result);
    filter.invalidate(); sorter.invalidate(); exportSelection.invalidate();
    setOrganization(next);
    advance(); setError('');
  }
  /** 允许比较器和其暂时隐藏的父窗口，旧文件或其他模态会撤销比较。 */
  function comparisonCurrent(view: SnapshotComparison): boolean {
    if (!alive.current || overlayRef.current !== view || loadedRef.current !== view.source || operation.current) return false;
    const viewer = ownDialog();
    const comparison = document.querySelector(`[data-query-result-comparison-owner="${view.owner}"]`)?.querySelector(appModalSelector);
    return !!viewer && Array.from(document.querySelectorAll(appModalSelector)).every(dialog => dialog === viewer || dialog === comparison);
  }
  /** 只有准确原操作能更新显示；失效保存仍报告已写可能性或原Main错误。 */
  async function file(mode: FileMode, trigger?: HTMLButtonElement): Promise<void> {
    if (!editable() || mode !== 'open' && (!loaded || loadedRef.current !== loaded) ||
        mode === 'compare' && (!trigger || !sourceResult?.columns.length)) return;
    const port = callbacks.current.services, active: Operation = { mode, epoch: lifetime.current, source: loadedRef.current };
    operation.current = active; advance(); setBusy(mode); setError(''); setMessage('');
    const current = () => alive.current && lifetime.current === active.epoch && operation.current === active && callbacks.current.services === port && loadedRef.current === active.source && visible() && topmost();
    try {
      if (mode !== 'save') {
        const selected = await port.open();
        if (!current()) return;
        if (selected === null) { setMessage(text.cancelled); return; }
        const snapshot = parseQueryResultSnapshot(selected.snapshot); if (!current()) return;
        if (mode === 'compare') {
          const source = active.source!;
          if (source.snapshot.version !== snapshot.version || !snapshot.result.columns.length) throw Error(text.comparisonFormat);
          // 比较固定两份文件的原结果，第二次选择不替换当前文件，也不继承任何筛选投影。
          openOverlay({ kind: 'compare', owner: uid(), source, dialect, files: [
            { id: 'current', label: text.comparisonCurrent(source.name), result: source.snapshot.result },
            { id: 'other', label: text.comparisonOther(selected.name), result: snapshot.result },
          ] }, trigger!);
        } else {
          const next = { name: selected.name, snapshot, scope: {} }; loadedRef.current = next;
          history.invalidate();
          setLoaded(next); setOrganization(undefined); setColumnLayout(undefined); setShowSql(false); setMessage('');
        }
      } else {
        const saved = await port.save(active.source!.snapshot);
        if (saved === null) { if (current()) setMessage(text.cancelled); return; }
        if (current()) setMessage(text.saved(saved.name));
        else useWorkspace.getState().notify(text.lateSave, true);
      }
    } catch (reason) {
      const original = errorMessage(reason);
      if (current()) setError(original); else if (mode === 'save') useWorkspace.getState().notify(original, true);
    } finally {
      // StrictMode/lifetime迟到不发布内容；原槽仍相同才在真实终态解除UI占用。
      if (operation.current === active) { operation.current = null; if (alive.current) { advance(); setBusy(undefined); } }
    }
  }
  /** SQL只控制本窗口只读显隐，不设置编辑器正文或提供任何执行回调。 */
  function toggleSql(): void { if (editable() && loaded && loadedRef.current === loaded) setShowSql(value => !value); }
  return <><div hidden={!!overlay}><Modal title={text.title} wide onClose={close} onEscape={escape}><div ref={host} className="query-result-snapshot-viewer" aria-busy={!!busy}>
    <p>{text.notice}</p><UsageHelp><p>{text.scope}</p></UsageHelp>
    <div className="query-result-snapshot-viewer-actions">
      <button disabled={!!busy} onClick={() => void file('open')}>{text.choose}</button>
      <button disabled={!!busy || !loaded} onClick={() => void file('save')}>{text.save}</button>
      <button disabled={!!busy || !sourceResult?.columns.length} onClick={event => void file('compare', event.currentTarget)}>{text.compare}</button>
      <button ref={exportTrigger} disabled={!!busy || !binding} onClick={event => openExport(false, event.currentTarget)}>{text.exportShown}</button>
      <button disabled={!!busy || !checkedCount} onClick={event => openExport(true, event.currentTarget)}>{text.exportChecked}</button>
      <button ref={filterTrigger} disabled={!!busy || !filterView} onClick={event => openFilter(event.currentTarget)}>{filterText.open}</button>
      <button disabled={!!busy || !binding} onClick={event => openColumns(event.currentTarget)}>{columnText.open}</button>
      <button disabled={!!busy || detailIndex === undefined} title={detailText.choose}
        onClick={event => openRowDetail(event.currentTarget)}>{detailText.open}</button>
      <button disabled={!!busy || !sortBinding?.visible.some(column => !sortBinding.reasons.get(column.key))}
        onClick={event => openSort(event.currentTarget)}>{sortText.panelTitle}</button>
      <button disabled={!!busy || !history.target(historyBinding, -1)} title={history.limited ? historyText.limited : text.historyHint}
        onClick={() => travelHistory(-1)}>{historyText.undo}</button>
      <button disabled={!!busy || !history.target(historyBinding, 1)} title={text.historyHint}
        onClick={() => travelHistory(1)}>{historyText.redo}</button>
      {sortView && sortView.rules.length > 0 && <button disabled={!!busy} onClick={() => sortGrid([])}>{sortText.clear}</button>}
      <button disabled={!!busy || !loaded} onClick={toggleSql}>{showSql ? text.sourceHide : text.sourceShow}</button>
      <span className="grow"/><button disabled={!!busy} onClick={close}>{text.close}</button>
    </div>
    <ErrorBox message={error}/>{busy && <Spinner text={busy === 'open' ? text.opening : busy === 'compare' ? text.comparingFile : text.saving}/>} {message && <p role="status">{message}</p>}
    {loaded && displayed && visibleColumns ? <>
      <p role="status">{text.opened(loaded.name)}</p>
      <p>{text.count(loaded.snapshot.result.rows.length, displayed.columns.length)}</p>
      {visibleColumns.length < displayed.columns.length && <p>{text.visibleColumns(visibleColumns.length, displayed.columns.length)}</p>}
      {loaded.snapshot.result.truncated && <p className="warning-text">{text.truncated}</p>}
      {!!filterView?.rules.length && <div className="query-result-keyword">
        <span role="status">{filterText.counts(loaded.snapshot.result.rows.length, filterView.result.rows.length)}</span>
        <button type="button" disabled={!!busy} onClick={clearFilter}>{filterText.clear}</button>
      </div>}
      {matches.active && <QueryResultMatchView active={matches.active} disabled={!!busy} onClear={() => changeMatchView()}/>}
      <div className="query-result-snapshot-viewer-grid">
        <ResultsGrid rowJump columns={visibleColumns} rows={displayed.rows} selectionScope={binding ?? loaded.scope}
          frozenKeys={frozenKeys} columnWidths={columnLayout?.layout.widths} rowHeight={columnLayout?.layout.rowHeight}
          onColumnWidthsChange={binding ? resizeColumns : undefined}
          onSelectionChange={binding ? selectRows : undefined}
          sort={sortView ? [...sortView.rules] : undefined} sortReasons={sortBinding?.reasons} onSortChange={sortView ? sortGrid : undefined}
          ownDialog={ownDialog} filterDialect={dialect} onFilterSelected={filterView ? openSelectedFilter : undefined}
          onFilterCell={filterView ? openCellFilter : undefined} onStageFindFilter={filterView ? openFilterRule : undefined} findFilterSource={filterBinding?.source}
          onStatistics={filterView ? openStatistics : undefined}
          onExportRange={binding ? openRangeExport : undefined}
          onHistoryTravel={historyBinding ? travelHistory : undefined}
          onActiveCellChange={selectDetailRow}
          sqliteSource={displayed.sqliteStorage ? displayed : undefined} onShowMatchingRows={changeMatchView}
          isCurrent={() => gridCurrent(loaded, interaction, false)} binarySourceIdentity={binaryIdentity}
          binaryIsCurrent={() => gridCurrent(loaded, interaction, true)} binaryFileActions={false}/>
      </div>
      {showSql && <section className="query-result-snapshot-viewer-sql" aria-label={text.sourceTitle}>
        <p>{text.sourceTitle}</p><SqlEditor value={loaded.snapshot.result.statement} dialect={loaded.snapshot.version === 3 ? 'postgresql' : undefined} readOnly height={180}/>
      </section>}
    </> : <p>{text.empty}</p>}
  </div></Modal></div>
    {overlay?.kind === 'export' && <ResultExportDialog scope={overlay.scope} result={overlay.result} selected={overlay.selected} onClose={() => closeOverlay(overlay)}/>}
    {overlay?.kind === 'row-detail' && <Modal title={detailText.open} wide onClose={() => closeOverlay(overlay)}>
      <div className="query-result-snapshot-detail">
        <QueryRowDetailsPanel controller={rowDetails} view={overlay.view} isCurrent={() => detailCurrent(overlay)}
          onMove={(_, index) => moveRowDetail(overlay, index)} onClose={() => closeOverlay(overlay)}/>
        <ErrorBox message={error}/>
      </div>
    </Modal>}
    {overlay?.kind === 'compare' && <QueryResultComparisonDialog offline owner={overlay.owner} pins={overlay.files} dialect={overlay.dialect}
      isCurrent={() => comparisonCurrent(overlay)} onClose={() => closeOverlay(overlay)}/>}
    {overlay?.kind === 'columns' && <QueryResultColumnsDialog binding={overlay.binding} initial={overlay.initial} owner={overlay.owner}
      isCurrent={() => columnsCurrent(overlay)} onApply={layout => applyColumns(overlay, layout)} onClose={() => closeOverlay(overlay)}/>}
    {overlay?.kind === 'statistics' && <QueryResultStatisticsDialog owner={overlay.owner} columns={overlay.result.columns}
      rows={overlay.result.rows} initialColumn={overlay.column} selectedIndices={overlay.indices} truncated={overlay.result.truncated}
      sqliteSource={overlay.result.sqliteStorage ? overlay.result : undefined} dialect={dialect}
      isCurrent={() => statisticsCurrent(overlay)} onClose={() => closeOverlay(overlay)} onFilter={node => filterFromStatistics(overlay, node)}/>}
    {overlay?.kind === 'sort' && <Modal title={sortText.panelTitle} wide onClose={() => closeOverlay(overlay)}>
      <QueryResultSortPanel offline binding={overlay.binding} initial={overlay.initial} isCurrent={() => sortDraftCurrent(overlay)}
        onApply={rules => applySort(overlay, rules)} onClose={() => closeOverlay(overlay)}/>
    </Modal>}
    {overlay?.kind === 'filter' && <Modal title={filterText.title} wide onClose={() => closeOverlay(overlay)} onEscape={event => {
      // 面板内的 Escape 由条件草稿或候选值选择器优先处理。
      if (event.target instanceof Element && event.target.closest('.query-result-filter-panel')) return;
      event.stopPropagation();
      closeOverlay(overlay);
    }}>
      <QueryResultFilterPanel offline binding={overlay.binding} initial={overlay.initial} seed={overlay.seed} isCurrent={() => filterDraftCurrent(overlay)}
        onApply={expression => applyFilter(overlay, expression)} onClose={() => closeOverlay(overlay)}/>
      <ErrorBox message={error}/>
    </Modal>}
  </>;
}
