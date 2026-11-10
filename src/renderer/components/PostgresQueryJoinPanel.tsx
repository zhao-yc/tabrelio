import { useState } from 'react';
import { postgresBuilderAlias, postgresBuilderColumnKey, postgresBuilderJoinKinds, postgresBuilderJoinLimits,
  postgresBuilderJoinOperators, type PostgresBuilderJoin, type PostgresQueryBuilderSource } from '../../shared/postgresQueryBuilder';
import { postgresQueryBuilderZh as text } from '../locales/postgresQueryBuilder.zh-CN';
import { Field } from './ui';

export interface PostgresJoinDraft { source: PostgresQueryBuilderSource; step: PostgresBuilderJoin }

/** 每个 ON 左侧仅列出已加入的字段，右侧仅列出本步字段，已配置步骤不能就地换源。 */
export function PostgresQueryJoinPanel({ source, entries, joins, disabled, add, change, remove, back }: {
  source: PostgresQueryBuilderSource; entries: readonly { key: string }[]; joins: readonly PostgresJoinDraft[];
  disabled: boolean; add(table: string): void; change(index: number, step: PostgresBuilderJoin): void; remove(): void; back(): void;
}) {
  const [search, setSearch] = useState(''), [target, setTarget] = useState('');
  const entriesShown = entries.filter(item => item.key === target || item.key.toLowerCase().includes(search.toLowerCase()));
  return <fieldset disabled={disabled} aria-label={text.joins}><legend>{text.joins}</legend>
    <p className="muted small">{text.joinHint}</p>
    {joins.map(({ source: right, step }, index) => {
      const alias = postgresBuilderAlias(index + 1);
      const earlier = [source, ...joins.slice(0, index).map(item => item.source)].flatMap((item, position) =>
        item.columns.map(column => postgresBuilderColumnKey(position, column.name)));
      function editPair(position: number, patch: Partial<PostgresBuilderJoin['pairs'][number]>) {
        change(index, { ...step, pairs: step.pairs.map((pair, i) => i === position ? { ...pair, ...patch } : pair) });
      }
      return <fieldset key={alias} aria-label={text.joinStep(alias)}><legend>{text.joinStep(alias)} · {right.target.table}</legend>
        <div className="child-reference-tools">
          <Field label={text.joinKind}><select aria-label={text.joinKind} value={step.kind} onChange={event =>
            change(index, { ...step, kind: event.target.value as PostgresBuilderJoin['kind'] })}>
            {postgresBuilderJoinKinds.map(kind => <option key={kind} value={kind}>{kind} JOIN</option>)}</select></Field>
          <Field label={text.joinMode}><select aria-label={text.joinMode} value={step.mode} onChange={event =>
            change(index, { ...step, mode: event.target.value as PostgresBuilderJoin['mode'] })}>
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
            onClick={() => change(index, { ...step, pairs: step.pairs.filter((_, i) => i !== position) })}>×</button>
        </div>)}
        <button type="button" disabled={step.pairs.length >= postgresBuilderJoinLimits.pairs}
          onClick={() => change(index, { ...step, pairs: [...step.pairs, { left: '', right: '', operator: '=' }] })}>
          {text.joinAddPair}</button>
      </fieldset>;
    })}
    <Field label={text.joinSearch}><input type="search" value={search} onChange={event => setSearch(event.target.value)}/></Field>
    <Field label={text.joinTarget}><select aria-label={text.joinTarget} value={target} onChange={event => setTarget(event.target.value)}>
      <option value="">{text.chooseSource}</option>{entriesShown.map(item => <option key={item.key} value={item.key}>{item.key}</option>)}
    </select></Field>
    <div className="child-reference-tools">
      <button type="button" disabled={!target || joins.length >= postgresBuilderJoinLimits.steps} onClick={() => add(target)}>{text.joinAdd}</button>
      {joins.length > 1 && <button type="button" onClick={remove}>{text.joinRemoveLast}</button>}
      {joins.length > 0 && <button type="button" onClick={back}>{text.joinBack}</button>}
    </div>
  </fieldset>;
}
