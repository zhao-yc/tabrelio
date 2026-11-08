import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import type { DataCompareProfileFamily } from '../../shared/dataCompareProfiles';
import type { PostgresDataCompareOutput } from '../../shared/postgresDataCompare';
import { batchPairLimit, dataCompareBatchConfigurationSchema, reverseComparePair, sameCompareScope, type ComparePair, type ComparePairEndpoints, type CompareScope,
  type DataCompareBatchConfiguration } from '../../shared/dataCompareBatch';
import { suggestComparePairs } from '../dataCompareBatch';
import { mappedColumns, type DataCompareMapping as Mapping } from '../../shared/dataCompareMapping';
import { readDataCompareFields } from '../dataCompareFields';
import { DataCompareMapping } from './DataCompareMapping';
import { errorMessage, invoke, uid } from '../lib';
import { dataCompareBatchZh as text } from '../locales/dataCompareBatch.zh-CN';
import { ErrorBox, Field, Modal } from './ui';
import { DataCompareProfiles } from './DataCompareProfiles';
import { dataCompareProfilesZh as profileText } from '../locales/dataCompareProfiles.zh-CN';

type Scopes = { source: CompareScope; target: CompareScope };
type Catalogue = [string[], string[]];
type Result = { counts: PostgresDataCompareOutput['counts']; equal: number } | { error: string };
type Active = { stopped: boolean; taskId?: string };

async function catalogue(family: DataCompareProfileFamily, scope: CompareScope) {
  if (family === 'sqlite') {
    return (await invoke('metadata.objects', scope)).filter(item => item.kind === 'table').map(item => item.name);
  }
  return invoke(family === 'postgresql' ? 'postgres.compareData.catalogue' : 'mysql.compareData.catalogue', scope);
}

async function readCatalogues(family: DataCompareProfileFamily, source: CompareScope, target: CompareScope): Promise<Catalogue> {
  const left = await catalogue(family, source);
  return [left, sameCompareScope(source, target) ? left : await catalogue(family, target)];
}

function endpoints(scopes: Scopes, pair: ComparePair): ComparePairEndpoints {
  return { source: { ...scopes.source, table: pair.source }, target: { ...scopes.target, table: pair.target },
    ...(pair.mapping ? { mapping: pair.mapping } : {}) };
}

function compare(family: DataCompareProfileFamily, { source, target, mapping }: ComparePairEndpoints, taskId: string) {
  if (family === 'sqlite') {
    return invoke('sqlite.compareData', {
      source: { ...source, database: 'main' }, target: { ...target, database: 'main' }, taskId,
      summaryOnly: true, mode: 'and', filters: [], mapping,
    });
  }
  return invoke(family === 'postgresql' ? 'postgres.compareData' : 'mysql.compareData', { source, target, taskId, summaryOnly: true, mapping });
}

