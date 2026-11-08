import { useRef, useState } from 'react';
import { mysqlViewRenamePreviewSchema, type MysqlViewRenamePreview } from '../../shared/mysqlViewRename';
import { errorMessage, invoke } from '../lib';
import { mysqlViewRenameZh as text } from '../locales/mysqlViewRename.zh-CN';
import { zh } from '../locales/zh-CN';
import { useWorkspace } from '../store';
import { assertTableRenameTargetAvailable } from '../tableRenameServices';
import { ErrorBox, Field, Modal, Spinner } from './ui';

/** 预览和确认按钮独立，确认仅消费当前名称的单次令牌。 */
export function MysqlViewRenameDialog({ connectionId, database, name, version, onBack, onChanged }: {
  connectionId: string; database: string; name: string; version: number;
  onBack(): void; onChanged(newName: string, verified: boolean): void;
}) {
  const currentVersion = useWorkspace(state => state.connectionVersions[connectionId] ?? 0);
  const stale = currentVersion !== version;
  const [newName, setNewName] = useState('');
  const [preview, setPreview] = useState<MysqlViewRenamePreview>();
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);

  function back() { if (!pending.current) onBack(); }
  async function run(apply: boolean) {
    const workspace = useWorkspace.getState();
    if (pending.current || attempted || (workspace.connectionVersions[connectionId] ?? 0) !== version ||
        apply && (!preview || !confirmed)) return;
    pending.current = true;
    setBusy(true);
    setError('');
    let submitted = false;
    try {
      const target = mysqlViewRenamePreviewSchema.parse({ connectionId, database, name, newName });
      assertTableRenameTargetAvailable({ connectionId, database, table: name }, workspace);
      assertTableRenameTargetAvailable({ connectionId, database, table: newName }, workspace);
      if (!apply) {
        setPreview(await invoke('mysql.view.renamePreview', target));
        return;
      }
      setAttempted(true);
      setPreview(undefined);
      submitted = true;
      const result = await invoke('mysql.view.renameApply', { token: preview!.token, confirmed: true });
      onChanged(newName, result.verified);
      if (!result.verified) setError(text.unverified);
    } catch (reason) {
      if (submitted) onChanged(newName, false);
      setError(errorMessage(reason) + (submitted ? ' ' + text.checkResult : ''));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  const disabled = stale || busy || attempted;
  return <Modal title={text.title} onClose={back} wide>
    <div className="modal-content" aria-busy={busy}>
      <p>{text.source(database, name)}</p><p>{text.hint}</p>
      <Field label={text.name}><input value={newName} maxLength={64} disabled={disabled}
        onChange={event => { setNewName(event.target.value); setPreview(undefined); setConfirmed(false); setError(''); }}/></Field>
      {preview && !stale && <>
        <pre className="pg-create-sql" aria-label={text.preview}>{preview.sql}</pre>
        <details><summary>{text.sourceDdl}</summary><pre className="pg-create-sql">{preview.sourceDdl}</pre></details>
        <label><input type="checkbox" disabled={disabled} checked={confirmed} onChange={event => setConfirmed(event.target.checked)}/>{text.acknowledge}</label>
      </>}
      {busy && <Spinner/>}<ErrorBox message={stale ? text.stale : error}/>
    </div>
    <footer className="modal-footer">
      <button disabled={busy} onClick={back}>{zh.common.close}</button><span className="grow"/>
      <button disabled={disabled || !newName || newName === name || !!preview} onClick={() => void run(false)}>{text.preview}</button>
      <button className="primary" disabled={disabled || !preview || !confirmed} onClick={() => void run(true)}>{text.apply}</button>
    </footer>
  </Modal>;
}
