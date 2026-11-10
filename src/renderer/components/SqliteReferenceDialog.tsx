import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SqliteTablePage } from '../../shared/sqliteTableBrowse';
import type { DataRow } from '../../shared/contracts';
import { sqliteRelationshipName as fold } from '../../shared/sqliteRelationships';
import type { SqliteOriginalValue } from '../../shared/sqliteTableEdit';
import type { SqliteReferenceOutput, SqliteReferenceSearch } from '../../shared/sqliteReference';
import type { ReferenceCandidateSort as CandidateSort } from '../../shared/referenceCandidateSort';
import { sqliteReferenceTuple, assertSqliteReferenceChoice, type SqliteReferenceChoice } from '../sqliteReferenceChoice';
import { SqliteReferenceReader, type SqliteReferenceServices } from '../sqliteReferenceReader';
import { sqliteReferenceZh as text } from '../locales/sqliteReference.zh-CN';
import { useWorkspace } from '../store';
import { errorMessage, invoke, uid } from '../lib';
import { ErrorBox, Modal, Spinner } from './ui';
import { ResultsGrid } from './ResultsGrid';
import { ReferenceCandidateColumns } from './ReferenceCandidateColumns';
import { ReferenceCandidateSort } from './ReferenceCandidateSort';
import { ReferenceSearchInput } from './ReferenceSearchInput';

export const sqliteReferenceServices: SqliteReferenceServices = { read: input => invoke('sqlite.referencePage', input), cancel: taskId => invoke('query.cancel', { taskId }), id: uid };
type ReferenceKey = SqliteReferenceOutput['source']['foreignKeys'][number];

