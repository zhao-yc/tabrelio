import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { Info, Maximize2, Minimize2, RefreshCw, Search, X } from 'lucide-react';
import type { editor } from 'monaco-editor';
import type { ConnectionProfile } from '../../shared/contracts';
import { objectInformationWidthLimits as size } from '../../shared/objectInformationLayout';
import { postgresDefinitionTargetSchema } from '../../shared/databaseSearch';
import type { TableElements } from '../../shared/tableElements';
import { invoke, errorMessage, kindLabels } from '../lib';
import { objectInformationZh as text } from '../locales/objectInformation.zh-CN';
import { sidebarViewZh } from '../locales/sidebarView.zh-CN';
import { tableElementsZh } from '../locales/tableElements.zh-CN';
import { viewDependenciesZh } from '../locales/viewDependencies.zh-CN';
import { connectionOrganizationZh } from '../../shared/connectionOrganization.zh-CN';
import { sidebarConnectionEnd } from '../sidebarNodeRequests';
import { useWorkspace } from '../store';
import { readObjectDependencies, supportsObjectDependencies, type ObjectDependencies, type ObjectDependencyEntry, type DependencyDefinitionTarget } from '../objectDependencies';
import { sidebarNodeKey, useSidebarSelection, type SidebarNodeTarget } from './SidebarContextMenu';
import { SqlEditor } from './SqlEditor';
import { DependencyDefinition } from './DependencyDefinition';
import { ErrorBox, Spinner } from './ui';
import '../objectInformation.css';

type Mode = 'general' | 'structure' | 'ddl' | 'dependencies';
type NamedTarget = Extract<SidebarNodeTarget, { name: string }>;
type ReadMode = Exclude<Mode, 'general'>;

/** 能力随真实对象种类变化，只有已接入定义读取的类型才提供 DDL。 */
function canReadDdl(profile: ConnectionProfile, target: SidebarNodeTarget): target is NamedTarget {
  if (!('name' in target)) return false;
  if (profile.dialect === 'postgresql') return target.kind === 'table' || target.kind === 'view' || target.kind === 'procedure' || target.kind === 'function';
  if (profile.dialect === 'sqlite') return target.kind === 'table' || target.kind === 'view' || target.kind === 'trigger';
  return target.kind !== 'sequence';
}

function TableStructure({ value }: { value: TableElements }) {
  const t = tableElementsZh;
  return <div className="object-info-structure">
    <section aria-label={t.columns}>
      <h3>{t.columns} <span>{value.columns.length}</span></h3>
      <ul>{value.columns.map(column => <li key={column.name}>
        <strong>{column.name}</strong>
        <span>{[column.type || t.noDeclaredType, column.primary && t.primary, column.generated && t.generated].filter(Boolean).join(' · ')}</span>
      </li>)}</ul>
    </section>
    <section aria-label={t.indexes}>
      <h3>{t.indexes} <span>{value.indexes.length}</span></h3>
      {value.indexes.length ? <ul>{value.indexes.map(index => <li key={index.name}>
        <strong>{index.name}</strong>
        <span>{[index.primary && t.primary, index.unique && t.unique, index.partial && t.partial].filter(Boolean).join(' · ')}</span>
      </li>)}</ul> : <p>{t.noElements}</p>}
    </section>
    <section aria-label={t.foreignKeys}>
      <h3>{t.foreignKeys} <span>{value.foreignKeys.length}</span></h3>
      {value.foreignKeys.length ? <ul>{value.foreignKeys.map(key => <li key={key.name ?? key.ordinal}>
        <strong>{key.name ?? t.ordinal(key.ordinal)}</strong>
        {key.reference && <>
          <span>{[key.reference.namespace, key.reference.table].filter(Boolean).join('.')}</span>
          {key.reference.pairs.map(pair => <span key={pair.local}>{pair.local} → {pair.remote ?? t.implicitPrimary}</span>)}
        </>}
      </li>)}</ul> : <p>{t.noElements}</p>}
    </section>
  </div>;
}

