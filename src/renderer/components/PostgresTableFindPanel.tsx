import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { FilterRule, ResultColumn } from '../../shared/contracts';
import type { DraftRow } from '../dataChanges';
import { cellPreview, errorMessage } from '../lib';
import { findKindAllowsReplacement, pageFindLimits, pageOccurrences, type PageFindOptions, type PageOccurrence, type PageTextPatch } from '../pageFindReplace';
import { PageFindWorkerClient } from '../pageFindWorkerClient';
import type { PostgresFindPlan } from '../postgresTableFind';
import { queryResultFindZh } from '../locales/queryResultFind.zh-CN';
import { postgresTableFindZh as text } from '../locales/postgresTableFind.zh-CN';
import { postgresTableZh as tableText } from '../locales/postgresTable.zh-CN';
import { GridFindMatchActions, type GridMatchRowsAction } from './GridRowSelectionActions';
import { ErrorBox } from './ui';
import type { GridFindTarget } from './ResultsGrid';
import { tableFindFilterRule } from '../tableFindFilter';
import { tableFindFilterZh as filterText } from '../locales/tableFindFilter.zh-CN';
import type { TableFindEdge } from '../tableFindPattern';
import { TableFindEdgeSelect } from './TableFindEdgeSelect';
import type { ResultCheckedRows } from '../resultExport';

export interface PostgresFindRequest { replace: boolean; column?: string; }
type Mode = 'text' | 'empty' | 'null' | 'field';
type Review = Pick<PostgresFindPlan, 'patches'>;
interface Props<Column extends ResultColumn, Plan extends Review> {
  request?: PostgresFindRequest; scope: object; pageKey?: string; enabled: boolean; writable: boolean; rows: DraftRow[];
  replacementRows?: DraftRow[];
  replaceSelection?: ResultCheckedRows | null;
  host?: { className: string; inert?: boolean };
  columns: Column[]; isCurrent(): boolean; anchor(): GridFindTarget | undefined;
  replaceWritable(column: Column): boolean;
  shortcuts?: boolean; scopeDescription?: string; replaceScopeDescription?: string;
  onOpen(replace: boolean): void; onClose(): void;
  onPreview(patches: readonly PageTextPatch[]): Plan;
  onStage(scope: object, plan: Plan): void;
  onMatchRows?: GridMatchRowsAction<string>;
  onStageFilter?(rule: FilterRule): void;
  renderGrid(target?: GridFindTarget, highlights?: ReadonlySet<string>): ReactNode;
}

