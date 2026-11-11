import { sqliteDatabaseCopyZh, type SqliteDatabaseCopyInput } from '../../shared/sqliteDatabaseBackup';
import { postgresDatabaseManageZh } from '../locales/postgresDatabaseManage.zh-CN';
import { postgresStorageZh } from '../locales/postgresStorage.zh-CN';
import { postgresExtensionManageZh } from '../locales/postgresExtensionManage.zh-CN';
import { postgresSchemaManageZh } from '../locales/postgresSchemaManage.zh-CN';
import { postgresRoutineZh } from '../locales/postgresRoutine.zh-CN';
import { postgresSequenceZh } from '../locales/postgresSequence.zh-CN';
import type { PostgresCreateViewKind } from '../../shared/postgresCreateView';
import { postgresCreateViewZh } from '../locales/postgresCreateView.zh-CN';
import type { SqliteTableRebuildTarget } from '../../shared/sqliteTableRebuild';
import { postgresStructureZh } from '../locales/postgresStructure.zh-CN';
import { sqliteTableRebuildZh } from '../locales/sqliteTableRebuild.zh-CN';
import { sqliteObjectsZh } from '../locales/sqliteObjects.zh-CN';
import type { SqliteObjectsAction, SqliteObjectsKind } from '../../shared/sqliteObjects';
import { sqliteTableMaintenanceZh } from '../locales/sqliteTableMaintenance.zh-CN';
import type { SqliteTableMaintenanceAction } from '../../shared/sqliteTableMaintenance';
import { sqliteIndexesZh } from '../locales/sqliteIndexes.zh-CN';
import { sqliteTableRenameZh } from '../locales/sqliteTableRename.zh-CN';
import { sqliteColumnsZh } from '../locales/sqliteColumns.zh-CN';
import { sqliteTableBrowseZh } from '../locales/sqliteTableBrowse.zh-CN';
import { openSqliteObject, openSqliteDefinition, openSqliteSchemaScript, openSqliteSelect } from '../sqliteNavigation';
import { objectQueryShortcutLabel, openObjectQuery } from '../objectQueryNavigation';
import { objectQueryZh } from '../locales/objectQuery.zh-CN';
import { openNetworkSchemaScript, schemaScriptLabel } from '../schemaScriptNavigation';
import { sqliteZh } from '../locales/sqlite.zh-CN';
import { importNewTableZh } from '../locales/importNewTable.zh-CN';
import { ListChecks } from 'lucide-react';
import { tableChecksZh } from '../locales/tableChecks.zh-CN';
import type { RoutineInvocationTarget } from '../../shared/routineInvocation';
import { routineInvocationZh } from '../locales/routineInvocation.zh-CN';
import { databaseDropZh } from '../locales/databaseDrop.zh-CN';
import { isProtectedDatabaseDropName } from '../../shared/databaseDrop';
import { tableCopyDataZh } from '../locales/tableCopyData.zh-CN';
import { tableCopyStructureZh } from '../locales/tableCopyStructure.zh-CN';
import { zh, formatText } from '../locales/zh-CN';
import { connectionGroups } from '../connectionGroups';
import { connectionOrganizationZh } from '../../shared/connectionOrganization.zh-CN';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { TablePresetBranch } from './TablePresetBranch';
import { TableElementsBranch } from './TableElementsBranch';
import { sidebarLocatedObject, sidebarLocation, useSidebarLocate, type SidebarLocateRequest } from '../sidebarLocate';
import { sidebarLocateZh } from '../locales/sidebarLocate.zh-CN';
import { sidebarViewZh } from '../locales/sidebarView.zh-CN';
import { SidebarViewControls, type SidebarVendor } from './SidebarViewControls';
import { sidebarStarLimit, type SidebarView } from '../../shared/sidebarView';
import { useOpenedConnections } from '../useOpenedConnections';
import { emptySidebarCatalog, sidebarCatalogObjects, sidebarSearchMatch, type SidebarCatalog, type SidebarDatabaseMatch, type SidebarSearchMatch } from '../sidebarSearch';
import type { StructureElement } from '../structureElementFocus';
import type { TableElementsTarget } from '../../shared/tableElements';
import { FavoriteButton, WorkbenchShelf, type OpenWorkbenchTarget } from './Workbench';
import { SidebarTreeRow } from './SidebarContextMenu';
import { sidebarContextMenuZh } from '../locales/sidebarContextMenu.zh-CN';
import { ChevronDown, ChevronRight, Database, Table2, Search, Plus, Pencil, RefreshCw, FileCode2, Folder, Unplug, Trash2, Copy, HardDriveDownload, HardDriveUpload, LocateFixed, Star } from 'lucide-react';
import type { ConnectionProfile, DatabaseObject } from '../../shared/contracts';
import { errorMessage, invoke, kindLabels } from '../lib';
import { useWorkspace } from '../store';
import { Spinner } from './ui';
import { indexPatchZh } from '../locales/indexPatches.zh-CN';
import { foreignKeyPatchZh } from '../locales/foreignKeyPatches.zh-CN';
import { columnPatchZh } from '../locales/columnPatches.zh-CN';
import { tableRenameZh } from '../locales/tableRename.zh-CN';
import { tableCommentZh } from '../locales/tableComment.zh-CN';
import { databaseDefaultEncodingZh } from '../locales/databaseDefaultEncoding.zh-CN';
import { tableDefaultEncodingZh } from '../locales/tableDefaultEncoding.zh-CN';
import { connectionsTransferZh } from '../locales/connectionsTransfer.zh-CN';
import { completionServerFacts } from '../completionServerFacts';
import { beginSidebarConnectionEnd, sidebarConnectionEnd, SidebarNodeRequests } from '../sidebarNodeRequests';
import { tableAutoIncrementZh } from '../locales/tableAutoIncrement.zh-CN';

export interface SidebarObjectActionProps {
  connectionId: string; database: string; object: DatabaseObject; onOpen(): void;
  onDesign(table?: string): void; onDdl(object?: DatabaseObject): void;
  onColumnPatches(table: string): void; onIndexPatches(table: string): void; onForeignKeyPatches(table: string): void;
  onTableCopyData?(table: string): void; onTableCopyStructure?(table: string): void;
  onSqliteObjects?(kind: SqliteObjectsKind, action: SqliteObjectsAction, name?: string, sourceView?: string): void;
  onSqliteTableRebuild?(target: SqliteTableRebuildTarget): void;
  onTableMaintenance?(table: string, action: SqliteTableMaintenanceAction): void;
  onTableRename(table: string): void; onTableAutoIncrement(table: string): void; onTableChecks?(table: string): void;
  onTableComment(table: string): void; onTableDefaultEncoding(table: string): void;
  onRoutineInvocation?(target: RoutineInvocationTarget): void; onRefresh?(): void;
}

