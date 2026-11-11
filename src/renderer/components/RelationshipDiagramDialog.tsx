import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { TableInfo } from '../../shared/contracts';
import { useWorkspace } from '../store';
import { invoke, errorMessage } from '../lib';
import { buildRelationshipDiagram, captureDiagramTable, relationshipDiagramLimits, type RelationshipDiagram } from '../relationshipDiagram';
import { relationshipDiagramPng } from '../relationshipDiagramImage';
import { RelationshipDiagramReader, type RelationshipDiagramServices, type RelationshipJoinDraft } from '../relationshipDiagramReader';
import { relationshipDiagramZh as text } from '../locales/relationshipDiagram.zh-CN';
import { ErrorBox, Modal, Spinner } from './ui';
import '../relationshipDiagram.css';
import { sqliteRelationshipsZh as sqliteText } from '../locales/sqliteRelationships.zh-CN';

export const relationshipDiagramServices: RelationshipDiagramServices = { objects: target => invoke('metadata.objects', target), table: target => invoke('metadata.table', target), cancel: taskId => invoke('query.cancel', { taskId }) };
interface Props { connectionId: string; source: TableInfo; current(): boolean; onClose(): void; onActivity?(delta: 1 | -1): void; onJoin?(draft: RelationshipJoinDraft): boolean; services?: RelationshipDiagramServices; }

