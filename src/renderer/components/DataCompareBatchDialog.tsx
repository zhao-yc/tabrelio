import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { DataCompareProfileFamily } from '../../shared/dataCompareProfiles';
import type { PostgresDataCompareEndpoint, PostgresDataCompareOutput } from '../../shared/postgresDataCompare';
import { batchPairLimit, suggestComparePairs, type ComparePair } from '../dataCompareBatch';
import { errorMessage, invoke, uid } from '../lib';
import { dataCompareBatchZh as text } from '../locales/dataCompareBatch.zh-CN';
import { ErrorBox, Field, Modal } from './ui';

type Scope = Omit<PostgresDataCompareEndpoint, 'table'>;
type Result = { counts: PostgresDataCompareOutput['counts']; equal: number } | { error: string };
type Active = { stopped: boolean; taskId?: string };

async function catalogue(family: DataCompareProfileFamily, scope: Scope) {
  if (family === 'sqlite') {
    return (await invoke('metadata.objects', scope)).filter(item => item.kind === 'table').map(item => item.name);
  }
  return invoke(family === 'postgresql' ? 'postgres.compareData.catalogue' : 'mysql.compareData.catalogue', scope);
}

function compare(family: DataCompareProfileFamily, source: PostgresDataCompareEndpoint, target: PostgresDataCompareEndpoint, taskId: string) {
  if (family === 'sqlite') {
    return invoke('sqlite.compareData', {
      source: { ...source, database: 'main' }, target: { ...target, database: 'main' }, taskId,
      summaryOnly: true, mode: 'and', filters: [],
    });
  }
  return invoke(family === 'postgresql' ? 'postgres.compareData' : 'mysql.compareData', { source, target, taskId, summaryOnly: true });
}

