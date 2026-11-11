import { useState } from 'react';
import { FILTER_LIMITS } from '../../shared/filtering';
import type { ManualJoinOn } from '../../shared/manualJoinDesigns';
import { foreignKeyJoinGroupAfterChange } from '../tableForeignKeyJoinFilters';
import { tableFilterGroupSummary, tableFilterGroupWithMode } from '../tableFilterGroups';
import type { DatabaseObject, TableInfo } from '../../shared/contracts';
import { completionIdentifier } from '../../shared/completionLexical';
import { relationshipDiagramLimits } from '../relationshipDiagram';
import { foreignKeyJoinLimits, isManualJoinOperator, manualJoinAlias, manualJoinOperators, type AdditionalJoinPair, type ManualJoinStep } from '../tableForeignKeyJoin';
import { tableForeignKeyJoinZh as text } from '../locales/tableForeignKeyJoin.zh-CN';
import { queryBuilderJoinZh as joinText } from '../locales/queryBuilderJoin.zh-CN';
import { uid } from '../lib';
import { JoinFieldMapping, type JoinFieldLinkResult } from './JoinFieldMapping';
import '../childReferences.css';

export interface ManualJoinSelection {
  database: string; table: string; pairs: Array<AdditionalJoinPair & { id: string }>; on?: ManualJoinOn;
}

/** 切换为无条件连接前确认会丢弃已填写的比较。切回时从一条空比较开始。 */
export function changeManualJoinConditions<T extends ManualJoinSelection>(draft: T, wasCross: boolean, cross: boolean, ready: boolean): T | undefined {
  if (wasCross === cross) return draft;
  if (cross && (draft.on?.group || draft.pairs.some(pair => pair.child || pair.parent)) && !window.confirm(joinText.crossConfirm)) return undefined;
  return { ...draft, pairs: !cross && ready ? [newManualJoinPair()] : [], on: undefined };
}

/** 目录仅用于选取真实名称，超量或异常回包不产生半份列表。 */
export function manualJoinCatalogNames(names: unknown[]): string[] {
  if (names.length > relationshipDiagramLimits.catalog || !names.every(completionIdentifier)) throw Error(text.invalid);
  return [...new Set(names)].sort();
}

/** 普通表才可进入构建器，视图和其它对象不出现在候选中。 */
export function manualJoinTableNames(objects: DatabaseObject[]): string[] {
  if (objects.length > relationshipDiagramLimits.catalog) throw Error(text.invalid);
  return manualJoinCatalogNames(objects.filter(object => object.kind === 'table').map(object => object.name));
}

/** 只分页显示已读取的目录，过滤和翻页不改变原目标或触发读取。 */
export function ManualJoinTableFields({ selection, databases, tables, disabled, onDatabases, onTables, onTarget }: {
  selection: ManualJoinSelection; databases: readonly string[]; tables?: readonly string[]; disabled: boolean;
  onDatabases(): void; onTables(): void; onTarget(database: string, table: string): void;
}) {
  return <fieldset disabled={disabled}>
    <label>{text.manualDatabase}<select value={selection.database} onChange={event => onTarget(event.target.value, '')}>
      {databases.map(database => <option key={database} value={database}>{database}</option>)}
    </select></label>
    <div className="child-reference-tools"><button onClick={onDatabases}>{text.manualDatabases}</button><button onClick={onTables}>{text.manualTables}</button></div>
    <ManualJoinTablePicker tables={tables} table={selection.table} onTable={table => onTarget(selection.database, table)}/>
  </fieldset>;
}

