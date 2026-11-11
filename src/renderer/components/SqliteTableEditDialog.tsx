import { sqliteRecordBatchZh as batchText } from '../locales/sqliteRecordBatch.zh-CN';
import { sqliteEditWorkspaceZh as workspaceText } from '../locales/sqliteEditWorkspace.zh-CN';
import { SqliteRecordTree } from './SqliteRecordTree';
import { sqliteRecordTreeZh as treeText } from '../locales/sqliteRecordTree.zh-CN';
import { beginSqliteRecordJson, readSqliteRecordJson, sqliteRecordJsonBudget, type SqliteRecordJsonInput } from '../sqliteRecordJson';
import { sqliteRecordJsonZh as jsonText } from '../locales/sqliteRecordJson.zh-CN';
import { BoundedRecordTextarea } from './BoundedRecordTextarea';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { sqliteEditValueSchema, type SqliteOriginalValue } from '../../shared/sqliteTableEdit';
import type { SqliteTablePage } from '../../shared/sqliteTableBrowse';
import type { SqliteDraftRow, SqliteEditView } from '../sqliteTableEditor';
import { sqliteTableEditZh as text } from '../locales/sqliteTableEdit.zh-CN';
import { cellPreview, errorMessage } from '../lib';
import { recordValueSummary } from '../recordViews';
import { RecordBoundaryButton, RecordNavigator, type useRecordNavigator } from './RecordNavigator';
import { recordNavigatorZh as navigatorText } from '../locales/recordNavigator.zh-CN';
import { ErrorBox, Modal, Spinner } from './ui';
import { recordTemporalSpec } from '../recordTemporal';
import { RecordTemporalControls } from './RecordTemporalControls';
import { SqliteBinaryField } from './SqliteBinaryField';
import { HtmlCellPreviewToggle } from './HtmlCellPreview';
import { sqliteBinaryInputHex } from '../sqliteBinaryInput';

interface FieldDraft { include: boolean; kind: SqliteOriginalValue['kind']; value: string; changed: boolean; }
interface RecordNavigation {
  ownerId: string;
  previous: boolean;
  next: boolean;
  pagePrevious?: boolean;
  pageNext?: boolean;
  move(direction: -1 | 1, values?: (SqliteOriginalValue | undefined)[]): boolean;
  records?: {
    state: ReturnType<typeof useRecordNavigator>;
    rows: readonly SqliteDraftRow[];
    select(index: number, values?: (SqliteOriginalValue | undefined)[]): boolean;
  };
}

