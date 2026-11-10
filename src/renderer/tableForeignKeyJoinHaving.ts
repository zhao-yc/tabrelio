import type { FilterRule } from '../shared/contracts';
import type { ForeignKeyJoinSummaryOutput } from '../shared/tableForeignKeyJoinSummary';
import { filterRuleFromDraft, type FilterDraft } from './tableFilters';
import { tableForeignKeyJoinHavingZh as text } from './locales/tableForeignKeyJoinHaving.zh-CN';

export * from '../shared/tableForeignKeyJoinHaving';
export interface ForeignKeyJoinHavingTarget extends ForeignKeyJoinSummaryOutput { id: string; label: string; }
export interface ForeignKeyJoinHavingDraft { id: string; enabled: boolean; targetLabel: string; draft: FilterDraft; }

/** 界面按稳定输出ID绑定；改名跟随原输出，移除后重建同名指标不能接管旧条件。 */
export function foreignKeyJoinHavingFromDraft(entries: readonly ForeignKeyJoinHavingDraft[], outputs: readonly ForeignKeyJoinHavingTarget[]): FilterRule[] {
  return entries.map(entry=>{const output=outputs.find(output=>output.id===entry.draft.column);if(!output)throw Error(text.targetMissing);return{...filterRuleFromDraft({...entry.draft,column:output.alias},outputs.map(output=>output.alias)),...(entry.enabled?{}:{enabled:false})};});
}
