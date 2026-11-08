import { useEffect, useState } from 'react';
import { dataCompareMappingLimit, type DataCompareMapping as Mapping } from '../../shared/dataCompareMapping';
import type { DataCompareProfileFamily } from '../../shared/dataCompareProfiles';
import type { PostgresDataCompareEndpoint as Endpoint } from '../../shared/postgresDataCompare';
import { errorMessage } from '../lib';
import { readDataCompareFields } from '../dataCompareFields';
import { dataCompareMappingZh as text } from '../locales/dataCompareMapping.zh-CN';
import { ErrorBox, Field } from './ui';

export function DataCompareMapping({ family, source, target, disabled, mapping, change, inline = false }: {
  family: DataCompareProfileFamily; source: Endpoint; target: Endpoint; disabled: boolean;
  mapping: Mapping; change(next: Mapping): void; inline?: boolean;
}) {
  const [opened, setOpened] = useState(inline);
  const [columns, setColumns] = useState<[string[], string[]]>();
  const [error, setError] = useState('');
  const [left, setLeft] = useState(''), [right, setRight] = useState('');
  const { connectionId: leftId, database: leftDb, table: leftTable } = source;
  const { connectionId: rightId, database: rightDb, table: rightTable } = target;

  useEffect(() => {
    if (!opened) return;
    let current = true;
    void Promise.all([
      readDataCompareFields(family, { connectionId: leftId, database: leftDb, table: leftTable }),
      readDataCompareFields(family, { connectionId: rightId, database: rightDb, table: rightTable }),
    ]).then(result => { if (current) setColumns(result); })
      .catch(reason => { if (current) setError(errorMessage(reason)); });
    return () => { current = false; };
  }, [opened, family, leftId, leftDb, leftTable, rightId, rightDb, rightTable]);

  const content = <>
    <p className="muted small">{text.hint} {text.readonly}</p>
    {!columns && !error && <p>{text.loading}</p>}
    <fieldset className="sqlite-data-compare-endpoint" disabled={disabled}>
      {columns && <div className="sqlite-data-compare-pair">
        <Field label={text.source}><select aria-label={text.source} value={left} onChange={event => setLeft(event.target.value)}>
          <option value="">—</option>{columns[0].filter(name => !mapping.some(item => item.source === name)).map(name => <option key={name} value={name}>{name}</option>)}
        </select></Field>
        <Field label={text.target}><select aria-label={text.target} value={right} onChange={event => setRight(event.target.value)}>
          <option value="">—</option>{columns[1].filter(name => !mapping.some(item => item.target === name)).map(name => <option key={name} value={name}>{name}</option>)}
        </select></Field>
        <button disabled={!left || !right || mapping.length >= dataCompareMappingLimit ||
          mapping.some(item => item.source === left || item.target === right)} onClick={() => {
          change([...mapping, { source: left, target: right, key: false }]); setLeft(''); setRight('');
        }}>{text.add}</button>
      </div>}
      {!!mapping.length && <>
        <table><thead><tr><th>{text.source}</th><th>{text.target}</th><th>{text.key}</th><th>{text.remove}</th></tr></thead>
          <tbody>{mapping.map((item, index) => <tr key={item.source}>
            <td>{item.source}</td><td>{item.target}</td>
            <td><input type="checkbox" aria-label={text.key + ' ' + item.source} checked={item.key}
              onChange={event => change(mapping.map((pair, i) => i === index ? { ...pair, key: event.target.checked } : pair))}/></td>
            <td><button onClick={() => change(mapping.filter((_, i) => i !== index))}>{text.remove}</button></td>
          </tr>)}</tbody>
        </table>
        <button onClick={() => change([])}>{text.reset}</button>
      </>}
    </fieldset>
    <ErrorBox message={error}/>
  </>;
  return inline ? content : <details onToggle={event => { if (event.currentTarget.open) setOpened(true); }}>
    <summary>{text.title}</summary>
    {content}
  </details>;
}