function DependencyList({ value, page, previous, next, open }: {
  value: ObjectDependencies; page: number; previous(): void; next(cursor: string): void;
  open(row: ObjectDependencyEntry, trigger: HTMLButtonElement): void;
}) {
  return <div className="object-info-structure object-info-dependencies">
    <div className="object-info-dependency-notes">{value.notices.map(note => <p key={note}>{note}</p>)}</div>
    {(['references', 'referencedBy'] as const).map(direction => <section key={direction} aria-label={text[direction]}>
      <h3>{text[direction]} <span>{value[direction].length}</span></h3>
      {direction === 'references' && value.referencesUnknown && <p>{viewDependenciesZh.referencedUnknown}</p>}
      {value[direction].length ? <ul>{value[direction].map((row, index) => <li key={JSON.stringify([row.identity, row.detail, index])}>
        <div className="object-info-dependency-row">
          <strong>{row.identity}</strong>
          {row.definition && <button type="button" aria-label={text.openDependencyDefinition(row.identity)}
            onClick={event => open(row, event.currentTarget)}>{text.definition}</button>}
        </div>
        {row.detail && <span>{row.detail}</span>}
        {row.mapping?.map((part, partIndex) => <span key={partIndex}>{part}</span>)}
      </li>)}</ul> : (direction !== 'references' || !value.referencesUnknown) && <p>{viewDependenciesZh.empty}</p>}
      {direction === 'referencedBy' && value.page && (page > 1 || value.page.nextCursor) && <div className="object-info-dependency-pages">
        <button type="button" disabled={page === 1} onClick={previous}>{text.previousDependencies}</button>
        <span>{text.dependencyPage(page)}</span>
        <button type="button" disabled={!value.page.nextCursor} onClick={() => { if (value.page?.nextCursor) next(value.page.nextCursor); }}>{text.nextDependencies}</button>
      </div>}
    </section>)}
  </div>;
}

interface DependencyPage {
  target: NamedTarget;
  profile: ConnectionProfile;
  refreshKey: string;
  cursors: string[];
  digest: string;
}

interface Source {
  target: NamedTarget;
  profile: ConnectionProfile;
  version: number;
  refreshKey: string;
  mode: ReadMode;
  retry: number;
  dependencyPage?: DependencyPage;
}
type Result = { source: Source; value: string | TableElements | ObjectDependencies } | { source: Source; error: string };

/** 拖动只预览显示宽度，放开才保存。窗口变窄时临时限宽，保留原偏好。 */
function useInformationPaneWidth(expanded: boolean) {
  const pane = useRef<HTMLElement>(null);
  const [available, setAvailable] = useState(() => window.innerWidth);
  const [draft, setDraft] = useState<number>();
  const drag = useRef<{ node: HTMLDivElement; pointerId: number; x: number; width: number } | undefined>(undefined);
  const saved = useWorkspace(state => state.settings.objectInformationWidth ?? size.initial);
  const sidebarWidth = useWorkspace(state => state.settings.sidebarWidth);
  const dockedLimit = available - sidebarWidth - 3 - 420;
  const overlay = available <= 1130 || dockedLimit < size.min;
  const max = Math.min(size.max, overlay ? Math.max(0, available - 240) : dockedLimit);
  const min = Math.min(size.min, max);
  const clamp = (width: number) => Math.max(min, Math.min(max, Math.round(width)));
  const width = clamp(draft ?? saved);

  useLayoutEffect(() => {
    const body = pane.current?.parentElement;
    if (!body) return;
    const measure = () => setAvailable(body.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    return () => observer.disconnect();
  }, []);

  function cancel() {
    const current = drag.current;
    if (!current) return;
    drag.current = undefined;
    if (current.node.hasPointerCapture(current.pointerId)) current.node.releasePointerCapture(current.pointerId);
    setDraft(undefined);
  }
  useLayoutEffect(cancel, [expanded, min, max, saved]);
  useEffect(() => {
    window.addEventListener('blur', cancel);
    return () => window.removeEventListener('blur', cancel);
  }, []);

  function save(next: number) {
    const state = useWorkspace.getState();
    if (next !== (state.settings.objectInformationWidth ?? size.initial)) state.updateSettings({ objectInformationWidth: next });
  }
  function start(event: PointerEvent<HTMLDivElement>) {
    if (drag.current || event.button !== 0 || !event.isPrimary) return;
    const node = event.currentTarget, pointerId = event.pointerId;
    node.setPointerCapture(pointerId);
    drag.current = { node, pointerId, x: event.clientX, width };
    node.focus({ preventScroll: true });
    event.preventDefault();
  }
  function move(event: PointerEvent<HTMLDivElement>, commit = false) {
    const current = drag.current;
    if (!current || event.pointerId !== current.pointerId) return;
    const next = clamp(current.width + current.x - event.clientX);
    if (!commit) { setDraft(next); return; }
    cancel();
    if (next !== current.width) save(next);
  }
  function keydown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && drag.current) { event.preventDefault(); cancel(); return; }
    if (drag.current || event.altKey || event.ctrlKey || event.metaKey) return;
    const visual = clamp(useWorkspace.getState().settings.objectInformationWidth ?? size.initial);
    const step = event.shiftKey ? 50 : 10;
    const next = event.key === 'ArrowLeft' ? clamp(visual + step) : event.key === 'ArrowRight' ? clamp(visual - step)
      : event.key === 'Home' ? min : event.key === 'End' ? max : undefined;
    if (next === undefined) return;
    event.preventDefault();
    if (next !== visual) save(next);
  }
  const handle = !expanded && <div className="object-info-resize" role="separator" tabIndex={0} aria-orientation="vertical"
    aria-label={text.resize} aria-controls="object-information-pane" aria-valuemin={min} aria-valuemax={max} aria-valuenow={width}
    aria-valuetext={text.width(width)} aria-keyshortcuts="ArrowLeft ArrowRight Home End Escape" title={text.resizeHint}
    onPointerDown={start} onPointerMove={event => move(event)} onPointerUp={event => move(event, true)}
    onPointerCancel={event => { if (drag.current?.pointerId === event.pointerId) cancel(); }}
    onLostPointerCapture={event => { if (drag.current?.pointerId === event.pointerId) cancel(); }}
    onDoubleClick={() => { cancel(); save(size.initial); }} onKeyDown={keydown}/>;
  return { pane, width, overlay, handle };
}

