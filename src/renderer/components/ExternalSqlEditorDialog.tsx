import { useEffect, useRef, useState } from 'react';
import { externalSqlEditorZh as text, type ExternalSqlEditorView } from '../../shared/externalSqlEditor';
import { errorMessage, invoke } from '../lib';
import { ErrorBox, Modal, Spinner, UsageHelp } from './ui';

/** 偏好仅由原生选择和清除命令修改。关闭弹窗不会触发保存或打开应用。 */
export function ExternalSqlEditorDialog({ onClose }: { onClose(): void }) {
  const [setting, setSetting] = useState<ExternalSqlEditorView>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);

  useEffect(() => {
    let current = true;
    void invoke('externalSqlEditor.status', {}).then(view => { if (current) setSetting(view); })
      .catch(() => { if (current) setError(text.readFailed); });
    return () => { current = false; };
  }, []);

  async function change(command: 'externalSqlEditor.choose' | 'externalSqlEditor.clear') {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try { setSetting(await invoke(command, {})); }
    catch (reason) { setError(errorMessage(reason) || text.saveFailed); }
    finally { pending.current = false; setBusy(false); }
  }

  function close() { if (!pending.current) onClose(); }

  return <Modal title={text.title} onClose={close}>
    <div className="modal-content">
      {setting ? <p role="status" style={{ overflowWrap: 'anywhere' }}>{!setting.supported ? text.unsupported : setting.path ?? text.unconfigured}</p> : !error && <Spinner/>}
      <UsageHelp><p>{text.hint}</p><p>{text.draftHint}</p></UsageHelp>
      <ErrorBox message={error}/>
    </div>
    <footer className="modal-footer">
      <button disabled={busy} onClick={close}>{text.close}</button><span className="grow"/>
      {busy && <Spinner/>}
      <button disabled={busy || !setting?.path} onClick={() => void change('externalSqlEditor.clear')}>{text.clear}</button>
      <button className="primary" disabled={busy || !setting?.supported} onClick={() => void change('externalSqlEditor.choose')}>{text.choose}</button>
    </footer>
  </Modal>;
}
