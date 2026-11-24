import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CellValue, QueryResult, ResultColumn } from '../../shared/contracts';
import { assertResultExcelData } from '../../shared/resultExcel';
import { resultExcelZh } from '../../shared/resultExcel.zh-CN';
import { pinLimits } from '../queryPins';
import { alignQueryResultComparisonColumns, captureQueryResultComparison, currentQueryResultComparison, queryResultComparisonKeyReason, queryResultComparisonLimits, queryResultComparisonLocation, queryResultComparisonValues, sameQueryResultComparisonColumnType, searchQueryResultComparisonKeys, snapshotQueryResultComparisonReport, QueryResultComparisonScan, type QueryResultComparisonBaseline, type QueryResultComparisonCapture, type QueryResultComparisonColumnPair, type QueryResultComparisonLocation, type QueryResultComparisonResult, type QueryResultComparisonRow, type QueryResultComparisonSource, type QueryResultComparisonValue } from '../queryResultComparison';
import { queryResultComparisonZh as text } from '../locales/queryResultComparison.zh-CN';
import { sameQueryResultComparisonSettings, type QueryResultComparisonSettings, type QueryResultComparisonSettingsMemory } from '../queryResultComparisonSettings';
import type { SortDialect } from '../queryResultSort';
import { errorMessage, invoke, uid } from '../lib';
import { UsageHelp, ErrorBox, Modal  } from './ui';

interface Props {
  inputs: readonly QueryResultComparisonSource[];
  owner: string;
  dialect?: SortDialect;
  offline?: boolean;
  returned?: { preferredId: string; baseline?: QueryResultComparisonBaseline };
  settings?: { memory: QueryResultComparisonSettingsMemory; scope: string };
  isCurrent(): boolean;
  onLocate?(location: QueryResultComparisonLocation): boolean;
  onClose(): void;
}
type Draft = QueryResultComparisonSettings & { left: string; right: string };
const emptyPair: QueryResultComparisonColumnPair = { left: '', right: '' };
type Source = { input: QueryResultComparisonSource; id: string; key: string; label: string; result: QueryResult; columns: readonly ResultColumn[]; truncated: boolean };
type Run = { draft: Draft; left: QueryResult; right: QueryResult; capture: QueryResultComparisonCapture; scan: QueryResultComparisonScan; timer?: ReturnType<typeof setTimeout> };
type View = { run?: Run; processed: number; total: number; result?: QueryResultComparisonResult; error?: string };
type Filter = 'all' | 'differences' | QueryResultComparisonRow['kind'];
const resultFilters: readonly Filter[] = ['differences', 'all', 'added', 'removed', 'changed', 'equal'];
const reportFormats = {
  json: { label: 'JSON', fileName: text.reportName },
  csv: { label: 'CSV', fileName: text.reportCsvName },
  xlsx: { label: resultExcelZh.format, fileName: text.reportExcelName },
};
type ReportFormat = keyof typeof reportFormats;

/** 自有数据字段是唯一读取入口，来源或列字段上的访问器不能在界面渲染时执行。 */
function own(value: unknown, key: PropertyKey): unknown {
  if (!value || typeof value !== 'object') throw Error(text.identity);
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !('value' in descriptor)) throw Error(text.identity);
  return descriptor.value;
}
/** 下拉列表只拷贝有界元数据，源SQL和行值仅由真实对比捕获器按需准入。 */
function sources(inputs: readonly QueryResultComparisonSource[], kind: 'shared' | 'returned' | 'baseline' | 'current'): Source[] {
  const count = own(inputs, 'length');
  const separate = kind === 'baseline' || kind === 'current';
  const maximum = kind === 'shared' || kind === 'baseline' ? pinLimits.count : Infinity;
  if (!Array.isArray(inputs) || !Number.isSafeInteger(count) || (count as number) < (separate ? 1 : 2) || (count as number) > maximum)
    throw Error(separate ? text.baselineRequired : kind === 'returned' ? text.returnedRequireTwo : text.requireTwo);
  const output: Source[] = [];
  for (let index = 0; index < (count as number); index++) {
    const input = own(inputs, String(index)) as QueryResultComparisonSource, id = own(input, 'id'), label = own(input, 'label'), result = own(input, 'result') as QueryResult;
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
    output.push({ input, id, key: kind === 'baseline' ? 'baseline:' + id : id, label, result, columns, truncated });
  }
  if (new Set(output.map(source => source.id)).size !== output.length) throw Error(text.identity);
  return output;
}
/** 核对准备时捕获的两侧来源，避免旧选择或报告文件框转写到后来替换的来源。 */
function sameSources(inputs: readonly QueryResultComparisonSource[], prepared: readonly Source[]): boolean {
  return own(inputs, 'length') === prepared.length && prepared.every((source, index) =>
    own(inputs, String(index)) === source.input && own(source.input, 'id') === source.id &&
    own(source.input, 'label') === source.label && own(source.input, 'result') === source.result);
}
/** 字符串显式引号，空串、NULL、整行缺失和原生字节各自明确区分。 */
function valueText(value: CellValue | undefined): string {
  if (value === undefined) return text.missing;
  if (value === null) return text.nullValue;
  if (typeof value === 'string') return JSON.stringify(value) + (value === '' ? ` · ${text.emptyString}` : '');
  if (typeof value === 'object') return `${text.binary} ${value.base64}`;
  return String(value);
}

