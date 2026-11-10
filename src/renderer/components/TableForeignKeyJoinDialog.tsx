import { readQueryBuilderOffset } from '../../shared/queryBuilderOffset';
import { mysqlSelectedOutputKeys, type MysqlQueryProjection } from '../../shared/mysqlQueryProjection';
import { QueryBuilderProjectionOrder } from './QueryBuilderProjectionPanel';
import { QueryBuilderOutput, saveQueryBuilderSql, type QueryBuilderSaveTarget } from './QueryBuilderOutput';
import { queryBuilderPaginationZh as pagination } from '../locales/queryBuilderPagination.zh-CN';
import { queryBuilderJoinZh as joinText } from '../locales/queryBuilderJoin.zh-CN';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { TableInfo, FilterGroup, FilterMode, FilterRule, QueryOutcome } from '../../shared/contracts';
import { queryBuilderDesignSchema, manualJoinOnRules, type ManualJoinDesign, type ManualJoinDesignSummary, type QueryBuilderDesign } from '../../shared/manualJoinDesigns';
import { mysqlJoinSampleRows, type MysqlJoinedPreviewInput, type MysqlJoinPreviewInput, type MysqlJoinPreviewTarget } from '../../shared/mysqlJoinPreview';
import { mysqlViewFileQuery } from '../../shared/mysqlViewFile';
import { ExplainPlanView } from './ExplainPlanView';
import { ResultsGrid } from './ResultsGrid';
import { DdlDialog } from './SchemaDialog';
import { useWorkspace } from '../store';
import type { ViewQuerySeed } from '../queryViewDraft';
import '../viewQueryInspect.css';
import { FILTER_LIMITS, validateFilterGroup } from '../../shared/filtering';
import { emptyFilterDraft, filterRuleSummary, type FilterDraft } from '../tableFilters';
import { foreignKeyJoinFiltersFromDraft, foreignKeyJoinGroupAfterChange, type ForeignKeyJoinFilterDraft } from '../tableForeignKeyJoinFilters';
import { tableFilterGroupSummary, tableFilterGroupWithMode } from '../tableFilterGroups';
import { TableFilterGroupsDialog, type TableFilterGroupPresentation } from './TableFilterGroupsDialog';
import { TableForeignKeyJoinFilters } from './TableForeignKeyJoinFilters';
import { TableForeignKeyJoinSummary } from './TableForeignKeyJoinSummary';
import { buildForeignKeyJoinSummary, foreignKeyJoinSummaryFromDraft, foreignKeyJoinSummaryLimits, type ForeignKeyJoinGroupDraft, type ForeignKeyJoinAggregateDraft } from '../tableForeignKeyJoinSummary';
import { TableForeignKeyJoinHaving } from './TableForeignKeyJoinHaving';
import { foreignKeyJoinHavingFromDraft, type ForeignKeyJoinHavingDraft, type ForeignKeyJoinHavingTarget } from '../tableForeignKeyJoinHaving';
import { tableForeignKeyJoinHavingZh as havingText } from '../locales/tableForeignKeyJoinHaving.zh-CN';
import { tableForeignKeyJoinSummaryZh as summaryText } from '../locales/tableForeignKeyJoinSummary.zh-CN';
import { tableForeignKeyJoinFilterZh as filterText } from '../locales/tableForeignKeyJoinFilter.zh-CN';
import { buildForeignKeyJoin, foreignKeyJoinColumnAlias, foreignKeyJoinChoices, foreignKeyJoinMetadataKey, foreignKeyJoinLimits, foreignKeyJoinResultLimit, manualJoinAlias, type ForeignKeyJoinKind, type ForeignKeyJoinSort } from '../tableForeignKeyJoin';
import { foreignKeyJoinPreview, mysqlSingleTablePreview, revalidateForeignKeyJoin, type MysqlQueryBuilderPreview, type ForeignKeyJoinTarget, type FixedForeignKeyJoinStart, TableForeignKeyJoinIntent } from '../tableForeignKeyJoinIntent';
import { tableForeignKeyJoinZh as text } from '../locales/tableForeignKeyJoin.zh-CN';
import { errorMessage, invoke, uid } from '../lib';
import { ErrorBox, Modal, Spinner, UsageHelp } from './ui';
import { AdditionalJoinFields, ManualJoinPairFields, ManualJoinTableFields, changeManualJoinConditions, manualJoinCatalogNames, manualJoinTableNames, manualJoinSteps, newManualJoinPair, replaceManualJoinPairs, type AdditionalJoinDraft, type ManualJoinSelection } from './ManualJoinFields';
import type { ForeignKeyJoinSide } from '../tableForeignKeyJoinSources';

export interface TableForeignKeyJoinServices { read(input: ForeignKeyJoinTarget & { taskId: string }): Promise<TableInfo>; cancel(taskId: string): Promise<unknown>; }
/** 每次正式元数据读取均持有独立任务编号；取消不借普通查询或复用数据库会话。 */
export const tableForeignKeyJoinServices: TableForeignKeyJoinServices = { read: input => invoke('metadata.table', input), cancel: taskId => invoke('query.cancel', { taskId }) };
interface Selection { distinct: boolean; unmatchedOnly: boolean; fk: string; manual?: ManualJoinSelection; additional: AdditionalJoinDraft[]; kind: ForeignKeyJoinKind; child: string[]; parent: string[]; childSearch: string; parentSearch: string; childPage: number; parentPage: number; sort: { id: string; rule: ForeignKeyJoinSort }[]; limit: string; offset: string; projection?: MysqlQueryProjection; filters: ForeignKeyJoinFilterDraft[]; filterMode: FilterMode; filterGroup?: FilterGroup; summaryEnabled: boolean; summaryGroups: ForeignKeyJoinGroupDraft[]; aggregates: ForeignKeyJoinAggregateDraft[]; summarySort: { id: string; rule: ForeignKeyJoinSort }[]; having: ForeignKeyJoinHavingDraft[]; havingMode: FilterMode; havingGroup?: FilterGroup; }
interface GroupEditor { selection: Selection; kind: 'where' | 'having' | 'on'; applyOn?(group: FilterGroup): Selection; trigger?: HTMLButtonElement; mode: FilterMode; initial?: FilterGroup; rules: readonly FilterRule[]; presentation: TableFilterGroupPresentation; }
interface Operation { promise: Promise<void>; cancelled: boolean; read?: { taskId: string; cancel?: () => Promise<unknown>; cancelPromise?: Promise<unknown> }; cancellation?: Promise<unknown>; }
const pageSize = 50;
type DesignOperation = 'listDesigns' | 'saveDesign' | 'replaceDesign' | 'loadDesign' | 'deleteDesign';

/** 保存可编辑输入和稳定条目编号。目录缓存与搜索位置留在当前窗口。 */
function captureDesign(selection: Selection): QueryBuilderDesign {
  const { distinct, child, limit, offset, projection, filters, filterMode, filterGroup,
    sort, summarySort, summaryEnabled, summaryGroups, aggregates, having, havingMode, havingGroup } = selection;
  const settings = { version: 1, distinct, child, limit, offset: offset || undefined, projection, filters, filterMode, filterGroup,
    sort, summarySort, summaryEnabled, summaryGroups, aggregates, having, havingMode, havingGroup };
  if (!selection.manual) return queryBuilderDesignSchema.parse({ ...settings, single: true });
  const stripIds = ({ pairs }: ManualJoinSelection) => pairs.map(({ id: _id, ...pair }) => pair);
  const first = selection.manual;
  return queryBuilderDesignSchema.parse({
    ...settings, first: { database: first.database, table: first.table, pairs: stripIds(first), on: first.on },
    additional: selection.additional.map(step => ({
      database: step.database, table: step.table, source: step.source, kind: step.kind, pairs: stripIds(step), columns: step.columns, on: step.on,
    })),
    kind: selection.kind, unmatchedOnly: selection.unmatchedOnly, parent: selection.parent,
  });
}

/** 增删选列时保留剩余列的输出顺序，新列附在末尾。换源清空的列不会携带原别名。 */
function reconcileProjection(selection: Selection): Selection {
  if (!selection.projection) return selection;
  const available = new Set(mysqlSelectedOutputKeys(selection.child, selection.parent, selection.additional));
  const retained = selection.projection.filter(item => available.delete(item.column));
  const projection = [...retained, ...[...available].map(column => ({ column }))];
  return { ...selection, projection: projection.length ? projection : undefined };
}

function joinSources(child: TableInfo, parent: TableInfo | undefined, additional: readonly AdditionalJoinDraft[]) {
  const result = new Map<ForeignKeyJoinSide, TableInfo>([['child', child]]);
  if (parent) result.set('parent', parent);
  additional.forEach((step, index) => { if (step.info) result.set(`t${index + 3}`, step.info); });
  return result;
}

function sourceLabel(sources: ReadonlyMap<ForeignKeyJoinSide, TableInfo>, side: ForeignKeyJoinSide | 'aggregate'): string {
  if (side === 'child') return filterText.child;
  if (side === 'parent') return filterText.parent;
  if (side === 'aggregate') return havingText.aggregate;
  const info = sources.get(side);
  return info ? `${side} · ${info.database}.${info.name}` : side;
}

