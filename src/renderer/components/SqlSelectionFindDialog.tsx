import { Fragment, useEffect, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { PageFindWorkerClient } from '../pageFindWorkerClient';
import { pageFindLimits, type PageFindOptions } from '../pageFindReplace';
import { sqlSelectionFindZh as text } from '../locales/sqlSelectionFind.zh-CN';
import { uiCommandLabels } from '../../shared/uiCommands.zh-CN';
import type { captureSqlClipboardSelection } from '../sqlClipboardStack';
import { errorMessage } from '../lib';
import { useWorkspace } from '../store';
import { ErrorBox, Field, Modal, Spinner } from './ui';
import '../sqlSelectionFind.css';

type Target = NonNullable<ReturnType<typeof captureSqlClipboardSelection>>;
type Range = { start: number; end: number };
interface Criteria { query: string; regex: boolean; caseSensitive: boolean; wholeWord: boolean; }
const slot = 'sql-selection';
const outputLimit = 1024 * 1024;
const searchDelay = 180;
export const sqlSelectionFindLimit = 128 * 1024;

/** 只绘制当前命中附近的有界片段，密集匹配也不会把整组选区变成 DOM 节点。 */
function MatchPreview({ source, ranges, index }: { source: string; ranges: Range[]; index: number }) {
  const selected = ranges[index];
  let from = Math.max(0, selected.start - 80);
  let to = Math.min(source.length, Math.min(selected.end, selected.start + 512) + 80);
  if (from > 0 && /[\uDC00-\uDFFF]/.test(source[from])) from--;
  if (to < source.length && /[\uDC00-\uDFFF]/.test(source[to])) to++;
  let first = index;
  while (first > 0 && ranges[first - 1].end >= from) first--;
  let offset = from;
  const pieces = [];
  for (let i = first; i < ranges.length && ranges[i].start <= to; i++) {
    const { start, end } = ranges[i];
    const left = Math.max(from, start), right = Math.min(to, end);
    if (left === right && start !== end) continue;
    pieces.push(<Fragment key={i}>{source.slice(offset, left)}<mark aria-current={i === index || undefined}
      className={start === end ? 'zero-width' : undefined}>{source.slice(left, right)}</mark></Fragment>);
    offset = right;
  }
  return <div className="full history-sql-preview sql-selection-preview"><pre aria-label={text.preview}>
    {from > 0 && '…'}{pieces}{source.slice(offset, to)}{to < source.length && '…'}
  </pre></div>;
}

/** 只把选区原文送到既有查找线程，避免 Monaco 把跨行的部分选区扩成整行。 */
export function SqlSelectionFindDialog({ mode, target, source, setHost, onClose, focus }: {
  mode: 'sql-find-selection' | 'sql-replace-selection'; target: Target; source: string;
  setHost(element: HTMLFormElement | null): void; onClose(): void; focus(): void;
}) {
  const [criteria, setCriteria] = useState<Criteria>({ query: '', regex: false, caseSensitive: false, wholeWord: false });
  const [replacement, setReplacement] = useState(''), [composing, setComposing] = useState(false);
  const [result, setResult] = useState<{ generation: number; ranges: Range[] }>(), [index, setIndex] = useState(0);
  const [searching, setSearching] = useState(false), [writing, setWriting] = useState(false), [error, setError] = useState('');
  const [invalid, setInvalid] = useState(false);
  const queryInput = useRef<HTMLInputElement>(null);
  const generation = useRef(0), applying = useRef(false), closed = useRef(false), client = useRef<PageFindWorkerClient | undefined>(undefined);
  useEffect(() => {
    const invalidate = () => { reset(); setInvalid(true); setError(text.changed); };
    if (!target.current()) invalidate();
    const offTarget = target.onInvalidated(invalidate);
    const offWorkspace = useWorkspace.subscribe(target.current);
    return () => { offWorkspace(); offTarget(); closed.current = true; target.dispose(); void client.current?.dispose(); };
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

  function move(delta: number) {
    if (busy || !ranges?.length || !target.current()) return;
    const count = ranges.length;
    setIndex(previous => (previous + delta + count) % count);
  }

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
    if (!criteria.query || composing || invalid || closed.current) return;
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
  }, [criteria, composing, invalid, target]);

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
  return createPortal(<Modal title={uiCommandLabels[mode]} onClose={close} initialFocus={queryInput}>
    <form className="modal-content form-grid sql-selection-find" ref={setHost} onSubmit={event => event.preventDefault()}>
      <Field full label={text.query}><input ref={queryInput} value={criteria.query} maxLength={pageFindLimits.query - 40} disabled={writing || invalid}
        aria-describedby="sql-selection-find-keys" onKeyDown={event => {
          // Enter 只切换命中。输入法确认及带修饰键的查询执行快捷键不进入这条路径。
          if (event.key !== 'Enter' || event.altKey || event.ctrlKey || event.metaKey || composing ||
              event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
          event.preventDefault();
          move(event.shiftKey ? -1 : 1);
        }}
        onChange={event => change({ query: event.target.value })}
        onCompositionStart={() => { if (!applying.current) { reset(); setComposing(true); } }}
        onCompositionEnd={event => { setComposing(false); change({ query: event.currentTarget.value }); }}/></Field>
      {replaceMode && <Field full label={text.replacement}><textarea rows={2} value={replacement} maxLength={pageFindLimits.replacement} disabled={writing || invalid} onChange={event => setReplacement(event.target.value)}/></Field>}
      <div className="full sql-selection-options">
        <label><input type="checkbox" checked={criteria.regex} disabled={writing || invalid} onChange={event => change({ regex: event.target.checked })}/>{text.regex}</label>
        <label><input type="checkbox" checked={criteria.caseSensitive} disabled={writing || invalid} onChange={event => change({ caseSensitive: event.target.checked })}/>{text.matchCase}</label>
        <label><input type="checkbox" checked={criteria.wholeWord} disabled={writing || invalid} onChange={event => change({ wholeWord: event.target.checked })}/>{text.wholeWord}</label>
      </div>
      <div className="full inline-field">
        <button type="button" disabled={busy || !selected} onClick={() => move(-1)}>{text.previous}</button>
        <button type="button" disabled={busy || !selected} onClick={() => move(1)}>{text.next}</button>
        {busy && <Spinner text={writing ? text.replacing : text.searching}/>}
      </div>
      {ranges && <p className="full" role="status">{selected ? text.position(index + 1, ranges.length) : text.noMatches}</p>}
      {selected && ranges && <MatchPreview source={source} ranges={ranges} index={index}/>}
      <p id="sql-selection-find-keys" className="full muted">{text.keys}</p>
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