/** 搜索词先留在输入框，明确提交后才扫描已发布差异，组词时保留输入法行为。 */
function ComparisonKeySearch({ query, disabled, onApply }: { query: string; disabled: boolean; onApply(value: string): boolean }) {
  const [draft, setDraft] = useState(query);
  const composing = useRef(false);
  return <form role="search" aria-label={text.keySearch} className="filter-inputs" onSubmit={event => {
    event.preventDefault();
    if (!disabled && !composing.current && draft !== query) onApply(draft);
  }}>
    <input type="search" aria-label={text.keySearch} aria-description={text.keySearchHint} placeholder={text.keySearch}
      disabled={disabled} value={draft} maxLength={queryResultComparisonLimits.valueUnits} onChange={event => setDraft(event.target.value)}
      onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
      onKeyDown={event => { if (event.key === 'Enter' && (composing.current || event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault(); }}/>
    <button type="submit" disabled={disabled || draft === query}>{text.applyKeySearch}</button>
    {query && <button type="button" disabled={disabled} onClick={() => { if (onApply('')) setDraft(''); }}>{text.clearKeySearch}</button>}
  </form>;
}

/** 对比原返回数据。选择来源和匹配键后，由同一套扫描器计算结果和差异报告。 */
export function QueryResultComparisonDialog({ inputs, owner, dialect, offline = false, returned, settings, isCurrent, onLocate, onClose }: Props) {
  const baseline = returned?.baseline;
  const ownerIdentity = { inputs, baselineInputs: baseline?.inputs, owner, dialect, memory: settings?.memory, scope: settings?.scope };
  const origin = useRef(ownerIdentity).current;
  const latest = useRef({ ...ownerIdentity, isCurrent });
  latest.current = { ...ownerIdentity, isCurrent };
  const [prepared] = useState(() => {
    try {
      const right = sources(inputs, baseline ? 'current' : returned ? 'returned' : 'shared');
      return { left: baseline ? sources(baseline.inputs, 'baseline') : right, right, error: '' };
    } catch (reason) {
      return { left: [] as Source[], right: [] as Source[], error: errorMessage(reason) };
    }
  });
  const [draft, setDraft] = useState<Draft>(() => {
    const options = prepared.right;
    const preferred = options.findIndex(source => source.id === returned?.preferredId);
    const left = baseline ? prepared.left.find(source => source.id === baseline.preferredId) ?? prepared.left.at(-1)
      : options[Math.max(preferred, 0)];
    const right = baseline ? options[Math.max(preferred, 0)]
      : preferred >= 0 ? options[(preferred + 1) % options.length] : options.at(-1);
    return { left: left?.key ?? '', right: right?.key ?? '', keys: [], mode: 'strict', pairs: [] };
  });
  const [candidate, setCandidate] = useState(emptyPair);
  const draftRef = useRef(draft), [view, setView] = useState<View>({ processed: 0, total: 0, error: prepared.error });
  const [filter, setFilter] = useState<Filter>('differences'), [page, setPage] = useState(1), [detail, setDetail] = useState<{ run: Run; row: QueryResultComparisonRow; values: readonly QueryResultComparisonValue[] }>();
  const [changedColumn, setChangedColumn] = useState('');
  const [keySearch, setKeySearch] = useState<{ query: string; matches: ReadonlySet<QueryResultComparisonRow> }>();
  const [keySearchError, setKeySearchError] = useState('');
  const active = useRef<Run | undefined>(undefined), last = useRef<Run | undefined>(undefined), alive = useRef(true), invalid = useRef(false), closed = useRef(false);
  const report = useRef<{ taskId: string; writing: boolean } | undefined>(undefined);
  const locating = useRef(false);
  const [reportFormat, setReportFormat] = useState<ReportFormat>('json');
  const [reportPhase, setReportPhase] = useState<'choosing' | 'writing'>(), [reportStatus, setReportStatus] = useState(''), [reportError, setReportError] = useState('');
  const committed = useRef<object | undefined>(undefined), ticket = {};

  /** 每批只核准确来源数组与元数据身份；原行及单元格的完整核验由最终发布负责。 */
  function environment(): boolean {
    if (!alive.current || invalid.current || closed.current) return false;
    let valid = false;
    try {
      valid = latest.current.inputs === origin.inputs && latest.current.baselineInputs === origin.baselineInputs &&
        latest.current.owner === origin.owner && latest.current.dialect === origin.dialect &&
        latest.current.memory === origin.memory && latest.current.scope === origin.scope && latest.current.isCurrent() === true &&
        sameSources(inputs, prepared.right) && (!baseline || sameSources(baseline.inputs, prepared.left));
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
  function resetResultPage(): void {
    setPage(1); setDetail(undefined); setReportStatus(''); setReportError('');
  }
  function resetResultFilters(): void {
    setFilter('differences'); setChangedColumn(''); setKeySearch(undefined); setKeySearchError('');
    resetResultPage();
  }
  /** 切源与键编辑同步撤销旧扫描及结果，选择新源后要求重新明确勾选键。 */
  function change(next: Draft): void {
    if (report.current || committed.current !== ticket || draftRef.current !== draft || !sourceCurrent()) return;
    const left = prepared.left.find(source => source.key === next.left), right = prepared.right.find(source => source.key === next.right);
    if (!left || !right || next.keys.length > 8 || new Set(next.keys).size !== next.keys.length) return;
    if (next.keys.length) {
      let keyColumns: readonly ResultColumn[] = columns;
      if (next.mode !== draft.mode || next.pairs !== draft.pairs) {
        try {
          keyColumns = next.mode === 'name' ? alignQueryResultComparisonColumns(left.columns, right.columns, dialect).map(pair => left.columns[pair.left])
            : next.mode === 'manual' ? left.columns.filter(column => next.pairs.some(pair => pair.left === column.key)) : left.columns;
        } catch { return; }
      }
      if (next.keys.some(key => !keyColumns.some(column => column.key === key && !queryResultComparisonKeyReason(column, dialect)))) return;
    }
    if (next.pairs !== draft.pairs) setCandidate(emptyPair);
    cancelRun(); draftRef.current = next; setDraft(next); setView({ processed: 0, total: 0 });
    resetResultFilters();
  }
  /** 单次明确开始才捕获两份真实结果；扫描中不显示部分计数或部分差异。 */
  function start(): void {
    if (report.current || committed.current !== ticket || draftRef.current !== draft || active.current || !draft.keys.length || draft.keys.length > 8 || draft.left === draft.right || !sourceCurrent()) return;
    const left = prepared.left.find(source => source.key === draft.left)?.result, right = prepared.right.find(source => source.key === draft.right)?.result;
    if (!left || !right) return;
    try {
      cancelRun();
      const capture = captureQueryResultComparison(left, right, draft.keys, dialect, draft.mode === 'manual' ? draft.pairs : draft.mode);
      const run: Run = { draft, left, right, capture, scan: new QueryResultComparisonScan(capture) };
      last.current = run; active.current = run; setView({ run, processed: 0, total: capture.leftCount + capture.rightCount });
      resetResultFilters();
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
            settings?.memory.remember(settings.scope, dialect, left!.columns, right!.columns, draft);
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
  const left = prepared.left.find(source => source.key === draft.left), right = prepared.right.find(source => source.key === draft.right);
  const previousSettings = left && right && left !== right ? settings?.memory.read(settings.scope, dialect, left.columns, right.columns) : undefined;
  const alignment = useMemo(() => {
    if (draft.mode !== 'name' || !left || !right || left === right) return {};
    try { return { columns: alignQueryResultComparisonColumns(left.columns, right.columns, dialect).map(pair => left.columns[pair.left]) }; }
    catch (reason) { return { error: errorMessage(reason) }; }
  }, [draft.mode, left, right, dialect]);
  const leftPairs = new Map(draft.pairs.map(pair => [pair.left, pair.right]));
  const usedRight = new Set(leftPairs.values());
  const columns = draft.mode === 'name' ? alignment.columns ?? []
    : (left?.columns ?? []).filter(column => draft.mode === 'strict' || leftPairs.has(column.key));
  const names = new Map(columns.map(column => [column.key, column.name || column.key]));
  const availableLeft = draft.mode === 'manual' ? left?.columns.filter(column => !leftPairs.has(column.key)) ?? [] : [];
  const candidateLeft = availableLeft.find(column => column.key === candidate.left);
  const availableRight = candidateLeft ? right?.columns.filter(column =>
    !usedRight.has(column.key) && sameQueryResultComparisonColumnType(candidateLeft.type, column.type, dialect)) ?? [] : [];
  const canAdd = !!candidateLeft && availableRight.some(column => column.key === candidate.right);
  const manualDisabled = !valid || !!reportPhase || left === right;
  const describeColumn = ({ key, name, type }: ResultColumn) => `${name || key} · ${key} · ${type}`;
  /** 候选列只属于本次来源和配对方式。真正添加时才清除旧匹配键和差异。 */
  function updateCandidate(next: QueryResultComparisonColumnPair): void {
    if (!manualDisabled && draft.mode === 'manual' && committed.current === ticket && draftRef.current === draft) setCandidate(next);
  }
  const indexed = useMemo(() => {
    const matches: { row: QueryResultComparisonRow; index: number }[] = [];
    result?.rows.forEach((row, index) => {
      const matchesKind = filter === 'all' || (filter === 'differences' ? row.kind !== 'equal' : row.kind === filter);
      if (matchesKind && (!changedColumn || row.kind === 'changed' && row.changedColumns.includes(changedColumn)) &&
          (!keySearch || keySearch.matches.has(row))) matches.push({ row, index });
    });
    return matches;
  }, [result, filter, changedColumn, keySearch]);
  const pages = Math.max(1, Math.ceil(indexed.length / 50)), currentPage = Math.min(page, pages), visible = indexed.slice((currentPage - 1) * 50, currentPage * 50);
  /** 结果浏览同样拒绝旧渲染回调；详情只从该次捕获的安全原值快照取得。 */
  function resultCurrent(): boolean { return !report.current && committed.current === ticket && !!result && view.result === result && last.current === view.run && draftRef.current === draft && sourceCurrent(); }
  function applyKeySearch(query: string): boolean {
    if (!result || !view.run || !resultCurrent()) return false;
    try {
      setKeySearch(query ? { query, matches: searchQueryResultComparisonKeys(view.run.capture, result.rows, query) } : undefined);
      setKeySearchError('');
      resetResultPage();
      return true;
    } catch (reason) {
      setKeySearchError(errorMessage(reason));
      return false;
    }
  }
  /** 文件框打开前冻结整个筛选范围，返回后再核原来源。 */
  async function exportReport(): Promise<void> {
    if (!indexed.length || !view.run || !resultCurrent()) return;
    const run = view.run, format = reportFormat, operation = { taskId: uid(), writing: false };
    const current = () => report.current === operation && last.current === run && draftRef.current === run.draft && environment();
    setReportError(''); setReportStatus('');
    try {
      const data = snapshotQueryResultComparisonReport(run.capture, indexed.map(({ row }) => row));
      // Excel 额外字符和单行预算在打开保存框前验证，避免选择目标后才发现格式不兼容。
      if (format === 'xlsx') assertResultExcelData(data);
      report.current = operation; setReportPhase('choosing');
      const file = await invoke('files.choose', { purpose: 'export', format, suggestedName: reportFormats[format].fileName });
      if (!file || !current() || !sourceCurrent()) return;
      operation.writing = true; setReportPhase('writing');
      const saved = await invoke('files.exportResult', { fileToken: file.token, taskId: operation.taskId, format, encoding: 'utf8', result: data });
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
  /** 当前差异与父查看器仍归本次来源时，才请求回到原结果。 */
  function locateOriginal(side: 'left' | 'right'): void {
    if (!onLocate || !detail || detail.run !== view.run || !resultCurrent()) return;
    try {
      const location = queryResultComparisonLocation(detail.run.capture, detail.row, side);
      if (location) {
        // 父网格接管焦点后，关闭对比窗口时不再还给原按钮。
        locating.current = true;
        if (!onLocate(location)) locating.current = false;
      }
    } catch (reason) {
      invalid.current = true; setView({ processed: 0, total: 0, error: errorMessage(reason) }); setDetail(undefined);
    }
  }
  const kindLabel = (kind: QueryResultComparisonRow['kind']) => text[kind];
  const labels = offline ? { title: text.fileTitle, left: text.leftFile, right: text.rightFile, notice: text.fileNotice }
    : baseline ? { title: text.baselineTitle, left: text.baselineLeft, right: text.baselineRight, notice: text.baselineNotice }
    : returned ? { title: text.returnedTitle, left: text.leftReturned, right: text.rightReturned, notice: text.returnedNotice }
    : { title: text.title, left: text.left, right: text.right, notice: text.notice };
  const { left: leftLabel, right: rightLabel } = labels;
  return <div data-query-result-comparison-owner={owner}><Modal title={labels.title} onClose={close} shouldRestoreFocus={() => !locating.current} wide><div className="modal-content">
    <p>{labels.notice}</p><UsageHelp><p>{columns.some(column => column.type === 'SQLITE') ? text.sqliteKeysHint : dialect === 'postgresql' ? text.postgresKeysHint : text.keysHint}</p><p>{text.identity}</p></UsageHelp>{(left?.truncated || right?.truncated) && <p role="note">{text.truncated}</p>}
    <div className="filter-inputs"><label>{leftLabel}<select aria-label={leftLabel} value={draft.left} disabled={!valid || !!reportPhase} onChange={event => { if (!event.defaultPrevented && !event.nativeEvent?.defaultPrevented) change({ ...draft, left: event.target.value, keys: [], pairs: [] }); }}>{prepared.left.map(source => <option key={source.key} value={source.key}>{source.label}</option>)}</select></label>
      <label>{rightLabel}<select aria-label={rightLabel} value={draft.right} disabled={!valid || !!reportPhase} onChange={event => { if (!event.defaultPrevented && !event.nativeEvent?.defaultPrevented) change({ ...draft, right: event.target.value, keys: [], pairs: [] }); }}>{prepared.right.map(source => <option key={source.key} value={source.key}>{source.label}</option>)}</select></label>
      <label>{text.alignmentMode}<select aria-label={text.alignmentMode} value={draft.mode} disabled={!valid || !!reportPhase} onChange={event => {
        const mode = event.target.value;
        if (!event.defaultPrevented && !event.nativeEvent?.defaultPrevented && (mode === 'strict' || mode === 'name' || mode === 'manual')) change({ ...draft, mode, keys: [], pairs: [] });
      }}><option value="strict">{text.strictAlignment}</option><option value="name">{text.alignByName}</option><option value="manual">{text.manualAlignment}</option></select></label>
      {previousSettings && !sameQueryResultComparisonSettings(draft, previousSettings) && <button type="button"
        disabled={!valid || running || !!reportPhase} onClick={() => change({ ...draft, ...previousSettings })}>{text.reuseSettings}</button>}
    </div>
    {draft.mode === 'name' && <p>{text.alignmentHint}</p>}
    {draft.mode === 'manual' && <fieldset disabled={manualDisabled}><legend>{text.manualAlignment}</legend>
      <p>{text.manualHint}</p>
      <div className="filter-inputs">
        <label>{text.leftColumn}<select aria-label={text.leftColumn} value={candidate.left} onChange={event => updateCandidate({ left: event.target.value, right: '' })}>
          <option value="">{text.chooseColumn}</option>{availableLeft.map(column => <option key={column.key} value={column.key}>{describeColumn(column)}</option>)}
        </select></label>
        <label>{text.rightColumn}<select aria-label={text.rightColumn} value={candidate.right} disabled={!candidateLeft} onChange={event => updateCandidate({ ...candidate, right: event.target.value })}>
          <option value="">{text.chooseColumn}</option>{availableRight.map(column => <option key={column.key} value={column.key}>{describeColumn(column)}</option>)}
        </select></label>
        <button disabled={!canAdd || manualDisabled} onClick={() => {
          if (canAdd && !manualDisabled) change({ ...draft, pairs: [...draft.pairs, candidate], keys: [] });
        }}>{text.addPair}</button>
      </div>
      {draft.pairs.length > 0 && <ul>{columns.map(column => {
        const paired = right?.columns.find(item => item.key === leftPairs.get(column.key));
        return paired && <li key={column.key}>{describeColumn(column)} ↔ {describeColumn(paired)} <button aria-label={text.removePair(column.key)} onClick={() =>
          change({ ...draft, pairs: draft.pairs.filter(pair => pair.left !== column.key), keys: [] })}>{text.removePair(column.key)}</button></li>;
      })}</ul>}
    </fieldset>}
    {(draft.mode === 'manual' || alignment.columns) && left && right && <p>{text.alignedColumns(columns.length, left.columns.length - columns.length, right.columns.length - columns.length)}</p>}
    <ErrorBox message={alignment.error}/>
    <fieldset disabled={!valid || !!reportPhase}><legend>{text.keys}</legend>{columns.map(column => { const reason = queryResultComparisonKeyReason(column, dialect), checked = draft.keys.includes(column.key); return <label key={column.key} className="check" title={reason}><input type="checkbox" aria-label={text.key(column.key)} checked={checked} disabled={!valid || !!reason || !checked && draft.keys.length >= 8} onChange={event => { if (!event.defaultPrevented && !event.nativeEvent?.defaultPrevented) change({ ...draft, keys: event.target.checked ? [...draft.keys, column.key] : draft.keys.filter(key => key !== column.key) }); }}/>{column.name || column.key} · {column.key}{reason && <span> · {reason}</span>}</label>; })}</fieldset>
    <p>{text.selectKeys}</p>{!valid && !closed.current && <ErrorBox message={text.stale}/>}<ErrorBox message={view.error}/>
    {running && valid && <p role="status">{text.scanning} {text.progress(view.processed, view.total)}</p>}
    {result && <section aria-label={text.rows}><div className="filter-inputs">{(['added', 'removed', 'changed', 'equal'] as const).map(kind => <label key={kind}>{text[kind]} <output aria-label={text[kind]}>{result[kind]}</output></label>)}</div>
      <div className="filter-inputs">
        <label>{text.filter}<select aria-label={text.filter} value={filter} disabled={!!reportPhase} onChange={event => {
          const value = event.target.value as Filter;
          if (!event.defaultPrevented && !event.nativeEvent?.defaultPrevented && resultFilters.includes(value) && resultCurrent()) {
            setFilter(value); resetResultPage();
          }
        }}>{resultFilters.map(kind => <option key={kind} value={kind}>{kind === 'all' ? text.all : kind === 'differences' ? text.differences : text[kind]}</option>)}</select></label>
        <label>{text.changedColumn}<select aria-label={text.changedColumn} value={changedColumn} disabled={!!reportPhase} onChange={event => {
          const value = event.target.value;
          if (!event.defaultPrevented && !event.nativeEvent?.defaultPrevented &&
              (value === '' || result && view.run?.capture.columns.some(column => column.key === value)) && resultCurrent()) {
            setChangedColumn(value); resetResultPage();
          }
        }}><option value="">{text.allChangedColumns}</option>
          {view.run?.capture.columns.map(column => <option key={column.key} value={column.key}>{describeColumn(column)}</option>)}</select></label>
      </div>
      <ComparisonKeySearch query={keySearch?.query ?? ''} disabled={!!reportPhase} onApply={applyKeySearch}/>
      {(keySearch || changedColumn) && <p role="status">{text.filteredCount(indexed.length)}</p>}
      <ErrorBox message={keySearchError}/>
      <table aria-label={text.rows}><thead><tr><th>{text.filter}</th><th>{text.leftRow}</th><th>{text.rightRow}</th><th>{text.changedColumns}</th><th>{text.detailsTitle}</th></tr></thead><tbody>{visible.map(({ row, index }) => <tr key={index}><td>{kindLabel(row.kind)}</td><td>{row.leftIndex === undefined ? text.missing : row.leftIndex + 1}</td><td>{row.rightIndex === undefined ? text.missing : row.rightIndex + 1}</td><td>{row.changedColumns.map(key => names.get(key) ?? key).join('、')}</td><td><button disabled={!!reportPhase} onClick={() => show(row)} aria-label={text.details(index)}>{text.details(index)}</button></td></tr>)}</tbody></table>{!visible.length && <p>{text.noRows}</p>}
      <div className="filter-inputs"><button disabled={!!reportPhase || currentPage <= 1} onClick={() => { if (resultCurrent()) { setPage(currentPage - 1); setDetail(undefined); } }}>{text.previous}</button><span>{text.page(currentPage - 1, pages)}</span><button disabled={!!reportPhase || currentPage >= pages} onClick={() => { if (resultCurrent()) { setPage(currentPage + 1); setDetail(undefined); } }}>{text.next}</button></div>
      {detail && detail.run === view.run && <section aria-label={text.detailsTitle}><h3>{text.detailsTitle}</h3>{onLocate && <div className="filter-inputs">
        <button type="button" disabled={!!reportPhase || detail.row.leftIndex === undefined} onClick={() => locateOriginal('left')}>{text.locateLeft}</button>
        <button type="button" disabled={!!reportPhase || detail.row.rightIndex === undefined} onClick={() => locateOriginal('right')}>{text.locateRight}</button>
      </div>}<dl>{detail.values.map(value => <div key={value.column}><dt>{value.name || value.column} · {value.column}{value.rightColumn && ` ↔ ${value.rightName || value.rightColumn} · ${value.rightColumn}`}{value.changed && ` · ${text.changed}`}</dt><dd aria-label={`${text.leftValue} ${value.column}`} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{text.leftValue}：{valueText(value.left)}{value.leftType && ` · ${text.sqliteType(value.leftType)}`}</dd><dd aria-label={`${text.rightValue} ${value.column}`} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{text.rightValue}：{valueText(value.right)}{value.rightType && ` · ${text.sqliteType(value.rightType)}`}</dd></div>)}</dl></section>}
    </section>}
    {reportPhase && <p role="status">{reportPhase === 'choosing' ? text.reportChoosing : text.reportWriting}</p>}
    {reportStatus && <p role="status">{reportStatus}</p>}<ErrorBox message={reportError}/>
  </div><footer className="modal-footer"><button disabled={!valid || running || !!reportPhase || !draft.keys.length || draft.left === draft.right} onClick={start}>{text.start}</button><button disabled={!valid || !running} onClick={() => stop(view.run)}>{text.stop}</button><span className="grow"/>
    {result && <label>{text.reportFormat} <select aria-label={text.reportFormat} value={reportFormat} disabled={!!reportPhase} onChange={event => {
      const format = event.target.value as ReportFormat;
      if (Object.hasOwn(reportFormats, format) && resultCurrent()) {
        setReportFormat(format); setReportStatus(''); setReportError('');
      }
    }}>{Object.entries(reportFormats).map(([value, option]) => <option key={value} value={value}>{option.label}</option>)}</select></label>}
    {reportPhase === 'writing' ? <button onClick={cancelReport}>{text.reportCancel}</button> : result &&
      <button disabled={!!reportPhase || !indexed.length} title={text.reportScope} onClick={() => void exportReport()}>{text.exportReport}</button>}
    <button disabled={!!reportPhase} onClick={close}>{text.close}</button></footer></Modal></div>;
}