/** 同一目录选择规则供起始表与后续目标表复用。 */
export function ManualJoinTablePicker({ tables, table, onTable, source = false }: {
  tables?: readonly string[]; table: string; onTable(table: string): void; source?: boolean;
}) {
  const [search, setSearch] = useState(''), [page, setPage] = useState(0);
  const visible = (tables ?? []).filter(name => name.toLowerCase().includes(search.toLowerCase())), pageSize = 50;
  const last = Math.max(0, Math.ceil(visible.length / pageSize) - 1), index = Math.min(page, last);
  const names = visible.slice(index * pageSize, (index + 1) * pageSize);
  return <>
    {!!tables?.length && <>
      <label>{source ? text.builderSearch : text.manualSearch}<input value={search} maxLength={64} onChange={event => { setSearch(event.target.value); setPage(0); }}/></label>
      <label>{source ? text.builderTable : text.manualTable}<select value={table} onChange={event => onTable(event.target.value)}>
        <option value="">{text.manualSelect}</option>
        {table && !names.includes(table) && <option value={table}>{table}</option>}
        {names.map(name => <option key={name} value={name}>{name}</option>)}
      </select></label>
      {last > 0 && <div className="child-reference-tools">
        <button disabled={!index} onClick={() => setPage(index - 1)}>{text.manualPrevious}</button>
        <span>{text.manualPage(index + 1, last + 1)}</span>
        <button disabled={index >= last} onClick={() => setPage(index + 1)}>{text.manualNext}</button>
      </div>}
    </>}
    {!visible.length && <p className="muted">{tables ? text.manualTableEmpty : text.manualTablePending}</p>}
  </>;
}

/** 增删比较按稳定行 ID 更新括号，未编辑的组保留原语义。 */
export function replaceManualJoinPairs<T extends ManualJoinSelection>(draft: T, pairs: T['pairs']): T {
  const on = draft.on;
  return { ...draft, pairs, ...(on?.group ? { on: { ...on, group: foreignKeyJoinGroupAfterChange(draft.pairs, pairs, on.group, on.mode) } } : {}) };
}

