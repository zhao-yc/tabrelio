import { useEffect, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { isSqlExpressionWidth, readSqlExpressionWidth, sqlExpressionWidthLimits } from '../../shared/sqlExpressionWidth';
import { readSqlKeywordCase } from '../../shared/sqlKeywordCase';
import { sqlFormattingZh as text } from '../locales/sqlFormatting.zh-CN';
import type { QueryFormattingOptions } from '../queryFormattingOptions';
import { flushSettings, useWorkspace } from '../store';
import { errorMessage } from '../lib';
import { ErrorBox, Field, Modal } from './ui';

/** 偏好先留在窗口。仅成功提交原编辑事务后，才按显式选择保存为全局偏好。 */
export function QueryFormattingOptionsDialog({ options, onClose }: { options: QueryFormattingOptions; onClose(): void }) {
  const [width, setWidth] = useState(String(readSqlExpressionWidth(options.preferences.expressionWidth)));
  const [keywordCase, setKeywordCase] = useState(readSqlKeywordCase(options.preferences.keywordCase));
  const [busy, setBusy] = useState(false), [finished, setFinished] = useState(false), [error, setError] = useState('');
  const active = useRef(false), closed = useRef(false);
  const canChangeCase = options.preferences.dialect === 'mysql';
  useEffect(() => () => { closed.current = true; options.intent.dispose(); }, [options]);

  function close() {
    closed.current = true;
    options.intent.dispose();
    onClose();
  }
  async function apply(save: boolean) {
    if (active.current || finished || closed.current) return;
    const expressionWidth = width.trim() ? Number(width) : NaN;
    if (!isSqlExpressionWidth(expressionWidth)) { setError(text.invalidWidth); return; }
    active.current = true; setBusy(true); setError('');
    try {
      await options.intent.run({ ...options.preferences, expressionWidth, keywordCase });
    } catch (reason) {
      if (!closed.current) { setError(errorMessage(reason)); setFinished(true); setBusy(false); }
      return;
    }
    if (closed.current) return;
    // 先卸载焦点陷阱再回到原编辑器，保证接下来的一次撤销仍交给 Monaco。
    flushSync(close);
    options.focus();
    if (save) {
      const workspace = useWorkspace.getState();
      workspace.updateSettings({ sqlExpressionWidth: expressionWidth, ...(canChangeCase ? { sqlKeywordCase: keywordCase } : {}) });
      try { await flushSettings(); }
      catch { useWorkspace.getState().notify(text.applyPreferenceFailed, true); }
    }
  }
  return createPortal(<Modal title={text.options} onClose={close}>
    <div className="modal-content form-grid" ref={options.setDialog}>
      <Field label={text.expressionWidth} full><input type="number" min={sqlExpressionWidthLimits.min} max={sqlExpressionWidthLimits.max} step={1} value={width} disabled={busy || finished} onChange={event => { setWidth(event.target.value); setError(''); }}/></Field>
      {canChangeCase && <Field label={text.keywordCase} full><select value={keywordCase} disabled={busy || finished} onChange={event => setKeywordCase(readSqlKeywordCase(event.target.value))}><option value="preserve">{text.preserve}</option><option value="upper">{text.upper}</option><option value="lower">{text.lower}</option></select></Field>}
      <p className="full muted">{text.optionsHint}</p>
      <div className="full"><ErrorBox message={error}/></div>
    </div>
    <footer className="modal-footer">
      <button onClick={close}>{text.cancelOptions}</button><span className="grow"/>
      <button disabled={busy || finished} onClick={() => void apply(true)}>{text.saveAndFormat}</button>
      <button className="primary" disabled={busy || finished} onClick={() => void apply(false)}>{text.formatOnce}</button>
    </footer>
  </Modal>, document.body);
}
