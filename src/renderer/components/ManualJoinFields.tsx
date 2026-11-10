import { useState } from 'react';
import type { TableInfo } from '../../shared/contracts';
import { foreignKeyJoinLimits, isManualJoinOperator, manualJoinOperators, type ManualJoinPair } from '../tableForeignKeyJoin';
import { tableForeignKeyJoinZh as text } from '../locales/tableForeignKeyJoin.zh-CN';
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
