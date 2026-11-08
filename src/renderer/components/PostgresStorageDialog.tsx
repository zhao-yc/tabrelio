import { useEffect, useRef, useState } from 'react';
import { formatPostgresStorageBytes, postgresStorageKind, postgresStoragePageSize, postgresStorageSort,
  type PostgresStorageDetail, type PostgresStorageRead, type PostgresStorageReport, type PostgresStorageRow } from '../../shared/postgresStorage';
import { postgresIdentifier } from '../../shared/postgresSql';
import type { PostgresCreateTableTarget } from '../../shared/postgresCreateTable';
import { errorMessage, invoke } from '../lib';
import { postgresStorageZh as text } from '../locales/postgresStorage.zh-CN';
import { useWorkspace } from '../store';
import { ErrorBox, Field, Modal, Spinner } from './ui';
import './PostgresStructureDialog.css';

type Filters = Pick<PostgresStorageRead, 'schema' | 'query' | 'kind' | 'sort' | 'direction'>;
const defaults: Filters = { query: '', sort: 'total', direction: 'desc' };
const label = (row: { schema: string; name: string }) => postgresIdentifier(row.schema) + '.' + postgresIdentifier(row.name);
const size = (value: string) => <span title={value + ' B'}>{formatPostgresStorageBytes(value)}</span>;

