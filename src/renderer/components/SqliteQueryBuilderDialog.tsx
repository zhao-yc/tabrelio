import { assertSingleQueryDraftColumns, type SqliteSingleQueryDraft, type SingleQueryDraft } from '../../shared/singleQueryDesigns';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DatabaseObject } from '../../shared/contracts';
import { queryDatabasePatch } from '../../shared/queryContext';
import { sqliteTableBrowseLimits } from '../../shared/sqliteTableBrowse';
import { buildSqliteQueryBuilderSql, sqliteQueryBuilderSampleRows, type SqliteQueryBuilderSource, type SqliteQueryBuilderTarget } from '../../shared/sqliteQueryBuilder';
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
import { tableForeignKeyJoinZh as designText } from '../locales/tableForeignKeyJoin.zh-CN';
import { ViewQueryInspect } from './ViewQueryInspect';
import { ErrorBox, Field, Modal, Spinner } from './ui';

function compileDesign(draft: SqliteSingleQueryDraft, source: SqliteQueryBuilderSource) {
  const { selected, distinct, limit, sort, filters, mode, summaryEnabled, summary, havingFilters, havingMode } = draft;
  const outputs = queryBuilderSummaryOutputs(summary);
  if (!summaryEnabled && !selected.length) throw Error(text.noColumns);
  const rowLimit = limit === '' ? undefined : Number(limit);
  if (rowLimit !== undefined && (!/^[1-9]\d*$/.test(limit) || rowLimit > sqliteReadSqlLimits.limit)) throw Error(text.invalidLimit);
  const { connectionId, database, table } = source.target;
  const { limit: _limit, ...query } = sqliteTableDraft({ connectionId, database, table }, 1, mode, filters, summaryEnabled ? [] : sort);
  const having = summaryEnabled && havingFilters.length ? sqliteTableDraft({ connectionId, database, table }, 1, havingMode,
    havingFilters.map(rule => ({ ...rule, column: resolveSummaryConditionColumn(outputs, rule.column) })), []) : undefined;
  const design = { ...source.target, ...query, schemaKey: source.schemaKey, columns: summaryEnabled ? [] : selected,
    distinct: !summaryEnabled && distinct, rowLimit, summary: summaryEnabled ? { ...queryBuilderSummaryFromDraft(summary),
      having: having && { mode: having.mode, filters: having.filters } } : undefined };
  return { design, sql: buildSqliteQueryBuilderSql(design, source) };
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
  const names = useMemo(() => source?.columns.map(column => column.name) ?? [], [source]);
  const outputs = useMemo(() => queryBuilderSummaryOutputs(summary), [summary]);
  const draft = useMemo<SqliteSingleQueryDraft>(() => ({ dialect: 'sqlite', version: 1, selected, distinct, limit, sort, filters, mode, summaryEnabled, summary, havingFilters, havingMode }),
    [selected, distinct, limit, sort, filters, mode, summaryEnabled, summary, havingFilters, havingMode]);
  const preview = useMemo<(ReturnType<typeof compileDesign> & { error?: never }) |
    { error: string; design?: never; sql?: never } | undefined>(() => {
    if (!source) return;
    try { return compileDesign(draft, source); }
    catch (reason) { return { error: errorMessage(reason) }; }
  }, [draft, source]);

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
  function close(callback: () => void) { if (mounted.current) { mounted.current = false; callback(); } }

  /** 同步占门，目录与草稿的迟到回包仅交还原窗口。 */
  async function run(label: string, action: (owns: () => boolean) => Promise<void>) {
    if (!editable()) return;
    const ticket = {}; operation.current = ticket;
    setError(''); setMessage(label);
    const owns = () => current() && operation.current === ticket;
    try { await action(owns); }
    catch (reason) { if (owns()) setError(errorMessage(reason)); }
    finally { operation.current = undefined; if (mounted.current) setMessage(''); }
  }

  function readSource() {
    if (!target || (target.kind !== 'table' && target.kind !== 'view')) return;
    const scope: SqliteQueryBuilderTarget = { connectionId, database: 'main', table: target.name, kind: target.kind };
    void run(text.loading, async owns => {
      const result = await invoke('sqlite.queryBuilder.describe', scope);
      if (!owns()) return;
      if (result.target.connectionId !== scope.connectionId || result.target.database !== scope.database ||
          result.target.table !== scope.table || result.target.kind !== scope.kind) throw Error(text.stale);
      setSelected(result.columns.map(column => column.name));
      setFilters([]); setSort([]); setMode('and'); setDistinct(false); setLimit(''); setSource(result);
      setSummaryEnabled(false); setSummary(emptyQueryBuilderSummary);
      setHavingFilters([]); setHavingMode('and');
    });
  }

  /** 先验证整份本地设计，再发布结构与草稿；失败时原设计保持。 */
  async function restore(value: SingleQueryDraft) {
    if (!source || value.dialect !== 'sqlite') throw Error(designText.designModeMismatch);
    const target = source.target;
    const fresh = await invoke('sqlite.queryBuilder.describe', target);
    if (!current()) return;
    if (fresh.target.connectionId !== target.connectionId || fresh.target.database !== target.database ||
        fresh.target.table !== target.table || fresh.target.kind !== target.kind) throw Error(text.stale);
    assertSingleQueryDraftColumns(value, fresh.columns.map(column => column.name));
    compileDesign(value, fresh);
    setSource(fresh); setSelected(value.selected); setDistinct(value.distinct); setLimit(value.limit); setSort(value.sort);
    setSummaryEnabled(value.summaryEnabled); setSummary(value.summary);
    setFilters(value.filters); setMode(value.mode);
    setHavingFilters(value.havingFilters); setHavingMode(value.havingMode);
  }

  /** 返回构建器时保留原草稿，视图提交前重新核对同一个 SQLite 来源。 */
  function open(asView = false) {
    if (!source || !preview?.design || asView && !canCreateView) return;
    const { design, sql } = preview;
    const target = source.target;
    async function verify() {
      if (!current()) throw Error(text.stale);
      const fresh = await invoke('sqlite.queryBuilder.describe', target);
      if (!current() || buildSqliteQueryBuilderSql(design, fresh) !== sql) throw Error(text.stale);
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
        <SingleQueryDesignPanel scope={ { ...source.target, dialect: 'sqlite' } } draft={preview?.design ? draft : undefined}
          disabled={disabled} current={current} run={action => void run(designText.designWorking, () => action())} restore={restore}/>
        <label className="check"><input type="checkbox" checked={summaryEnabled} disabled={disabled}
          onChange={event => { if (editable()) setSummaryEnabled(event.target.checked); }}/>{summaryText.enabled}</label>
        {!summaryEnabled && <fieldset disabled={disabled}><legend>{text.columns}</legend>
          <div className="child-reference-tools">
            <button onClick={() => { if (editable()) setSelected(names); }}>{text.all}</button>
            <button onClick={() => { if (editable()) setSelected([]); }}>{text.none}</button>
          </div>
          <div style={{ maxHeight: 180, overflow: 'auto' }}>{names.map(name => <label key={name} className="check">
            <input type="checkbox" aria-label={text.choose(name)} checked={selected.includes(name)} onChange={event => {
              if (!editable()) return;
              const checked = event.target.checked;
              setSelected(previous => names.filter(column => column === name ? checked : previous.includes(column)));
            }}/>{name}
          </label>)}</div>
          <label className="check"><input type="checkbox" checked={distinct} onChange={event => { if (editable()) setDistinct(event.target.checked); }}/>{text.distinct}</label>
        </fieldset>}
        <SqliteTableFilters names={names} filters={filters} mode={mode} disabled={disabled} current={editable} id={uid}
          enabledHint={text.filterHint} onFilters={setFilters} onMode={setMode}/>
        {summaryEnabled ? <>
          <QueryBuilderSummaryPanel names={names} draft={summary} disabled={disabled} onChange={next => { if (editable()) setSummary(next); }}/>
          <SqliteTableFilters names={outputs.map(item => item.key)} filters={havingFilters} mode={havingMode} disabled={disabled}
            current={editable} id={uid} title={summaryText.having} enabledHint={summaryText.havingHint}
            columnLabel={key => summaryConditionLabel(outputs, key)} onFilters={setHavingFilters} onMode={setHavingMode}/>
        </> : <fieldset disabled={disabled}><legend>{browse.sorts}</legend>
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
        <Field label={text.limit}><input inputMode="numeric" maxLength={7} disabled={disabled} value={limit}
          onChange={event => { if (editable()) setLimit(event.target.value); }}/></Field>
        <p>{text.limitHint}</p>
        {preview?.design && <ViewQueryInspect owner={preview} labels={text.inspectLabels} hint={text.inspection(sqliteQueryBuilderSampleRows)} disabled={disabled} current={current}
          read={inspect => invoke('sqlite.queryBuilder.inspect', { ...preview.design, inspect })}/>}
        {preview?.sql && <section aria-label={text.preview}><pre style={{ whiteSpace: 'pre-wrap' }}>{preview.sql};</pre></section>}
      </>}
      <ErrorBox message={stale ? text.stale : error || preview?.error}/>{message && <Spinner text={message}/>}
    </div>
    <footer className="modal-footer">
      {source ? <button disabled={disabled} onClick={() => { if (editable()) { setSource(undefined); setError(''); } }}>{text.changeSource}</button> :
        <button onClick={() => close(onBack)}>{text.back}</button>}
      <span className="grow"/><button onClick={() => close(onClose)}>{zh.common.cancel}</button>
      {source && <button disabled={disabled || !preview?.design || !canCreateView} title={canCreateView ? undefined : viewText.builderReadOnly}
        onClick={() => open(true)}>{viewText.builderEntry}</button>}
      {source ? <button className="primary" disabled={disabled || !preview?.design} onClick={() => open()}>{text.open}</button> :
        <button className="primary" disabled={disabled || !target} onClick={readSource}>{text.read}</button>}
    </footer>
  </Modal>;
}
