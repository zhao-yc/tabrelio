import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CellValue, QueryResult, ResultColumn } from '../../shared/contracts';
import { pinLimits, type PinnedQueryResult } from '../queryPins';
import { alignQueryResultComparisonColumns, captureQueryResultComparison, currentQueryResultComparison, queryResultComparisonKeyReason, queryResultComparisonValues, snapshotQueryResultComparisonReport, QueryResultComparisonScan, type QueryResultComparisonCapture, type QueryResultComparisonResult, type QueryResultComparisonRow, type QueryResultComparisonValue } from '../queryResultComparison';
import { queryResultComparisonZh as text } from '../locales/queryResultComparison.zh-CN';
import type { SortDialect } from '../queryResultSort';
import { errorMessage, invoke, uid } from '../lib';
import { UsageHelp, ErrorBox, Modal  } from './ui';

export type QueryResultComparisonSource = Pick<PinnedQueryResult, 'id' | 'label' | 'result'>;
interface Props { pins: readonly QueryResultComparisonSource[]; owner: string; dialect?: SortDialect; offline?: boolean; isCurrent(): boolean; onClose(): void; }
type Draft = { left: string; right: string; keys: readonly string[]; byName: boolean };
type Source = { pin: QueryResultComparisonSource; id: string; label: string; result: QueryResult; columns: readonly ResultColumn[]; truncated: boolean };
type Run = { draft: Draft; left: QueryResult; right: QueryResult; capture: QueryResultComparisonCapture; scan: QueryResultComparisonScan; timer?: ReturnType<typeof setTimeout> };
type View = { run?: Run; processed: number; total: number; result?: QueryResultComparisonResult; error?: string };
type Filter = 'all' | 'differences' | QueryResultComparisonRow['kind'];

/** 自有数据字段是唯一读取入口，不让固定源或列字段上的访问器在界面渲染时执行。 */
function own(value: unknown, key: PropertyKey): unknown {
  if (!value || typeof value !== 'object') throw Error(text.identity);
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !('value' in descriptor)) throw Error(text.identity);
  return descriptor.value;
}
/** 下拉列表只拷贝有界元数据，源SQL和行值仅由真实对比捕获器按需准入。 */
function sources(pins: readonly QueryResultComparisonSource[]): Source[] {
  const count = own(pins, 'length');
  if (!Array.isArray(pins) || !Number.isSafeInteger(count) || (count as number) < 2 || (count as number) > pinLimits.count) throw Error(text.requireTwo);
  const output: Source[] = [];
  for (let index = 0; index < (count as number); index++) {
    const pin = own(pins, String(index)) as QueryResultComparisonSource, id = own(pin, 'id'), label = own(pin, 'label'), result = own(pin, 'result') as QueryResult;
    if (typeof id !== 'string' || !id || typeof label !== 'string') throw Error(text.identity);
    const truncated = own(result, 'truncated'), rawColumns = own(result, 'columns'), length = own(rawColumns, 'length');
    if (typeof truncated !== 'boolean') throw Error(text.identity);
    if (!Array.isArray(rawColumns) || !Number.isSafeInteger(length) || (length as number) < 1 || (length as number) > 1024) throw Error(text.identity);
    const columns: ResultColumn[] = [];
    for (let position = 0; position < (length as number); position++) {
      const column = own(rawColumns, String(position)), key = own(column, 'key'), name = own(column, 'name'), type = own(column, 'type');
      if (typeof key !== 'string' || !key || typeof name !== 'string' || typeof type !== 'string' || key.length > 4096 || name.length > 4096 || type.length > 4096) throw Error(text.identity);
      columns.push({ key, name, type });
    }
    if (new Set(columns.map(column => column.key)).size !== columns.length) throw Error(text.identity);
    output.push({ pin, id, label, result, columns, truncated });
  }
  if (new Set(output.map(source => source.id)).size !== output.length) throw Error(text.identity);
  return output;
}
/** 字符串显式引号，空串、NULL、整行缺失和原生字节各自明确区分。 */
function valueText(value: CellValue | undefined): string {
  if (value === undefined) return text.missing;
  if (value === null) return text.nullValue;
  if (typeof value === 'string') return JSON.stringify(value) + (value === '' ? ` · ${text.emptyString}` : '');
  if (typeof value === 'object') return `${text.binary} ${value.base64}`;
  return String(value);
}