/** 树和中央对象列表复用原动作闭包；纯渲染函数使外层菜单仍能逐项消费原目标租约。 */
export function sidebarObjectActions({ connectionId, database, object, onOpen, onDesign, onDdl, onColumnPatches, onIndexPatches, onForeignKeyPatches, onTableCopyData, onTableCopyStructure, onSqliteObjects, onSqliteTableRebuild, onTableMaintenance, onTableRename, onTableAutoIncrement, onTableChecks, onTableComment, onTableDefaultEncoding, onRoutineInvocation, onRefresh }: SidebarObjectActionProps) {
  const dialect = useWorkspace.getState().connections.find(profile => profile.id === connectionId)?.dialect;
  const query = !!dialect && (object.kind === 'table' || object.kind === 'view') && (dialect !== 'sqlite' || database === 'main') &&
    <button data-menu-group="open" title={objectQueryShortcutLabel()} aria-label={objectQueryZh.entry + ' ' + object.name}
      onClick={() => dialect === 'sqlite' ? openSqliteSelect(connectionId, database, object) : openObjectQuery(connectionId, database, object)}><FileCode2 size={12}/></button>;
  if (dialect === 'postgresql') return <>
    <button data-menu-group="open" aria-label={(object.kind === 'sequence' ? postgresSequenceZh.open :
      object.kind === 'function' || object.kind === 'procedure' ? postgresRoutineZh.open : '打开记录') + ' ' + object.name} onClick={onOpen}><FileCode2 size={12}/></button>
    {query}
    {(object.kind === 'table' || object.kind === 'view') && <button data-menu-group="structure" aria-label={postgresStructureZh.open + ' ' + object.name} onClick={() => onDdl(object)}><ListChecks size={12}/></button>}
    <FavoriteButton menu target={{ connectionId, database, kind: object.kind, name: object.name }}/>
    {onRefresh && <button data-menu-group="refresh" aria-label={sidebarContextMenuZh.refreshObject(object.name)} onClick={onRefresh}><RefreshCw size={12}/></button>}
  </>;
  const editableSqliteKind = object.kind === 'view' || object.kind === 'trigger' ? object.kind : undefined;
  if (dialect === 'sqlite') return <>
    {(object.kind === 'table' || object.kind === 'view') && <><button data-menu-group="open" title={sqliteTableBrowseZh.browse} aria-label={sqliteTableBrowseZh.browse + ' ' + object.name} onClick={onOpen}><Table2 size={12}/></button>{query}</>}
    {object.kind === 'table' && database === 'main' && <button data-menu-group="structure" title={sqliteIndexesZh.entry} aria-label={sqliteIndexesZh.entry + ' ' + object.name} onClick={() => onIndexPatches(object.name)}><Table2 size={12}/></button>}
    {object.kind === 'table' && database === 'main' && <button data-menu-group="structure" title={sqliteTableRenameZh.entry} aria-label={sqliteTableRenameZh.entry + ' ' + object.name} onClick={() => onTableRename(object.name)}><Pencil size={12}/></button>}
    {object.kind === 'table' && database === 'main' && <button data-menu-group="structure" title={sqliteColumnsZh.entry} aria-label={sqliteColumnsZh.entry + ' ' + object.name} onClick={() => onColumnPatches(object.name)}><Pencil size={12}/></button>}
    {object.kind === 'table' && database === 'main' && onSqliteTableRebuild && <button data-menu-group="structure" title={sqliteTableRebuildZh.entry} aria-label={sqliteTableRebuildZh.entry + ' ' + object.name} onClick={() => onSqliteTableRebuild({ connectionId, database: 'main', table: object.name })}><Pencil size={12}/></button>}
    {object.kind === 'table' && database === 'main' && onTableMaintenance && <><button data-menu-group="danger" title={sqliteTableMaintenanceZh.clearEntry} aria-label={sqliteTableMaintenanceZh.clearEntry + ' ' + object.name} onClick={() => onTableMaintenance(object.name, 'clear')}><Trash2 size={12}/></button><button data-menu-group="danger" title={sqliteTableMaintenanceZh.dropEntry} aria-label={sqliteTableMaintenanceZh.dropEntry + ' ' + object.name} onClick={() => onTableMaintenance(object.name, 'drop')}><Trash2 size={12}/></button></>}
    {editableSqliteKind && database === 'main' && onSqliteObjects && <><button data-menu-group="structure" title={sqliteObjectsZh.editDefinition} aria-label={sqliteObjectsZh.editDefinition + ' ' + object.name} onClick={() => onSqliteObjects(editableSqliteKind, 'replace', object.name)}><Pencil size={12}/></button><button data-menu-group="danger" title={editableSqliteKind === 'view' ? sqliteObjectsZh.dropView : sqliteObjectsZh.dropTrigger} aria-label={(editableSqliteKind === 'view' ? sqliteObjectsZh.dropView : sqliteObjectsZh.dropTrigger) + ' ' + object.name} onClick={() => onSqliteObjects(editableSqliteKind, 'drop', object.name)}><Trash2 size={12}/></button></>}
    {object.kind === 'view' && database === 'main' && onSqliteObjects && <button data-menu-group="structure"
      title={sqliteObjectsZh.copyView} aria-label={sqliteObjectsZh.copyView + ' ' + object.name}
      onClick={() => onSqliteObjects('view', 'create', undefined, object.name)}><Copy size={12}/></button>}
    <button data-menu-group="structure" title={sqliteZh.definition} aria-label={sqliteZh.definition + ' ' + object.name} onClick={() => void openSqliteDefinition(connectionId, database, object)}><Pencil size={12}/></button>
    {(object.kind === 'table' || object.kind === 'view') && database === 'main' && <button data-menu-group="structure" title={sqliteZh.structureScript} aria-label={sqliteZh.structureScript + ' ' + object.name} onClick={() => void openSqliteSchemaScript(connectionId, database, object)}><FileCode2 size={12}/></button>}
    {onRefresh && <button data-menu-group="refresh" title={zh.common.refresh} aria-label={sidebarContextMenuZh.refreshObject(object.name)} onClick={onRefresh}><RefreshCw size={12}/></button>}
  </>;
  return <>{query}{(object.kind === 'table' || object.kind === 'view') && <button data-menu-group="structure" title={schemaScriptLabel} aria-label={schemaScriptLabel + ' ' + object.name} onClick={() => void openNetworkSchemaScript(connectionId, database, object)}><FileCode2 size={12}/></button>}<button data-menu-group="open" title={sidebarContextMenuZh.open} aria-label={sidebarContextMenuZh.openObject(object.name)} onClick={onOpen}><Table2 size={12}/></button>{onRoutineInvocation && (object.kind === 'procedure' || object.kind === 'function') && <button data-menu-group="open" title={routineInvocationZh.entry} aria-label={`${routineInvocationZh.entry} ${object.name}`} onClick={() => { if (object.kind === 'procedure' || object.kind === 'function') onRoutineInvocation?.({ connectionId, database, name: object.name, kind: object.kind }); }}><FileCode2 size={12}/></button>}<FavoriteButton menu target={{ connectionId, database, kind: object.kind, name: object.name }}/><button data-menu-group="favorite" title={sidebarContextMenuZh.copyLink} aria-label={sidebarContextMenuZh.copyObjectLink(object.name)} onClick={() => void invoke('workbench.copyUri', { connectionId, database, kind: object.kind, name: object.name }).catch(reason => useWorkspace.getState().notify(errorMessage(reason), true))}><Copy size={12}/></button>{object.kind === 'table' && <button data-menu-group="structure" title={tableDefaultEncodingZh.title} aria-label={`${tableDefaultEncodingZh.title} ${object.name}`} onClick={() => onTableDefaultEncoding(object.name)}><Pencil size={12}/></button>}{object.kind === 'table' && onTableCopyData && <button data-menu-group="transfer" title={tableCopyDataZh.title} aria-label={`${tableCopyDataZh.title} ${object.name}`} onClick={() => onTableCopyData(object.name)}><Copy size={12}/></button>}{object.kind === 'table' && onTableCopyStructure && <button data-menu-group="transfer" title={tableCopyStructureZh.title} aria-label={`${tableCopyStructureZh.title} ${object.name}`} onClick={() => onTableCopyStructure(object.name)}><Copy size={12}/></button>}{object.kind === 'table' && <button data-menu-group="structure" title={tableRenameZh.title} aria-label={`${tableRenameZh.title} ${object.name}`} onClick={() => onTableRename(object.name)}><Pencil size={12}/></button>}{object.kind === 'table' && <button data-menu-group="structure" title={tableAutoIncrementZh.title} aria-label={`${tableAutoIncrementZh.title} ${object.name}`} onClick={() => onTableAutoIncrement(object.name)}><Pencil size={12}/></button>}{object.kind === 'table' && onTableChecks && <button data-menu-group="structure" title={tableChecksZh.entry} aria-label={`${tableChecksZh.entry} ${object.name}`} onClick={() => onTableChecks(object.name)}><ListChecks size={12}/></button>}{object.kind === 'table' && <button data-menu-group="structure" title={tableCommentZh.title} aria-label={`${tableCommentZh.title} ${object.name}`} onClick={() => onTableComment(object.name)}><Pencil size={12}/></button>}{object.kind === 'table' && <button data-menu-group="structure" title={foreignKeyPatchZh.title} aria-label={`${foreignKeyPatchZh.title} ${object.name}`} onClick={() => onForeignKeyPatches(object.name)}><Table2 size={12}/></button>}{object.kind === 'table' && <button data-menu-group="structure" title={indexPatchZh.title} aria-label={`${indexPatchZh.title} ${object.name}`} onClick={() => onIndexPatches(object.name)}><Table2 size={12}/></button>}{object.kind === 'table' && <button data-menu-group="structure" title={columnPatchZh.title} aria-label={`${columnPatchZh.title} ${object.name}`} onClick={() => onColumnPatches(object.name)}><Pencil size={12}/></button>}<button data-menu-group="structure" data-menu-order={0} title={object.kind === 'table' ? zh.sidebar.text020 : zh.sidebar.text021} aria-label={formatText(zh.sidebar.text022, object.name)} onClick={() => object.kind === 'table' ? onDesign(object.name) : onDdl(object)}><Pencil size={12}/></button>{onRefresh && <button data-menu-group="refresh" title={zh.common.refresh} aria-label={sidebarContextMenuZh.refreshObject(object.name)} onClick={onRefresh}><RefreshCw size={12}/></button>}</>;
}

