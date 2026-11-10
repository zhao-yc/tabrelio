import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUpRight, Clock3, FileCode2, Search, Star, Trash2 } from 'lucide-react';
import type { SavedQueryArchiveFilters, SavedQueryExportSqlArchiveInput, SavedQueryPage, SavedQueryPageEntry, SavedQueryPageSort } from '../../shared/savedQueryPages';
import type { SavedQueryGroupScope, SavedQueryGroupTarget, SavedQueryOrganizationSnapshot } from '../../shared/savedQueryOrganization';
import { savedQueryDatabaseScopeSchema, savedQueryOpenBatchLimits, type SavedQueryDatabaseScope, type SavedQueryOpenResult, type SavedQueryScope } from '../../shared/savedQuerySearch';
import type { ConnectionProfile, QueryFileEncoding } from '../../shared/contracts';
import { zh, formatText } from '../locales/zh-CN';
import { queryContextZh } from '../locales/queryContext.zh-CN';
import { savedQueryPagesZh as t } from '../locales/savedQueryPages.zh-CN';
import { savedQuerySearchZh as searchText } from '../locales/savedQuerySearch.zh-CN';
import { historyPagesZh as sqlText } from '../locales/historyPages.zh-CN';
import { queryFilesZh as fileText } from '../locales/queryFiles.zh-CN';
import { savedQueryOrganizationZh as text } from '../locales/savedQueryOrganization.zh-CN';
import { errorMessage, invoke, uid } from '../lib';
import { captureOpenedSavedQuery, findOpenedSavedQuery, openQueryTabBatch, rememberOpenedSavedQueries, useWorkspace, watchQueryBatchConnections, type WorkspaceTab } from '../store';
import { readSavedQueryOrganization, savedQueryOrganizationTree, type SelectedSavedQuery, type SavedQueryOrganizationPreview } from '../savedQueryOrganizationUi';
import { SavedQueryOrganizationEditor, type SavedQueryOrganizationEdit } from './SavedQueryOrganizationEditor';
import { SavedQueryRebindEditor } from './SavedQueryRebindEditor';
import { SavedQueryDuplicateBatchEditor } from './SavedQueryDuplicateBatchEditor';
import { savedQueryRebindSchema, type SavedQueryRebindInput } from '../../shared/savedQueryRebind';
import type { ConnectionOrganizationSnapshot } from '../../shared/connectionOrganization';
import { SavedQueryRenameEditor, type SavedQueryRenameOrigin } from './SavedQueryRenameEditor';
import { savedQueryRenameSchema, savedQueryRenameZh as renameText } from '../../shared/savedQueryRename';
import { savedQueryDuplicateBatchResultSchema, savedQueryDuplicateBatchSchema, savedQueryDuplicateSchema, savedQueryDuplicateZh as duplicateText, type SavedQueryDuplicateBatchInput } from '../../shared/savedQueryDuplicate';
import { SavedQueryDeleteSelectedPreview } from './SavedQueryDeleteSelectedPreview';
import { savedQueryDeleteSelectedSchema, readSavedQueryDeleteSelectedResult, savedQueryDeleteSelectedZh as deleteText } from '../../shared/savedQueryDeleteSelected';
import { Empty, ErrorBox, Modal, Spinner, UsageHelp } from './ui';
import { SqlTextPreview } from './SqlTextPreview';
import { queryFileTextDifference, type QueryFileTextDifference } from '../../shared/queryFileReload';
import { queryFileReloadZh } from '../../shared/queryFileReload.zh-CN';
import '../query-file-reload.css';
import { SavedQueryExternalEditor } from './SavedQueryExternalEditor';
import { savedQueryExternalZh as externalText, type SavedQueryExternalSession } from '../../shared/savedQueryExternalEdit';
import { QueryBatchOpenPreview } from './QueryBatchOpenPreview';
import type { HistoryInsertionTarget } from '../historyInsertion';
import { savedQueryInsertionZh as insertionText } from '../locales/savedQueryInsertion.zh-CN';
import '../savedQueryPages.css';

interface Services { request: typeof invoke; id(): string; }
const services: Services = { request: invoke, id: uid };
interface Criteria { search: string; policy: 'stop' | 'continue'; group: SavedQueryGroupScope; scope: SavedQueryScope; database: SavedQueryDatabaseScope; sort: SavedQueryPageSort; favoritesOnly: boolean; }
type DatabaseFilterKind = keyof typeof searchText.databaseKinds;
interface RenameEdit { source: SavedQueryRenameOrigin; page: SavedQueryPage; criteria: string; epoch: number; duplicateRevision?: string; }
interface DeleteEdit { items: readonly SelectedSavedQuery[]; selection: ReadonlyMap<string, SelectedSavedQuery>; epoch: number; }
interface OpenSelection extends SelectedSavedQuery { connectionId?: string; }
interface OpenBatch { selection: ReadonlyMap<string, OpenSelection>; targets: ReadonlyMap<string, string>; epoch: number; }
const selectQuery = ({ query, digest }: SavedQueryPageEntry): OpenSelection => ({ id: query.id, digest, name: query.name, connectionId: query.connectionId });
const queryTab = (result: SavedQueryOpenResult): Omit<WorkspaceTab, 'id'> => ({
  kind: 'query', title: result.query.name, connectionId: result.connectionId, database: result.database,
  databaseContext: result.databaseContext, sql: result.query.sql, sourceBinding: result.sourceBinding,
});
const criteriaKey = (value: Criteria) => JSON.stringify([value.search, value.policy, value.group, value.scope, value.database, value.sort, value.favoritesOnly]);
/** 浏览和筛选归档使用同一份条件投影。 */
function pageFilters(value: Criteria): SavedQueryArchiveFilters {
  return {
    search: value.search,
    ...(value.group.kind === 'all' ? {} : { group: value.group }),
    ...(value.scope.kind === 'all' ? {} : { scope: value.scope }),
    ...(value.database.kind === 'all' ? {} : { database: value.database }),
    ...(value.sort === 'recent' ? {} : { sort: value.sort }),
    ...(value.favoritesOnly ? { favoritesOnly: true } : {}),
  };
}
interface OrganizationEdit { value: SavedQueryOrganizationEdit; snapshot: SavedQueryOrganizationSnapshot; selected: readonly SelectedSavedQuery[]; epoch: number; }
interface RebindEdit { connectionSnapshot: ConnectionOrganizationSnapshot; selection: ReadonlyMap<string, OpenSelection>; selected: readonly SelectedSavedQuery[]; epoch: number; }
interface DuplicateBatchEdit { duplicateSnapshot: SavedQueryOrganizationSnapshot; selection: ReadonlyMap<string, OpenSelection>; selected: readonly SelectedSavedQuery[]; epoch: number; }
type Edit = OrganizationEdit | RebindEdit | DuplicateBatchEdit;