/** 只有目录读取和明确刷新触发元数据访问；缩放、选择节点及字段显示完全本地。 */
export function RelationshipDiagramDialog({ connectionId, source, current, onClose, onActivity, onJoin, services = relationshipDiagramServices }: Props) {
  const origin = useRef({ connectionId, source, current, services, onActivity }).current;
  const latest = useRef({ connectionId, source, current, services, onJoin }); latest.current = { connectionId, source, current, services, onJoin };
  const alive = useRef(true), closingRef = useRef(false), invalidRef = useRef(false);
  const [invalid, setInvalid] = useState(false), [busy, setBusy] = useState(false), [closing, setClosing] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [initial] = useState(() => { try { return { diagram: buildRelationshipDiagram([captureDiagramTable(source)]), error: '' }; } catch (reason) { return { diagram: undefined, error: errorMessage(reason) }; } });
  const [diagram, setDiagram] = useState<RelationshipDiagram | undefined>(initial.diagram), [selection, setSelection] = useState<ReadonlySet<string>>(() => new Set([source.name]));
  const diagramRef = useRef(initial.diagram);
  const selectedRef = useRef(selection); selectedRef.current = selection;
  const [catalog, setCatalog] = useState<string[]>([source.name]), [search, setSearch] = useState(''), [page, setPage] = useState(0), [progress, setProgress] = useState('');
  /** 持有第一次提交的范围；父props、连接修订或活动标签曾离开便永久撤销。 */
  function environment(): boolean {
    if (!alive.current || invalidRef.current) return false;
    let valid = false; const value = latest.current;
    try { valid = value.connectionId === origin.connectionId && value.source === origin.source && value.services === origin.services && origin.current() === true && value.current() === true && (!initial.diagram || JSON.stringify(captureDiagramTable(value.source)) === JSON.stringify(initial.diagram.tables[0])); } catch {}
    if (!valid) { invalidRef.current = true; return false; } return true;
  }
  const [reader] = useState(() => new RelationshipDiagramReader({ connectionId, database: source.database }, services, environment));
  useLayoutEffect(() => { if (!environment()) { reader.invalidate(); setInvalid(true); } });
  useEffect(() => {
    const observe = () => { if (!environment()) { reader.invalidate(); setInvalid(true); } };
    const unsubscribe = useWorkspace.subscribe(observe); observe();
    return () => { alive.current = false; reader.invalidate(); unsubscribe(); };
  }, [reader]);
  /** 先同步锁定读取，再等待原请求；旧按钮不能同时开启第二轮或使用新选择替换原范围。 */
  async function perform(action: () => Promise<void>): Promise<void> {
    if (!environment()) { reader.invalidate(); if (alive.current) setInvalid(true); return; }
    if (reader.busy || closingRef.current) return;
    setBusy(true); setError(''); setNotice(''); origin.onActivity?.(1);
    try { await action(); } catch (reason) { if (alive.current) setError(errorMessage(reason)); }
    finally { origin.onActivity?.(-1); if (alive.current) { setBusy(false); if (!environment()) setInvalid(true); } }
  }
  function readCatalog(): void { void perform(async () => { const names = await reader.catalog(); if (!environment() || closingRef.current) return; setCatalog(names); setPage(0); setNotice(text.catalogChanged); }); }
  function readTables(names: readonly string[]): void { void perform(async () => { const result = await reader.read(names, (done, total) => { if (alive.current) setProgress(text.progress(done, total)); }); if (!environment() || closingRef.current) return; diagramRef.current = result; setDiagram(result); setNotice(''); }); }
  /** 复核占用结束后才交给 JOIN 窗口，旧图、取消或关闭都不能打开后继窗口。 */
  async function prepareJoin(graph: RelationshipDiagram, edgeId: string) {
    if (diagramRef.current !== graph || !latest.current.onJoin || reader.busy || closingRef.current) return;
    setProgress(text.joinLoading);
    let draft: RelationshipJoinDraft | undefined;
    await perform(async () => { draft = await reader.join(graph, edgeId, origin.source); });
    if (!draft || closingRef.current || reader.busy || !environment() || diagramRef.current !== graph) return;
    try { if (!latest.current.onJoin?.(draft)) setError(text.stale); }
    catch (reason) { setError(errorMessage(reason)); }
  }
  function choose(name: string, checked: boolean): void {
    if (!environment() || reader.busy || closingRef.current) return;
    const next = new Set(selectedRef.current); if (checked) next.add(name); else next.delete(name);
    if (next.size > relationshipDiagramLimits.tables) { setError(text.limit); return; }
    selectedRef.current = next; setSelection(next); setNotice(text.selectionChanged);
  }
  /** 关闭等待读取与取消原链，失败保留窗口；不会在取消ACK到达前释放所属界面。 */
  async function close(): Promise<void> {
    if (closingRef.current) return; closingRef.current = true; setClosing(true);
    try { await reader.stop(); if (alive.current) onClose(); }
    catch (reason) { closingRef.current = false; if (alive.current) { setClosing(false); setError(errorMessage(reason)); } }
  }
  const visible = useMemo(() => catalog.filter(name => name.toLowerCase().includes(search.toLowerCase())), [catalog, search]);
  const pages = Math.max(1, Math.ceil(visible.length / relationshipDiagramLimits.page)), index = Math.min(page, pages - 1), slice = visible.slice(index * relationshipDiagramLimits.page, (index + 1) * relationshipDiagramLimits.page);
  const disabled = invalid || busy || closing;
  return <Modal title={text.title} onClose={() => { void close(); }} wide><div className="modal-content relationship-diagram-dialog" aria-busy={busy || closing}>
    <p className="muted">{source.database} · {text.scope}</p><p className="muted">{text.readScope}</p>
    <div className="relationship-diagram-selection"><div className="relationship-diagram-pick-controls"><button disabled={disabled} onClick={readCatalog}>{text.catalog}</button><label>{text.search}<input value={search} disabled={disabled} onChange={event => { setSearch(event.target.value); setPage(0); }}/></label><span>{text.selected} {selection.size} / {relationshipDiagramLimits.tables}</span></div>
      <div className="relationship-diagram-picker" role="group" aria-label={text.tableList}>{slice.map(name => <label key={name} title={name}><input type="checkbox" checked={selection.has(name)} disabled={disabled} onChange={event => choose(name, event.target.checked)}/><span>{name}</span></label>)}{!slice.length && <span>{text.noTables}</span>}</div>
      <div className="relationship-diagram-pick-controls"><button disabled={disabled || !index} onClick={() => setPage(index - 1)}>{text.previous}</button><span>{index + 1} / {pages}</span><button disabled={disabled || index + 1 >= pages} onClick={() => setPage(index + 1)}>{text.next}</button><button disabled={disabled || !selection.size} onClick={() => { if (environment() && !reader.busy && !closingRef.current) { selectedRef.current = new Set(); setSelection(selectedRef.current); setNotice(text.selectionChanged); } }}>{text.clear}</button><button disabled={disabled || !selection.size} onClick={() => readTables([...selectedRef.current])}>{text.read}</button><button disabled={disabled || !diagram} onClick={() => readTables(diagram!.tables.map(table => table.name))}>{text.refresh}</button>{busy && <button disabled={closing} onClick={() => { void reader.stop().catch(reason => { if (alive.current) setError(errorMessage(reason)); }); }}>{text.stop}</button>}</div>
    </div>
    <ErrorBox message={invalid ? text.stale : error || initial.error}/>{notice && <p role="status">{notice}</p>}{busy && <Spinner text={progress || text.catalog}/>}<p className="muted">{text.limit}</p>
    {diagram && <RelationshipDiagramCanvas diagram={diagram} joinDisabled={disabled} exportDisabled={disabled} exportCurrent={environment}
      onJoin={onJoin ? id => { void prepareJoin(diagram, id); } : undefined}/>}
  </div><footer className="modal-footer"><span className="grow"/><button disabled={closing} onClick={() => { void close(); }}>{text.close}</button></footer></Modal>;
}

