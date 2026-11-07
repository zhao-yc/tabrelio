import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { PostgresTableColumn } from '../../shared/postgresTable';
import type { DraftRow } from '../dataChanges';
import { cellPreview, errorMessage } from '../lib';
import { pageFindLimits, pageOccurrences, type PageFindOptions, type PageOccurrence, type PageTextPatch } from '../pageFindReplace';
import { PageFindWorkerClient } from '../pageFindWorkerClient';
import { postgresFindWritable, type PostgresFindPlan } from '../postgresTableFind';
import { postgresTableFindZh as text } from '../locales/postgresTableFind.zh-CN';
import { postgresTableZh as tableText } from '../locales/postgresTable.zh-CN';
import { ErrorBox } from './ui';
import type { GridFindTarget } from './ResultsGrid';

export interface PostgresFindRequest { replace: boolean; }
type Mode = 'text' | 'null' | 'field';
interface Props {
  request?: PostgresFindRequest; scope: object; pageKey?: string; enabled: boolean; writable: boolean; rows: DraftRow[];
  columns: PostgresTableColumn[]; isCurrent(): boolean; anchor(): GridFindTarget | undefined;
  onOpen(replace: boolean): void; onClose(): void;
  onPreview(patches: readonly PageTextPatch[]): PostgresFindPlan;
  onStage(scope: object, plan: PostgresFindPlan): void;
  renderGrid(target?: GridFindTarget, highlights?: ReadonlySet<string>): ReactNode;
}

