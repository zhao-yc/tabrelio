import type { SortRule } from '../../shared/contracts';
import type { QueryBuilderSummary } from '../../shared/queryBuilderSummary';
import { foreignKeyJoinAggregateFunctions, foreignKeyJoinSummaryLimits, type ForeignKeyJoinAggregateFunction } from '../../shared/tableForeignKeyJoinSummary';
import { uid } from '../lib';
import { tableForeignKeyJoinSummaryZh as aggregateText } from '../locales/tableForeignKeyJoinSummary.zh-CN';
import { tableSortZh as sortText } from '../locales/tableSort.zh-CN';
import { queryBuilderSummaryZh as text } from '../locales/queryBuilderSummary.zh-CN';

interface AggregateDraft { id: string; fn: ForeignKeyJoinAggregateFunction; column: string; alias: string }
export interface QueryBuilderSummaryDraft { groups: string[]; aggregates: AggregateDraft[]; sort: SortRule[] }
export const emptyQueryBuilderSummary: QueryBuilderSummaryDraft = { groups: [], aggregates: [], sort: [] };

export function queryBuilderSummaryOutputs(draft: QueryBuilderSummaryDraft) {
  return [...draft.groups.map(name => ({ key: 'field:' + name, name })),
    ...draft.aggregates.map(item => ({ key: 'aggregate:' + item.id, name: item.alias }))];
}

/** 输出删除后保留原条件，直到用户明确删除或重新绑定。 */
export function resolveSummaryConditionColumn(outputs: ReturnType<typeof queryBuilderSummaryOutputs>, key: string) {
  const output = outputs.find(item => item.key === key);
  if (!output) throw Error(text.havingStale);
  return output.name;
}

export function summaryConditionLabel(outputs: ReturnType<typeof queryBuilderSummaryOutputs>, key: string) {
  return (outputs.find(item => item.key === key)?.name ?? text.missingOutput) || text.unnamed;
}

/** 排序草稿用稳定身份。改别名跟随原指标，删除后新同名指标不会接管。 */
export function queryBuilderSummaryFromDraft(draft: QueryBuilderSummaryDraft): QueryBuilderSummary {
  const byId = new Map(queryBuilderSummaryOutputs(draft).map(item => [item.key, item.name]));
  return { groups: draft.groups,
    aggregates: draft.aggregates.map(({ fn, column, alias }) => fn === 'COUNT_ALL' ? { fn, alias } : { fn, column, alias }),
    sort: draft.sort.map(rule => ({ ...rule, column: byId.get(rule.column) ?? '' })) };
}

