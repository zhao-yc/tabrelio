import { useState } from 'react';
import type { ManualJoinDesignSummary } from '../../shared/manualJoinDesigns';
import type { SingleQueryDesignScope, SingleQueryDraft } from '../../shared/singleQueryDesigns';
import { invoke } from '../lib';
import { tableForeignKeyJoinZh as text } from '../locales/tableForeignKeyJoin.zh-CN';
import { Field } from './ui';

/** 本地操作沿用构建器的串行门；恢复先核结构，再一次替换表单。 */
export function SingleQueryDesignPanel({ scope, draft, disabled, current, run, restore }: {
  scope: SingleQueryDesignScope; draft?: SingleQueryDraft; disabled: boolean; current(): boolean;
  run(action: () => Promise<void>): void; restore(value: SingleQueryDraft): Promise<void>;
}) {
  const title = scope.join ? text.designTitle : text.singleDesignTitle;
  const [entries, setEntries] = useState<ManualJoinDesignSummary[]>([]);
  const [id, setId] = useState(''), [name, setName] = useState(''), [notice, setNotice] = useState('');

  function act(action: 'list' | 'save' | 'replace' | 'restore' | 'delete') {
    if (disabled || !current()) return;
    if ((action === 'save' || action === 'replace') && (!draft || !name.trim())) return;
    if (action === 'restore' || action === 'delete' || action === 'replace') {
      const confirmation = action === 'restore' ? text.designRestoreConfirm :
        action === 'delete' ? text.designDeleteConfirm : text.designReplaceConfirm;
      if (!id || !window.confirm(confirmation)) return;
    }
    setNotice('');
    run(async () => {
      if (action === 'list') {
        const list = await invoke('singleQueryDesigns.list', scope);
        if (!current()) return;
        setEntries(list);
        if (!list.some(item => item.id === id)) setId('');
      } else if (action === 'restore') {
        const value = await invoke('singleQueryDesigns.read', { ...scope, id });
        if (!current()) return;
        await restore(value);
        if (current()) setNotice(text.designRestored);
      } else if (action === 'delete') {
        await invoke('singleQueryDesigns.delete', { ...scope, id });
        if (!current()) return;
        setEntries(previous => previous.filter(item => item.id !== id)); setId(''); setName('');
        setNotice(text.designDeleted);
      } else {
        if (!draft) return;
        const entry = await invoke('singleQueryDesigns.save', { ...scope, name, design: draft,
          replaceId: action === 'replace' ? id : undefined });
        if (!current()) return;
        setEntries(previous => [...previous.filter(item => action !== 'replace' || item.id !== id), entry]);
        setId(entry.id); setName(entry.name); setNotice(text.designSaved);
      }
    });
  }

  return <details>
    <summary>{title}</summary>
    <fieldset aria-label={title} disabled={disabled}>
      <p className="muted small">{text.designHint}</p>
      <button type="button" onClick={() => act('list')}>{text.designRefresh}</button>
      <Field label={title}><select aria-label={title} value={id} onChange={event => {
        if (!current()) return;
        const selected = entries.find(item => item.id === event.target.value);
        setId(selected?.id ?? ''); setName(selected?.name ?? ''); setNotice('');
      }}>
        <option value="">{text.manualSelect}</option>
        {entries.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></Field>
      <button type="button" disabled={!id} onClick={() => act('restore')}>{text.designLoad}</button>
      <button type="button" disabled={!id} onClick={() => act('delete')}>{text.designDelete}</button>
      <Field label={text.designName}><input aria-label={text.designName} maxLength={80} value={name}
        onChange={event => { if (current()) setName(event.target.value); }}/></Field>
      <button type="button" disabled={!draft || !name.trim()} onClick={() => act('save')}>{text.designSave}</button>
      <button type="button" disabled={!id || !draft || !name.trim()} onClick={() => act('replace')}>{text.designReplace}</button>
      {notice && <p role="status">{notice}</p>}
    </fieldset>
  </details>;
}
