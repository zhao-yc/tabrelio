import { assertSingleQueryDraftColumns, type SqliteSingleQueryDraft, type SingleQueryDraft } from '../../shared/singleQueryDesigns';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DatabaseObject } from '../../shared/contracts';
import { queryDatabasePatch } from '../../shared/queryContext';
import { sqliteQueryBuilderPageSchema, sqliteTableBrowseLimits } from '../../shared/sqliteTableBrowse';
import { buildSqliteQueryBuilderSql, sqliteQueryBuilderSampleRows, type SqliteBuilderJoin, type SqliteQueryBuilderSource,
  type SqliteQueryBuilderTarget } from '../../shared/sqliteQueryBuilder';
import { queryBuilderAlias, queryBuilderColumnKey, queryBuilderForeignKeyPairs, queryBuilderJoinLimits,
  type QueryBuilderForeignKeyChoice } from '../../shared/queryBuilderJoin';
import { sqliteReadSqlLimits } from '../../shared/sqliteReadSql';
import type { SqliteObjectsOutcome, SqliteObjectsTarget } from '../../shared/sqliteObjects';
import { errorMessage, invoke, uid } from '../lib';
import { sqliteQueryBuilderZh as text } from '../locales/sqliteQueryBuilder.zh-CN';
import { sqliteTableBrowseZh as browse } from '../locales/sqliteTableBrowse.zh-CN';
import { queryBuilderSummaryZh as summaryText } from '../locales/queryBuilderSummary.zh-CN';
import { queryViewDraftZh as viewText } from '../locales/queryViewDraft.zh-CN';
import { zh } from '../locales/zh-CN';
import { sqliteTableDraft, type SqliteFilterDraft, type SqliteSortDraft } from '../sqliteTableBrowser';
import { queryViewDefinition, type ViewQuerySeed } from '../queryViewDraft';
import { useWorkspace } from '../store';
import { SqliteTableFilters } from './SqliteTableFilters';
import { SqliteObjectsDialog } from './SqliteObjectsDialog';
import { emptyQueryBuilderSummary, QueryBuilderSummaryPanel, queryBuilderSummaryFromDraft, queryBuilderSummaryOutputs,
  resolveSummaryConditionColumn, summaryConditionLabel } from './QueryBuilderSummaryPanel';
import { SingleQueryDesignPanel } from './SingleQueryDesignPanel';
import { QueryBuilderJoinPanel, type QueryBuilderJoinDraft } from './QueryBuilderJoinPanel';
import { tableForeignKeyJoinZh as designText } from '../locales/tableForeignKeyJoin.zh-CN';
import { ViewQueryInspect } from './ViewQueryInspect';
import { ErrorBox, Field, Modal, Spinner } from './ui';

type SqliteJoinDraft = QueryBuilderJoinDraft<SqliteQueryBuilderSource, SqliteBuilderJoin>;

function compileDesign(draft: SqliteSingleQueryDraft, source: SqliteQueryBuilderSource, joins: readonly SqliteJoinDraft[] = []) {
  const { selected, distinct, limit, sort, filters, mode, summaryEnabled, summary, havingFilters, havingMode } = draft;
  const outputs = queryBuilderSummaryOutputs(summary);
  if (!summaryEnabled && !selected.length) throw Error(text.noColumns);
  const rowLimit = limit === '' ? undefined : Number(limit);
  if (rowLimit !== undefined && (!/^[1-9]\d*$/.test(limit) || rowLimit > sqliteReadSqlLimits.limit)) throw Error(text.invalidLimit);
  const { connectionId, database, table } = source.target;
  const scope = { connectionId, database, table };
  const schema = joins.length ? sqliteQueryBuilderPageSchema : undefined;
  const { limit: _limit, ...query } = sqliteTableDraft(scope, 1, mode, filters, summaryEnabled ? [] : sort, schema);
  const having = summaryEnabled && havingFilters.length ? sqliteTableDraft({ connectionId, database, table }, 1, havingMode,
    havingFilters.map(rule => ({ ...rule, column: resolveSummaryConditionColumn(outputs, rule.column) })), [], schema) : undefined;
  const design = { ...source.target, ...query, schemaKey: source.schemaKey, columns: summaryEnabled ? [] : selected,
    distinct: !summaryEnabled && distinct, rowLimit, summary: summaryEnabled ? { ...queryBuilderSummaryFromDraft(summary),
      having: having && { mode: having.mode, filters: having.filters } } : undefined,
    joins: joins.length ? joins.map(item => item.step) : undefined };
  return { design, sql: buildSqliteQueryBuilderSql(design, source, joins.map(item => item.source)) };
}

