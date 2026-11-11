import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Info, RefreshCw, Search, X } from 'lucide-react';
import type { editor } from 'monaco-editor';
import type { ConnectionProfile } from '../../shared/contracts';
import { postgresDefinitionTargetSchema } from '../../shared/databaseSearch';
import type { TableElements } from '../../shared/tableElements';
import { invoke, errorMessage, kindLabels } from '../lib';
import { objectInformationZh as text } from '../locales/objectInformation.zh-CN';
import { sidebarViewZh } from '../locales/sidebarView.zh-CN';
import { tableElementsZh } from '../locales/tableElements.zh-CN';
import { connectionOrganizationZh } from '../../shared/connectionOrganization.zh-CN';
import { sidebarConnectionEnd } from '../sidebarNodeRequests';
import { useWorkspace } from '../store';
import { sidebarNodeKey, useSidebarSelection, type SidebarNodeTarget } from './SidebarContextMenu';
import { SqlEditor } from './SqlEditor';
import { ErrorBox, Spinner } from './ui';
import '../objectInformation.css';

type Mode = 'general' | 'structure' | 'ddl';
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

interface Source {
  target: NamedTarget;
  profile: ConnectionProfile;
  version: number;
  refreshKey: string;
  mode: ReadMode;
  retry: number;
}
type Result = { source: Source; value: string | TableElements } | { source: Source; error: string };

/** 原对象行、连接修订及目录代次共同约束发布，旧选择不能继续连库或交付原定义。 */
export function ObjectInformationPane({ refresh, connectionRefresh, objectRefresh, onClose }: {
  refresh: number;
  connectionRefresh: Record<string, number>;
  objectRefresh: Record<string, number>;
  onClose(): void;
}) {
  const { target, current } = useSidebarSelection();
  const profile = useWorkspace(state => state.connections.find(item => item.id === target?.connectionId));
  const version = useWorkspace(state => target ? state.connectionVersions[target.connectionId] ?? 0 : 0);
  const catalogVersion = target && 'database' in target ? objectRefresh[JSON.stringify([target.connectionId, target.database])] ?? 0 : 0;
  const refreshKey = JSON.stringify([refresh, target && (connectionRefresh[target.connectionId] ?? 0), catalogVersion]);
  const [mode, setMode] = useState<Mode>('general'), [retry, retryRead] = useState(0);
  const [result, setResult] = useState<Result>(), live = useRef<Source | undefined>(undefined), heading = useRef<HTMLHeadingElement>(null);
  const [definitionEditor, setDefinitionEditor] = useState<{ source: Source; instance: editor.IStandaloneCodeEditor }>();
  const supportsStructure = target?.kind === 'table';
  const supportsDdl = !!target && !!profile && canReadDdl(profile, target);
  const modes: Mode[] = ['general'];
  if (supportsStructure) modes.push('structure');
  if (supportsDdl) modes.push('ddl');
  const shownMode = mode === 'structure' && !supportsStructure || mode === 'ddl' && !supportsDdl ? 'general' : mode;
  const latestRefresh = useRef(refreshKey); latestRefresh.current = refreshKey;
  useLayoutEffect(() => { heading.current?.focus({ preventScroll: true }); return () => { live.current = undefined; }; }, []);
  useEffect(() => {
    setDefinitionEditor(undefined);
    if (!target || !('name' in target) || !profile || shownMode === 'general') return;
    const source: Source = { target, profile, version, refreshKey, mode: shownMode, retry };
    live.current = source;
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
        let value: string | TableElements;
        if (source.mode === 'structure') value = await invoke('metadata.tableElements', { connectionId, database, table: name });
        else if (source.profile.dialect === 'postgresql') {
          value = await invoke('postgres.structure.definition', postgresDefinitionTargetSchema.parse({ connectionId, database, name, kind }));
        } else {
          if (source.profile.dialect !== 'sqlite') await invoke('connections.open', { id: connectionId });
          if (!currentSource()) return;
          if (sidebarConnectionEnd(connectionId)) throw Error(tableElementsZh.ending);
          value = await invoke('metadata.ddl', { connectionId, database, name, kind });
        }
        if (currentSource()) {
          if (sidebarConnectionEnd(connectionId)) throw Error(tableElementsZh.ending);
          setResult({ source, value });
        }
      } catch (error) {
        if (currentSource()) setResult({ source, error: errorMessage(error) });
      }
    }
    void read();
    return () => { if (live.current === source) live.current = undefined; };
  }, [target, profile, version, shownMode, refreshKey, retry]);
  const owned = result?.source.target === target && result?.source.profile === profile &&
    result?.source.version === version && result?.source.mode === shownMode && result?.source.retry === retry &&
    result?.source === live.current && result?.source.refreshKey === refreshKey ? result : undefined;
  const name = target && 'name' in target ? target.name : target?.kind === 'database' ? target.database : profile?.name;
  const kind = target?.kind === 'connection' ? text.connection : target?.kind === 'database' ? text.database : target ? kindLabels[target.kind] : '';
  const findReady = !!owned && definitionEditor?.source === owned.source;

  function choose(next: Mode) { if (next !== mode) { live.current = undefined; setResult(undefined); setMode(next); } }
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
  return <aside className="object-information-pane" aria-labelledby="object-information-heading">
    <header className="object-info-heading">
      <Info size={16}/><h2 id="object-information-heading" ref={heading} tabIndex={-1}>{text.title}</h2>
      <span className="grow"/>
      {shownMode === 'ddl' && <button type="button" className="icon-button" title={text.find} aria-label={text.find} disabled={!findReady}
        onClick={findDefinition}><Search size={14}/></button>}
      {shownMode !== 'general' && <button type="button" className="icon-button" title={text.refresh} aria-label={text.refresh} onClick={() => {
        live.current = undefined; setResult(undefined); retryRead(value => value + 1);
      }}><RefreshCw size={14}/></button>}
      <button type="button" className="icon-button" title={text.close} aria-label={text.close} onClick={onClose}><X size={16}/></button>
    </header>
    {target && profile ? <>
      <div className="object-info-subject"><strong title={name}>{name}</strong><span>{kind}</span></div>
      {modes.length > 1 && <div className="object-info-modes" role="group" aria-label={text.modes}>
        {modes.map(item =>
          <button type="button" key={item} aria-pressed={shownMode === item} onClick={() => choose(item)}>{text[item]}</button>)}
      </div>}
      <div className={`object-info-content${shownMode === 'ddl' ? ' object-info-ddl' : ''}`}>
        {shownMode === 'general' ? <dl>
          {target.kind !== 'connection' && <><dt>{text.connection}</dt><dd>{profile.name}</dd></>}
          {'name' in target && <><dt>{text.database}</dt><dd>{target.database}</dd></>}
          <dt>{text.vendor}</dt><dd>{sidebarViewZh.vendors[profile.dialect]}</dd>
          <dt>{text.group}</dt><dd>{connectionOrganizationZh.groupDisplay(profile.group ?? '')}</dd>
        </dl> : !owned ? <Spinner text={text.loading}/> : 'error' in owned ? <ErrorBox message={owned.error}/> :
          typeof owned.value !== 'string' ? <TableStructure value={owned.value}/> :
            owned.value ? <SqlEditor key={JSON.stringify([sidebarNodeKey(target), refreshKey, retry])} value={owned.value} dialect={profile.dialect} readOnly
              onReady={instance => { if (live.current === owned.source) setDefinitionEditor({ source: owned.source, instance }); }}/> :
              <p role="status">{text.noDefinition}</p>}
      </div>
    </> : <p className="object-info-empty">{text.select}</p>}
  </aside>;
}
