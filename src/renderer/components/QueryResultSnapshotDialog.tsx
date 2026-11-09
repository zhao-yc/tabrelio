import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { QueryResult } from '../../shared/contracts';
import { parseQueryResultSnapshot, type QueryResultSnapshotDocument } from '../../shared/queryResultSnapshot';
import { queryResultSnapshotViewerZh as text } from '../locales/queryResultSnapshotViewer.zh-CN';
import { errorMessage, invoke } from '../lib';
import { useWorkspace } from '../store';
import { appModalSelector } from '../modalSelectors';
import { ResultExportSelection, type ResultGridSelection } from '../resultExport';
import { QueryResultSort, type QueryResultSortBinding, type QueryResultSortRule, type QueryResultSortView } from '../queryResultSort';
import { QueryResultFilter, type QueryResultFilterBinding, type QueryResultFilterGroup, type QueryResultFilterView } from '../queryResultFilter';
import { prepareQueryResultOrganization } from '../queryResultHistory';
import { queryResultFilterZh as filterText } from '../locales/queryResultFilter.zh-CN';
import { queryResultSortZh as sortText } from '../locales/queryResultSort.zh-CN';
import { ResultsGrid } from './ResultsGrid';
import { ResultExportDialog } from './ResultExportDialog';
import { QueryResultSortPanel } from './QueryResultSortPanel';
import { QueryResultFilterPanel } from './QueryResultFilterPanel';
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
interface Operation { mode: 'open' | 'save'; epoch: number; source: Loaded | undefined; }
type SnapshotSort = { kind: 'sort'; binding: QueryResultSortBinding; initial: QueryResultSortView };
type SnapshotFilter = { kind: 'filter'; binding: QueryResultFilterBinding; initial: QueryResultFilterView };
type SnapshotOverlay = SnapshotSort | SnapshotFilter | { kind: 'export'; result: QueryResult; selected: boolean };

