import { useState } from 'react';
import type { FilterGroup, FilterMode, FilterRule } from '../../shared/contracts';
import { postgresAdvancedTableFilterSchema, type PostgresAdvancedTableFilter } from '../../shared/postgresTable';
import { postgresTableZh as text } from '../locales/postgresTable.zh-CN';
import { tableCellFilterZh } from '../locales/tableCellFilter.zh-CN';
import { tableSelectedFilterZh as selectedText } from '../locales/tableSelectedFilter.zh-CN';
import { appendPostgresValueFilter } from '../postgresTableValues';
import { errorMessage } from '../lib';
import { tableFilterGroupAfterChange, tableFilterGroupSummary } from '../tableFilterGroups';
import type { FilterDraft } from '../tableFilters';
import type { PostgresColumnReadSource } from '../postgresColumnRead';
import { PostgresTableValueOptions } from './PostgresTableValueOptions';
import { TableFilterGroupsDialog } from './TableFilterGroupsDialog';
import { TableFilterPanel } from './TableFilterPanel';
import { ErrorBox } from './ui';

/** 条件与分组先在本地编辑，只有应用时才替换表页实际查询范围。 */
export function PostgresTableFilterPanel({ initial, columns, disabled, seed, onSeedAdded, selected, onCloseSelected, replacesQuick, onApply, values, canReadValues, onOpenValues, onCloseValues }: {
  initial?: PostgresAdvancedTableFilter; columns: string[]; disabled: boolean;
  seed?: FilterDraft; onSeedAdded?(): void; replacesQuick?: boolean;
  selected?: { column: string; rowCount: number; values: readonly (string | null)[]; current(): boolean };
  onCloseSelected?(): void;
  onApply(filter?: PostgresAdvancedTableFilter): void;
  values?: PostgresColumnReadSource; canReadValues: boolean; onOpenValues(): void; onCloseValues(): void;
}) {
  const [rules, setRules] = useState<FilterRule[]>(initial?.rules ?? []);
  const [mode, setMode] = useState<FilterMode>(initial?.mode ?? 'all');
  const [group, setGroup] = useState<FilterGroup | undefined>(initial?.group);
  const [grouping, setGrouping] = useState(false);
  const [error, setError] = useState('');

  function apply() {
    if (!rules.length) { onApply(); return; }
    const result = postgresAdvancedTableFilterSchema.safeParse({ rules, mode, group });
    if (!result.success) { setError(result.error.issues[0]?.message ?? text.invalidFilter); return; }
    setError('');
    onApply(result.data);
  }

  function addValues(column: string, selected: readonly (string | null)[], exclude: boolean) {
    const next = appendPostgresValueFilter({ rules, mode, group }, column, selected, exclude);
    setMode(next.mode); setGroup(next.group); setRules(next.rules); setError('');
  }

  /** 核对清单只可加入本地条件草稿，真正读取仍由高级筛选的应用入口负责。 */
  function addSelected(exclude: boolean) {
    if (!selected || disabled || grouping) return;
    if (!selected.current()) {
      onCloseSelected?.();
      setError(selectedText.unavailable);
      return;
    }
    try {
      addValues(selected.column, selected.values, exclude);
      onCloseSelected?.();
    } catch (reason) { setError(errorMessage(reason)); }
  }

  return <section className="pg-table-filter-panel" aria-label={text.advancedFilter}>
    {selected && <fieldset className="pg-selected-filter">
      <legend>{selectedText.title}</legend>
      <p>{selectedText.postgresSource(selected.column, selected.rowCount)}</p>
      <p className="filter-value-hint">{selectedText.postgresHint}</p>
      <ul aria-label={selectedText.values}>{selected.values.map(value => <li key={value === null ? 'null' : JSON.stringify(value)}>
        <code>{value === null ? selectedText.null : JSON.stringify(value)}</code>
      </li>)}</ul>
      <div className="pg-table-controls">
        <button type="button" disabled={disabled || grouping} onClick={() => addSelected(false)}>{text.valueOptions.add}</button>
        <button type="button" disabled={disabled || grouping} onClick={() => addSelected(true)}>{text.valueOptions.exclude}</button>
        <button type="button" onClick={onCloseSelected}>{selectedText.cancel}</button>
      </div>
    </fieldset>}
    <div className="pg-filter-editor" hidden={!!selected}>
      <TableFilterPanel columns={columns} filters={rules} mode={mode} disabled={disabled || grouping}
        seed={seed} seedNotice={tableCellFilterZh.postgresStaged} multilineScalar
        onFiltersChange={next => {
          setGroup(tableFilterGroupAfterChange(rules, next, group, mode));
          if (next.length > rules.length && seed) onSeedAdded?.();
          setRules(next); setError(''); return true;
        }}
        onModeChange={next => { setMode(next); setGroup(previous => previous && { ...previous, mode: next }); return true; }}>
        {replacesQuick && <p className="filter-value-hint">{tableCellFilterZh.postgresReplacesQuick}</p>}
      </TableFilterPanel>
      {grouping && <TableFilterGroupsDialog filters={rules} mode={mode} initial={group} isCurrent={() => !disabled}
        onApply={next => { setMode(next.mode); setGroup(next); setGrouping(false); return true; }}
        onClose={() => setGrouping(false)}/>}
      <div className="pg-table-controls">
        <button type="button" disabled={disabled || grouping || !canReadValues} onClick={onOpenValues}>{text.valueOptions.open}</button>
        <button disabled={disabled || grouping || !rules.length} onClick={() => setGrouping(true)}>{text.filterGroups}</button>
        {group && <span className="muted small" title={tableFilterGroupSummary(group)}>{text.filterGrouped}</span>}
        <button className="primary" disabled={disabled || grouping} onClick={apply}>{text.applyAdvancedFilter}</button>
      </div>
    </div>
    <ErrorBox message={error}/>
    {values && <PostgresTableValueOptions source={values} onClose={onCloseValues} onAdd={addValues}/>}
  </section>;
}
