import { assertSingleQueryDraftColumns, type PostgresSingleQueryDraft, type SingleQueryDraft } from '../../shared/singleQueryDesigns';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FilterGroup, FilterMode, FilterRule, SortRule } from '../../shared/contracts';
import { buildPostgresQueryBuilderSql, postgresBuilderAlias, postgresBuilderColumnKey, postgresBuilderJoinLimits,
  postgresQueryBuilderLimits, type PostgresQueryBuilderSource } from '../../shared/postgresQueryBuilder';
import { parsePostgresCatalogName, postgresRelationName } from '../../shared/postgresSql';
import { queryDatabasePatch } from '../../shared/queryContext';
import { errorMessage, invoke } from '../lib';
import { postgresQueryBuilderZh as text } from '../locales/postgresQueryBuilder.zh-CN';
import { postgresTableZh } from '../locales/postgresTable.zh-CN';
import { queryBuilderSummaryZh as summaryText } from '../locales/queryBuilderSummary.zh-CN';
import { queryViewDraftZh as viewText } from '../locales/queryViewDraft.zh-CN';
import { zh } from '../locales/zh-CN';
import { useWorkspace } from '../store';
import { tableFilterGroupAfterChange } from '../tableFilterGroups';
import { filterRuleSummary } from '../tableFilters';
import { queryViewDefinition, type ViewQuerySeed } from '../queryViewDraft';
import { PostgresCreateViewDialog } from './PostgresCreateViewDialog';
import { TableFilterGroupsDialog } from './TableFilterGroupsDialog';
import { TableFilterPanel } from './TableFilterPanel';
import { TableSortPanel } from './TableSortPanel';
import { emptyQueryBuilderSummary, QueryBuilderSummaryPanel, queryBuilderSummaryFromDraft, queryBuilderSummaryOutputs,
  resolveSummaryConditionColumn, summaryConditionLabel } from './QueryBuilderSummaryPanel';
import { SingleQueryDesignPanel } from './SingleQueryDesignPanel';
import { PostgresQueryJoinPanel, type PostgresJoinDraft } from './PostgresQueryJoinPanel';
import { tableForeignKeyJoinZh as designText } from '../locales/tableForeignKeyJoin.zh-CN';
import { ViewQueryInspect } from './ViewQueryInspect';
import { ErrorBox, Field, Modal, Spinner } from './ui';

interface CatalogueEntry { key: string; schema: string; name: string }

function compileDesign(draft: PostgresSingleQueryDraft, source: PostgresQueryBuilderSource, joins: readonly PostgresJoinDraft[] = []) {
  const { selected, distinct, limit, sort, rules, mode, group, summaryEnabled, summary, havingRules, havingMode, havingGroup } = draft;
  const outputs = queryBuilderSummaryOutputs(summary);
  if (!summaryEnabled && !selected.length) throw Error(text.noColumns);
  const rowLimit = limit ? Number(limit) : undefined;
  if (rowLimit !== undefined && (!/^[1-9]\d*$/.test(limit) || rowLimit > postgresQueryBuilderLimits.rowLimit)) throw Error(text.invalidLimit);
  const design = { ...source.target, fingerprint: source.fingerprint, columns: summaryEnabled ? [] : selected,
    distinct: !summaryEnabled && distinct, rowLimit, sort: summaryEnabled ? [] : sort,
    summary: summaryEnabled ? { ...queryBuilderSummaryFromDraft(summary), having: havingRules.length ? {
      rules: havingRules.map(rule => ({ ...rule, column: resolveSummaryConditionColumn(outputs, rule.column) })),
      mode: havingMode, group: havingGroup,
    } : undefined } : undefined,
    filter: rules.length ? { rules, mode, group } : undefined,
    joins: joins.length ? joins.map(item => item.step) : undefined };
  return { design, sql: buildPostgresQueryBuilderSql(design, source, joins.map(item => item.source)) };
}

