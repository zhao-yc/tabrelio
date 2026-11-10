import type { TableInfo } from '../../shared/contracts';
import { foreignKeyJoinAggregateFunctions, foreignKeyJoinSummaryLimits, type ForeignKeyJoinAggregateDraft, type ForeignKeyJoinGroupDraft } from '../tableForeignKeyJoinSummary';
import { tableForeignKeyJoinSummaryZh as text } from '../locales/tableForeignKeyJoinSummary.zh-CN';
import { tableForeignKeyJoinZh as queryText } from '../locales/tableForeignKeyJoin.zh-CN';
import { foreignKeyJoinSide, type ForeignKeyJoinSide } from '../tableForeignKeyJoinSources';
import { UsageHelp } from './ui';

/** 分组和聚合均是父窗口受控草稿；行回调携带原对象身份，不持有执行或元数据读取能力。 */
export function TableForeignKeyJoinSummary({sources,sourceLabel,groups,aggregates,disabled,onAddGroup,onGroup,onRemoveGroup,onMoveGroup,onClearGroups,onAddAggregate,onAggregate,onRemoveAggregate,onMoveAggregate,onClearAggregates,single = false}:{
  single?: boolean;
  sources: ReadonlyMap<ForeignKeyJoinSide, TableInfo>; sourceLabel(side: ForeignKeyJoinSide): string; groups:readonly ForeignKeyJoinGroupDraft[];aggregates:readonly ForeignKeyJoinAggregateDraft[];disabled:boolean;
  onAddGroup():void;onGroup(entry:ForeignKeyJoinGroupDraft,patch:Partial<Pick<ForeignKeyJoinGroupDraft,'side'|'column'>>):void;onRemoveGroup(entry:ForeignKeyJoinGroupDraft):void;onMoveGroup(entry:ForeignKeyJoinGroupDraft,offset:-1|1):void;onClearGroups():void;
  onAddAggregate():void;onAggregate(entry:ForeignKeyJoinAggregateDraft,patch:Partial<Omit<ForeignKeyJoinAggregateDraft,'id'>>):void;onRemoveAggregate(entry:ForeignKeyJoinAggregateDraft):void;onMoveAggregate(entry:ForeignKeyJoinAggregateDraft,offset:-1|1):void;onClearAggregates():void;
}){
  const columns = (side: ForeignKeyJoinSide) => sources.get(side)?.columns.map(column => column.name) ?? [];
  const available = (side: ForeignKeyJoinSide, except?: ForeignKeyJoinGroupDraft) =>
    columns(side).filter(name => !groups.some(entry => entry !== except && entry.side === side && entry.column === name));
  const sides = [...sources.keys()];
  const title = single ? queryText.singleSummary : text.title;
  return <fieldset disabled={disabled} aria-label={title}><legend>{title}</legend><UsageHelp><p>{text.hint}</p><p>{single ? queryText.singleSummaryHint : text.semantics}</p></UsageHelp>
    <strong>{text.groups}</strong>{groups.map((entry,index)=>{const n=index+1,names=columns(entry.side),allowed=new Set(available(entry.side,entry));return <div className="filter-inputs" key={entry.id}>
      <label>{text.groupSide(n)}<select aria-label={text.groupSide(n)} value={entry.side} disabled={disabled} onChange={event=>{const side=foreignKeyJoinSide(sources,event.target.value);if(side){const names=available(side,entry),column=names.includes(entry.column)?entry.column:names[0];if(column)onGroup(entry,{side,column});}}}>{sides.map(side => <option key={side} value={side} disabled={!available(side,entry).length}>{sourceLabel(side)}</option>)}</select></label>
      <label>{text.groupColumn(n)}<select aria-label={text.groupColumn(n)} value={entry.column} disabled={disabled} onChange={event=>{if(allowed.has(event.target.value))onGroup(entry,{column:event.target.value});}}>{names.map(name=><option value={name} key={name} disabled={!allowed.has(name)}>{name}</option>)}</select></label>
      <button type="button" aria-label={text.groupEarlier(n)} disabled={disabled||index===0} onClick={()=>onMoveGroup(entry,-1)}>↑</button><button type="button" aria-label={text.groupLater(n)} disabled={disabled||index===groups.length-1} onClick={()=>onMoveGroup(entry,1)}>↓</button><button type="button" aria-label={text.groupRemove(n)} disabled={disabled} onClick={()=>onRemoveGroup(entry)}>×</button>
    </div>;})}<button type="button" disabled={disabled||groups.length>=foreignKeyJoinSummaryLimits.groups||!sides.some(side => available(side).length)} onClick={onAddGroup}>{text.addGroup}</button><button type="button" disabled={disabled||!groups.length} onClick={onClearGroups}>{text.clearGroups}</button>
    <p><strong>{text.aggregates}</strong></p>{aggregates.map((entry,index)=>{const n=index+1;return <div key={entry.id}><div className="filter-inputs">
      <label>{text.fn(n)}<select aria-label={text.fn(n)} value={entry.fn} disabled={disabled} onChange={event=>{if(foreignKeyJoinAggregateFunctions.includes(event.target.value as ForeignKeyJoinAggregateDraft['fn']))onAggregate(entry,{fn:event.target.value as ForeignKeyJoinAggregateDraft['fn']});}}>{foreignKeyJoinAggregateFunctions.map(fn=><option value={fn} key={fn}>{single && fn === 'COUNT_ALL' ? queryText.singleCount : text.functions[fn]}</option>)}</select></label>
      {entry.fn!=='COUNT_ALL'&&<><label>{text.side(n)}<select aria-label={text.side(n)} value={entry.side} disabled={disabled} onChange={event=>{const side=foreignKeyJoinSide(sources,event.target.value);if(side){const names=columns(side);onAggregate(entry,{side,column:names.includes(entry.column)?entry.column:names[0]});}}}>{sides.map(side => <option key={side} value={side}>{sourceLabel(side)}</option>)}</select></label>
      <label>{text.column(n)}<select aria-label={text.column(n)} value={entry.column} disabled={disabled} onChange={event=>{if(columns(entry.side).includes(event.target.value))onAggregate(entry,{column:event.target.value});}}>{columns(entry.side).map(name=><option value={name} key={name}>{name}</option>)}</select></label></>}
      <button type="button" aria-label={text.earlier(n)} disabled={disabled||index===0} onClick={()=>onMoveAggregate(entry,-1)}>↑</button><button type="button" aria-label={text.later(n)} disabled={disabled||index===aggregates.length-1} onClick={()=>onMoveAggregate(entry,1)}>↓</button><button type="button" aria-label={text.remove(n)} disabled={disabled} onClick={()=>onRemoveAggregate(entry)}>×</button>
    </div><label>{text.alias(n)}<input aria-label={text.alias(n)} maxLength={128} value={entry.alias} disabled={disabled} onChange={event=>onAggregate(entry,{alias:event.target.value})}/></label></div>;})}
    <button type="button" disabled={disabled||aggregates.length>=foreignKeyJoinSummaryLimits.aggregates} onClick={onAddAggregate}>{text.addAggregate}</button><button type="button" disabled={disabled||!aggregates.length} onClick={onClearAggregates}>{text.clearAggregates}</button>
  </fieldset>;
}