/** 节点请求始终读取同步连接修订；卸载或重挂载只撤销旧结果，不动后端共享连接。 */
function useNodeRequests(connectionId: string): SidebarNodeRequests {
  const ref = useRef<SidebarNodeRequests | null>(null);
  ref.current ??= new SidebarNodeRequests(() => useWorkspace.getState().connectionVersions[connectionId] ?? 0);
  const requests = ref.current;
  useLayoutEffect(() => { requests.activate(); return () => requests.dispose(); }, [requests]);
  return requests;
}

/** 原生文件选择与备份进程均由 Main 管理，侧栏只发起意图和显示结果。 */
async function copySqliteDatabase(input: SqliteDatabaseCopyInput) {
  const text = sqliteDatabaseCopyZh;
  try {
    const result = await invoke('sqlite.databaseCopy', input);
    if (result) useWorkspace.getState().notify(result.cleanupPending ? text.cleanupPending : input.mode === 'backup' ? text.saved(result.name) : text.restored(result.name), result.cleanupPending);
  } catch (error) { useWorkspace.getState().notify(errorMessage(error), true); }
}

const defaultSidebarView: SidebarView = { flat: false, starred: [] };

/** 按连接分组展示对象树，只对用户展开的节点加载数据库元数据。 */
export function Sidebar({ onNewConnection, onEditConnection, onCopyConnection, onImportNewTable, onDesign, onDesignElement, onColumnPatches, onIndexPatches, onForeignKeyPatches, onTableCopyData, onTableCopyStructure, onSqliteObjects, onSqliteTableRebuild, onTableMaintenance, onTableRename, onTableAutoIncrement, onTableChecks, onTableComment, onTableDefaultEncoding, onDatabaseDefaultEncoding, onDatabaseDrop, onRoutineInvocation, onDdl, onOpenWorkbench, refreshVersion, objectRefreshVersions = {}, connectionRefreshVersions = {} }: { onNewConnection: () => void; onEditConnection: (profile: ConnectionProfile) => void; onCopyConnection: (profile: ConnectionProfile) => void; onImportNewTable?: (connectionId: string, database: string) => void; onDesign: (connectionId: string, database: string, table?: string, createView?: PostgresCreateViewKind | 'sequence' | 'routine') => void; onDesignElement?: (target: TableElementsTarget, element: StructureElement) => void; onColumnPatches: (connectionId: string, database: string, table: string) => void; onIndexPatches: (connectionId: string, database: string, table: string) => void; onForeignKeyPatches: (connectionId: string, database: string, table: string) => void; onTableCopyData?: (connectionId: string, database: string, table: string) => void; onTableCopyStructure?: (connectionId: string, database: string, table: string) => void; onSqliteObjects?: (connectionId: string, database: string, kind: SqliteObjectsKind, action: SqliteObjectsAction, name?: string, sourceView?: string) => void; onSqliteTableRebuild?: (target: SqliteTableRebuildTarget) => void; onTableMaintenance?: (connectionId: string, database: string, table: string, action: SqliteTableMaintenanceAction) => void; onTableRename: (connectionId: string, database: string, table: string) => void; onTableAutoIncrement: (connectionId: string, database: string, table: string) => void; onTableChecks?: (connectionId: string, database: string, table: string) => void; onTableComment: (connectionId: string, database: string, table: string) => void; onDatabaseDefaultEncoding?: (connectionId: string, database: string) => void; onDatabaseDrop?: (connectionId: string, database: string) => void; onTableDefaultEncoding: (connectionId: string, database: string, table: string) => void; onRoutineInvocation?: (target: RoutineInvocationTarget) => void; onDdl: (connectionId: string, database?: string, object?: DatabaseObject, management?: 'extensions' | 'storage') => void; onOpenWorkbench: OpenWorkbenchTarget; refreshVersion: number; objectRefreshVersions?: Record<string, number>; connectionRefreshVersions?: Record<string, number> }) {
  const connections = useWorkspace(state => state.connections);
  const connectionVersions = useWorkspace(state => state.connectionVersions);
  const activeTab = useWorkspace(state => state.settings.tabs.find(tab => tab.id === state.settings.activeTabId) ?? state.settings.tabs[0]);
  const view = useWorkspace(state => state.settings.sidebarView) ?? defaultSidebarView;
  const [search, setSearch] = useState({ value: '' }), [vendor, setVendor] = useState<SidebarVendor>(''), [starredOnly, setStarredOnly] = useState(false);
  const [foldedSearch, setFoldedSearch] = useState<typeof search>();
  const [catalogs, setCatalogs] = useState(new Map<string, SidebarCatalog>());
  const needle = search.value.trim().toLowerCase();
  const searchToken = needle && foldedSearch !== search ? search : undefined;
  const [openedOnly, setOpenedOnly] = useState(false);
  const opened = useOpenedConnections(openedOnly);
  const collapseNodes = useRef(new Map<string, () => void>());
  const locate = useSidebarLocate();
  const location = sidebarLocation(activeTab, connections.find(profile => profile.id === activeTab?.connectionId));
  const starred = new Set(view.starred);
  const openedIds = new Set(opened.ids);
  const keys = new Map(connections.map(profile => [profile.id, JSON.stringify([profile.id, refreshVersion,
    connectionVersions[profile.id] ?? 0, connectionRefreshVersions[profile.id] ?? 0])]));
  const liveKeys = useRef<ReadonlyMap<string, string>>(keys);
  liveKeys.current = keys;
  const keySignature = JSON.stringify([...keys.values()]);
  useEffect(() => {
    const active = new Set(liveKeys.current.values());
    setCatalogs(previous => [...previous.keys()].some(key => !active.has(key))
      ? new Map([...previous].filter(([key]) => active.has(key))) : previous);
  }, [keySignature]);
  const matches = new Map(connections.map(profile => [profile.id, sidebarSearchMatch(profile,
    catalogs.get(keys.get(profile.id)!) ?? emptySidebarCatalog, needle, objectRefreshVersions)]));
  const visibleIds = new Set(connections.filter(profile =>
    matches.get(profile.id)?.visible !== false &&
    (!vendor || profile.dialect === vendor) && (!starredOnly || starred.has(profile.id)) && (!openedOnly || openedIds.has(profile.id))
  ).map(profile => profile.id));
  // 同一层兄弟使用原连接键，换组、筛选及扁平显示都保留原节点的目录和请求。
  const groups = connectionGroups(connections);
  function clearFilters() { setVendor(''); setStarredOnly(false); setOpenedOnly(false); }
  function collapseAll() {
    locate.cancel();
    setFoldedSearch(search);
    for (const collapse of collapseNodes.current.values()) collapse();
  }
  /** 仅当前连接修订可发布目录。切换筛选条件不改动缓存或发起读取。 */
  function updateCatalog(id: string, key: string, update: (current: SidebarCatalog) => SidebarCatalog) {
    setCatalogs(previous => {
      if (liveKeys.current.get(id) !== key) return previous;
      const next = new Map(previous);
      next.set(key, update(previous.get(key) ?? emptySidebarCatalog));
      return next;
    });
  }
  return <aside className="sidebar">
    <div className="sidebar-heading">
      <span>{zh.sidebar.text002}</span>
      <button type="button" className="icon-button sidebar-locate" aria-label={sidebarLocateZh.action}
        title={location ? sidebarLocateZh.action : sidebarLocateZh.unavailable} disabled={!location} aria-busy={!!locate.request}
        onClick={() => { if (locate.start()) { setSearch({ value: '' }); clearFilters(); } }}><LocateFixed size={15}/></button>
      <button className="icon-button" aria-label={sqliteDatabaseCopyZh.restore} title={sqliteDatabaseCopyZh.restore}
        onClick={() => void copySqliteDatabase({ mode: 'restore' })}><HardDriveUpload size={16}/></button>
      <button className="icon-button" aria-label={zh.common.newConnection} title={zh.common.newConnection}
        onClick={onNewConnection}><Plus size={17}/></button>
    </div>
    <div className="search-box">
      <Search size={14}/><input aria-label={zh.sidebar.text003} value={search.value}
        onChange={event => { locate.cancel(); setSearch({ value: event.target.value }); }} placeholder={zh.sidebar.text004}/>
      <SidebarViewControls vendor={vendor} starredOnly={starredOnly} openedOnly={openedOnly} flat={view.flat}
        onVendor={setVendor} onStarredOnly={setStarredOnly} onOpenedOnly={setOpenedOnly}
        onFlat={flat => { const state = useWorkspace.getState(); state.updateSettings({ sidebarView: { ...(state.settings.sidebarView ?? defaultSidebarView), flat } }); }}
        onCollapse={collapseAll}/>
    </div>
    <div className="tree-scroll">
      <WorkbenchShelf onOpen={onOpenWorkbench}/>
      {groups.flatMap(group => {
        const lastVisible = group.connections.filter(profile => visibleIds.has(profile.id)).at(-1);
        return [
          !view.flat && lastVisible && <div className="group-label connection-group-heading" key={`connection-group:${JSON.stringify(group.name)}`}>
            <Folder size={13}/>{connectionOrganizationZh.groupDisplay(group.name)}
          </div>,
          ...group.connections.map(profile => {
            const key = keys.get(profile.id)!;
            return <ConnectionNode key={key} groupEnd={!view.flat && profile === lastVisible} profile={profile}
            search={needle} searchToken={searchToken} searchMatch={matches.get(profile.id)} visible={visibleIds.has(profile.id)}
            catalog={catalogs.get(key) ?? emptySidebarCatalog} updateCatalog={update => updateCatalog(profile.id, key, update)}
            starred={starred.has(profile.id)} collapseNodes={collapseNodes.current} locate={locate.request?.connectionId === profile.id ? locate.request : undefined}
            onEdit={() => onEditConnection(profile)} onCopy={() => onCopyConnection(profile)} onImportNewTable={onImportNewTable}
            onDesign={onDesign} onDesignElement={onDesignElement} onColumnPatches={onColumnPatches}
            onIndexPatches={onIndexPatches} onForeignKeyPatches={onForeignKeyPatches} onTableCopyData={onTableCopyData}
            onTableCopyStructure={onTableCopyStructure} onSqliteObjects={onSqliteObjects} onSqliteTableRebuild={onSqliteTableRebuild}
            onTableMaintenance={onTableMaintenance} onTableRename={onTableRename} onTableAutoIncrement={onTableAutoIncrement} onTableChecks={onTableChecks}
            onTableComment={onTableComment} onTableDefaultEncoding={onTableDefaultEncoding} onDatabaseDefaultEncoding={onDatabaseDefaultEncoding}
            onDatabaseDrop={onDatabaseDrop} onRoutineInvocation={onRoutineInvocation}
            onDdl={onDdl} objectRefreshVersions={objectRefreshVersions}/>;
          })
        ];
      })}
      {connections.length > 0 && visibleIds.size === 0 && <div className="sidebar-empty sidebar-filter-empty">
        <p role="status">{openedOnly && !opened.ids
          ? opened.failed ? sidebarViewZh.readOpenedFailed : sidebarViewZh.readingOpened
          : needle ? sidebarViewZh.noSearchMatch : sidebarViewZh.noMatch}</p>
        {needle && <button type="button" onClick={() => setSearch({ value: '' })}>{sidebarViewZh.resetSearch}</button>}
        {(vendor || starredOnly || openedOnly) && <button type="button" onClick={clearFilters}>{sidebarViewZh.reset}</button>}
      </div>}
      {connections.length === 0 && <div className="sidebar-empty"><Database size={30}/><p>{zh.sidebar.text005}</p><button onClick={onNewConnection}><Plus size={14}/>{zh.common.newConnection}</button></div>}
    </div>
    <div className="sidebar-bottom"><span className="status-dot"/>{zh.sidebar.text006}<span className="grow"/>
      <span>{visibleIds.size === connections.length ? connections.length : `${visibleIds.size} / ${connections.length}`}{zh.sidebar.text007}</span>
    </div>
  </aside>;
}

