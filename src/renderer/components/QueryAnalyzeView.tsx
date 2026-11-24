import { UsageHelp } from './ui';
import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { queryAnalyzeNodeDetail, type QueryAnalyzeMetric, type QueryAnalyzeNode, type QueryAnalyzePlan } from '../../shared/queryAnalyze';
import { queryAnalyzeRowComparisons } from '../../shared/queryAnalyzeRows';
import type { QueryOutcome } from '../../shared/contracts';
import type { AnalyzeSnapshotDocument } from '../../shared/explainSnapshot';
import { explainSnapshotZh as snapshotText } from '../../shared/explainSnapshot.zh-CN';
import { explainZh as planText } from '../locales/explain.zh-CN';
import { queryAnalyzeZh as t } from '../locales/queryAnalyze.zh-CN';
import { ExplainSnapshotSaveButton } from './ExplainSnapshotSaveButton';
import { LivePlanFileActions } from './LivePlanFileActions';
import { PlanOutputCopyButton } from './PlanOutputCopyButton';
import '../explain.css';
import '../queryAnalyze.css';
import '../explainSnapshot.css';

/** 指标原文独立保留；未知字段也展示服务器名称，不凭名称推测单位或计算总耗时。 */
function metricTitle(metric: QueryAnalyzeMetric): string { return Object.hasOwn(t.metricLabels, metric.source) ? t.metricLabels[metric.source] : metric.source; }
/** 单位只作展示附注，不能把原始十进制字符串转成 JavaScript 数值。 */
function metricValue(metric: QueryAnalyzeMetric): string { return metric.value + (metric.unit ? ` ${t.units[metric.unit]}` : ''); }

/** 展开时才读取节点数据，切换节点后丢弃上一个展开状态。 */
function AnalyzeNodeData({ plan, node }: { plan: QueryAnalyzePlan; node: QueryAnalyzeNode }) {
  const [open, setOpen] = useState(false);
  const data = useMemo(() => open ? queryAnalyzeNodeDetail(plan, node) : '', [open, plan, node]);
  return <details className="query-analyze-node-data" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{t.nodeData}</summary>
    {open && (data ? <pre className="query-analyze-raw" tabIndex={0} aria-label={t.nodeData}>{data}</pre> : <p>{t.nodeDataUnavailable}</p>)}
  </details>;
}

/** 文件入口只接收当前计划对应结果；未启用时保持纯只读展示。 */
export interface QueryAnalyzeViewProps {
  plan: QueryAnalyzePlan; outcome?: QueryOutcome; fileSnapshot?: AnalyzeSnapshotDocument;
  sourceLocation?: { available: boolean; locate(): void };
  fileActions?: boolean; busy?: boolean; saveAs?: boolean; isFileCurrent?(): boolean; onFileBusyChange?(busy: boolean): void;
}
/** 新结果即换代，A→B→A不能继承旧计划的所选节点或折叠状态。 */
export function QueryAnalyzeView(props: QueryAnalyzeViewProps) {
  const { plan, outcome } = props;
  const owner = useRef({ plan, outcome, generation: 0 });
  if (owner.current.plan !== plan || owner.current.outcome !== outcome) owner.current = { plan, outcome, generation: owner.current.generation + 1 };
  return <OwnedQueryAnalyzeView key={owner.current.generation} {...props}/>;
}