/** 父记录与候选均使用独立只读任务；关闭等待原读取和取消链收尾。 */
export function SqliteReferenceDialog({ source, column, values, current, onActivity, onClose, onStage, services = sqliteReferenceServices }: {
  source: SqliteTablePage; column?: string; values: readonly (SqliteOriginalValue | undefined)[]; current(): boolean; onActivity(delta: 1 | -1): void; onClose(): void; onStage?(choice: SqliteReferenceChoice): boolean; services?: SqliteReferenceServices;
}) {
  const origin = useRef({ source, column, values, current, onActivity, onClose, onStage, services }).current, alive = useRef(true), dead = useRef(false), closing = useRef(false), reading = useRef(false), work = useRef<Promise<void> | undefined>(undefined);
  const [invalid, setInvalid] = useState(false), [busy, setBusy] = useState(false), [closeBusy, setCloseBusy] = useState(false), [error, setError] = useState('');
  const [catalog, setCatalog] = useState<SqliteReferenceOutput>(), [selected, setSelected] = useState<number>(), [data, setData] = useState<SqliteReferenceOutput>();
  const [chosen, setChosen] = useState<number>(), selection = useRef<{ data: SqliteReferenceOutput; index: number; values: SqliteOriginalValue[] } | undefined>(undefined);
  const [searchColumns, setSearchColumns] = useState<string[]>([]);
  const focusCandidate = useRef<() => boolean>(null);
  const [sort, setSort] = useState<CandidateSort | null>(null);
  const [searchColumn, setSearchColumn] = useState(''), [searchText, setSearchText] = useState(''), appliedSearch = useRef<SqliteReferenceSearch | undefined>(undefined);
  const [clearConfirmed, setClearConfirmed] = useState(false);
  const choosing = !!origin.onStage;
  const contextual = choosing && origin.column !== undefined;
  const resetSelection = () => { selection.current = undefined; setChosen(undefined); setClearConfirmed(false); };
  if (source !== origin.source || column !== origin.column || values !== origin.values || services !== origin.services) dead.current = true;
  const environment = () => { if (!alive.current || dead.current) return false; try { if (!origin.current()) dead.current = true; } catch { dead.current = true; } return !dead.current; };
  const [reader] = useState(() => new SqliteReferenceReader(source, values, environment, services));
  useLayoutEffect(() => { if (!environment()) { reader.invalidate(); setInvalid(true); } });
  const renderTicket = {}, committed = useRef<object | undefined>(undefined);
  useLayoutEffect(() => { committed.current = renderTicket; return () => { if (committed.current === renderTicket) committed.current = undefined; }; });
  const renderCurrent = () => alive.current && committed.current === renderTicket;
  const actionCurrent = () => renderCurrent() && environment() && !reading.current && !closing.current;
  useEffect(() => { alive.current = true; const observe = () => { if (!environment()) { reader.invalidate(); setInvalid(true); } }; const stop = useWorkspace.subscribe(observe); observe(); return () => { alive.current = false; stop(); reader.invalidate(); }; }, [reader]);
  /** 同步占位后获取父租约；直到原Promise及取消ACK全部结束才释放。 */
  function run(action: () => Promise<void | (() => void)>): void {
    if (!actionCurrent() || !reader.current()) return; reading.current = true;
    const pending = (async () => { let acquired = false, after: void | (() => void) = undefined;
      try { origin.onActivity(1); acquired = true; setBusy(true); setError(''); after = await action(); }
      catch (failure) { if (alive.current) setError(errorMessage(failure)); }
      finally { if (acquired) origin.onActivity(-1); reading.current = false; if (alive.current) setBusy(false); }
      // Editor只能在原读取租约归还后暂存；归还触发的同步来源变化仍会使这次确认失败。
      if (after && environment() && !closing.current) try { after(); } catch (failure) { if (alive.current) setError(errorMessage(failure)); }
    })(); work.current = pending;
  }
  /** 目录切换后只采用新约束的候选列，分页则保留已选搜索列。 */
  async function readCandidates(key: ReferenceKey, offset: number, search?: SqliteReferenceSearch, sort?: CandidateSort) {
    const value = await reader.candidates(key, offset, search, sort);
    if (!environment() || closing.current) return;
    setData(value);
    setSearchColumns(value.page!.columns.map(column => column.name));
    setSearchColumn(current => current || value.referencedColumns![0]);
  }
  /** 换页保留已应用搜索；编辑搜索草稿不发送任务，并撤销上一条父候选选择。 */
  function read(offset: number, restart = false, order = sort): void {
    if (!actionCurrent()) return; const key = keys.find(key => key.ordinal === selected); if (!key) return;
    if (choosing && restart) appliedSearch.current = searchText ? { column: searchColumn, text: searchText } : undefined;
    resetSelection(); setData(undefined);
    run(async () => {
      if (choosing) await readCandidates(key, offset, appliedSearch.current, order ?? undefined);
      else { const value = await reader.page(key, offset); if (environment() && !closing.current) setData(value); }
    });
  }
  function selectCandidate(row: DataRow | null): void {
    if (!actionCurrent() || !data?.page) return;
    resetSelection();
    const index = row ? data.page.result.rows.indexOf(row) : -1;
    if (index < 0) return;
    try {
      selection.current = { data, index, values: sqliteReferenceTuple(data, index) };
      setChosen(index); setError('');
    } catch (failure) { setError(errorMessage(failure)); }
  }
  /** 按钮使用当前选择，双击使用命中行，两者均须复读整组父键。 */
  function stage(row?: DataRow): void {
    if (!actionCurrent() || !origin.onStage || !editableKey || !key || clearConfirmed) return;
    if (row) selectCandidate(row);
    const token = selection.current; if (!token || token.data !== data) return;
    run(async () => { const proof = await reader.verify(key, token.values, token.data.page!.schemaKey); assertSqliteReferenceChoice(proof, token.values);
      return () => { if (selection.current !== token || !reader.current()) return; if (!origin.onStage!({ foreignKey: key.ordinal, proof, values: token.values })) throw Error(text.stale); };
    });
  }
  /** 清空不查询父表，重新核对源目录后将所有可空子键一次暂存为NULL。 */
  function clear(): void {
    if (!actionCurrent() || !origin.onStage || !key || !clearConfirmed) return; const ordinal = key.ordinal;
    resetSelection(); run(async () => { const proof = await reader.catalog(); return () => { if (!origin.onStage!({ foreignKey: ordinal, proof, values: null })) throw Error(text.stale); }; });
  }
  async function close(): Promise<void> { if (!renderCurrent() || closing.current) return; closing.current = true; setCloseBusy(true); try { await reader.stop(); await work.current; if (alive.current) origin.onClose(); } catch (failure) { closing.current = false; if (alive.current) { setError(errorMessage(failure)); setCloseBusy(false); } } }
  const writableKey = (key: ReferenceKey) => {
    const edit = source.edit;
    return edit?.kind === 'editable' && key.columns.every(name => edit.columns.some(field => fold(field.name) === fold(name) && !field.generated));
  };
  /** 目录仍由独立读事务返回，入口列只筛选显示范围，不作为权威约束映射。 */
  const scopedKeys = (value: SqliteReferenceOutput) => column === undefined ? value.source.foreignKeys
    : value.source.foreignKeys.filter(key => key.columns.some(name => fold(name) === fold(column)) && writableKey(key));
  const keys = catalog ? scopedKeys(catalog) : [];
  const key = keys.find(key => key.ordinal === selected), disabled = invalid || busy || closeBusy;
  const editableKey = !!key && writableKey(key);
  const clearable = editableKey && key.columns.every(name => source.edit?.kind === 'editable' && source.edit.columns.some(field => fold(field.name) === fold(name) && field.nullable));
  const candidateKeys = choosing && data?.page ? data.page.result.columns.filter(column =>
    data.referencedColumns?.some(name => fold(name) === fold(column.name))).map(column => column.name) : undefined;
  function resetDirectorySelection() {
    resetSelection(); setData(undefined); setSearchColumns([]); setSearchColumn(''); setSearchText(''); appliedSearch.current = undefined;
    setSort(null);
  }
  function loadCatalog() {
    if (!actionCurrent()) return;
    resetDirectorySelection(); setCatalog(undefined); setSelected(undefined);
    run(async () => {
      const next = await reader.catalog();
      if (!environment() || closing.current) return;
      const first = scopedKeys(next)[0];
      setCatalog(next); setSelected(first?.ordinal);
      // 目录与首屏共享同一次表页租约；关闭或来源变化时不启动第二段读取。
      if (contextual && first) await readCandidates(first, 0);
    });
  }
  useEffect(() => { if (contextual) loadCatalog(); }, []);
  return <Modal title={choosing ? text.choiceTitle : text.title} wide onClose={() => { void close(); }}><div className="modal-content reference-content">
    <p>{choosing ? text.choiceHint : text.hint}</p><p>{text.scope}</p>
    {column !== undefined && <p>{text.columnScope(column)}</p>}
    <button disabled={disabled} onClick={loadCatalog}>{text.catalog}</button>
    {catalog && (keys.length ? <label>{text.constraint}<select aria-label={text.constraint} disabled={disabled} value={selected ?? ''} onChange={event => {
      const next = keys.find(item => item.ordinal === Number(event.target.value));
      if (!actionCurrent() || !next || next.ordinal === selected) return;
      resetDirectorySelection(); setSelected(next.ordinal);
      if (contextual) run(() => readCandidates(next, 0));
    }}>{keys.map(key => <option key={key.ordinal} value={key.ordinal}>{text.key(key.ordinal)} · {key.columns.join(', ')} → {key.referencedTable}</option>)}</select></label>
    : <p>{column === undefined ? text.emptyKeys : text.emptyColumn}</p>)}
    {key && <p>{key.columns.join(', ')} → {key.referencedTable} ({key.referencedColumns?.join(', ') ?? text.implicit})</p>}
    {choosing && searchColumns.length > 0 && <div><label>{text.searchColumn}<select aria-label={text.searchColumn} disabled={disabled} value={searchColumn} onChange={event => { if (actionCurrent()) { resetSelection(); setSearchColumn(event.target.value); } }}>{searchColumns.map(name => <option key={name} value={name}>{name}</option>)}</select></label><label>{text.search}<ReferenceSearchInput label={text.search} value={searchText} limit={256}
      disabled={invalid || closeBusy} pending={busy} onChange={value => { if (actionCurrent()) { resetSelection(); setSearchText(value); } }}
      onSearch={() => read(0, true)} onCandidates={() => focusCandidate.current?.() ?? false}/></label><p>{text.searchHint}</p></div>}
    {choosing && <ReferenceCandidateSort columns={searchColumns} sort={sort} disabled={disabled || !key} onChange={next => {
      if (!actionCurrent()) return;
      setSort(next); read(0, false, next);
    }}/>}
    {!contextual && <p>{text.unloaded}</p>}<div className="reference-pagination"><button disabled={disabled || !key} onClick={() => read(0, true)}>{choosing ? text.candidates : text.read}</button><button disabled={disabled || !data?.page || data.page.offset === 0} onClick={() => read(Math.max(0, data!.page!.offset - data!.page!.limit))}>{text.previous}</button><button disabled={disabled || !data?.page?.hasMore} onClick={() => read(data!.page!.offset + data!.page!.limit)}>{text.next}</button>{busy && <button disabled={closeBusy} onClick={() => { if (renderCurrent() && !closing.current) void reader.stop().catch(failure => { if (alive.current) setError(errorMessage(failure)); }); }}>{text.stop}</button>}</div>
    <ErrorBox message={invalid ? text.stale : error}/>{busy && <Spinner text={text.loading}/>}
    <ReferenceCandidateColumns key={selected} columns={data?.page?.result.columns} keyNames={candidateKeys}>
      {columns => data?.page && <><p>{data.page.target.table} · {data.referencedColumns?.join(', ')} · {data.page.offset + 1}–{data.page.offset + data.page.result.rows.length}</p>{!data.page.result.rows.length && <p role="status">{text.empty}</p>}<div className="reference-grid"><ResultsGrid columns={columns} rows={data.page.result.rows} selectionScope={data.page} isCurrent={() => reader.current() && !busy} binaryFileActions={false}
        onActiveRowChange={choosing ? selectCandidate : undefined} onActivateRow={choosing && editableKey ? stage : undefined}
        focusFirstRowRef={focusCandidate}/></div></>}
    </ReferenceCandidateColumns>
      {choosing && <><p>{chosen === undefined ? text.selectRow : text.selectedRow(chosen + 1)}</p><label><input type="checkbox" checked={clearConfirmed} disabled={disabled || !clearable} onChange={event => { if (actionCurrent()) setClearConfirmed(event.target.checked); }}/>{text.clearConfirm}</label><button disabled={disabled || !clearable || !clearConfirmed} onClick={clear}>{text.clear}</button></>}
  </div><footer className="modal-footer">{choosing && <button disabled={disabled || !editableKey || chosen === undefined || clearConfirmed} onClick={() => stage()}>{text.stage}</button>}<button disabled={closeBusy} onClick={() => { void close(); }}>{text.close}</button></footer></Modal>;
}
