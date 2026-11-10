import { queryBuilderAliasBytes, type QueryBuilderColumnAlias } from '../../shared/queryBuilderProjection';
import { queryBuilderProjectionZh as text } from '../locales/queryBuilderProjection.zh-CN';

/** 选列顺序与目录顺序独立；改名、排序和反选始终绑定原来源键。 */
export function QueryBuilderProjectionPanel({ fields, selected, aliases, distinct, limit, disabled, labels, onChange, onDistinct }: {
  fields: readonly { name: string; type?: string }[];
  selected: string[]; aliases: QueryBuilderColumnAlias[]; distinct: boolean; limit: number; disabled: boolean;
  labels: { columns: string; choose(name: string): string; all: string; none: string; distinct: string };
  onChange(selected: string[], aliases: QueryBuilderColumnAlias[]): void; onDistinct(value: boolean): void;
}) {
  const selectedSet = new Set(selected), aliasByColumn = new Map(aliases.map(item => [item.column, item.alias]));

  function choose(next: string[]) {
    const remaining = new Set(next);
    onChange(next, aliases.filter(item => remaining.has(item.column)));
  }

  function move(index: number, offset: -1 | 1) {
    const next = [...selected], position = index + offset;
    [next[index], next[position]] = [next[position], next[index]];
    onChange(next, aliases);
  }

  return <fieldset disabled={disabled}><legend>{labels.columns}</legend>
    <div className="child-reference-tools">
      <button type="button" onClick={() => choose([...selected, ...fields.flatMap(({ name }) => selectedSet.has(name) ? [] : [name])].slice(0, limit))}>{labels.all}</button>
      <button type="button" onClick={() => choose([])}>{labels.none}</button>
    </div>
    <div style={{ maxHeight: 180, overflow: 'auto' }}>{fields.map(({ name, type }) => <label key={name} className="check">
      <input type="checkbox" aria-label={labels.choose(name)} checked={selectedSet.has(name)}
        disabled={!selectedSet.has(name) && selected.length >= limit} onChange={event =>
          choose(event.target.checked ? [...selected, name] : selected.filter(column => column !== name))}/>{name}
      {type !== undefined && <small className="muted">{type}</small>}
    </label>)}</div>
    <details>
      <summary>{text.order}</summary>
      <p className="muted small">{text.hint}</p>
      <ol style={{ maxHeight: 240, overflow: 'auto' }}>
        {selected.map((name, index) => <li key={name}><div className="filter-inputs">
          <span title={name}>{name}</span>
          <input aria-label={text.alias(name)} maxLength={queryBuilderAliasBytes} value={aliasByColumn.get(name) ?? ''}
            onChange={event => {
              const alias = event.target.value, next = aliases.filter(item => item.column !== name);
              onChange(selected, alias ? [...next, { column: name, alias }] : next);
            }}/>
          <button type="button" aria-label={text.earlier(name)} disabled={index === 0} onClick={() => move(index, -1)}>↑</button>
          <button type="button" aria-label={text.later(name)} disabled={index === selected.length - 1} onClick={() => move(index, 1)}>↓</button>
        </div></li>)}
      </ol>
    </details>
    <label className="check"><input type="checkbox" checked={distinct} onChange={event => onDistinct(event.target.checked)}/>{labels.distinct}</label>
  </fieldset>;
}
