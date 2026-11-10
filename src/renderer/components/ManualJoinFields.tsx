import { useState } from 'react';
import type { TableInfo } from '../../shared/contracts';
import { foreignKeyJoinLimits, isManualJoinOperator, manualJoinAlias, manualJoinOperators, type ManualJoinPair, type ManualJoinStep } from '../tableForeignKeyJoin';
import { tableForeignKeyJoinZh as text } from '../locales/tableForeignKeyJoin.zh-CN';
import { uid } from '../lib';
import '../childReferences.css';

export interface ManualJoinSelection {
  database: string; table: string; pairs: Array<ManualJoinPair & { id: string }>;
}

/** 只分页显示已读取的目录，过滤和翻页不改变原目标或触发读取。 */
export function ManualJoinTableFields({ selection, databases, tables, disabled, onDatabases, onTables, onTarget }: {
  selection: ManualJoinSelection; databases: readonly string[]; tables?: readonly string[]; disabled: boolean;
  onDatabases(): void; onTables(): void; onTarget(database: string, table: string): void;
}) {
  const [search, setSearch] = useState(''), [page, setPage] = useState(0);
  const visible = (tables ?? []).filter(name => name.toLowerCase().includes(search.toLowerCase())), pageSize = 50;
  const last = Math.max(0, Math.ceil(visible.length / pageSize) - 1), index = Math.min(page, last);
  const names = visible.slice(index * pageSize, (index + 1) * pageSize);
  return <fieldset disabled={disabled}>
    <label>{text.manualDatabase}<select value={selection.database} onChange={event => onTarget(event.target.value, '')}>
      {databases.map(database => <option key={database} value={database}>{database}</option>)}
    </select></label>
    <div className="child-reference-tools"><button onClick={onDatabases}>{text.manualDatabases}</button><button onClick={onTables}>{text.manualTables}</button></div>
    {!!tables?.length && <>
      <label>{text.manualSearch}<input value={search} maxLength={64} onChange={event => { setSearch(event.target.value); setPage(0); }}/></label>
      <label>{text.manualTable}<select value={selection.table} onChange={event => onTarget(selection.database, event.target.value)}>
        <option value="">{text.manualSelect}</option>
        {selection.table && !names.includes(selection.table) && <option value={selection.table}>{selection.table}</option>}
        {names.map(name => <option key={name} value={name}>{name}</option>)}
      </select></label>
      {last > 0 && <div className="child-reference-tools">
        <button disabled={!index} onClick={() => setPage(index - 1)}>{text.manualPrevious}</button>
        <span>{text.manualPage(index + 1, last + 1)}</span>
        <button disabled={index >= last} onClick={() => setPage(index + 1)}>{text.manualNext}</button>
      </div>}
    </>}
    {!visible.length && <p className="muted">{tables ? text.manualTableEmpty : text.manualTablePending}</p>}
  </fieldset>;
}

/** 输入是列身份，空选项保留未完成状态，不能作为 SQL 表达式。 */
export function ManualJoinPairFields({ selection, child, parent, disabled, onAdd, onChange, onRemove }: {
  selection: ManualJoinSelection; child: TableInfo; parent: TableInfo; disabled: boolean;
  onAdd(): void; onChange(id: string, patch: Partial<ManualJoinPair>): void; onRemove(id: string): void;
}) {
  return <fieldset disabled={disabled}>
    <legend>{text.manualPairs}</legend>
    {selection.pairs.map((pair, index) => <div className="filter-inputs" key={pair.id}>
      <label>{text.manualChild(index + 1)}<select value={pair.child} onChange={event => onChange(pair.id, { child: event.target.value })}>
        <option value="">{text.manualSelect}</option>
        {child.columns.map(column => <option key={column.name} value={column.name}>{column.name}</option>)}
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
    </div>)}
    <button disabled={selection.pairs.length >= foreignKeyJoinLimits.manualPairs} onClick={onAdd}>{text.manualAddPair}</button>
  </fieldset>;
}

export interface AdditionalJoinDraft extends ManualJoinSelection {
  id: string;
  source: number;
  kind: 'INNER' | 'LEFT';
  tables?: readonly string[];
  info?: TableInfo;
  columns: string[];
}

/** 只发布已明确读过的目录。缺失表结构时停留在草稿，不生成部分 JOIN。 */
export function manualJoinSteps(drafts: readonly AdditionalJoinDraft[]): ManualJoinStep[] {
  return drafts.map(({ source, kind, info, pairs, columns }) => {
    if (!info) throw Error(text.additionalIncomplete);
    return { source, kind, target: info, pairs: pairs.map(({ id: _id, ...condition }) => condition), columns };
  });
}

/** 追加表复用目录和字段对控件。每个步骤的输出可单独增减。 */
export function AdditionalJoinFields({ draft, index, sources, databases, disabled, canRetarget, showColumns, onRead, onChange, onRemove }: {
  draft: AdditionalJoinDraft; index: number; sources: readonly TableInfo[]; databases: readonly string[];
  disabled: boolean; canRetarget: boolean; showColumns: boolean;
  onRead(kind: 'databases' | 'tables' | 'preview'): void; onChange(draft: AdditionalJoinDraft): void; onRemove(): void;
}) {
  const child = sources[draft.source];
  return <fieldset disabled={disabled}>
    <legend>{text.additionalTitle(manualJoinAlias(index + 2))}</legend>
    <ManualJoinTableFields key={draft.database} selection={draft} databases={databases} tables={draft.tables}
      disabled={!canRetarget} onDatabases={() => onRead('databases')} onTables={() => onRead('tables')}
      onTarget={(database, table) => onChange({ ...draft, database, table, tables: database === draft.database ? draft.tables : undefined,
        info: undefined, pairs: [], columns: [] })}/>
    <button disabled={!canRetarget || !draft.tables?.includes(draft.table)} onClick={() => onRead('preview')}>{text.manualRead}</button>
    <label>{text.additionalSource}<select value={draft.source} onChange={event => {
      const source = Number(event.target.value);
      if (sources[source] && source !== draft.source) onChange({ ...draft, source, pairs: draft.pairs.map(pair => ({ ...pair, child: '' })) });
    }}>
      {sources.map((info, index) => <option value={index} key={index}>{manualJoinAlias(index)} · {info.database}.{info.name}</option>)}
    </select></label>
    <label>{text.joinKind}<select value={draft.kind} onChange={event => {
      const kind = event.target.value;
      if (kind === 'INNER' || kind === 'LEFT') onChange({ ...draft, kind });
    }}>
      <option value="INNER">{text.additionalInner}</option><option value="LEFT">{text.additionalLeft}</option>
    </select></label>
    {child && draft.info && <ManualJoinPairFields selection={draft} child={child} parent={draft.info} disabled={disabled}
      onAdd={() => onChange({ ...draft, pairs: [...draft.pairs, newManualJoinPair()] })}
      onChange={(id, patch) => onChange({ ...draft, pairs: draft.pairs.map(pair => pair.id === id ? { ...pair, ...patch } : pair) })}
      onRemove={id => onChange({ ...draft, pairs: draft.pairs.filter(pair => pair.id !== id) })}/>}
    {showColumns && draft.info && <AdditionalJoinColumns key={draft.info.database + '\0' + draft.info.name}
      info={draft.info} columns={draft.columns} onChange={columns => onChange({ ...draft, columns })}/>}
    {canRetarget && <button onClick={onRemove}>{text.additionalRemove}</button>}
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
