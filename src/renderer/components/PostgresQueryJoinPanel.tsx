import { useMemo, useState } from 'react';
import { manualJoinOnRules } from '../../shared/manualJoinDesigns';
import { postgresBuilderAlias, postgresBuilderColumnKey, postgresBuilderJoinKinds, postgresBuilderJoinLimits,
  postgresBuilderJoinOperators, type PostgresBuilderJoin, type PostgresQueryBuilderSource } from '../../shared/postgresQueryBuilder';
import { postgresQueryBuilderZh as text } from '../locales/postgresQueryBuilder.zh-CN';
import { tableFilterGroupAfterChange, tableFilterGroupSummary, tableFilterGroupWithMode } from '../tableFilterGroups';
import { TableFilterGroupsDialog } from './TableFilterGroupsDialog';
import { Field } from './ui';
import './PostgresQueryJoinPanel.css';

export interface PostgresJoinDraft { source: PostgresQueryBuilderSource; step: PostgresBuilderJoin }

/** 每个 ON 左侧仅列出已加入的字段，右侧仅列出本步字段，已配置步骤不能就地换源。 */
export function PostgresQueryJoinPanel({ source, entries, joins, disabled, editing, current, edit, add, change, remove, back }: {
  source: PostgresQueryBuilderSource; entries: readonly { key: string }[]; joins: readonly PostgresJoinDraft[];
  disabled: boolean; editing?: number; current(): boolean; edit(index?: number): void;
  add(table: string): void; change(index: number, step: PostgresBuilderJoin): void; remove(): void; back(): void;
}) {
  const [search, setSearch] = useState(''), [target, setTarget] = useState('');
  const entriesShown = entries.filter(item => item.key === target || item.key.toLowerCase().includes(search.toLowerCase()));
  const active = editing === undefined ? undefined : joins[editing]?.step;
  const groupRules = useMemo(() => manualJoinOnRules(active?.pairs.length ?? 0), [active]);
  return <fieldset disabled={disabled} aria-label={text.joins}><legend>{text.joins}</legend>
    <p className="muted small">{text.joinHint}</p>
    {joins.map(({ source: right, step }, index) => {
      const alias = postgresBuilderAlias(index + 1);
      const earlier = [source, ...joins.slice(0, index).map(item => item.source)].flatMap((item, position) =>
        item.columns.map(column => postgresBuilderColumnKey(position, column.name)));
      function editPair(position: number, patch: Partial<PostgresBuilderJoin['pairs'][number]>) {
        change(index, { ...step, pairs: step.pairs.map((pair, i) => i === position ? { ...pair, ...patch } : pair) });
      }
      /** 保留原比较的分组位置，删除时重排索引，新增时放在根组末尾。 */
      function resizePairs(position?: number) {
        const rules = manualJoinOnRules(step.pairs.length + (position === undefined ? 1 : 0));
        const previous = rules.slice(0, step.pairs.length);
        const pairs = position === undefined ? [...step.pairs, { left: '', right: '', operator: '=' as const }] :
          step.pairs.filter((_, i) => i !== position);
        const group = tableFilterGroupAfterChange(previous, rules.filter((_, i) => i !== position), step.group, step.mode);
        change(index, { ...step, pairs, group });
      }
      return <fieldset className="postgres-join-step" key={alias} aria-label={text.joinStep(alias)}><legend>{text.joinStep(alias)} · {right.target.table}</legend>
        <fieldset disabled={editing !== undefined}>
          <div className="child-reference-tools">
            <Field label={text.joinKind}><select aria-label={text.joinKind} value={step.kind} onChange={event =>
              change(index, { ...step, kind: event.target.value as PostgresBuilderJoin['kind'] })}>
              {postgresBuilderJoinKinds.map(kind => <option key={kind} value={kind}>{kind} JOIN</option>)}</select></Field>
            <Field label={text.joinMode}><select aria-label={text.joinMode} value={step.mode} onChange={event => {
              const mode = event.target.value as PostgresBuilderJoin['mode'];
              change(index, { ...step, mode, group: tableFilterGroupWithMode(step.group, mode) });
            }}>
              <option value="all">AND</option><option value="any">OR</option></select></Field>
          </div>
          {step.pairs.map((pair, position) => <div className="filter-inputs" key={position}>
            <select aria-label={text.joinLeft(position + 1)} value={pair.left} onChange={event => editPair(position, { left: event.target.value })}>
              <option value="">{text.joinChooseField}</option>
              {earlier.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
            <select aria-label={text.joinOperator(position + 1)} value={pair.operator}
              onChange={event => editPair(position, { operator: event.target.value as typeof pair.operator })}>
              {postgresBuilderJoinOperators.map(operator => <option key={operator}>{operator}</option>)}
            </select>
            <select aria-label={text.joinRight(position + 1)} value={pair.right} onChange={event => editPair(position, { right: event.target.value })}>
              <option value="">{text.joinChooseField}</option>
              {right.columns.map(({ name }) => <option key={name} value={name}>{name}</option>)}
            </select>
            <button type="button" aria-label={text.joinRemovePair(position + 1)} disabled={step.pairs.length <= 1}
              onClick={() => resizePairs(position)}>×</button>
          </div>)}
          <button type="button" disabled={step.pairs.length >= postgresBuilderJoinLimits.pairs}
            onClick={() => resizePairs()}>
            {text.joinAddPair}</button>
          <button type="button" disabled={step.pairs.length < 2 && !step.group} onClick={() => edit(index)}>{text.joinGroups}</button>
        </fieldset>
        {step.group && <p className="muted small">{tableFilterGroupSummary(step.group)}</p>}
        {editing === index && <TableFilterGroupsDialog filters={groupRules} mode={step.mode} initial={step.group} isCurrent={current}
          presentation={{ title: text.joinGroupTitle, hint: text.joinGroupHint, limits: text.joinGroupLimits,
            stale: text.stale, declined: text.stale, summary: position => {
            const { left, right, operator } = step.pairs[position];
            return `${left || text.joinChooseField} ${operator} ${right ? alias + '.' + right : text.joinChooseField}`;
          } }}
          onApply={group => {
            if (!current()) return false;
            change(index, { ...step, mode: group.mode, group }); edit(); return true;
          }} onClose={() => edit()}/>}
      </fieldset>;
    })}
    <Field label={text.joinSearch}><input type="search" disabled={editing !== undefined} value={search} onChange={event => setSearch(event.target.value)}/></Field>
    <Field label={text.joinTarget}><select aria-label={text.joinTarget} disabled={editing !== undefined} value={target} onChange={event => setTarget(event.target.value)}>
      <option value="">{text.chooseSource}</option>{entriesShown.map(item => <option key={item.key} value={item.key}>{item.key}</option>)}
    </select></Field>
    <div className="child-reference-tools">
      <button type="button" disabled={editing !== undefined || !target || joins.length >= postgresBuilderJoinLimits.steps} onClick={() => add(target)}>{text.joinAdd}</button>
      {joins.length > 1 && <button type="button" disabled={editing !== undefined} onClick={remove}>{text.joinRemoveLast}</button>}
      {joins.length > 0 && <button type="button" disabled={editing !== undefined} onClick={back}>{text.joinBack}</button>}
    </div>
  </fieldset>;
}
