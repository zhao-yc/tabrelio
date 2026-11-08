import type { TableInfo, TablePage } from '../shared/contracts';
import { tableCopyMetadataKey } from '../shared/tableCopySource';
import { collectChanges, type DraftRow } from './dataChanges';
import { changedDraftHistoryBytes, DraftHistory, draftHistoryLimits } from './draftHistory';
import { recordBatchCellBytes, assertRecordBatchFields } from './recordDuplicateBatch';
import { tableEditWorkspaceZh as text } from './locales/tableEditWorkspace.zh-CN';
import { parseTableDraftDocument, type TableDraftDocument, type TableDraftWorkspace } from '../shared/tableDraft';
import { restoreTableDraftRows } from './tableDraft';
import { assertCopiedRecordKeys } from './recordDuplicate';
import { BatchFillIntent, prepareBatchFill, type BatchFillAssignment } from './recordBatchFill';
import { recordReadonlyReason, recordTargetKey, type RecordContext } from './recordViews';

export const tableEditWorkspaceLimits = { pages: 16, bytes: 64 * 1024 * 1024, cells: 100000, changes: 5000, changedCells: 50000, inputBytes: 1024 * 1024 } as const;
export interface TableEditPage {
  index: number; info: TableInfo; page: TablePage; rows: DraftRow[]; history: DraftHistory;
  selection?: { rowId: string; key: string }; selected: ReadonlySet<string>; copied: Set<string>;
}
export interface TableEditNavigation { readonly epoch: object; readonly from: TableEditPage; readonly target: number | 'last'; readonly scope: string; }
export interface TableEditBatch { readonly rows: DraftRow[]; readonly pages: number; current(): boolean; }
export interface TableCheckedDeletion {
  readonly pages: readonly { index: number; count: number }[];
  current(): boolean;
  stage(): DraftRow[];
}

export interface TableCheckedFill {
  readonly context: RecordContext;
  readonly count: number;
  readonly groups: TableCheckedDeletion['pages'];
  readonly invalidated: boolean;
  invalidate(): void;
  reason(rows: DraftRow[], selected: ReadonlySet<string>, context: RecordContext): string;
  stage(assignments: readonly BatchFillAssignment[], rows: DraftRow[], selected: ReadonlySet<string>, context: RecordContext): { rows: DraftRow[]; changed: number };
}

