import { useRef, useState } from 'react';
import { savedQueryExternalZh as text, type SavedQueryExternalPreview, type SavedQueryExternalSession } from '../../shared/savedQueryExternalEdit';
import { errorMessage, invoke } from '../lib';
import { ErrorBox, Field, Spinner } from './ui';

/** 面板只持会话和预览编号，确认时不从渲染进程发送 SQL 或路径。 */
export function SavedQueryExternalEditor({ session, request, onDone }: { session: SavedQueryExternalSession; request: typeof invoke; onDone(message: string): void }) {
  const [preview, setPreview] = useState<SavedQueryExternalPreview>();
  const [committed, setCommitted] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const active = useRef(false);
  const input = { sessionId: session.sessionId };
  async function run(action: () => Promise<void>) {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    setError('');
    try { await action(); } catch (reason) { setError(errorMessage(reason)); }
    finally { active.current = false; setBusy(false); }
  }
  function read() {
    void run(async () => { setPreview(undefined); setPreview(await request('queries.externalPreview', input)); });
  }
  function save() {
    if (!preview?.changed) return;
    void run(async () => {
      setPreview(undefined);
      const receipt = await request('queries.externalApply', { ...input, previewId: preview.previewId });
      if (receipt.cleanupPending) setCommitted(true);
      else onDone(text.saved);
    });
  }
  const difference = preview?.difference;
  return <section className="history-sql-preview" aria-label={text.title}>
    <h3>{text.title} · {session.name}</h3>
    <p>{committed ? text.cleanup : text.hint}</p>
    <Field label={text.location}><input value={session.path} readOnly/></Field>
    {preview && !preview.changed && <p role="status">{text.same}</p>}
    {preview?.changed && difference && <>
      <h4>{text.before}</h4><pre tabIndex={0} aria-label={text.before}>{difference.before || text.empty}</pre>
      <h4>{text.after}</h4><pre tabIndex={0} aria-label={text.after}>{difference.after || text.empty}</pre>
      {(difference.beforeTruncated || difference.afterTruncated) && <p>{text.truncated}</p>}
    </>}
    <ErrorBox message={error}/>
    <div className="inline-field">
      {!committed && <button disabled={busy} onClick={read}>{text.read}</button>}
      {!committed && <button className="primary" disabled={busy || !preview?.changed} onClick={save}>{text.apply}</button>}
      <button disabled={busy} onClick={() => void run(async () => { await request('queries.externalDiscard', input); onDone(committed ? text.saved : ''); })}>{committed ? text.retryCleanup : text.discard}</button>
      <button disabled={busy} onClick={() => void run(async () => { await request('queries.externalKeep', input); onDone(committed ? text.saved + text.kept : text.kept); })}>{text.keep}</button>
      {busy && <Spinner/>}
    </div>
  </section>;
}