export function DataCompareBatchDialog({ family, initial, connections, onClose, renderPair }: {
  family: DataCompareProfileFamily;
  initial: ComparePairEndpoints;
  connections: readonly { id: string; name: string }[];
  onClose(): void;
  renderPair(pair: ComparePairEndpoints, back: () => void): ReactNode;
}) {
  const { connectionId: leftId, database: leftDb, table: initialSource } = initial.source;
  const { connectionId: rightId, database: rightDb, table: initialTarget } = initial.target;
  const [{ source, target }, setScopes] = useState<Scopes>({
    source: { connectionId: leftId, database: leftDb }, target: { connectionId: rightId, database: rightDb },
  });
  const initialMapping = initial.mapping;
  const sameScope = sameCompareScope(source, target);
  const hasScope = !!(source.connectionId && source.database && target.connectionId && target.database);
  const [catalogues, setCatalogues] = useState<Catalogue>();
  const [pairs, setPairs] = useState<ComparePair[]>([]);
  const [draft, setDraft] = useState<ComparePair>({ source: '', target: '' });
  const [editing, setEditing] = useState<string>();
  const [review, setReview] = useState<ComparePair>();
  const [results, setResults] = useState<Map<ComparePair, Result>>(() => new Map());
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [catalogueError, setCatalogueError] = useState('');
  const [running, setRunning] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const active = useRef<Active | undefined>(undefined);
  const applying = useRef(false);
  const mounted = useRef(false);
  const generation = useRef(0);
  const version = generation.current;
  const locked = running || loadingProfile;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (!leftId || !leftDb || !rightId || !rightDb) return;
    let current = true;
    const requestVersion = generation.current;
    const leftScope = { connectionId: leftId, database: leftDb }, rightScope = { connectionId: rightId, database: rightDb };
    void readCatalogues(family, leftScope, rightScope).then(result => {
      if (!current || requestVersion !== generation.current) return;
      setCatalogues(result);
      if (result[0].includes(initialSource) && result[1].includes(initialTarget) &&
        (!sameCompareScope(leftScope, rightScope) || initialSource !== initialTarget))
        setPairs([{ source: initialSource, target: initialTarget, ...(initialMapping ? { mapping: initialMapping } : {}) }]);
    }).catch(reason => { if (current && requestVersion === generation.current) setCatalogueError(errorMessage(reason)); });
    return () => { current = false; };
  }, [family, leftId, leftDb, rightId, rightDb, initialSource, initialTarget, initialMapping]);

  const configuration = dataCompareBatchConfigurationSchema.safeParse({ family, source, target, pairs });
  const label = (scope: CompareScope) => {
    const name = connections.find(item => item.id === scope.connectionId)?.name ?? scope.connectionId;
    return family === 'sqlite' ? name : name + ' / ' + scope.database;
  };

  function setBatch(scopes: Scopes, mappings: ComparePair[], names: Catalogue) {
    generation.current++;
    setScopes(scopes); setPairs(mappings); setCatalogues(names);
    setResults(new Map()); setDraft({ source: '', target: '' }); setEditing(undefined);
    setCatalogueError(''); setError(''); setNotice('');
  }

  /** 先核对两侧表目录，任何失效映射都保留原工作区和已有结果。 */
  async function applyProfile(next: DataCompareBatchConfiguration) {
    if (!mounted.current || generation.current !== version || active.current || applying.current || next.family !== family) return false;
    applying.current = true; setLoadingProfile(true);
    try {
      const names = await readCatalogues(family, next.source, next.target);
      if (!mounted.current) return false;
      const missing = next.pairs.find(pair => !names[0].includes(pair.source) || !names[1].includes(pair.target));
      if (missing) throw Error(text.missing(missing.source, missing.target));
      for (const pair of next.pairs) {
        if (!pair.mapping) continue;
        const targets = endpoints(next, pair);
        try {
          const [left, right] = await Promise.all([
            readDataCompareFields(family, targets.source), readDataCompareFields(family, targets.target),
          ]);
          mappedColumns(left.map(name => ({ name })), pair.mapping, 'source');
          mappedColumns(right.map(name => ({ name })), pair.mapping, 'target');
        } catch (reason) { throw Error(text.invalidFields(pair.source, pair.target, errorMessage(reason))); }
        if (!mounted.current) return false;
      }
      setBatch({ source: next.source, target: next.target }, next.pairs, names);
      return true;
    } finally { applying.current = false; setLoadingProfile(false); }
  }

  function swap() {
    if (!catalogues || active.current || applying.current) return;
    const reversed = pairs.map(reverseComparePair);
    setBatch({ source: target, target: source }, reversed, [catalogues[1], catalogues[0]]);
  }

  const used = (pair: ComparePair) => pairs.some(item => item.source === pair.source || item.target === pair.target);
  const canAdd = !!draft.source && !!draft.target && (!sameScope || draft.source !== draft.target) && !used(draft);
  const append = (next: ComparePair[]) => {
    if (!next.length) { setNotice(text.noMatches); return; }
    if (next.length + pairs.length > batchPairLimit) { setNotice(text.limit); return; }
    generation.current++;
    setPairs([...pairs, ...next]); setNotice('');
  };
  const close = () => { if (!active.current && !applying.current) onClose(); };

  /** 每对复用既有只读任务。单对失败保留错误并继续，停止只取消当前任务并阻止后续派发。 */
  async function run() {
    if (active.current || applying.current || !configuration.success) return;
    generation.current++;
    const work: Active = { stopped: false };
    active.current = work;
    setRunning(true); setNotice(''); setError(''); setResults(new Map());
    try {
      for (const pair of pairs) {
        if (work.stopped) break;
        work.taskId = uid();
        let result: Result;
        try {
          const { counts, equal } = await compare(family, endpoints({ source, target }, pair), work.taskId);
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

  function updateMapping(pair: ComparePair, mapping: Mapping) {
    if (active.current || applying.current) return;
    generation.current++;
    const next: ComparePair = { source: pair.source, target: pair.target, ...(mapping.length ? { mapping } : {}) };
    setPairs(pairs.map(item => item === pair ? next : item)); forget(pair);
  }

  if (review) return renderPair(endpoints({ source, target }, review),
    () => { forget(review); setReview(undefined); });
  return <Modal title={text.title} wide onClose={close}>
    <div className="modal-content sqlite-data-compare">
      <p>{text.intro} {text.scope}</p>
      <DataCompareProfiles area="batch" family={family} options={configuration.success ? configuration.data : undefined}
        disabled={locked} onApply={applyProfile}/>
      {hasScope ? <div className="sqlite-data-compare-pair"><strong>{text.source}　{label(source)}</strong><strong>{text.target}　{label(target)}</strong></div> :
        <p>{text.chooseScope}</p>}
      {((hasScope && !catalogues && !catalogueError) || loadingProfile) && <p role="status">{text.loading}</p>}
      {catalogues && <fieldset disabled={locked} className="sqlite-data-compare-endpoint">
        <div className="sqlite-data-compare-pair">
          {(['source', 'target'] as const).map((side, index) => <Field key={side} label={text[side]}>
            <select aria-label={text[side]} value={draft[side]} onChange={event => { generation.current++; setDraft({ ...draft, [side]: event.target.value }); }}>
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
          const isEditing = editing === pair.source;
          const needsKey = pair.mapping && !pair.mapping.some(item => item.key);
          const targets = endpoints({ source, target }, pair);
          return <Fragment key={pair.source}>
            <tr><td>{pair.source}</td><td>{pair.target}</td>
              <td>{needsKey ? text.needsKey : !result ? text.pending : 'error' in result ? <>{text.failed} · {result.error}</> :
                [text.equal + ' ' + result.equal, text.leftOnly + ' ' + result.counts['source-only'],
                  text.rightOnly + ' ' + result.counts['target-only'], text.different + ' ' + result.counts.different].join(' · ')}</td>
              <td>
                <button disabled={locked || needsKey} onClick={() => { generation.current++; setReview(pair); }}>{text.review}</button>
                <button disabled={locked} aria-expanded={isEditing} onClick={() => { generation.current++; setEditing(isEditing ? undefined : pair.source); }}>
                  {isEditing ? text.finishFields : pair.mapping ? text.customFields(pair.mapping.length) : text.editFields}
                </button>
                <button disabled={locked} onClick={() => {
                  generation.current++; setPairs(pairs.filter(item => item !== pair)); forget(pair);
                  if (isEditing) setEditing(undefined);
                }}>{text.remove}</button>
              </td>
            </tr>
            {isEditing && <tr><td colSpan={4}>
              <section aria-label={text.fieldEditor(pair.source, pair.target)}>
                <h3>{text.fieldEditor(pair.source, pair.target)}</h3>
                <DataCompareMapping inline family={family} source={targets.source} target={targets.target}
                  mapping={pair.mapping ?? []} disabled={locked} change={mapping => updateMapping(pair, mapping)}/>
              </section>
            </td></tr>}
          </Fragment>;
        })}</tbody>
      </table>}
      {catalogues && !pairs.length && <p>{text.noPairs}</p>}
      {running && <p role="status">{text.progress(results.size, pairs.length)}</p>}
      {notice && <p role="status">{notice}</p>}
      <ErrorBox message={catalogueError || error}/>
    </div>
    <footer className="modal-footer">
      <button className="primary" disabled={locked || !configuration.success} onClick={() => void run()}>{text.run}</button>
      {running && <button onClick={stop}>{text.cancel}</button>}
      <span className="grow"/>
      <button disabled={locked || !catalogues} onClick={swap}>{profileText.swap}</button>
      <button disabled={locked} onClick={close}>{text.return}</button>
    </footer>
  </Modal>;
}