/** 摘要保留 SQLite 整数和 REAL 原文，大 BLOB 只取固定长度的十六进制前缀。 */
function recordSummary(value: SqliteOriginalValue | undefined): string {
  if (value?.kind === 'blob') return cellPreview('0x' + value.value.slice(0, 120), 100);
  return recordValueSummary(value?.kind === 'null' ? null : value?.value);
}
/** 编辑输入保持原动态类型；未触碰的非有限原 REAL 只保留，不重新解析或偷偷转换。 */
export function SqliteTableValueDialog({ ticket, page, row, column, initialFocus, duplicate = false, duplicateOwner, duplicatePosition, navigation, batch, current, onSave, onClose }: { ticket: object; page: SqliteTablePage; row: SqliteDraftRow; column?: number; initialFocus?: string; duplicate?: boolean; duplicateOwner?: string; duplicatePosition?: string; navigation?: RecordNavigation; batch?: { ownerId: string; position: number; count: number; sourcePage?: number; groups?: readonly { index: number; count: number }[] }; current(): boolean; onSave(values: (SqliteOriginalValue | undefined)[]): boolean; onClose(): void }) {
  const owner = useRef({ ticket, page, row, column, duplicate, duplicateOwner, duplicatePosition, navigation, batch, current, onSave, onClose }).current;
  const renderTicket = {}, committed = useRef<object | undefined>(undefined);
  useLayoutEffect(() => { committed.current = renderTicket; return () => { if (committed.current === renderTicket) committed.current = undefined; }; });
  const [fields, setFields] = useState<FieldDraft[]>(() => row.values.map((value, index) => { const original = duplicate && page.edit?.kind === 'editable' && page.edit.columns[index]?.generated ? undefined : value; return { include: original !== undefined, kind: original?.kind ?? 'text', value: original && original.kind !== 'null' ? original.value : '', changed: false }; }));
  const live = useRef(fields); live.current = fields; const closed = useRef(false), saving = useRef(false), duplicateSource = useRef(!duplicate || row.index === undefined);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'form' | 'json' | 'tree'>('form'), [json, setJson] = useState<{ input: SqliteRecordJsonInput; text: string } | null>(null);
  type TreeDraft = { values: readonly (SqliteOriginalValue | undefined)[]; revision: number };
  const [tree, setTree] = useState<TreeDraft>(), treeRef = useRef(tree); treeRef.current = tree;
  const [treePending, setTreePending] = useState(false), pendingTreeRef = useRef<{ source: TreeDraft; token: object } | undefined>(undefined);
  const modeRef = useRef(mode), jsonRef = useRef(json); modeRef.current = mode; jsonRef.current = json;
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!initialFocus) return;
    const label = text.value(initialFocus);
    const field = Array.from(content.current?.querySelectorAll<HTMLElement>('textarea, input') ?? [])
      .find(value => value.getAttribute('aria-label') === label && !value.hasAttribute('disabled'));
    field?.focus({ preventScroll: true }); field?.scrollIntoView({ block: 'center' });
  }, [initialFocus]);
  const columns = owner.page.edit?.kind === 'editable' ? owner.page.edit.columns : [];
  const records = navigation?.records;
  const activeRecord = records?.rows.indexOf(owner.row) ?? -1;
  const existingRecord = (item: SqliteDraftRow) => item.index !== undefined && !item.deleted;
  const lastRecord = records?.rows.reduce((last, item, index) => existingRecord(item) ? index : last, -1) ?? -1;
  /** 即使误用相同组件 key，来源变化也永久拒绝旧字段与回调；关闭同样受原输入票据约束。 */
  const invalid = useRef(false); if (owner.ticket !== ticket || owner.page !== page || owner.row !== row || owner.column !== column || owner.duplicate !== duplicate || owner.duplicateOwner !== duplicateOwner || owner.duplicatePosition !== duplicatePosition || owner.batch?.ownerId !== batch?.ownerId || owner.batch?.position !== batch?.position || owner.batch?.count !== batch?.count || owner.batch?.groups !== batch?.groups || owner.batch?.sourcePage !== batch?.sourcePage) invalid.current = true;
  // 复制模式只拥有独立的新行草稿；观察到existing index后不因恢复undefined复活保存权。
  function duplicateCurrent(): boolean { if (owner.duplicate && owner.row.index !== undefined) duplicateSource.current = false; return duplicateSource.current; }
  duplicateCurrent();
  function localCurrent(): boolean { return !invalid.current && !closed.current && committed.current === renderTicket && live.current === fields && modeRef.current === mode && jsonRef.current === json && treeRef.current === tree; }
  function close(): void { if (!localCurrent() || saving.current) return; closed.current = true; owner.onClose(); }
  const changed = fields.some(field => field.changed) || mode === 'json' && !!json && json.text !== json.input.initial || mode === 'tree' && !!tree && tree.values.some((value, index) => !sameInputValue(value, owner.row.values[index]));
  /** 比较typed原值而不序列化整行；大BLOB摘要和dirty判断均不额外分配完整JSON。 */
  function sameInputValue(left: SqliteOriginalValue | undefined, right: SqliteOriginalValue | undefined): boolean {
    return left === undefined || right === undefined ? left === right : left.kind === right.kind && (left.kind === 'null' || right.kind !== 'null' && left.value === right.value);
  }
  /** 两种界面只编译同一行本地输入；生成列保持原值，复制的新行继续省略生成列。 */
  function inputValues(): (SqliteOriginalValue | undefined)[] {
    if (mode === 'tree') { if (!tree || treeRef.current !== tree) throw Error(treeText.stale); return [...tree.values]; }
    if (mode === 'json') { if (!json) throw Error(jsonText.invalid); return readSqliteRecordJson(json.input, json.text); }
    return owner.row.values.map((original, i) => {
      const field = fields[i]; if (owner.duplicate && columns[i].generated) return undefined; if (columns[i].generated || !field.changed) return original;
      if (!field.include && owner.row.index === undefined) return undefined;
      return sqliteEditValueSchema.parse(field.kind === 'null' ? { kind: 'null' } : { kind: field.kind, value: field.kind === 'blob' ? sqliteBinaryInputHex(field.value) : field.value });
    });
  }
  /** 切换先完整验证，非法JSON或字段输入原样保留；不静默丢弃另一种界面的缓冲。 */
  function switchMode(next: 'form' | 'json' | 'tree'): void {
    if (next === mode || owner.column !== undefined || !localCurrent() || saving.current || !duplicateCurrent() || !owner.current()) return;
    if (pendingTreeRef.current) { setError(treeText.pending); return; }
    try {
      const values = inputValues();
      if (next === 'json') { const input = beginSqliteRecordJson(columns, values, owner.row.index === undefined); const draft = { input, text: input.initial }; jsonRef.current = draft; setJson(draft); }
      else if (next === 'tree') { const nextTree = { values: Object.freeze(values), revision: (tree?.revision ?? -1) + 1 }; treeRef.current = nextTree; setTree(nextTree); }
      else { const nextFields = values.map((value, index) => ({ include: value !== undefined, kind: value?.kind ?? 'text' as const, value: value && value.kind !== 'null' ? value.value : '', changed: !sameInputValue(value, owner.row.values[index]) })); live.current = nextFields; setFields(nextFields); }
      modeRef.current = next; setMode(next); setError('');
    } catch (reason) { setError(errorMessage(reason)); }
  }
  /** 有界文本域与原输入票据共同核验；旧渲染、旧模式及卸载后的事件不能污染新缓冲。 */
  function changeJson(value: string): void {
    if (mode !== 'json' || !json || !localCurrent() || saving.current || !duplicateCurrent() || !owner.current()) return;
    const next = { input: json.input, text: value }; jsonRef.current = next; setJson(next); setError('');
  }
  /** 节点输入独占令牌；旧树卸载只释放自己的token，不能清后来节点的占用。 */
  function treePendingChange(source: TreeDraft, token: object, pending: boolean): boolean {
    if (pending) { if (treeRef.current !== source || modeRef.current !== 'tree' || !localCurrent() || !owner.current() || pendingTreeRef.current) return false; pendingTreeRef.current = { source, token }; }
    else { if (pendingTreeRef.current?.source !== source || pendingTreeRef.current.token !== token) return false; pendingTreeRef.current = undefined; }
    setTreePending(pending); return true;
  }
  /** 完整TEXT候选只应用到准确树数组；不直接改Editor，不生成节点级数据库提交。 */
  function treeChange(source: TreeDraft, index: number, value: SqliteOriginalValue, values: TreeDraft['values'], token: object): boolean {
    if (!localCurrent() || !owner.current() || modeRef.current !== 'tree' || treeRef.current !== source || values !== source.values || pendingTreeRef.current?.source !== source || pendingTreeRef.current.token !== token || !Number.isInteger(index) || !columns[index] || columns[index].generated || value.kind !== 'text') return false;
    const parsed = sqliteEditValueSchema.parse(value), next = { values: Object.freeze(source.values.map((before, i) => i === index ? parsed : before)), revision: source.revision + 1 }; treeRef.current = next; setTree(next); setError(''); return true;
  }
  /** 校验失败保留原表单；干净的导航不消耗草稿撤销步骤。 */
  function save(destination?: { direction: -1 | 1 } | { index: number }): void {
    if (!localCurrent() || saving.current || !duplicateCurrent() || !owner.current()) { if (committed.current === renderTicket) setError(text.stale); return; }
    if (pendingTreeRef.current) { setError(treeText.pending); return; }
    const navigation = owner.navigation;
    if (destination && 'direction' in destination &&
        !(destination.direction === -1 ? navigation?.previous : navigation?.next)) return;
    saving.current = true;
    try {
      const values = destination && !changed ? undefined : inputValues();
      if (!duplicateCurrent() || !owner.current()) { setError(text.stale); return; }
      const accepted = !destination ? values && owner.onSave(values)
        : 'direction' in destination ? navigation?.move(destination.direction, values)
        : navigation?.records?.select(destination.index, values);
      if (!accepted) { setError(text.stale); return; }
      closed.current = true;
      if (!destination) owner.onClose();
    } catch (reason) { setError(errorMessage(reason)); } finally { saving.current = false; }
  }
  function change(index: number, patch: Partial<FieldDraft>): void { if (!localCurrent() || saving.current || !duplicateCurrent()) return; const next = fields.map((field, i) => i === index ? { ...field, ...patch, changed: true } : field); live.current = next; setFields(next); }
  /** 显示只核准确字段来源；字段写入事件仍另核已提交渲染票据，不能在首次渲染时永久禁用入口。 */
  function fieldSourceAvailable(index: number): boolean { return !invalid.current && !closed.current && !saving.current && live.current[index] === fields[index] && duplicateCurrent() && owner.current(); }
  /** SQLite 日期仍保存为 TEXT，不为普通整数、REAL 或动态字段推测时间语义。 */
  function temporalField(index: number) {
    const field = fields[index], column = columns[index];
    if (column.generated || !field.include || field.kind !== 'text') return;
    const spec = recordTemporalSpec(column.declaredType, 'sqlite');
    return spec && <RecordTemporalControls spec={spec} value={field.value} onChange={value => {
      if (fieldSourceAvailable(index)) change(index, { value });
    }}/>;
  }
  // 字段区独立滚动，让多列记录的导航与保存栏始终留在对话框可见范围内。
  return <Modal title={owner.batch ? batchText.title : owner.duplicate ? text.duplicateTitle : row.index === undefined ? text.add : column === undefined ? text.editRow : text.editCell} onClose={close} wide><div ref={content} className="modal-content dialog-body" data-sqlite-duplicate-input={owner.duplicate ? owner.duplicateOwner : undefined} data-sqlite-record-input={owner.navigation?.ownerId} data-sqlite-fill-owner={owner.batch?.ownerId}><p>{text.inputHint}</p>{owner.batch && <><p role="status">{batchText.position(owner.batch.position, owner.batch.count)}</p><p>{owner.batch.groups ? batchText.workspaceHint : batchText.hint}</p>
    {owner.batch.groups && <ul>{owner.batch.groups.map(group => <li key={group.index}>{workspaceText.fillGroup(group.index, group.count)}</li>)}</ul>}
    {owner.batch.sourcePage !== undefined && <p role="status">{batchText.sourcePage(owner.batch.sourcePage)}</p>}</>}{owner.duplicate && <p>{text.duplicateHint}</p>}{owner.duplicatePosition && <p role="status">{owner.duplicatePosition}</p>}{owner.navigation && !owner.batch && <p>{text.recordNavigation}</p>}
    {records && <RecordNavigator state={records.state} count={records.rows.length}
      columns={columns.map(column => ({ key: column.name, name: column.name }))}
      active={activeRecord} disabled={treePending} stage={changed}
      canSelect={index => existingRecord(records.rows[index])}
      value={(index, key) => recordSummary(records.rows[index].values[columns.findIndex(column => column.name === key)])}
      onSelect={index => save({ index })}/>}
    {owner.column === undefined && <div role="group" aria-label={jsonText.modes}><button type="button" aria-label={jsonText.form} aria-pressed={mode === 'form'} disabled={treePending} onClick={() => switchMode('form')}>{jsonText.form}</button><button type="button" aria-label={jsonText.json} aria-pressed={mode === 'json'} disabled={treePending} onClick={() => switchMode('json')}>{jsonText.json}</button><button type="button" aria-label={treeText.mode} aria-pressed={mode === 'tree'} disabled={treePending} onClick={() => switchMode('tree')}>{treeText.mode}</button></div>}{mode === 'tree' && tree ? <SqliteRecordTree key={tree.revision} columns={columns} values={tree.values} current={() => localCurrent() && modeRef.current === 'tree' && treeRef.current === tree && owner.current()} onPending={(token, pending) => treePendingChange(tree, token, pending)} onChange={(index, value, values, token) => treeChange(tree, index, value, values, token)}/> : mode === 'json' && json ? <><p>{jsonText.hint}</p><BoundedRecordTextarea aria-label={jsonText.input} spellCheck={false} rows={18} style={{ width: '100%', fontFamily: 'monospace' }} value={json.text} inputIdentity={json.input} budget={sqliteRecordJsonBudget} onValueChange={changeJson}/></> : columns.map((item, index) => column !== undefined && index !== column ? null : <fieldset key={item.name}><legend>{item.name}{item.generated ? ' · ' + text.generated : ''}</legend>{row.index === undefined && <label><input type="checkbox" aria-label={text.include(item.name)} checked={fields[index].include} disabled={item.generated} onChange={event => change(index, { include: event.target.checked })}/>{text.include(item.name)}</label>}<select aria-label={text.type(item.name)} value={fields[index].kind} disabled={item.generated || !fields[index].include} onChange={event => change(index, { kind: event.target.value as FieldDraft['kind'] })}>{Object.entries(text.kinds).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select>{fields[index].kind === 'blob' && fields[index].include ? <SqliteBinaryField value={fields[index].value} label={text.value(item.name)} readonlyReason={item.generated ? text.generated : ''} source={[owner.ticket, owner.page, owner.row, index, fields[index]]} current={() => localCurrent() && fieldSourceAvailable(index)} available={() => fieldSourceAvailable(index)} onChange={value => change(index, { value })}/> : owner.batch ? <BoundedRecordTextarea aria-label={text.value(item.name)} value={fields[index].value} inputIdentity={owner.row} budget={{ units: 65536, bytes: 65536 * 4, message: batchText.budget }} disabled={item.generated || !fields[index].include || fields[index].kind === 'null'} onValueChange={value => change(index, { value })}/> : <textarea aria-label={text.value(item.name)} value={fields[index].value} maxLength={65536} disabled={item.generated || !fields[index].include || fields[index].kind === 'null'} onChange={event => change(index, { value: event.target.value })}/>}
    {temporalField(index)}
    {fields[index].include && fields[index].kind === 'text' && <HtmlCellPreviewToggle value={fields[index].value}/>}
    </fieldset>)}</div><ErrorBox message={owner.duplicate && !duplicateSource.current ? text.stale : error}/><footer className="modal-footer sqlite-record-input-footer">{owner.navigation && <>
    {records && <RecordBoundaryButton label={changed ? navigatorText.stageFirstRecord : navigatorText.firstRecord}
      index={records.rows.findIndex(existingRecord)} active={activeRecord} disabled={treePending} onSelect={index => save({ index })}/>}
    <button type="button" aria-label={owner.batch ? changed ? batchText.savePrevious : batchText.previous : owner.navigation.pagePrevious ? changed ? text.savePreviousPageRecord : text.previousPageRecord : changed ? text.savePreviousRecord : text.previousRecord} disabled={treePending || !owner.navigation.previous} onClick={() => save({ direction: -1 })}>{owner.batch ? changed ? batchText.savePrevious : batchText.previous : owner.navigation.pagePrevious ? changed ? text.savePreviousPageRecord : text.previousPageRecord : changed ? text.savePreviousRecord : text.previousRecord}</button>
    <button type="button" aria-label={owner.batch ? changed ? batchText.saveNext : batchText.next : owner.navigation.pageNext ? changed ? text.saveNextPageRecord : text.nextPageRecord : changed ? text.saveNextRecord : text.nextRecord} disabled={treePending || !owner.navigation.next} onClick={() => save({ direction: 1 })}>{owner.batch ? changed ? batchText.saveNext : batchText.next : owner.navigation.pageNext ? changed ? text.saveNextPageRecord : text.nextPageRecord : changed ? text.saveNextRecord : text.nextRecord}</button>
    {records && <RecordBoundaryButton label={changed ? navigatorText.stageLastRecord : navigatorText.lastRecord}
      index={lastRecord} active={activeRecord} disabled={treePending} onSelect={index => save({ index })}/>}
  <span className="grow"/></>}<button aria-label={owner.batch ? batchText.cancel : owner.duplicate ? text.duplicateCancel : text.cancelInput} onClick={close}>{owner.batch ? batchText.cancel : owner.duplicate ? text.duplicateCancel : text.cancelInput}</button><button className="primary" aria-label={owner.batch ? batchText.save : owner.duplicate ? text.duplicateSave : text.saveInput} disabled={treePending || owner.duplicate && !duplicateSource.current} onClick={() => save()}>{owner.batch ? batchText.save : owner.duplicate ? text.duplicateSave : text.saveInput}</button></footer></Modal>;
}

