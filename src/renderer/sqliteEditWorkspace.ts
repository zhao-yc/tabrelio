import type { SqliteTablePage } from '../shared/sqliteTableBrowse';
import { sqliteTableEditLimits, sqliteTableEditPreviewSchema, type SqliteTableEditPreviewInput, type SqliteTableEditOutcome, type SqliteTableChange } from '../shared/sqliteTableEdit';
import type { SqliteTableQuery } from './sqliteTableBrowser';
import type { SqliteDraftRow, SqliteTableEditor } from './sqliteTableEditor';
import { prepareSqliteDuplicate, sqliteDuplicateSourceCurrent } from './sqliteTableDuplicate';
import { prepareSqliteFill, sqliteFillSourceCurrent, sqliteFillSourceLimits, type SqliteFillField } from './sqliteTableFill';
import { sqliteEditWorkspaceZh as text } from './locales/sqliteEditWorkspace.zh-CN';
export interface SqliteEditBatch { input: Omit<SqliteTableEditPreviewInput, 'taskId'>; current(): boolean; }
export interface SqliteWorkspaceFill {
  readonly page: SqliteTablePage;
  readonly pages: readonly { index: number; count: number }[];
  readonly count: number;
  readonly allNew: boolean;
  current(): boolean;
  stage(fields: readonly SqliteFillField[]): number;
}
interface PageChecks { revision: object; ids: ReadonlySet<string>; }
interface Entry { editor: SqliteTableEditor; page: SqliteTablePage; key: string; signature: string; checks?: PageChecks; }
interface Ports { now(): number; changed(): void; forgotten(page: SqliteTablePage): void; }
/** 同一已应用查询的有界原页账本；不接管数据库任务，不用页行号跨快照查找记录。 */
export class SqliteEditWorkspace {
  private entries = new Map<string, Entry>();
  private query?: SqliteTableQuery; private queryKey = ''; private scopeKey = ''; private dead = false;
  private selected?: SqliteTableEditor;
  private selectionRevision: object = {};
  unknown = false;
  restored = false;
  constructor(private readonly ports: Ports) {}
  private key(page: Pick<SqliteTablePage, 'offset' | 'limit'>): string { return page.offset + ':' + page.limit; }
  /** 只比目标和编辑元数据；原行大值仍由各准确Editor持有，不为切页序列化大BLOB。 */
  private signature(page: SqliteTablePage): string { const edit = page.edit; return JSON.stringify([page.target, page.schemaKey, page.offset, page.limit, page.columns, page.relation ?? null, edit?.kind === 'editable' ? [edit.snapshotId,edit.expiresAt,edit.columns,edit.locator,edit.copy?.rowidAlias] : null]); }
  private scope(page: SqliteTablePage): string { const edit=page.edit;return JSON.stringify([page.target,page.schemaKey,page.columns,page.relation??null,edit?.kind==='editable'?[edit.columns,edit.locator,edit.copy?.rowidAlias]:null]); }
  /** 查询对象和实际内容都固定；观察漂移后相同对象恢复也不能复活旧账本。 */
  current(query = this.query): boolean {
    if(this.dead)return false;
    try { if(this.query && (query!==this.query||JSON.stringify(query)!==this.queryKey))this.dead=true;for(const entry of this.entries.values())if(entry.editor.page!==entry.page||this.signature(entry.page)!==entry.signature)this.dead=true; } catch {this.dead=true;}
    return !this.dead;
  }
  get pages(): readonly SqliteTableEditor[] { return [...this.entries.values()].map(entry=>entry.editor); }
  has(editor: SqliteTableEditor): boolean { return [...this.entries.values()].some(entry=>entry.editor===editor); }
  isActive(editor: SqliteTableEditor): boolean { return this.selected===editor&&this.has(editor); }
  get dirty(): boolean { return this.unknown||this.pages.some(editor=>editor.dirty); }
  get protected(): boolean { return this.dirty||this.pages.some(editor=>editor.view.undo||editor.view.redo); }
  get busy(): boolean { return this.pages.some(editor=>editor.busy); }
  get changes(): number { return this.pages.reduce((sum,editor)=>sum+editor.changes.length,0); }
  /** 只淘汰离开后无需保留的干净页，不丢输入、修改或撤销／重做历史，不静默丢弃用户历史。 */
  private disposable(entry: Entry): boolean { const view=entry.editor.view;return !this.checkedIds(entry.editor)?.size&&!entry.editor.dirty&&!entry.editor.busy&&!view.undo&&!view.redo; }
  capacity(query: SqliteTableQuery, leaving?: SqliteTableEditor): void { if(this.restored||!this.current(query)||this.unknown)throw Error(this.unknown?text.unknown:text.stale);if(this.entries.size>=sqliteTableEditLimits.pages&&![...this.entries.values()].some(entry=>this.disposable(entry)||entry.editor===leaving&&!this.checkedIds(entry.editor)?.size&&!entry.editor.changes.length&&!entry.editor.busy&&!entry.editor.view.undo&&!entry.editor.view.redo&&!entry.editor.view.unknown))throw Error(text.limit); }
  /** 已采用页只在元数据相容时登记；后端保有真实文件与schema_version的最终裁决。 */
  add(editor: SqliteTableEditor,query: SqliteTableQuery): void {
    const page=editor.page;if(page.edit?.kind!=='editable'||!this.current(this.query?query:undefined)||this.unknown||this.entries.has(this.key(page)))throw Error(text.stale);
    const scope=this.scope(page);if(this.query&&(query!==this.query||scope!==this.scopeKey))throw Error(text.stale);
    if(this.entries.size>=sqliteTableEditLimits.pages){const unused=[...this.entries.values()].find(entry=>this.disposable(entry));if(!unused)throw Error(text.limit);this.entries.delete(unused.key);unused.editor.dispose();this.ports.forgotten(unused.page);}
    if(!this.query){this.query=query;this.queryKey=JSON.stringify(query);this.scopeKey=scope;}
    this.entries.set(this.key(page),{editor,page,key:this.key(page),signature:this.signature(page)});this.select(editor);
  }
  /** 恢复编辑器全部构造成功后原子替换；同组每页独享新能力和历史，不进行服务器读取。 */
  checkRestored(editors: readonly SqliteTableEditor[], query: SqliteTableQuery): void {
    if (this.protected || this.busy || !editors.length || editors.length > sqliteTableEditLimits.pages) throw Error(text.stale);
    const keys = new Set<string>(), scope = this.scope(editors[0].page);
    for (const editor of editors) { const page = editor.page, key = this.key(page); if (page.edit?.kind !== 'editable' || keys.has(key) || this.scope(page) !== scope || page.limit !== query.limit) throw Error(text.stale); keys.add(key); }
  }
  /** 校验与发布之间无异步边界，旧缓存仅在完整组准备完成后释放。 */
  restore(editors: readonly SqliteTableEditor[], query: SqliteTableQuery): void {
    this.checkRestored(editors, query); const scope = this.scope(editors[0].page);
    this.clear(false); this.query = query; this.queryKey = JSON.stringify(query); this.scopeKey = scope; this.restored = true;
    for (const editor of [...editors].sort((a,b) => a.page.offset-b.page.offset)) { const page = editor.page, key = this.key(page); this.entries.set(key, { editor, page, key, signature: this.signature(page) }); }
    this.selected = editors[0]; this.ports.changed();
  }
  /** 返回准确缓存页，不按相同offset重新生成Editor或原值；失效页明确拒绝重新编辑。 */
  cached(offset:number,query:SqliteTableQuery):SqliteTableEditor|undefined {if(!this.current(query)||this.unknown)throw Error(this.unknown?text.unknown:text.stale);const editor=this.entries.get(offset+':'+query.limit)?.editor;if(editor){editor.observe();if(!editor.view.valid||editor.view.unknown)throw Error(text.stale);}return editor;}
  select(editor:SqliteTableEditor):void{if(!this.has(editor))throw Error(text.stale);this.selected=editor;this.selectionRevision={};this.ports.changed();}
  /** 逐页观察连接／结构墓碑，后台页变化也更新标签dirty与预览资格。 */
  observe():void{this.current();for(const editor of this.pages)editor.observe();}
  /** 勾选只记在准确编辑器和行数组上，刷新、改草稿或恢复文件不会迁移同名 UUID。 */
  rememberChecks(editor: SqliteTableEditor, rows: readonly SqliteDraftRow[], selected: readonly SqliteDraftRow[]): void {
    const entry = this.entries.get(this.key(editor.page));
    if (this.restored || this.dead || this.selected !== editor || entry?.editor !== editor || editor.view.rows !== rows) return;
    const ids = new Set(selected.map(row => row.id));
    if (ids.size !== selected.length || selected.some(row => row.deleted || !rows.includes(row))) return;
    entry.checks = ids.size ? { revision: editor.rowsRevision, ids } : undefined;
  }
  checkedIds(editor: SqliteTableEditor): ReadonlySet<string> | undefined {
    const entry = this.entries.get(this.key(editor.page));
    if (!this.dead && !this.unknown && !this.restored && entry?.editor === editor && entry.checks?.revision === editor.rowsRevision && editor.view.valid)
      return entry.checks.ids;
  }
  /** 跨页操作均绑定勾选、原快照和编辑器代次；填充可独占活动页的输入门。 */
  private captureChecked(actor: SqliteTableEditor, allowActorInput = false) {
    this.observe();
    if (this.restored || this.unknown || !this.isActive(actor) || !actor.canEdit() || !this.current()) throw Error(text.stale);
    const revision = this.selectionRevision;
    const source = [...this.entries.values()].map(entry => {
      const { editor } = entry, view = editor.view;
      const ids = this.checkedIds(editor);
      const required = editor === actor || entry.checks?.revision === editor.rowsRevision || editor.changes.length > 0;
      if (editor.hasInput && !(allowActorInput && editor === actor) || view.busy || view.preview || required && (!view.valid || view.unknown))
        throw Error(text.stale);
      return { entry, editor, rows: view.rows, generation: editor.generation, checks: entry.checks, ids, required };
    });
    const targets = source.filter(item => item.ids?.size).sort((left, right) => left.entry.page.offset - right.entry.page.offset);
    const pages = targets.map(({ entry, ids }) => ({ index: Math.floor(entry.page.offset / entry.page.limit) + 1, count: ids!.size }));
    const current = () => this.current() && !this.unknown && !this.restored && this.selectionRevision === revision &&
      this.isActive(actor) && this.entries.size === source.length && source.every(({ entry, editor, rows, generation, checks, required }) =>
        this.entries.get(entry.key) === entry && editor.view.rows === rows && editor.generation === generation && entry.checks === checks &&
        (!required || entry.page.edit?.kind === 'editable' && this.ports.now() < Date.parse(entry.page.edit.expiresAt)));
    return { source, targets, pages, current };
  }
  /** 暂存前用真正的多页预览合同校验合计变化，包含未勾选的已有草稿。 */
  private validateCheckedChanges(editors: readonly SqliteTableEditor[], changed: ReadonlyMap<SqliteTableEditor, readonly SqliteTableChange[]>): void {
    const [primary, ...additionalPages] = editors.flatMap(editor => {
      const changes = changed.get(editor) ?? editor.changes, edit = editor.page.edit;
      return changes.length && edit?.kind === 'editable' ? [{ snapshotId: edit.snapshotId, changes }] : [];
    });
    if (primary) sqliteTableEditPreviewSchema.parse({ ...primary, taskId: 'sqlite-workspace-checks',
      ...(additionalPages.length ? { additionalPages } : {}) });
  }
  /** 全部原页通过后先静默暂存，再发布各页通知。复核期间旧确认不得认领后来勾选。 */
  planCheckedDeletion(actor: SqliteTableEditor) {
    const { source, targets, pages, current } = this.captureChecked(actor);
    if (!targets.some(item => item.editor !== actor)) throw Error(text.deleteNone);
    const plans = targets.map(item => ({ ...item, plan: item.editor.prepareRemoveRows([...item.ids!], true) }));
    this.validateCheckedChanges(source.map(item => item.editor), new Map(plans.map(({ editor, plan }) => [editor, plan.changes])));
    return {
      pages, current,
      stage: () => {
        if (!current() || !actor.canEdit()) throw Error(text.stale);
        for (const { plan } of plans) plan.check();
        if (!current()) throw Error(text.stale);
        for (const { entry, plan } of plans) { plan.stage(); entry.checks = undefined; }
        for (const { plan } of plans) plan.publish();
      },
    };
  }
  /** 先冻结原值和新增计划；所有页及合计预算通过后才一次发布，副本仍归所属原页。 */
  planCheckedDuplication(actor: SqliteTableEditor, newId: () => string) {
    const { source, targets, pages, current } = this.captureChecked(actor);
    if (!targets.some(item => item.editor !== actor)) throw Error(text.duplicateNone);
    const count = pages.reduce((total, group) => total + group.count, 0);
    if (count + this.changes > sqliteTableEditLimits.changes) throw Error(text.duplicateLimit);
    const keys = new Set<string>();
    const plans = targets.map(item => {
      const { editor, rows } = item, edit = editor.page.edit;
      if (edit?.kind !== 'editable' || !edit.copy || edit.copy.rowKeys.length !== edit.rows.length) throw Error(text.stale);
      const rowKeys = edit.copy.rowKeys;
      const ids = new Set(item.ids), selected = rows.filter(row => ids.has(row.id));
      if (selected.length !== ids.size) throw Error(text.stale);
      const copies = selected.map(row => {
        const key = row.index === undefined ? undefined : rowKeys[row.index];
        if (!key || !/^[a-f0-9]{64}$/.test(key) || row.deleted) throw Error(text.duplicateOriginal);
        if (keys.has(key)) throw Error(text.duplicateOverlap);
        keys.add(key);
        return { key, index: row.index!, copy: prepareSqliteDuplicate(editor.page, rows, row, newId(), true) };
      });
      return { ...item, ids, copies, rowKeys, plan: editor.prepareAppendRows(copies.map(item => item.copy.row.values), true) };
    });
    this.validateCheckedChanges(source.map(item => item.editor), new Map(plans.map(({ editor, plan }) => [editor, plan.changes])));
    let consumed = false;
    const stillCurrent = () => {
      if (consumed || !current() || plans.some(({ editor, rows, copies, ids, checks, rowKeys }) =>
        checks!.ids.size !== ids.size || [...ids].some(id => !checks!.ids.has(id)) ||
        editor.page.edit?.kind !== 'editable' || editor.page.edit.copy?.rowKeys !== rowKeys ||
        copies.some(({ key, index, copy }) => rowKeys[index] !== key || !sqliteDuplicateSourceCurrent(copy, editor.page, rows)))) {
        consumed = true;
        return false;
      }
      return true;
    };
    return {
      pages, count, current: stillCurrent,
      stage: () => {
        if (!stillCurrent() || !actor.canEdit()) throw Error(text.stale);
        for (const { plan } of plans) plan.check();
        if (!stillCurrent()) throw Error(text.stale);
        consumed = true;
        for (const { entry, editor, ids, plan } of plans) {
          plan.stage();
          // 新增不会改变原勾选行身份，显式续绑到本次发布后的代次。
          entry.checks = { revision: editor.rowsRevision, ids };
        }
        for (const { plan } of plans) plan.publish();
      },
    };
  }
  /** 捕获各页完整值并冻结输入范围，只有所有页和合计预算通过后才更新各页历史。 */
  planCheckedFill(actor: SqliteTableEditor): SqliteWorkspaceFill {
    const captured = this.captureChecked(actor, true);
    if (!captured.targets.some(item => item.editor !== actor)) throw Error(text.fillNone);
    const count = captured.pages.reduce((sum, group) => sum + group.count, 0);
    if (count > sqliteFillSourceLimits.rows) throw Error(text.fillLimit);
    const sourceBudget = { bytes: 0 };
    const targets = captured.targets.map(item => {
      const ids = new Set(item.ids);
      const selected = item.rows.filter(row => ids.has(row.id));
      if (selected.length !== ids.size) throw Error(text.stale);
      return { ...item, ids, source: prepareSqliteFill(item.entry.page, item.rows, selected, sourceBudget) };
    });
    let stopped = false;
    const current = () => {
      if (stopped || !captured.current() || targets.some(item => item.checks!.ids.size !== item.ids.size ||
        [...item.ids].some(id => !item.checks!.ids.has(id)) || !sqliteFillSourceCurrent(item.source, item.entry.page, item.rows))) {
        stopped = true;
        return false;
      }
      return true;
    };
    return {
      page: actor.page, pages: captured.pages, count, allNew: targets.every(item => item.source.allNew), current,
      stage: fields => {
        if (!current() || !actor.canEdit()) throw Error(text.stale);
        if (!Array.isArray(fields) || !fields.length || fields.length * count > sqliteTableEditLimits.cells) throw Error(text.fillLimit);
        const budget = { units: 0 };
        const plans = targets.flatMap(item => {
          const plan = item.editor.prepareFillRows([...item.ids], fields, { source: item.source, budget });
          return plan ? [{ ...item, plan }] : [];
        });
        this.validateCheckedChanges(captured.source.map(item => item.editor), new Map(plans.map(({ editor, plan }) => [editor, plan.changes])));
        for (const { plan } of plans) plan.check();
        if (!current()) throw Error(text.stale);
        stopped = true;
        for (const { entry, editor, plan, ids } of plans) {
          plan.stage();
          // 填充保留原行身份，只有此处经过整组复核后可将勾选绑定到新代次。
          entry.checks = { revision: editor.rowsRevision, ids };
        }
        for (const { plan } of plans) plan.publish();
        return plans.reduce((sum, item) => sum + item.plan.count, 0);
      },
    };
  }
  /** 聚合全部dirty页；每条原row仍属自己的snapshot，旧回包须核准确页集合和各页rows数组。 */
  batch(actor:SqliteTableEditor):SqliteEditBatch|undefined {
    this.observe();if(!this.isActive(actor)||!this.current()||this.unknown||this.pages.some(editor=>editor.hasInput||editor.busy||(editor===actor||editor.changes.length>0)&&(!editor.view.valid||editor.view.unknown)))throw Error(text.stale);
    const captured=this.pages.map(editor=>({editor,rows:editor.view.rows,signature:this.signature(editor.page),required:editor===actor||editor.changes.length>0})),groups=captured.filter(item=>item.editor.changes.length).map(item=>({snapshotId:item.editor.page.edit!.kind==='editable'?item.editor.page.edit!.snapshotId:'',changes:item.editor.changes}));
    if(!groups.length)return;
    const [primary,...additionalPages]=groups;
    return{input:{...primary,...(additionalPages.length?{additionalPages}:{})},current:()=>this.current()&&!this.unknown&&this.isActive(actor)&&captured.length===this.entries.size&&captured.every(item=>this.has(item.editor)&&(!item.required||item.editor.view.valid&&!item.editor.view.unknown)&&item.editor.view.rows===item.rows&&this.signature(item.editor.page)===item.signature&&(!item.required||item.editor.page.edit?.kind==='editable'&&this.ports.now()<Date.parse(item.editor.page.edit.expiresAt)))};
  }
  /** 任何已发送未知结果锁住全组，不能切换到另一页重试相同草稿。 */
  settled(actor:SqliteTableEditor,outcome:SqliteTableEditOutcome['outcome']):void{if(this.has(actor)&&outcome==='unknown'){this.unknown=true;this.ports.changed();}}
  /** 明确放弃一个准确原页；输入、预览或在途事务存在时不允许拆组，未知结果不能借移页解锁。 */
  discardPage(editor: SqliteTableEditor): boolean {
    const entry = [...this.entries.values()].find(item => item.editor === editor);
    if (!entry || this.unknown || this.pages.some(item => item.busy || item.hasInput || item.view.preview || item.view.unknown)) return false;
    this.entries.delete(entry.key);
    if (this.selected === editor) this.selected = undefined;
    editor.dispose(); this.ports.forgotten(entry.page);
    // 最后一页明确放弃后允许建立全新来源；有剩余页时保持旧账本及失效墓碑。
    if (!this.entries.size) { this.query = undefined; this.queryKey = ''; this.scopeKey = ''; this.dead = false; this.restored = false; }
    this.ports.changed(); return true;
  }
  /** 明确放弃／成功提交／卸载才释放所有已采用页，各Editor自行等待准确在途终态。 */
  clear(notify=true):void{const entries=[...this.entries.values()];this.entries.clear();this.selected=undefined;this.query=undefined;this.queryKey='';this.scopeKey='';this.dead=false;this.unknown=false;this.restored=false;for(const entry of entries){entry.editor.dispose();this.ports.forgotten(entry.page);}if(notify)this.ports.changed();}
}