/** 图只使用已验证结构，未读取的外部目标采用虚线框；名称始终作为React纯文本。 */
export function RelationshipDiagramCanvas({ diagram, onJoin, joinDisabled, onDesign, designDisabled, localDatabase, exportDisabled, exportCurrent }: {
  diagram: RelationshipDiagram; onJoin?(edgeId: string): void; joinDisabled?: boolean; onDesign?(table: string): void;
  designDisabled?: boolean; localDatabase?: string; exportDisabled?: boolean; exportCurrent?(): boolean;
}) {
  const [allFields, setAllFields] = useState(true), [zoom, setZoom] = useState(1), [selected, setSelected] = useState('');
  const [exporting, setExporting] = useState(false), [exportError, setExportError] = useState(''), [exportNotice, setExportNotice] = useState('');
  const viewport = useRef<HTMLDivElement>(null), marker = useRef('relationship-arrow-' + crypto.randomUUID()).current;
  const graph = useMemo(() => buildRelationshipDiagram(diagram.tables, allFields), [diagram, allFields]);
  const chosen = graph.nodes.find(node => node.id === selected), edges = chosen ? graph.edges.filter(edge => edge.source === chosen.id || edge.target === chosen.id) : graph.edges;
  const exportWork = useRef(false), mounted = useRef(false);
  const latest = useRef({ graph, selected, localDatabase, exportDisabled, exportCurrent });
  latest.current = { graph, selected, localDatabase, exportDisabled, exportCurrent };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  /** 图或来源在编码期间变化时，旧图片不能再打开保存选择器。 */
  async function exportPng() {
    const element = viewport.current;
    if (!element || exportDisabled || exportWork.current) return;
    const current = () => {
      const now = latest.current;
      return mounted.current && now.graph === graph && now.selected === selected && now.localDatabase === localDatabase &&
        !now.exportDisabled && now.exportCurrent?.() !== false;
    };
    exportWork.current = true;
    setExporting(true); setExportError(''); setExportNotice('');
    try {
      if (!current()) throw Error(text.stale);
      const base64 = await relationshipDiagramPng(graph, element, chosen?.id, localDatabase);
      if (!current()) throw Error(text.stale);
      const result = await invoke('relationshipDiagram.savePng', { base64 });
      if (mounted.current && result) setExportNotice(text.pngSaved(result.name));
    } catch (reason) {
      if (mounted.current) setExportError(errorMessage(reason));
    } finally {
      exportWork.current = false;
      if (mounted.current) setExporting(false);
    }
  }
  function design(node: typeof chosen) { if (node && !node.external && !designDisabled) onDesign?.(node.name); }
  return <section className="relationship-diagram"><div className="relationship-diagram-controls"><span>{text.counts(graph.tables.length, graph.nodes.filter(node => node.external).length, graph.edges.length)}</span><label><input type="checkbox" checked={allFields} onChange={event => setAllFields(event.target.checked)}/>{text.fields}</label><button aria-label={text.zoomOut} disabled={zoom <= .25} onClick={() => setZoom(value => Math.max(.25, value - .25))}>−</button><span>{Math.round(zoom * 100)}%</span><button aria-label={text.zoomIn} disabled={zoom >= 2} onClick={() => setZoom(value => Math.min(2, value + .25))}>＋</button><button onClick={() => { const width = viewport.current?.clientWidth; if (width) setZoom(Math.max(.25, Math.min(1, (width - 20) / graph.width))); }}>{text.fit}</button>{onDesign && <button disabled={!chosen || chosen.external || designDisabled} onClick={() => design(chosen)}>{text.browserDesign}</button>}
      <button type="button" disabled={exportDisabled || exporting} onClick={() => { void exportPng(); }}>
        {exporting ? text.exportingPng : text.exportPng}</button>
    </div>
    <ErrorBox message={exportError}/>
    {exportNotice && <p role="status">{exportNotice}</p>}
    <div className="relationship-diagram-viewport" aria-label={text.viewport} tabIndex={0} ref={viewport}><div style={{ width: graph.width * zoom, height: graph.height * zoom }}><div className="relationship-diagram-stage" style={{ width: graph.width, height: graph.height, transform: `scale(${zoom})` }}>
      <svg width={graph.width} height={graph.height} aria-hidden="true"><defs><marker id={marker} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z"/></marker></defs>{graph.edges.map(edge => <path key={edge.id} className={chosen && (edge.source === chosen.id || edge.target === chosen.id) ? 'selected' : ''} d={edge.path} markerEnd={`url(#${marker})`}/>)}</svg>
      {graph.nodes.map(node => {
        const qualifiedName = node.database + '.' + node.name;
        return <article key={node.id} className={`relationship-diagram-node${node.external ? ' external' : ''}${chosen === node ? ' selected' : ''}`} style={{ left: node.x, top: node.y, width: node.width, height: node.height }}><button className="relationship-diagram-node-title" title={qualifiedName} aria-label={qualifiedName} aria-pressed={chosen === node} onClick={() => setSelected(value => value === node.id ? '' : node.id)} onDoubleClick={onDesign ? () => design(node) : undefined}>{node.database === localDatabase ? node.name : qualifiedName}</button>{node.external ? <p>{text.external}</p> : node.columns.length ? node.columns.map(column => <div className="relationship-diagram-column" key={column.name} title={`${column.name} · ${column.type || sqliteText.undeclaredType} · ${column.notNullDeclared === undefined ? column.nullable ? text.nullable : text.required : column.notNullDeclared ? sqliteText.notNull : sqliteText.noNotNull}`}><span className="relationship-diagram-key">{node.primaryKey.includes(column.name) ? 'PK' : ''}{node.foreignColumns.includes(column.name) ? ' FK' : ''}</span><span>{column.name}</span><small>{column.type || sqliteText.undeclaredType}</small></div>) : <p>{text.noKeys}</p>}</article>;
      })}
    </div></div></div>
    <div className="relationship-diagram-relations" aria-label={text.mappings}>{!edges.length && <p>{text.noRelations}</p>}{edges.map(edge => <details key={edge.id}><summary>{graph.nodes.find(node => node.id === edge.source)!.name} → {edge.key.referencedDatabase}.{edge.key.referencedTable} · {edge.key.name}{edge.source === edge.target ? ` · ${text.sameTable}` : ''}</summary><ol>{edge.key.columns.map((name, index) => <li key={index}>{name} → {edge.key.referencedColumns[index] ?? sqliteText.implicitPart(index)}</li>)}</ol>{edge.key.implicit && <p>{sqliteText.implicit}</p>}{edge.key.warning && <p role="note">{edge.key.warning}</p>}<p>{text.update}：{edge.key.onUpdate} · {text.remove}：{edge.key.onDelete}</p>{onJoin && <button disabled={joinDisabled} onClick={() => onJoin(edge.id)}>{text.join}</button>}</details>)}</div>
  </section>;
}