/** 输出ID绑定原分组或指标对象，恢复设计也按同一规则解析 HAVING。 */
function joinHavingTargets(selection: Selection, sources: ReadonlyMap<ForeignKeyJoinSide, TableInfo>): ForeignKeyJoinHavingTarget[] {
  if (!selection.summaryEnabled) return [];
  try {
    const plan = buildForeignKeyJoinSummary(sources, foreignKeyJoinSummaryFromDraft(selection.summaryGroups, selection.aggregates), foreignKeyJoinColumnAlias);
    return plan.outputs.map((output, index) => {
      const grouped = index < selection.summaryGroups.length;
      const entry = grouped ? selection.summaryGroups[index] : selection.aggregates[index - selection.summaryGroups.length];
      const column = plan.columns[index];
      const label = grouped ? `${havingText.grouped} · ${sourceLabel(sources, column.side)} · ${column.column} → ${output.alias}` : `${havingText.aggregate} · ${output.alias}`;
      return { ...output, id: (grouped ? 'g:' : 'a:') + entry.id, label };
    });
  } catch { return []; }
}

/** 打开与恢复共用实际 SQL 编译器；恢复失败时原设计及当前草稿均保持。 */
function compileSelection(intent: TableForeignKeyJoinIntent, selection: Selection, parent: TableInfo | undefined, sources: ReadonlyMap<ForeignKeyJoinSide, TableInfo>, havingTargets: readonly ForeignKeyJoinHavingTarget[]): MysqlQueryBuilderPreview {
  const limit = foreignKeyJoinResultLimit(selection.limit), offset = readQueryBuilderOffset(selection.offset);
  const filters = foreignKeyJoinFiltersFromDraft(selection.filters, sources);
  const summary = selection.summaryEnabled ? foreignKeyJoinSummaryFromDraft(selection.summaryGroups, selection.aggregates) : undefined;
  // 先报告使整个汇总预览失效的别名错误，避免把仍绑定原分组的条件误报为丢失。
  if (summary && selection.having.length && !havingTargets.length)
    buildForeignKeyJoinSummary(sources, summary, foreignKeyJoinColumnAlias);
  const having = selection.summaryEnabled ? foreignKeyJoinHavingFromDraft(selection.having, havingTargets) : [];
  const sorting = selection.summaryEnabled ? selection.summarySort : selection.sort;
  const options = {
    childColumns: selection.child,
    ...(selection.projection ? { projection: selection.projection } : {}),
    ...(!selection.summaryEnabled && selection.distinct ? { distinct: true } : {}),
    ...(summary ? { summary } : {}),
    ...(having.length ? { having: { filters: having, mode: selection.havingMode, ...(selection.havingGroup ? { group: selection.havingGroup } : {}) } } : {}),
    ...(filters.length ? { filters, filterMode: selection.filterMode, ...(selection.filterGroup ? { filterGroup: selection.filterGroup } : {}) } : {}),
    ...(sorting.length ? { sort: sorting.map(item => item.rule) } : {}),
    ...(limit !== intent.limit ? { limit } : {}),
    ...(offset ? { offset } : {}),
  };
  if (!parent) return mysqlSingleTablePreview(intent, options);
  const relation = selection.manual ? selection.manual.pairs.map(({ id: _id, ...condition }) => condition) : selection.fk;
  return foreignKeyJoinPreview(intent, parent, relation, selection.kind, {
    ...options, parentColumns: selection.parent,
    ...(selection.manual?.on ? { manualOn: selection.manual.on } : {}),
    ...(selection.unmatchedOnly ? { unmatchedOnly: true } : {}),
    ...(selection.additional.length ? { additionalJoins: manualJoinSteps(selection.additional) } : {}),
  });
}