/** 筛选、分页和明细各绑定原数据库及连接版本，丢弃迟到响应。 */
export function PostgresStorageDialog({ target, onClose }: { target: PostgresCreateTableTarget; onClose(): void }) {
  const { connectionId, database } = target;
  const version = useWorkspace(state => state.connectionVersions[connectionId] ?? 0), originalVersion = useRef(version);
  const [draft, setDraft] = useState<Filters>(defaults);
  const [request, setRequest] = useState({ filters: defaults, page: 1 });
  const [schemas, setSchemas] = useState<string[]>([]);
  const [result, setResult] = useState<{ request: typeof request; report?: PostgresStorageReport; error?: string }>();
  const [selected, setSelected] = useState<PostgresStorageRow>();
  const [detailResult, setDetailResult] = useState<{ selected: PostgresStorageRow; detail?: PostgresStorageDetail; error?: string }>();
  const invalid = version !== originalVersion.current;
  useEffect(() => {
    if (invalid || selected) return;
    let active = true;
    queueMicrotask(async () => {
      if (!active) return;
      try {
        const report = await invoke('postgres.storage.read', { connectionId, database, ...request.filters, page: request.page });
        if (active) { setSchemas(report.schemas); setResult({ request, report }); }
      } catch (reason) {
        if (active) setResult({ request, error: errorMessage(reason) });
      }
    });
    return () => { active = false; };
  }, [connectionId, database, request, invalid, selected]);
  useEffect(() => {
    if (!selected || invalid) return;
    let active = true;
    queueMicrotask(async () => {
      if (!active) return;
      try {
        const detail = await invoke('postgres.storage.detail', { connectionId, database, table: label(selected), identity: selected.identity });
        if (active) setDetailResult({ selected, detail });
      } catch (reason) {
        if (active) setDetailResult({ selected, error: errorMessage(reason) });
      }
    });
    return () => { active = false; };
  }, [connectionId, database, selected, invalid]);

  const report = !invalid && result?.request === request ? result.report : undefined;
  const detail = !invalid && selected && detailResult?.selected === selected ? detailResult.detail : undefined;
  const error = invalid ? text.changed : selected ? detailResult?.selected === selected ? detailResult.error : undefined :
    result?.request === request ? result.error : undefined;
  const loading = !error && !(selected ? detail : report);
  const pages = Math.max(1, Math.ceil((report?.summary.count ?? 0) / postgresStoragePageSize));
  const patch = (fields: Partial<Filters>) => setDraft(value => ({ ...value, ...fields }));
  function filterSchema(schema: string) {
    const filters = { ...request.filters, schema };
    setDraft(filters); setRequest({ filters, page: 1 });
  }

  return <Modal title={text.title} wide onClose={onClose}>
    <div className="modal-content pg-structure-content">
      <div className="pg-structure-caption"><strong>PostgreSQL / {database}</strong></div>
      <ErrorBox message={error ?? ''}/>
      {selected ? <section className="pg-column-edit" aria-label={text.details}>
        <strong>{label(selected)}</strong>
        {loading && <Spinner/>}
        {detail && <>
          <div className="pg-structure-table-wrap"><table className="pg-structure-table"><tbody>
            <tr><th scope="row">{text.data}</th><td>{size(detail.row.data)}</td><td>{detail.row.data} B</td></tr>
            <tr><th scope="row">{text.indexes}</th><td>{size(detail.row.indexes)}</td><td>{detail.row.indexes} B</td></tr>
            <tr><th scope="row">{text.total}</th><td>{size(detail.row.total)}</td><td>{detail.row.total} B</td></tr>
            <tr><th scope="row">{text.live}</th><td colSpan={2}>{detail.row.stats.live ?? '—'}</td></tr>
            <tr><th scope="row">{text.dead}</th><td colSpan={2}>{detail.row.stats.dead ?? '—'}</td></tr>
            <tr><th scope="row">{text.scans}</th><td colSpan={2}>{detail.row.stats.scans ?? '—'}</td></tr>
          </tbody></table></div>
          {detail.indexes.length ? <div className="pg-structure-table-wrap"><table className="pg-structure-table">
            <thead><tr>{[text.indexName, text.bytes, text.indexScans, text.indexValid].map(value => <th key={value} scope="col">{value}</th>)}</tr></thead>
            <tbody>{detail.indexes.map(index => <tr key={index.name}>
              <th scope="row">{index.name}</th><td>{index.bytes} B</td><td>{index.scans ?? '—'}</td><td>{index.valid ? text.valid : text.invalid}</td>
            </tr>)}</tbody>
          </table></div> : <p>{text.noIndexes}</p>}
        </>}
      </section> : <section className="pg-column-edit" aria-label={text.report}>
        <p>{text.intro}</p>
        <form className="pg-column-edit-fields" onSubmit={event => { event.preventDefault(); setRequest({ filters: draft, page: 1 }); }}>
          <Field label={text.schema}><select aria-label={text.schema} disabled={invalid} value={draft.schema ?? ''}
            onChange={event => patch({ schema: event.target.value || undefined })}>
            <option value="">{text.allSchemas}</option>{schemas.map(schema => <option key={schema}>{schema}</option>)}
          </select></Field>
          <Field label={text.query}><input disabled={invalid} maxLength={256} value={draft.query} onChange={event => patch({ query: event.target.value })}/></Field>
          <Field label={text.kind}><select aria-label={text.kind} disabled={invalid} value={draft.kind ?? ''}
            onChange={event => patch({ kind: event.target.value as Filters['kind'] || undefined })}>
            <option value="">{text.allKinds}</option>{postgresStorageKind.options.map(kind => <option key={kind} value={kind}>{text.kinds[kind]}</option>)}
          </select></Field>
          <Field label={text.sort}><select aria-label={text.sort} disabled={invalid} value={draft.sort}
            onChange={event => patch({ sort: event.target.value as Filters['sort'] })}>
            {postgresStorageSort.options.map(sort => <option key={sort} value={sort}>{text.sorts[sort]}</option>)}
          </select></Field>
          <Field label={text.direction}><select aria-label={text.direction} disabled={invalid} value={draft.direction}
            onChange={event => patch({ direction: event.target.value as Filters['direction'] })}>
            <option value="asc">{text.asc}</option><option value="desc">{text.desc}</option>
          </select></Field>
          <button type="submit" className="primary" disabled={invalid}>{text.apply}</button>
        </form>
        {loading && <Spinner/>}
        {report?.tooBroad && <ErrorBox message={text.broad}/>}
        {report && !report.tooBroad && <>
          <p>{text.filtered}　{text.count} {report.summary.count}　{text.data} {size(report.summary.data)}　{text.indexes} {size(report.summary.indexes)}　{text.total} {size(report.summary.total)}</p>
          {report.bySchema.length > 1 && <details><summary>{text.schemaSummary}</summary>
            <div className="pg-structure-table-wrap"><table className="pg-structure-table">
              <thead><tr>{[text.schema, text.count, text.data, text.indexes, text.total].map(value => <th key={value} scope="col">{value}</th>)}</tr></thead>
              <tbody>{report.bySchema.map(row => <tr key={row.schema}>
                <th scope="row"><button onClick={() => filterSchema(row.schema)}>{row.schema}</button></th>
                <td>{row.count}</td><td>{size(row.data)}</td><td>{size(row.indexes)}</td><td>{size(row.total)}</td>
              </tr>)}</tbody>
            </table></div>
          </details>}
          {report.rows.length ? <div className="pg-structure-table-wrap"><table className="pg-structure-table">
            <thead><tr>{[text.name, text.kind, text.parent, text.data, text.indexes, text.total, text.live, text.detail]
              .map(value => <th key={value} scope="col">{value}</th>)}</tr></thead>
            <tbody>{report.rows.map(row => <tr key={row.identity}>
              <th scope="row">{label(row)}</th><td>{text.kinds[row.kind]}</td><td>{row.parent ? label(row.parent) : '—'}</td>
              <td>{size(row.data)}</td><td>{size(row.indexes)}</td><td>{size(row.total)}</td><td>{row.stats.live ?? '—'}</td>
              <td><button aria-label={text.detail + ' ' + label(row)} onClick={() => { setDetailResult(undefined); setSelected(row); }}>{text.detail}</button></td>
            </tr>)}</tbody>
          </table></div> : <p>{text.empty}</p>}
        </>}
      </section>}
    </div>
    <footer className="modal-footer">
      {selected ? <button onClick={() => setSelected(undefined)}>{text.back}</button> :
        <button disabled={invalid} onClick={() => setRequest(value => ({ ...value }))}>{text.refresh}</button>}
      <span className="grow"/>
      {!selected && report && !report.tooBroad && <>
        <button disabled={request.page <= 1} onClick={() => setRequest(value => ({ ...value, page: value.page - 1 }))}>{text.prev}</button>
        <span>{text.page(request.page, pages)}</span>
        <button disabled={request.page >= pages} onClick={() => setRequest(value => ({ ...value, page: value.page + 1 }))}>{text.next}</button>
      </>}
      <button onClick={onClose}>{text.close}</button>
    </footer>
  </Modal>;
}
