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
interface Criteria { query: string; regex: boolean; caseSensitive: boolean; wholeWord: boolean; }
const slot = 'sql-selection';
const outputLimit = 1024 * 1024;
const searchDelay = 180;
export const sqlSelectionFindLimit = 128 * 1024;

/** 只把选区原文送到既有查找线程，避免 Monaco 把跨行的部分选区扩成整行。 */
export function SqlSelectionFindDialog({ mode, target, source, setHost, onClose, focus }: {
  mode: 'sql-find-selection' | 'sql-replace-selection'; target: Target; source: string;
  setHost(element: HTMLFormElement | null): void; onClose(): void; focus(): void;
}) {
  const [criteria, setCriteria] = useState<Criteria>({ query: '', regex: false, caseSensitive: false, wholeWord: false });
  const [replacement, setReplacement] = useState(''), [composing, setComposing] = useState(false);
  const [result, setResult] = useState<{ generation: number; ranges: Range[] }>(), [index, setIndex] = useState(0);
  const [searching, setSearching] = useState(false), [writing, setWriting] = useState(false), [error, setError] = useState('');
  const generation = useRef(0), applying = useRef(false), closed = useRef(false), client = useRef<PageFindWorkerClient | undefined>(undefined);
  useEffect(() => {
    const off = useWorkspace.subscribe(() => { target.current(); });
    return () => { off(); closed.current = true; target.dispose(); void client.current?.dispose(); };
  }, [target]);
  const ranges = result?.generation === generation.current ? result.ranges : undefined;
  const selected = ranges?.[index], busy = searching || writing;
  const replaceMode = mode === 'sql-replace-selection';

  /** 输入发生时同步撤销旧结果和线程，防止旧回包与新输入共存。 */
  function reset() {
    generation.current++;
    void client.current?.cancel();
    setResult(undefined); setIndex(0); setSearching(false); setError('');
  }
  function change(patch: Partial<Criteria>) {
    if (applying.current) return;
    reset();
    setCriteria(previous => ({ ...previous, ...patch }));
  }
  function close() { closed.current = true; target.dispose(); onClose(); }

  function request(operation: 'find' | 'previewText', ticket: number, only?: Range) {
    const { query, regex, caseSensitive, wholeWord } = criteria;
    const literal = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = regex ? query : literal;
    const options: PageFindOptions = {
      kind: 'text', caseSensitive, wholeCell: false, regex: regex || wholeWord,
      query: wholeWord ? `(?<![\\p{L}\\p{N}_$])(?:${pattern})(?![\\p{L}\\p{N}_$])` : query,
      captureReplacement: operation === 'previewText' && regex,
    };
    client.current ??= new PageFindWorkerClient(() => new Worker(new URL('../pageFind.worker.ts', import.meta.url), { type: 'module' }));
    return client.current.run({
      operation, rows: [{ id: slot, data: { [slot]: source }, inserted: false, deleted: false }],
      keys: [slot], options, generation: ticket,
      ...(operation === 'previewText' ? { replacement } : {}),
      ...(only ? { only: { rowId: slot, key: slot, occurrence: index + 1, range: only } } : {}),
    });
  }

  /** 只对已提交的输入启动短延时查找，合成中的拼音不进入正则线程。 */
  useEffect(() => {
    if (!criteria.query || composing || closed.current) return;
    const ticket = generation.current;
    const current = () => !closed.current && generation.current === ticket;
    setSearching(true);
    const timer = setTimeout(() => {
      if (!current()) return;
      void (async () => {
        try {
          if (!target.current()) throw Error(text.changed);
          const response = await request('find', ticket);
          if (!current()) return;
          if (!target.current()) throw Error(text.changed);
          if (response.status === 'blocked') throw Error(response.message);
          if (response.operation === 'find') setResult({ generation: ticket, ranges: response.matches[0]?.ranges ?? [] });
        } catch (reason) { if (current()) setError(errorMessage(reason)); }
        finally { if (current()) setSearching(false); }
      })();
    }, searchDelay);
    return () => clearTimeout(timer);
  }, [criteria, composing, target]);

  /** 写入必须使用当前已完成的匹配代次，线程结果不能跳过原模型和选区复核。 */
  async function replace(only?: Range) {
    const ticket = generation.current;
    if (applying.current || closed.current || result?.generation !== ticket || !result.ranges.length) return;
    if (!target.current()) { setError(text.changed); return; }
    applying.current = true; setWriting(true); setError('');
    try {
      const response = await request('previewText', ticket, only);
      if (closed.current || generation.current !== ticket) return;
      if (!target.current()) throw Error(text.changed);
      if (response.status === 'blocked') throw Error(response.message);
      if (response.operation !== 'previewText') return;
      const patch = response.patches[0];
      if (!patch) return;
      if (patch.rowId !== slot || patch.key !== slot || patch.before !== source || patch.after.length > outputLimit) throw Error(text.changed);
      if (!target.replace(patch.after, 'dbark-sql-selection-replace')) throw Error(text.changed);
      flushSync(close);
      focus();
    } catch (reason) { if (!closed.current) setError(errorMessage(reason)); }
    finally { if (!closed.current) { applying.current = false; setWriting(false); } }
  }
  return createPortal(<Modal title={uiCommandLabels[mode]} onClose={close}>
    <form className="modal-content form-grid" ref={setHost} onSubmit={event => event.preventDefault()}>
      <Field full label={text.query}><input value={criteria.query} maxLength={pageFindLimits.query - 40} disabled={writing}
        onChange={event => change({ query: event.target.value })}
        onCompositionStart={() => { if (!applying.current) { reset(); setComposing(true); } }}
        onCompositionEnd={event => { setComposing(false); change({ query: event.currentTarget.value }); }}/></Field>
      {replaceMode && <Field full label={text.replacement}><textarea rows={2} value={replacement} maxLength={pageFindLimits.replacement} disabled={writing} onChange={event => setReplacement(event.target.value)}/></Field>}
      <label><input type="checkbox" checked={criteria.regex} disabled={writing} onChange={event => change({ regex: event.target.checked })}/>{text.regex}</label>
      <label><input type="checkbox" checked={criteria.caseSensitive} disabled={writing} onChange={event => change({ caseSensitive: event.target.checked })}/>{text.matchCase}</label>
      <label><input type="checkbox" checked={criteria.wholeWord} disabled={writing} onChange={event => change({ wholeWord: event.target.checked })}/>{text.wholeWord}</label>
      <div className="full inline-field">
        <button type="button" disabled={busy || !ranges?.length} onClick={() => setIndex((index + ranges!.length - 1) % ranges!.length)}>{text.previous}</button>
        <button type="button" disabled={busy || !ranges?.length} onClick={() => setIndex((index + 1) % ranges!.length)}>{text.next}</button>
        {busy && <Spinner text={writing ? text.replacing : text.searching}/>}
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
        <button disabled={busy || !selected} onClick={() => void replace(selected)}>{text.replace}</button>
        <button className="primary" disabled={busy || !selected} onClick={() => void replace()}>{text.replaceAll}</button>
      </>}
    </footer>
  </Modal>, document.body);
}