export function DataCompareBatchDialog({ family, source, target, labels, initial, onClose, renderPair }: {
  family: DataCompareProfileFamily;
  source: Scope; target: Scope;
  labels: readonly [string, string];
  initial: ComparePair;
  onClose(): void;
  renderPair(pair: ComparePair, back: () => void): ReactNode;
}) {
  const sameScope = source.connectionId === target.connectionId && source.database === target.database;
  const [catalogues, setCatalogues] = useState<[string[], string[]]>();
  const [pairs, setPairs] = useState<ComparePair[]>([]);
  const [draft, setDraft] = useState<ComparePair>({ source: '', target: '' });
  const [review, setReview] = useState<ComparePair>();
  const [results, setResults] = useState<Map<ComparePair, Result>>(() => new Map());
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [catalogueError, setCatalogueError] = useState('');
  const [running, setRunning] = useState(false);
  const active = useRef<Active | undefined>(undefined);

  const leftId = source.connectionId, leftDb = source.database, rightId = target.connectionId, rightDb = target.database;
  const initialSource = initial.source, initialTarget = initial.target;
  useEffect(() => {
    let current = true;
    async function load() {
      const left = await catalogue(family, { connectionId: leftId, database: leftDb });
      const right = sameScope ? left : await catalogue(family, { connectionId: rightId, database: rightDb });
      if (!current) return;
      setCatalogues([left, right]);
      if (left.includes(initialSource) && right.includes(initialTarget) && (!sameScope || initialSource !== initialTarget))
        setPairs([{ source: initialSource, target: initialTarget }]);
    }
    void load().catch(reason => { if (current) setCatalogueError(errorMessage(reason)); });
    return () => { current = false; };
  }, [family, leftId, leftDb, rightId, rightDb, sameScope, initialSource, initialTarget]);

  const used = (pair: ComparePair) => pairs.some(item => item.source === pair.source || item.target === pair.target);
  const canAdd = !!draft.source && !!draft.target && (!sameScope || draft.source !== draft.target) && !used(draft);
  const append = (next: ComparePair[]) => {
    if (!next.length) { setNotice(text.noMatches); return; }
    if (next.length + pairs.length > batchPairLimit) { setNotice(text.limit); return; }
    setPairs([...pairs, ...next]); setNotice('');
  };
  const close = () => { if (!active.current) onClose(); };

  /** 每对复用既有只读任务。单对失败保留错误并继续，停止只取消当前任务并阻止后续派发。 */
  async function run() {
    if (active.current || !pairs.length) return;
    const work: Active = { stopped: false };
    active.current = work;
    setRunning(true); setNotice(''); setError(''); setResults(new Map());
    try {
      for (const pair of pairs) {
        if (work.stopped) break;
        work.taskId = uid();
        let result: Result;
        try {
          const { counts, equal } = await compare(family, { ...source, table: pair.source }, { ...target, table: pair.target }, work.taskId);
          result = { counts, equal };
        } catch (reason) { result = { error: errorMessage(reason) }; }
        if (!work.stopped) setResults(previous => new Map(previous).set(pair, result));
      }
    } finally {
      if (work.stopped) setNotice(text.cancelled);
      active.current = undefined;
      setRunning(false);
    }
  }

  function stop() {
    const work = active.current;
    if (!work || work.stopped || !work.taskId) return;
    work.stopped = true;
    const command = family === 'sqlite' ? 'sqlite.compareData.cancel' : family === 'postgresql' ? 'postgres.compareData.cancel' : 'mysql.compareData.cancel';
    void invoke(command, { taskId: work.taskId }).catch(reason => { if (active.current === work) setError(errorMessage(reason)); });
  }

  function forget(pair: ComparePair) {
    setResults(previous => {
      const next = new Map(previous);
      next.delete(pair);
      return next;
    });
  }

  if (review) return renderPair(review, () => { forget(review); setReview(undefined); });
  return <Modal title={text.title} wide onClose={close}>
    <div className="modal-content sqlite-data-compare">
      <p>{text.intro} {text.scope}</p>
      <div className="sqlite-data-compare-pair"><strong>{text.source}　{labels[0]}</strong><strong>{text.target}　{labels[1]}</strong></div>
      {!catalogues && !catalogueError && <p role="status">{text.loading}</p>}
      {catalogues && <fieldset disabled={running} className="sqlite-data-compare-endpoint">
        <div className="sqlite-data-compare-pair">
          {(['source', 'target'] as const).map((side, index) => <Field key={side} label={text[side]}>
            <select aria-label={text[side]} value={draft[side]} onChange={event => setDraft({ ...draft, [side]: event.target.value })}>
              <option value="">—</option>{catalogues[index].map(name => <option key={name} disabled={pairs.some(pair => pair[side] === name)}>{name}</option>)}
            </select>
          </Field>)}
        </div>
        <div className="inline-field">
          <button disabled={sameScope} onClick={() => append(suggestComparePairs(...catalogues, family === 'postgresql', sameScope).filter(pair => !used(pair)))}>{text.match}</button>
          <button disabled={!canAdd || pairs.length >= batchPairLimit} onClick={() => { append([draft]); setDraft({ source: '', target: '' }); }}>{text.add}</button>
        </div>
      </fieldset>}
      {!!pairs.length && <table aria-label={text.result}>
        <thead><tr><th>{text.source}</th><th>{text.target}</th><th>{text.result}</th><th>{text.review}</th></tr></thead>
        <tbody>{pairs.map(pair => {
          const result = results.get(pair);
          return <tr key={JSON.stringify(pair)}><td>{pair.source}</td><td>{pair.target}</td>
            <td>{!result ? text.pending : 'error' in result ? <>{text.failed} · {result.error}</> :
              [text.equal + ' ' + result.equal, text.leftOnly + ' ' + result.counts['source-only'],
                text.rightOnly + ' ' + result.counts['target-only'], text.different + ' ' + result.counts.different].join(' · ')}</td>
            <td><button disabled={running} onClick={() => setReview(pair)}>{text.review}</button>
              <button disabled={running} onClick={() => { setPairs(pairs.filter(item => item !== pair)); forget(pair); }}>{text.remove}</button></td>
          </tr>;
        })}</tbody>
      </table>}
      {catalogues && !pairs.length && <p>{text.noPairs}</p>}
      {running && <p role="status">{text.progress(results.size, pairs.length)}</p>}
      {notice && <p role="status">{notice}</p>}
      <ErrorBox message={catalogueError || error}/>
    </div>
    <footer className="modal-footer">
      <button className="primary" disabled={running || !pairs.length} onClick={() => void run()}>{text.run}</button>
      {running && <button onClick={stop}>{text.cancel}</button>}
      <span className="grow"/><button disabled={running} onClick={close}>{text.return}</button>
    </footer>
  </Modal>;
}
