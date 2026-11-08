import { Fragment, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { batchSyncActions, batchSyncLimits, batchSyncSelectionIssue, resolveBatchSyncSelection,
  type BatchSyncAction, type BatchSyncPreview } from '../../shared/dataCompareBatchSync';
import { sqliteDataSyncZh as syncText } from '../../shared/sqliteDataCompare';
import { displaySqliteCompareValue } from '../sqliteDataCompareValues';
import { sqliteBatchSyncZh, postgresBatchSyncZh, mysqlBatchSyncZh } from '../locales/sqliteBatchSync.zh-CN';
import { displayServerCompareValue } from '../serverDataCompareValues';
import type { DataCompareProfileFamily } from '../../shared/dataCompareProfiles';
import type { PostgresDataCompareOutput } from '../../shared/postgresDataCompare';
import { batchPairLimit, dataCompareBatchConfigurationSchema, reverseComparePair, sameCompareScope, type ComparePair, type ComparePairEndpoints, type CompareScope,
  type DataCompareBatchConfiguration } from '../../shared/dataCompareBatch';
import { filterBatchPreview, indexBatchPreview, suggestComparePairs, type BatchPreviewFilter } from '../dataCompareBatch';
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
const emptyPreviewFilter: BatchPreviewFilter = { table: '', action: '', key: '' };

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

function displayBatchValues<Key>(preview: BatchSyncPreview<Key> | null, display: (value: Key | undefined) => string): BatchSyncPreview<string> | null {
  return preview && { ...preview, tables: preview.tables.map(item => ({
    ...item, rows: item.rows.map(row => ({ ...row, key: row.key.map(display), cells: row.cells.map(cell => ({
      ...cell, source: display(cell.source), target: display(cell.target),
    })) })),
  })) };
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
  const [actions, setActions] = useState<BatchSyncAction[]>(['insert', 'update']);
  const [syncPreview, setSyncPreview] = useState<BatchSyncPreview<string>>();
  const [omitted, setOmitted] = useState<ReadonlySet<number>>(new Set());
  const [previewPage, setPreviewPage] = useState(0);
  const [previewFilter, setPreviewFilter] = useState(emptyPreviewFilter);
  const [reviewSelection, setReviewSelection] = useState(false);
  const [inspected, setInspected] = useState<number>();
  const [syncPhase, setSyncPhase] = useState<'preview' | 'apply'>();
  const [confirmation, setConfirmation] = useState('');
  const syncWork = useRef<{ taskId: string; phase: 'preview' | 'apply' } | undefined>(undefined);
  const reviewSync = useRef<HTMLFieldSetElement>(null);
  const reviewDetail = useRef<HTMLFieldSetElement>(null);
  const reviewRows = useRef<HTMLDivElement>(null);
  const detailId = useId();
  const active = useRef<Active | undefined>(undefined);
  const applying = useRef(false);
  const mounted = useRef(false);
  const generation = useRef(0);
  const version = generation.current;
  const busy = running || loadingProfile || !!syncPhase;
  const locked = busy || !!syncPreview;
  useEffect(() => { if (syncPreview) reviewSync.current?.scrollIntoView({ block: 'center' }); }, [syncPreview]);
  useEffect(() => { if (inspected !== undefined) reviewDetail.current?.scrollIntoView({ block: 'nearest' }); }, [inspected]);

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
    setCatalogueError(''); setError(''); setNotice(''); setActions(['insert', 'update']);
  }

  /** 先核对两侧表目录，任何失效映射都保留原工作区和已有结果。 */
  async function applyProfile(next: DataCompareBatchConfiguration) {
    if (!mounted.current || generation.current !== version || active.current || applying.current || syncWork.current || syncPreview || next.family !== family) return false;
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
    if (!catalogues || active.current || applying.current || syncWork.current || syncPreview) return;
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
  const close = () => { if (!active.current && !applying.current && !syncWork.current) onClose(); };

  /** 每对复用既有只读任务。单对失败保留错误并继续，停止只取消当前任务并阻止后续派发。 */
  async function run() {
    if (active.current || applying.current || syncWork.current || syncPreview || !configuration.success) return;
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
    if (active.current || applying.current || syncWork.current || syncPreview) return;
    generation.current++;
    const next: ComparePair = { source: pair.source, target: pair.target, ...(mapping.length ? { mapping } : {}) };
    setPairs(pairs.map(item => item === pair ? next : item)); forget(pair);
  }

  const networkDialect = family === 'postgresql' ? 'postgres' : 'mysql';
  const batchSyncText = family === 'sqlite' ? sqliteBatchSyncZh : family === 'postgresql' ? postgresBatchSyncZh : mysqlBatchSyncZh;
  const syncEligible = pairs.length > 1;
  const syncTables = useMemo(() => indexBatchPreview(syncPreview?.tables ?? []), [syncPreview]);
  // 核对清单始终取完整勾选范围，沿用原序号，并与普通浏览的筛选独立。
  const matchedTables = useMemo(() => reviewSelection
    ? syncTables.flatMap(table => {
      const rows = table.rows.filter(row => !omitted.has(row.ordinal));
      return rows.length ? [{ ...table, rows }] : [];
    })
    : filterBatchPreview(syncTables, previewFilter), [syncTables, previewFilter, reviewSelection, omitted]);
  const filterActive = !!(previewFilter.table || previewFilter.action || previewFilter.key.trim());
  const selected = syncTables.flatMap(item => item.rows.filter(row => !omitted.has(row.ordinal)).map(row => row.ordinal));
  const selection = syncPreview && resolveBatchSyncSelection(syncPreview.tables, selected);
  const all = syncPreview && resolveBatchSyncSelection(syncPreview.tables);
  const allFit = !!all && !batchSyncSelectionIssue(all);
  const selectionIssue = selection && batchSyncSelectionIssue(selection);
  const detail = syncTables.flatMap(item => item.rows).find(row => row.ordinal === inspected);
  const matching = matchedTables.flatMap(item => item.rows.map(row => row.ordinal));
  const unselectedMatches = matching.filter(ordinal => omitted.has(ordinal));
  const hiddenSelected = selected.length - (matching.length - unselectedMatches.length);
  const matchingFit = filterActive && syncPreview
    ? !batchSyncSelectionIssue(resolveBatchSyncSelection(syncPreview.tables, [...selected, ...unselectedMatches])) : allFit;
  const pages = Math.max(1, Math.ceil(matching.length / batchSyncLimits.page));
  const pageStart = previewPage * batchSyncLimits.page;
  const pageOrdinals = matching.slice(pageStart, pageStart + batchSyncLimits.page);
  const pageSet = new Set(pageOrdinals);
  const tableLabel = (table: string) => family === 'sqlite' ? 'main.' + table : table;

  function changePreviewPage(page: number) {
    setPreviewPage(page);
    setInspected(undefined);
    if (reviewRows.current) reviewRows.current.scrollTop = 0;
  }

  function changePreviewFilter(filter: BatchPreviewFilter) {
    setPreviewFilter(filter);
    changePreviewPage(0);
  }

  function markPreviewRows(ordinals: number[], checked: boolean) {
    setOmitted(previous => {
      const next = new Set(previous);
      for (const ordinal of ordinals) { if (checked) next.delete(ordinal); else next.add(ordinal); }
      return next;
    });
    setConfirmation('');
  }

  async function prepareSync() {
    if (!syncEligible || !actions.length || !configuration.success || active.current || applying.current || syncWork.current || syncPreview) return;
    const taskId = uid();
    generation.current++;
    syncWork.current = { taskId, phase: 'preview' }; setSyncPhase('preview');
    setError(''); setNotice(''); setConfirmation('');
    try {
      const request = { taskId, pairs, actions };
      const preview = family === 'sqlite'
        ? displayBatchValues(await invoke('sqlite.compareSync.batchPreview', { ...request, sourceConnectionId: source.connectionId,
          targetConnectionId: target.connectionId }), displaySqliteCompareValue)
        : displayBatchValues(await invoke(`${networkDialect}.compareData.batchPreview`, { ...request, source, target }),
          key => displayServerCompareValue(key, networkDialect));
      if (preview) {
        const scope = resolveBatchSyncSelection(preview.tables);
        // 大批预览先留空，让用户逐页选中，避免默认准备超预算或大批量写入。
        setOmitted(new Set(batchSyncSelectionIssue(scope) ? Array.from({ length: scope.rowCount }, (_, index) => index) : []));
        changePreviewFilter(emptyPreviewFilter);
        setReviewSelection(false);
        setSyncPreview(preview);
      } else setNotice(batchSyncText.noChanges);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { syncWork.current = undefined; setSyncPhase(undefined); }
  }

  async function applySync() {
    if (!syncPreview || !selection?.groups.length || selectionIssue || confirmation !== selection.confirmation || syncWork.current) return;
    const taskId = uid();
    syncWork.current = { taskId, phase: 'apply' }; setSyncPhase('apply'); setError(''); setNotice('');
    try {
      const request = { previewId: syncPreview.previewId, confirmation, taskId, selected };
      const result = await invoke(family === 'sqlite' ? 'sqlite.compareSync.batchApply' : `${networkDialect}.compareData.batchApply`, request);
      if (result.outcome === 'committed') setNotice(batchSyncText.confirmed + ' · ' + result.message);
      else setError(result.message);
    } catch (reason) { setError(errorMessage(reason)); }
    finally {
      syncWork.current = undefined; setSyncPhase(undefined); setSyncPreview(undefined); setConfirmation(''); setResults(new Map());
    }
  }

  function stopSyncPreview() {
    const work = syncWork.current;
    if (work?.phase === 'preview') void invoke(family === 'sqlite' ? 'sqlite.compareData.cancel' : `${networkDialect}.compareData.cancel`, { taskId: work.taskId }).catch(reason => setError(errorMessage(reason)));
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
      {pairs.length > 1 && <fieldset className="sqlite-data-compare-endpoint" disabled={locked}>
        <legend>{batchSyncText.title}</legend>
        <p>{batchSyncText.hint}</p>
        <div className="check-row">
          {batchSyncActions.map(action => <label key={action} className="check">
            <input type="checkbox" disabled={!syncEligible} checked={actions.includes(action)} onChange={event => {
              setActions(event.target.checked ? [...actions, action] : actions.filter(value => value !== action));
            }}/>{syncText[action]}
          </label>)}
        </div>
      </fieldset>}
      {selection && <fieldset ref={reviewSync} className="sqlite-data-compare-endpoint" disabled={!!syncPhase}>
        <legend>{batchSyncText.previewTitle}</legend>
        <p>{label(target)}　{selection.confirmation || batchSyncText.noneSelected}</p>
        <p>{batchSyncActions.map(action => syncText[action] + ' ' + selection.counts[action]).join(' · ')}</p>
        <p>{batchSyncText.selectionCount(selection.rowCount, all?.rowCount ?? 0)}{!allFit && ' · ' + batchSyncText.largePreview}</p>
        {selectionIssue && <p role="alert">{selectionIssue}</p>}
        <button type="button" aria-pressed={reviewSelection} disabled={!selected.length}
          onClick={() => { setReviewSelection(!reviewSelection); changePreviewPage(0); }}>{batchSyncText.reviewSelection}</button>
        {reviewSelection ? <>
          <p>{batchSyncText.reviewHint}</p>
          <table aria-label={batchSyncText.reviewSummary}>
            <thead><tr><th scope="col">{batchSyncText.targetTable}</th>
              {batchSyncActions.map(action => <th key={action} scope="col">{syncText[action]}</th>)}
            </tr></thead>
            <tbody>{selection.groups.map(({ tableIndex, counts }) => {
              const table = syncTables[tableIndex].table;
              return <tr key={table}><th scope="row">{tableLabel(table)}</th>
                {batchSyncActions.map(action => <td key={action}>{counts[action]}</td>)}
              </tr>;
            })}</tbody>
          </table>
        </> : <>
          <div className="sqlite-data-compare-pair">
            <Field label={batchSyncText.filterTable}>
              <select aria-label={batchSyncText.filterTable} value={previewFilter.table}
                onChange={event => changePreviewFilter({ ...previewFilter, table: event.target.value })}>
                <option value="">{batchSyncText.allTables}</option>
                {syncTables.map(item => <option key={item.table} value={item.table}>{tableLabel(item.table)}</option>)}
              </select>
            </Field>
            <Field label={batchSyncText.filterAction}>
              <select aria-label={batchSyncText.filterAction} value={previewFilter.action}
                onChange={event => changePreviewFilter({ ...previewFilter, action: event.target.value as BatchPreviewFilter['action'] })}>
                <option value="">{batchSyncText.allActions}</option>
                {batchSyncActions.map(action => <option key={action} value={action}>{syncText[action]}</option>)}
              </select>
            </Field>
            <Field label={batchSyncText.filterKey}>
              <input aria-label={batchSyncText.filterKey} value={previewFilter.key}
                onChange={event => changePreviewFilter({ ...previewFilter, key: event.target.value })}/>
            </Field>
          </div>
          {filterActive && <p>{batchSyncText.matches(matching.length)}
            {hiddenSelected > 0 && ' · ' + batchSyncText.hiddenSelected(hiddenSelected)}</p>}
          <div className="check-row">
            <button type="button" disabled={!matchingFit || !unselectedMatches.length}
              onClick={() => markPreviewRows(unselectedMatches, true)}>{filterActive ? batchSyncText.selectMatches : batchSyncText.selectAll}</button>
            <button type="button" disabled={!selected.length} onClick={() => markPreviewRows(selected, false)}>{batchSyncText.clearAll}</button>
            {pages > 1 && <button type="button" disabled={pageOrdinals.every(ordinal => !omitted.has(ordinal))}
              onClick={() => markPreviewRows(pageOrdinals, true)}>{batchSyncText.selectPage}</button>}
            {filterActive && <button type="button" onClick={() => changePreviewFilter(emptyPreviewFilter)}>{batchSyncText.clearFilter}</button>}
          </div>
        </>}
        <div className="sqlite-data-sync-preview-rows" ref={reviewRows}>
          {!matching.length && <p>{batchSyncText.noMatches}</p>}
          {matchedTables.flatMap(item => {
            const rows = item.rows.filter(row => pageSet.has(row.ordinal));
            if (!rows.length) return [];
            const checked = item.rows.some(row => !omitted.has(row.ordinal));
            const tableAction = filterActive ? (checked ? batchSyncText.clearTableMatches : batchSyncText.selectTableMatches)
              : (checked ? batchSyncText.clearTable : batchSyncText.selectTable);
            return <div key={item.table}>
              <strong>{tableLabel(item.table)}</strong>{' '}
              {!reviewSelection && <button type="button" aria-label={tableAction + ' ' + tableLabel(item.table)}
                onClick={() => markPreviewRows(item.rows.map(row => row.ordinal), !checked)}>{tableAction}</button>}
              <ul>{rows.map(row => <li key={row.ordinal}>
                <div className="sqlite-data-sync-preview-choice">
                  {reviewSelection ? <span>{syncText[row.action]}　{row.key.join(' / ')}</span> : <label className="check"><input type="checkbox" checked={!omitted.has(row.ordinal)}
                    onChange={event => markPreviewRows([row.ordinal], event.target.checked)}/>
                    {syncText[row.action]}　{row.key.join(' / ')}</label>}
                  <button type="button" aria-label={batchSyncText.details + ' ' + row.key.join(' / ')}
                    aria-expanded={inspected === row.ordinal} aria-controls={inspected === row.ordinal ? detailId : undefined}
                    onClick={() => setInspected(inspected === row.ordinal ? undefined : row.ordinal)}>{batchSyncText.details}</button>
                </div>
              </li>)}</ul>
            </div>;
          })}
        </div>
        {pages > 1 && <div className="sqlite-data-compare-pager">
          <button type="button" disabled={previewPage === 0} onClick={() => changePreviewPage(previewPage - 1)}>{batchSyncText.previousPage}</button>
          <span aria-live="polite">{batchSyncText.page(previewPage + 1, pages)}</span>
          <button type="button" disabled={previewPage + 1 === pages} onClick={() => changePreviewPage(previewPage + 1)}>{batchSyncText.nextPage}</button>
          <select aria-label={batchSyncText.jumpPage} value={previewPage} onChange={event => changePreviewPage(Number(event.target.value))}>
            {Array.from({ length: pages }, (_, index) => <option key={index} value={index}>{batchSyncText.page(index + 1, pages)}</option>)}
          </select>
        </div>}
        {detail && <fieldset id={detailId} ref={reviewDetail} className="sqlite-data-compare-endpoint">
          <legend>{batchSyncText.detailHeading}</legend>
          <p>{syncText[detail.action]}　{detail.key.join(' / ')}</p>
          <table><thead><tr><th>{batchSyncText.field}</th><th>{batchSyncText.sourceValue}</th><th>{batchSyncText.targetValue}</th></tr></thead>
            <tbody>{detail.cells.map(cell => <tr key={cell.sourceColumn}>
              <th scope="row">{cell.sourceColumn}{cell.sourceColumn !== cell.targetColumn && ' → ' + cell.targetColumn}</th>
              <td><pre>{cell.source}</pre></td><td><pre>{cell.target}</pre></td>
            </tr>)}</tbody>
          </table>
        </fieldset>}
        <Field label={syncText.confirm}><input aria-label={syncText.confirm} disabled={!selected.length || !!selectionIssue} value={confirmation} onChange={event => setConfirmation(event.target.value)}/></Field>
      </fieldset>}
      {syncPhase && <p role="status">{syncPhase === 'preview' ? batchSyncText.prepare : batchSyncText.working}</p>}
      {catalogues && !pairs.length && <p>{text.noPairs}</p>}
      {running && <p role="status">{text.progress(results.size, pairs.length)}</p>}
      {notice && <p role="status">{notice}</p>}
      <ErrorBox message={catalogueError || error}/>
    </div>
    <footer className="modal-footer">
      <button className="primary" disabled={locked || !configuration.success} onClick={() => void run()}>{text.run}</button>
      {running && <button onClick={stop}>{text.cancel}</button>}
      {syncPhase === 'preview' && <button onClick={stopSyncPreview}>{text.cancel}</button>}
      {syncPreview ? <>
        <button disabled={!!syncPhase} onClick={() => { setSyncPreview(undefined); setConfirmation(''); }}>{batchSyncText.back}</button>
        <button className="danger" disabled={!!syncPhase || !selection?.groups.length || !!selectionIssue || confirmation !== selection.confirmation}
          onClick={() => void applySync()}>{batchSyncText.apply}</button>
      </> : syncEligible && <button disabled={locked || !actions.length || !configuration.success} onClick={() => void prepareSync()}>{batchSyncText.preview}</button>}
      <span className="grow"/>
      <button disabled={locked || !catalogues} onClick={swap}>{profileText.swap}</button>
      <button disabled={busy} onClick={close}>{text.return}</button>
    </footer>
  </Modal>;
}