/** 原Promise锁覆盖分组和列表；跨页选择只存编号、摘要和名称，不累计SQL正文。 */
export function SavedQueriesDialog({ onClose, onHistory, insertion, initialConnectionId, services: io = services }: { onClose(): void; onHistory(): void; insertion?: HistoryInsertionTarget | null; initialConnectionId?: string; services?: Services }) {
  const connections = useWorkspace(state => state.connections);
  const tabs = useWorkspace(state => state.settings.tabs), recentTabs = useWorkspace(state => state.recentTabRefs);
  const [scope, setScope] = useState<SavedQueryScope>(() => initialConnectionId ? { kind: 'connection', connectionId: initialConnectionId } : { kind: 'all' });
  const [database, setDatabase] = useState<SavedQueryDatabaseScope>({ kind: 'all' });
  const [databaseKind, setDatabaseKind] = useState<DatabaseFilterKind>('all'), [databaseName, setDatabaseName] = useState('');
  const databaseDraft: SavedQueryDatabaseScope = databaseKind === 'known' || databaseKind === 'none'
    ? { kind: 'known', database: databaseKind === 'none' ? null : databaseName } : { kind: databaseKind };
  const databasePending = JSON.stringify(databaseDraft) !== JSON.stringify(database);
  const [importEncoding, setImportEncoding] = useState<QueryFileEncoding>('utf8');
  const [importGroup, setImportGroup] = useState<SavedQueryGroupTarget>();
  const [importConnection, setImportConnection] = useState<ConnectionProfile>(), [importDatabase, setImportDatabase] = useState('');
  const [exportEncoding, setExportEncoding] = useState<QueryFileEncoding>('utf8');
  const [sort, setSort] = useState<SavedQueryPageSort>('recent');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [search, setSearch] = useState(''), [policy, setPolicy] = useState<'stop' | 'continue'>('continue'), [group, setGroup] = useState<SavedQueryGroupScope>({ kind: 'all' }), [includeDescendants, setIncludeDescendants] = useState(true);
  const [reply, setReply] = useState<SavedQueryPage>(), [batch, setBatch] = useState(0), [applied, setApplied] = useState(''), [busy, setBusy] = useState(true), [closing, setClosing] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [organization, setOrganization] = useState<SavedQueryOrganizationSnapshot>(), organizationRef = useRef(organization);
  const [selected, setSelected] = useState<ReadonlyMap<string, OpenSelection>>(new Map()), selectedRef = useRef(selected), [editing, setEditing] = useState<Edit>(), editRef = useRef(editing), [needsRefresh, setNeedsRefresh] = useState(false), [targets, setTargets] = useState(new Map<string, string>());
  const [renaming, setRenaming] = useState<RenameEdit>(), renameRef = useRef<RenameEdit | undefined>(undefined);
  const [deleting, setDeleting] = useState<DeleteEdit>(), deleteRef = useRef<DeleteEdit | undefined>(undefined);
  const [opening, setOpening] = useState<OpenBatch>(), openRef = useRef<OpenBatch | undefined>(undefined);
  const [external, setExternal] = useState<SavedQueryExternalSession>(), externalRef = useRef<SavedQueryExternalSession | true | undefined>(undefined);
  const openBatchTrigger = useRef<HTMLButtonElement>(null);
  const cursor = useRef<string | undefined>(undefined), active = useRef<string | undefined>(undefined), pending = useRef<Promise<void> | undefined>(undefined), locked = useRef(false), closed = useRef(false), alive = useRef(true), epoch = useRef(0);
  const criteria: Criteria = { search, policy, group, scope, database, sort, favoritesOnly }, criteriaRef = useRef(criteria); criteriaRef.current = criteria; const renderEpoch = epoch.current;
  const [sqlPreview, setSqlPreview] = useState<{ item: SavedQueryPageEntry; sql: string; epoch: number }>();
  const currentSqlPreview = sqlPreview?.epoch === renderEpoch ? sqlPreview : undefined;
  const [comparison, setComparison] = useState<{ item: SavedQueryPageEntry; tab: WorkspaceTab; difference: QueryFileTextDifference; epoch: number }>();
  const currentComparison = comparison?.epoch === renderEpoch && tabs.includes(comparison.tab) ? comparison : undefined;
  // 分页、筛选或其它操作换代时释放大正文，渲染已立即隐藏旧预览。
  useEffect(() => { if (sqlPreview && !currentSqlPreview) setSqlPreview(value => value === sqlPreview ? undefined : value); }, [sqlPreview, currentSqlPreview]);
  useEffect(() => { if (comparison && !currentComparison) setComparison(value => value === comparison ? undefined : value); }, [comparison, currentComparison]);
  const insertionRef = useRef(insertion), previousInsertion = useRef(insertion), insertionClosing = useRef(false), cancelledInsertion = useRef(false);
  insertionRef.current = insertion;
  const [insertAvailable, setInsertAvailable] = useState(() => insertion?.current() ?? false);
  const pageView = useRef({ reply, applied, needsRefresh }); pageView.current = { reply, applied, needsRefresh };
  /** 每个资料页只持父面板借出的子租约；换目标后旧目标不可因相同prop恢复而复活。 */
  useLayoutEffect(() => {
    if (previousInsertion.current !== insertion) { previousInsertion.current?.dispose(); previousInsertion.current = insertion; }
    const sync = () => setInsertAvailable(insertion?.current() ?? false);
    const off = insertion?.subscribe(sync); sync(); return () => { off?.(); };
  }, [insertion]);
  const owns = (ticket: number) => alive.current && !closed.current && epoch.current === ticket;
  const editable = () => owns(renderEpoch) && !locked.current && !editRef.current && !renameRef.current && !deleteRef.current && !openRef.current && !externalRef.current;
  /** 原句柄仅在成功释放后遗忘；迟到新页也精确回收。 */
  async function release() { const value = cursor.current; if (value) { await io.request('queries.pageRelease', { cursor: value }); if (cursor.current === value) cursor.current = undefined; } }
  /** 取消失败仍等原Promise终态并释放，不能让观察超时或按钮点击提前放行。 */
  async function cleanup() { let failure: unknown; if (active.current) try { await io.request('query.cancel', { taskId: active.current }); } catch (reason) { failure = reason; } await pending.current?.catch(() => {}); await release(); if (failure) throw failure; }
  async function close(after = onClose, keepInsertion = false) {
    if (externalRef.current) return;
    // Escape在读取或释放期间仍撤销插入，不能因原close正在等待而忽略关闭意图。
    if (!keepInsertion) { insertionRef.current?.dispose(); if (insertionClosing.current) cancelledInsertion.current = true; }
    if (closed.current) return;
    closed.current = true; insertionClosing.current = keepInsertion; cancelledInsertion.current = false;
    if (!keepInsertion) epoch.current++;
    editRef.current = undefined; setEditing(undefined); renameRef.current = undefined; setRenaming(undefined); deleteRef.current = undefined; setDeleting(undefined);
    openRef.current = undefined; setOpening(undefined); setClosing(true);
    try { await cleanup(); if (!alive.current) return; if (keepInsertion && cancelledInsertion.current) onClose(); else after(); }
    catch (reason) { if (alive.current) { closed.current = false; setClosing(false); setError(errorMessage(reason)); } }
    finally { insertionClosing.current = false; }
  }
  /** 同步占锁并跟踪整项操作；每个旧渲染回调仅能使用原代次。 */
  function run(action: (ticket: number) => Promise<void>, expected = renderEpoch): Promise<void> | undefined {
    if (!owns(expected) || locked.current) return;
    locked.current = true; const ticket = ++epoch.current; setBusy(true); setError(''); setNotice('');
    // action延后到原Promise微任务，保证同步抛错也只在operation完成赋值后执行收尾。
    const operation: Promise<void> = Promise.resolve().then(() => action(ticket)).catch(reason => { if (owns(ticket)) setError(errorMessage(reason)); }).finally(() => { if (pending.current === operation) pending.current = undefined; locked.current = false; if (alive.current && !closed.current) setBusy(false); });
    pending.current = operation; return operation;
  }
  /** 外来树与计数先完整校验，不存在的范围明确退回未分组。 */
  function publish(raw: unknown, requested: SavedQueryGroupScope): SavedQueryGroupScope { const value = readSavedQueryOrganization(raw); organizationRef.current = value; setOrganization(value); const next = requested.kind === 'group' && !value.groups.some(item => item.id === requested.id) ? { kind: 'unfiled' } as const : requested; if (next !== requested) setNotice(text.scopeRemoved); setGroup(next); criteriaRef.current = { ...criteriaRef.current, group: next }; return next; }
  /** 续页只有cursor和taskId；旧页不累积，迟到句柄在原操作内释放。 */
  async function readPage(ticket: number, value: Criteria, next = false) {
    const previous = cursor.current;
    if (!next) { await release(); if (!owns(ticket)) return; setReply(undefined); setBatch(0); setTargets(new Map()); } else if (!previous) return;
    cursor.current = undefined; const taskId = io.id(); active.current = taskId;
    try {
      const page = await (next ? io.request('queries.pageContinue', { taskId, cursor: previous! }) : io.request('queries.page', {
        taskId, onError: value.policy, ...pageFilters(value),
      }));
      cursor.current = page.cursor; if (!owns(ticket)) { await release(); return; }
      setReply(page); setBatch(count => next ? count + 1 : 1); setApplied(criteriaKey(value)); setTargets(new Map());
    } catch (reason) { if (owns(ticket) && next) { setReply(previous => previous ? { ...previous, cursor: undefined } : previous); setNeedsRefresh(true); } throw reason; }
    finally { if (active.current === taskId) active.current = undefined; }
  }
  /** 显式第一页重新读取组织版本，沿用全文、分组、来源和错误策略。 */
  function load(next = false, requested = criteriaRef.current, expected = renderEpoch) { if (editRef.current || renameRef.current || deleteRef.current || openRef.current || externalRef.current) return; return run(async ticket => { let value = requested; if (!next) { const raw = await io.request('queries.organizationGet', {}); if (!owns(ticket)) return; value = { ...requested, group: publish(raw, requested.group) }; setNeedsRefresh(false); } await readPage(ticket, value, next); }, expected); }
  useEffect(() => {
    alive.current = true; closed.current = false; const ticket = epoch.current;
    // StrictMode的旧setup尚未投递时只留本轮启动权；cleanup不消费父传入的子权限。
    void Promise.resolve(pending.current).then(() => { if (owns(ticket)) void load(false, criteriaRef.current, ticket); });
    return () => {
      alive.current = false; closed.current = true; epoch.current++; editRef.current = undefined; renameRef.current = undefined; deleteRef.current = undefined;
      externalRef.current = undefined;
      void cleanup().catch(reason => useWorkspace.getState().notify(t.cleanupFailed + errorMessage(reason), true));
    };
  }, []);
  /** 草稿改变只撤销旧事件，不自动查询或释放旧页。 */
  function draft(action: () => void) { if (!editable()) return; epoch.current++; action(); }
  /** 只在确认后应用默认库条件，空库名不能被解释为已知无默认库。 */
  function applySearch() {
    if (!editable()) return;
    const parsed = savedQueryDatabaseScopeSchema.safeParse(databaseDraft);
    if (!parsed.success) { setError(t.databaseFilterInvalid); return; }
    setDatabase(parsed.data);
    criteriaRef.current = { ...criteriaRef.current, database: parsed.data };
    void load(false, criteriaRef.current);
  }
  function selectScope(value: SavedQueryGroupScope) { if (!editable()) return; setGroup(value); criteriaRef.current = { ...criteriaRef.current, group: value }; void load(false, criteriaRef.current); }
  function selectFavorites(value: boolean) {
    if (!editable()) return;
    setFavoritesOnly(value);
    criteriaRef.current = { ...criteriaRef.current, favoritesOnly: value };
    void load(false, criteriaRef.current);
  }
  /** 排序换用首页和新游标，保留已勾选的原记录摘要。 */
  function selectSort(value: SavedQueryPageSort) {
    if (!editable()) return;
    setSort(value);
    criteriaRef.current = { ...criteriaRef.current, sort: value };
    void load(false, criteriaRef.current);
  }
  /** 切换来源时清空跨页选择及旧结果，避免操作上一个来源的记录。 */
  function selectConnectionScope(value: string) {
    if (!editable()) return;
    const next: SavedQueryScope = value === 'all' || value === 'unbound' ? { kind: value } : { kind: 'connection', connectionId: value.slice('connection:'.length) };
    setScope(next);
    setReply(undefined);
    selectedRef.current = new Map();
    setSelected(selectedRef.current);
    criteriaRef.current = { ...criteriaRef.current, scope: next };
    void load(false, criteriaRef.current);
  }
  function choose(item: SavedQueryPageEntry, checked: boolean) { if (!editable()) return; const next = new Map(selectedRef.current); if (checked) { if (!next.has(item.query.id) && next.size >= 100) { setError(text.selectionLimit); return; } next.set(item.query.id, selectQuery(item)); } else next.delete(item.query.id); epoch.current++; selectedRef.current = next; setSelected(next); }
  /** 当前页选择先计算完整并集再发布，超100条整批拒绝；取消本页保留隐藏选择。 */
  function choosePage(checked: boolean) { if (!editable() || !reply?.items.length) return; const next = new Map(selectedRef.current); if (checked) { const ids = new Set([...next.keys(), ...reply.items.map(item => item.query.id)]); if (ids.size > 100) { setError(text.selectionLimit); return; } for (const item of reply.items) next.set(item.query.id, selectQuery(item)); } else for (const item of reply.items) next.delete(item.query.id); epoch.current++; selectedRef.current = next; setSelected(next); }
  function clearSelection() { if (!editable()) return; epoch.current++; selectedRef.current = new Map(); setSelected(selectedRef.current); }
  /** 原树对象、原选择和代次一起捕获，外来快照或旧回调不能换目标。 */
  function edit(value: SavedQueryOrganizationEdit) { if (!editable() || !organizationRef.current || needsRefresh) return; const next = { value, snapshot: organizationRef.current, selected: Object.freeze([...selectedRef.current.values()].map(item => Object.freeze({ ...item }))), epoch: ++epoch.current }; editRef.current = next; setEditing(next); setError(''); }
  function cancelEdit() { if (locked.current || !editRef.current) return; epoch.current++; editRef.current = undefined; setEditing(undefined); }
  /** 仅提交已展示的冻结CAS补丁；失败要求手动刷新，不重放、不逐条降级写入。 */
  function apply(preview: SavedQueryOrganizationPreview, origin: OrganizationEdit) {
    if (closed.current || locked.current || editRef.current !== origin || epoch.current !== origin.epoch || organizationRef.current !== origin.snapshot || preview.input.expectedRevision !== origin.snapshot.revision) return;
    void run(async ticket => { try { const raw = await io.request('queries.organizationApply', preview.input); if (!owns(ticket)) return; const nextGroup = publish(raw, criteriaRef.current.group); editRef.current = undefined; setEditing(undefined); selectedRef.current = new Map(); setSelected(selectedRef.current); setNeedsRefresh(false); await readPage(ticket, { ...criteriaRef.current, group: nextGroup }); if (owns(ticket)) setNotice(text.saved); } catch (reason) { if (owns(ticket)) { editRef.current = undefined; setEditing(undefined); setNeedsRefresh(true); setError(errorMessage(reason)); } } }, origin.epoch);
  }
  /** 先从 Main 获取连接修订，再把跨页选择与显示的连接一起冻结到确认面板。 */
  function beginRebind() {
    if (!editable() || needsRefresh || !selectedRef.current.size) return;
    const selection = selectedRef.current;
    void run(async ticket => {
      const connectionSnapshot = await io.request('connections.organizationGet', {});
      if (!owns(ticket) || selectedRef.current !== selection) return;
      const origin = { connectionSnapshot, selection, selected: Object.freeze([...selection.values()]), epoch: ticket };
      editRef.current = origin; setEditing(origin);
    });
  }
  function beginDuplicateBatch() {
    const duplicateSnapshot = organizationRef.current, selection = selectedRef.current;
    if (!editable() || needsRefresh || !duplicateSnapshot || !selection.size) return;
    const origin = { duplicateSnapshot, selection, selected: Object.freeze([...selection.values()]), epoch: ++epoch.current };
    editRef.current = origin; setEditing(origin); setError(''); setNotice('');
  }
  /** 成功后只勾选回执中的新副本，原勾选或过期摘要不能带入后续改绑。 */
  function applyDuplicateBatch(origin: DuplicateBatchEdit, items: SavedQueryDuplicateBatchInput['items'], destination?: SavedQueryDuplicateBatchInput['destination']) {
    if (locked.current || editRef.current !== origin || !owns(origin.epoch) || organizationRef.current !== origin.duplicateSnapshot || selectedRef.current !== origin.selection) return;
    const input = savedQueryDuplicateBatchSchema.safeParse({ items, expectedRevision: origin.duplicateSnapshot.revision, ...(destination ? { destination } : {}) });
    if (!input.success || items.length !== origin.selected.length || items.some((item, index) => item.id !== origin.selected[index].id || item.digest !== origin.selected[index].digest)) {
      setError(duplicateText.invalidName); return;
    }
    void run(async ticket => {
      let committed = false;
      try {
        const raw = await io.request('queries.duplicateSelectedChecked', input.data);
        const { copies } = savedQueryDuplicateBatchResultSchema.parse(raw);
        if (copies.length !== input.data.items.length || copies.some((copy, index) => origin.selection.has(copy.id) || copy.name !== input.data.items[index].name)) throw Error(t.duplicateBatchReceipt);
        committed = true;
        if (!owns(ticket)) return;
        editRef.current = undefined; setEditing(undefined); setNeedsRefresh(true);
        selectedRef.current = new Map(copies.map(copy => [copy.id, copy])); setSelected(selectedRef.current);
        const groups = await io.request('queries.organizationGet', {});
        if (!owns(ticket)) return;
        const group = publish(groups, criteriaRef.current.group);
        await readPage(ticket, { ...criteriaRef.current, group });
        if (owns(ticket)) { setNeedsRefresh(false); setNotice(t.duplicateBatchSaved(copies.length)); }
      } catch (reason) {
        if (!owns(ticket)) return;
        editRef.current = undefined; setEditing(undefined); setNeedsRefresh(true); setError(errorMessage(reason));
        if (committed) setNotice(duplicateText.refreshRequired);
      }
    }, origin.epoch);
  }
  /** 不重放修改。写入回执与后续列表刷新分别处理，防止刷新失败被当作未保存。 */
  function applyRebind(origin: RebindEdit, target: SavedQueryRebindInput['target']) {
    if (locked.current || editRef.current !== origin || !owns(origin.epoch) || selectedRef.current !== origin.selection) return;
    const input = savedQueryRebindSchema.safeParse({ target, expectedConnectionRevision: origin.connectionSnapshot.revision,
      queries: origin.selected.map(({ id, digest }) => ({ id, digest })) });
    if (!input.success) { setError(t.rebindInvalid); return; }
    void run(async ticket => {
      let committed = false;
      try {
        const result = await io.request('queries.rebindSelectedChecked', input.data);
        if (result.updated !== origin.selected.length) throw Error(t.rebindInvalid);
        committed = true;
        if (!owns(ticket)) return;
        editRef.current = undefined; setEditing(undefined); setNeedsRefresh(true);
        selectedRef.current = new Map(); setSelected(selectedRef.current);
        const raw = await io.request('queries.organizationGet', {});
        if (!owns(ticket)) return;
        const group = publish(raw, criteriaRef.current.group);
        await readPage(ticket, { ...criteriaRef.current, group });
        if (owns(ticket)) { setNeedsRefresh(false); setNotice(t.rebindSaved(result.updated)); }
      } catch (reason) {
        if (!owns(ticket)) return;
        editRef.current = undefined; setEditing(undefined); setNeedsRefresh(true); setError(errorMessage(reason));
        if (committed) setNotice(t.rebindRefresh);
      }
    }, origin.epoch);
  }
  /** 只捕获所见记录的名称和摘要，不读取完整SQL或借用当前打开查询。 */
  function beginRename(item: SavedQueryPageEntry, duplicate = false): void {
    if (!editable() || needsRefresh || !reply?.items.includes(item) || criteriaKey(criteriaRef.current) !== applied) return;
    if (duplicate && !organizationRef.current) return;
    const origin: RenameEdit = { source: Object.freeze({ id: item.query.id, digest: item.digest, name: item.query.name }), page: reply, criteria: applied, epoch: ++epoch.current, ...(duplicate ? { duplicateRevision: organizationRef.current!.revision } : {}) };
    renameRef.current = origin; setRenaming(origin); setError(''); setNotice('');
  }
  /** 取消只撤销当前名称草稿，旧面板回调不能关闭后来打开的编辑器。 */
  function cancelRename(origin: RenameEdit): void {
    if (locked.current || renameRef.current !== origin || !owns(origin.epoch)) return;
    epoch.current++; renameRef.current = undefined; setRenaming(undefined);
  }
  /** 名称变更独立提交；提交成功而刷新失败时如实保留已保存事实，不能重放重命名。 */
  function applyRename(name: string, origin: RenameEdit): void {
    if (locked.current || renameRef.current !== origin || !owns(origin.epoch) || pageView.current.reply !== origin.page || pageView.current.needsRefresh || criteriaKey(criteriaRef.current) !== origin.criteria) return;
    const input = savedQueryRenameSchema.safeParse({ id: origin.source.id, digest: origin.source.digest, name });
    const duplicate = origin.duplicateRevision !== undefined, messages = duplicate ? duplicateText : renameText;
    if (!input.success || (!duplicate && name === origin.source.name)) { setError(input.success ? renameText.noChange : messages.invalidName); return; }
    void run(async ticket => {
      let committed = false;
      try {
        if (duplicate) await io.request('queries.duplicateChecked', savedQueryDuplicateSchema.parse({ ...input.data, expectedRevision: origin.duplicateRevision }));
        else await io.request('queries.renameChecked', input.data);
        committed = true;
        if (!owns(ticket)) return;
        renameRef.current = undefined; setRenaming(undefined); setNeedsRefresh(true);
        if (!duplicate) { const next = new Map(selectedRef.current); next.delete(origin.source.id); selectedRef.current = next; setSelected(next); }
        const raw = await io.request('queries.organizationGet', {}); if (!owns(ticket)) return;
        const group = publish(raw, criteriaRef.current.group);
        await readPage(ticket, { ...criteriaRef.current, group });
        if (owns(ticket)) { setNeedsRefresh(false); setNotice(messages.renamed); }
      } catch (reason) {
        if (!owns(ticket)) return;
        renameRef.current = undefined; setRenaming(undefined); setNeedsRefresh(true); setError(errorMessage(reason));
        if (committed) setNotice(messages.refreshRequired);
      }
    }, origin.epoch);
  }
  /** 跨页选择完整复制为只含名称和引用的预览，不因当前页或搜索隐藏而缩减删除范围。 */
  function beginDeleteSelected(): void {
    if (!editable() || needsRefresh || !selectedRef.current.size) return;
    const items = Object.freeze([...selectedRef.current.values()].map(({ id, digest, name }) => Object.freeze({ id, digest, name })));
    const parsed = savedQueryDeleteSelectedSchema.safeParse({ queries: items.map(({ id, digest }) => ({ id, digest })) });
    if (!parsed.success) { setError(deleteText.invalid); return; }
    const origin: DeleteEdit = { items, selection: selectedRef.current, epoch: ++epoch.current };
    deleteRef.current = origin; setDeleting(origin); setError(''); setNotice('');
  }
  /** 预览仅持有跨页摘要与目标连接，确认前不读取正文。 */
  function beginOpenBatch(): void {
    const selection = selectedRef.current;
    if (!editable() || needsRefresh || !selection.size || selection.size > savedQueryOpenBatchLimits.queries) return;
    const batchTargets = new Map<string, string>();
    for (const item of selection.values()) {
      const connectionId = targets.get(item.id) ?? item.connectionId;
      if (connectionId && connections.some(profile => profile.id === connectionId)) batchTargets.set(item.id, connectionId);
    }
    const next = { selection, targets: batchTargets, epoch: ++epoch.current };
    openRef.current = next; setOpening(next); setError(''); setNotice('');
  }
  function changeOpenBatchTarget(origin: OpenBatch, id: string, connectionId: string): void {
    if (openRef.current !== origin || locked.current || !owns(origin.epoch)) return;
    const next = { ...origin, targets: new Map(origin.targets).set(id, connectionId) };
    openRef.current = next; setOpening(next);
  }
  function cancelOpenBatch(): void {
    if (!openRef.current || locked.current) return;
    epoch.current++; openRef.current = undefined; setOpening(undefined);
    openBatchTrigger.current?.focus();
  }
  /** 回包和游标收尾都结束后再原子发布；等待期间任一目标连接变动永久撤销。 */
  function applyOpenBatch(origin: OpenBatch): void {
    if (locked.current || openRef.current !== origin || !owns(origin.epoch) || selectedRef.current !== origin.selection) return;
    const items = [...origin.selection.values()].map(({ id, digest }) => ({ id, digest, connectionId: origin.targets.get(id) ?? '' }));
    let opened = false;
    const work = run(async ticket => {
      const targets = watchQueryBatchConnections(items.map(item => item.connectionId));
      try {
        const result = await io.request('queries.readBatch', { items });
        if (!owns(ticket)) return;
        if (result.queries.length !== items.length || result.queries.some((query, index) =>
          query.query.id !== items[index].id || query.connectionId !== items[index].connectionId || query.sourceBinding?.digest !== items[index].digest))
          throw Error(t.openBatchStale);
        if (cursor.current) {
          await release();
          if (owns(ticket)) setReply(page => page ? { ...page, cursor: undefined } : page);
        }
        if (!owns(ticket)) return;
        if (!targets.current() || selectedRef.current !== origin.selection || openRef.current !== origin) throw Error(t.openBatchStale);
        openQueryTabBatch(result.queries.map(queryTab));
        rememberOpenedSavedQueries(items.map(item => item.id), io.request);
        opened = true;
      } finally { targets.dispose(); }
    }, origin.epoch);
    if (work) void work.then(() => {
      if (opened && !closed.current) void close();
      else if (openRef.current === origin && !closed.current) {
        const next = { ...origin, epoch: epoch.current };
        openRef.current = next; setOpening(next);
      }
    });
  }
  /** 取消只撤销所见批量预览，不能消费新选择或后来打开的面板。 */
  function cancelDeleteSelected(origin: DeleteEdit): void {
    if (locked.current || deleteRef.current !== origin || !owns(origin.epoch)) return;
    epoch.current++; deleteRef.current = undefined; setDeleting(undefined);
  }
  /** 确切计数回执确认后再清所选；成功与后续刷新失败分开，不重试任何删除。 */
  function applyDeleteSelected(origin: DeleteEdit): void {
    if (locked.current || deleteRef.current !== origin || !owns(origin.epoch) || selectedRef.current !== origin.selection) return;
    const input = savedQueryDeleteSelectedSchema.parse({ queries: origin.items.map(({ id, digest }) => ({ id, digest })) });
    void run(async ticket => {
      let committed = false;
      try {
        const raw = await io.request('queries.deleteSelectedChecked', input);
        const result = readSavedQueryDeleteSelectedResult(raw, origin.items.length); committed = true;
        if (!owns(ticket)) return;
        deleteRef.current = undefined; setDeleting(undefined); setNeedsRefresh(true);
        const next = new Map(selectedRef.current); for (const item of origin.items) next.delete(item.id); selectedRef.current = next; setSelected(next);
        const groups = await io.request('queries.organizationGet', {}); if (!owns(ticket)) return;
        const group = publish(groups, criteriaRef.current.group);
        await readPage(ticket, { ...criteriaRef.current, group });
        if (owns(ticket)) { setNeedsRefresh(false); setNotice(deleteText.deleted(result.deleted)); }
      } catch (reason) {
        if (!owns(ticket)) return;
        deleteRef.current = undefined; setDeleting(undefined); setNeedsRefresh(true); setError(errorMessage(reason));
        if (committed) setNotice(deleteText.refreshRequired);
      }
    }, origin.epoch);
  }
  /** 丢失来源不回退其它连接；打开仅重读摘要对应原文，不执行SQL。 */
  function target(item: SavedQueryPageEntry) { return targets.has(item.query.id) ? targets.get(item.query.id)! : connections.some(value => value.id === item.query.connectionId) ? item.query.connectionId! : ''; }
  function activateOpenedTab(item: SavedQueryPageEntry, opened: WorkspaceTab): void {
    if (!editable() || !currentCard(item)) return;
    try {
      const activate = captureOpenedSavedQuery(item.query.id, opened);
      void close(() => { activate(); onClose(); });
    } catch (reason) { setError(errorMessage(reason)); }
  }
  function open(item: SavedQueryPageEntry) {
    if (!editable()) return; const connectionId = target(item); if (!connectionId) { setError(t.choose); return; }
    let opened: SavedQueryOpenResult | undefined; const work = run(async ticket => { const result = await io.request('queries.read', { id: item.query.id, digest: item.digest, connectionId }); if (owns(ticket)) opened = result; });
    if (work) void work.then(() => { if (opened && !closed.current) { const result = opened; void close(() => {
      useWorkspace.getState().openTab({ id: io.id(), ...queryTab(result) });
      rememberOpenedSavedQueries([result.query.id], io.request);
      onClose();
    }); } });
  }
  /** 只有已应用范围内的原卡片可以读取或导出，旧页事件不能复用。 */
  function currentCard(item: SavedQueryPageEntry): boolean {
    return pageView.current.reply === reply && pageView.current.applied === applied
      && !databasePending && !pageView.current.needsRefresh && criteriaKey(criteriaRef.current) === applied && reply?.items.includes(item) === true;
  }
  /** 编辑副本以原卡片编号和摘要启动，列表在确认保留、丢弃或写回前保持原选择。 */
  function beginExternal(item?: SavedQueryPageEntry): void {
    if (!editable() || item && !currentCard(item)) return;
    externalRef.current = true;
    const work = run(async ticket => {
      const session = item
        ? await io.request('queries.externalStart', { id: item.query.id, digest: item.digest })
        : await io.request('queries.externalResume', {});
      if (!owns(ticket)) return;
      if (!session) { setNotice(externalText.noRecovery); return; }
      externalRef.current = session;
      setExternal(session);
      if (!item && !session.committed) setNotice(externalText.recovered);
    });
    if (work) void work.finally(() => { if (externalRef.current === true) externalRef.current = undefined; });
    else externalRef.current = undefined;
  }
  function finishExternal(edit: SavedQueryExternalSession, message: string) {
    if (externalRef.current !== edit) return;
    externalRef.current = undefined;
    setExternal(undefined);
    const next = new Map(selectedRef.current);
    next.delete(edit.queryId);
    selectedRef.current = next;
    setSelected(next);
    if (message) useWorkspace.getState().notify(message);
    setNeedsRefresh(true);
    void load();
  }
  /** 按原卡片编号和摘要读取本地正文，连接是否可用不参与预览。 */
  function showSql(item: SavedQueryPageEntry): void {
    if (!editable() || !currentCard(item)) return;
    void run(async ticket => {
      const result = await io.request('queries.readText', { id: item.query.id, digest: item.digest });
      if (!owns(ticket)) return;
      if (!currentCard(item)) throw Error(t.sqlStale);
      setSqlPreview({ item, sql: result.query.sql, epoch: ticket });
    });
  }
  /** 只比较打开时看到的草稿和经摘要校验的保存正文。任一来源变化都需要重新对比。 */
  function compareDraft(item: SavedQueryPageEntry, tab: WorkspaceTab): void {
    if (!editable() || !currentCard(item)) return;
    try {
      const workspace = useWorkspace.getState();
      const ref = workspace.tabOrderSnapshot().find(ref => ref.id === tab.id);
      if (!ref || workspace.resolveTabOrder(ref) !== tab) throw Error(t.compareStale);
      void run(async ticket => {
        const { query } = await io.request('queries.readText', { id: item.query.id, digest: item.digest });
        if (!owns(ticket)) return;
        if (!currentCard(item) || useWorkspace.getState().resolveTabOrder(ref) !== tab) throw Error(t.compareStale);
        setComparison({ item, tab, difference: queryFileTextDifference(tab.sql ?? '', query.sql), epoch: ticket });
      });
    } catch (reason) { setError(errorMessage(reason)); }
  }
  /** 复制不传回正文，主进程核对当前卡片后写入剪贴板。 */
  function copySql(item: SavedQueryPageEntry): void {
    if (!editable() || !currentCard(item)) return;
    void run(async ticket => {
      await io.request('queries.copySql', { id: item.query.id, digest: item.digest });
      if (owns(ticket) && currentCard(item)) setNotice(sqlText.sqlCopied);
    });
  }
  /** 文件保存交给主进程，卡片只提供原编号和摘要。 */
  function exportSql(item: SavedQueryPageEntry): void {
    if (!editable() || !currentCard(item)) return;
    void run(async ticket => {
      const result = await io.request('queries.exportSql', { id: item.query.id, digest: item.digest, encoding: exportEncoding });
      if (owns(ticket) && result.status === 'saved') setNotice(formatText(t.sqlExported, result.name));
    });
  }
  /** 勾选归档保留隐藏选择；整批归档仅使用当前已应用的筛选。 */
  function exportSqlArchive(mode: 'selected' | 'filtered'): void {
    const view = pageView.current;
    if (!editable() || view.needsRefresh) return;
    let input: SavedQueryExportSqlArchiveInput;
    if (mode === 'filtered') {
      if (databasePending || !view.reply || view.applied !== criteriaKey(criteriaRef.current)) return;
      input = { filters: pageFilters(criteriaRef.current), encoding: exportEncoding };
    } else {
      if (!selectedRef.current.size) return;
      const items = [...selectedRef.current.values()].map(({ id, digest }) => ({ id, digest }));
      input = { items, encoding: exportEncoding };
    }
    void run(async ticket => {
      const result = await io.request('queries.exportSqlArchive', input);
      if (owns(ticket) && result.status === 'saved') setNotice(formatText(t.sqlArchiveSaved, result.count, result.name));
    });
  }
  /** 写入完成后刷新原筛选。若刷新失败，保留导入成功提示并由用户重新读取列表。 */
  function importSql(archive = false): void {
    if (!editable() || importGroupStale || importConnection && !useWorkspace.getState().connections.includes(importConnection)) return;
    const path = importGroup ? tree.find(item => item.id === importGroup.id)?.path : undefined;
    const target = importConnection && { connectionId: importConnection.id, database: importConnection.dialect === 'sqlite' ? 'main' : importDatabase || null };
    const canRefresh = !reply || criteriaKey(criteriaRef.current) === applied;
    void run(async ticket => {
      const result = await io.request('queries.importSql', {
        encoding: importEncoding, ...(importGroup ? { group: importGroup } : {}), ...(target ? { target } : {}), ...(archive ? { archive: true } : {}),
      });
      if (!owns(ticket) || result.status !== 'imported') return;
      setNotice(path !== undefined ? formatText(t.sqlGroupImported, result.names.length, path) : result.names.length === 1
        ? formatText(t.sqlImported, result.names[0]) : formatText(t.sqlBatchImported, result.names.length));
      setNeedsRefresh(true);
      if (!canRefresh) return;
      const raw = await io.request('queries.organizationGet', {});
      if (!owns(ticket)) return;
      const nextGroup = publish(raw, criteriaRef.current.group);
      await readPage(ticket, { ...criteriaRef.current, group: nextGroup });
      if (owns(ticket)) setNeedsRefresh(false);
    });
  }
  /** 全文按摘要重读；先退出run原Promise再关闭释放，避免cleanup等待自己的pending。 */
  function insert(item: SavedQueryPageEntry) {
    if (!editable()) return;
    const captured = insertion, original = pageView.current, source = organizationRef.current;
    const sourceCurrent = () => alive.current && insertionRef.current === captured && !!captured?.current()
      && pageView.current.reply === original.reply && pageView.current.applied === original.applied
      && !pageView.current.needsRefresh && organizationRef.current === source
      && criteriaKey(criteriaRef.current) === original.applied && original.reply?.items.includes(item) === true;
    if (!sourceCurrent()) { setError(captured ? insertionText.changed : insertionText.unavailable); return; }
    let sql: string | undefined, ticket = -1;
    const work = run(async owner => {
      ticket = owner;
      const result = await io.request('queries.readText', { id: item.query.id, digest: item.digest });
      if (owns(owner) && sourceCurrent()) sql = result.query.sql;
      else if (owns(owner)) throw Error(insertionText.changed);
    });
    if (work) void work.then(() => {
      if (sql === undefined || closed.current || !owns(ticket)) return;
      const complete = sql;
      void close(() => {
        if (epoch.current !== ticket || !sourceCurrent()) throw Error(insertionText.changed);
        captured!.insert(complete); onClose();
      }, true);
    });
  }
  /** 收藏不会改变正文摘要。提交后刷新有界列表和组织版本，并保留跨页勾选。 */
  function setFavorite(item: SavedQueryPageEntry) {
    const snapshot = organizationRef.current;
    if (!editable() || !snapshot || !currentCard(item)) return;
    const favorite = !item.favorite;
    void run(async ticket => {
      let committed = false;
      try {
        await io.request('queries.favoriteSet', { id: item.query.id, digest: item.digest, expectedRevision: snapshot.revision, favorite });
        committed = true;
        if (!owns(ticket)) return;
        const raw = await io.request('queries.organizationGet', {});
        if (!owns(ticket)) return;
        const group = publish(raw, criteriaRef.current.group);
        await readPage(ticket, { ...criteriaRef.current, group });
        if (owns(ticket)) setNotice(favorite ? t.favoriteAdded : t.favoriteRemoved);
      } catch (reason) {
        if (!owns(ticket)) return;
        setNeedsRefresh(true); setError(errorMessage(reason));
        if (committed) setNotice(t.favoriteRefresh);
      }
    });
  }
  function remove(item: SavedQueryPageEntry) { if (!editable()) return; void run(async ticket => { await io.request('queries.deleteChecked', { id: item.query.id, digest: item.digest }); if (!owns(ticket)) return; const next = new Map(selectedRef.current); next.delete(item.query.id); selectedRef.current = next; setSelected(next); const raw = await io.request('queries.organizationGet', {}); if (!owns(ticket)) return; const nextGroup = publish(raw, criteriaRef.current.group); await readPage(ticket, { ...criteriaRef.current, group: nextGroup }); }); }
  function databaseLabel(item: SavedQueryPageEntry) { const value = item.query, context = value.databaseContext; return context ? context.state === 'known' ? context.database || queryContextZh.none : queryContextZh.unknown : value.database ? value.database + ' (' + queryContextZh.legacy + ')' : queryContextZh.legacy; }
  const blocked = busy || closing || !!editing || !!renaming || !!deleting || !!opening || !!external, changed = databasePending || criteriaKey(criteria) !== applied, tree = organization ? savedQueryOrganizationTree(organization) : [], hidden = [...selected.keys()].filter(id => !reply?.items.some(item => item.query.id === id)).length, selectedGroup = group.kind === 'group' ? group.id : undefined;
  const importGroupStale = !!importGroup && (needsRefresh || importGroup.expectedRevision !== organization?.revision || !tree.some(item => item.id === importGroup.id));
  const importConnectionStale = !!importConnection && !connections.includes(importConnection);
  const pageSelected = reply?.items.filter(item => selected.has(item.query.id)).length ?? 0, pageAllSelected = !!reply?.items.length && pageSelected === reply.items.length, pageMixed = pageSelected > 0 && !pageAllSelected;
  return <Modal title={zh.activity.text003} wide onClose={() => { const origin = renameRef.current; if (origin) cancelRename(origin); else if (deleteRef.current) cancelDeleteSelected(deleteRef.current); else if (openRef.current && !locked.current) cancelOpenBatch(); else if (editRef.current && !('value' in editRef.current)) cancelEdit(); else void close(); }}
    onEscape={currentSqlPreview || currentComparison ? event => {
      event.stopPropagation();
      if (currentComparison) setComparison(value => value === currentComparison ? undefined : value);
      else setSqlPreview(value => value === currentSqlPreview ? undefined : value);
    } : undefined}>
    <div className="dialog-tabs"><button disabled={closing || !!external} onClick={() => void close(onHistory)}><Clock3 size={14}/>{zh.activity.text004}</button><button className="selected"><FileCode2 size={14}/>{zh.activity.text005}</button></div>
    <div className="modal-content saved-query-pages"><UsageHelp><p>{text.metadataOnly}</p><p>{insertionText.hint}</p><p>{t.hint}</p><p>{t.openHint}</p></UsageHelp><p aria-live="polite">{insertion ? insertionText.target(insertion.title) : insertionText.unavailable}{insertion && !insertAvailable && <span> · {insertionText.changed}</span>}</p><div className="saved-query-organization-layout">
      <details className="saved-query-organization-tree" open><summary>{text.title}</summary><nav aria-label={text.tree}>
        <button disabled={blocked} aria-label={text.all} aria-current={group.kind === 'all' ? 'true' : undefined} onClick={() => selectScope({ kind: 'all' })}>{text.all} ({organization?.totalCount ?? 0})</button>
        <button disabled={blocked} aria-label={text.unfiled} aria-current={group.kind === 'unfiled' ? 'true' : undefined} onClick={() => selectScope({ kind: 'unfiled' })}>{text.unfiled} ({organization?.unfiledCount ?? 0})</button>
        {tree.map(item => <button disabled={blocked} style={{ paddingLeft: 12 + (item.depth - 1) * 14 }} key={item.id} aria-label={text.selectGroup(item.path)} title={item.path + ' · ' + text.direct(item.count, item.totalCount)} aria-current={group.kind === 'group' && group.id === item.id ? 'true' : undefined} onClick={() => selectScope({ kind: 'group', id: item.id, includeDescendants })}>{item.name} ({item.totalCount})</button>)}
      </nav><label><input type="checkbox" aria-label={text.includeDescendants} checked={includeDescendants} disabled={blocked || group.kind !== 'group'} onChange={event => { const value = event.target.checked; setIncludeDescendants(value); if (group.kind === 'group') selectScope({ ...group, includeDescendants: value }); }}/>{text.includeDescendants}</label>
        <div className="saved-query-group-actions"><button disabled={blocked || !organization || needsRefresh} onClick={() => edit({ kind: 'create', id: selectedGroup })}>{text.create}</button><button disabled={blocked || !selectedGroup || needsRefresh} onClick={() => edit({ kind: 'rename', id: selectedGroup })}>{text.rename}</button><button disabled={blocked || !selectedGroup || needsRefresh} onClick={() => edit({ kind: 'moveGroup', id: selectedGroup })}>{text.moveGroup}</button><button disabled={blocked || !selectedGroup || needsRefresh} onClick={() => edit({ kind: 'dissolve', id: selectedGroup })}>{text.dissolve}</button></div>
      </details>
      <div className="saved-query-organization-list"><div className="search-box"><Search size={15}/><input aria-label={t.search} value={search} maxLength={512} disabled={blocked} onChange={event => draft(() => setSearch(event.target.value))} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); applySearch(); } }}/><button disabled={blocked} onClick={applySearch}>{t.searchButton}</button></div>
        <details className="saved-query-import"><summary>{t.sqlImport}</summary><p className="muted small">{t.sqlImportHint}</p><div className="inline-field">
          <label>{fileText.encoding} <select disabled={blocked} value={importEncoding} onChange={event => draft(() => setImportEncoding(event.target.value as QueryFileEncoding))}><option value="utf8">{fileText.utf8}</option><option value="utf16le">{fileText.utf16le}</option><option value="gb18030">{fileText.gb18030}</option></select></label>
          <label>{t.sqlImportGroup} <select aria-label={t.sqlImportGroup} disabled={blocked || needsRefresh || !organization}
            value={importGroupStale ? '-' : importGroup ? 'group:' + importGroup.id : ''} onChange={event => {
              const target = tree.find(item => 'group:' + item.id === event.target.value);
              draft(() => setImportGroup(target && organization ? { id: target.id, expectedRevision: organization.revision } : undefined));
            }}>
            {importGroupStale && <option value="-" disabled>{text.reselectSaveGroup}</option>}
            <option value="">{text.unfiled}</option>
            {tree.map(item => <option key={item.id} value={'group:' + item.id}>{item.path}</option>)}
          </select></label>
        </div><div className="inline-field">
          <label>{t.sqlImportConnection} <select aria-label={t.sqlImportConnection} value={importConnectionStale ? '-' : importConnection ? 'connection:' + importConnection.id : ''}
            disabled={blocked} onChange={event => {
              const profile = connections.find(item => 'connection:' + item.id === event.target.value);
              draft(() => { setImportConnection(profile); setImportDatabase(''); });
            }}>
            {importConnectionStale && <option value="-" disabled>{t.sqlImportReselectConnection}</option>}
            <option value="">{t.unbound}</option>
            {connections.map(item => <option key={item.id} value={'connection:' + item.id}>{item.name}</option>)}
          </select></label>
          {importConnection && !importConnectionStale && <label>{t.sqlImportDatabase} <input aria-label={t.sqlImportDatabase} value={importConnection.dialect === 'sqlite' ? 'main' : importDatabase}
            readOnly={importConnection.dialect === 'sqlite'} disabled={blocked} maxLength={256} placeholder={queryContextZh.none}
            onChange={event => draft(() => setImportDatabase(event.target.value))}/></label>}
        </div><button disabled={blocked || importGroupStale || importConnectionStale} onClick={() => importSql()}>{t.sqlImportChoose}</button>
          <button disabled={blocked || importGroupStale || importConnectionStale} title={t.sqlImportArchiveHint} onClick={() => importSql(true)}>{t.sqlImportArchive}</button></details>
        <label className="inline-field">{t.sqlExportEncoding}<select aria-label={t.sqlExportEncoding} value={exportEncoding} disabled={blocked}
          onChange={event => setExportEncoding(event.target.value as QueryFileEncoding)}>
          <option value="utf8">{fileText.utf8}</option><option value="utf16le">{fileText.utf16le}</option><option value="gb18030">{fileText.gb18030}</option>
        </select></label>
        <label className="inline-field">{t.scope}<select aria-label={t.scope} disabled={blocked} value={scope.kind === 'connection' ? 'connection:' + scope.connectionId : scope.kind} onChange={event => selectConnectionScope(event.target.value)}>
          <option value="all">{t.allSources}</option>
          <option value="unbound">{t.unbound}</option>
          {scope.kind === 'connection' && !connections.some(profile => profile.id === scope.connectionId) && <option value={'connection:' + scope.connectionId}>{t.sourceMissing}</option>}
          {connections.map(profile => <option key={profile.id} value={'connection:' + profile.id}>{profile.name}</option>)}
        </select></label>
        <div className="inline-field saved-query-database-filter">
          <label>{t.databaseFilter} <select aria-label={t.databaseFilter} value={databaseKind} disabled={blocked}
            onChange={event => draft(() => setDatabaseKind(event.target.value as DatabaseFilterKind))}>
            {Object.entries(searchText.databaseKinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          {databaseKind === 'known' && <label>{searchText.databaseName} <input aria-label={searchText.databaseName} value={databaseName} maxLength={256} disabled={blocked}
            onChange={event => draft(() => setDatabaseName(event.target.value))}
            onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); applySearch(); } }}/></label>}
          <button type="button" disabled={blocked || !databasePending} onClick={applySearch}>{t.databaseFilterApply}</button>
        </div>
        <label className="inline-field">{t.sort}<select aria-label={t.sort} disabled={blocked} value={sort} onChange={event => selectSort(event.target.value as SavedQueryPageSort)}>
          <option value="recent">{t.sortRecent}</option><option value="oldest">{t.sortOldest}</option>
          <option value="name-asc">{t.sortNameAsc}</option><option value="name-desc">{t.sortNameDesc}</option>
          <option value="opened">{t.sortOpened}</option>
        </select></label>
        <label className="saved-query-favorites-filter"><input type="checkbox" checked={favoritesOnly} disabled={blocked} onChange={event => selectFavorites(event.target.checked)}/>{t.favoritesOnly}</label>
        <label className="inline-field">{t.onError}<select aria-label={t.onError} disabled={blocked} value={policy} onChange={event => draft(() => setPolicy(event.target.value as typeof policy))}><option value="continue">{t.continue}</option><option value="stop">{t.stop}</option></select></label>{changed && reply && <p>{t.pending}</p>}
        <p>{text.selected(selected.size, hidden)}</p><label><input type="checkbox" aria-label={text.selectPage} aria-checked={pageMixed ? 'mixed' : pageAllSelected} checked={pageAllSelected} ref={node => { if (node) node.indeterminate = pageMixed; }} disabled={blocked || !reply?.items.length} onChange={event => choosePage(event.target.checked)}/>{text.selectPage}</label><div className="saved-query-group-actions"><button disabled={blocked || !selected.size || !organization || needsRefresh} onClick={() => edit({ kind: 'moveQueries' })}>{text.moveQueries}</button><button disabled={blocked || !selected.size || needsRefresh} onClick={beginRebind}>{t.rebindOpen}</button><button disabled={blocked || !selected.size || !organization || needsRefresh} onClick={beginDuplicateBatch}>{t.duplicateBatchOpen}</button><button disabled={blocked || !selected.size || needsRefresh || selected.size > savedQueryOpenBatchLimits.queries} ref={openBatchTrigger} onClick={beginOpenBatch}>{t.openBatch}</button><button disabled={blocked || !selected.size || needsRefresh} onClick={beginDeleteSelected}>{deleteText.open}</button><button disabled={blocked || !selected.size || needsRefresh} title={t.sqlArchiveHint} onClick={() => exportSqlArchive('selected')}>{t.sqlArchive}</button>
          <button disabled={blocked || changed || !reply || needsRefresh} title={t.sqlArchiveFilteredHint} onClick={() => exportSqlArchive('filtered')}>{t.sqlArchiveFiltered}</button><button disabled={blocked || !selected.size} onClick={clearSelection}>{text.clear}</button></div>
        {selected.size > savedQueryOpenBatchLimits.queries && <p className="muted small">{t.openBatchLimit(savedQueryOpenBatchLimits.queries)}</p>}
        {opening && <QueryBatchOpenPreview rows={[...opening.selection.values()]} targets={opening.targets} connections={connections}
          busy={busy || closing} onTarget={(id, connectionId) => changeOpenBatchTarget(opening, id, connectionId)}
          onCancel={cancelOpenBatch} onConfirm={() => applyOpenBatch(opening)}/>}
        <ErrorBox message={error}/>{needsRefresh && <p className="warning-text">{text.refreshRequired}</p>}{notice && <p role="status">{notice}</p>}{busy && <Spinner/>}
        {!external && <button disabled={blocked} onClick={() => beginExternal()}>{externalText.resume}</button>}
        {external && <SavedQueryExternalEditor key={external.sessionId} session={external} request={io.request} onDone={message => finishExternal(external, message)}/>}
        {reply && <p role="status">{formatText(t.summary, batch, reply.scanned, reply.matched, reply.failed)} {reply.stoppedOnError ? t.failedStop : reply.cursor ? t.more : t.done}</p>}
        <div className="history-list">{reply?.items.map(item => {
          const opened = findOpenedSavedQuery(item.query.id, target(item), tabs, recentTabs, connections);
          const preview = currentComparison?.item === item ? currentComparison : undefined;
          const difference = preview?.difference;
          return <article className="history-card" key={item.query.id}><div><label><input type="checkbox" aria-label={text.select(item.query.name)} disabled={blocked} checked={selected.has(item.query.id)} onChange={event => choose(item, event.target.checked)}/><strong>{item.query.name}</strong></label>
          <button type="button" className="icon-button" disabled={blocked || changed || needsRefresh || !organization} aria-label={t.favoriteName(item.query.name)}
            aria-pressed={!!item.favorite} title={item.favorite ? t.favoriteRemove : t.favoriteAdd} onClick={() => setFavorite(item)}>
            <Star size={15} fill={item.favorite ? 'currentColor' : 'none'} aria-hidden="true"/>
          </button><span className="grow"/><span className="muted small">{connections.find(profile => profile.id === item.query.connectionId)?.name || t.sourceMissing} / {databaseLabel(item)}</span></div>
          <pre>{item.sqlPreview}{item.previewTruncated ? '…' : ''}</pre>{item.previewTruncated && <p className="muted small">{formatText(t.preview, item.sqlUnits)}</p>}{currentSqlPreview?.item === item ? <SqlTextPreview key={item.digest} title={t.sqlTitle} sql={currentSqlPreview.sql} onClose={() => setSqlPreview(value => value === currentSqlPreview ? undefined : value)}/> : <button disabled={blocked || changed || needsRefresh} onClick={() => showSql(item)}>{t.sqlFull}</button>}<button disabled={blocked || changed || needsRefresh} onClick={() => copySql(item)}>{sqlText.sqlCopy}</button><button disabled={blocked || changed || needsRefresh} title={t.sqlExportHint} onClick={() => exportSql(item)}>{t.sqlExport}</button><button disabled={blocked || changed || needsRefresh} onClick={() => beginExternal(item)}>{externalText.open}</button><label className="inline-field">{t.choose}<select aria-label={formatText(t.connection, item.query.name)} value={target(item)} disabled={blocked} onChange={event => draft(() => setTargets(current => new Map(current).set(item.query.id, event.target.value)))}><option value="">{t.choose}</option>{connections.map(profile => <option value={profile.id} key={profile.id}>{profile.name}</option>)}</select></label>
          <footer><span className="muted small">{new Date(item.query.updatedAt).toLocaleString('zh-CN')}</span><span className="grow"/><button disabled={blocked || changed || needsRefresh || !organization} onClick={() => beginRename(item, true)}>{duplicateText.rename}</button><button disabled={blocked || changed || needsRefresh} onClick={() => beginRename(item)}>{renameText.rename}</button><button className="icon-button" disabled={blocked} title={zh.activity.text009} aria-label={zh.activity.text009} onClick={() => remove(item)}><Trash2 size={14}/></button><button disabled={blocked || changed || needsRefresh || !insertAvailable} onClick={() => insert(item)}>{insertionText.insert}</button>
            {opened && <>
              <button type="button" disabled={blocked || changed || needsRefresh} aria-expanded={!!difference}
                onClick={() => preview ? setComparison(value => value === preview ? undefined : value) : compareDraft(item, opened)}>{t.compareDraft}</button>
              <button type="button" disabled={blocked || changed || needsRefresh} title={t.openExistingHint(opened.title)}
                onClick={() => activateOpenedTab(item, opened)}>{t.openExisting}</button>
            </>}
            <button disabled={blocked || !target(item)} onClick={() => open(item)}>{zh.activity.text010}<ArrowUpRight size={14}/></button></footer>
          {preview && difference && <section aria-label={t.comparison}>
            <p>{t.comparisonHint(preview.tab.title)}</p>
            {difference.beforeUnits || difference.afterUnits ? <>
              <p>{queryFileReloadZh.counts(difference.prefixUnits, difference.suffixUnits, difference.beforeUnits, difference.afterUnits)}</p>
              <div className="query-file-reload-diff">
                <section aria-label={t.draftDifference}><h4>{t.draftDifference}</h4><pre>{difference.before}</pre></section>
                <section aria-label={t.savedDifference}><h4>{t.savedDifference}</h4><pre>{difference.after}</pre></section>
              </div>
              {(difference.beforeTruncated || difference.afterTruncated) && <p>{t.compareOmitted}</p>}
            </> : <p>{t.compareIdentical}</p>}
          </section>}
        </article>;
        })}{reply && !reply.items.length && <Empty title={t.empty} text={t.emptyHint}/>}</div>
        {reply?.failures.length ? <details><summary>{t.failures} ({reply.failures.length})</summary>{reply.failures.map((failure, index) => <p key={index}>{failure.id}：{failure.message}</p>)}</details> : null}
      </div>
    </div>{deleting && <SavedQueryDeleteSelectedPreview key={deleting.epoch} items={deleting.items} busy={busy || closing} onCancel={() => cancelDeleteSelected(deleting)} onConfirm={() => applyDeleteSelected(deleting)}/>}{renaming && <SavedQueryRenameEditor key={renaming.epoch} origin={renaming.source} mode={renaming.duplicateRevision ? 'duplicate' : 'rename'} busy={busy || closing} onCancel={() => cancelRename(renaming)} onConfirm={name => applyRename(name, renaming)}/ >}{editing && ('connectionSnapshot' in editing
      ? <SavedQueryRebindEditor key={editing.epoch} rows={editing.selected} connections={editing.connectionSnapshot.connections} busy={busy || closing} onCancel={cancelEdit} onConfirm={target => applyRebind(editing, target)}/>
      : 'duplicateSnapshot' in editing ? <SavedQueryDuplicateBatchEditor key={editing.epoch} rows={editing.selected} snapshot={editing.duplicateSnapshot} busy={busy || closing} onCancel={cancelEdit} onConfirm={(items, destination) => applyDuplicateBatch(editing, items, destination)}/>
      : <SavedQueryOrganizationEditor snapshot={editing.snapshot} edit={editing.value} selected={editing.selected} busy={busy || closing} onCancel={cancelEdit} onConfirm={preview => apply(preview, editing)}/>)}</div>
    <footer className="modal-footer"><button disabled={blocked} onClick={() => void load()}>{t.refresh}</button><button disabled={blocked || needsRefresh || !reply?.cursor || changed} onClick={() => void load(true)}>{t.next}</button>{busy && <button disabled={closing || !active.current} onClick={() => { if (active.current) void io.request('query.cancel', { taskId: active.current }).catch(reason => setError(errorMessage(reason))); }}>{t.cancel}</button>}<span className="grow"/><button disabled={closing || !!external} onClick={() => void close()}>{zh.common.close}</button></footer>
  </Modal>;
}
