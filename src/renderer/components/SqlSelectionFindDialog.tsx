import { useEffect, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { PageFindWorkerClient } from '../pageFindWorkerClient';
import { pageFindLimits, type PageFindOptions } from '../pageFindReplace';
import { sqlSelectionFindZh as text } from '../locales/sqlSelectionFind.zh-CN';
import { uiCommandLabels } from '../../shared/uiCommands.zh-CN';
import type { captureSqlClipboardSelection } from '../sqlClipboardStack';
import { errorMessage } from '../lib';
import { useWorkspace } from '../store';
import { ErrorBox, Field, Modal, Spinner } from './ui';

type Target = NonNullable<ReturnType<typeof captureSqlClipboardSelection>>;
type Range = { start: number; end: number };
const slot = 'sql-selection';
const outputLimit = 1024 * 1024;
export const sqlSelectionFindLimit = 128 * 1024;

/** 只把选区原文送到既有查找线程，避免 Monaco 把跨行的部分选区扩成整行。 */
export function SqlSelectionFindDialog({ mode, target, source, setHost, onClose, focus }: {
  mode: 'sql-find-selection' | 'sql-replace-selection'; target: Target; source: string;
  setHost(element: HTMLFormElement | null): void; onClose(): void; focus(): void;
}) {
  const [query, setQuery] = useState(''), [replacement, setReplacement] = useState('');
  const [regex, setRegex] = useState(false), [caseSensitive, setCase] = useState(false), [wholeWord, setWholeWord] = useState(false);
  const [ranges, setRanges] = useState<Range[]>(), [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const active = useRef(false), closed = useRef(false), client = useRef<PageFindWorkerClient | undefined>(undefined);
  useEffect(() => {
    const off = useWorkspace.subscribe(() => { target.current(); });
    return () => { off(); closed.current = true; target.dispose(); void client.current?.dispose(); };
  }, [target]);
  const selected = ranges?.[index];
  const replaceMode = mode === 'sql-replace-selection';

  function reset() { setRanges(undefined); setIndex(0); setError(''); }
  function close() { closed.current = true; target.dispose(); onClose(); }
  /** 匹配和替换都基于同一原文。正则和捕获展开只在线程内进行，返回后再次校验原选区。 */
  async function run(operation: 'find' | 'previewText', only?: Range) {
    if (active.current || closed.current || !query) return;
    if (!target.current()) { setError(text.changed); return; }
    active.current = true; setBusy(true); setError('');
    try {
      const literal = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = regex ? query : literal;
      const options: PageFindOptions = {
        kind: 'text', caseSensitive, wholeCell: false, regex: regex || wholeWord,
        query: wholeWord ? `(?<![\\p{L}\\p{N}_$])(?:${pattern})(?![\\p{L}\\p{N}_$])` : query,
        captureReplacement: operation === 'previewText' && regex,
      };
      client.current ??= new PageFindWorkerClient(() => new Worker(new URL('../pageFind.worker.ts', import.meta.url), { type: 'module' }));
      const response = await client.current.run({
        operation, rows: [{ id: slot, data: { [slot]: source }, inserted: false, deleted: false }],
        keys: [slot], options, generation: 0, replacement,
        ...(only ? { only: { rowId: slot, key: slot, occurrence: index + 1, range: only } } : {}),
      });
      if (closed.current) return;
      if (!target.current()) throw Error(text.changed);
      if (response.status === 'blocked') throw Error(response.message);
      if (response.operation === 'find') { setRanges(response.matches[0]?.ranges ?? []); setIndex(0); return; }
      if (response.operation !== 'previewText') return;
      const patch = response.patches[0];
      if (!patch) return;
      if (patch.rowId !== slot || patch.key !== slot || patch.before !== source || patch.after.length > outputLimit) throw Error(text.changed);
      if (!target.replace(patch.after, 'dbark-sql-selection-replace')) throw Error(text.changed);
      flushSync(close);
      focus();
    } catch (reason) { if (!closed.current) setError(errorMessage(reason)); }
    finally { if (!closed.current) { active.current = false; setBusy(false); } }
  }
  return createPortal(<Modal title={uiCommandLabels[mode]} onClose={close}>
    <form className="modal-content form-grid" ref={setHost} onSubmit={event => { event.preventDefault(); void run('find'); }}>
      <Field full label={text.query}><input value={query} maxLength={pageFindLimits.query - 40} disabled={busy} onChange={event => { setQuery(event.target.value); reset(); }}/></Field>
      {replaceMode && <Field full label={text.replacement}><input value={replacement} maxLength={pageFindLimits.replacement} disabled={busy} onChange={event => setReplacement(event.target.value)}/></Field>}
      <label><input type="checkbox" checked={regex} disabled={busy} onChange={event => { setRegex(event.target.checked); reset(); }}/>{text.regex}</label>
      <label><input type="checkbox" checked={caseSensitive} disabled={busy} onChange={event => { setCase(event.target.checked); reset(); }}/>{text.matchCase}</label>
      <label><input type="checkbox" checked={wholeWord} disabled={busy} onChange={event => { setWholeWord(event.target.checked); reset(); }}/>{text.wholeWord}</label>
      <div className="full inline-field">
        <button type="submit" disabled={busy || !query}>{text.find}</button>
        <button type="button" disabled={busy || !ranges?.length} onClick={() => setIndex((index + ranges!.length - 1) % ranges!.length)}>{text.previous}</button>
        <button type="button" disabled={busy || !ranges?.length} onClick={() => setIndex((index + 1) % ranges!.length)}>{text.next}</button>
        {busy && <Spinner/>}
      </div>
      {ranges && <p className="full" role="status">{selected ? text.position(index + 1, ranges.length) : text.noMatches}</p>}
      {selected && <div className="full history-sql-preview"><pre>{source.slice(Math.max(0, selected.start - 80), selected.start)}<mark>{source.slice(selected.start, Math.min(selected.end, selected.start + 512))}</mark>{source.slice(selected.end, selected.end + 80)}</pre></div>}
      <p className="full muted">{text.sourceHint}</p>
      <div className="full"><ErrorBox message={error}/></div>
    </form>
    <footer className="modal-footer">
      <button onClick={close}>{text.close}</button><span className="grow"/>
      <button disabled={busy || !selected} onClick={() => {
        if (!selected || !target.locate(selected.start, selected.end)) { setError(text.changed); return; }
        flushSync(close); focus();
      }}>{text.locate}</button>
      {replaceMode && <>
        <button disabled={busy || !selected} onClick={() => void run('previewText', selected)}>{text.replace}</button>
        <button className="primary" disabled={busy || !selected} onClick={() => void run('previewText')}>{text.replaceAll}</button>
      </>}
    </footer>
  </Modal>, document.body);
}