/** 数据使用现有有界工作线程，字段名在本地目录中匹配。每次更换来源都撤销旧替换计划。 */
export function PostgresTableFindPanel(props: Props) {
  const { request, scope, pageKey, enabled, writable, rows, columns, isCurrent, anchor, onOpen, onClose, onPreview, onStage, renderGrid } = props;
  const [mode, setMode] = useState<Mode>('text'), [column, setColumn] = useState('');
  const [query, setQuery] = useState(''), [replacement, setReplacement] = useState('');
  const [regex, setRegex] = useState(false), [capture, setCapture] = useState(false);
  const [sensitive, setSensitive] = useState(false), [whole, setWhole] = useState(false), [highlight, setHighlight] = useState(true);
  const [composing, setComposing] = useState(false);
  const queryInput = useRef<HTMLInputElement>(null), replacementInput = useRef<HTMLInputElement>(null);
  const modeInput = useRef<HTMLSelectElement>(null);
  const client = useRef<PageFindWorkerClient>(undefined);
  const resume = useRef<{ request: PostgresFindRequest; pageKey?: string; query: string; hit: PageOccurrence; end: number }>(undefined);
  const snapshot = useMemo(() => ({ request, scope, enabled, rows, columns, mode, column, query, sensitive, whole, regex, composing }),
    [request, scope, enabled, rows, columns, mode, column, query, sensitive, whole, regex, composing]);
  const latest = useRef(snapshot); latest.current = snapshot;
  const runningPreview = useRef<{ snapshot: typeof snapshot }>(undefined);
  const [preparing, setPreparing] = useState<typeof snapshot>();
  const [result, setResult] = useState<{ snapshot: typeof snapshot; hits: PageOccurrence[]; error?: string }>();
  const [position, setPosition] = useState<{ snapshot: typeof snapshot; index: number }>();
  const [preview, setPreview] = useState<{ snapshot: typeof snapshot; replacement: string; plan: PostgresFindPlan; only?: PageOccurrence }>();
  const [error, setError] = useState('');
  const found = result?.snapshot === snapshot ? result : undefined;
  const chosen = position?.snapshot === snapshot ? position.index : -1;
  const review = preview?.snapshot === snapshot && preview.replacement === replacement ? preview : undefined;
  const hit = found?.hits[chosen];
  const canSearch = mode === 'null' || !!query;
  const replaceVisible = request?.replace && mode === 'text';
  const canReplace = writable && enabled && replaceVisible;
  const pending = preparing === snapshot;
  const locked = pending || !!review;
  const options: PageFindOptions = { kind: 'text', query, caseSensitive: sensitive, wholeCell: whole, regex, column: column || undefined };

  useEffect(() => {
    if (!request || !enabled) return;
    (request.replace ? replacementInput.current ?? queryInput.current : queryInput.current ?? modeInput.current)?.focus();
  }, [request]);
  useEffect(() => { if (column && !columns.some(item => item.key === column)) setColumn(''); }, [columns, column]);
  useEffect(() => () => { void client.current?.dispose(); client.current = undefined; }, []);
  useEffect(() => {
    if (!request || !enabled || !canSearch || composing) return;
    let cancelled = false;
    const accepts = () => !cancelled && latest.current === snapshot && isCurrent();
    const selected = anchor();
    const next = resume.current;
    resume.current = undefined;
    const keys = columns.map(column => column.key);
    const publish = (hits: PageOccurrence[]) => {
      if (!accepts()) return;
      const sameSearch = next?.request === request && next.pageKey === pageKey && next.query === query;
      const startColumn = keys.indexOf(sameSearch ? next.hit.key : selected?.key ?? '');
      const startRow = mode === 'field' ? -1 : sameSearch ? Number(next.hit.rowId) : selected?.row ?? 0;
      const first = hits.findIndex(hit => {
        const row = Number(hit.rowId), column = keys.indexOf(hit.key);
        return row > startRow || row === startRow && (column > startColumn ||
          column === startColumn && (!sameSearch || (hit.range?.start ?? 0) >= next.end));
      });
      setPosition({ snapshot, index: hits.length ? Math.max(first, 0) : -1 });
      setResult({ snapshot, hits });
    };
    const timer = setTimeout(async () => {
      if (!accepts()) return;
      if (mode === 'field') {
        const needle = sensitive ? query : query.toLowerCase();
        publish(columns.filter(column => {
          const name = sensitive ? column.name : column.name.toLowerCase();
          return whole ? name === needle : name.includes(needle);
        }).map(column => ({ rowId: '-1', key: column.key, occurrence: 1 })));
        return;
      }
      client.current ??= new PageFindWorkerClient(() => new Worker(new URL('../pageFind.worker.ts', import.meta.url), { type: 'module' }));
      const answer = await client.current.run({ operation: 'find', rows, keys, options: { ...options, kind: mode }, generation: 0 });
      if (!accepts()) return;
      if (answer.status === 'ready' && answer.operation === 'find') publish(pageOccurrences(answer.matches));
      else if (answer.status === 'blocked') setResult({ snapshot, hits: [], error: answer.message });
    }, 100);
    return () => { cancelled = true; clearTimeout(timer); void client.current?.cancel(); };
  }, [snapshot, canSearch]);

  const target = useMemo(() => hit ? { row: Number(hit.rowId), key: hit.key } : undefined, [hit, position]);
  const marks = useMemo(() => request && highlight && found ? new Set(found.hits.map(match => match.rowId + ':' + match.key)) : undefined,
    [request, highlight, found]);
  const replaceKeys = useMemo(() => new Set(columns.filter(postgresFindWritable).map(column => column.key)), [columns]);
  const hasWritable = canReplace && found?.hits.some(hit => hit.range && replaceKeys.has(hit.key));
  const oneWritable = canReplace && hit?.range && replaceKeys.has(hit.key);

  function jump(direction: -1 | 1) {
    if (!found?.hits.length || !isCurrent() || composing || locked) return;
    const length = found.hits.length;
    setPosition(previous => {
      const index = previous?.snapshot === snapshot ? previous.index : -1;
      return { snapshot, index: index < 0 ? direction > 0 ? 0 : length - 1 : (index + direction + length) % length };
    });
  }

  async function makePreview(only?: PageOccurrence) {
    if (!canReplace || !found || !client.current || !isCurrent() || composing || locked || latest.current !== snapshot ||
        runningPreview.current?.snapshot === snapshot) return;
    if (/[\u0000\uD800-\uDFFF]/u.test(replacement)) { setError(text.invalidValue); return; }
    const job = { snapshot };
    runningPreview.current = job;
    setPreparing(snapshot);
    setError('');
    try {
      const result = await client.current.run({ operation: 'previewText', rows, keys: [...replaceKeys],
        options: { ...options, captureReplacement: regex && capture }, replacement, generation: 0, only });
      if (runningPreview.current !== job || latest.current !== snapshot || !isCurrent()) return;
      if (result.status === 'blocked') setError(result.message);
      else if (result.operation === 'previewText') setPreview({ snapshot, replacement, only, plan: onPreview(result.patches) });
    } catch (reason) {
      if (runningPreview.current === job && latest.current === snapshot && isCurrent()) setError(errorMessage(reason));
    } finally {
      if (runningPreview.current === job) { runningPreview.current = undefined; setPreparing(undefined); }
    }
  }

  function cancelPending() {
    runningPreview.current = undefined;
    setPreparing(undefined);
    void client.current?.cancel();
  }

  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!enabled || !isCurrent() || composing || event.nativeEvent.isComposing || event.keyCode === 229) return;
    const key = event.key.toLowerCase(), modifier = event.ctrlKey || event.metaKey;
    const findShortcut = key === 'f' && modifier && !event.altKey;
    const replaceShortcut = writable && (key === 'h' && event.ctrlKey && !event.metaKey && !event.altKey ||
      (key === 'f' || event.code === 'KeyF') && event.metaKey && event.altKey && !event.ctrlKey);
    if (!event.shiftKey && (findShortcut || replaceShortcut)) {
      event.preventDefault(); event.stopPropagation();
      if (!event.repeat) onOpen(replaceShortcut);
    } else if (request && !modifier && !event.altKey && (key === 'f3' || key === 'enter' && event.target === queryInput.current)) {
      event.preventDefault(); event.stopPropagation();
      if (!event.repeat) jump(event.shiftKey ? -1 : 1);
    } else if (request && !modifier && !event.altKey && key === 'escape') {
      event.preventDefault(); event.stopPropagation();
      if (pending) cancelPending(); else if (review) setPreview(undefined); else onClose();
    }
  }

  return <div className="pg-find-host" onKeyDownCapture={keyDown}>
    {request && <section className="pg-table-find" aria-label={text.title}
      onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)}>
      <div className="query-result-find-toolbar">
        <label className="pg-find-mode">{text.mode} <select ref={modeInput} aria-label={text.mode} value={mode} disabled={!enabled || locked} onChange={event => setMode(event.target.value as Mode)}>
          <option value="text">{text.values}</option><option value="field">{text.fields}</option><option value="null">{text.null}</option>
        </select></label>
        {mode !== 'null' && <input ref={queryInput} aria-label={text.query} value={query} maxLength={pageFindLimits.query}
          disabled={!enabled || locked} onChange={event => { setQuery(event.target.value); setError(''); }}/>}
        {mode !== 'field' && <select aria-label={text.column} value={column} disabled={!enabled || locked} onChange={event => setColumn(event.target.value)}>
          <option value="">{text.allColumns}</option>{columns.map(item => <option key={item.key} value={item.key}>{item.name}</option>)}
        </select>}
        {mode !== 'null' && <>
          <label className="check"><input type="checkbox" checked={sensitive} disabled={!enabled || locked} onChange={event => setSensitive(event.target.checked)}/>{text.caseSensitive}</label>
          <label className="check"><input type="checkbox" checked={whole} disabled={!enabled || locked} onChange={event => setWhole(event.target.checked)}/>{text.whole}</label>
        </>}
        {mode === 'text' && <label className="check"><input type="checkbox" checked={regex} disabled={!enabled || locked}
          onChange={event => { setRegex(event.target.checked); setCapture(false); setError(''); }}/>{text.regex}</label>}
        <label className="check"><input type="checkbox" checked={highlight} onChange={event => setHighlight(event.target.checked)}/>{text.highlight}</label>
        <button type="button" disabled={!enabled || !found?.hits.length || locked} onClick={() => jump(-1)}>{text.previous}</button>
        <button type="button" disabled={!enabled || !found?.hits.length || locked} onClick={() => jump(1)}>{text.next}</button>
        <button type="button" onClick={onClose}>{text.close}</button>
      </div>
      {replaceVisible && <div className="query-result-find-toolbar">
        <input ref={replacementInput} aria-label={text.replacement} value={replacement} maxLength={pageFindLimits.replacement} disabled={!canReplace || locked}
          onChange={event => { setReplacement(event.target.value); setError(''); }}/>
        {regex && <label className="check"><input type="checkbox" checked={capture} disabled={!canReplace || locked}
          onChange={event => { setCapture(event.target.checked); setError(''); }}/>{text.captures}</label>}
        <button type="button" disabled={!oneWritable || locked} onClick={() => void makePreview(hit)}>{text.one}</button>
        <button type="button" disabled={!hasWritable || locked} onClick={() => void makePreview()}>{text.all}</button>
        {pending && <button type="button" onClick={cancelPending}>{text.cancel}</button>}
        <span className="muted small">{text.replaceScope}</span>
      </div>}
      <div className="query-result-find-status">
        {enabled && canSearch && !composing && !found?.error && <span role="status">{pending ? text.preparing : !found ? text.searching : found.hits.length ? text.ready(found.hits.length, chosen) : text.noMatch}</span>}
        {hit && <span>{text.location(Number(hit.rowId), columns.find(column => column.key === hit.key)?.name ?? hit.key)}</span>}
        <span className="muted">{text.scope}</span>
      </div>
      <ErrorBox message={error || found?.error || ''}/>
      {review && <section className="pg-find-review" aria-label={text.review}>
        <p>{text.reviewCount(review.plan.patches.length, review.plan.changes.length)}</p>
        <dl>{review.plan.patches.slice(0, 12).map(patch => <div key={patch.row + ':' + patch.column.key}>
          <dt>{text.location(patch.row, patch.column.name)}</dt>
          <dd>{text.before}　{cellPreview(patch.before)}</dd><dd>{text.after}　{cellPreview(patch.after)}</dd>
        </div>)}</dl>
        {review.plan.patches.length > 12 && <p>{text.more(review.plan.patches.length - 12)}</p>}
        <button type="button" onClick={() => setPreview(undefined)}>{text.cancel}</button>
        <button type="button" className="primary" disabled={!canReplace} onClick={() => {
          if (latest.current !== snapshot || !isCurrent()) return;
          try {
            onStage(scope, review.plan);
            if (review.only?.range) {
              const { start, end } = review.only.range, { before, after } = review.plan.patches[0];
              // 零宽命中需要越过原位置，避免下一处仍停在刚插入文字的边界。
              resume.current = { request, pageKey, query, hit: review.only, end: end + after.length - before.length + (start === end ? 1 : 0) };
            }
            setPreview(undefined);
            setError('');
          }
          catch (reason) { setError(errorMessage(reason)); }
        }}>{tableText.stage}</button>
      </section>}
    </section>}
    {renderGrid(enabled ? target : undefined, enabled ? marks : undefined)}
  </div>;
}