function move<T>(items: T[], index: number, offset: -1 | 1): T[] {
  const next = [...items], to = index + offset;
  if (to < 0 || to >= next.length) return items;
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

/** 只编辑本地设计，分组字段和聚合项的顺序决定输出列顺序。 */
export function QueryBuilderSummaryPanel({ names, draft, disabled, onChange }: {
  names: readonly string[]; draft: QueryBuilderSummaryDraft; disabled: boolean; onChange(next: QueryBuilderSummaryDraft): void;
}) {
  const { groups, aggregates, sort } = draft;
  const availableGroup = names.find(name => !groups.includes(name));
  const availableOutputs = queryBuilderSummaryOutputs(draft);
  const availableSort = availableOutputs.find(item => !sort.some(rule => rule.column === item.key));
  const change = (patch: Partial<QueryBuilderSummaryDraft>) => {
    if (disabled) return;
    const next = { ...draft, ...patch }, keys = new Set(queryBuilderSummaryOutputs(next).map(item => item.key));
    onChange({ ...next, sort: next.sort.filter(rule => keys.has(rule.column)) });
  };
  const changeAggregate = (index: number, patch: Partial<AggregateDraft>) =>
    change({ aggregates: aggregates.map((item, position) => position === index ? { ...item, ...patch } : item) });
  const changeSort = (index: number, rule: SortRule) =>
    change({ sort: sort.map((item, position) => position === index ? rule : item) });

  function addAggregate() {
    const occupied = new Set(availableOutputs.map(item => item.name.toLowerCase()));
    let index = aggregates.length + 1;
    while (occupied.has(aggregateText.defaultAlias(index))) index++;
    change({ aggregates: [...aggregates, { id: uid(), fn: 'COUNT_ALL', column: names[0] ?? '', alias: aggregateText.defaultAlias(index) }] });
  }

  return <fieldset disabled={disabled} aria-label={text.title}><legend>{text.title}</legend>
    <p className="muted small">{text.hint}</p>
    <strong>{aggregateText.groups}</strong>
    {groups.map((name, index) => <div className="filter-inputs" key={name}>
      <select aria-label={aggregateText.groupColumn(index + 1)} value={name} onChange={event => {
        const field = event.target.value;
        change({ groups: groups.map((before, position) => position === index ? field : before) });
      }}>{names.map(field => <option key={field} value={field} disabled={field !== name && groups.includes(field)}>{field}</option>)}</select>
      <button type="button" aria-label={aggregateText.groupEarlier(index + 1)} disabled={index === 0} onClick={() => change({ groups: move(groups, index, -1) })}>↑</button>
      <button type="button" aria-label={aggregateText.groupLater(index + 1)} disabled={index === groups.length - 1} onClick={() => change({ groups: move(groups, index, 1) })}>↓</button>
      <button type="button" aria-label={aggregateText.groupRemove(index + 1)} onClick={() => change({ groups: groups.filter(field => field !== name) })}>×</button>
    </div>)}
    <button type="button" disabled={availableGroup === undefined || groups.length >= foreignKeyJoinSummaryLimits.groups}
      onClick={() => { if (availableGroup !== undefined) change({ groups: [...groups, availableGroup] }); }}>{aggregateText.addGroup}</button>
    <p><strong>{aggregateText.aggregates}</strong></p>
    {aggregates.map((item, index) => <div className="filter-inputs" key={item.id}>
      <select aria-label={aggregateText.fn(index + 1)} value={item.fn} onChange={event => {
        const fn = event.target.value as ForeignKeyJoinAggregateFunction;
        if (foreignKeyJoinAggregateFunctions.includes(fn)) changeAggregate(index, { fn });
      }}>{foreignKeyJoinAggregateFunctions.map(fn => <option key={fn} value={fn}>{fn === 'COUNT_ALL' ? text.count : aggregateText.functions[fn]}</option>)}</select>
      {item.fn !== 'COUNT_ALL' && <select aria-label={aggregateText.column(index + 1)} value={item.column}
        onChange={event => changeAggregate(index, { column: event.target.value })}>{names.map(name => <option key={name} value={name}>{name}</option>)}</select>}
      <input aria-label={aggregateText.alias(index + 1)} maxLength={63} value={item.alias} onChange={event => changeAggregate(index, { alias: event.target.value })}/>
      <button type="button" aria-label={aggregateText.earlier(index + 1)} disabled={index === 0} onClick={() => change({ aggregates: move(aggregates, index, -1) })}>↑</button>
      <button type="button" aria-label={aggregateText.later(index + 1)} disabled={index === aggregates.length - 1} onClick={() => change({ aggregates: move(aggregates, index, 1) })}>↓</button>
      <button type="button" aria-label={aggregateText.remove(index + 1)} onClick={() => change({ aggregates: aggregates.filter(row => row !== item) })}>×</button>
    </div>)}
    <button type="button" disabled={!names.length || aggregates.length >= foreignKeyJoinSummaryLimits.aggregates} onClick={addAggregate}>{aggregateText.addAggregate}</button>
    <p><strong>{text.sort}</strong></p>
    {sort.map((rule, index) => <div className="filter-inputs" key={rule.column}>
      <select aria-label={sortText.field(index + 1)} value={rule.column} onChange={event => changeSort(index, { ...rule, column: event.target.value })}>
        {availableOutputs.map(item => <option key={item.key} value={item.key}
          disabled={item.key !== rule.column && sort.some(other => other.column === item.key)}>{item.name || text.unnamed}</option>)}
      </select>
      <select aria-label={sortText.direction(index + 1)} value={rule.direction}
        onChange={event => changeSort(index, { ...rule, direction: event.target.value as SortRule['direction'] })}>
        <option value="ASC">{sortText.asc}</option><option value="DESC">{sortText.desc}</option>
      </select>
      <select aria-label={sortText.nulls(index + 1)} value={rule.nulls ?? ''} onChange={event => {
        const nulls = event.target.value;
        changeSort(index, { ...rule, nulls: nulls === 'FIRST' || nulls === 'LAST' ? nulls : undefined });
      }}><option value="">{sortText.nullsDefault}</option><option value="FIRST">{sortText.nullsFirst}</option><option value="LAST">{sortText.nullsLast}</option></select>
      <button type="button" aria-label={sortText.earlier(index + 1)} disabled={index === 0} onClick={() => change({ sort: move(sort, index, -1) })}>↑</button>
      <button type="button" aria-label={sortText.later(index + 1)} disabled={index === sort.length - 1} onClick={() => change({ sort: move(sort, index, 1) })}>↓</button>
      <button type="button" aria-label={sortText.remove(index + 1)} onClick={() => change({ sort: sort.filter(item => item !== rule) })}>×</button>
    </div>)}
    <button type="button" disabled={!availableSort || sort.length >= 20} onClick={() => {
      if (availableSort) change({ sort: [...sort, { column: availableSort.key, direction: 'ASC' }] });
    }}>{sortText.add}</button>
  </fieldset>;
}