/** 输入是列身份，空选项保留未完成状态，不能作为 SQL 表达式。 */
export function ManualJoinPairFields({ selection, child, parent, disabled, sourceOptions, current, onAppend, onChange, onRemove, onMode, onGroups }: {
  selection: ManualJoinSelection; child: TableInfo; parent: TableInfo; disabled: boolean;
  sourceOptions?: { defaultSource: number; tables: readonly TableInfo[] };
  onMode(on: ManualJoinOn): void; onGroups(trigger: HTMLButtonElement): void;
  current(): boolean; onAppend(pair: AdditionalJoinPair): void;
  onChange(id: string, patch: Partial<AdditionalJoinPair>): void; onRemove(id: string): void;
}) {
  const mode = selection.on?.mode ?? 'all', group = selection.on?.group;
  const sources = sourceOptions?.tables ?? [child], defaultSource = sourceOptions?.defaultSource ?? 0;
  const pairLimit = group ? FILTER_LIMITS.conditions : foreignKeyJoinLimits.manualPairs;
  const relation = (info: TableInfo, index: number) => ({
    label: manualJoinAlias(index) + ' · ' + info.database + '.' + info.name, columns: info.columns,
  });
  /** 复用原手动条件 ID，保证添加或填充空行后已有括号分组仍指向原比较。 */
  function linkFields(source: number, child: string, parent: string): JoinFieldLinkResult {
    if (selection.pairs.some(pair => (pair.source ?? defaultSource) === source && pair.child === child &&
        pair.parent === parent && (pair.operator ?? '=') === '=')) return 'duplicate';
    const empty = selection.pairs.find(pair => !pair.child && !pair.parent);
    const pair = { child, parent, operator: '=' as const, ...(sourceOptions ? { source } : {}) };
    if (empty) onChange(empty.id, pair);
    else if (selection.pairs.length < pairLimit) onAppend(pair);
    else return 'limit';
    return 'added';
  }
  return <fieldset disabled={disabled}>
    <legend>{text.manualPairs}</legend>
    <JoinFieldMapping revision={selection} disabled={disabled} initialSource={defaultSource} current={current} link={linkFields}
      left={sources.map(relation)} right={relation(parent, sources.length)}
      pairs={selection.pairs.filter(pair => pair.child && pair.parent).map(pair => ({
        left: manualJoinAlias(pair.source ?? defaultSource) + '.' + pair.child, right: pair.parent, operator: pair.operator ?? '=',
      }))}/>
    <label>{text.manualOnMode}<select value={mode} onChange={event => {
      const next = event.target.value;
      if (next === 'all' || next === 'any') onMode({ mode: next, group: tableFilterGroupWithMode(group, next) });
    }}>
      <option value="all">{text.manualOnAll}</option><option value="any">{text.manualOnAny}</option>
    </select></label>
    <button type="button" disabled={selection.pairs.length < 2 || selection.pairs.length > FILTER_LIMITS.conditions}
      onClick={event => onGroups(event.currentTarget)}>{text.manualOnGroups}</button>
    {group && <>
      <p>{tableFilterGroupSummary(group)}</p>
      <button type="button" onClick={() => onMode({ mode })}>{text.manualOnFlat}</button>
    </>}
    {selection.pairs.map((pair, index) => {
      const source = pair.source ?? sourceOptions?.defaultSource;
      const sourceTable = sourceOptions && source !== undefined ? sourceOptions.tables[source] : child;
      const columns = sourceTable?.columns ?? [];
      const childLabel = sourceOptions ? text.additionalChild(index + 1) : text.manualChild(index + 1);
      return <div className="filter-inputs" key={pair.id}>
        {sourceOptions && <label>{text.additionalPairSource(index + 1)}<select value={source} title={sourceTable && `${sourceTable.database}.${sourceTable.name}`} onChange={event => {
          const next = Number(event.target.value);
          // 改来源只撤销当前行的旧列，即使新来源存在同名列也要求明确选择。
          if (sourceOptions.tables[next] && next !== source) onChange(pair.id, { source: next, child: '' });
        }}>
          {sourceOptions.tables.map((info, index) => <option value={index} key={index}>{manualJoinAlias(index)} · {info.database}.{info.name}</option>)}
        </select></label>}
        <label>{childLabel}<select value={pair.child} onChange={event => onChange(pair.id, { child: event.target.value })}>
          <option value="">{text.manualSelect}</option>
          {columns.map(column => <option key={column.name} value={column.name}>{column.name}</option>)}
        </select></label>
        <label>{text.manualOperator(index + 1)}<select value={pair.operator ?? '='} onChange={event => {
          if (isManualJoinOperator(event.target.value)) onChange(pair.id, { operator: event.target.value });
        }}>
          {manualJoinOperators.map(operator => <option key={operator} value={operator}>{operator} {text.manualOperatorLabels[operator]}</option>)}
        </select></label>
        <label>{text.manualParent(index + 1)}<select value={pair.parent} onChange={event => onChange(pair.id, { parent: event.target.value })}>
          <option value="">{text.manualSelect}</option>
          {parent.columns.map(column => <option key={column.name} value={column.name}>{column.name}</option>)}
        </select></label>
        <button aria-label={text.manualRemove(index + 1)} onClick={() => onRemove(pair.id)}>×</button>
      </div>;
    })}
    <button disabled={selection.pairs.length >= pairLimit} onClick={() => onAppend({ child: '', parent: '' })}>{text.manualAddPair}</button>
  </fieldset>;
}

export interface AdditionalJoinDraft extends ManualJoinSelection {
  id: string;
  source: number;
  kind: ManualJoinStep['kind'];
  tables?: readonly string[];
  info?: TableInfo;
  columns: string[];
}

/** 只发布已明确读过的目录。缺失表结构时停留在草稿，不生成部分 JOIN。 */
export function manualJoinSteps(drafts: readonly AdditionalJoinDraft[]): ManualJoinStep[] {
  return drafts.map(({ source, kind, info, pairs, columns, on }) => {
    if (!info) throw Error(text.additionalIncomplete);
    return { source, kind, target: info, pairs: pairs.map(({ id: _id, ...condition }) => condition), columns, ...(on ? { on } : {}) };
  });
}

