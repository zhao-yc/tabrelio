import { useEffect, useRef, useState } from 'react';
import type { QueryFileEncoding, QueryOutcome } from '../../shared/contracts';
import { csvExportOptions, type CsvExportDelimiter } from '../../shared/csvExport';
import { validateResultArchive } from '../../shared/resultExport';
import { queryResultTitle, validQueryResultTitle } from '../../shared/queryResultTitle';
import { errorMessage, invoke, uid } from '../lib';
import { resultArchiveZh as text } from '../locales/resultArchive.zh-CN';
import { zh } from '../locales/zh-CN';
import { resultExportData } from '../resultExport';
import { acquireWorkspaceBusy, useWorkspace, type WorkspaceBusyLease } from '../store';
import { CsvExportDelimiterField } from './CsvExportDelimiter';
import { ErrorBox, Field, Modal } from './ui';

interface Props {
  outcome: QueryOutcome;
  tabId: string;
  dialect: 'mysql' | 'sqlite' | 'postgresql';
  isCurrent(): boolean;
  onClose(): void;
}

/** 文件选择和写入绑定到同一次明确操作；旧标签回执不能写入或替换另一份结果。 */
export function ResultArchiveDialog({ outcome, tabId, dialect, isCurrent, onClose }: Props) {
  const [choices] = useState(() => outcome.results.flatMap((result, index) => {
    if (!result.columns.length) return [];
    const title = outcome.resultTitles?.[index] ?? queryResultTitle(result.statement, dialect);
    return [{ sourceOrdinal: index + 1, label: validQueryResultTitle(title) ? title : undefined, result }];
  }));
  const [selected, setSelected] = useState(() => new Set(choices.map(choice => choice.sourceOrdinal)));
  const [encoding, setEncoding] = useState<QueryFileEncoding>('utf8');
  const [delimiter, setDelimiter] = useState<CsvExportDelimiter>(',');
  const [phase, setPhase] = useState<'idle' | 'picking' | 'writing' | 'cancelling'>('idle');
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ rows: number; sets: number }>();
  const [invalid, setInvalid] = useState(false);
  const revoked = useRef(false), alive = useRef(true), occupied = useRef(false), task = useRef('');
  const check = useRef(isCurrent);
  check.current = isCurrent;
  const current = () => alive.current && !revoked.current && check.current() && useWorkspace.getState().settings.activeTabId === tabId;
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
      const entries = choices.filter(choice => selected.has(choice.sourceOrdinal)).map(choice => ({
        sourceOrdinal: choice.sourceOrdinal, ...(choice.label ? { label: choice.label } : {}), result: resultExportData(choice.result),
      }));
      validateResultArchive(entries);
      const snapshot = structuredClone(entries);
      const file = await invoke('files.choose', { purpose: 'export', format: 'zip', suggestedName: text.fileName });
      if (!file) return;
      if (!current() || !lease.owns()) throw Error(text.stale);
      const taskId = task.current = uid();
      setPhase('writing');
      const output = await invoke('files.exportResultArchive', { fileToken: file.token, taskId, encoding, ...csvExportOptions('csv', delimiter), entries: snapshot });
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
  const close = () => { if (!occupied.current) onClose(); };
  return <Modal title={text.title} onClose={close} wide>
    <div className="modal-content">
      <p>{text.notice}</p><p>{text.scope}</p>
      <fieldset disabled={busy || invalid}><legend>{text.selection}</legend>
        <div className="inline-field"><button type="button" onClick={() => setSelected(new Set(choices.map(choice => choice.sourceOrdinal)))}>{text.selectAll}</button>
          <button type="button" onClick={() => setSelected(new Set())}>{text.clear}</button></div>
        {choices.map(({ sourceOrdinal, label, result }) => <label key={sourceOrdinal} className="check">
          <input type="checkbox" checked={selected.has(sourceOrdinal)} onChange={event => {
            const checked = event.currentTarget.checked;
            setSelected(previous => { const next = new Set(previous); if (checked) next.add(sourceOrdinal); else next.delete(sourceOrdinal); return next; });
          }}/>{text.item(sourceOrdinal, label)} · {text.rows(result.rows.length)}{result.truncated ? ` · ${text.truncated}` : ''}
        </label>)}
      </fieldset>
      <div className="form-grid">
        <Field label={text.encoding}><select aria-label={text.encoding} value={encoding} disabled={busy || invalid} onChange={event => setEncoding(event.target.value as QueryFileEncoding)}>
          <option value="utf8">UTF-8</option><option value="utf16le">UTF-16 LE</option><option value="gb18030">GB18030</option>
        </select></Field>
        <CsvExportDelimiterField value={delimiter} disabled={busy || invalid} onChange={setDelimiter}/>
      </div>
      <ErrorBox message={error || (invalid ? text.stale : undefined)}/>
      {done && <p role="status">{text.done(done.sets, done.rows)}</p>}
    </div>
    <footer className="modal-footer"><span className="grow"/>
      {(phase === 'writing' || phase === 'cancelling') && <button type="button" disabled={phase === 'cancelling'} onClick={() => void cancel()}>{phase === 'cancelling' ? text.cancelling : text.cancel}</button>}
      <button type="button" disabled={busy} onClick={close}>{zh.common.close}</button>
      <button type="button" className="primary" disabled={busy || invalid || !selected.size} onClick={() => void save()}>{phase === 'writing' || phase === 'cancelling' ? text.saving : text.start}</button>
    </footer>
  </Modal>;
}