/** 连接节点维护展开状态及数据库列表；groupEnd仅保留原组尾间距，不参与节点身份或请求生命周期。 */
function ConnectionNode({ groupEnd = false, visible = true, starred = false, collapseNodes, profile, search, searchToken, searchMatch, catalog, updateCatalog, locate, onEdit, onCopy, onImportNewTable, onDesign, onDesignElement, onColumnPatches, onIndexPatches, onForeignKeyPatches, onTableCopyData, onTableCopyStructure, onSqliteObjects, onSqliteTableRebuild, onTableMaintenance, onTableRename, onTableAutoIncrement, onTableChecks, onTableComment, onTableDefaultEncoding, onDatabaseDefaultEncoding, onDatabaseDrop, onRoutineInvocation, onDdl, objectRefreshVersions }: { groupEnd?: boolean; visible?: boolean; starred?: boolean; collapseNodes?: Map<string, () => void>; objectRefreshVersions: Record<string, number>; profile: ConnectionProfile; search: string; searchToken?: object; searchMatch?: SidebarSearchMatch; catalog: SidebarCatalog; updateCatalog(update: (current: SidebarCatalog) => SidebarCatalog): void; locate?: SidebarLocateRequest; onEdit: () => void; onCopy: () => void; onImportNewTable?: (connectionId: string, database: string) => void; onDesign: (connectionId: string, database: string, table?: string, createView?: PostgresCreateViewKind | 'sequence' | 'routine') => void; onDesignElement?: (target: TableElementsTarget, element: StructureElement) => void; onColumnPatches: (connectionId: string, database: string, table: string) => void; onIndexPatches: (connectionId: string, database: string, table: string) => void; onForeignKeyPatches: (connectionId: string, database: string, table: string) => void; onTableCopyData?: (connectionId: string, database: string, table: string) => void; onTableCopyStructure?: (connectionId: string, database: string, table: string) => void; onSqliteObjects?: (connectionId: string, database: string, kind: SqliteObjectsKind, action: SqliteObjectsAction, name?: string, sourceView?: string) => void; onSqliteTableRebuild?: (target: SqliteTableRebuildTarget) => void; onTableMaintenance?: (connectionId: string, database: string, table: string, action: SqliteTableMaintenanceAction) => void; onTableRename: (connectionId: string, database: string, table: string) => void; onTableAutoIncrement: (connectionId: string, database: string, table: string) => void; onTableChecks?: (connectionId: string, database: string, table: string) => void; onTableComment: (connectionId: string, database: string, table: string) => void; onDatabaseDefaultEncoding?: (connectionId: string, database: string) => void; onDatabaseDrop?: (connectionId: string, database: string) => void; onTableDefaultEncoding: (connectionId: string, database: string, table: string) => void; onRoutineInvocation?: (target: RoutineInvocationTarget) => void; onDdl: (connectionId: string, database?: string, object?: DatabaseObject, management?: 'extensions' | 'storage') => void }) {
  const { databases } = catalog;
  const [foldedSearch, setFoldedSearch] = useState<object>();
  const [opened, setOpened] = useState(false); const [busy, setBusy] = useState(false); const [connected, setConnected] = useState(false);
  const requests = useNodeRequests(profile.id), openedRef = useRef(false);
  const selection = useWorkspace(state => state.selection);
  /** 同轮连续点击也看到最新展开意图，不等待React提交后才撤销加载。 */
  function expand(value: boolean) { openedRef.current = value; setOpened(value); }
  // 批量折叠在当前事件内撤销所有读取意图；仍在执行的断开或删除继续持有忙态。
  useLayoutEffect(() => {
    if (!collapseNodes) return;
    const collapse = () => {
      if (requests.collapse()) setBusy(false);
      expand(false);
    };
    collapseNodes.set(profile.id, collapse);
    return () => { if (collapseNodes.get(profile.id) === collapse) collapseNodes.delete(profile.id); };
  }, [collapseNodes, profile.id, requests]);
  /** 用最新快照增删原连接 ID，防止连续星标或视图切换覆盖其它偏好。 */
  function toggleStar() {
    const state = useWorkspace.getState(), view = state.settings.sidebarView ?? defaultSidebarView;
    const existing = new Set(state.connections.map(item => item.id));
    if (!existing.has(profile.id)) return;
    const next = view.starred.filter(id => id !== profile.id && existing.has(id));
    if (!view.starred.includes(profile.id)) {
      if (next.length >= sidebarStarLimit) { state.notify(sidebarViewZh.limit, true); return; }
      next.push(profile.id);
    }
    state.updateSettings({ sidebarView: { ...view, starred: next } });
  }
  const searchExpanded = !!(visible && searchToken && searchMatch?.reveal);
  const displayedOpen = (opened || searchExpanded) && !(searchExpanded && foldedSearch === searchToken);
  /** 搜索展开是临时状态；点击可折叠当前命中路径，清除搜索恢复原展开。 */
  function toggle() {
    useWorkspace.getState().select({ connectionId: profile.id });
    if (searchExpanded && !busy) { setFoldedSearch(foldedSearch === searchToken ? undefined : searchToken); return; }
    if (openedRef.current || requests.kind === 'load') {
      if (requests.collapse()) { expand(false); setBusy(false); }
    } else void load();
  }
  useEffect(() => {
    if (locate?.database === undefined || !locate.current() || busy || opened && databases.includes(locate.database)) return;
    void load(locate);
  }, [locate, opened, busy, databases]);
  /** 先验证连接再列出可访问数据库，失败时保留可重试的节点入口。 */
  async function load(location?: SidebarLocateRequest, refresh = false) {
    const request = requests.begin('load'); if (!request) return;
    setBusy(true);
    const current = () => requests.current(request) && (!location || location.current());
    let ticket: ReturnType<typeof completionServerFacts.begin> | undefined;
    try {
      // 结束屏障可能被另一项明确操作接续，恢复前重新核对当前屏障及本次意图。
      for (let ending = sidebarConnectionEnd(profile.id); ending; ending = sidebarConnectionEnd(profile.id)) { await ending; if (!current()) return; }
      if (!current()) return;
      ticket = completionServerFacts.begin(profile.id, useWorkspace.getState().connectionVersions[profile.id] ?? 0);
      const status = await invoke('connections.open', { id: profile.id });
      if (!current()) return;
      completionServerFacts.complete(ticket, status); setConnected(true);
      const next = await invoke('metadata.databases', { connectionId: profile.id });
      if (!current()) return;
      const names = new Set(next);
      updateCatalog(previous => ({ databases: next, objects: refresh ? new Map() : new Map([...previous.objects].filter(([name]) => names.has(name))) }));
      expand(true);
      if (location?.database !== undefined && !next.includes(location.database)) location.fail(sidebarLocateZh.missingDatabase(location.database));
    } catch (error) {
      if (location) location.fail(errorMessage(error)); else useWorkspace.getState().notify(errorMessage(error), true);
    }
    finally { if (ticket) completionServerFacts.fail(ticket); if (requests.finish(request)) setBusy(false); }
  }
  /** 明确断开立即撤销加载意图，成功后折叠；后端失败保持原连接状态与真实错误。 */
  async function disconnect() {
    const ending = beginSidebarConnectionEnd(profile.id); if (!ending) return;
    const request = requests.begin('disconnect'); if (!request) { ending.release(); return; }
    setBusy(true);
    completionServerFacts.clear(profile.id);
    try { await invoke('connections.close', { id: profile.id }); if (requests.current(request)) { updateCatalog(() => emptySidebarCatalog); setConnected(false); expand(false); } } catch (error) { useWorkspace.getState().notify(errorMessage(error), true); }
    // 后端可能已关闭会话再报告取消收尾错误；仅当前节点清本代事实，不能清除新节点的事实。
    finally { if (requests.current(request)) completionServerFacts.clear(profile.id); ending.release(); if (requests.finish(request)) setBusy(false); }
  }
  /** 删除操作仅作用于本地连接配置，执行前明确提示不会删除数据库。 */
  async function remove() {
    if (!window.confirm(formatText(zh.sidebar.text008, profile.name))) return;
    const ending = beginSidebarConnectionEnd(profile.id); if (!ending) return;
    const request = requests.begin('remove'); if (!request) { ending.release(); return; }
    setBusy(true);
    completionServerFacts.clear(profile.id);
    try { await invoke('connections.delete', { id: profile.id }); if (!requests.current(request)) return; const next = await invoke('connections.list', {}); if (requests.current(request)) useWorkspace.getState().setConnections(next); } catch (error) { useWorkspace.getState().notify(errorMessage(error), true); }
    finally { if (requests.current(request)) completionServerFacts.clear(profile.id); ending.release(); if (requests.finish(request)) setBusy(false); }
  }
  return <div className="connection-node" hidden={!visible} style={groupEnd ? { marginBottom: 10 } : undefined}><SidebarTreeRow target={{ kind: 'connection', connectionId: profile.id }} label={profile.name} className="connection-row" locate={locate?.database === undefined ? locate : undefined} version={[profile, search, busy, displayedOpen, connected, databases, requests.kind]} actions={<><button data-menu-group="favorite" aria-label={starred ? sidebarViewZh.unstar : sidebarViewZh.star} onClick={toggleStar}>
    <Star size={12}/></button><button data-menu-group="transfer" title={connectionsTransferZh.copy} aria-label={formatText(connectionsTransferZh.copyAction, profile.name)} onClick={onCopy}><Copy size={12}/></button>{profile.dialect === 'sqlite' && <button data-menu-group="transfer" title={sqliteDatabaseCopyZh.backup} aria-label={sqliteDatabaseCopyZh.backup} disabled={!profile.sqlite.filePath || !!profile.pendingFiles?.length} onClick={() => void copySqliteDatabase({ mode: 'backup', connectionId: profile.id })}><HardDriveDownload size={12}/></button>}<button data-menu-group="structure" title={zh.sidebar.text009} aria-label={formatText(zh.sidebar.text010, profile.name)} onClick={onEdit}><Pencil size={12}/></button><button data-menu-group="refresh" title={zh.sidebar.text011} aria-label={zh.sidebar.text011} disabled={busy} onClick={() => void load(undefined, true)}><RefreshCw size={12}/></button>{profile.dialect !== 'sqlite' && <button data-menu-group="create" title={zh.sidebar.text012} aria-label={zh.sidebar.text012} onClick={() => onDdl(profile.id)}><Plus size={12}/></button>}{profile.dialect === 'postgresql' && <button data-menu-group="structure" aria-label={postgresDatabaseManageZh.title} onClick={() => onDdl(profile.id)}><ListChecks size={12}/></button>}{connected && <button data-menu-group="danger" title={zh.sidebar.text013} aria-label={zh.sidebar.text013} disabled={requests.kind === 'disconnect' || requests.kind === 'remove'} onClick={() => void disconnect()}><Unplug size={12}/></button>}<button data-menu-group="danger" title={zh.sidebar.text014} aria-label={zh.sidebar.text014} disabled={requests.kind === 'disconnect' || requests.kind === 'remove'} onClick={() => void remove()}><Trash2 size={12}/></button></>}><button className="tree-label" aria-expanded={displayedOpen} aria-busy={busy} disabled={requests.kind === 'disconnect' || requests.kind === 'remove'} onClick={toggle}><span className="tree-chevron">{displayedOpen ? <ChevronDown size={13}/> : <ChevronRight size={13}/>}</span><Database size={16} style={{ color: profile.color }}/><span className="truncate">{profile.name}</span>{starred && <Star size={11} className="sidebar-connection-star" aria-hidden="true"/>}{connected && <span className="connection-dot"/>}</button></SidebarTreeRow>{busy && <div className="tree-loading"><Spinner text={zh.sidebar.text015}/></div>}{(opened || displayedOpen) && !busy && databases.map(database => {
    const match = searchMatch?.databases.get(database);
    if (!opened && searchMatch && !match) return null;
    const refreshVersion = objectRefreshVersions[JSON.stringify([profile.id, database])] ?? 0;
    return <DatabaseNode refreshVersion={refreshVersion} key={database} connectionId={profile.id} database={database}
      visible={displayedOpen && (!searchMatch || !!match)} searchToken={searchToken} searchMatch={match}
      objects={sidebarCatalogObjects(catalog, database, refreshVersion)} onObjects={items => updateCatalog(previous => ({
        ...previous, objects: new Map(previous.objects).set(database, { version: refreshVersion, items })
      }))} locate={locate?.database === database ? locate : undefined} onImportNewTable={onImportNewTable ? () => onImportNewTable(profile.id, database) : undefined} search={search} onDesignElement={onDesignElement} onColumnPatches={table => onColumnPatches(profile.id, database, table)} onIndexPatches={table => onIndexPatches(profile.id, database, table)} onForeignKeyPatches={table => onForeignKeyPatches(profile.id, database, table)} onTableCopyData={onTableCopyData ? table => onTableCopyData(profile.id, database, table) : undefined} onTableCopyStructure={onTableCopyStructure ? table => onTableCopyStructure(profile.id, database, table) : undefined} onSqliteObjects={onSqliteObjects ? (kind, action, name, sourceView) => onSqliteObjects(profile.id, database, kind, action, name, sourceView) : undefined} onSqliteTableRebuild={onSqliteTableRebuild} onTableMaintenance={onTableMaintenance ? (table, action) => onTableMaintenance(profile.id, database, table, action) : undefined} onTableRename={table => onTableRename(profile.id, database, table)} onTableAutoIncrement={table => onTableAutoIncrement(profile.id, database, table)} onTableChecks={onTableChecks ? table => onTableChecks(profile.id, database, table) : undefined} onTableComment={table => onTableComment(profile.id, database, table)} onTableDefaultEncoding={table => onTableDefaultEncoding(profile.id, database, table)} onDatabaseDefaultEncoding={onDatabaseDefaultEncoding ? () => onDatabaseDefaultEncoding(profile.id, database) : undefined} onDatabaseDrop={onDatabaseDrop ? () => onDatabaseDrop(profile.id, database) : undefined} onDesign={(table, createView) => onDesign(profile.id, database, table, createView)} onRoutineInvocation={onRoutineInvocation} onDdl={(object, management) => onDdl(profile.id, database, object, management)}/>;
  })}</div>;
}