/** 真实 modal 明确确认集中写入；预览关闭不丢本地草稿，也不伪取消已发送提交。 */
export function SqliteTablePreviewDialog({ ticket, view, current, onApply, onClose, onStop, review }: {
  ticket: object; view: SqliteEditView; current(): boolean; onApply(): void; onClose(): void; onStop(): void;
  review?: { title: string; hint: string; details: string; confirmation: string; submit: string; close?: string; danger?: true };
}) {
  const [confirmed, setConfirmed] = useState(false);
  const owner = useRef({ ticket, page: view.page, rows: view.rows, preview: view.preview }).current, invalid = useRef(false), renderTicket = {}, committed = useRef<object | undefined>(undefined);
  useLayoutEffect(() => { committed.current = renderTicket; return () => { if (committed.current === renderTicket) committed.current = undefined; }; });
  if (owner.ticket !== ticket || owner.page !== view.page || owner.rows !== view.rows || owner.preview !== view.preview) invalid.current = true;
  /** 确认只属于原预览；旧按钮、旧 checkbox 或卸载组件不得向新预览发出动作。 */
  function actionCurrent(): boolean { return !invalid.current && committed.current === renderTicket && current(); }
  function close(): void { if (actionCurrent() && !view.busy) onClose(); }
  const confirmation = review?.confirmation ?? text.confirmation, submit = review?.submit ?? text.submit;
  const closeLabel = review?.close ?? text.closePreview;
  return <Modal title={review?.title ?? text.previewTitle} onClose={close} wide>
    <div className="modal-content dialog-body">
      <p>{review?.hint ?? text.previewHint}</p>
      {view.preview && <>
        <p>{review?.details ?? workspaceText.previewPages(view.preview.snapshotIds?.length ?? 1)}</p>
        <p>{view.preview.target.database}.{view.preview.target.table} · {text.counts(view.preview.counts.insert, view.preview.counts.update, view.preview.counts.delete)}</p>
        <pre aria-label="SQLite 修改 SQL 预览" style={{ maxHeight: '45vh', overflow: 'auto', whiteSpace: 'pre-wrap' }}>{view.preview.sql.join('\n')}</pre>
        <label><input type="checkbox" aria-label={confirmation} checked={confirmed} disabled={view.busy || !view.valid}
          onChange={event => { if (actionCurrent() && !view.busy && view.valid) setConfirmed(event.target.checked); }}/>{confirmation}</label>
      </>}
      {view.busy && <Spinner text={text.working}/>}<ErrorBox message={view.message}/>
    </div>
    <footer className="modal-footer"><span className="grow"/>
      <button aria-label={closeLabel} disabled={view.busy} onClick={close}>{closeLabel}</button>
      {view.busy && <button aria-label={text.stop} onClick={() => { if (actionCurrent()) onStop(); }}>{text.stop}</button>}
      <button className={review?.danger ? 'danger' : 'primary'} aria-label={submit} disabled={!confirmed || !view.preview || view.busy || !view.valid || view.unknown} onClick={() => {
        if (!confirmed || !view.preview || view.busy || !view.valid || view.unknown || !actionCurrent()) return;
        setConfirmed(false); onApply();
      }}>{submit}</button>
    </footer>
  </Modal>;
}