/** 从连接和数据库创建独立草稿。预览结果与待打开的 SQL 只归属当前设计和原活动标签。 */
export function PostgresQueryBuilderDialog({ connectionId, database, onBack, onClose, onViewDirty, onViewCreated }: {
  connectionId: string; database: string; onBack(): void; onClose(): void;
  onViewDirty(dirty: boolean): void;
  onViewCreated(target: { connectionId: string; database: string }, view: string, version: number, message: string): void;
}) {
  const [owner] = useState(() => {
    const workspace = useWorkspace.getState();
    return { profile: workspace.connections.find(item => item.id === connectionId),
      version: workspace.connectionVersions[connectionId] ?? 0, tab: workspace.settings.activeTabId, stale: false };
  });
  const [catalogue, setCatalogue] = useState<CatalogueEntry[]>();
  const [table, setTable] = useState(''), [schema, setSchema] = useState(''), [search, setSearch] = useState('');
  const [source, setSource] = useState<PostgresQueryBuilderSource>();
  const [joins, setJoins] = useState<PostgresJoinDraft[]>([]);
  const singleDraft = useRef<PostgresSingleQueryDraft | undefined>(undefined);
  const [selected, setSelected] = useState<string[]>([]), [distinct, setDistinct] = useState(false), [limit, setLimit] = useState('');
  const [rules, setRules] = useState<FilterRule[]>([]), [mode, setMode] = useState<FilterMode>('all'), [group, setGroup] = useState<FilterGroup>();
  const [sort, setSort] = useState<SortRule[]>([]), [editor, setEditor] = useState<'group' | 'sort' | 'having'>();
  const [summaryEnabled, setSummaryEnabled] = useState(false), [summary, setSummary] = useState(emptyQueryBuilderSummary);
  const [havingRules, setHavingRules] = useState<FilterRule[]>([]), [havingMode, setHavingMode] = useState<FilterMode>('all');
  const [havingGroup, setHavingGroup] = useState<FilterGroup>();
  const [message, setMessage] = useState(''), [error, setError] = useState(''), [stale, setStale] = useState(false);
  const [viewSeed, setViewSeed] = useState<ViewQuerySeed>();
  const [restoreEpoch, setRestoreEpoch] = useState(0);
  const mounted = useRef(false), pending = useRef(false);
  const fields = useMemo(() => source ? [source, ...joins.map(item => item.source)].flatMap((relation, index) =>
    relation.columns.map(({ name, type }) => ({ name: joins.length ? postgresBuilderColumnKey(index, name) : name, type }))) : [], [source, joins]);
  const names = useMemo(() => fields.map(column => column.name), [fields]);
  const outputs = useMemo(() => queryBuilderSummaryOutputs(summary), [summary]);
  const schemas = useMemo(() => [...new Set(catalogue?.map(item => item.schema))], [catalogue]);
  const choices = catalogue?.filter(item => (!schema || item.schema === schema) &&
    (item.key === table || (item.schema + '.' + item.name).toLowerCase().includes(search.toLowerCase())));
  const draft = useMemo<PostgresSingleQueryDraft>(() => ({ dialect: 'postgresql', version: 1, selected, distinct, limit, sort, rules, mode, group, summaryEnabled, summary, havingRules, havingMode, havingGroup }),
    [selected, distinct, limit, sort, rules, mode, group, summaryEnabled, summary, havingRules, havingMode, havingGroup]);
  const preview = useMemo<(ReturnType<typeof compileDesign> & { error?: never }) |
    { error: string; design?: never; sql?: never } | undefined>(() => {
    if (!source) return;
    try { return compileDesign(draft, source, joins); }
    catch (reason) { return { error: errorMessage(reason) }; }
  }, [draft, source, joins]);

  function current(): boolean {
    if (!mounted.current || owner.stale) return false;
    const workspace = useWorkspace.getState();
    owner.stale = owner.profile?.dialect !== 'postgresql' || workspace.connections.find(item => item.id === connectionId) !== owner.profile ||
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

  const editable = () => current() && !pending.current;
  const disabled = stale || !!message;
  function close(next: () => void) { if (mounted.current) { mounted.current = false; next(); } }

  /** 目录读取和草稿交接串行，同一点击只消费一次。晚回包在原窗口关闭后丢弃。 */
  async function run(label: string, read: () => Promise<void>) {
    if (!editable()) return;
    pending.current = true; setError(''); setMessage(label);
    try { await read(); }
    catch (reason) { if (current()) setError(errorMessage(reason)); }
    finally { pending.current = false; if (mounted.current) setMessage(''); }
  }

  function loadCatalogue() {
    void run(text.loading, async () => {
      const objects = await invoke('postgres.queryBuilder.catalogue', { connectionId, database });
      if (!current()) return;
      const entries = objects.flatMap(object => {
        const parts = parsePostgresCatalogName(object.name);
        return parts ? [{ key: object.name, ...parts }] : [];
      });
      setCatalogue(entries);
      if (!entries.some(item => item.key === table)) setTable('');
      if (!entries.some(item => item.schema === schema)) setSchema('');
    });
  }

  function loadSource() {
    if (!table) return;
    void run(text.loading, async () => {
      const result = await invoke('postgres.queryBuilder.describe', { connectionId, database, table });
      if (!current()) return;
      if (result.target.connectionId !== connectionId || result.target.database !== database || result.target.table !== table)
        throw Error(text.stale);
      setSource(result); setSelected(result.columns.map(column => column.name));
      setRules([]); setMode('all'); setGroup(undefined); setSort([]); setDistinct(false); setLimit('');
      setSummaryEnabled(false); setSummary(emptyQueryBuilderSummary);
      setHavingRules([]); setHavingMode('all'); setHavingGroup(undefined);
      setJoins([]); singleDraft.current = undefined;
    });
  }

  /** 先验证整份本地设计，再发布结构与草稿；失败时原设计保持。 */
  async function restore(value: SingleQueryDraft) {
    if (!source || value.dialect !== 'postgresql') throw Error(designText.designModeMismatch);
    const target = source.target;
    const steps = value.joins ?? [];
    const joinTables = steps.map(step => step.table);
    const sources = steps.length ? await invoke('postgres.queryBuilder.describeJoin', { ...target, joinTables }) :
      [await invoke('postgres.queryBuilder.describe', target)];
    if (!current()) return;
    const tables = [target.table, ...joinTables];
    if (sources.length !== tables.length || sources.some(({ target: actual }, index) =>
      actual.connectionId !== target.connectionId || actual.database !== target.database || actual.table !== tables[index])) throw Error(text.stale);
    const [fresh, ...related] = sources;
    const next = steps.map((step, index) => ({ source: related[index], step: { ...step, fingerprint: related[index].fingerprint } }));
    const available = sources.flatMap((relation, index) => relation.columns.map(column =>
      next.length ? postgresBuilderColumnKey(index, column.name) : column.name));
    assertSingleQueryDraftColumns(value, available);
    compileDesign(value, fresh, next);
    if (next.length && !joins.length) singleDraft.current = draft;
    setSource(fresh); setJoins(next); applyDraft(value);
  }

  function applyDraft(value: PostgresSingleQueryDraft) {
    setSelected(value.selected); setDistinct(value.distinct); setLimit(value.limit); setSort(value.sort);
    setSummaryEnabled(value.summaryEnabled); setSummary(value.summary);
    setRules(value.rules); setMode(value.mode); setGroup(value.group);
    setHavingRules(value.havingRules); setHavingMode(value.havingMode); setHavingGroup(value.havingGroup);
    // 条件编辑器可能持有旧行下标，恢复后必须重新建立未提交的输入。
    setRestoreEpoch(epoch => epoch + 1);
  }

  /** 首次进入关联模式时冻结原单表设计，追加来源时已有别名和条件保持。 */
  function addJoin(table: string) {
    if (!source || editor || joins.length >= postgresBuilderJoinLimits.steps || !catalogue?.some(item => item.key === table)) return;
    void run(text.loading, async () => {
      const right = await invoke('postgres.queryBuilder.describe', { connectionId, database, table });
      if (!current()) return;
      if (right.target.connectionId !== connectionId || right.target.database !== database || right.target.table !== table) throw Error(text.stale);
      const next = right.columns.map(column => postgresBuilderColumnKey(joins.length + 1, column.name));
      if (!joins.length) {
        singleDraft.current = draft;
        const root = source.columns.map(column => postgresBuilderColumnKey(0, column.name));
        applyDraft({ ...draft, selected: [...root, ...next].slice(0, postgresQueryBuilderLimits.columns),
          distinct: false, rules: [], mode: 'all', group: undefined, sort: [], summaryEnabled: false, summary: emptyQueryBuilderSummary,
          havingRules: [], havingMode: 'all', havingGroup: undefined });
      } else {
        setSelected(previous => [...previous, ...next].slice(0, postgresQueryBuilderLimits.columns));
      }
      setJoins([...joins, { source: right, step: { table, fingerprint: right.fingerprint, kind: 'INNER', mode: 'all',
        pairs: [{ left: '', right: '', operator: '=' }] } }]);
    });
  }

  function removeLastJoin() {
    if (!editable() || editor || joins.length < 2) return;
    const prefix = postgresBuilderAlias(joins.length) + '.';
    if ([...rules.map(item => item.column), ...sort.map(item => item.column), ...summary.groups,
      ...summary.aggregates.map(item => item.column)].some(name => name.startsWith(prefix))) {
      setError(text.joinReferenced);
      return;
    }
    setError('');
    setSelected(previous => previous.filter(name => !name.startsWith(prefix)));
    setJoins(previous => previous.slice(0, -1));
    setRestoreEpoch(epoch => epoch + 1);
  }

  function backToSingle() {
    if (!editable() || editor || !singleDraft.current || !window.confirm(text.joinBackConfirm)) return;
    applyDraft(singleDraft.current);
    singleDraft.current = undefined;
    setJoins([]); setError('');
  }

  /** 原设计保持在当前组件中；提交视图前再次对照同一份结构和查询。 */
  function open(asView = false) {
    if (!source || !preview?.design || editor) return;
    const { design, sql } = preview;
    const target = source.target;
    async function verify() {
      if (!current()) throw Error(text.stale);
      if (design.joins) {
        await invoke('postgres.queryBuilder.inspect', { ...design, inspect: 'validate' });
        if (!current()) throw Error(text.stale);
        return;
      }
      const fresh = await invoke('postgres.queryBuilder.describe', target);
      if (!current() || buildPostgresQueryBuilderSql(design, fresh) !== sql) throw Error(text.stale);
    }
    void run(text.checking, async () => {
      await verify();
      if (!current()) return;
      if (asView) {
        setViewSeed({ sql: queryViewDefinition(sql, 'postgresql'), version: owner.version,
          preferredSchema: postgresRelationName(source.target.table).schema, current, beforeApply: verify });
        return;
      }
      const workspace = useWorkspace.getState();
      if (workspace.settings.tabs.length >= 100) throw Error(text.tabs);
      close(onClose);
      workspace.openTab({ kind: 'query', title: text.queryTitle(postgresRelationName(source.target.table).name), connectionId,
        ...queryDatabasePatch({ state: 'known', database }), sql: sql + ';' });
    });
  }

  if (viewSeed) return <PostgresCreateViewDialog target={{ connectionId, database }} kind="ordinary" viewSeed={viewSeed}
    onDirtyChange={onViewDirty} onCreated={(view, version, message) => onViewCreated({ connectionId, database }, view, version, message)}
    onClose={() => setViewSeed(undefined)}/>;

  return <Modal title={text.title} wide={!!source} onClose={() => close(onClose)}>
    <div className="modal-content" aria-busy={!!message}>
      {!source ? <>
        <p>{text.hint} {database}</p>
        <div className="child-reference-tools"><button disabled={disabled} onClick={loadCatalogue}>{text.catalogue}</button></div>
        {catalogue && <>
          <Field label={text.schema}><select aria-label={text.schema} value={schema} disabled={disabled} onChange={event => {
            if (editable()) { setSchema(event.target.value); setTable(''); }
          }}><option value="">{text.allSchemas}</option>{schemas.map(name => <option key={name}>{name}</option>)}</select></Field>
          <Field label={text.search}><input type="search" value={search} disabled={disabled}
            onChange={event => { if (editable()) setSearch(event.target.value); }}/></Field>
        </>}
        <Field label={text.source}><select aria-label={text.source} value={table} disabled={disabled || !choices?.length}
          onChange={event => { if (editable()) setTable(event.target.value); }}>
          <option value="">{text.chooseSource}</option>{choices?.map(item => <option key={item.key} value={item.key}>{item.key}</option>)}
        </select></Field>
        {choices?.length === 0 && <p role="status">{text.empty}</p>}
      </> : <>
        <p>{database} / {source.target.table}</p>
        {!joins.length && <SingleQueryDesignPanel scope={ { ...source.target, dialect: 'postgresql' } } draft={preview?.design ? draft : undefined}
          disabled={disabled || !!editor} current={current} run={action => void run(designText.designWorking, action)} restore={restore}/>}
        <details open={joins.length ? true : undefined}><summary>{text.joins}</summary>
          <SingleQueryDesignPanel scope={{ ...source.target, dialect: 'postgresql', join: true }}
            draft={joins.length && preview?.design ? { ...draft,
              joins: joins.map(({ step: { fingerprint: _fingerprint, ...step } }) => step) } : undefined}
            disabled={disabled || !!editor} current={current} run={action => void run(designText.designWorking, action)} restore={restore}/>
          <PostgresQueryJoinPanel source={source} entries={catalogue ?? []} joins={joins} disabled={disabled || !!editor}
            add={addJoin} change={(index, step) => {
              if (!editable() || editor) return;
              setError(''); setJoins(previous => previous.map((item, i) => i === index ? { ...item, step } : item));
            }} remove={removeLastJoin} back={backToSingle}/>
        </details>
        <label className="check"><input type="checkbox" checked={summaryEnabled} disabled={disabled || !!editor}
          onChange={event => { if (editable()) setSummaryEnabled(event.target.checked); }}/>{summaryText.enabled}</label>
        {!summaryEnabled && <fieldset disabled={disabled || !!editor}><legend>{text.columns}</legend>
          <div className="child-reference-tools">
            <button onClick={() => { if (editable()) setSelected(names); }}>{text.all}</button>
            <button onClick={() => { if (editable()) setSelected([]); }}>{text.none}</button>
          </div>
          <div style={{ maxHeight: 180, overflow: 'auto' }}>{fields.map(({ name, type }) => <label key={name} className="check">
            <input type="checkbox" aria-label={text.choose(name)} checked={selected.includes(name)} onChange={event => {
              if (!editable()) return;
              const checked = event.target.checked;
              setSelected(previous => names.filter(column => column === name ? checked : previous.includes(column)));
            }}/>{name} <small className="muted">{type}</small>
          </label>)}</div>
          <label className="check"><input type="checkbox" checked={distinct} onChange={event => { if (editable()) setDistinct(event.target.checked); }}/>{text.distinct}</label>
        </fieldset>}
        <fieldset><legend>{text.filter}</legend>
          <TableFilterPanel key={restoreEpoch} columns={names} filters={rules} mode={mode} disabled={disabled || !!editor} multilineScalar applyShortcut
            onFiltersChange={next => {
              if (!editable()) return false;
              setGroup(tableFilterGroupAfterChange(rules, next, group, mode)); setRules(next); return true;
            }} onModeChange={next => {
              if (!editable()) return false;
              setMode(next); setGroup(previous => previous && { ...previous, mode: next }); return true;
            }}/>
          <button disabled={disabled || !!editor || !rules.length} onClick={() => { if (editable()) setEditor('group'); }}>{postgresTableZh.filterGroups}</button>
          {editor === 'group' && <TableFilterGroupsDialog filters={rules} mode={mode} initial={group} isCurrent={editable}
            onApply={next => { if (!editable()) return false; setMode(next.mode); setGroup(next); setEditor(undefined); return true; }}
            onClose={() => setEditor(undefined)}/>}
        </fieldset>
        {summaryEnabled ? <>
          <QueryBuilderSummaryPanel names={names} draft={summary} disabled={disabled || !!editor}
            onChange={next => { if (editable()) setSummary(next); }}/>
          <fieldset aria-label={summaryText.having}><legend>{summaryText.having}</legend>
            <p className="muted small">{summaryText.havingHint}</p>
            <TableFilterPanel key={restoreEpoch} columns={outputs.map(item => item.key)} columnLabel={key => summaryConditionLabel(outputs, key)}
              filters={havingRules} mode={havingMode} disabled={disabled || !!editor} multilineScalar applyShortcut
              onFiltersChange={next => {
                if (!editable()) return false;
                setHavingGroup(tableFilterGroupAfterChange(havingRules, next, havingGroup, havingMode)); setHavingRules(next); return true;
              }} onModeChange={next => {
                if (!editable()) return false;
                setHavingMode(next); setHavingGroup(previous => previous && { ...previous, mode: next }); return true;
              }}/>
            <button disabled={disabled || !!editor || !havingRules.length} onClick={() => { if (editable()) setEditor('having'); }}>{summaryText.havingGroups}</button>
            {editor === 'having' && <TableFilterGroupsDialog filters={havingRules} mode={havingMode} initial={havingGroup}
              presentation={{ hint: summaryText.havingHint, stale: summaryText.havingStale, declined: summaryText.havingStale,
                summary: (_index, rule) => filterRuleSummary({ ...rule, column: summaryConditionLabel(outputs, rule.column) }) }}
              isCurrent={editable} onApply={next => {
                if (!editable()) return false;
                setHavingMode(next.mode); setHavingGroup(next); setEditor(undefined); return true;
              }} onClose={() => setEditor(undefined)}/>}
          </fieldset>
        </> : <>
          <div className="child-reference-tools"><button disabled={disabled || !!editor} onClick={() => { if (editable()) setEditor('sort'); }}>{text.sort}</button>
            <span className="muted small">{text.sorted(sort.length)}</span></div>
          {editor === 'sort' && <TableSortPanel columns={names} initial={sort} hint={text.sortHint} ties={text.sortTies} isCurrent={editable}
            onApply={next => { if (!editable()) return false; setSort(next); setEditor(undefined); return true; }} onClose={() => setEditor(undefined)}/>}
        </>}
        <Field label={text.limit}><input inputMode="numeric" maxLength={7} disabled={disabled || !!editor} value={limit}
          onChange={event => { if (editable()) setLimit(event.target.value); }}/></Field>
        <p>{text.limitHint}</p>
        {preview?.design && <ViewQueryInspect owner={preview} labels={text.inspectLabels} hint={text.inspection(postgresQueryBuilderLimits.rows)}
          disabled={disabled || !!editor} current={current} read={inspect => invoke('postgres.queryBuilder.inspect', { ...preview.design, inspect })}/>}
        {preview?.sql && <section aria-label={text.preview}><pre style={{ whiteSpace: 'pre-wrap' }}>{preview.sql};</pre></section>}
      </>}
      <ErrorBox message={stale ? text.stale : error || preview?.error}/>{message && <Spinner text={message}/>}
    </div>
    <footer className="modal-footer">
      {source ? <button disabled={disabled || !!editor} onClick={() => { if (editable()) { setSource(undefined); setError(''); } }}>{text.changeSource}</button> :
        <button onClick={() => close(onBack)}>{text.back}</button>}
      <span className="grow"/><button onClick={() => close(onClose)}>{zh.common.cancel}</button>
      {source && <button disabled={disabled || !!editor || !preview?.design} onClick={() => open(true)}>{viewText.builderEntry}</button>}
      {source ? <button className="primary" disabled={disabled || !!editor || !preview?.design} onClick={() => open()}>{text.open}</button> :
        <button className="primary" disabled={disabled || !table} onClick={loadSource}>{text.read}</button>}
    </footer>
  </Modal>;
}