/** 数据库节点按对象种类选择数据浏览或定义编辑入口。 */
function DatabaseNode({ connectionId, database, search, visible = true, searchToken, searchMatch, objects, onObjects, locate, onImportNewTable, onDesign, onDesignElement, onColumnPatches, onIndexPatches, onForeignKeyPatches, onTableCopyData, onTableCopyStructure, onSqliteObjects, onSqliteTableRebuild, onTableMaintenance, onTableRename, onTableAutoIncrement, onTableChecks, onTableComment, onTableDefaultEncoding, onDatabaseDefaultEncoding, onDatabaseDrop, onRoutineInvocation, onDdl, refreshVersion = 0 }: { refreshVersion?: number; connectionId: string; database: string; search: string; visible?: boolean; searchToken?: object; searchMatch?: SidebarDatabaseMatch; objects: DatabaseObject[]; onObjects(items: DatabaseObject[]): void; locate?: SidebarLocateRequest; onImportNewTable?: () => void; onDesign: (table?: string, createView?: PostgresCreateViewKind | 'sequence' | 'routine') => void; onDesignElement?: (target: TableElementsTarget, element: StructureElement) => void; onColumnPatches: (table: string) => void; onIndexPatches: (table: string) => void; onForeignKeyPatches: (table: string) => void; onTableCopyData?: (table: string) => void; onTableCopyStructure?: (table: string) => void; onSqliteObjects?: (kind: SqliteObjectsKind, action: SqliteObjectsAction, name?: string, sourceView?: string) => void; onSqliteTableRebuild?: (target: SqliteTableRebuildTarget) => void; onTableMaintenance?: (table: string, action: SqliteTableMaintenanceAction) => void; onTableRename: (table: string) => void; onTableAutoIncrement: (table: string) => void; onTableChecks?: (table: string) => void; onTableComment: (table: string) => void; onDatabaseDefaultEncoding?: () => void; onDatabaseDrop?: () => void; onTableDefaultEncoding: (table: string) => void; onRoutineInvocation?: (target: RoutineInvocationTarget) => void; onDdl: (object?: DatabaseObject, management?: 'extensions' | 'storage') => void }) {
  const dialect = useWorkspace(state => state.connections.find(profile => profile.id === connectionId)?.dialect);
  const sqlite = dialect === 'sqlite', postgres = dialect === 'postgresql';
  const connectionVersion = useWorkspace(state => state.connectionVersions[connectionId] ?? 0);
  const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false);
  const [foldedSearch, setFoldedSearch] = useState<object>();
  const requests = useNodeRequests(connectionId), openRef = useRef(false), displayedOpenRef = useRef(false);
  const searchExpanded = !!(visible && searchToken && searchMatch?.reveal);
  const displayedOpen = (open || searchExpanded) && !(searchExpanded && foldedSearch === searchToken);
  displayedOpenRef.current = displayedOpen && visible;
  const catalogRevision = useRef(0);
  const selection = useWorkspace(state => state.selection);
  /** 保留同步展开意图，刷新中的折叠立即撤销旧回包。 */
  function expand(value: boolean) { if (!value) displayedOpenRef.current = false; openRef.current = value; setOpen(value); }
  /** 选择数据库仍走原工作区入口，不重放已取消的目录请求。 */
  function toggle() {
    useWorkspace.getState().select({ connectionId, database });
    if (searchExpanded && !busy) {
      if (displayedOpen) displayedOpenRef.current = false;
      setFoldedSearch(foldedSearch === searchToken ? undefined : searchToken);
      return;
    }
    if (openRef.current || requests.kind === 'load') {
      if (requests.collapse()) { expand(false); setBusy(false); }
    } else void load();
  }
  const observedRefresh = useRef(refreshVersion);
  // 重命名事件仅重读实际目录，保留当前展开意图；请求归属仍交由统一节点请求门管理。
  useEffect(() => { if (observedRefresh.current !== refreshVersion) { observedRefresh.current = refreshVersion; void load(false); } }, [refreshVersion]);
  const locatedObject = sidebarLocatedObject(objects, locate?.relation);
  useEffect(() => {
    if (!locate?.relation || !locate.current() || busy || open && locatedObject) return;
    void load(true, locate);
  }, [locate, open, busy, locatedObject]);
  /** 只读取当前数据库对象列表，避免加载未展开数据库的全部字段。 */
  async function load(reveal = true, location?: SidebarLocateRequest) {
    // 结构变化必须重读目录，不能被改名前的在途加载吞掉；普通按钮连点仍只发一次。
    const request = requests.begin('load', !reveal); if (!request) return;
    ++catalogRevision.current;
    setBusy(true);
    const current = () => requests.current(request) && (!location || location.current());
    try {
      for (let ending = sidebarConnectionEnd(connectionId); ending; ending = sidebarConnectionEnd(connectionId)) {
        await ending; if (!current()) return;
      }
      if (!current()) return;
      const next = await invoke('metadata.objects', { connectionId, database });
      if (!current()) return;
      onObjects(next); if (reveal) expand(true);
      if (location?.relation && !sidebarLocatedObject(next, location.relation)) location.fail(sidebarLocateZh.missingRelation(location.relation));
    } catch (error) {
      if (location) location.fail(errorMessage(error)); else useWorkspace.getState().notify(errorMessage(error), true);
    }
    finally { if (requests.finish(request)) setBusy(false); }
  }
  const visibleObjects = searchMatch?.items ?? objects;
  return <div hidden={!visible}><SidebarTreeRow target={{ kind: 'database', connectionId, database }} label={database} className="database-row" locate={locate?.relation === undefined ? locate : undefined} version={[search, refreshVersion, objects, busy, displayedOpen, requests.kind]} actions={<><FavoriteButton menu target={{ connectionId, database, kind: 'database' }}/>{postgres && <button data-menu-group="create" title={postgresCreateViewZh.title} aria-label={postgresCreateViewZh.title} onClick={() => onDesign(undefined, 'ordinary')}><Plus size={12}/></button>}{postgres && <button data-menu-group="create" title={postgresCreateViewZh.materializedTitle} aria-label={postgresCreateViewZh.materializedTitle} onClick={() => onDesign(undefined, 'materialized')}><Plus size={12}/></button>}{postgres && <button data-menu-group="create" aria-label={postgresSequenceZh.create} onClick={() => onDesign(undefined, 'sequence')}><Plus size={12}/></button>}{postgres && <button data-menu-group="create" aria-label={postgresRoutineZh.create} onClick={() => onDesign(undefined, 'routine')}><Plus size={12}/></button>}{sqlite && database === 'main' && onSqliteObjects && (['view', 'trigger'] as const).map(kind => <button key={kind} data-menu-group="create" title={kind === 'view' ? sqliteObjectsZh.createView : sqliteObjectsZh.createTrigger} aria-label={(kind === 'view' ? sqliteObjectsZh.createView : sqliteObjectsZh.createTrigger) + ' ' + database} onClick={() => onSqliteObjects(kind, 'create')}><Plus size={12}/></button>)}{(!sqlite || database === 'main') && onImportNewTable && <button data-menu-group="transfer" title={importNewTableZh.title} aria-label={`${importNewTableZh.title} ${database}`} onClick={onImportNewTable}><Plus size={12}/></button>}{!postgres && !sqlite && onDatabaseDrop && <button data-menu-group="danger" title={databaseDropZh.title} aria-label={`${databaseDropZh.title} ${database}`} disabled={isProtectedDatabaseDropName(database)} onClick={onDatabaseDrop}><Trash2 size={12}/></button>}{!postgres && !sqlite && onDatabaseDefaultEncoding && <button data-menu-group="structure" title={databaseDefaultEncodingZh.title} aria-label={`${databaseDefaultEncodingZh.entry} ${database}`} onClick={onDatabaseDefaultEncoding}><Pencil size={12}/></button>}<button data-menu-group="create" title={zh.common.newQuery} aria-label={zh.sidebar.text016} onClick={() => useWorkspace.getState().openTab({ title: zh.common.unnamedQuery, kind: 'query', connectionId, database, sql: '' })}><FileCode2 size={12}/></button><button data-menu-group="create" title={zh.sidebar.text017} aria-label={zh.sidebar.text017} disabled={sqlite && database !== 'main'} onClick={() => { if (!sqlite || database === 'main') onDesign(); }}><Plus size={12}/></button><button data-menu-group="refresh" title={zh.sidebar.text018} aria-label={zh.sidebar.text018} disabled={busy} onClick={() => void load()}><RefreshCw size={12}/></button>{postgres && <button data-menu-group="structure" aria-label={postgresSchemaManageZh.title} onClick={() => onDdl()}><ListChecks size={12}/></button>}{postgres && <button data-menu-group="structure" aria-label={postgresExtensionManageZh.title} onClick={() => onDdl(undefined, 'extensions')}><ListChecks size={12}/></button>}{postgres && <button data-menu-group="structure" aria-label={postgresStorageZh.title} onClick={() => onDdl(undefined, 'storage')}><Database size={12}/></button>}{!postgres && !sqlite && <button data-menu-group="structure" title={zh.sidebar.text019} aria-label={zh.sidebar.text019} onClick={() => onDdl()}><Pencil size={12}/></button>}</>}><button className="tree-label" aria-expanded={displayedOpen} aria-busy={busy} onClick={toggle}><span className="tree-chevron">{displayedOpen ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}</span><Database size={13}/><span className="truncate">{database}</span></button></SidebarTreeRow>{busy && <div className="tree-loading"><Spinner/></div>}{displayedOpen && !busy && <div className="object-list">{visibleObjects.map(object => {
    const key = `${object.kind}:${object.name}`;
    const renderRow = (leading?: ReactNode) => <SidebarTreeRow key={key} leading={leading} target={{ connectionId, database, kind: object.kind, name: object.name }} label={object.name} className="object-row" locate={object === locatedObject ? locate : undefined} allowIdentifierDrag version={[search, refreshVersion, objects, busy, displayedOpen]} actions={sidebarObjectActions({ connectionId, database, object, onOpen: () => { if (openSqliteObject(connectionId, database, object)) return; if (object.kind === 'table' || object.kind === 'view') useWorkspace.getState().openTab({ kind: 'table', title: object.name, connectionId, database, table: object.name }); else onDdl(object); }, onDesign, onDdl, onColumnPatches, onIndexPatches, onForeignKeyPatches, onTableCopyData, onTableCopyStructure, onSqliteObjects, onSqliteTableRebuild, onTableMaintenance, onTableRename, onTableAutoIncrement, onTableChecks, onTableComment, onTableDefaultEncoding, onRoutineInvocation, onRefresh: () => void load(false) })}><button className="tree-label" title={`${kindLabels[object.kind]} · ${object.name}`} onDoubleClick={() => { if (sqlite) openSqliteObject(connectionId, database, object); }} onClick={() => { useWorkspace.getState().select({ connectionId, database }); if (sqlite) return; if (object.kind === 'table' || object.kind === 'view') useWorkspace.getState().openTab({ kind: 'table', title: object.name, connectionId, database, table: object.name }); else onDdl(object); }}>{object.kind === 'table' ? <Table2 size={13}/> : <FileCode2 size={13}/>}<span className="truncate">{object.name}</span><span className="object-kind">{object.kind === 'table' ? '' : kindLabels[object.kind]}</span></button></SidebarTreeRow>;
    const presetKind = postgres ? 'postgres' : sqlite && database === 'main' ? 'sqlite' : dialect === 'mysql' || dialect === 'mariadb' ? 'mysql' : undefined;
    if (!presetKind || (object.kind !== 'table' && object.kind !== 'view')) return renderRow();
    const withPreset = (structure?: ReactNode) => <TablePresetBranch key={key} kind={presetKind} connectionId={connectionId}
      database={database} table={object.name} connectionVersion={connectionVersion}>
      {preset => renderRow(<>{structure}{preset}</>)}
    </TablePresetBranch>;
    // 同轮刷新可能合并忙态渲染；表名相同也不能复用上一代子目录。
    const revision = catalogRevision.current;
    return object.kind === 'table' ? <TableElementsBranch key={JSON.stringify([key, revision])} connectionId={connectionId}
      database={database} table={object.name}
      available={() => displayedOpenRef.current && catalogRevision.current === revision && !requests.kind &&
        (useWorkspace.getState().connectionVersions[connectionId] ?? 0) === connectionVersion}
      onDesign={onDesignElement ? element => onDesignElement({ connectionId, database, table: object.name }, element) : undefined}>
      {withPreset}
    </TableElementsBranch> : withPreset();
  })}{!visibleObjects.length && <span className="tree-hint">{search ? zh.sidebar.text023 : zh.sidebar.text024}</span>}</div>}</div>;
}
