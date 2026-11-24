import { useEffect, useRef, useState } from 'react';
import type { NetworkConnectionProfile } from '../../shared/contracts';
import { mysqlDataTransferEndpointSchema, mysqlDataTransferLimits, mysqlDataTransferPreviewSchema, mysqlDataTransferTitle,
  type MysqlDataTransferEndpoint, type MysqlDataTransferPreview, type MysqlDataTransferResult } from '../../shared/mysqlDataTransfer';
import { errorMessage, invoke, uid } from '../lib';
import { mysqlDataTransferZh as text } from '../locales/mysqlDataTransfer.zh-CN';
import { ErrorBox, Field, Modal, UsageHelp } from './ui';
import '../schemaCompare.css';

const blank = { connectionId: '', database: '' };

/** 用当前窗口的一次性预览确认目标；切换来源或选择立即废弃旧预览。 */
export function MysqlDataTransferDialog({ connections, onClose, onRefresh }: {
  connections: readonly NetworkConnectionProfile[]; onClose(): void; onRefresh(connectionId: string): void;
}) {
  const [source, setSource] = useState<MysqlDataTransferEndpoint>(blank), [target, setTarget] = useState<MysqlDataTransferEndpoint>(blank);
  const [catalogue, setCatalogue] = useState<string[] | null>(null), [tables, setTables] = useState<string[]>([]);
  const [content, setContent] = useState<'schema' | 'all'>('all');
  const [preview, setPreview] = useState<MysqlDataTransferPreview | null>(null), [result, setResult] = useState<MysqlDataTransferResult | null>(null);
  const [confirm, setConfirm] = useState(''), [acknowledge, setAcknowledge] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const active = useRef<{ taskId?: string } | null>(null), lease = useRef<string | null>(null), alive = useRef(true);
  function release() {
    const previewId = lease.current; lease.current = null;
    if (previewId) void invoke('mysql.dataTransfer.release', { previewId }).catch(() => undefined);
  }
  useEffect(() => { alive.current = true; return () => { alive.current = false; release(); }; }, []);
  function invalidate() { release(); setPreview(null); setResult(null); setConfirm(''); setAcknowledge(false); setError(''); }
  /** 同步占用窗口，确保重复点击或关闭不能发出第二个请求。 */
  async function run(operation: () => Promise<void>, taskId?: string) {
    if (active.current) return;
    active.current = { taskId }; setBusy(true); setError('');
    try { await operation(); }
    catch (reason) { if (alive.current) setError(errorMessage(reason)); }
    finally { active.current = null; if (alive.current) setBusy(false); }
  }
  function load() {
    const parsed = mysqlDataTransferEndpointSchema.safeParse(source);
    if (!parsed.success) { setError(text.invalid); return; }
    void run(async () => {
      invalidate(); setCatalogue(null); setTables([]);
      const names = await invoke('mysql.backup.tables', parsed.data);
      if (alive.current) setCatalogue(names);
    });
  }
  function review() {
    const parsed = mysqlDataTransferPreviewSchema.safeParse({ source, target, tables, content, taskId: uid() });
    if (!parsed.success) { setError(text.invalid); return; }
    void run(async () => {
      invalidate();
      const response = await invoke('mysql.dataTransfer.preview', parsed.data);
      if (!alive.current) { await invoke('mysql.dataTransfer.release', { previewId: response.previewId }); return; }
      lease.current = response.previewId; setPreview(response);
    }, parsed.data.taskId);
  }
  function apply() {
    if (!preview || lease.current !== preview.previewId || !acknowledge || confirm !== target.database) return;
    const taskId = uid(), previewId = preview.previewId;
    void run(async () => {
      lease.current = null; setPreview(null);
      try {
        const response = await invoke('mysql.dataTransfer.apply', { taskId, previewId, source, target, confirmation: confirm, acknowledge: true });
        if (alive.current) setResult(response);
      } finally {
        onRefresh(target.connectionId);
        await invoke('mysql.dataTransfer.release', { previewId }).catch(() => undefined);
      }
    }, taskId);
  }
  function endpoint(label: string, value: MysqlDataTransferEndpoint, update: (value: MysqlDataTransferEndpoint) => void) {
    return <fieldset disabled={busy}><legend>{label}</legend>
      <Field label={text.connection}><select aria-label={label + ' ' + text.connection} value={value.connectionId}
        onChange={event => { const profile = connections.find(item => item.id === event.target.value); update({ connectionId: event.target.value, database: profile?.database ?? '' }); }}>
        <option value="">—</option>{connections.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></Field>
      <Field label={text.database}><input aria-label={label + ' ' + text.database} value={value.database}
        onChange={event => update({ ...value, database: event.target.value })}/></Field>
    </fieldset>;
  }
  const close = () => { if (!active.current) onClose(); };
  return <Modal title={mysqlDataTransferTitle} wide onClose={close}><div className="modal-content schema-compare-content">
    <UsageHelp><p>{text.limits}</p><p>{text.consequences}</p></UsageHelp><ErrorBox message={error}/>
    <div className="schema-compare-endpoints">
      {endpoint(text.source, source, value => { invalidate(); setSource(value); setCatalogue(null); setTables([]); })}
      {endpoint(text.target, target, value => { invalidate(); setTarget(value); })}
    </div>
    <button onClick={load} disabled={busy || !source.connectionId || !source.database}>{text.load}</button>
    {catalogue?.length === 0 && <p role="status">{text.noTables}</p>}
    {!!catalogue?.length && <fieldset disabled={busy} className="schema-compare-results"><legend>{text.tables}（{tables.length} / {mysqlDataTransferLimits.tables}）</legend>
      {catalogue.map(name => <div key={name}><label><input type="checkbox" checked={tables.includes(name)}
        disabled={!tables.includes(name) && tables.length >= mysqlDataTransferLimits.tables}
        onChange={event => { invalidate(); setTables(event.target.checked ? [...tables, name] : tables.filter(table => table !== name)); }}/> {name}</label></div>)}
    </fieldset>}
    <Field label={text.mode}><select disabled={busy} value={content} onChange={event => { invalidate(); setContent(event.target.value === 'schema' ? 'schema' : 'all'); }}>
      <option value="all">{text.all}</option><option value="schema">{text.structure}</option>
    </select></Field>
    {preview && <fieldset className="schema-compare-preview" disabled={busy}>
      <legend>{text.preview}</legend>
      <p>{source.database} ({preview.sourceVersion}) → {target.database} ({preview.targetVersion})</p>
      <details><summary>{text.sql}</summary><pre>{preview.tables.map(table => table.sql + ';').join('\n\n')}</pre></details>
      <Field label={text.targetHint}><input value={confirm} placeholder={target.database} onChange={event => setConfirm(event.target.value)}/></Field>
      <label><input type="checkbox" checked={acknowledge} onChange={event => setAcknowledge(event.target.checked)}/> {text.acknowledge}</label>
    </fieldset>}
    {result && <section role="status">
      <p>{text[result.status]}</p>{result.message && <p>{result.message}</p>}
      <ul>{result.tables.map(table => <li key={table.name}>{table.name} · {text[table.structure]}{table.rows === null ? '' : ' · ' + text.rows(table.rows)}</li>)}</ul>
    </section>}
  </div><footer className="modal-footer">
    <button disabled={busy || !tables.length || !target.connectionId || !target.database} onClick={review}>{text.preview}</button>
    <button className="primary" disabled={busy || !preview || !acknowledge || confirm !== target.database} onClick={apply}>{text.apply}</button>
    <button disabled={!active.current?.taskId} onClick={() => { const taskId = active.current?.taskId; if (taskId) void invoke('query.cancel', { taskId }).catch(reason => { if (alive.current) setError(errorMessage(reason)); }); }}>{text.stop}</button>
    <span className="grow"/><button disabled={busy} onClick={close}>{text.close}</button>
  </footer></Modal>;
}