/** 只在本地阅读和搜索已经返回的分析节点；不从截断原文或未解析字段推测匹配。 */
function OwnedQueryAnalyzeView({ plan, outcome, fileSnapshot, sourceLocation, fileActions = false, busy = false, saveAs = false, isFileCurrent, onFileBusyChange }: QueryAnalyzeViewProps) {
  const postgres = plan.dialect === 'postgresql';
  const [view, setView] = useState<'tree' | 'raw' | 'rows'>(plan.nodes.length ? 'tree' : 'raw');
  const [differentRowsOnly, setDifferentRowsOnly] = useState(false);
  const [selected, setSelected] = useState(plan.nodes[0]?.id ?? '');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [focusRequest, setFocusRequest] = useState<{ id: string; moveFocus: boolean }>();
  const [search, setSearch] = useState(''), [searchError, setSearchError] = useState(false), [matchIndex, setMatchIndex] = useState(-1);
  const alive = useRef(true), buttons = useRef(new Map<string, HTMLButtonElement>());
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const children = useMemo(() => new Set(plan.nodes.flatMap(node => node.parent ? [node.parent] : [])), [plan]);
  const byId = useMemo(() => new Map(plan.nodes.map(node => [node.id, node])), [plan]);
  const rowComparisons = useMemo(() => queryAnalyzeRowComparisons(plan), [plan]);
  const visibleComparisons = differentRowsOnly ? rowComparisons.filter(row => row.delta !== '0') : rowComparisons;
  const matches = useMemo(() => {
    if (!search) return [];
    const term = search.toLowerCase();
    const includes = (value?: string) => !!value?.toLowerCase().includes(term);
    return plan.nodes.filter(node => includes(node.label) || includes(node.path === '' ? '/' : node.path) ||
      (node.neverExecuted && includes(t.neverExecuted)) ||
      node.metrics.some(metric => includes(metric.source) || includes(metricTitle(metric)) || includes(metricValue(metric))));
  }, [plan, search]);
  const matchedIds = useMemo(() => new Set(matches.map(node => node.id)), [matches]);
  const visible = useMemo(() => {
    const hidden = new Set<string>();
    return plan.nodes.filter(node => {
      if (node.parent && (collapsed.has(node.parent) || hidden.has(node.parent))) { hidden.add(node.id); return false; }
      return true;
    });
  }, [plan, collapsed]);
  const current = byId.get(selected) ?? plan.nodes[0];
  const result = outcome?.results[0];
  useLayoutEffect(() => {
    if (!focusRequest || !alive.current) return;
    const element = buttons.current.get(focusRequest.id);
    if (focusRequest.moveFocus) element?.focus();
    element?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [focusRequest]);

  /** 焦点只在真实可见节点上移动，树的收起状态不影响原计划。 */
  function focus(id: string) { if (alive.current) { setSelected(id); setFocusRequest({ id, moveFocus: true }); } }
  /** 查找和对照从同一节点树定位，只展开目标祖先，保留其他分支的状态。 */
  function reveal(node: QueryAnalyzeNode, moveFocus: boolean) {
    if (!alive.current) return;
    const ancestors = new Set<string>();
    for (let parent = node.parent; parent && !ancestors.has(parent); parent = byId.get(parent)?.parent) ancestors.add(parent);
    setCollapsed(previous => new Set([...previous].filter(id => !ancestors.has(id))));
    setView('tree');
    setSelected(node.id);
    setFocusRequest({ id: node.id, moveFocus });
  }
  /** 查找保留输入焦点，连续按键可环绕跳转。 */
  function travel(direction: -1 | 1) {
    if (!alive.current || !matches.length) return;
    const index = matchIndex < 0 ? (direction === 1 ? 0 : matches.length - 1)
      : (matchIndex + direction + matches.length) % matches.length;
    setMatchIndex(index);
    reveal(matches[index], false);
  }
  function updateSearch(value: string) {
    if (!alive.current) return;
    setSearch(value);
    setSearchError(false);
    setMatchIndex(-1);
  }
  /** 折叠后把选择移回父节点，隐藏子节点不保留不可见的键盘活动项。 */
  function toggle(node: QueryAnalyzeNode) {
    if (!alive.current || !children.has(node.id)) return;
    setCollapsed(previous => { const next = new Set(previous); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next; });
    focus(node.id);
  }
  /** 扁平 DOM 保留服务器层级，避免深递归并实现标准树键盘行为。 */
  function navigate(event: KeyboardEvent, node: QueryAnalyzeNode) {
    if (!alive.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
    const index = visible.findIndex(item => item.id === node.id); let target: string | undefined;
    switch (event.key) {
      case 'ArrowDown': target = visible[Math.min(index + 1, visible.length - 1)]?.id; break;
      case 'ArrowUp': target = visible[Math.max(0, index - 1)]?.id; break;
      case 'Home': target = visible[0]?.id; break;
      case 'End': target = visible.at(-1)?.id; break;
      case 'ArrowRight': if (children.has(node.id)) { if (collapsed.has(node.id)) toggle(node); else target = visible[index + 1]?.id; } break;
      case 'ArrowLeft': if (children.has(node.id) && !collapsed.has(node.id)) toggle(node); else target = node.parent; break;
      case 'Enter': case ' ': setSelected(node.id); break;
      default: return;
    }
    event.preventDefault(); if (target) focus(target);
  }
  return <section className="query-analyze-view" aria-label={t.view}>
    <div className="query-analyze-toolbar" role="group" aria-label={t.view}>
      <button aria-pressed={view === 'tree'} onClick={() => { if (alive.current) setView('tree'); }}>{t.tree}</button><button aria-pressed={view === 'raw'} onClick={() => { if (alive.current) setView('raw'); }}>{t.raw}</button>
      <button aria-pressed={view === 'rows'} disabled={!rowComparisons.length}
        title={rowComparisons.length ? undefined : t.rowComparisonUnavailable}
        onClick={() => { if (alive.current && rowComparisons.length) setView('rows'); }}>{t.rowComparison}</button>
      {sourceLocation && <button disabled={busy || !sourceLocation.available}
        title={sourceLocation.available ? undefined : planText.locateUnavailable}
        onClick={() => { if (alive.current && !busy && sourceLocation.available) sourceLocation.locate(); }}>{planText.locate}</button>}
      <PlanOutputCopyButton raw={plan.raw} busy={busy} truncated={plan.rawTruncated || !!result?.truncated}
        isCurrent={() => alive.current && (isFileCurrent?.() ?? true)}/>
      {fileActions && (outcome && outcome.analysis === plan ? (!fileSnapshot && !saveAs ?
        <LivePlanFileActions outcome={outcome} complete={!!plan.nodes.length && !plan.rawTruncated && !!result && !result.truncated}
          busy={busy} isCurrent={() => alive.current && (isFileCurrent?.() ?? true)} onFileBusyChange={onFileBusyChange}/> :
        <ExplainSnapshotSaveButton outcome={outcome} fileSnapshot={fileSnapshot} busy={busy} saveAs={saveAs} isCurrent={isFileCurrent} onFileBusyChange={onFileBusyChange}/>) :
        <span className="explain-snapshot-save"><button disabled title={snapshotText.unavailable}>{saveAs ? snapshotText.saveAs : snapshotText.save}</button></span>)}
      <span className="muted">{t.source}：{postgres ? 'PostgreSQL' : plan.dialect === 'mysql' ? 'MySQL' : 'MariaDB'} {plan.version} · {postgres ? 'EXPLAIN (ANALYZE, FORMAT JSON)' : plan.format === 'tree' ? 'EXPLAIN ANALYZE' : 'ANALYZE FORMAT=JSON'}</span>
    </div>
    {!!plan.nodes.length && <div className="explain-search" role="search" aria-label={planText.find}>
      <input aria-label={planText.find} aria-invalid={searchError || undefined} maxLength={200} placeholder={t.findPlaceholder} value={search}
        onInput={event => {
          if (!alive.current) return;
          const value = event.currentTarget.value;
          if (value.length > 200) { event.currentTarget.value = search; setSearchError(true); return; }
          updateSearch(value);
        }} onKeyDown={event => {
          if (event.nativeEvent.isComposing || event.keyCode === 229 || event.key !== 'Enter') return;
          event.preventDefault();
          travel(event.shiftKey ? -1 : 1);
        }}/>
      <span role="status" aria-label={planText.findCount}>{search ? planText.matches(matchIndex + 1, matches.length) : planText.findIdle}</span>
      <button disabled={!matches.length} onClick={() => travel(-1)}>{planText.previous}</button>
      <button disabled={!matches.length} onClick={() => travel(1)}>{planText.next}</button>
      <button disabled={!search && !searchError} onClick={() => updateSearch('')}>{planText.clear}</button>
    </div>}
    <div className="query-analyze-hints"><UsageHelp><p>{postgres ? t.postgresHint : plan.dialect === 'mysql' ? t.mysqlHint : t.mariaHint}</p><p>{t.estimateHint}</p><p>{postgres ? t.postgresRelation : t.relationHint}</p><p>{t.keyboard}</p>{!!plan.nodes.length && <p>{t.findHint}</p>}</UsageHelp>{searchError && <p className="query-analyze-warning" role="alert">{planText.findTooLong}</p>}{plan.rawTruncated && <p className="query-analyze-warning" role="alert">{t.truncated}</p>}{plan.warnings.map((warning, index) => <p className="query-analyze-warning" role="status" key={index}>{warning}</p>)}</div>
    <div className="query-analyze-content">
      {view === 'raw' ? <pre className="query-analyze-raw" aria-label={t.raw} tabIndex={0}>{plan.raw || t.rawMissing}</pre> : view === 'rows' ?
        <section className="query-analyze-row-comparison" aria-label={t.rowComparison}>
          <p className="muted">{plan.dialect === 'mariadb' ? t.readRowComparison : t.outputRowComparison}</p>
          <label><input type="checkbox" checked={differentRowsOnly}
            onChange={event => { if (alive.current) setDifferentRowsOnly(event.currentTarget.checked); }}/>{t.differentRowsOnly}</label>
          <table aria-label={t.rowComparison}>
            <thead><tr><th scope="col">{t.rowNode}</th><th scope="col">{t.rowEstimate}</th><th scope="col">{t.rowActual}</th><th scope="col" aria-sort="other">{t.rowDelta}</th></tr></thead>
            <tbody>{visibleComparisons.map(row => <tr key={row.node.id}>
              <th scope="row"><button type="button" onClick={() => reveal(row.node, true)}>{row.node.label}</button></th>
              <td>{row.estimate}</td><td>{row.actual}</td><td>{row.delta}</td>
            </tr>)}</tbody>
          </table>
          {!visibleComparisons.length && <p role="status">{t.rowComparisonEqual}</p>}
        </section> : !plan.nodes.length ? <p className="query-analyze-empty">{t.empty}</p> : <div className="query-analyze-layout">
        <div className="query-analyze-tree-pane"><div className="query-analyze-actions"><button onClick={() => { if (alive.current) setCollapsed(new Set()); }}>{t.expand}</button><button onClick={() => { if (alive.current) { setCollapsed(new Set(children)); focus(plan.nodes[0].id); } }}>{t.collapse}</button></div>
          <div role="tree" aria-label={t.tree} className="query-analyze-tree">{visible.map(node => <button key={node.id} data-node-id={node.id} data-plan-match={matchedIds.has(node.id) || undefined} ref={element => { if (element) buttons.current.set(node.id, element); else buttons.current.delete(node.id); }} role="treeitem" aria-level={node.depth + 1} aria-expanded={children.has(node.id) ? !collapsed.has(node.id) : undefined} aria-selected={selected === node.id} tabIndex={selected === node.id ? 0 : -1} className="query-analyze-node" style={{ paddingLeft: 10 + Math.min(node.depth, 10) * 14 }} onFocus={() => { if (alive.current) setSelected(node.id); }} onClick={() => { if (alive.current) setSelected(node.id); }} onDoubleClick={() => toggle(node)} onKeyDown={event => navigate(event, node)}>
            <span className="query-analyze-node-title"><span aria-hidden="true">{children.has(node.id) ? collapsed.has(node.id) ? '▸' : '▾' : '·'}</span> {node.label}{node.neverExecuted && <small>{t.neverExecuted}</small>}</span>
            <span className="query-analyze-node-metrics">{node.metrics.filter(metric => metric.kind === 'actual').slice(0, 3).map(metric => `${metricTitle(metric)}：${metricValue(metric)}`).join(' · ') || (node.neverExecuted ? t.neverExecuted : t.unavailable)}</span>
          </button>)}</div>
        </div>
        {current && <section className="query-analyze-detail" aria-label={t.details}><strong>{current.label}</strong>{current.neverExecuted && <p>{t.neverExecuted}</p>}{(['actual', 'estimate'] as const).map(kind => <div key={kind}><h3>{t[kind]}</h3><dl>{current.metrics.filter(metric => metric.kind === kind).length ? current.metrics.filter(metric => metric.kind === kind).map((metric, index) => <div key={metric.source + index}><dt>{metricTitle(metric)}<small>{metric.source}</small></dt><dd>{metricValue(metric)}</dd></div>) : <div><dd>{t.unavailable}</dd></div>}</dl></div>)}{current.path !== undefined && <p className="muted small">{t.path}：{current.path || '/'}{current.pathTruncated && <span className="query-analyze-warning"> · {t.pathTruncated}</span>}</p>}
          {!plan.rawTruncated && !current.pathTruncated && current.path !== undefined && <AnalyzeNodeData key={current.id} plan={plan} node={current}/>}
        </section>}
      </div>}
    </div>
  </section>;
}