/** 两份固定快照只读对比；必须显式选择匹配键，不重新查询或生成同步SQL。 */
export function QueryResultComparisonDialog({ pins, owner, dialect, offline = false, isCurrent, onClose }: Props) {
  const origin = useRef({ pins, owner, dialect }).current, latest = useRef({ pins, owner, dialect, isCurrent }); latest.current = { pins, owner, dialect, isCurrent };
  const [prepared] = useState(() => { try { return { sources: sources(pins), error: '' }; } catch (reason) { return { sources: [] as Source[], error: errorMessage(reason) }; } });
  const [draft, setDraft] = useState<Draft>(() => ({ left: prepared.sources[0]?.id ?? '', right: prepared.sources.at(-1)?.id ?? '', keys: [], byName: false }));
  const draftRef = useRef(draft), [view, setView] = useState<View>({ processed: 0, total: 0, error: prepared.error });
  const [filter, setFilter] = useState<Filter>('differences'), [page, setPage] = useState(1), [detail, setDetail] = useState<{ run: Run; row: QueryResultComparisonRow; values: readonly QueryResultComparisonValue[] }>();
  const active = useRef<Run | undefined>(undefined), last = useRef<Run | undefined>(undefined), alive = useRef(true), invalid = useRef(false), closed = useRef(false);
  const report = useRef<{ taskId: string; writing: boolean } | undefined>(undefined);
  const [reportPhase, setReportPhase] = useState<'choosing' | 'writing'>(), [reportStatus, setReportStatus] = useState(''), [reportError, setReportError] = useState('');
  const committed = useRef<object | undefined>(undefined), ticket = {};

  /** 每批只核准确pin数组与有界源身份；原行及单元格的完整核验由最终发布负责。 */
  function environment(): boolean {
    if (!alive.current || invalid.current || closed.current) return false;
    let valid = false;
    try {
      valid = latest.current.pins === origin.pins && latest.current.owner === origin.owner && latest.current.dialect === origin.dialect && latest.current.isCurrent() === true && own(pins, 'length') === prepared.sources.length && prepared.sources.every((source, index) => own(pins, String(index)) === source.pin && own(source.pin, 'id') === source.id && own(source.pin, 'label') === source.label && own(source.pin, 'result') === source.result);
    } catch {}
    if (!valid) invalid.current = true;
    return valid;
  }
  /** 清定时器并撤销真实扫描器；已从事件队列取出的旧回调仍被run引用拒绝。 */
  function cancelRun(): void {
    const run = active.current; active.current = undefined;
    if (run) { if (run.timer !== undefined) clearTimeout(run.timer); run.scan.cancel(); }
    if (last.current && last.current !== run) last.current.scan.cancel();
  }
  useLayoutEffect(() => { alive.current = true; committed.current = ticket; if (!environment()) cancelRun(); return () => { if (committed.current === ticket) committed.current = undefined; }; });
  useLayoutEffect(() => () => {
    alive.current = false; cancelRun();
    if (report.current?.writing) void invoke('query.cancel', { taskId: report.current.taskId }).catch(() => {});
  }, []);
  /** 用户新动作前复核上一捕获，不能以重新捕获追认已经观察到的源漂移。 */
  function sourceCurrent(): boolean {
    const run = last.current;
    if (!environment()) { cancelRun(); setView({ processed: 0, total: 0, error: text.stale }); setDetail(undefined); return false; }
    if (run && !currentQueryResultComparison(run.capture, run.left, run.right)) { invalid.current = true; cancelRun(); setView({ processed: 0, total: 0, error: text.stale }); return false; }
    return true;
  }
  /** 切源与键编辑同步撤销旧扫描及结果，选择新源后要求重新明确勾选键。 */
  function change(next: Draft): void {
    if (report.current || committed.current !== ticket || draftRef.current !== draft || !sourceCurrent()) return;
    if (!prepared.sources.some(source => source.id === next.left) || !prepared.sources.some(source => source.id === next.right) || next.keys.length > 8 || new Set(next.keys).size !== next.keys.length) return;
    if (next.keys.some(key => !columns.some(column => column.key === key && !queryResultComparisonKeyReason(column, dialect)))) return;
    cancelRun(); draftRef.current = next; setDraft(next); setView({ processed: 0, total: 0 }); setDetail(undefined); setFilter('differences'); setPage(1);
    setReportStatus(''); setReportError('');
  }
  /** 单次明确开始才捕获两份真实结果；扫描中不显示部分计数或部分差异。 */
  function start(): void {
    if (report.current || committed.current !== ticket || draftRef.current !== draft || active.current || !draft.keys.length || draft.keys.length > 8 || draft.left === draft.right || !sourceCurrent()) return;
    const left = prepared.sources.find(source => source.id === draft.left)?.result, right = prepared.sources.find(source => source.id === draft.right)?.result;
    if (!left || !right) return;
    try {
      cancelRun();
      const capture = captureQueryResultComparison(left, right, draft.keys, dialect, draft.byName), run: Run = { draft, left, right, capture, scan: new QueryResultComparisonScan(capture) };
      last.current = run; active.current = run; setView({ run, processed: 0, total: capture.leftCount + capture.rightCount }); setDetail(undefined); setPage(1); setFilter('differences');
      setReportStatus(''); setReportError('');
      /** 最终结果的私有快照与当前来源都通过复核后，才发布四计数和完整记录。 */
      function tick(): void {
        if (active.current !== run || draftRef.current !== draft || !alive.current) return;
        run.timer = undefined;
        if (!environment()) { cancelRun(); setView({ processed: 0, total: 0, error: text.stale }); return; }
        try {
          const progress = run.scan.step();
          if (active.current !== run || !environment()) { cancelRun(); setView({ processed: 0, total: 0, error: text.stale }); return; }
          if (progress.done) {
            const result = run.scan.result(); if (!result || !currentQueryResultComparison(capture, left!, right!)) { invalid.current = true; throw Error(text.stale); }
            if (!environment() || active.current !== run) throw Error(text.stale);
            active.current = undefined; setView({ run, ...progress, result });
          } else { setView({ run, ...progress }); run.timer = setTimeout(tick, 0); }
        } catch (reason) { if (!currentQueryResultComparison(capture, left!, right!)) invalid.current = true; cancelRun(); if (alive.current) setView({ processed: 0, total: 0, error: errorMessage(reason) }); }
      }
      run.timer = setTimeout(tick, 0);
    } catch (reason) { setView({ processed: 0, total: 0, error: errorMessage(reason) }); }
  }
  /** 停止保留窗口及显式匹配键；旧停止按钮不能取消后来一次手动开始的任务。 */
  function stop(run?: Run): void {
    if (committed.current !== ticket || !run || active.current !== run || draftRef.current !== draft || !environment()) return;
    cancelRun(); setView({ processed: 0, total: 0, error: text.stopped }); setDetail(undefined);
  }
  /** 关闭不等待扫描；父层尚未卸载也清除指标与详情并禁止旧动作继续。 */
  function close(): void { if (!alive.current || closed.current || report.current) return; closed.current = true; cancelRun(); setView({ processed: 0, total: 0 }); setDetail(undefined); onClose(); }

  if (view.result && view.run && !currentQueryResultComparison(view.run.capture, view.run.left, view.run.right)) invalid.current = true;
  const valid = environment(), result = valid && view.run?.draft === draft && draftRef.current === draft ? view.result : undefined;
  const running = active.current !== undefined && active.current === view.run;
  const left = prepared.sources.find(source => source.id === draft.left), right = prepared.sources.find(source => source.id === draft.right);
  const alignment = useMemo(() => {
    if (!draft.byName || !left || !right || left === right) return {};
    try { return { columns: alignQueryResultComparisonColumns(left.columns, right.columns, dialect).map(pair => left.columns[pair.left]) }; }
    catch (reason) { return { error: errorMessage(reason) }; }
  }, [draft.byName, left, right, dialect]);
  const columns = (draft.byName ? alignment.columns : left?.columns) ?? [];
  const names = new Map(columns.map(column => [column.key, column.name || column.key]));
  const indexed = useMemo(() => result?.rows.map((row, index) => ({ row, index })).filter(({ row }) => filter === 'all' || filter === 'differences' ? filter === 'all' || row.kind !== 'equal' : row.kind === filter) ?? [], [result, filter]);
  const pages = Math.max(1, Math.ceil(indexed.length / 50)), currentPage = Math.min(page, pages), visible = indexed.slice((currentPage - 1) * 50, currentPage * 50);
  /** 结果浏览同样拒绝旧渲染回调；详情只从该次捕获的安全原值快照取得。 */
  function resultCurrent(): boolean { return !report.current && committed.current === ticket && !!result && view.result === result && last.current === view.run && draftRef.current === draft && sourceCurrent(); }
  /** 文件框打开前冻结整个分类，返回后再核原来源。写入沿用原子文件任务和取消入口。 */
  async function exportReport(): Promise<void> {
    if (!indexed.length || !view.run || !resultCurrent()) return;
    const run = view.run, operation = { taskId: uid(), writing: false };
    const current = () => report.current === operation && last.current === run && draftRef.current === run.draft && environment();
    setReportError(''); setReportStatus('');
    try {
      const data = snapshotQueryResultComparisonReport(run.capture, indexed.map(({ row }) => row));
      report.current = operation; setReportPhase('choosing');
      const file = await invoke('files.choose', { purpose: 'export', format: 'json', suggestedName: text.reportName });
      if (!file || !current() || !sourceCurrent()) return;
      operation.writing = true; setReportPhase('writing');
      const saved = await invoke('files.exportResult', { fileToken: file.token, taskId: operation.taskId, format: 'json', encoding: 'utf8', result: data });
      if (current()) setReportStatus(text.reportSaved(saved.rows));
    } catch (reason) {
      if (alive.current && (!report.current || current())) setReportError(errorMessage(reason));
    } finally {
      if (report.current === operation) { report.current = undefined; if (alive.current) setReportPhase(undefined); }
    }
  }
  function cancelReport(): void {
    const operation = report.current;
    if (operation?.writing) void invoke('query.cancel', { taskId: operation.taskId })
      .catch(reason => { if (alive.current && report.current === operation) setReportError(errorMessage(reason)); });
  }
  function show(row: QueryResultComparisonRow): void {
    if (!resultCurrent()) return;
    try { setDetail({ run: view.run!, row, values: queryResultComparisonValues(view.run!.capture, row) }); }
    catch (reason) { invalid.current = true; setView({ processed: 0, total: 0, error: errorMessage(reason) }); }
  }
  const kindLabel = (kind: QueryResultComparisonRow['kind']) => text[kind];
  const leftLabel = offline ? text.leftFile : text.left, rightLabel = offline ? text.rightFile : text.right;
  return <div data-query-result-comparison-owner={owner}><Modal title={offline ? text.fileTitle : text.title} onClose={close} wide><div className="modal-content">
    <p>{offline ? text.fileNotice : text.notice}</p><UsageHelp><p>{columns.some(column => column.type === 'SQLITE') ? text.sqliteKeysHint : dialect === 'postgresql' ? text.postgresKeysHint : text.keysHint}</p><p>{draft.byName ? text.alignmentHint : text.identity}</p></UsageHelp>{(left?.truncated || right?.truncated) && <p role="note">{text.truncated}</p>}
    <div className="filter-inputs"><label>{leftLabel}<select aria-label={leftLabel} value={draft.left} disabled={!valid || !!reportPhase} onChange={event => { if (!event.defaultPrevented && !event.nativeEvent?.defaultPrevented) change({ ...draft, left: event.target.value, keys: [] }); }}>{prepared.sources.map(source => <option key={source.id} value={source.id}>{source.label}</option>)}</select></label>
      <label>{rightLabel}<select aria-label={rightLabel} value={draft.right} disabled={!valid || !!reportPhase} onChange={event => { if (!event.defaultPrevented && !event.nativeEvent?.defaultPrevented) change({ ...draft, right: event.target.value, keys: [] }); }}>{prepared.sources.map(source => <option key={source.id} value={source.id}>{source.label}</option>)}</select></label></div>
    <label className="check"><input type="checkbox" checked={draft.byName} disabled={!valid || !!reportPhase} onChange={event => {
      if (!event.defaultPrevented && !event.nativeEvent?.defaultPrevented) change({ ...draft, byName: event.target.checked, keys: [] });
    }}/>{text.alignByName}</label>
    {draft.byName && <p>{text.alignmentHint}</p>}
    {alignment.columns && left && right && <p>{text.alignedColumns(columns.length, left.columns.length - columns.length, right.columns.length - columns.length)}</p>}
    <ErrorBox message={alignment.error}/>
    <fieldset disabled={!valid || !!reportPhase}><legend>{text.keys}</legend>{columns.map(column => { const reason = queryResultComparisonKeyReason(column, dialect), checked = draft.keys.includes(column.key); return <label key={column.key} className="check" title={reason}><input type="checkbox" aria-label={text.key(column.key)} checked={checked} disabled={!valid || !!reason || !checked && draft.keys.length >= 8} onChange={event => { if (!event.defaultPrevented && !event.nativeEvent?.defaultPrevented) change({ ...draft, keys: event.target.checked ? [...draft.keys, column.key] : draft.keys.filter(key => key !== column.key) }); }}/>{column.name || column.key} · {column.key}{reason && <span> · {reason}</span>}</label>; })}</fieldset>
    <p>{text.selectKeys}</p>{!valid && !closed.current && <ErrorBox message={text.stale}/>}<ErrorBox message={view.error}/>
    {running && valid && <p role="status">{text.scanning} {text.progress(view.processed, view.total)}</p>}
    {result && <section aria-label={text.rows}><div className="filter-inputs">{(['added', 'removed', 'changed', 'equal'] as const).map(kind => <label key={kind}>{text[kind]} <output aria-label={text[kind]}>{result[kind]}</output></label>)}</div>
      <label>{text.filter}<select aria-label={text.filter} value={filter} disabled={!!reportPhase} onChange={event => { if (!event.defaultPrevented && !event.nativeEvent?.defaultPrevented && resultCurrent() && ['all', 'differences', 'added', 'removed', 'changed', 'equal'].includes(event.target.value)) { setFilter(event.target.value as Filter); setPage(1); setDetail(undefined); setReportStatus(''); setReportError(''); } }}>{(['differences', 'all', 'added', 'removed', 'changed', 'equal'] as const).map(kind => <option key={kind} value={kind}>{kind === 'all' ? text.all : kind === 'differences' ? text.differences : text[kind]}</option>)}</select></label>
      <table aria-label={text.rows}><thead><tr><th>{text.filter}</th><th>{text.leftRow}</th><th>{text.rightRow}</th><th>{text.changedColumns}</th><th>{text.detailsTitle}</th></tr></thead><tbody>{visible.map(({ row, index }) => <tr key={index}><td>{kindLabel(row.kind)}</td><td>{row.leftIndex === undefined ? text.missing : row.leftIndex + 1}</td><td>{row.rightIndex === undefined ? text.missing : row.rightIndex + 1}</td><td>{row.changedColumns.map(key => names.get(key) ?? key).join('、')}</td><td><button disabled={!!reportPhase} onClick={() => show(row)} aria-label={text.details(index)}>{text.details(index)}</button></td></tr>)}</tbody></table>{!visible.length && <p>{text.noRows}</p>}
      <div className="filter-inputs"><button disabled={!!reportPhase || currentPage <= 1} onClick={() => { if (resultCurrent()) { setPage(currentPage - 1); setDetail(undefined); } }}>{text.previous}</button><span>{text.page(currentPage - 1, pages)}</span><button disabled={!!reportPhase || currentPage >= pages} onClick={() => { if (resultCurrent()) { setPage(currentPage + 1); setDetail(undefined); } }}>{text.next}</button></div>
      {detail && detail.run === view.run && <section aria-label={text.detailsTitle}><h3>{text.detailsTitle}</h3><dl>{detail.values.map(value => <div key={value.column}><dt>{value.name || value.column} · {value.column}{value.changed && ` · ${text.changed}`}</dt><dd aria-label={`${text.leftValue} ${value.column}`} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{text.leftValue}：{valueText(value.left)}{value.leftType && ` · ${text.sqliteType(value.leftType)}`}</dd><dd aria-label={`${text.rightValue} ${value.column}`} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{text.rightValue}：{valueText(value.right)}{value.rightType && ` · ${text.sqliteType(value.rightType)}`}</dd></div>)}</dl></section>}
    </section>}
    {reportPhase && <p role="status">{reportPhase === 'choosing' ? text.reportChoosing : text.reportWriting}</p>}
    {reportStatus && <p role="status">{reportStatus}</p>}<ErrorBox message={reportError}/>
  </div><footer className="modal-footer"><button disabled={!valid || running || !!reportPhase || !draft.keys.length || draft.left === draft.right} onClick={start}>{text.start}</button><button disabled={!valid || !running} onClick={() => stop(view.run)}>{text.stop}</button><span className="grow"/>
    {reportPhase === 'writing' ? <button onClick={cancelReport}>{text.reportCancel}</button> : result &&
      <button disabled={!!reportPhase || !indexed.length} title={text.reportScope} onClick={() => void exportReport()}>{text.exportReport}</button>}
    <button disabled={!!reportPhase} onClick={close}>{text.close}</button></footer></Modal></div>;
}