/** 全局查看只持有文件内容，不创建查询、连接或会话；原文件Promise包括主进程清理。 */
export function QueryResultSnapshotDialog({ onClose, services = queryResultSnapshotViewerServices }: { onClose(): void; services?: QueryResultSnapshotViewerServices }) {
  const [loaded, setLoaded] = useState<Loaded>(), loadedRef = useRef(loaded);
  const [busy, setBusy] = useState<'open' | 'save'>(), [error, setError] = useState(''), [message, setMessage] = useState(''), [showSql, setShowSql] = useState(false);
  const [overlay, setOverlay] = useState<SnapshotOverlay>(), overlayRef = useRef<SnapshotOverlay | undefined>(undefined);
  const exportSelection = useMemo(() => new ResultExportSelection(), []);
  const [, refreshSelection] = useState(0);
  const returnFocus = useRef<HTMLButtonElement | null>(null);
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
  const matches = useQueryResultMatchView(sortView?.result ?? filterView?.result ?? sourceResult, sourceResult?.columns, [loaded?.scope]);
  const displayed = matches.result;
  const binding = exportSelection.bind(displayed, [loaded?.scope]);
  const checkedCount = exportSelection.count(binding);
  useLayoutEffect(() => { alive.current = true; lifetime.current++; return () => { alive.current = false; lifetime.current++; }; }, []);
  useLayoutEffect(() => { committed.current = ticket; return () => { if (committed.current === ticket) committed.current = null; }; });
  useLayoutEffect(() => {
    if (!overlay && returnFocus.current) {
      returnFocus.current.focus({ preventScroll: true });
      returnFocus.current = null;
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
      openOverlay({ kind: 'export', result, selected }, trigger);
    } catch (reason) { setError(errorMessage(reason)); }
  }
  function openOverlay(view: SnapshotOverlay, trigger: HTMLButtonElement): void {
    returnFocus.current = trigger;
    overlayRef.current = view;
    advance(); setOverlay(view); setError('');
  }
  function closeOverlay(view: SnapshotOverlay): void {
    if (!alive.current || overlayRef.current !== view) return;
    overlayRef.current = undefined;
    advance(); setOverlay(undefined);
  }
  function sortDraftCurrent(draft: SnapshotSort): boolean {
    return alive.current && overlayRef.current === draft && sorter.view(draft.binding) === draft.initial;
  }
  /** 只重排内存中的原行，匹配范围跟随行身份；文件和完整快照仍保留原序。 */
  function publishSort(binding: QueryResultSortBinding, initial: QueryResultSortView, rules: QueryResultSortRule[]): void {
    const next = sorter.apply(binding, initial, rules);
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
  function openFilter(trigger: HTMLButtonElement): void {
    if (!editable() || !filterBinding || !filterView || filter.view(filterBinding) !== filterView) return;
    openOverlay({ kind: 'filter', binding: filterBinding, initial: filterView }, trigger);
  }
  /** 在独立控制器完整验证筛选和现有排序，失败时原网格和条件草稿均保持。 */
  function publishFilter(expression: QueryResultFilterGroup): boolean {
    if (!loaded || !sourceResult) return false;
    try {
      const next = prepareQueryResultOrganization(sourceResult, [loaded.scope], sourceResult.columns,
        { expression, sort: sortView?.rules ?? [] }, dialect);
      matches.reproject(next.sorter.view(next.sortBinding)!.result);
      filter.invalidate(); sorter.invalidate(); exportSelection.invalidate();
      setOrganization(next);
      advance(); setError('');
      return true;
    } catch (reason) { setError(errorMessage(reason)); return false; }
  }
  function applyFilter(draft: SnapshotFilter, expression: QueryResultFilterGroup): void {
    if (filterDraftCurrent(draft) && publishFilter(expression)) closeOverlay(draft);
  }
  function clearFilter(): void {
    if (loaded && gridCurrent(loaded, interaction, false)) publishFilter({ mode: 'AND', children: [] });
  }
  /** 只有准确原操作能更新显示；失效保存仍报告已写可能性或原Main错误。 */
  async function file(mode: 'open' | 'save'): Promise<void> {
    if (!editable() || mode === 'save' && (!loaded || loadedRef.current !== loaded)) return;
    const port = callbacks.current.services, active: Operation = { mode, epoch: lifetime.current, source: loadedRef.current };
    operation.current = active; advance(); setBusy(mode); setError(''); setMessage('');
    const current = () => alive.current && lifetime.current === active.epoch && operation.current === active && callbacks.current.services === port && loadedRef.current === active.source && visible() && topmost();
    try {
      if (mode === 'open') {
        const selected = await port.open();
        if (!current()) return;
        if (selected === null) { setMessage(text.cancelled); return; }
        const snapshot = parseQueryResultSnapshot(selected.snapshot); if (!current()) return;
        const next = { name: selected.name, snapshot, scope: {} }; loadedRef.current = next;
        setLoaded(next); setOrganization(undefined); setShowSql(false); setMessage('');
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
      <button disabled={!!busy || !binding} onClick={event => openExport(false, event.currentTarget)}>{text.exportShown}</button>
      <button disabled={!!busy || !checkedCount} onClick={event => openExport(true, event.currentTarget)}>{text.exportChecked}</button>
      <button disabled={!!busy || !filterView} onClick={event => openFilter(event.currentTarget)}>{filterText.open}</button>
      <button disabled={!!busy || !sortBinding?.visible.some(column => !sortBinding.reasons.get(column.key))}
        onClick={event => openSort(event.currentTarget)}>{sortText.panelTitle}</button>
      {sortView && sortView.rules.length > 0 && <button disabled={!!busy} onClick={() => sortGrid([])}>{sortText.clear}</button>}
      <button disabled={!!busy || !loaded} onClick={toggleSql}>{showSql ? text.sourceHide : text.sourceShow}</button>
      <span className="grow"/><button disabled={!!busy} onClick={close}>{text.close}</button>
    </div>
    <ErrorBox message={error}/>{busy && <Spinner text={busy === 'open' ? text.opening : text.saving}/>} {message && <p role="status">{message}</p>}
    {loaded && displayed ? <>
      <p role="status">{text.opened(loaded.name)}</p>
      <p>{text.count(loaded.snapshot.result.rows.length, displayed.columns.length)}</p>
      {loaded.snapshot.result.truncated && <p className="warning-text">{text.truncated}</p>}
      {!!filterView?.rules.length && <div className="query-result-keyword">
        <span role="status">{filterText.counts(loaded.snapshot.result.rows.length, filterView.result.rows.length)}</span>
        <button type="button" disabled={!!busy} onClick={clearFilter}>{filterText.clear}</button>
      </div>}
      {matches.active && <QueryResultMatchView active={matches.active} disabled={!!busy} onClear={() => changeMatchView()}/>}
      <div className="query-result-snapshot-viewer-grid">
        <ResultsGrid columns={displayed.columns} rows={displayed.rows} selectionScope={binding ?? loaded.scope}
          onSelectionChange={binding ? selectRows : undefined}
          sort={sortView ? [...sortView.rules] : undefined} sortReasons={sortBinding?.reasons} onSortChange={sortView ? sortGrid : undefined}
          sqliteSource={displayed.sqliteStorage ? displayed : undefined} onShowMatchingRows={changeMatchView}
          isCurrent={() => gridCurrent(loaded, interaction, false)} binarySourceIdentity={binaryIdentity}
          binaryIsCurrent={() => gridCurrent(loaded, interaction, true)} binaryFileActions={false}/>
      </div>
      {showSql && <section className="query-result-snapshot-viewer-sql" aria-label={text.sourceTitle}>
        <p>{text.sourceTitle}</p><SqlEditor value={loaded.snapshot.result.statement} dialect={loaded.snapshot.version === 3 ? 'postgresql' : undefined} readOnly height={180}/>
      </section>}
    </> : <p>{text.empty}</p>}
  </div></Modal></div>
    {overlay?.kind === 'export' && <ResultExportDialog scope="snapshot" result={overlay.result} selected={overlay.selected} onClose={() => closeOverlay(overlay)}/>}
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
      <QueryResultFilterPanel offline binding={overlay.binding} initial={overlay.initial} isCurrent={() => filterDraftCurrent(overlay)}
        onApply={expression => applyFilter(overlay, expression)} onClose={() => closeOverlay(overlay)}/>
      <ErrorBox message={error}/>
    </Modal>}
  </>;
}