/** 一次原读取和最新本地选择共用占门；不持有任何父页行数据或执行SQL的能力。 */
export function TableForeignKeyJoinDialog({ intent, fixed, manual = false, single = false, onOpen, onClose, onActivity, onViewApplied, onCleanupError, services = tableForeignKeyJoinServices }: {
  intent: TableForeignKeyJoinIntent; onOpen(preview: MysqlQueryBuilderPreview): boolean; onClose(): void;
  fixed?: FixedForeignKeyJoinStart; manual?: boolean; single?: boolean; onActivity?(delta: 1 | -1): void; onViewApplied?(): void; onCleanupError(message: string): void; services?: TableForeignKeyJoinServices;
}) {
  const origin = useRef({ intent, fixed, manual, single, services, onActivity }).current;
  if (origin.intent !== intent || origin.services !== services || origin.fixed !== fixed || origin.manual !== manual || origin.single !== single) origin.intent.invalidate();
  const title = origin.single ? text.singleTitle : origin.manual ? text.manualTitle : text.title;
  const choices = useMemo(() => origin.manual || origin.single ? [] : foreignKeyJoinChoices(origin.intent.source).filter(key => !origin.fixed || key.name === origin.fixed.foreignKey), [origin]);
  const [selection, setSelection] = useState<Selection>(() => ({ distinct: false, unmatchedOnly: false, additional: [], fk: choices[0]?.name ?? '', manual: origin.manual ? { database: intent.source.database, table: '', pairs: [] } : undefined, kind: origin.fixed?.kind ?? (origin.manual ? 'INNER' : 'LEFT'), child: origin.intent.source.columns.map(column => column.name), parent: origin.fixed?.parent.columns.map(column => column.name) ?? [], childSearch: '', parentSearch: '', childPage: 1, parentPage: 1, sort: [], limit: String(origin.intent.limit), offset: '', filters: [], filterMode: 'all', summaryEnabled: false, summaryGroups: [], aggregates: [], summarySort: [], having: [], havingMode: 'all' }));
  const selectionRef = useRef(selection), [parent, setParent] = useState<{ fk: string; info: TableInfo } | undefined>(() =>
    origin.fixed && { fk: origin.fixed.foreignKey, info: origin.fixed.parent });
  const initialSelection = useRef(selection).current;
  const [databases, setDatabases] = useState(() => [intent.source.database]);
  const [tables, setTables] = useState<string[]>();
  const [designs, setDesigns] = useState<ManualJoinDesignSummary[]>([]);
  const [designId, setDesignId] = useState(''), [designName, setDesignName] = useState('');
  const [designNotice, setDesignNotice] = useState('');
  const [inspection, setInspection] = useState<{ owner: MysqlQueryBuilderPreview; result: QueryOutcome }>();
  const [viewSeed, setViewSeed] = useState<ViewQuerySeed>();
  const activeView = useRef<ViewQuerySeed | undefined>(undefined);
  const [groupEditor, setGroupEditor] = useState<GroupEditor>(), groupRef = useRef<GroupEditor | undefined>(undefined), groupPanel = useRef<HTMLDivElement>(null), groupTrigger = useRef<HTMLButtonElement>(null), havingGroupTrigger = useRef<HTMLButtonElement>(null), hadGroup = useRef<GroupEditor | undefined>(undefined);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [closing, setClosing] = useState(false), [invalid, setInvalid] = useState(false), [message, setMessage] = useState('');
  const alive = useRef(true), closingRef = useRef(false), operation = useRef<Operation | null>(null), revision = useRef(0), consumed = useRef(false), committed = useRef<object | null>(null), ticket = {};
  const cleanupError = useRef(onCleanupError), closeCallback = useRef(onClose); cleanupError.current = onCleanupError; closeCallback.current = onClose;
  useLayoutEffect(() => { committed.current = ticket; return () => { if (committed.current === ticket) committed.current = null; }; });
  /** 打开时把键盘交给内联编辑区；应用/取消后返回原入口，不将Esc留在被禁用的旧按钮。 */
  useLayoutEffect(() => {
    if (groupEditor) groupPanel.current?.querySelector<HTMLElement>('select,button')?.focus();
    else if (hadGroup.current) {
      const previous = hadGroup.current;
      (previous.trigger ?? (previous.kind === 'having' ? havingGroupTrigger : groupTrigger).current)?.focus();
    }
    hadGroup.current = groupEditor;
  }, [groupEditor]);
  /** 当前渲染和原来源同时有效；本组件自己的占用由父页精确owner租约认可。 */
  function current(): boolean {
    if (!alive.current || closingRef.current || consumed.current || activeView.current || origin.intent !== intent || origin.services !== services || !origin.intent.current()) return false;
    const dialogs = document.querySelectorAll('[role="dialog"]');
    if (dialogs.length !== 1 || dialogs[0].getAttribute('aria-label') !== title || document.querySelector('[role="alertdialog"]')) { origin.intent.invalidate(); return false; }
    return true;
  }
  function rendered(): boolean { return committed.current === ticket && selectionRef.current === selection; }
  function editable(): boolean { return current() && rendered() && !operation.current && !groupRef.current; }
  const choice = choices.find(value => value.name === selection.fk);
  const target = selection.manual ? tables?.includes(selection.manual.table) && { database: selection.manual.database, table: selection.manual.table }
    : choice && { database: choice.referencedDatabase, table: choice.referencedTable };
  const currentParent = parent?.fk === selection.fk ? parent.info : undefined;
  const sourceReady = origin.single || !!currentParent;
  const sources = useMemo(() => joinSources(origin.intent.source, currentParent, selection.additional), [origin, currentParent, selection.additional]);
  const label = (side: ForeignKeyJoinSide | 'aggregate') => origin.single && side === 'child' ? origin.intent.source.name : sourceLabel(sources, side);
  const sorting = selection.summaryEnabled ? selection.summarySort : selection.sort;
  const sortSides: ForeignKeyJoinSort['side'][] = [...sources.keys(), ...(selection.summaryEnabled ? ['aggregate' as const] : [])];
  const havingTargets = useMemo(() => joinHavingTargets(selection, sources), [selection, sources]);
  const preview = useMemo(() => {
    if (!sourceReady) return { value: undefined, error: '' };
    try { return { value: compileSelection(origin.intent, selection, currentParent, sources, havingTargets), error: '' }; }
    catch (reason) { return { value: undefined, error: errorMessage(reason) }; }
  }, [origin.intent, sourceReady, currentParent, selection, sources, havingTargets]);
  const outputKeys = selection.projection?.map(item => item.column) ??
    mysqlSelectedOutputKeys(selection.child, selection.parent, selection.additional);
  const outputAliases = selection.projection?.flatMap(({ column, alias }) => alias === undefined ? [] : [{ column, alias }]) ?? [];
  const outcome = inspection?.owner === preview.value ? inspection?.result : undefined;
  const sampleResult = outcome?.explain ? undefined : outcome?.results[0];
  const aliases = useMemo(() => {
    if (!preview.value) return new Map<string, string>();
    return new Map(preview.value.columns.filter(column => column.column !== column.alias).map(column => [JSON.stringify([column.side, column.column]), column.alias]));
  }, [preview.value]);

  /** 只取消原当前任务一次；ACK和真实读取都属于原operation，不能ACK先释放占用。 */
  function cancel(active = operation.current): void {
    if (!active || operation.current !== active || active.cancelled) return;
    active.cancelled = true; revision.current++;
    if (active.read) {
      const read = active.read;
      read.cancelPromise = Promise.resolve().then(() => read.cancel ? read.cancel() : origin.services.cancel(read.taskId));
      active.cancellation = read.cancelPromise; void read.cancelPromise.catch(() => undefined);
    }
    if (alive.current) setMessage(text.cancelling);
  }
  /** 每步先登记原taskId再发送；切FK、关闭或来源变化后不启动后续结构读取。 */
  async function read(active: Operation, target: ForeignKeyJoinTarget, owns: () => boolean): Promise<TableInfo> {
    if (!owns()) throw Error(text.stale);
    const request = { taskId: uid() }; active.read = request;
    try { return await origin.services.read({ ...target, taskId: request.taskId }); }
    finally { if (active.read === request) active.read = undefined; }
  }
  /** 使用同一份预览的目录摘要，关闭或改配置后原结果不能进入新草稿。 */
  async function inspect(active: Operation, receipt: MysqlQueryBuilderPreview, mode: NonNullable<MysqlJoinPreviewInput['mode']>, owns: () => boolean) {
    async function target(info: TableInfo, key: string): Promise<MysqlJoinPreviewTarget> {
      const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
      return { database: info.database, table: info.name, digest: Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('') };
    }
    const source = await target(origin.intent.source, receipt.childKey);
    const request = { taskId: uid(), mode, connectionId: origin.intent.connectionId, source, limit: origin.intent.limit };
    let input: MysqlJoinPreviewInput;
    if ('parent' in receipt) {
      const { additionalJoins, ...options } = receipt.options;
      const parent = await target(receipt.parent, receipt.parentKey);
      const steps: MysqlJoinedPreviewInput['steps'] = [];
      for (const [index, step] of (additionalJoins ?? []).entries()) {
        steps.push({ ...step, pairs: [...step.pairs], columns: [...step.columns], target: await target(step.target, receipt.additionalKeys![index]) });
      }
      input = { ...request, parent, kind: receipt.kind, options, steps, relation: typeof receipt.relation === 'string' ? receipt.relation : [...receipt.relation] };
    } else input = { ...request, single: true, options: receipt.options };
    if (!owns()) return;
    const task = { taskId: request.taskId, cancel: () => invoke('mysql.join.previewCancel', { taskId: request.taskId }) };
    active.read = task;
    try {
      const result = await invoke('mysql.join.preview', input);
      if (owns()) setInspection({ owner: receipt, result });
    } finally { if (active.read === task) active.read = undefined; }
  }

  /** 恢复只读精确表身份，串行去重，全部核对完成后才发布一份完整草稿。 */
  async function restoreDesign(design: QueryBuilderDesign, selected: Selection, active: Operation, owns: () => boolean) {
    if (origin.single !== ('single' in design)) throw Error(text.designModeMismatch);
    const base = origin.intent.source;
    const cache = new Map<string, TableInfo>();
    async function load(database: string, table: string): Promise<TableInfo> {
      const key = JSON.stringify([database, table]);
      const info = cache.get(key) ?? await read(active, { connectionId: origin.intent.connectionId, database, table }, owns);
      if (!owns()) throw Error(text.stale);
      if (info.database !== database || info.name !== table) throw Error(text.target);
      const metadataKey = foreignKeyJoinMetadataKey(info);
      if (database === base.database && table === base.name && metadataKey !== origin.intent.metadataKey) {
        origin.intent.invalidate();
        throw Error(text.stale);
      }
      cache.set(key, info);
      return info;
    }
    await load(base.database, base.name);
    if ('single' in design) {
      const { single: _single, version: _version, ...settings } = design;
      const next: Selection = { ...selected, ...settings, offset: settings.offset ?? '', projection: settings.projection, childSearch: '', childPage: 1 };
      const sources = joinSources(base, undefined, []);
      compileSelection(origin.intent, next, undefined, sources, joinHavingTargets(next, sources));
      if (!owns()) return;
      selectionRef.current = next;
      setSelection(next);
      setDesignNotice(text.designRestored);
      return;
    }
    const { first, additional, version: _version, ...settings } = design;
    const firstInfo = await load(first.database, first.table);
    const withIds = (pairs: ManualJoinDesign['first']['pairs']) => pairs.map(pair => ({ ...pair, id: uid() }));
    const extra: AdditionalJoinDraft[] = [];
    for (const step of additional) {
      const info = await load(step.database, step.table);
      extra.push({ ...step, id: uid(), tables: [step.table], pairs: withIds(step.pairs), info });
    }
    const next: Selection = { ...selected, ...settings, offset: settings.offset ?? '', projection: settings.projection, additional: extra, manual: { ...first, pairs: withIds(first.pairs) },
      childSearch: '', parentSearch: '', childPage: 1, parentPage: 1 };
    const sources = joinSources(base, firstInfo, extra);
    compileSelection(origin.intent, next, firstInfo, sources, joinHavingTargets(next, sources));
    if (!owns()) return;
    const restoredDatabases = [...new Set([...databases, first.database, ...extra.map(step => step.database)])];
    setDatabases(manualJoinCatalogNames(restoredDatabases));
    setTables([first.table]);
    selectionRef.current = next;
    setSelection(next);
    setParent({ fk: selected.fk, info: firstInfo });
    setDesignNotice(text.designRestored);
  }

  /** 同步占门后才排原异步链，按钮连点和旧DOM均不能建立第二个在途操作。 */
  function run(kind: 'preview' | 'open' | 'view' | NonNullable<MysqlJoinPreviewInput['mode']> | 'databases' | 'tables' | DesignOperation | QueryBuilderSaveTarget, index?: number): void {
    const step = index === undefined ? undefined : selection.additional[index];
    if (index !== undefined && !step) return;
    const chosenTarget = step ? step.tables?.includes(step.table) && { database: step.database, table: step.table } : target;
    const inspectionMode = kind === 'rows' || kind === 'explain' || kind === 'explainText' ? kind : undefined;
    const saveQuery = typeof kind === 'object' ? kind : undefined;
    if (!editable() || (kind === 'preview' && !chosenTarget) || (kind === 'view' && !onViewApplied) ||
        ((kind === 'open' || kind === 'view' || saveQuery || inspectionMode) && !preview.value) ||
        ((kind === 'databases' || kind === 'tables') && !selection.manual)) return;
    const designOperation = typeof kind === 'string' && (kind.endsWith('Design') || kind === 'listDesigns');
    const designTarget = designs.find(item => item.id === designId);
    const saveDesign = kind === 'saveDesign' || kind === 'replaceDesign';
    if (designOperation && ((!selection.manual && !origin.single) || (saveDesign && (!preview.value || !designName.trim())) ||
        (kind !== 'listDesigns' && kind !== 'saveDesign' && !designTarget))) return;
    if (kind === 'loadDesign' && (origin.single ? selection !== initialSelection : !!selection.manual?.table) && !window.confirm(text.designRestoreConfirm) ||
        kind === 'replaceDesign' && !window.confirm(text.designReplaceConfirm) ||
        kind === 'deleteDesign' && !window.confirm(text.designDeleteConfirm)) return;
    if (!editable()) return;
    const selected = selection, generation = ++revision.current, receipt = preview.value;
    let active: Operation;
    // 目录回执只替换读取时持有的追加步骤，和条件编辑共用同一草稿世代。
    const publishStep = (value: AdditionalJoinDraft) => {
      const next = { ...selected, additional: selected.additional.map(item => item === step ? value : item) };
      selectionRef.current = next; setSelection(next);
    };
    const owns = () => current() && operation.current === active && !active.cancelled && generation === revision.current && selectionRef.current === selected;
    active = { promise: Promise.resolve(), cancelled: false }; operation.current = active;
    try { origin.onActivity?.(1); } catch (reason) { operation.current = null; setError(errorMessage(reason)); return; }
    if (designOperation) setDesignNotice('');
    if (inspectionMode) setInspection(undefined);
    const inspectionMessage = inspectionMode === 'rows' ? text.sampleLoading : text.explainLoading;
    setBusy(true); setError(''); setMessage(designOperation ? text.designWorking : inspectionMode ? inspectionMessage : kind === 'open' || kind === 'view' || saveQuery ? text.checking : kind === 'databases' ? text.manualDatabases : kind === 'tables' ? text.manualTables : text.parentLoading);
    active.promise = Promise.resolve().then(async () => {
      if (!owns()) return;
      if (designOperation) {
        const scope = { connectionId: origin.intent.connectionId, database: origin.intent.source.database, table: origin.intent.source.name,
          ...(origin.single ? { single: true as const } : {}) };
        if (kind === 'loadDesign') {
          const design = queryBuilderDesignSchema.parse(await invoke('joinDesigns.read', { ...scope, id: designTarget!.id }));
          if (owns()) await restoreDesign(design, selected, active, owns);
        } else if (saveDesign) {
          const entry = await invoke('joinDesigns.save', { ...scope, name: designName, design: captureDesign(selected),
            ...(kind === 'replaceDesign' ? { replaceId: designTarget!.id } : {}) });
          if (!owns()) return;
          setDesignId(entry.id);
          setDesignNotice(text.designSaved);
          setDesigns(previous => [...previous.filter(item => kind !== 'replaceDesign' || item.id !== designTarget?.id), entry]);
          setDesignName(entry.name);
        } else if (kind === 'deleteDesign') {
          await invoke('joinDesigns.delete', { ...scope, id: designTarget!.id });
          if (owns()) {
            setDesigns(previous => previous.filter(item => item.id !== designTarget!.id));
            setDesignId('');
            setDesignNotice(text.designDeleted);
          }
        } else {
          const entries = await invoke('joinDesigns.list', scope);
          if (owns()) setDesigns(entries);
        }
      } else if (kind === 'databases') {
        const names = await invoke('metadata.databases', { connectionId: origin.intent.connectionId });
        if (owns()) setDatabases(manualJoinCatalogNames([...names, origin.intent.source.database]));
      } else if (kind === 'tables') {
        const objects = await invoke('metadata.objects', { connectionId: origin.intent.connectionId, database: step?.database ?? selected.manual!.database });
        if (!owns()) return;
        const names = manualJoinTableNames(objects);
        const table = step?.table ?? selected.manual!.table;
        if (table && !names.includes(table)) { origin.intent.invalidate(); throw Error(text.stale); }
        if (step) publishStep({ ...step, tables: names }); else setTables(names);
      } else if (kind === 'preview' && chosenTarget) {
        const metadata = await read(active, { connectionId: origin.intent.connectionId, ...chosenTarget }, owns);
        if (!owns()) return;
        if (metadata.database !== chosenTarget.database || metadata.name !== chosenTarget.table) throw Error(text.target);
        if (step) {
          const key = foreignKeyJoinMetadataKey(metadata);
          if (step.info && foreignKeyJoinMetadataKey(step.info) !== key) { origin.intent.invalidate(); throw Error(text.stale); }
          if (!step.info) publishStep({ ...step, info: structuredClone(metadata), pairs: step.kind === 'CROSS' ? [] : [newManualJoinPair()] });
          return;
        }
        // 用单列小输出验证关系与真实父目标；默认宽表超预算时仍允许用户精简选列。
        const metadataKey = foreignKeyJoinMetadataKey(metadata), previous = parent?.fk === selected.fk ? parent : undefined;
        // 同一关系重读只核结构，不重置用户选列；结构变化必须重新打开，不能重签旧意图。
        if (previous && foreignKeyJoinMetadataKey(previous.info) !== metadataKey) { origin.intent.invalidate(); throw Error(text.stale); }
        if (!selected.manual) buildForeignKeyJoin(origin.intent.source, metadata, selected.fk, selected.kind, origin.intent.limit, { childColumns: [origin.intent.source.columns[0].name], parentColumns: [] });
        const manual = selected.manual && !previous && selected.kind !== 'CROSS' ? { ...selected.manual, pairs: [newManualJoinPair()] } : selected.manual;
        const next = reconcileProjection({ ...selected, manual, parent: previous ? selected.parent : metadata.columns.map(column => column.name), parentSearch: previous ? selected.parentSearch : '', parentPage: previous ? selected.parentPage : 1 });
        selectionRef.current = next; setSelection(next); setParent({ fk: selected.fk, info: structuredClone(metadata) });
      } else if (inspectionMode && receipt) {
        await inspect(active, receipt, inspectionMode, owns);
      } else if ((kind === 'open' || kind === 'view' || saveQuery) && receipt) {
        // 视图与独立查询都先复核同一份设计，视图草稿仅通过现有视图定义词法门槛。
        const viewSql = kind === 'view' ? mysqlViewFileQuery(receipt.sql) + '\n' : undefined;
        await revalidateForeignKeyJoin(origin.intent, receipt, target => read(active, target, owns), owns);
        if (!owns()) return;
        if (saveQuery) {
          await saveQueryBuilderSql(saveQuery, origin.intent.connectionId, origin.intent.source.database, receipt.sql);
          return;
        }
        if (viewSql) {
          const version = useWorkspace.getState().connectionVersions[origin.intent.connectionId] ?? 0;
          const seed = { sql: viewSql, version };
          activeView.current = seed; setViewSeed(seed);
        } else {
          if (!onOpen(receipt)) throw Error(text.stale);
          consumed.current = true;
        }
      }
    }).catch(reason => { if (alive.current && !closingRef.current && operation.current === active && generation === revision.current) setError(errorMessage(reason)); }).finally(async () => {
      try { if (active.cancellation) await active.cancellation; }
      catch (reason) { cleanupError.current(errorMessage(reason)); }
      finally { if (operation.current === active) operation.current = null; origin.onActivity?.(-1); if (alive.current) { setBusy(false); setMessage(''); } }
    });
  }
  /** FK改变立即撤销旧父回执，取消仅本地原任务；原Promise收尾前不并发读新FK。 */
  function changeForeignKey(value: string): void {
    if (!current() || !rendered() || groupRef.current || !choices.some(item => item.name === value) || value === selection.fk) return;
    resetRelation({ ...selection, fk: value });
  }
  /** 更换目标会废弃原结构及依赖该目标的草稿。筛选、排序和字段映射都不跨表套用。 */
  function resetRelation(selection: Selection): void {
    cancel(); revision.current++; setParent(undefined); setError('');
    const next = reconcileProjection({ ...selection, distinct: false, child: origin.intent.source.columns.map(column => column.name), parent: [], parentSearch: '', childPage: 1, parentPage: 1, sort: [], filters: [], filterMode: 'all' as const, filterGroup: undefined, summaryGroups: [], aggregates: [], summarySort: [], having: [], havingMode: 'all', havingGroup: undefined });
    selectionRef.current = next; setSelection(next);
  }
  function changeManualTarget(database: string, table: string) {
    const manual = selection.manual;
    if (!manual || selection.additional.length || !editable() || !databases.includes(database) || (table && (database !== manual.database || !tables?.includes(table))) ||
        (database === manual.database && table === manual.table)) return;
    if (database !== manual.database) setTables(undefined);
    resetRelation({ ...selection, manual: { database, table, pairs: [] } });
  }
  function canRetargetAdditional(index: number): boolean {
    if (index !== selection.additional.length - 1) return false;
    const side = manualJoinAlias(index + 2);
    return !selection.filters.some(item => item.side === side) && !selection.summaryGroups.some(item => item.side === side) &&
      !selection.aggregates.some(item => item.side === side) &&
      ![...selection.sort, ...selection.summarySort].some(item => item.rule.side === side);
  }
  /** 搜索只影响本地分页；字段变化后同步废弃旧打开闭包，未选字段不会改变JOIN条件。 */
  function revise(next: Selection): void {
    if (!editable()) return;
    const draft = reconcileProjection(next);
    revision.current++; selectionRef.current = draft; setSelection(draft); setError('');
  }
  /** 关闭状态真实等待原读取与取消响应，不把局部卸载或取消ACK冒充服务器已收尾。 */
  function close(): void {
    if (!alive.current || closingRef.current || committed.current !== ticket) return;
    closingRef.current = true; revision.current++; setClosing(true); cancel();
    const active = operation.current;
    void (async () => { if (active) await active.promise; if (alive.current) { alive.current = false; closeCallback.current(); } })();
  }
  useEffect(() => {
    alive.current = true;
    const unsubscribe = origin.intent.subscribe(() => { if (alive.current) { setInvalid(true); setParent(undefined); cancel(); } });
    const block = (event: KeyboardEvent) => {
      // 分组区域自己的Ctrl/⌘+Enter只应用本地草稿；其它执行/保存快捷键仍不得穿透。
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && groupRef.current && event.target && groupPanel.current?.contains(event.target as Node)) return;
      if ((event.ctrlKey || event.metaKey) && (event.key === 'Enter' || event.key.toLowerCase() === 's')) { event.preventDefault(); event.stopImmediatePropagation(); }
    };
    document.addEventListener('keydown', block, true);
    return () => { alive.current = false; revision.current++; unsubscribe(); cancel(); document.removeEventListener('keydown', block, true); };
  }, []);
  const sourceUnavailable = invalid || !origin.intent.current() || closing || consumed.current, unavailable = sourceUnavailable || !!groupEditor;
  /** 环境检查也用于子面板首次渲染，不能提前要求父layoutEffect提交；实际Apply另核当前渲染。 */
  function groupCurrent(owner: GroupEditor): boolean { return groupRef.current === owner && selectionRef.current === owner.selection && !operation.current && current(); }
  /** 仅从有效预览建立独占本地分组草稿，保留原值和字段来源；不读取数据库。 */
  function openGroups(kind: 'where' | 'having'): void {
    if (!editable() || !preview.value || !(kind==='having'?selection.having.length:selection.filters.length)) return;
    const filters = preview.value.options.filters??[], having=kind==='having';
    const rules=having?preview.value.options.having!.filters:filters.map(({side:_side,...rule})=>rule);
    const owner: GroupEditor = { selection, kind, mode:having?selection.havingMode:selection.filterMode, initial:having?selection.havingGroup:selection.filterGroup, rules: Object.freeze(rules.map(rule=>Object.freeze({...rule}))), presentation: having?{hint:havingText.groupHint,stale:havingText.groupStale,declined:havingText.groupDeclined,summary:(_index,rule)=>`${havingText.aggregate} · ${filterRuleSummary(rule)}`}:{ hint: filterText.groupHint, stale: filterText.groupStale, declined: filterText.groupDeclined, summary: (index,rule) => `${label(filters[index].side)} · ${filterRuleSummary(rule)}` } };
    groupRef.current = owner; setGroupEditor(owner); setError('');
  }
  /** ON 分组只引用当前步骤的比较行，可编辑括号而不重读表或改写字段。 */
  function openOnGroups(trigger: HTMLButtonElement, index?: number): void {
    const step = index === undefined ? selection.manual : selection.additional[index];
    if (!editable() || !step || step.pairs.length < 2 || step.pairs.length > FILTER_LIMITS.conditions) return;
    const owner: GroupEditor = {
      selection, kind: 'on', trigger, mode: step.on?.mode ?? 'all', initial: step.on?.group,
      rules: manualJoinOnRules(step.pairs.length),
      presentation: {
        hint: text.manualOnGroupHint, stale: text.stale, declined: filterText.groupDeclined,
        summary: position => {
          const pair = step.pairs[position];
          const alias = manualJoinAlias(pair.source ?? (index === undefined ? 0 : selection.additional[index].source));
          return `${alias}.${pair.child || text.manualSelect} ${pair.operator ?? '='} ${manualJoinAlias(index === undefined ? 1 : index + 2)}.${pair.parent || text.manualSelect}`;
        },
      },
      applyOn(group) {
        const on = { mode: group.mode, group };
        return index === undefined ? { ...selection, manual: { ...step, on } } :
          { ...selection, additional: selection.additional.map((draft, position) => position === index ? { ...draft, on } : draft) };
      },
    };
    groupRef.current = owner;
    setGroupEditor(owner);
    setError('');
  }
  /** 取消不改原条件；立即撤销本次渲染，不能在下一次提交前借旧禁用按钮改写父选择。 */
  function cancelGroups(owner: GroupEditor): void { if (groupRef.current !== owner || !rendered()) return; groupRef.current = undefined; committed.current = null; setGroupEditor(undefined); }
  /** 父窗口再次验证完整叶覆盖后一次替换树与根模式，随后才恢复可打开预览。 */
  function applyGroups(owner: GroupEditor, group: FilterGroup): boolean {
    if (!groupCurrent(owner) || !rendered()) return false;
    const checked = validateFilterGroup(owner.rules, group.mode, group)!;
    groupRef.current = undefined; setGroupEditor(undefined); revise(owner.applyOn ? owner.applyOn(checked) : owner.kind==='having'?{...owner.selection,havingGroup:checked,havingMode:checked.mode}:{ ...owner.selection, filterGroup: checked, filterMode: checked.mode }); return true;
  }
  /** 条件增删按稳定ID重映射原树；暂时无效的值不会导致括号被悄然清空。 */
  function reviseFilters(filters: ForeignKeyJoinFilterDraft[]): void {
    if (!editable()) return;
    const filterGroup = foreignKeyJoinGroupAfterChange(selection.filters, filters, selection.filterGroup, selection.filterMode);
    revise({ ...selection, filters, filterGroup, filterMode: filters.length ? selection.filterMode : 'all' });
  }
  /** 条件只在当前原窗口本地添加，未完成值保持原文并阻止打开，不降级为无筛选查询。 */
  function addFilter(): void { if (!editable() || !sourceReady || selection.filters.length >= FILTER_LIMITS.conditions) return; reviseFilters([...selection.filters, { id: uid(), side: 'child', enabled: true, draft: emptyFilterDraft(origin.intent.source.columns[0].name) }]); }
  /** 原条目对象和已提交渲染均须仍有效；移除、换FK或改来源后旧输入不能落到其它条件。 */
  function editFilter(entry: ForeignKeyJoinFilterDraft, patch: { side?: ForeignKeyJoinSide; enabled?: boolean; draft?: Partial<FilterDraft> }): void {
    if (!editable() || !selection.filters.includes(entry)) return;
    const value = { ...entry, ...(patch.side ? { side: patch.side } : {}), ...(patch.enabled === undefined ? {} : { enabled: patch.enabled }), draft: { ...entry.draft, ...patch.draft } };
    const filters = selection.filters.map(item => item === entry ? value : item);
    if (draftCharacters([...filters,...selection.having]) > FILTER_LIMITS.totalCharacters) { setError(selection.having.length?havingText.draftBudget:filterText.draftBudget); return; }
    reviseFilters(filters);
  }
  /** 两类条件含隐藏值共同计入草稿预算，不按运算符或当前模式丢弃保留输入。 */
  function draftCharacters(entries:readonly {draft:FilterDraft}[]):number{return entries.reduce((total,item)=>total+item.draft.value.length+item.draft.upperValue.length+item.draft.valuesText.length,0);}
  /** HAVING增删按稳定行ID重编号，值尚未有效时也保留原括号。 */
  function reviseHaving(having:ForeignKeyJoinHavingDraft[]):void{if(!editable())return;const havingGroup=foreignKeyJoinGroupAfterChange(selection.having,having,selection.havingGroup,selection.havingMode);revise({...selection,having,havingGroup,havingMode:having.length?selection.havingMode:'all'});}
  /** 明确添加到当前真实输出，删除/重建同名输出后仍须用户重选。 */
  function addHaving():void{if(!editable()||!selection.summaryEnabled||selection.having.length>=FILTER_LIMITS.conditions||!havingTargets.length)return;const target=havingTargets[0];reviseHaving([...selection.having,{id:uid(),enabled:true,targetLabel:target.label,draft:emptyFilterDraft(target.id)}]);}
  /** 旧条目和旧渲染不能覆盖后继；超量新输入拒绝，WHERE和HAVING原草稿保持。 */
  function editHaving(entry:ForeignKeyJoinHavingDraft,patch:{enabled?:boolean;draft?:Partial<FilterDraft>;targetLabel?:string}):void{
    if(!editable()||!selection.having.includes(entry))return;const next={...entry,...(patch.enabled===undefined?{}:{enabled:patch.enabled}),...(patch.targetLabel===undefined?{}:{targetLabel:patch.targetLabel}),draft:{...entry.draft,...patch.draft}},having=selection.having.map(item=>item===entry?next:item);
    if(draftCharacters([...selection.filters,...having])>FILTER_LIMITS.totalCharacters){setError(havingText.draftBudget);return;}reviseHaving(having);
  }
  /** 排序身份固定为表别名、真实列名和本地行ID；移动位置不改变旧回调的目标。 */
  function sortColumns(side: ForeignKeyJoinSort['side']): string[] {
    if (side === 'aggregate') return selection.summaryEnabled ? [...new Set(selection.aggregates.map(item=>item.alias).filter(Boolean))] : [];
    if (selection.summaryEnabled) return selection.summaryGroups.filter(item=>item.side===side).map(item=>item.column);
    if (selection.distinct) {
      if (side === 'child' || side === 'parent') return selection[side];
      return selection.additional[Number(side.slice(1)) - 3]?.columns ?? [];
    }
    return sources.get(side)?.columns.map(column => column.name) ?? [];
  }
  function availableSort(side: ForeignKeyJoinSort['side'], except?: string): string[] { return sortColumns(side).filter(column => !sorting.some(item => item.id !== except && item.rule.side === side && item.rule.column === column)); }
  /** 明细与汇总持有独立排序草稿，切换模式不丢失或偷偷套用另一种输出的排序。 */
  function reviseSort(next: Selection['sort']): void { revise({ ...selection, [selection.summaryEnabled ? 'summarySort' : 'sort']: next }); }
  /** 改来源优先保留同名字段，否则明确选择该侧第一可用列；无可用列时保留原项。 */
  function editSort(id: string, patch: Partial<ForeignKeyJoinSort>): void {
    if (!editable()) return; const item = sorting.find(item => item.id === id); if (!item) return;
    const rule = { ...item.rule, ...patch }, columns = availableSort(rule.side, id);
    if (!columns.includes(rule.column) || !['ASC', 'DESC'].includes(rule.direction) || rule.nulls !== undefined && !['FIRST', 'LAST'].includes(rule.nulls)) return;
    reviseSort(sorting.map(value => value === item ? { ...value, rule } : value));
  }
  /** NULL默认位置移除可选属性；清空排序后生成旧版无ORDER BY字节，不偷偷追加主键。 */
  function editSortNulls(id: string, value: string): void {
    if (!editable() || !['DEFAULT', 'FIRST', 'LAST'].includes(value)) return; const item = sorting.find(item => item.id === id); if (!item) return;
    const { nulls: _nulls, ...rule } = item.rule;
    reviseSort(sorting.map(entry => entry === item ? { ...entry, rule: value === 'DEFAULT' ? rule : { ...rule, nulls: value as 'FIRST' | 'LAST' } } : entry));
  }
  /** 只有本地明确添加才生成排序项，最多20项；不请求数据或改变原表页排序。 */
  function addSort(): void {
    if (!editable() || !sourceReady || sorting.length >= foreignKeyJoinLimits.sorts) return;
    const side = sortSides.find(side => availableSort(side).length); if (!side) return;
    const column = availableSort(side)[0];
    reviseSort([...sorting, { id: uid(), rule: { side, column, direction: 'ASC' } }]);
  }
  /** 上下移动保留字段、方向和NULL策略；边界及旧条目事件不修改新草稿。 */
  function moveSort(id: string, offset: -1 | 1): void {
    if (!editable()) return; const sort = [...sorting], index = sort.findIndex(item => item.id === id), target = index + offset; if (index < 0 || target < 0 || target >= sort.length) return;
    const [item] = sort.splice(index, 1); sort.splice(target, 0, item); reviseSort(sort);
  }
  /** 分组字段使用独立草稿；添加只选择尚未使用的真实列，不隐式把全部明细字段分组。 */
  function addSummaryGroup(): void {
    if(!editable()||!sourceReady||selection.summaryGroups.length>=foreignKeyJoinSummaryLimits.groups)return;
    for(const [side, info] of sources){const column=info.columns.find(column=>!selection.summaryGroups.some(item=>item.side===side&&item.column===column.name));if(column){revise({...selection,summaryGroups:[...selection.summaryGroups,{id:uid(),side,column:column.name}]});return;}}
  }
  /** 老行及老渲染不能编辑后继；字段必须来自当前目录且不重复，值本身不由SQL表达式提供。 */
  function editSummaryGroup(entry: ForeignKeyJoinGroupDraft, patch: Partial<Omit<ForeignKeyJoinGroupDraft, 'id'>>): void {
    if (!editable() || !sourceReady || !selection.summaryGroups.includes(entry)) return;
    const next = { ...entry, ...patch };
    if (!sources.get(next.side)?.columns.some(column => column.name === next.column) ||
        selection.summaryGroups.some(item => item !== entry && item.side === next.side && item.column === next.column)) return;
    if (next.side !== entry.side || next.column !== entry.column) delete next.alias;
    revise({ ...selection, summaryGroups: selection.summaryGroups.map(item => item === entry ? next : item) });
  }
  /** 明确添加COUNT(*)草稿，默认别名避开已用别名；空汇总不会回退明细查询。 */
  function addAggregate():void{
    if(!editable()||!sourceReady||selection.aggregates.length>=foreignKeyJoinSummaryLimits.aggregates)return;let n=1;while(selection.aggregates.some(item=>item.alias.toLowerCase()===summaryText.defaultAlias(n).toLowerCase()))n++;
    revise({...selection,aggregates:[...selection.aggregates,{id:uid(),fn:'COUNT_ALL',side:'child',column:origin.intent.source.columns[0].name,alias:summaryText.defaultAlias(n)}]});
  }
  /** 未完成别名及数值列选择保持原文，由纯编译器阻止旧SQL打开；COUNT(*)隐藏字段草稿不丢。 */
  function editAggregate(entry:ForeignKeyJoinAggregateDraft,patch:Partial<Omit<ForeignKeyJoinAggregateDraft,'id'>>):void{if(!editable()||!selection.aggregates.includes(entry))return;revise({...selection,aggregates:selection.aggregates.map(item=>item===entry?{...item,...patch}:item)});}
  /** 在各自列表中按原对象身份移动；排序对聚合别名绑定，不随行序号指向其它指标。 */
  function moveSummary(key:'summaryGroups'|'aggregates',entry:ForeignKeyJoinGroupDraft|ForeignKeyJoinAggregateDraft,offset:-1|1):void{if(!editable())return;const next=[...selection[key]],index=next.indexOf(entry),target=index+offset;if(index<0||target<0||target>=next.length)return;const[item]=next.splice(index,1);next.splice(target,0,item);revise({...selection,[key]:next});}
  /** 每侧最多挂载50个字段，完整选择仍保留；默认全选和超预算错误不阻止精简。 */
  function fieldList(side: 'child' | 'parent', info: TableInfo): ReactNode {
    const searchKey = side === 'child' ? 'childSearch' : 'parentSearch', pageKey = side === 'child' ? 'childPage' : 'parentPage';
    const names = info.columns.map(column => column.name).filter(name => name.toLocaleLowerCase().includes(selection[searchKey].toLocaleLowerCase()));
    const pages = Math.max(1, Math.ceil(names.length / pageSize)), page = Math.min(selection[pageKey], pages), selected = selection[side];
    const title = origin.single ? text.singleFields : side === 'child' ? text.childFields : text.parentFields;
    return <fieldset disabled={busy || unavailable}><legend>{title}</legend><p>{text.selected(selected.length, info.columns.length)}</p>
      <button disabled={busy || unavailable} onClick={() => revise({ ...selection, [side]: info.columns.map(column => column.name) })}>{text.allFields}</button><button disabled={busy || unavailable || !selected.length} onClick={() => revise({ ...selection, [side]: [] })}>{text.clearFields}</button>
      <label>{text.search}<input aria-label={title + text.search} value={selection[searchKey]} maxLength={512} onChange={event => revise({ ...selection, [searchKey]: event.target.value, [pageKey]: 1 })}/></label>
      <div>{names.slice((page - 1) * pageSize, page * pageSize).map(name => <label key={name} style={{ display: 'block' }}><input type="checkbox" aria-label={origin.single ? text.singleSelect(name) : side === 'child' ? text.childSelect(name) : text.parentSelect(name)} checked={selected.includes(name)} onChange={event => revise({ ...selection, [side]: event.target.checked ? [...selected, name] : selected.filter(value => value !== name) })}/>{name}{aliases.get(JSON.stringify([side, name])) && <> → {aliases.get(JSON.stringify([side, name]))}</>}</label>)}</div>
      <button disabled={busy || unavailable || page <= 1} onClick={() => revise({ ...selection, [pageKey]: page - 1 })}>{text.previous}</button><span>{text.page(page, pages)}</span><button disabled={busy || unavailable || page >= pages} onClick={() => revise({ ...selection, [pageKey]: page + 1 })}>{text.next}</button>
    </fieldset>;
  }
  const resultLimitLabel = origin.single ? text.singleLimit : text.resultLimit;
  const sortTitle = origin.single ? text.singleSort : text.sortTitle;
  const designTitle = origin.single ? text.singleDesignTitle : text.designTitle;
  // 在同一个组件中切换唯一模态窗口，返回后继续使用原有选列、条件和结果。
  if (viewSeed && onViewApplied) return <DdlDialog connectionId={origin.intent.connectionId} database={origin.intent.source.database}
    viewSeed={viewSeed} viewSeedCurrent={() => alive.current && activeView.current === viewSeed && origin.intent.current()}
    onApplied={onViewApplied} onClose={() => {
      if (activeView.current !== viewSeed) return;
      activeView.current = undefined; setViewSeed(undefined);
    }}/>;
  return <Modal title={title} wide onClose={close} onEscape={groupEditor ? event => { if (!event.target || !groupPanel.current?.contains(event.target as Node)) event.stopPropagation(); } : undefined}><div className="modal-content" aria-busy={busy || closing}>
    <p>{origin.single ? text.singleScope : selection.manual ? text.manualScope : text.scope}</p><p>{origin.intent.source.database}.{origin.intent.source.name} · {text.limit}：{origin.intent.limit}</p>
    {(selection.manual || origin.single) && <details>
      <summary>{designTitle}</summary>
      <p>{text.designHint}</p>
      <fieldset disabled={busy || unavailable}>
        <div className="child-reference-tools"><button type="button" onClick={() => run('listDesigns')}>{text.designRefresh}</button></div>
        <label>{designTitle}<select value={designId} onChange={event => {
          const id = event.target.value;
          setDesignId(id);
          if (id) setDesignName(designs.find(item => item.id === id)?.name ?? '');
          setDesignNotice('');
        }}><option value="">{text.manualSelect}</option>
          {designs.map(entry => <option value={entry.id} key={entry.id}>{entry.name}</option>)}
        </select></label>
        <div className="child-reference-tools">
          <button type="button" disabled={!designId} onClick={() => run('loadDesign')}>{text.designLoad}</button>
          <button type="button" disabled={!designId} onClick={() => run('deleteDesign')}>{text.designDelete}</button>
        </div>
        <label>{text.designName}<input value={designName} maxLength={80} onChange={event => setDesignName(event.target.value)}/></label>
        <div className="child-reference-tools">
          <button type="button" disabled={!preview.value || !designName.trim()} onClick={() => run('saveDesign')}>{text.designSave}</button>
          <button type="button" disabled={!preview.value || !designName.trim() || !designId} onClick={() => run('replaceDesign')}>{text.designReplace}</button>
        </div>
        {designNotice && <p role="status">{designNotice}</p>}
      </fieldset>
    </details>}
    <label>{resultLimitLabel}<input aria-label={resultLimitLabel} inputMode="numeric" maxLength={128} value={selection.limit} disabled={busy || unavailable} onChange={event => revise({ ...selection, limit: event.target.value })}/></label><p>{text.limitHint}</p>
    <label>{pagination.offset}<input aria-label={pagination.offset} inputMode="numeric" maxLength={10} value={selection.offset}
      disabled={busy || unavailable} onChange={event => revise({ ...selection, offset: event.target.value })}/></label>
    <p className="muted small">{pagination.offsetHint}</p>
    {!origin.single && <>{selection.manual ? <ManualJoinTableFields key={selection.manual.database} selection={selection.manual} databases={databases} tables={tables} disabled={busy || unavailable || !!selection.additional.length}
      onDatabases={() => run('databases')} onTables={() => run('tables')} onTarget={changeManualTarget}/>
      : <label>{text.fk}<select aria-label={text.fk} disabled={unavailable || !!origin.fixed} value={selection.fk} onChange={event => changeForeignKey(event.target.value)}>{choices.map(item => <option key={item.name} value={item.name}>{item.name} → {item.referencedDatabase}.{item.referencedTable}</option>)}</select></label>}
    <label>{text.joinKind}<select aria-label={text.joinKind} disabled={busy || unavailable} value={selection.kind} onChange={event => {
      const kind = event.target.value;
      if (!editable() || (kind !== 'LEFT' && kind !== 'RIGHT' && kind !== 'INNER' && !(kind === 'CROSS' && selection.manual))) return;
      const manual = selection.manual && changeManualJoinConditions(selection.manual, selection.kind === 'CROSS', kind === 'CROSS', !!currentParent);
      if (selection.manual && !manual) return;
      revise({ ...selection, kind, manual, unmatchedOnly: (kind === 'LEFT' || kind === 'RIGHT') && selection.unmatchedOnly });
    }}><option value="LEFT">{text.left}</option><option value="RIGHT">{text.right}</option><option value="INNER">{text.inner}</option>
      {selection.manual && <option value="CROSS">CROSS JOIN</option>}</select></label>
    <label><input type="checkbox" checked={selection.unmatchedOnly} disabled={busy || unavailable || selection.kind === 'INNER' || selection.kind === 'CROSS'}
      onChange={event => revise({ ...selection, unmatchedOnly: event.target.checked })}/>{text.unmatchedOnly}</label>
    {selection.kind === 'CROSS' && <p className="muted small">{joinText.crossHint}</p>}
    <UsageHelp><p>{{ LEFT: text.leftHint, RIGHT: text.rightHint, INNER: text.innerHint, CROSS: joinText.crossHint }[selection.kind]}</p>
      {(selection.kind === 'LEFT' || selection.kind === 'RIGHT') && <p>{text.unmatchedHint}</p>}{!selection.manual && <p>{text.relationship}</p>}<p>{text.aliases}</p></UsageHelp>{choice && <section aria-label={text.relationship}><ul>{choice.columns.map((name, index) => <li key={name}>{origin.intent.source.database}.{origin.intent.source.name}.{name} = {choice.referencedDatabase}.{choice.referencedTable}.{choice.referencedColumns[index]}</li>)}</ul></section>}
    {selection.kind !== 'CROSS' && selection.manual && parent && <ManualJoinPairFields selection={selection.manual} child={origin.intent.source} parent={parent.info} disabled={busy || unavailable}
      onMode={on => revise({ ...selection, manual: { ...selection.manual!, on } })} onGroups={trigger => openOnGroups(trigger)}
      onAdd={() => { const manual = selection.manual!; revise({ ...selection, manual: replaceManualJoinPairs(manual, [...manual.pairs, newManualJoinPair()]) }); }}
      onChange={(id, patch) => { const manual = selection.manual!; revise({ ...selection, manual: { ...manual, pairs: manual.pairs.map(pair => pair.id === id ? { ...pair, ...patch } : pair) } }); }}
      onRemove={id => { const manual = selection.manual!; revise({ ...selection, manual: replaceManualJoinPairs(manual, manual.pairs.filter(pair => pair.id !== id)) }); }}/>}
    {selection.manual && parent && <>
      <p>{text.additionalHint}</p>
      {selection.additional.map((draft, index) => <AdditionalJoinFields key={draft.id} draft={draft} index={index}
        sources={[origin.intent.source, parent.info, ...selection.additional.slice(0, index).flatMap(step => step.info ? [step.info] : [])]}
        databases={databases} disabled={busy || unavailable} canRetarget={canRetargetAdditional(index)} targetReferenced={index === selection.additional.length - 1 && !canRetargetAdditional(index)}
        showColumns={!selection.summaryEnabled} onRead={kind => run(kind, index)} onGroups={trigger => openOnGroups(trigger, index)}
        onChange={value => {
          if ((value.database !== draft.database || value.table !== draft.table) && !canRetargetAdditional(index)) return;
          revise({ ...selection, additional: selection.additional.map(step => step === draft ? value : step) });
        }}
        onRemove={() => { if (canRetargetAdditional(index)) revise({ ...selection, additional: selection.additional.slice(0, -1) }); }}/>)}
      <button type="button" disabled={busy || unavailable || !preview.value || selection.additional.length >= foreignKeyJoinLimits.additionalJoins}
        onClick={() => revise({ ...selection, additional: [...selection.additional, { id: uid(), source: 1, kind: 'INNER',
          database: selection.manual!.database, table: '', pairs: [], columns: [] }] })}>{text.additionalAdd}</button>
    </>}
    </>}
    <label><input type="checkbox" aria-label={summaryText.enabled} checked={selection.summaryEnabled} disabled={busy || unavailable || !sourceReady} onChange={event=>revise({...selection,summaryEnabled:event.target.checked})}/>{summaryText.enabled}</label>
    {!selection.summaryEnabled && <><label><input type="checkbox" aria-label={text.distinct} checked={selection.distinct} disabled={busy || unavailable} onChange={event => revise({ ...selection, distinct: event.target.checked })}/>{text.distinct}</label><UsageHelp><p>{text.distinctHint}</p></UsageHelp></>}
    {selection.summaryEnabled ? sourceReady && <TableForeignKeyJoinSummary single={origin.single} sources={sources} sourceLabel={label} groups={selection.summaryGroups} aggregates={selection.aggregates} disabled={busy||unavailable} onAddGroup={addSummaryGroup} onGroup={editSummaryGroup} onRemoveGroup={entry=>{if(selection.summaryGroups.includes(entry))revise({...selection,summaryGroups:selection.summaryGroups.filter(item=>item!==entry)});}} onMoveGroup={(entry,offset)=>moveSummary('summaryGroups',entry,offset)} onClearGroups={()=>revise({...selection,summaryGroups:[]})} onAddAggregate={addAggregate} onAggregate={editAggregate} onRemoveAggregate={entry=>{if(selection.aggregates.includes(entry))revise({...selection,aggregates:selection.aggregates.filter(item=>item!==entry)});}} onMoveAggregate={(entry,offset)=>moveSummary('aggregates',entry,offset)} onClearAggregates={()=>revise({...selection,aggregates:[]})}/> : <>{fieldList('child',origin.intent.source)}{parent && parent.fk===selection.fk && fieldList('parent',parent.info)}</>}
    {!selection.summaryEnabled && sourceReady && outputKeys.length > 0 && outputKeys.length <= foreignKeyJoinLimits.outputColumns &&
      <QueryBuilderProjectionOrder selected={outputKeys} aliases={outputAliases} disabled={busy || unavailable}
        labelFor={key => origin.single ? key.slice(2) : key}
        onChange={(keys, aliases) => {
          const names = new Map(aliases.map(item => [item.column, item.alias]));
          revise({ ...selection, projection: keys.map(column => ({ column, alias: names.get(column) })) });
        }}
        onReset={selection.projection ? () => revise({ ...selection, projection: undefined }) : undefined}/>}
    {selection.summaryEnabled&&sourceReady&&<><TableForeignKeyJoinHaving entries={selection.having} targets={havingTargets} mode={selection.havingMode} disabled={busy||unavailable} onAdd={addHaving} onChange={editHaving} onRemove={entry=>{if(selection.having.includes(entry))reviseHaving(selection.having.filter(item=>item!==entry));}} onClear={()=>reviseHaving([])} onMode={havingMode=>revise({...selection,havingMode,havingGroup:tableFilterGroupWithMode(selection.havingGroup,havingMode)})}/>
      <button ref={havingGroupTrigger} type="button" disabled={busy||unavailable||!selection.having.length||!preview.value} onClick={()=>openGroups('having')}>{havingText.groups}</button>{selection.havingGroup&&<><p aria-label={havingText.structure}>{tableFilterGroupSummary(selection.havingGroup)}</p><button type="button" disabled={busy||unavailable} onClick={()=>revise({...selection,havingGroup:undefined})}>{havingText.flat}</button></>}</>}
    {sourceReady && <><TableForeignKeyJoinFilters single={origin.single} sources={sources} sourceLabel={label} entries={selection.filters} mode={selection.filterMode} disabled={busy || unavailable} onAdd={addFilter} onChange={editFilter} onMode={filterMode => revise({ ...selection, filterMode, filterGroup: tableFilterGroupWithMode(selection.filterGroup, filterMode) })} onRemove={entry => { if (selection.filters.includes(entry)) reviseFilters(selection.filters.filter(item => item !== entry)); }} onClear={() => reviseFilters([])}/>
      <button ref={groupTrigger} type="button" disabled={busy || unavailable || !selection.filters.length || !preview.value} onClick={()=>openGroups('where')}>{origin.single ? text.singleFilterGroups : filterText.groups}</button>{selection.filterGroup && <><p aria-label={filterText.structure}>{tableFilterGroupSummary(selection.filterGroup)}</p><button type="button" disabled={busy || unavailable} onClick={() => revise({ ...selection, filterGroup: undefined })}>{filterText.flat}</button></>}</>}
    {groupEditor && <div ref={groupPanel}><p role="status">{groupEditor.kind === 'on' ? text.manualOnEditing : groupEditor.kind==='having'?havingText.grouping:filterText.grouping}</p><TableFilterGroupsDialog filters={groupEditor.rules} mode={groupEditor.mode} initial={groupEditor.initial} presentation={groupEditor.presentation} isCurrent={() => groupCurrent(groupEditor)} onApply={group => applyGroups(groupEditor, group)} onClose={() => cancelGroups(groupEditor)}/></div>}
    {sourceReady && <fieldset disabled={busy || unavailable} aria-label={sortTitle}><legend>{sortTitle}</legend><UsageHelp><p>{selection.summaryEnabled?summaryText.sort:selection.distinct?text.distinctSortHint:origin.single?text.singleSortHint:text.sortHint}</p></UsageHelp>{!sorting.length && <p>{text.sortEmpty}</p>}
      {sorting.map(({ id, rule }, index) => <div className="filter-inputs" key={id}><span>{index + 1}.</span>
        <label>{text.sortSide(index + 1)}<select aria-label={text.sortSide(index + 1)} disabled={busy || unavailable} value={rule.side} onChange={event => {
          const side = sortSides.find(side => side === event.target.value);
          if (!side) return;
          const columns = availableSort(side, id), column = columns.includes(rule.column) ? rule.column : columns[0];
          if (column) editSort(id, { side, column });
        }}>{sortSides.map(side => <option key={side} value={side} disabled={!availableSort(side, id).length}>{side === 'child' ? (origin.single ? origin.intent.source.name : text.sortChild) : side === 'parent' ? text.sortParent : label(side)}</option>)}</select></label>
        <label>{text.sortColumn(index + 1)}<select aria-label={text.sortColumn(index + 1)} disabled={busy || unavailable} value={rule.column} onChange={event => editSort(id, { column: event.target.value })}>{!sortColumns(rule.side).includes(rule.column)&&<option value={rule.column} disabled>{summaryText.staleColumn(rule.column)}</option>}{sortColumns(rule.side).map(column => <option key={column} value={column} disabled={!availableSort(rule.side, id).includes(column)}>{column}</option>)}</select></label>
        <label>{text.sortDirection(index + 1)}<select aria-label={text.sortDirection(index + 1)} disabled={busy || unavailable} value={rule.direction} onChange={event => editSort(id, { direction: event.target.value as ForeignKeyJoinSort['direction'] })}><option value="ASC">{text.sortAsc}</option><option value="DESC">{text.sortDesc}</option></select></label>
        <label>{text.sortNulls(index + 1)}<select aria-label={text.sortNulls(index + 1)} disabled={busy || unavailable} value={rule.nulls ?? 'DEFAULT'} onChange={event => editSortNulls(id, event.target.value)}><option value="DEFAULT">{text.nullsDefault}</option><option value="FIRST">{text.nullsFirst}</option><option value="LAST">{text.nullsLast}</option></select></label>
        <button type="button" aria-label={text.sortEarlier(index + 1)} disabled={busy || unavailable || index === 0} onClick={() => moveSort(id, -1)}>↑</button><button type="button" aria-label={text.sortLater(index + 1)} disabled={busy || unavailable || index === sorting.length - 1} onClick={() => moveSort(id, 1)}>↓</button><button type="button" aria-label={text.sortRemove(index + 1)} disabled={busy || unavailable} onClick={() => reviseSort(sorting.filter(item => item.id !== id))}>×</button>
      </div>)}
      <button type="button" disabled={busy || unavailable || sorting.length >= foreignKeyJoinLimits.sorts || !sortSides.some(side => availableSort(side).length)} onClick={addSort}>{origin.single ? text.singleSortAdd : text.sortAdd}</button><button type="button" disabled={busy || unavailable || !sorting.length} onClick={() => reviseSort([])}>{origin.single ? text.singleSortClear : text.sortClear}</button>
    </fieldset>}
    <ErrorBox message={sourceUnavailable && !closing ? text.stale : error || preview.error}/>{closing ? <p role="status">{text.closing}</p> : message && <Spinner text={message}/>}
    {preview.value && !unavailable && <section aria-label={origin.single ? text.singleSampleTitle : text.sampleTitle} aria-busy={busy}>
      <p>{(origin.single ? text.singleSampleHint : text.sampleHint)(mysqlJoinSampleRows)}</p>
      <button type="button" disabled={busy} onClick={() => run('rows')}>{origin.single ? text.singleSample : text.sample}</button>{' '}
      <button type="button" disabled={busy} onClick={() => run('explain')}>{origin.single ? text.singleExplain : text.explain}</button>
      {outcome?.explain && <ExplainPlanView outcome={outcome} busy={busy} onText={outcome.explain.format === 'json' ? () => run('explainText') : undefined}/>}
      {sampleResult && <>
        <p role="status">{text.sampleRows(sampleResult.rows.length, sampleResult.truncated)}</p>
        <div className="view-query-sample-grid">
          <ResultsGrid columns={sampleResult.columns} rows={sampleResult.rows} binaryFileActions={false}/>
        </div>
      </>}
    </section>}
    {preview.value && !unavailable && <section aria-label={text.preview}><pre style={{ whiteSpace: 'pre-wrap' }}>{preview.value.sql}</pre></section>}
    {sourceReady && <QueryBuilderOutput preview={preview.value} sql={preview.value?.sql} disabled={busy || unavailable}
      current={editable} onSave={run}/>}
  </div><footer className="modal-footer">{busy && <button disabled={closing} onClick={() => { if (rendered()) cancel(); }}>{text.cancel}</button>}<span className="grow"/><button disabled={closing} onClick={close}>{text.close}</button>{!origin.single && <button disabled={busy || unavailable || !target} onClick={() => run('preview')}>{selection.manual ? text.manualRead : text.preview}</button>}{onViewApplied && <button disabled={busy || unavailable || !preview.value} onClick={() => run('view')}>{text.openView}</button>}<button className="primary" disabled={busy || unavailable || !preview.value} onClick={() => run('open')}>{text.open}</button></footer></Modal>;
}