/** 追加表复用目录和字段对控件。每个步骤的输出可单独增减。 */
export function AdditionalJoinFields({ draft, index, sources, databases, disabled, canRetarget, targetReferenced, showColumns, current, onRead, onChange, onRemove, onGroups }: {
  draft: AdditionalJoinDraft; index: number; sources: readonly TableInfo[]; databases: readonly string[];
  disabled: boolean; canRetarget: boolean; targetReferenced: boolean; showColumns: boolean;
  current(): boolean;
  onGroups(trigger: HTMLButtonElement): void;
  onRead(kind: 'databases' | 'tables' | 'preview'): void; onChange(draft: AdditionalJoinDraft): void; onRemove(): void;
}) {
  const child = sources[draft.source];
  return <fieldset disabled={disabled}>
    <legend>{text.additionalTitle(manualJoinAlias(index + 2))}</legend>
    <ManualJoinTableFields key={draft.database} selection={draft} databases={databases} tables={draft.tables}
      disabled={!canRetarget} onDatabases={() => onRead('databases')} onTables={() => onRead('tables')}
      onTarget={(database, table) => onChange({ ...draft, database, table, tables: database === draft.database ? draft.tables : undefined,
        info: undefined, pairs: [], columns: [], on: undefined })}/>
    <button disabled={!canRetarget || !draft.tables?.includes(draft.table)} onClick={() => onRead('preview')}>{text.manualRead}</button>
    <label>{text.joinKind}<select value={draft.kind} onChange={event => {
      const kind = event.target.value;
      if (kind !== 'INNER' && kind !== 'LEFT' && kind !== 'CROSS') return;
      const next = changeManualJoinConditions(draft, draft.kind === 'CROSS', kind === 'CROSS', !!draft.info);
      if (next) onChange({ ...next, kind });
    }}>
      <option value="INNER">{text.additionalInner}</option><option value="LEFT">{text.additionalLeft}</option>
      <option value="CROSS">CROSS JOIN</option>
    </select></label>
    {draft.kind === 'CROSS' && <p className="muted small">{joinText.crossHint}</p>}
    {draft.kind !== 'CROSS' && child && draft.info && <ManualJoinPairFields selection={draft} child={child} parent={draft.info} disabled={disabled} sourceOptions={{ defaultSource: draft.source, tables: sources }}
      current={current} onMode={on => onChange({ ...draft, on })} onGroups={onGroups}
      onAppend={pair => onChange(replaceManualJoinPairs(draft, [...draft.pairs, { ...pair, id: uid() }]))}
      onChange={(id, patch) => onChange({ ...draft, pairs: draft.pairs.map(pair => pair.id === id ? { ...pair, ...patch } : pair) })}
      onRemove={id => onChange(replaceManualJoinPairs(draft, draft.pairs.filter(pair => pair.id !== id)))}/>}
    {showColumns && draft.info && <AdditionalJoinColumns key={draft.info.database + '\0' + draft.info.name}
      info={draft.info} columns={draft.columns} onChange={columns => onChange({ ...draft, columns })}/>}
    {(canRetarget || targetReferenced) && <button disabled={targetReferenced} onClick={onRemove}>{text.additionalRemove}</button>}
    {targetReferenced && <p>{text.additionalReferenced}</p>}
  </fieldset>;
}

export function newManualJoinPair() { return { id: uid(), child: '', parent: '' }; }

function AdditionalJoinColumns({ info, columns, onChange }: { info: TableInfo; columns: string[]; onChange(value: string[]): void }) {
  const [search, setSearch] = useState(''), [page, setPage] = useState(0);
  const names = info.columns.map(column => column.name).filter(name => name.toLowerCase().includes(search.toLowerCase()));
  const last = Math.max(0, Math.ceil(names.length / 50) - 1), index = Math.min(last, page);
  return <details>
    <summary>{text.additionalColumns} · {text.selected(columns.length, info.columns.length)}</summary>
    <label>{text.search}<input value={search} maxLength={64} onChange={event => { setSearch(event.target.value); setPage(0); }}/></label>
    {names.slice(index * 50, (index + 1) * 50).map(name => <label key={name} style={{ display: 'block' }}>
      <input type="checkbox" checked={columns.includes(name)} onChange={event => onChange(event.target.checked ? [...columns, name] : columns.filter(column => column !== name))}/>
      {name}
    </label>)}
    {last > 0 && <div className="child-reference-tools">
      <button disabled={index === 0} onClick={() => setPage(index - 1)}>{text.previous}</button>
      <span>{text.page(index + 1, last + 1)}</span>
      <button disabled={index === last} onClick={() => setPage(index + 1)}>{text.next}</button>
    </div>}
  </details>;
}