function sameTarget(a: SqliteQueryBuilderTarget, b: SqliteQueryBuilderTarget) {
  return a.connectionId === b.connectionId && a.database === b.database && a.table === b.table && a.kind === b.kind;
}

/** 仅在第一次加入来源时为原单表字段补别名，汇总输出身份与明细配置一同迁移。 */
function qualifySingleDraft(draft: SqliteSingleQueryDraft): SqliteSingleQueryDraft {
  const qualify = (name: string) => queryBuilderColumnKey(0, name);
  const outputKey = (key: string) => key.startsWith('field:') ? 'field:' + qualify(key.slice('field:'.length)) : key;
  return {
    ...draft, selected: draft.selected.map(qualify), filters: draft.filters.map(rule => ({ ...rule, column: qualify(rule.column) })),
    sort: draft.sort.map(rule => ({ ...rule, column: qualify(rule.column) })),
    havingFilters: draft.havingFilters.map(rule => ({ ...rule, column: outputKey(rule.column) })),
    summary: { groups: draft.summary.groups.map(qualify),
      aggregates: draft.summary.aggregates.map(item => ({ ...item, column: qualify(item.column) })),
      sort: draft.summary.sort.map(rule => ({ ...rule, column: outputKey(rule.column) })) },
  };
}

/** 只从可信目录选取表或视图；旧窗口与跨连接的短读不发布草稿。 */
export function SqliteQueryBuilderDialog({ connectionId, onBack, onClose, onViewDirty, onViewApplied, onViewUncertain }: {
  connectionId: string; onBack(): void; onClose(): void; onViewDirty(dirty: boolean): void;
  onViewApplied(result: SqliteObjectsOutcome, version: number): void;
  onViewUncertain(target: SqliteObjectsTarget, version: number): void;
}) {
  const [owner] = useState(() => {
    const workspace = useWorkspace.getState();
    return { profile: workspace.connections.find(item => item.id === connectionId), version: workspace.connectionVersions[connectionId] ?? 0,
      tab: workspace.settings.activeTabId, stale: false };
  });
  const [objects, setObjects] = useState<DatabaseObject[]>(), [name, setName] = useState(''), [search, setSearch] = useState('');
  const [source, setSource] = useState<SqliteQueryBuilderSource>();
  const [joins, setJoins] = useState<SqliteJoinDraft[]>([]), [editingJoin, setEditingJoin] = useState<number>();
  const singleDraft = useRef<SqliteSingleQueryDraft | undefined>(undefined);
  const [selected, setSelected] = useState<string[]>([]), [filters, setFilters] = useState<SqliteFilterDraft[]>([]);
  const [sort, setSort] = useState<SqliteSortDraft[]>([]), [mode, setMode] = useState<'and' | 'or'>('and');
  const [distinct, setDistinct] = useState(false), [limit, setLimit] = useState('');
  const [summaryEnabled, setSummaryEnabled] = useState(false), [summary, setSummary] = useState(emptyQueryBuilderSummary);
  const [havingFilters, setHavingFilters] = useState<SqliteFilterDraft[]>([]), [havingMode, setHavingMode] = useState<'and' | 'or'>('and');
  const [message, setMessage] = useState(''), [error, setError] = useState(''), [stale, setStale] = useState(false);
  const [viewSeed, setViewSeed] = useState<ViewQuerySeed>();
  const viewScope = useMemo(() => ({ connectionId, database: 'main' as const, kind: 'view' as const }), [connectionId]);
  const canCreateView = owner.profile?.dialect === 'sqlite' && !owner.profile.sqlite.readOnly;
  const mounted = useRef(false), operation = useRef<object | undefined>(undefined);
  const target = objects?.find(item => item.name === name);
  const choices = objects?.filter(item => item.name === name || item.name.toLowerCase().includes(search.toLowerCase()));
  const names = useMemo(() => source ? [source, ...joins.map(item => item.source)].flatMap((relation, position) =>
    relation.columns.map(({ name }) => joins.length ? queryBuilderColumnKey(position, name) : name)) : [], [source, joins]);
  const joinEntries = useMemo(() => objects?.filter(item => item.kind === 'table' || item.kind === 'view')
    .map(item => ({ key: item.name })) ?? [], [objects]);
  const outputs = useMemo(() => queryBuilderSummaryOutputs(summary), [summary]);
  const draft = useMemo<SqliteSingleQueryDraft>(() => ({ dialect: 'sqlite', version: 1, selected, distinct, limit, sort, filters, mode, summaryEnabled, summary, havingFilters, havingMode }),
    [selected, distinct, limit, sort, filters, mode, summaryEnabled, summary, havingFilters, havingMode]);
  const preview = useMemo<(ReturnType<typeof compileDesign> & { error?: never }) |
    { error: string; design?: never; sql?: never } | undefined>(() => {
    if (!source) return;
    try { return compileDesign(draft, source, joins); }
    catch (reason) { return { error: errorMessage(reason) }; }
  }, [draft, source, joins]);

  function current(): boolean {
    if (!mounted.current || owner.stale) return false;
    const workspace = useWorkspace.getState();
    owner.stale = owner.profile?.dialect !== 'sqlite' || workspace.connections.find(item => item.id === connectionId) !== owner.profile ||
      (workspace.connectionVersions[connectionId] ?? 0) !== owner.version || workspace.settings.activeTabId !== owner.tab;
    return !owner.stale;
  }
  useLayoutEffect(() => {
    mounted.current = true;
    const check = () => { if (!current() && owner.stale) setStale(true); };
    const unsubscribe = useWorkspace.subscribe(check);
    check();
    return () => { mounted.current = false; unsubscribe(); };
  }, []);

  const editable = () => current() && !operation.current;
  const disabled = stale || !!message;
  const controlsDisabled = disabled || editingJoin !== undefined;
  function close(callback: () => void) { if (mounted.current) { mounted.current = false; callback(); } }

  /** 同步占门，目录与草稿的迟到回包仅交还原窗口。 */
  async function run<T>(label: string, action: (owns: () => boolean) => Promise<T>): Promise<T | undefined> {
    if (!editable()) return;
    const ticket = {}; operation.current = ticket;
    setError(''); setMessage(label);
    const owns = () => current() && operation.current === ticket;
    try { return await action(owns); }
    catch (reason) { if (owns()) setError(errorMessage(reason)); }
    finally { operation.current = undefined; if (mounted.current) setMessage(''); }
  }

  function readSource() {
    if (!target || (target.kind !== 'table' && target.kind !== 'view')) return;
    const scope: SqliteQueryBuilderTarget = { connectionId, database: 'main', table: target.name, kind: target.kind };
    void run(text.loading, async owns => {
      const result = await invoke('sqlite.queryBuilder.describe', scope);
      if (!owns()) return;
      if (!sameTarget(result.target, scope)) throw Error(text.stale);
      setSelected(result.columns.map(column => column.name));
      setFilters([]); setSort([]); setMode('and'); setDistinct(false); setLimit(''); setSource(result);
      setSummaryEnabled(false); setSummary(emptyQueryBuilderSummary);
      setHavingFilters([]); setHavingMode('and');
      setJoins([]); singleDraft.current = undefined;
    });
  }

  /** 先验证整份本地设计，再发布结构与草稿；失败时原设计保持。 */
  async function restore(value: SingleQueryDraft) {
    if (!source || value.dialect !== 'sqlite') throw Error(designText.designModeMismatch);
    const steps = value.joins ?? [];
    const sources = await readSources(source.target, steps.map(step => step.target));
    if (!current()) return;
    const [fresh, ...related] = sources;
    const next = steps.map((step, index) => ({ source: related[index], step: { ...step, schemaKey: related[index].schemaKey } }));
    assertSingleQueryDraftColumns(value, sources.flatMap((relation, position) =>
      relation.columns.map(({ name }) => next.length ? queryBuilderColumnKey(position, name) : name)));
    compileDesign(value, fresh, next);
    if (next.length && !joins.length) singleDraft.current = draft;
    setSource(fresh); setJoins(next); applyDraft(value);
  }

  async function readSources(target: SqliteQueryBuilderTarget, joinTargets: SqliteBuilderJoin['target'][]) {
    const sources = joinTargets.length ? await invoke('sqlite.queryBuilder.describeJoin', { ...target, joinTargets }) :
      [await invoke('sqlite.queryBuilder.describe', target)];
    const expected = [target, ...joinTargets.map(item => ({ ...target, ...item }))];
    if (sources.length !== expected.length || sources.some((item, index) => !sameTarget(item.target, expected[index]))) throw Error(text.stale);
    return sources;
  }

  function applyDraft(value: SqliteSingleQueryDraft) {
    setSelected(value.selected); setDistinct(value.distinct); setLimit(value.limit); setSort(value.sort);
    setSummaryEnabled(value.summaryEnabled); setSummary(value.summary);
    setFilters(value.filters); setMode(value.mode);
    setHavingFilters(value.havingFilters); setHavingMode(value.havingMode);
  }

  function joinKeyInput(table: string) {
    const object = objects?.find(item => item.name === table);
    if (!source || editingJoin !== undefined || joins.length >= queryBuilderJoinLimits.steps ||
        !object || (object.kind !== 'table' && object.kind !== 'view')) return;
    return { ...source.target, nextTarget: { table, kind: object.kind }, priorTargets: joins.map(item => item.step.target),
      priorRevisions: [source.schemaKey, ...joins.map(item => item.source.schemaKey)] };
  }

  function readJoinKeys(table: string) {
    const input = joinKeyInput(table);
    return run(text.loading, async owns => {
      if (!input) return;
      const result = await invoke('sqlite.queryBuilder.joinKeys', input);
      if (owns()) return result.choices;
    });
  }

  /** 所选外键必须在同一快照重新出现，确认后才会替换本地草稿。 */
  function addJoin(table: string, key?: QueryBuilderForeignKeyChoice) {
    const input = joinKeyInput(table);
    if (!source || !input) return;
    const target = input.nextTarget;
    const scope = { ...source.target, ...target };
    void run(text.loading, async owns => {
      const matching = key && await invoke('sqlite.queryBuilder.joinKeys', input);
      const right = matching ? matching.source : await invoke('sqlite.queryBuilder.describe', scope);
      if (!owns()) return;
      if (!sameTarget(right.target, scope)) throw Error(text.stale);
      const pairs = key && matching ? queryBuilderForeignKeyPairs(key, matching.choices) : [{ left: '', right: '', operator: '=' as const }];
      const next = right.columns.map(({ name }) => queryBuilderColumnKey(joins.length + 1, name));
      if (!joins.length) {
        singleDraft.current = draft;
        const qualified = qualifySingleDraft(draft);
        applyDraft({ ...qualified, selected: [...qualified.selected, ...next].slice(0, sqliteTableBrowseLimits.columns) });
      } else setSelected(previous => [...previous, ...next].slice(0, sqliteTableBrowseLimits.columns));
      setJoins([...joins, { source: right, step: { target, schemaKey: right.schemaKey, kind: 'INNER', mode: 'all', pairs } }]);
    });
  }

  function removeLastJoin() {
    if (!editable() || editingJoin !== undefined || joins.length < 2) return;
    const prefix = queryBuilderAlias(joins.length) + '.';
    if ([...filters.map(item => item.column), ...sort.map(item => item.column), ...summary.groups,
      ...summary.aggregates.filter(item => item.fn !== 'COUNT_ALL').map(item => item.column)].some(name => name.startsWith(prefix))) {
      setError(text.joinReferenced);
      return;
    }
    setError(''); setSelected(previous => previous.filter(name => !name.startsWith(prefix)));
    setJoins(previous => previous.slice(0, -1));
  }

  function backToSingle() {
    if (!editable() || editingJoin !== undefined || !singleDraft.current || !window.confirm(text.joinBackConfirm)) return;
    applyDraft(singleDraft.current); singleDraft.current = undefined; setJoins([]); setError('');
  }

  /** 返回构建器时保留原草稿，视图提交前重新核对同一个 SQLite 来源。 */
  function open(asView = false) {
    if (!source || editingJoin !== undefined || !preview?.design || asView && !canCreateView) return;
    const { design, sql } = preview;
    const target = source.target;
    async function verify() {
      if (!current()) throw Error(text.stale);
      const [fresh, ...related] = await readSources(target, design.joins?.map(step => step.target) ?? []);
      if (!current() || buildSqliteQueryBuilderSql(design, fresh, related) !== sql) throw Error(text.stale);
    }
    void run(text.checking, async owns => {
      await verify();
      if (!owns()) return;
      if (asView) {
        setViewSeed({ sql: queryViewDefinition(sql, 'sqlite'), version: owner.version, current, beforeApply: verify });
        return;
      }
      const workspace = useWorkspace.getState();
      if (workspace.settings.tabs.length >= 100) throw Error(text.tabs);
      close(onClose);
      workspace.openTab({ kind: 'query', title: text.queryTitle(source.target.table), connectionId,
        ...queryDatabasePatch({ state: 'known', database: 'main' }), sql: sql + ';' });
    });
  }

  function moveSort(index: number, offset: -1 | 1) {
    if (!editable() || !sort[index + offset]) return;
    const next = [...sort];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    setSort(next);
  }

  if (viewSeed) return <SqliteObjectsDialog scope={viewScope} targetVersion={viewSeed.version} action="create"
    viewSeed={viewSeed} onDirtyChange={onViewDirty} onApplied={onViewApplied}
    onExecutionUncertain={target => onViewUncertain(target, viewSeed.version)} onClose={() => setViewSeed(undefined)}/>;

  return <Modal title={text.title} wide={!!source} onClose={() => close(onClose)}>
    <div className="modal-content" aria-busy={!!message}>
      {!source ? <>
        <p>{text.hint}</p>
        <div className="child-reference-tools"><button disabled={disabled} onClick={() => void run(text.loading, async owns => {
          const catalog = await invoke('metadata.objects', { connectionId, database: 'main' });
          if (!owns()) return;
          const choices = catalog.filter(item => item.kind === 'table' || item.kind === 'view');
          setObjects(choices); if (!choices.some(item => item.name === name)) setName('');
        })}>{text.catalog}</button></div>
        {objects && <Field label={text.search}><input type="search" value={search} disabled={disabled}
          onChange={event => { if (editable()) setSearch(event.target.value); }}/></Field>}
        <Field label={text.source}><select aria-label={text.source} value={name} disabled={disabled || !choices?.length}
          onChange={event => { if (editable()) setName(event.target.value); }}>
          <option value="">{text.select}</option>{choices?.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}
        </select></Field>
        {choices?.length === 0 && <p role="status">{text.empty}</p>}
      </> : <>
        <p>main.{source.target.table}</p>
        {!joins.length && <SingleQueryDesignPanel scope={{ ...source.target, dialect: 'sqlite' }} draft={preview?.design ? draft : undefined}
          disabled={controlsDisabled} current={current} run={action => void run(designText.designWorking, () => action())} restore={restore}/>}
        <details open={joins.length ? true : undefined}><summary onClick={event => {
          if (editingJoin !== undefined) event.preventDefault();
        }}>{text.joins}</summary>
          <SingleQueryDesignPanel scope={{ ...source.target, dialect: 'sqlite', join: true }}
            draft={joins.length && preview?.design ? { ...draft,
              joins: joins.map(({ step: { schemaKey: _schemaKey, ...step } }) => step) } : undefined}
            disabled={controlsDisabled} current={current} run={action => void run(designText.designWorking, () => action())} restore={restore}/>
          <QueryBuilderJoinPanel stale={text.stale} source={source} entries={joinEntries} joins={joins}
            disabled={disabled} editing={editingJoin} current={editable}
            edit={index => {
              if (index === undefined || (editable() && editingJoin === undefined)) setEditingJoin(index);
            }}
            add={addJoin} readKeys={readJoinKeys} change={(index, step) => {
              if (!editable() || (editingJoin !== undefined && editingJoin !== index)) return;
              setError(''); setJoins(previous => previous.map((item, i) => i === index ? { ...item, step } : item));
            }} remove={removeLastJoin} back={backToSingle}/>
        </details>
        <label className="check"><input type="checkbox" checked={summaryEnabled} disabled={controlsDisabled}
          onChange={event => { if (editable()) setSummaryEnabled(event.target.checked); }}/>{summaryText.enabled}</label>
        {!summaryEnabled && <fieldset disabled={controlsDisabled}><legend>{text.columns}</legend>
          <div className="child-reference-tools">
            <button onClick={() => { if (editable()) setSelected(names.slice(0, sqliteTableBrowseLimits.columns)); }}>{text.all}</button>
            <button onClick={() => { if (editable()) setSelected([]); }}>{text.none}</button>
          </div>
          <div style={{ maxHeight: 180, overflow: 'auto' }}>{names.map(name => <label key={name} className="check">
            <input type="checkbox" aria-label={text.choose(name)} checked={selected.includes(name)}
              disabled={!selected.includes(name) && selected.length >= sqliteTableBrowseLimits.columns} onChange={event => {
              if (!editable()) return;
              const checked = event.target.checked;
              setSelected(previous => names.filter(column => column === name ? checked : previous.includes(column)));
            }}/>{name}
          </label>)}</div>
          <label className="check"><input type="checkbox" checked={distinct} onChange={event => { if (editable()) setDistinct(event.target.checked); }}/>{text.distinct}</label>
        </fieldset>}
        <SqliteTableFilters names={names} filters={filters} mode={mode} disabled={controlsDisabled} current={() => editable() && editingJoin === undefined} id={uid}
          enabledHint={text.filterHint} onFilters={setFilters} onMode={setMode}/>
        {summaryEnabled ? <>
          <QueryBuilderSummaryPanel names={names} draft={summary} disabled={controlsDisabled} onChange={next => { if (editable()) setSummary(next); }}/>
          <SqliteTableFilters names={outputs.map(item => item.key)} filters={havingFilters} mode={havingMode} disabled={controlsDisabled}
            current={() => editable() && editingJoin === undefined} id={uid} title={summaryText.having} enabledHint={summaryText.havingHint}
            columnLabel={key => summaryConditionLabel(outputs, key)} onFilters={setHavingFilters} onMode={setHavingMode}/>
        </> : <fieldset disabled={controlsDisabled}><legend>{browse.sorts}</legend>
          {sort.map((item, index) => <div key={item.id} className="filter-inputs">
            <select aria-label={browse.sortColumn(index + 1)} value={item.column} onChange={event => {
              const column = event.target.value;
              if (editable()) setSort(previous => previous.map(rule => rule === item ? { ...rule, column } : rule));
            }}>{names.map(column => <option key={column} value={column} disabled={sort.some(rule => rule !== item && rule.column === column)}>{column}</option>)}</select>
            <select aria-label={browse.sortDirection(index + 1)} value={item.direction} onChange={event => {
              const direction = event.target.value;
              if (editable() && (direction === 'asc' || direction === 'desc')) setSort(previous => previous.map(rule => rule === item ? { ...rule, direction } : rule));
            }}><option value="asc">{browse.ascending}</option><option value="desc">{browse.descending}</option></select>
            <button aria-label={browse.up(index + 1)} disabled={!index} onClick={() => moveSort(index, -1)}>↑</button>
            <button aria-label={browse.down(index + 1)} disabled={index === sort.length - 1} onClick={() => moveSort(index, 1)}>↓</button>
            <button aria-label={browse.removeSort(index + 1)} onClick={() => { if (editable()) setSort(previous => previous.filter(rule => rule !== item)); }}>×</button>
          </div>)}
          <button disabled={sort.length >= Math.min(names.length, sqliteTableBrowseLimits.sorts)} onClick={() => {
            const column = names.find(name => !sort.some(item => item.column === name));
            if (column && editable()) setSort([...sort, { id: uid(), column, direction: 'asc' }]);
          }}>{browse.addSort}</button>
        </fieldset>}
        <Field label={text.limit}><input inputMode="numeric" maxLength={7} disabled={controlsDisabled} value={limit}
          onChange={event => { if (editable()) setLimit(event.target.value); }}/></Field>
        <p>{text.limitHint}</p>
        {preview?.design && <ViewQueryInspect owner={preview} labels={text.inspectLabels} hint={text.inspection(sqliteQueryBuilderSampleRows)} disabled={controlsDisabled} current={current}
          read={inspect => invoke('sqlite.queryBuilder.inspect', { ...preview.design, inspect })}/>}
        {preview?.sql && <section aria-label={text.preview}><pre style={{ whiteSpace: 'pre-wrap' }}>{preview.sql};</pre></section>}
      </>}
      <ErrorBox message={stale ? text.stale : error || preview?.error}/>{message && <Spinner text={message}/>}
    </div>
    <footer className="modal-footer">
      {source ? <button disabled={controlsDisabled} onClick={() => { if (editable()) { setSource(undefined); setError(''); } }}>{text.changeSource}</button> :
        <button onClick={() => close(onBack)}>{text.back}</button>}
      <span className="grow"/><button onClick={() => close(onClose)}>{zh.common.cancel}</button>
      {source && <button disabled={controlsDisabled || !preview?.design || !canCreateView} title={canCreateView ? undefined : viewText.builderReadOnly}
        onClick={() => open(true)}>{viewText.builderEntry}</button>}
      {source ? <button className="primary" disabled={controlsDisabled || !preview?.design} onClick={() => open()}>{text.open}</button> :
        <button className="primary" disabled={controlsDisabled || !target} onClick={readSource}>{text.read}</button>}
    </footer>
  </Modal>;
}
