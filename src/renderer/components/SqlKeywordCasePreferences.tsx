import { useEffect, useRef, useState } from 'react';
import { defaultSqlKeywordCase, readSqlKeywordCase } from '../../shared/sqlKeywordCase';
import { isSqlExpressionWidth, readSqlExpressionWidth, sqlExpressionWidthLimits } from '../../shared/sqlExpressionWidth';
import { flushSettings, useWorkspace } from '../store';
import { sqlFormattingZh as text } from '../locales/sqlFormatting.zh-CN';
import { ErrorBox, Field, UsageHelp } from './ui';

/** 集中在原全局偏好弹窗；草稿、恢复默认和取消都不触碰已有模型或SQL。 */
export function SqlKeywordCasePreferences({ standalone = false }: { standalone?: boolean } = {}) {
  const current = useWorkspace(state => readSqlKeywordCase(state.settings.sqlKeywordCase));
  const currentWidth = useWorkspace(state => readSqlExpressionWidth(state.settings.sqlExpressionWidth));
  const [draft, setDraft] = useState<string>(current), [saving, setSaving] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false);
  const [widthDraft, setWidthDraft] = useState(String(currentWidth));
  const alive = useRef(true), pending = useRef<object | undefined>(undefined);
  useEffect(() => { alive.current = true; return () => { alive.current = false; pending.current = undefined; }; }, []);
  /** 同次保存只合并格式化偏好，迟到回包不能更新新弹窗或还原旧SQL。 */
  async function save() {
    if (!alive.current || pending.current) return;
    if (draft !== 'preserve' && draft !== 'upper' && draft !== 'lower') { setError(text.invalidPreference); return; }
    const width = widthDraft.trim() ? Number(widthDraft) : NaN;
    if (!isSqlExpressionWidth(width)) { setError(text.invalidWidth); return; }
    const token = {}; pending.current = token; setSaving(true); setError(''); setSaved(false);
    try {
      const workspace = useWorkspace.getState();
      const persistWidth = width !== sqlExpressionWidthLimits.defaultWidth || Object.hasOwn(workspace.settings, 'sqlExpressionWidth');
      workspace.updateSettings({ sqlKeywordCase: draft, ...(persistWidth ? { sqlExpressionWidth: width } : {}) });
      await flushSettings();
      if (alive.current && pending.current === token) setSaved(true);
    } catch { if (alive.current && pending.current === token) setError(text.preferenceFailed); }
    finally { if (alive.current && pending.current === token) { pending.current = undefined; setSaving(false); } }
  }
  /** 改草稿不触发store、自动保存、编辑器或格式化。 */
  function change(value: string) { setDraft(value); setError(''); setSaved(false); }
  function changeWidth(value: string) { setWidthDraft(value); setError(''); setSaved(false); }
  return <section className="full" aria-label={text.preferences}>
    {!standalone && <h3>{text.preferences}</h3>}
    <Field label={text.keywordCase}><select aria-label={text.keywordCase} value={draft} disabled={saving} onChange={event => change(event.target.value)}><option value="preserve">{text.preserve}</option><option value="upper">{text.upper}</option><option value="lower">{text.lower}</option></select></Field>
    <Field label={text.expressionWidth}><input type="number" aria-label={text.expressionWidth} min={sqlExpressionWidthLimits.min} max={sqlExpressionWidthLimits.max} step={1} value={widthDraft} disabled={saving} onChange={event => changeWidth(event.target.value)}/></Field>
    <UsageHelp><p>{text.preferenceHint}</p><p>{text.widthHint}</p><p>{text.resetHint}</p></UsageHelp>
    <button type="button" disabled={saving} onClick={() => { change(defaultSqlKeywordCase); changeWidth(String(sqlExpressionWidthLimits.defaultWidth)); }}>{text.reset}</button><button type="button" disabled={saving} onClick={() => { change(current); changeWidth(String(currentWidth)); }}>{text.cancelDraft}</button><button type="button" disabled={saving} onClick={() => void save()}>{saving ? text.saving : text.save}</button>
    {saved && <p role="status">{text.saved}</p>}<ErrorBox message={error}/>
  </section>;
}
