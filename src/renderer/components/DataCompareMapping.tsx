import { useEffect, useState } from 'react';
import { dataCompareMappingLimit, type DataCompareMapping as Mapping } from '../../shared/dataCompareMapping';
import type { DataCompareProfileFamily } from '../../shared/dataCompareProfiles';
import type { PostgresDataCompareEndpoint as Endpoint } from '../../shared/postgresDataCompare';
import { errorMessage, invoke, uid } from '../lib';
import { dataCompareMappingZh as text } from '../locales/dataCompareMapping.zh-CN';
import { ErrorBox, Field } from './ui';

async function fields(family: DataCompareProfileFamily, endpoint: Endpoint) {
  if (family !== 'sqlite') return invoke(family === 'mysql' ? 'mysql.compareData.catalogue' : 'postgres.compareData.catalogue', endpoint);
  const catalogue = await invoke('sqlite.columns.inspect', { ...endpoint, database: 'main', taskId: uid() });
  try { return catalogue.columns.filter(column => column.hidden !== 1).map(column => column.name); }
  finally { await invoke('sqlite.columns.release', { catalogueId: catalogue.catalogueId }); }
}

export function DataCompareMapping({ family, source, target, disabled, mapping, change }: {
  family: DataCompareProfileFamily; source: Endpoint; target: Endpoint; disabled: boolean;
  mapping: Mapping; change(next: Mapping): void;
}) {
  const [opened, setOpened] = useState(false);
  const [columns, setColumns] = useState<[string[], string[]]>();
  const [error, setError] = useState('');
  const [left, setLeft] = useState(''), [right, setRight] = useState('');
  const { connectionId: leftId, database: leftDb, table: leftTable } = source;
  const { connectionId: rightId, database: rightDb, table: rightTable } = target;

  useEffect(() => {
    if (!opened) return;
    let current = true;
    void Promise.all([
      fields(family, { connectionId: leftId, database: leftDb, table: leftTable }),
      fields(family, { connectionId: rightId, database: rightDb, table: rightTable }),
    ]).then(result => { if (current) setColumns(result); })
      .catch(reason => { if (current) setError(errorMessage(reason)); });
    return () => { current = false; };
  }, [opened, family, leftId, leftDb, leftTable, rightId, rightDb, rightTable]);

  return <details onToggle={event => { if (event.currentTarget.open) setOpened(true); }}>
    <summary>{text.title}</summary>
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
  </details>;
}
