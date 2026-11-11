import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SqliteTableFilter } from '../../shared/sqliteTableBrowse';
import { sqliteFilterSelectionSchema } from '../../shared/sqliteTableBrowse';
import { sqliteValueOptionsLimits, sqliteValueOptionsOrderSchema, type SqliteValueOption, type SqliteValueOptionsInput, type SqliteValueOptionsOrder } from '../../shared/sqliteValueOptions';
import { SqliteValueOptionsController, type SqliteValuesView } from '../sqliteValueOptions';
import { sqliteValueOptionsZh as text } from '../locales/sqliteValueOptions.zh-CN';
import { acquireWorkspaceBusy } from '../store';
import { invoke, uid, errorMessage } from '../lib';
import { ErrorBox, Field, Modal, Spinner, UsageHelp } from './ui';
import { ValueDistributionCells, ValueDistributionSummary } from './ValueDistribution';
import { valueDistributionZh as distributionText } from '../locales/valueDistribution.zh-CN';

interface Props { tabId: string; base: Omit<SqliteValueOptionsInput, 'column' | 'search' | 'taskId' | 'order' | 'distribution'>; columns: readonly string[]; initialColumn?: string; mode: 'and' | 'or'; current(): boolean; onApply(filter: SqliteTableFilter): boolean; onClose(): void; onCleanup(reason: unknown): void; }
/** 只在显式读取时访问数据库；加入草稿和搜索输入均不自动查询。 */
export function SqliteValueOptionsDialog(props: Props) {
  const origin = useRef(props).current, latest = useRef(props); latest.current = props;
  const [view, setView] = useState<SqliteValuesView>({ busy: false, stopping: false, error: '' }), [column, setColumn] = useState(origin.initialColumn ?? origin.columns[0] ?? ''), [search, setSearch] = useState(''), [exclude, setExclude] = useState(false), [selected, setSelected] = useState<readonly number[]>([]), [page, setPage] = useState(0), [problem, setProblem] = useState(''), [closing, setClosing] = useState(false);
  const composing = useRef(false), mounted = useRef(true), closingRef = useRef(false), applying = useRef(false), closed = useRef(false), render = {}, committed = useRef<object | undefined>(undefined);
  const [order, setOrder] = useState<SqliteValueOptionsOrder>('value');
  const [distribution, setDistribution] = useState(false);
  useLayoutEffect(() => { committed.current = render; return () => { if (committed.current === render) committed.current = undefined; }; });
  const [controller] = useState(() => new SqliteValueOptionsController({ base: origin.base, current: () => latest.current.base === origin.base && latest.current.columns === origin.columns && latest.current.tabId === origin.tabId && origin.current(), acquire: () => acquireWorkspaceBusy(origin.tabId), read: input => invoke('sqlite.valueOptions', input), cancel: taskId => invoke('query.cancel', { taskId }), id: uid, changed: setView, cleanup: reason => origin.onCleanup(reason) }));
  useEffect(() => { controller.observe(); });
  useEffect(() => { mounted.current = true; controller.activate(); return () => { mounted.current = false; controller.dispose(); }; }, [controller]);
  /** 真实已提交事件才可修改当前草稿，旧按钮、忙态和输入法组合不能触发后继动作。 */
  function current(): boolean { return committed.current === render && !closed.current && !closingRef.current && !applying.current && !controller.view.busy && controller.current() && !composing.current; }
  function discard(): boolean { return !selected.length || window.confirm(text.discard); }
  /** 字段、搜索、排序和类别视图共用丢弃确认；接受后仅清本地候选。 */
  function change(update: () => void): void {
    if (!current() || !discard() || !current()) return;
    controller.clear(); setSelected([]); setPage(0); setProblem(''); update();
  }
  /** 只有明确按钮动作提交本次排序，busy、旧渲染及原取消屏障继续阻止重复执行。 */
  function read(): void { if (!current() || !discard() || !current()) return; setSelected([]); setPage(0); setProblem(''); void controller.read(column, search, order, distribution); }
  /** 关闭在途读取先等原Promise和取消ACK；失败仍保留窗口供核对。 */
  async function close(): Promise<void> { if (committed.current !== render || closed.current || closingRef.current || applying.current || composing.current || !discard()) return; closingRef.current = true; setClosing(true); try { await controller.stop(); if (mounted.current && !closed.current) { closed.current = true; origin.onClose(); } } catch (reason) { if (mounted.current) { closingRef.current = false; setProblem(errorMessage(reason)); setClosing(false); } } }
  /** 同帧重复点击及父回调重入只接纳一次；拒绝时保留完整勾选供用户核对。 */
  function apply(): void { if (!current() || !view.output) return; applying.current = true; try { const selectedValues = controller.selection(selected); if (origin.onApply({ column, operator: exclude ? 'notOneOf' : 'oneOf', selectedValues })) { closed.current = true; origin.onClose(); } else setProblem(text.rejected); } catch (reason) { setProblem(errorMessage(reason)); } finally { applying.current = false; } }
  const values = view.output?.values ?? [], start = page * sqliteValueOptionsLimits.pageSize;
  const visible = values.slice(start, start + sqliteValueOptionsLimits.pageSize), totals = view.output?.distribution;
  function choice(option: SqliteValueOption, index: number) {
    const allowed = sqliteFilterSelectionSchema.safeParse(option.value).success;
    return <label key={index} className={totals ? 'check' : undefined} style={totals ? undefined : { display: 'block' }}>
      <input type="checkbox" aria-label={text.choice(index + 1)} checked={selected.includes(index)} disabled={!allowed || closing || view.busy} onChange={event => {
        if (!current()) return;
        const checked = event.target.checked;
        if (checked && selected.length >= sqliteValueOptionsLimits.selected) { setProblem(text.selection); return; }
        setSelected(values => checked ? values.includes(index) || values.length >= sqliteValueOptionsLimits.selected ? values : [...values, index] : values.filter(value => value !== index));
      }}/>
      <span title={allowed ? undefined : text.unsupported}>{option.value.kind.toUpperCase()} · <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{option.value.kind === 'null' ? 'NULL' : JSON.stringify(option.value.value)}</span>{!totals && <> · {text.count(option.count)}</>}</span>
    </label>;
  }
  return <Modal title={text.title} onClose={() => { void close(); }} wide><div className="modal-content" onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}>
    <p>{text.hint}</p>
    <UsageHelp><p>{text.searchHint}</p><p>{text.limit}</p><p>{text.orderHint}</p><p>{text.relation(origin.mode)}</p></UsageHelp>
    <div className="pg-table-controls">
      <Field label={text.column}><select aria-label={text.column} value={column} disabled={view.busy || closing} onChange={event => { const value = event.target.value; change(() => setColumn(value)); }}>{origin.columns.map(name => <option key={name} value={name}>{name}</option>)}</select></Field>
      <Field label={text.search}><input aria-label={text.search} value={search} maxLength={sqliteValueOptionsLimits.search} disabled={view.busy || closing} onChange={event => { const value = event.target.value; change(() => setSearch(value)); }}/></Field>
      <Field label={text.order}><select aria-label={text.order} value={order} disabled={view.busy || closing} onChange={event => {
        const value = sqliteValueOptionsOrderSchema.safeParse(event.target.value);
        if (value.success) change(() => setOrder(value.data));
      }}><option value="value">{text.orderValue}</option><option value="count-desc">{text.orderMost}</option><option value="count-asc">{text.orderLeast}</option></select></Field>
      <label className="check"><input type="checkbox" checked={distribution} disabled={view.busy || closing} onChange={event => {
        const checked = event.target.checked; change(() => setDistribution(checked));
      }}/>{distributionText.enable}</label>
      <button disabled={view.busy || closing} onClick={read}>{text.read}</button>{view.busy && <><button disabled={view.stopping} onClick={() => { if (committed.current === render && controller.view.busy) void controller.stop(); }}>{text.stop}</button><Spinner text={view.stopping ? text.stopping : text.loading}/></>}
    </div>
    <ErrorBox message={problem || view.error || (!controller.current() ? text.stale : '')}/>
    {view.output && totals ? <>
      <ValueDistributionSummary totals={totals} options={values} truncated={view.output.truncated}/>
      {!!visible.length && <div className="query-result-frequency value-distribution-options"><table aria-label={distributionText.title}><thead><tr>
        {[distributionText.value, distributionText.count, distributionText.percent, distributionText.bar].map(label => <th key={label} scope="col">{label}</th>)}
      </tr></thead><tbody>{visible.map((option, offset) => <tr key={start + offset}>
        <th scope="row">{choice(option, start + offset)}</th><td>{option.count}</td>
        <ValueDistributionCells count={option.count} total={totals.rows}/>
      </tr>)}</tbody></table></div>}
    </> : <div role="group" aria-label={text.title}>{visible.map((option, offset) => choice(option, start + offset))}</div>}
    {view.output && !values.length && <p>{text.empty}</p>}{view.output?.truncated && !totals && <p>{text.truncated}</p>}
    <div className="pg-table-controls">
      <span role="status">{text.selected(selected.length)}</span>
      <button disabled={!page || view.busy || closing} onClick={() => { if (current()) setPage(page - 1); }}>{text.previous}</button><button disabled={start + sqliteValueOptionsLimits.pageSize >= values.length || view.busy || closing} onClick={() => { if (current()) setPage(page + 1); }}>{text.next}</button>
      <label className="check"><input type="checkbox" checked={exclude} disabled={view.busy || closing} onChange={event => { if (current()) setExclude(event.target.checked); }}/>{text.exclude}</label>
    </div>
  </div><footer className="modal-footer"><button disabled={closing} onClick={() => { void close(); }}>{text.close}</button><button className="primary" disabled={!selected.length || !view.output || view.busy || closing} onClick={apply}>{text.add}</button></footer></Modal>;
}