/** 活动页使用实时勾选，后台页使用离页时登记的准确 UUID。 */
export function tableCheckedPageRows(page: TableEditPage, active: TableEditPage | undefined, activeSelected: ReadonlySet<string>): DraftRow[] {
  const checked = page === active ? activeSelected : page.selected;
  return checked.size ? page.rows.filter(row => checked.has(row.id) && !row.deleted) : [];
}
/** 不克隆原行或BLOB；原页、独立历史和准确页码只在本标签内存内保持。 */
export class TableEditWorkspace {
  private entries = new Map<number, TableEditPage>();
  private active?: TableEditPage;
  private scope?: string;
  private profile?: unknown;
  private metadata?: string;
  private signatures = new Map<TableEditPage, string>();
  private dead = false;
  private epoch: object = {};
  private pending?: TableEditNavigation;
  private restoredValue = false;
  private fallback = new DraftHistory();
  revision = 0;
  /** 原表页使用稳定历史端口；切回某页时恢复其原历史，不把另一页的撤销写入本页。 */
  readonly history: Pick<DraftHistory, keyof DraftHistory>;
  constructor(private readonly changed: () => void = () => {}) {
    const owner = this;
    this.history = {
      get generation() { return owner.currentHistory().generation; }, get status() { return owner.currentHistory().status; },
      get notice() { return owner.currentHistory().notice; }, set notice(value) { owner.currentHistory().notice = value; },
      retainedIds: () => owner.currentHistory().retainedIds(), clear: () => owner.currentHistory().clear(),
      record: (before, after) => owner.currentHistory().record(before, after), move: (rows, direction) => owner.currentHistory().move(rows, direction),
    };
  }
  /** 没有可保留来源时继续沿原单页历史，不擅自创建来源。 */
  private currentHistory(): DraftHistory { return this.active?.history ?? this.fallback; }
  get pages(): readonly TableEditPage[] { return [...this.entries.values()].sort((a,b) => a.index-b.index); }
  get generation(): object { return this.epoch; }
  get selected(): TableEditPage | undefined { return this.active; }
  get stale(): boolean { return this.dead; }
  get restored(): boolean { return this.restoredValue; }
  get dirty(): boolean { return this.pages.some(page => collectChanges(page.rows).length); }
  get protected(): boolean { return this.pages.some(page => collectChanges(page.rows).length || page.history.status.undo || page.history.status.redo); }
  get changeCount(): number { return this.pages.reduce((n,page) => n+collectChanges(page.rows).length,0); }
  /** 当前页数组尚未采用时不能把旧活动页混入；恢复文件等原单页来源另行显示。 */
  allRows(current: DraftRow[]): DraftRow[] { return this.active?.rows === current ? this.pages.flatMap(page => page.rows) : current; }
  /** 文件只保留有变化的原页分组；干净页、历史、选择和未暂存输入不写入文件。 */
  draftLayout(current: DraftRow[]): TableDraftWorkspace | undefined {
    if (!this.active || this.active.rows !== current) return;
    if (this.dead || this.pending) throw Error(text.stale);
    if (this.entries.size < 2 && !this.restoredValue) return;
    const pages = this.pages.map(page => ({ index: page.index, changes: collectChanges(page.rows).length })).filter(page => page.changes > 0);
    if (!pages.length) return;
    return { pageSize: this.active.page.pageSize, activePage: pages.some(page => page.index === this.active!.index) ? this.active.index : pages[0].index, pages };
  }
  /** 全部结构、行值和内存预算先通过才一次替换；原页号仅作分组，绝不补读服务器页面。 */
  restoreDraft(scope: string, profile: unknown, info: TableInfo, source: TableDraftDocument, newId: () => string): TableEditPage {
    if (this.protected || this.pending) throw Error(text.stale);
    const document = parseTableDraftDocument(source), layout = document.workspace;
    if (!layout) throw Error(text.stale);
    const rows = restoreTableDraftRows(document, info, newId);
    assertCopiedRecordKeys(rows, info, new Set(rows.filter(row => row.inserted).map(row => row.id)));
    let offset = 0;
    const entries: TableEditPage[] = layout.pages.map(group => {
      const selected = rows.slice(offset, offset += group.changes);
      return { index: group.index, info, page: { page: group.index, pageSize: layout.pageSize, hasMore: false, columns: info.columns.map(column => ({ key: column.name, name: column.name, type: column.type })), rows: selected.flatMap(row => row.original ? [row.original] : []), copyMetadataKey: document.metadataKey }, rows: selected, history: new DraftHistory(), selected: new Set(), copied: new Set(selected.filter(row => row.inserted).map(row => row.id)) };
    });
    this.budget(entries);
    this.clear(false); this.scope = scope; this.profile = profile; this.metadata = document.metadataKey; this.restoredValue = true;
    for (const entry of entries) { this.entries.set(entry.index, entry); this.signatures.set(entry, this.signature(entry)); }
    this.active = this.entries.get(layout.activePage)!; this.publish(); return this.active;
  }
  /** 恢复分组之间只切本地缓存；不接受伪造页对象、过期来源或普通服务器导航。 */
  selectRestored(entry: TableEditPage): void {
    if (!this.restoredValue || this.dead || this.pending || this.entries.get(entry.index) !== entry) throw Error(text.stale);
    this.active = entry; this.publish();
  }
  /** 条件／连接漂移保留脏稿墓碑；没有用户状态的缓存可以直接退出。 */
  observe(scope: string, profile: unknown): void {
    if (this.scope === undefined) return;
    if (scope !== this.scope || profile !== this.profile || this.pages.some(page => this.signature(page) !== this.signatures.get(page))) {
      if (this.protected || this.pending) this.dead = true; else this.clear(false);
    }
  }
  /** 同步订阅捕获目标／连接曾变化，A→B→A不能复活旧缓存。 */
  invalidate(): void { if (this.entries.size) { this.dead = true; this.epoch = {}; this.revision++; } this.pending = undefined; }
  private signature(entry: TableEditPage): string { return JSON.stringify([entry.index,entry.page.page,entry.page.pageSize,tableCopyMetadataKey(entry.info),entry.page.copyMetadataKey]); }
  private publish(): void { this.revision++; this.changed(); }
  private disposable(entry: TableEditPage): boolean { return !entry.selected.size && !collectChanges(entry.rows).length && !entry.history.status.undo && !entry.history.status.redo; }
  /** 原值预算按现有包装计内存，不先编码或深拷贝大字段；历史各页沿原8 MiB上限。 */
  private budget(pages: readonly { rows: DraftRow[] }[]): void {
    let bytes = 0, cells = 0;
    for (const page of pages) for (const row of page.rows) for (const values of [row.data,row.original]) if (values) {
      for (const [key,value] of Object.entries(values)) {
        cells++; bytes += 80 + key.length*2 + (typeof value === 'string' ? value.length*2 : value && typeof value === 'object' ? 64+value.base64.length*2 : 16);
        if (cells > tableEditWorkspaceLimits.cells || bytes > tableEditWorkspaceLimits.bytes) throw Error(text.limit);
      }
    }
  }
  /** 确认原来源后才准备切页，不修改当前草稿或历史；满额不先丢页再等读取。 */
  navigate(target: number | 'last', scope: string): TableEditNavigation {
    if (this.restoredValue || !this.active || this.dead || this.pending || scope !== this.scope || target !== 'last' && (!Number.isSafeInteger(target) || target < 1 || target === this.active.index)) throw Error(text.stale);
    const cached = target === 'last' ? undefined : this.entries.get(target);
    if (!cached && this.entries.size >= tableEditWorkspaceLimits.pages && !this.pages.some(page => this.disposable(page))) throw Error(text.limit);
    this.budget(this.pages);
    const ticket = Object.freeze({epoch:this.epoch,from:this.active,target,scope}); this.pending=ticket; return ticket;
  }
  /** 只有原导航和原条件可领取缓存；外部读取不能误消费前次的切页意图。 */
  navigation(target: number | 'last', scope: string): TableEditNavigation | undefined {
    const ticket=this.pending;if(!ticket)return;
    if(ticket.epoch!==this.epoch||ticket.from!==this.active||ticket.target!==target||ticket.scope!==scope||this.dead){this.pending=undefined;throw Error(text.stale);}return ticket;
  }
  cached(ticket: TableEditNavigation): TableEditPage | undefined { this.assertTicket(ticket); return ticket.target === 'last' ? undefined : this.entries.get(ticket.target); }
  private assertTicket(ticket: TableEditNavigation): void { if (this.pending !== ticket || ticket.epoch !== this.epoch || ticket.from !== this.active || this.dead) throw Error(text.stale); }
  /** 新数据先核全部保留页的结构及预算；失败保持原页。末页碰到缓存页时采用原缓存。 */
  adopt(scope: string, profile: unknown, info: TableInfo, page: TablePage, rows: DraftRow[], ticket?: TableEditNavigation): TableEditPage {
    if (ticket) this.assertTicket(ticket);
    if (info.objectKind !== 'table' || info.engine.toUpperCase() !== 'INNODB' || !info.editableKey.length) throw Error(text.stale);
    const metadata=tableCopyMetadataKey(info);
    if (ticket && (this.scope!==scope||this.profile!==profile||this.metadata!==metadata||page.pageSize!==ticket.from.page.pageSize||page.copyMetadataKey && page.copyMetadataKey!==metadata||ticket.target!=='last'&&ticket.target!==page.page)) { this.dead=true;throw Error(text.stale); }
    if (!ticket) this.clear(false);
    const existing=this.entries.get(page.page);
    if (existing) { this.active=existing; this.pending=undefined;this.publish();return existing; }
    const disposable=this.entries.size>=tableEditWorkspaceLimits.pages ? this.pages.find(entry=>this.disposable(entry)) : undefined;
    if(this.entries.size>=tableEditWorkspaceLimits.pages&&!disposable)throw Error(text.limit);
    if(ticket)this.budget([...this.pages.filter(entry=>entry!==disposable),{rows}]);
    if(disposable){this.entries.delete(disposable.index);this.signatures.delete(disposable);disposable.history.clear();}
    const entry:TableEditPage={index:page.page,info,page,rows,history:new DraftHistory(),selected:new Set(),copied:new Set()};
    this.scope=scope;this.profile=profile;this.metadata=metadata;this.entries.set(entry.index,entry);this.signatures.set(entry,this.signature(entry));this.active=entry;this.pending=undefined;this.publish();return entry;
  }
  /** 缓存采用也必须消费原导航；不调用任何数据库或刷新原值。 */
  select(ticket:TableEditNavigation,entry:TableEditPage):void{this.assertTicket(ticket);if(this.entries.get(entry.index)!==entry||ticket.target!==entry.index)throw Error(text.stale);this.active=entry;this.pending=undefined;this.publish();}
  /** 所有本地发布先验全组预算，再替换活动页，不接受在切页过程中改写离开页。 */
  update(before:DraftRow[],after:DraftRow[]):void{if(!this.active||this.active.rows!==before||before===after)return;if(this.dead||this.pending)throw Error(text.stale);if(this.entries.size>1)this.budget(this.pages.map(page=>({rows:page===this.active?after:page.rows})));this.active.rows=after;this.publish();}
  /** 精确记住UI选择及复制标记；UUID属于原页，不按主键猜另一页的焦点。 */
  remember(rows:DraftRow[],selected:ReadonlySet<string>,selection:TableEditPage['selection'],copied:Set<string>):void{if(this.active?.rows!==rows)return;this.active.selected=selected;this.active.selection=selection;this.active.copied=copied;}
  /** 两种跨页操作均绑定原页、勾选及历史代次，任何页变化都会撤销整组计划。 */
  private captureChecked(current: DraftRow[], activeSelected: ReadonlySet<string>) {
    const active = this.active, epoch = this.epoch, revision = this.revision;
    if (!active || active.rows !== current || this.dead || this.pending || this.restoredValue) throw Error(text.stale);
    const source = this.pages.map(page => {
      const selected = page === active ? activeSelected : page.selected;
      const ids = new Set(page.rows.map(row => row.id));
      if (selected.size && (ids.size !== page.rows.length || [...selected].some(id => !ids.has(id)))) throw Error(text.stale);
      const signature = this.signature(page);
      if (signature !== this.signatures.get(page)) throw Error(text.stale);
      return { page, rows: page.rows, history: page.history.generation, checked: page.selected, selected, ids: new Set(selected),
        signature, selectedRows: tableCheckedPageRows(page, active, activeSelected) };
    });
    const groups = source.filter(item => item.selectedRows.length);
    const stillChecked = (item: typeof source[number]) => {
      const rows = tableCheckedPageRows(item.page, active, activeSelected);
      return rows.length === item.selectedRows.length && rows.every((row, index) => row === item.selectedRows[index]);
    };
    const isCurrent = () => !this.dead && !this.pending && this.epoch === epoch && this.revision === revision &&
      this.active === active && source.every(item => this.entries.get(item.page.index) === item.page &&
        item.page.rows === item.rows && item.page.history.generation === item.history && item.page.selected === item.checked &&
        this.signature(item.page) === item.signature && item.selected.size === item.ids.size && [...item.selected].every(id => item.ids.has(id)) &&
        stillChecked(item));
    return { active, source, groups, isCurrent, counts: groups.map(item => ({ index: item.page.index, count: item.selectedRows.length })) };
  }
  /** 先校验全部修改和各页撤销预算，再一次发布；同一原定位不能跨页重复暂存。 */
  planCheckedDeletion(current: DraftRow[], activeSelected: ReadonlySet<string>): TableCheckedDeletion {
    const { active, source, groups, isCurrent, counts } = this.captureChecked(current, activeSelected);
    if (!groups.some(item => item.page !== active)) throw Error(text.deleteNone);
    const plans = groups.map(item => {
      const targets = new Set(item.selectedRows);
      const next = item.rows.map(row => targets.has(row) ? { ...row, deleted: true } : row);
      let bytes = 128;
      for (const [index, row] of item.rows.entries()) {
        if (row !== next[index]) bytes += changedDraftHistoryBytes(row, next[index], draftHistoryLimits.bytes);
        if (bytes > draftHistoryLimits.bytes) throw Error(text.deleteHistoryLimit);
      }
      return { ...item, next };
    });
    const changed = new Map(plans.map(item => [item.page, item.next]));
    this.validateChanges(source.flatMap(item => changed.get(item.page) ?? item.rows), active.info.editableKey);
    return {
      pages: counts,
      current: isCurrent,
      stage: () => {
        if (!isCurrent()) throw Error(text.stale);
        for (const { page, rows, next } of plans) {
          page.history.record(rows, next);
          page.rows = next;
          page.selected = new Set();
        }
        this.publish();
        return active.rows;
      },
    };
  }
  /** 复用原批量填充输入及完整值校验，整个选区只暂存一次，各页分别记录撤销。 */
  planCheckedFill(current: DraftRow[], activeSelected: ReadonlySet<string>, context: RecordContext): TableCheckedFill {
    const { active, source, groups, isCurrent, counts } = this.captureChecked(current, activeSelected);
    if (!groups.some(item => item.page !== active)) throw Error(text.fillNone);
    const target = recordTargetKey(context.target), budget = { rows: 0, cells: 0, bytes: 2 };
    if (context.info !== active.info) throw Error(text.stale);
    const pages = groups.map(item => new BatchFillIntent(item.rows, item.selected, { ...context, info: item.page.info },
      { page: item.page.page, target, connectionVersion: context.connectionVersion, generation: context.generation }, item.page.page, budget));
    const chosen = groups.flatMap(item => item.selectedRows), ids = new Set(chosen.map(row => row.id));
    if (ids.size !== chosen.length) throw Error(text.stale);
    let stopped = false;
    const reason: TableCheckedFill['reason'] = (rows, selected, live) => {
      if (stopped) return text.stale;
      if (rows !== current || selected !== activeSelected || !isCurrent() || recordReadonlyReason(live) ||
        live.info !== active.info || live.connectionVersion !== context.connectionVersion || live.generation !== context.generation ||
        recordTargetKey(live.target) !== target) {
        stopped = true;
        return text.stale;
      }
      for (const intent of pages) {
        const invalid = intent.reason(intent.rows, intent.selected, intent.context, intent.binding, intent.page);
        if (invalid) { stopped = true; return invalid; }
      }
      return '';
    };
    return {
      context, groups: counts, count: chosen.length,
      get invalidated() { return stopped; },
      invalidate: () => { stopped = true; },
      reason,
      stage: (assignments, rows, selected, live) => {
        const invalid = reason(rows, selected, live);
        if (invalid) throw Error(invalid);
        const filled = prepareBatchFill(assignments, chosen, ids, live);
        const replacements = new Map<DraftRow, DraftRow>();
        for (const [index, row] of chosen.entries()) if (filled[index] !== row) replacements.set(row, filled[index]);
        const plans = groups.flatMap(item => {
          if (!item.selectedRows.some(row => replacements.has(row))) return [];
          return [{ ...item, next: item.rows.map(row => replacements.get(row) ?? row) }];
        });
        const byPage = new Map(plans.map(item => [item.page, item.next]));
        const updated = source.map(item => ({ rows: byPage.get(item.page) ?? item.rows }));
        this.validateChanges(updated.flatMap(item => item.rows), active.info.editableKey);
        this.budget(updated);
        stopped = true;
        for (const { page, rows, next } of plans) {
          page.history.record(rows, next);
          page.rows = next;
        }
        if (plans.length) this.publish();
        return { rows: active.rows, changed: replacements.size };
      },
    };
  }
  /** 多页只聚合变化，原始行仍属于各自缓存；同一原定位出现两次必须拒绝。 */
  batch(current:DraftRow[]):TableEditBatch|undefined{
    if(this.dead)throw Error(text.stale);
    if(this.pages.length<2)return;
    if(this.dead||this.pending||this.active?.rows!==current)throw Error(text.stale);
    const entries=this.pages,captured=entries.map(page=>({page,rows:page.rows,history:page.history.generation,signature:this.signature(page)})),epoch=this.epoch,active=this.active;
    const rows=entries.flatMap(page=>page.rows);if(!this.validateChanges(rows,this.active.info.editableKey))return;
    return{rows,pages:entries.filter(page=>collectChanges(page.rows).length).length,current:()=>!this.dead&&!this.pending&&this.epoch===epoch&&this.active===active&&this.entries.size===captured.length&&captured.every(item=>this.entries.get(item.page.index)===item.page&&item.page.rows===item.rows&&item.page.history.generation===item.history&&this.signature(item.page)===item.signature)};
  }
  private validateChanges(rows: DraftRow[], editableKey: readonly string[]): number {
    const changes = collectChanges(rows);
    if(changes.length>tableEditWorkspaceLimits.changes)throw Error(text.limit);
    let cells=0,bytes=2;const identities=new Set<string>();
    for(const change of changes){
      if(change.kind!=='insert'){
        const key=JSON.stringify(editableKey.map(name=>{const value=change.before[name];if(value===undefined||value===null)throw Error(text.stale);return value;}));
        if(identities.has(key))throw Error(text.overlap);identities.add(key);
      }
      if(change.kind!=='delete'){assertRecordBatchFields(change.values);for(const[key,value]of Object.entries(change.values)){if(++cells>tableEditWorkspaceLimits.changedCells)throw Error(text.limit);bytes+=recordBatchCellBytes(key)+recordBatchCellBytes(value)+4;if(bytes>tableEditWorkspaceLimits.inputBytes)throw Error(text.limit);}}
    }
    return changes.length;
  }
  /** 投递开始清除全部页历史，回滚留草稿、未知由父提交保护锁全组。 */
  clearHistory():void{for(const page of this.pages)page.history.clear();this.fallback.clear();}
  /** 失败只撤销原导航，保持完整原页；旧失败不能取消后来意图。 */
  fail(ticket:TableEditNavigation):void{if(this.pending===ticket){this.pending=undefined;this.publish();}}
  /** 明确放弃后台页不读库；当前页由父页安排准确读取。未知／在途由父门统一阻止。 */
  discard(entry:TableEditPage):boolean{if(this.pending||this.entries.get(entry.index)!==entry)return false;this.entries.delete(entry.index);this.signatures.delete(entry);entry.history.clear();if(this.active===entry)this.active=this.pages[0];if(!this.entries.size)this.clear(false);this.publish();return true;}
  /** 成功采用新读取／明确放弃／卸载才清空全部页；不持久化行值或自动重放。 */
  clear(notify=true):void{this.clearHistory();this.entries.clear();this.signatures.clear();this.active=undefined;this.scope=undefined;this.profile=undefined;this.metadata=undefined;this.dead=false;this.restoredValue=false;this.pending=undefined;this.epoch={};if(notify)this.publish();}
}
