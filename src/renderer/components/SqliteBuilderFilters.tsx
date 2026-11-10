import { useMemo } from 'react';
import type { FilterGroup, FilterRule } from '../../shared/contracts';
import { sqliteGroupMode } from '../../shared/sqliteQueryBuilderGroups';
import { sqliteTableBrowseLimits } from '../../shared/sqliteTableBrowse';
import { uid } from '../lib';
import { sqliteTableBrowseZh as browse } from '../locales/sqliteTableBrowse.zh-CN';
import { sqliteQueryBuilderZh as text } from '../locales/sqliteQueryBuilder.zh-CN';
import type { SqliteFilterDraft } from '../sqliteTableBrowser';
import { tableFilterGroupAfterKeyChange, tableFilterGroupSummary, tableFilterGroupWithMode } from '../tableFilterGroups';
import { SqliteTableFilters } from './SqliteTableFilters';
import { TableFilterGroupsDialog } from './TableFilterGroupsDialog';

export interface SqliteBuilderFilterDraft {
  filters: SqliteFilterDraft[];
  mode: 'and' | 'or';
  group?: FilterGroup;
}
export const emptySqliteBuilderFilterDraft: SqliteBuilderFilterDraft = { filters: [], mode: 'and' };
const maximum = sqliteTableBrowseLimits.filters;

/** 分组器只拿到行标识与启停状态，原条件类型和值仍由 SQLite 表单和编译器处理。 */
export function SqliteBuilderFilters({ draft, names, title, hint, label, groupTitle, disabled, editing, current, open, close, change }: {
  draft: SqliteBuilderFilterDraft; names: readonly string[]; title?: string; hint: string; label?(key: string): string;
  groupTitle: string; disabled: boolean; editing: boolean; current(): boolean; open(): void; close(): void;
  change(update: (value: SqliteBuilderFilterDraft) => SqliteBuilderFilterDraft): void;
}) {
  const { filters, mode, group } = draft;
  const leaves = useMemo((): FilterRule[] => filters.map(({ id, enabled }) => ({ column: id, operator: 'IS NULL', enabled })), [filters]);
  return <div className="sqlite-builder-filter">
    <SqliteTableFilters names={names} filters={filters} mode={mode} disabled={disabled || editing} current={current} id={uid}
      title={title} enabledHint={hint} columnLabel={label}
      onFilters={update => change(previous => {
        const next = update(previous.filters);
        return { ...previous, filters: next, group: tableFilterGroupAfterKeyChange(previous.filters.map(item => item.id),
          next.map(item => item.id), previous.group, sqliteGroupMode(previous.mode), maximum) };
      })}
      onMode={next => change(previous => ({ ...previous, mode: next,
        group: tableFilterGroupWithMode(previous.group, sqliteGroupMode(next), maximum) }))}/>
    <button type="button" disabled={disabled || editing || !filters.length} onClick={open}>{groupTitle}</button>
    {group && <p className="muted small" aria-label={text.groupStructure}>{tableFilterGroupSummary(group, maximum)}</p>}
    {editing && <TableFilterGroupsDialog filters={leaves} mode={sqliteGroupMode(mode)} initial={group} maximum={maximum} isCurrent={current}
      presentation={{ title: groupTitle, hint: text.groupHint, limits: text.groupLimits, stale: text.stale, declined: text.stale,
        summary: index => {
          const rule = filters[index], column = label?.(rule.column) ?? rule.column, operator = browse.operators[rule.operator];
          if (rule.operator === 'isNull' || rule.operator === 'notNull' || rule.operator === 'oneOf' || rule.operator === 'notOneOf')
            return column + ' · ' + operator;
          return column + ' · ' + operator + ' · ' + browse.kinds[rule.kind] + ' ' + JSON.stringify(rule.value.slice(0, 80)) +
            (rule.value.length > 80 ? '…' : '');
        } }}
      onApply={next => {
        if (!current()) return false;
        change(previous => ({ ...previous, mode: next.mode === 'all' ? 'and' : 'or', group: next }));
        close(); return true;
      }} onClose={close}/>}
  </div>;
}