/** 数据使用现有有界工作线程，字段名在本地目录中匹配。每次更换来源都撤销旧替换计划。 */
export function PostgresTableFindPanel<Column extends ResultColumn, Plan extends Review>(props: Props<Column, Plan>) {
  const { request, scope, pageKey, enabled, writable, rows, replacementRows, replaceSelection, columns, isCurrent, anchor, replaceWritable, host,
    shortcuts = true, scopeDescription = text.scope, replaceScopeDescription = text.replaceScope, onOpen, onClose, onPreview, onStage, onMatchRows, onStageFilter, renderGrid } = props;
  const [mode, setMode] = useState<Mode>('text'), [column, setColumn] = useState('');
  const [query, setQuery] = useState(''), [replacement, setReplacement] = useState('');
  const [regex, setRegex] = useState(false), [capture, setCapture] = useState(false);
  const [sensitive, setSensitive] = useState(false), [whole, setWhole] = useState(false), [highlight, setHighlight] = useState(true);
  const [edge, setEdge] = useState<TableFindEdge>();
  const [checkedRequest, setCheckedRequest] = useState<PostgresFindRequest>();
  const checkedOnly = !!request && checkedRequest === request;
  const checked = checkedOnly ? replaceSelection : undefined;
  const searchRows = useMemo(() => checkedOnly ? checked?.indices.map(index => rows[index]).filter(row => row && !row.deleted) ?? [] : rows, [checkedOnly, checked, rows]);
  const writableRows = useMemo(() => replacementRows && (checkedOnly ? checked?.indices.map(index => replacementRows[index]) ?? [] : replacementRows), [checkedOnly, checked, replacementRows]);
  const [composing, setComposing] = useState(false);
  const [incremental, setIncremental] = useState(true);
  const queryInput = useRef<HTMLInputElement>(null), replacementInput = useRef<HTMLInputElement>(null);
  const modeInput = useRef<HTMLSelectElement>(null);
  const stageButton = useRef<HTMLButtonElement>(null);
  const client = useRef<PageFindWorkerClient>(undefined);
  const resume = useRef<{ request: PostgresFindRequest; pageKey?: string; query: string; hit: PageOccurrence; end: number }>(undefined);
  const snapshot = useMemo(() => ({ request, scope, enabled, searchRows, writableRows, checkedOnly, checked, columns, mode, column, query, sensitive, whole, edge, regex, composing }),
    [request, scope, enabled, searchRows, writableRows, checkedOnly, checked, columns, mode, column, query, sensitive, whole, edge, regex, composing]);
  const latest = useRef(snapshot); latest.current = snapshot;
  const [manual, setManual] = useState<{ snapshot: typeof snapshot }>();
  const runningPreview = useRef<{ snapshot: typeof snapshot }>(undefined);
  const [preparing, setPreparing] = useState<typeof snapshot>();
  const [result, setResult] = useState<{ snapshot: typeof snapshot; hits: PageOccurrence[]; error?: string }>();
  const [position, setPosition] = useState<{ snapshot: typeof snapshot; index: number }>();
  const [preview, setPreview] = useState<{ snapshot: typeof snapshot; replacement: string; plan: Plan; only?: PageOccurrence }>();
  const [error, setError] = useState('');
  const found = result?.snapshot === snapshot ? result : undefined;
  const chosen = position?.snapshot === snapshot ? position.index : -1;
  const review = preview?.snapshot === snapshot && preview.replacement === replacement ? preview : undefined;
  const hit = found?.hits[chosen];
  const needsQuery = mode === 'text' || mode === 'field';
  const emptyChecked = checkedOnly && !searchRows.length && mode !== 'field';
  const canSearch = (!needsQuery || !!query) && !emptyChecked;
  const kind = mode === 'field' ? 'text' : mode;
  const replaceVisible = request?.replace && mode !== 'field' && findKindAllowsReplacement(kind);
  const canReplace = writable && enabled && replaceVisible;
  const pending = preparing === snapshot;
  const locked = pending || !!review;
  const options: PageFindOptions = { kind, query, caseSensitive: sensitive, wholeCell: whole, edge: mode === 'text' ? edge : undefined, regex: mode === 'text' && regex, column: column || undefined };
  const findFilter = onStageFilter && mode !== 'field'
    ? tableFindFilterRule(options, columns.find(item => item.key === column), 'postgresql') : undefined;
  // 勾选索引仍使用原显示位置，变化会撤销在途扫描和预览；空范围不会退回全结果。
  const rowsCurrent = () => !checkedOnly || !!checked?.isCurrent();

  useEffect(() => {
    if (!request || !enabled) return;
    (request.replace ? replacementInput.current ?? queryInput.current : queryInput.current ?? modeInput.current)?.focus();
  }, [request]);
  /** 列标题入口仅改变本页查找范围；字段名模式切回数据，旧快照随范围变化撤销。 */
  useLayoutEffect(() => {
    const key = request?.column;
    if (key === undefined || !enabled || !isCurrent() || !columns.some(item => item.key === key)) return;
    setColumn(key);
    setMode(current => current === 'field' ? 'text' : current);
  }, [request]);
  // 预览在工作线程返回后展开。窄窗工具栏换行时，把暂存操作滚入面板可视区。
  useLayoutEffect(() => {
    if (review) stageButton.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [review]);
  useEffect(() => { if (column && !columns.some(item => item.key === column)) setColumn(''); }, [columns, column]);
  useEffect(() => () => { void client.current?.dispose(); client.current = undefined; }, []);
  useEffect(() => {
    if (!request || !enabled || !canSearch || composing || (!incremental && manual?.snapshot !== snapshot)) return;
    let cancelled = false;
    const accepts = () => !cancelled && latest.current === snapshot && isCurrent() && (mode === 'field' || rowsCurrent());
    const selected = anchor();
    const next = resume.current;
    resume.current = undefined;
    const keys = columns.map(column => column.key);
    const publish = (hits: PageOccurrence[]) => {
      if (!accepts()) return;
      const sameSearch = next?.request === request && next.pageKey === pageKey && next.query === query;
      const startColumn = keys.indexOf(sameSearch ? next.hit.key : selected?.key ?? '');
      const startRow = mode === 'field' ? -1 : sameSearch ? Number(next.hit.rowId) : selected?.row ?? 0;
      const first = hits.findIndex(hit => {
        const row = Number(hit.rowId), column = keys.indexOf(hit.key);
        return row > startRow || row === startRow && (column > startColumn ||
          column === startColumn && (!sameSearch || (hit.range?.start ?? 0) >= next.end));
      });
      setPosition({ snapshot, index: hits.length ? Math.max(first, 0) : -1 });
      setResult({ snapshot, hits });
    };
    const timer = setTimeout(async () => {
      if (!accepts()) return;
      if (mode === 'field') {
        const needle = sensitive ? query : query.toLowerCase();
        publish(columns.filter(column => {
          const name = sensitive ? column.name : column.name.toLowerCase();
          return whole ? name === needle : edge === 'start' ? name.startsWith(needle) : edge === 'end' ? name.endsWith(needle) : name.includes(needle);
        }).map(column => ({ rowId: '-1', key: column.key, occurrence: 1 })));
        return;
      }
      client.current ??= new PageFindWorkerClient(() => new Worker(new URL('../pageFind.worker.ts', import.meta.url), { type: 'module' }));
      const answer = await client.current.run({ operation: 'find', rows: searchRows, keys, options: { ...options, kind: mode }, generation: 0 });
      if (!accepts()) return;
      if (answer.status === 'ready' && answer.operation === 'find') publish(pageOccurrences(answer.matches));
      else if (answer.status === 'blocked') setResult({ snapshot, hits: [], error: answer.message });
    }, 100);
    return () => { cancelled = true; clearTimeout(timer); void client.current?.cancel(); };
  }, [snapshot, canSearch, incremental, manual]);

  const target = useMemo(() => hit ? { row: Number(hit.rowId), key: hit.key } : undefined, [hit, position]);
  const marks = useMemo(() => request && highlight && found ? new Set(found.hits.map(match => match.rowId + ':' + match.key)) : undefined,
    [request, highlight, found]);
  const replaceKeys = useMemo(() => new Set(columns.filter(replaceWritable).map(column => column.key)), [columns, replaceWritable]);
  const replacementById = useMemo(() => writableRows && new Map(writableRows.map(row => [row.id, row.data])), [writableRows]);
  const canReplaceHit = (target: PageOccurrence) => {
    if (!target.range || !replaceKeys.has(target.key)) return false;
    if (!replacementById) return true;
    const value = replacementById.get(target.rowId)?.[target.key];
    return mode === 'empty' ? value === '' : typeof value === 'string';
  };
  const hasWritable = canReplace && found?.hits.some(canReplaceHit);
  const oneWritable = canReplace && hit && canReplaceHit(hit);

  /** 字段名模式没有数据行；只允许完整数据命中调整当前页勾选。 */
  function matchRows(checked: boolean): void {
    if (mode === 'field' || !found?.hits.length || found.error || locked || composing ||
        latest.current !== snapshot || !isCurrent() || !rowsCurrent()) return;
    onMatchRows?.(new Set(found.hits.map(hit => hit.rowId)), checked);
  }
  function jump(direction: -1 | 1) {
    if (!found?.hits.length || !isCurrent() || (mode !== 'field' && !rowsCurrent()) || composing || locked) return;
    const length = found.hits.length;
    setPosition(previous => {
      const index = previous?.snapshot === snapshot ? previous.index : -1;
      return { snapshot, index: index < 0 ? direction > 0 ? 0 : length - 1 : (index + direction + length) % length };
    });
  }

  async function makePreview(only?: PageOccurrence) {
    if (!canReplace || !found || !client.current || !isCurrent() || !rowsCurrent() || composing || locked || latest.current !== snapshot ||
        runningPreview.current?.snapshot === snapshot) return;
    if (/[\u0000\uD800-\uDFFF]/u.test(replacement)) { setError(text.invalidValue); return; }
    const job = { snapshot };
    runningPreview.current = job;
    setPreparing(snapshot);
    setError('');
    try {
      const result = await client.current.run({ operation: 'previewText', rows: writableRows ?? searchRows, keys: [...replaceKeys],
        options: { ...options, captureReplacement: mode === 'text' && regex && capture }, replacement, generation: 0, only });
      if (runningPreview.current !== job || latest.current !== snapshot || !isCurrent() || !rowsCurrent()) return;
      if (result.status === 'blocked') setError(result.message);
      else if (result.operation === 'previewText') setPreview({ snapshot, replacement, only, plan: onPreview(result.patches) });
    } catch (reason) {
      if (runningPreview.current === job && latest.current === snapshot && isCurrent()) setError(errorMessage(reason));
    } finally {
      if (runningPreview.current === job) { runningPreview.current = undefined; setPreparing(undefined); }
    }
  }

  function cancelPending() {
    runningPreview.current = undefined;
    setPreparing(undefined);
    void client.current?.cancel();
  }

  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!enabled || !isCurrent() || composing || event.nativeEvent.isComposing || event.keyCode === 229) return;
    // 跳行表单有自己的取消和提交，不让查找面板提前消费按键。
    if (event.target instanceof Element && event.target.closest('.grid-row-jump')) return;
    const key = event.key.toLowerCase(), modifier = event.ctrlKey || event.metaKey;
    const findShortcut = key === 'f' && modifier && !event.altKey;
    const replaceShortcut = writable && (key === 'h' && event.ctrlKey && !event.metaKey && !event.altKey ||
      (key === 'f' || event.code === 'KeyF') && event.metaKey && event.altKey && !event.ctrlKey);
    if (shortcuts && !event.shiftKey && (findShortcut || replaceShortcut)) {
      event.preventDefault(); event.stopPropagation();
      if (!event.repeat) onOpen(replaceShortcut);
    } else if (request && !modifier && !event.altKey && (key === 'f3' || key === 'enter' && event.target === queryInput.current)) {
      event.preventDefault(); event.stopPropagation();
      if (!event.repeat) {
        if (key === 'enter' && !incremental && !found && canSearch && !locked) setManual({ snapshot });
        else jump(event.shiftKey ? -1 : 1);
      }
    } else if (request && !modifier && !event.altKey && key === 'escape') {
      event.preventDefault(); event.stopPropagation();
      if (pending) cancelPending(); else if (review) setPreview(undefined); else onClose();
    }
  }

  return <div className={host?.className ?? 'pg-find-host'} inert={host?.inert} onKeyDownCapture={keyDown}>
    {request && <section className="pg-table-find" aria-label={text.title}
      onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)}>
      <div className="query-result-find-toolbar">
        <label className="pg-find-mode">{text.mode} <select ref={modeInput} aria-label={text.mode} value={mode} disabled={!enabled || locked} onChange={event => setMode(event.target.value as Mode)}>
          <option value="text">{text.values}</option><option value="field">{text.fields}</option><option value="empty">{queryResultFindZh.modes.empty}</option><option value="null">{text.null}</option>
        </select></label>
        {needsQuery && <input ref={queryInput} aria-label={text.query} value={query} maxLength={pageFindLimits.query}
          disabled={!enabled || locked} onChange={event => { setQuery(event.target.value); setError(''); }}/>}
        {mode !== 'field' && <select aria-label={text.column} value={column} disabled={!enabled || locked} onChange={event => setColumn(event.target.value)}>
          <option value="">{text.allColumns}</option>{columns.map(item => <option key={item.key} value={item.key}>{item.name}</option>)}
        </select>}
        {needsQuery && <>
          <label className="check"><input type="checkbox" checked={sensitive} disabled={!enabled || locked} onChange={event => setSensitive(event.target.checked)}/>{text.caseSensitive}</label>
          <label className="check"><input type="checkbox" checked={whole} disabled={!enabled || locked} onChange={event => {
            setWhole(event.target.checked); if (event.target.checked) setEdge(undefined);
          }}/>{text.whole}</label>
          <TableFindEdgeSelect edge={edge} disabled={!enabled || locked} onChange={next => { setEdge(next); if (next) setWhole(false); }}/>
        </>}
        {mode === 'text' && <label className="check"><input type="checkbox" checked={regex} disabled={!enabled || locked}
          onChange={event => { setRegex(event.target.checked); setCapture(false); setError(''); }}/>{text.regex}</label>}
        <label className="check"><input type="checkbox" checked={highlight} onChange={event => setHighlight(event.target.checked)}/>{text.highlight}</label>
        <label className="check"><input type="checkbox" checked={incremental} disabled={!enabled || locked || composing} onChange={event => {
          setManual(undefined); setIncremental(event.target.checked);
        }}/>{queryResultFindZh.incremental}</label>
        {replaceSelection !== undefined && mode !== 'field' && <label className="check"><input type="checkbox" checked={checkedOnly} disabled={!enabled || locked}
          onChange={event => { setCheckedRequest(event.target.checked ? request : undefined); setError(''); }}/>{text.checkedOnly}</label>}
        {!incremental && <button type="button" disabled={!enabled || !canSearch || locked || composing}
          onClick={() => setManual({ snapshot })}>{queryResultFindZh.search}</button>}
        <button type="button" disabled={!enabled || !found?.hits.length || locked} onClick={() => jump(-1)}>{text.previous}</button>
        <button type="button" disabled={!enabled || !found?.hits.length || locked} onClick={() => jump(1)}>{text.next}</button>
        {onMatchRows && mode !== 'field' && <GridFindMatchActions disabled={!enabled || !found?.hits.length || locked || composing} onChange={matchRows}/>}
        {onStageFilter && <button type="button" title={findFilter ? filterText.hint : filterText.unavailable}
          disabled={!enabled || locked || composing || !findFilter} onClick={() => {
            if (findFilter && enabled && !locked && !composing && latest.current === snapshot && isCurrent()) onStageFilter(findFilter);
          }}>{filterText.action}</button>}
        <button type="button" onClick={onClose}>{text.close}</button>
      </div>
      {replaceVisible && <div className="query-result-find-toolbar">
        <input ref={replacementInput} data-query-result-replace-input aria-label={text.replacement} value={replacement} maxLength={pageFindLimits.replacement} disabled={!canReplace || locked}
          onChange={event => { setReplacement(event.target.value); setError(''); }}/>
        {mode === 'text' && regex && <label className="check"><input type="checkbox" checked={capture} disabled={!canReplace || locked}
          onChange={event => { setCapture(event.target.checked); setError(''); }}/>{text.captures}</label>}
        <button type="button" disabled={!oneWritable || locked} onClick={() => void makePreview(hit)}>{text.one}</button>
        <button type="button" disabled={!hasWritable || locked} onClick={() => void makePreview()}>{text.all}</button>
        {pending && <button type="button" onClick={cancelPending}>{text.cancel}</button>}
        <span className="muted small">{replaceScopeDescription}</span>
      </div>}
      <div className="query-result-find-status">
        {emptyChecked && <span role="status">{text.checkedEmpty}</span>}
        {checkedOnly && !emptyChecked && mode !== 'field' && <span>{text.checkedScope(searchRows.length)}</span>}
        {enabled && canSearch && !composing && !found?.error && <span role="status">{pending ? text.preparing : !found ? (!incremental && manual?.snapshot !== snapshot ? queryResultFindZh.awaitingSearch : text.searching) : found.hits.length ? text.ready(found.hits.length, chosen) : text.noMatch}</span>}
        {hit && <span>{text.location(Number(hit.rowId), columns.find(column => column.key === hit.key)?.name ?? hit.key)}</span>}
        <span className="muted">{scopeDescription}</span>
      </div>
      <ErrorBox message={error || found?.error || ''}/>
      {review && <section className="pg-find-review" aria-label={text.review}>
        <p>{text.reviewCount(review.plan.patches.length, new Set(review.plan.patches.map(patch => patch.row)).size)}</p>
        <dl>{review.plan.patches.slice(0, 12).map(patch => <div key={patch.row + ':' + patch.column.key}>
          <dt>{text.location(patch.row, patch.column.name)}</dt>
          <dd>{text.before}　{cellPreview(patch.before)}</dd><dd>{text.after}　{cellPreview(patch.after)}</dd>
        </div>)}</dl>
        {review.plan.patches.length > 12 && <p>{text.more(review.plan.patches.length - 12)}</p>}
        <button type="button" onClick={() => setPreview(undefined)}>{text.cancel}</button>
        <button ref={stageButton} type="button" className="primary" disabled={!canReplace} onClick={() => {
          if (latest.current !== snapshot || !isCurrent() || !rowsCurrent()) return;
          try {
            onStage(scope, review.plan);
            if (review.only?.range) {
              const { start, end } = review.only.range, { before, after } = review.plan.patches[0];
              // 零宽命中需要越过原位置，避免下一处仍停在刚插入文字的边界。
              resume.current = { request, pageKey, query, hit: review.only, end: end + after.length - before.length + (start === end ? 1 : 0) };
            }
            setPreview(undefined);
            setError('');
          }
          catch (reason) { setError(errorMessage(reason)); }
        }}>{tableText.stage}</button>
      </section>}
    </section>}
    {renderGrid(enabled ? target : undefined, enabled ? marks : undefined)}
  </div>;
}
