import { useEffect, useRef, useState } from 'react';
import type { QueryFileEncoding, QueryOutcome, QueryResult } from '../../shared/contracts';
import { csvExportOptions, type CsvExportDelimiter } from '../../shared/csvExport';
import { validateResultArchiveOptions } from '../../shared/resultExcel';
import { resultExcelZh } from '../../shared/resultExcel.zh-CN';
import { resultArchiveFormats, resultArchiveMaxSets, resultExportLimits, type ResultArchiveFormat } from '../../shared/resultExport';
import { queryResultTitle, validQueryResultTitle } from '../../shared/queryResultTitle';
import { errorMessage, invoke, uid } from '../lib';
import { resultArchiveZh as text } from '../locales/resultArchive.zh-CN';
import { zh } from '../locales/zh-CN';
import { resultExportData } from '../resultExport';
import { projectQueryResultRows } from '../queryResultColumns';
import type { QueryResultArchiveView } from '../queryResultArchiveView';
import { acquireWorkspaceBusy, useWorkspace, type WorkspaceBusyLease } from '../store';
import { CsvExportDelimiterField } from './CsvExportDelimiter';
import { ErrorBox, Field, Modal } from './ui';

interface Props {
  outcome: QueryOutcome;
  tabId: string;
  dialect: 'mysql' | 'sqlite' | 'postgresql';
  identity: string;
  organizedView(source: QueryResult): QueryResultArchiveView;
  isCurrent(): boolean;
  onClose(): void;
}

const archiveFormats = {
  zip: { name: text.zip, notice: text.notice, fileName: text.fileName, start: text.start },
  xlsx: { name: text.xlsx, notice: text.excelNotice, fileName: text.excelFileName, start: text.startExcel },
  json: { name: text.json, notice: text.jsonNotice, fileName: text.jsonFileName, start: text.startJson },
};