/** 原对象行、连接修订及目录代次共同约束发布，旧选择不能继续连库或交付原定义。 */
export function ObjectInformationPane({ refresh, connectionRefresh, objectRefresh, expanded, onToggleSize, onClose }: {
  refresh: number;
  connectionRefresh: Record<string, number>;
  objectRefresh: Record<string, number>;
  expanded: boolean;
  onToggleSize(): void;
  onClose(): void;
}) {
  const { pane, width, overlay, handle } = useInformationPaneWidth(expanded);
  const { target, current } = useSidebarSelection();
  const profile = useWorkspace(state => state.connections.find(item => item.id === target?.connectionId));
  const version = useWorkspace(state => target ? state.connectionVersions[target.connectionId] ?? 0 : 0);
  const catalogVersion = target && 'database' in target ? objectRefresh[JSON.stringify([target.connectionId, target.database])] ?? 0 : 0;
  const refreshKey = JSON.stringify([refresh, target && (connectionRefresh[target.connectionId] ?? 0), catalogVersion]);
  const [mode, setMode] = useState<Mode>('general'), [retry, retryRead] = useState(0);
  const [result, setResult] = useState<Result>(), live = useRef<Source | undefined>(undefined), heading = useRef<HTMLHeadingElement>(null);
  const [definitionEditor, setDefinitionEditor] = useState<{ source: Source; instance: editor.IStandaloneCodeEditor }>();
  const [page, setPage] = useState<DependencyPage>();
  const [preview, setPreview] = useState<{ source: Source; identity: string; target: DependencyDefinitionTarget; trigger: HTMLButtonElement; scrollTop: number }>();
  const returnFocus = useRef<{ trigger: HTMLButtonElement; scrollTop: number } | undefined>(undefined);
  const content = useRef<HTMLDivElement>(null);
  const dependencyPage = page && page.target === target && page.profile === profile && page.refreshKey === refreshKey ? page : undefined;
  const supportsStructure = target?.kind === 'table';
  const supportsDdl = !!target && !!profile && canReadDdl(profile, target);
  const supportsDependencies = !!profile && !!target && target.kind !== 'connection' && supportsObjectDependencies(profile, target);
  const modes: Mode[] = ['general'];
  if (supportsStructure) modes.push('structure');
  if (supportsDdl) modes.push('ddl');
  if (supportsDependencies) modes.push('dependencies');
  const shownMode = modes.includes(mode) ? mode : 'general';
  const latestRefresh = useRef(refreshKey); latestRefresh.current = refreshKey;
  useLayoutEffect(() => { heading.current?.focus({ preventScroll: true }); return () => { live.current = undefined; }; }, []);
  useEffect(() => {
    setDefinitionEditor(undefined);
    setPreview(undefined);
    if (!target || !('name' in target) || !profile || shownMode === 'general') return;
    const source: Source = { target, profile, version, refreshKey, mode: shownMode, retry, dependencyPage };
    live.current = source;
    let taskId: string | undefined;
    function currentSource() {
      const workspace = useWorkspace.getState();
      return live.current === source && latestRefresh.current === refreshKey && current() === source.target &&
        workspace.connections.includes(source.profile) && (workspace.connectionVersions[source.profile.id] ?? 0) === source.version;
    }
    async function read() {
      const { connectionId, database, name, kind } = source.target;
      if (!currentSource()) return;
      try {
        if (sidebarConnectionEnd(connectionId)) throw Error(tableElementsZh.ending);
        let value: string | TableElements | ObjectDependencies | undefined;
        if (source.mode === 'structure') value = await invoke('metadata.tableElements', { connectionId, database, table: name });
        else if (source.mode === 'dependencies') value = await readObjectDependencies(source.profile, source.target, {
          current: currentSource, ownTask: id => { taskId = id; }, cursor: source.dependencyPage?.cursors.at(-1), digest: source.dependencyPage?.digest,
        });
        else if (source.profile.dialect === 'postgresql') {
          value = await invoke('postgres.structure.definition', postgresDefinitionTargetSchema.parse({ connectionId, database, name, kind }));
        } else {
          if (source.profile.dialect !== 'sqlite') await invoke('connections.open', { id: connectionId });
          if (!currentSource()) return;
          if (sidebarConnectionEnd(connectionId)) throw Error(tableElementsZh.ending);
          value = await invoke('metadata.ddl', { connectionId, database, name, kind });
        }
        if (value !== undefined && currentSource()) {
          if (sidebarConnectionEnd(connectionId)) throw Error(tableElementsZh.ending);
          setResult({ source, value });
        }
      } catch (error) {
        if (currentSource()) setResult({ source, error: errorMessage(error) });
      } finally { taskId = undefined; }
    }
    void read();
    return () => {
      if (live.current === source) live.current = undefined;
      if (taskId) void invoke('query.cancel', { taskId }).catch(() => {});
    };
  }, [target, profile, version, shownMode, refreshKey, retry, dependencyPage]);
  const owned = result?.source.target === target && result?.source.profile === profile &&
    result?.source.version === version && result?.source.mode === shownMode && result?.source.retry === retry &&
    result?.source === live.current && result?.source.refreshKey === refreshKey && result?.source.dependencyPage === dependencyPage ? result : undefined;
  const shownPreview = preview?.source === owned?.source ? preview : undefined;
  useLayoutEffect(() => {
    if (shownPreview || !returnFocus.current) return;
    const { trigger, scrollTop } = returnFocus.current;
    returnFocus.current = undefined;
    if (!trigger.isConnected || trigger.closest('[hidden]')) return;
    if (content.current) content.current.scrollTop = scrollTop;
    trigger.focus({ preventScroll: true });
  }, [shownPreview]);
  const name = target && 'name' in target ? target.name : target?.kind === 'database' ? target.database : profile?.name;
  const kind = target?.kind === 'connection' ? text.connection : target?.kind === 'database' ? text.database : target ? kindLabels[target.kind] : '';
  const findReady = !!owned && definitionEditor?.source === owned.source;

  function choose(next: Mode) { if (next !== mode) { live.current = undefined; setResult(undefined); setPage(undefined); setMode(next); } }
  function dependencySourceCurrent(source: Source) {
    const workspace = useWorkspace.getState();
    return live.current === source && latestRefresh.current === source.refreshKey && current() === source.target &&
      workspace.connections.includes(source.profile) && (workspace.connectionVersions[source.profile.id] ?? 0) === source.version &&
      !sidebarConnectionEnd(source.profile.id);
  }
  /** 翻页只沿同一次原目录摘要推进；返回第一页同样核对源对象。 */
  function changeDependencyPage(cursor?: string) {
    if (!owned || live.current !== owned.source || current() !== owned.source.target ||
        'error' in owned || typeof owned.value === 'string' || !('references' in owned.value) || !owned.value.page) return;
    const cursors = dependencyPage?.cursors ?? [];
    setPage({ target: owned.source.target, profile: owned.source.profile, refreshKey,
      cursors: cursor === undefined ? cursors.slice(0, -1) : [...cursors, cursor], digest: owned.value.page.digest });
    live.current = undefined;
  }
  /** 只在原只读定义模型中查找，不把命令发往下方查询编辑器。 */
  function findDefinition() {
    if (!definitionEditor || live.current !== definitionEditor.source || current() !== definitionEditor.source.target) return;
    const { instance } = definitionEditor, model = instance.getModel();
    if (!model || model.isDisposed()) return;
    instance.focus();
    void instance.getAction('actions.find')?.run().catch(reason => {
      if (live.current === definitionEditor.source) useWorkspace.getState().notify(errorMessage(reason), true);
    });
  }
  const sizeLabel = expanded ? text.restoreSize : text.expand;
  return <aside ref={pane} id="object-information-pane" className="object-information-pane" aria-labelledby="object-information-heading"
    data-layout={expanded ? 'expanded' : overlay ? 'overlay' : 'docked'} style={{ '--object-info-width': `${width}px` } as CSSProperties}>
    {handle}
    <header className="object-info-heading">
      <Info size={16}/><h2 id="object-information-heading" ref={heading} tabIndex={-1}>{text.title}</h2>
      <span className="grow"/>
      {shownMode === 'ddl' && <button type="button" className="icon-button" title={text.find} aria-label={text.find} disabled={!findReady}
        onClick={findDefinition}><Search size={14}/></button>}
      {shownMode !== 'general' && <button type="button" className="icon-button" title={text.refresh} aria-label={text.refresh} onClick={() => {
        live.current = undefined; setResult(undefined); setPage(undefined); retryRead(value => value + 1);
      }}><RefreshCw size={14}/></button>}
      <button type="button" className="icon-button" title={sizeLabel} aria-label={sizeLabel} onClick={onToggleSize}>
        {expanded ? <Minimize2 size={14}/> : <Maximize2 size={14}/>}
      </button>
      <button type="button" className="icon-button" title={text.close} aria-label={text.close} onClick={onClose}><X size={16}/></button>
    </header>
    {target && profile ? <>
      <div className="object-info-subject"><strong title={name}>{name}</strong><span>{kind}</span></div>
      {modes.length > 1 && <div className="object-info-modes" role="group" aria-label={text.modes}>
        {modes.map(item =>
          <button type="button" key={item} aria-pressed={shownMode === item} onClick={() => choose(item)}>{text[item]}</button>)}
      </div>}
      <div ref={content} className={`object-info-content${shownMode === 'ddl' ? ' object-info-ddl' : ''}`}>
        {shownMode === 'general' ? <dl>
          {target.kind !== 'connection' && <><dt>{text.connection}</dt><dd>{profile.name}</dd></>}
          {'name' in target && <><dt>{text.database}</dt><dd>{target.database}</dd></>}
          <dt>{text.vendor}</dt><dd>{sidebarViewZh.vendors[profile.dialect]}</dd>
          <dt>{text.group}</dt><dd>{connectionOrganizationZh.groupDisplay(profile.group ?? '')}</dd>
        </dl> : !owned ? <Spinner text={text.loading}/> : 'error' in owned ? <ErrorBox message={owned.error}/> :
          typeof owned.value !== 'string' ? 'references' in owned.value
            ? <>
              <div hidden={!!shownPreview}><DependencyList value={owned.value} page={(dependencyPage?.cursors.length ?? 0) + 1}
                previous={() => changeDependencyPage()} next={changeDependencyPage}
                open={(row, trigger) => {
                  if (row.definition && dependencySourceCurrent(owned.source)) setPreview({
                    source: owned.source, identity: row.identity, target: row.definition, trigger, scrollTop: content.current?.scrollTop ?? 0,
                  });
                }}/></div>
              {shownPreview && <DependencyDefinition target={shownPreview.target} profile={shownPreview.source.profile}
                identity={shownPreview.identity} current={() => dependencySourceCurrent(shownPreview.source)} onBack={() => {
                  returnFocus.current = shownPreview;
                  setPreview(undefined);
                }}/>}
            </>
            : <TableStructure value={owned.value}/> :
            owned.value ? <SqlEditor key={JSON.stringify([sidebarNodeKey(target), refreshKey, retry])} value={owned.value} dialect={profile.dialect} readOnly
              onReady={instance => { if (live.current === owned.source) setDefinitionEditor({ source: owned.source, instance }); }}/> :
              <p role="status">{text.noDefinition}</p>}
      </div>
    </> : <p className="object-info-empty">{text.select}</p>}
  </aside>;
}
