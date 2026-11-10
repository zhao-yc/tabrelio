import type { ColumnInfo, FilterGroup, FilterMode, FilterRule } from '../shared/contracts';
import { FILTER_LIMITS } from '../shared/filtering';
import type { ForeignKeyJoinSide } from '../shared/tableForeignKeyJoinSources';
import type { ForeignKeyJoinFilter } from '../shared/tableForeignKeyJoinFilters';
import { tableForeignKeyJoinFilterZh as text } from './locales/tableForeignKeyJoinFilter.zh-CN';
import { filterRuleFromDraft, type FilterDraft } from './tableFilters';
import { tableFilterGroupAfterChange } from './tableFilterGroups';

export * from '../shared/tableForeignKeyJoinFilters';
export interface ForeignKeyJoinFilterDraft { id: string; side: ForeignKeyJoinSide; enabled: boolean; draft: FilterDraft; }
type Source = { columns: readonly Pick<ColumnInfo, 'name' | 'type'>[] };

/** 用本地稳定ID映射已有组；值尚未有效也能修正或删除，不借值/列名猜测同名条件身份。 */
export function foreignKeyJoinGroupAfterChange(previous: readonly { id: string }[], next: readonly { id: string }[], group: FilterGroup | undefined, mode: FilterMode): FilterGroup | undefined {
  const ids = (entries: readonly { id: string }[]) => { const values = entries.map(entry => entry.id); if (values.some(id => typeof id !== 'string' || !id.length || id.length > 256) || new Set(values).size !== values.length) throw Error(text.invalid); return values; };
  const oldIds = ids(previous), nextIds = ids(next), rules: FilterRule[] = oldIds.map(column => ({ column, operator: 'IS NULL' })), identities = new Map(oldIds.map((id,index) => [id,rules[index]]));
  return tableFilterGroupAfterChange(rules, nextIds.map(id => identities.get(id) ?? { column: id, operator: 'IS NULL' }), group, mode);
}

/** 表单只把当前运算符需要的值编入选项，切换字段或运算符保留其它输入供用户修正。 */
export function foreignKeyJoinFiltersFromDraft(entries: readonly ForeignKeyJoinFilterDraft[], sources: ReadonlyMap<ForeignKeyJoinSide, Source>): ForeignKeyJoinFilter[] {
  if (entries.length > FILTER_LIMITS.conditions) throw Error(text.invalid);
  return entries.map(entry => {
    const source = sources.get(entry.side);
    if (!source) throw Error(text.invalid);
    return { side: entry.side, ...filterRuleFromDraft(entry.draft, source.columns.map(column => column.name)), ...(entry.enabled ? {} : { enabled: false }) };
  });
}