/** 文件选择和写入绑定到同一次明确操作；旧标签回执不能写入或替换另一份结果。 */
export function ResultArchiveDialog({ outcome, tabId, dialect, identity, organizedView, isCurrent, onClose }: Props) {
  const [choices] = useState(() => outcome.results.flatMap((result, index) => {
    if (!result.columns.length) return [];
    const title = outcome.resultTitles?.[index] ?? queryResultTitle(result.statement, dialect);
    return [{ sourceOrdinal: index + 1, label: validQueryResultTitle(title) ? title : undefined, result }];
  }));
  const [selected, setSelected] = useState(() => new Set(choices.map(choice => choice.sourceOrdinal)));
  const [openedIdentity] = useState(identity);
  const [scope, setScope] = useState<'original' | 'organized'>('original');
  const [format, setFormat] = useState<ResultArchiveFormat>('zip');
  const [encoding, setEncoding] = useState<QueryFileEncoding>('utf8');
  const [delimiter, setDelimiter] = useState<CsvExportDelimiter>(',');
  const [phase, setPhase] = useState<'idle' | 'picking' | 'writing' | 'cancelling'>('idle');
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ rows: number; sets: number }>();
  const [invalid, setInvalid] = useState(false);
  const revoked = useRef(false), alive = useRef(true), occupied = useRef(false), task = useRef('');
  const check = useRef({ isCurrent, identity });
  check.current = { isCurrent, identity };
  const current = () => alive.current && !revoked.current && check.current.isCurrent() && check.current.identity === openedIdentity &&
    useWorkspace.getState().settings.activeTabId === tabId;
  useEffect(() => {
    alive.current = true;
    const unsubscribe = useWorkspace.subscribe(state => {
      if (state.settings.activeTabId !== tabId && !revoked.current) {
        revoked.current = true;
        setInvalid(true);
      }
    });
    return () => {
      alive.current = false;
      unsubscribe();
      if (task.current) void invoke('query.cancel', { taskId: task.current }).catch(() => {});
    };
  }, [tabId]);

  async function save() {
    if (occupied.current || !selected.size || !current()) return;
    occupied.current = true;
    setPhase('picking');
    setError('');
    setDone(undefined);
    let lease: WorkspaceBusyLease | undefined;
    try {
      lease = acquireWorkspaceBusy(tabId);
      if (selected.size > resultArchiveMaxSets) throw Error(text.tooManyResults(resultArchiveMaxSets));
      let rows = 0, cells = 0;
      const entries = choices.filter(choice => selected.has(choice.sourceOrdinal)).map(choice => {
        const view = scope === 'organized' ? organizedView(choice.result) : { result: choice.result, columns: choice.result.columns };
        // 在复制可见数据前检查全部选中结果累计的行列规模，IPC 仍使用既有校验。
        rows += view.result.rows.length;
        cells += view.result.rows.length * view.columns.length;
        if (rows > resultExportLimits.rows || cells > resultExportLimits.cells) throw Error(text.tooManyCells);
        const projected = view.columns === view.result.columns ? resultExportData(view.result) : projectQueryResultRows(view.result, view.columns);
        return { sourceOrdinal: choice.sourceOrdinal, ...(choice.label ? { label: choice.label } : {}), result: projected };
      });
      const options = format === 'zip' ? { format, encoding, ...csvExportOptions('csv', delimiter) } : { format, encoding: 'utf8' as const };
      validateResultArchiveOptions({ ...options, entries });
      const snapshot = structuredClone(entries);
      const file = await invoke('files.choose', { purpose: 'export', format, suggestedName: archiveFormats[format].fileName });
      if (!file) return;
      if (!current() || !lease.owns()) throw Error(text.stale);
      const taskId = task.current = uid();
      setPhase('writing');
      const output = await invoke('files.exportResultArchive', { fileToken: file.token, taskId, ...options, entries: snapshot });
      if (alive.current) setDone(output);
    } catch (reason) {
      if (alive.current) setError(errorMessage(reason));
    } finally {
      task.current = '';
      occupied.current = false;
      lease?.release();
      if (alive.current) setPhase('idle');
    }
  }

  async function cancel() {
    if (!task.current || phase !== 'writing') return;
    const id = task.current;
    setPhase('cancelling');
    try { await invoke('query.cancel', { taskId: id }); }
    catch (reason) { if (alive.current && task.current === id) { setError(errorMessage(reason)); setPhase('writing'); } }
  }

  const busy = phase !== 'idle';
  const stale = invalid || identity !== openedIdentity;
  const close = () => { if (!occupied.current) onClose(); };
  return <Modal title={text.title} onClose={close} wide>
    <div className="modal-content">
      <p>{archiveFormats[format].notice}</p>
      <p>{scope === 'organized' ? text.organizedScope : text.scope}</p>
      <fieldset disabled={busy || stale}><legend>{text.selection}</legend>
        <div className="inline-field"><button type="button" onClick={() => setSelected(new Set(choices.map(choice => choice.sourceOrdinal)))}>{text.selectAll}</button>
          <button type="button" onClick={() => setSelected(new Set())}>{text.clear}</button></div>
        {choices.map(({ sourceOrdinal, label, result }) => <label key={sourceOrdinal} className="check">
          <input type="checkbox" checked={selected.has(sourceOrdinal)} onChange={event => {
            const checked = event.currentTarget.checked;
            setSelected(previous => { const next = new Set(previous); if (checked) next.add(sourceOrdinal); else next.delete(sourceOrdinal); return next; });
          }}/>{text.item(sourceOrdinal, label)} · {scope === 'organized' ? text.sourceRows(result.rows.length) : text.rows(result.rows.length)}{result.truncated ? ` · ${text.truncated}` : ''}
        </label>)}
      </fieldset>
      <div className="form-grid">
        <Field label={text.dataScope}><select aria-label={text.dataScope} value={scope} disabled={busy || stale} onChange={event => {
          setScope(event.target.value === 'organized' ? 'organized' : 'original');
          setError(''); setDone(undefined);
        }}><option value="original">{text.original}</option><option value="organized">{text.organized}</option></select></Field>
        <Field label={text.format}><select aria-label={text.format} value={format} disabled={busy || stale} onChange={event => {
          const value = event.target.value;
          if (value === 'zip' || value === 'xlsx' || value === 'json') { setFormat(value); setError(''); setDone(undefined); }
        }}>{resultArchiveFormats.map(format => <option key={format} value={format}>{archiveFormats[format].name}</option>)}</select></Field>
        {format === 'zip' && <Field label={text.encoding}><select aria-label={text.encoding} value={encoding} disabled={busy || stale} onChange={event => setEncoding(event.target.value as QueryFileEncoding)}>
          <option value="utf8">UTF-8</option><option value="utf16le">UTF-16 LE</option><option value="gb18030">GB18030</option>
        </select></Field>}
        {format === 'zip' && <CsvExportDelimiterField value={delimiter} disabled={busy || stale} onChange={setDelimiter}/>}
      </div>
      {format === 'xlsx' && <p>{resultExcelZh.numbers}</p>}
      <ErrorBox message={error || (stale ? text.stale : undefined)}/>
      {done && <p role="status">{text.done(done.sets, done.rows)}</p>}
    </div>
    <footer className="modal-footer"><span className="grow"/>
      {(phase === 'writing' || phase === 'cancelling') && <button type="button" disabled={phase === 'cancelling'} onClick={() => void cancel()}>{phase === 'cancelling' ? text.cancelling : text.cancel}</button>}
      <button type="button" disabled={busy} onClick={close}>{zh.common.close}</button>
      <button type="button" className="primary" disabled={busy || stale || !selected.size} onClick={() => void save()}>{phase === 'writing' || phase === 'cancelling' ? text.saving : archiveFormats[format].start}</button>
    </footer>
  </Modal>;
}
