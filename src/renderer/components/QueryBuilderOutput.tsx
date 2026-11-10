import { useLayoutEffect, useRef, useState } from 'react';
import type { SavedQueryGroupTarget } from '../../shared/savedQueryOrganization';
import { writeTableClipboardEvent } from '../gridClipboard';
import { errorMessage, invoke } from '../lib';
import { queryBuilderOutputZh as text } from '../locales/queryBuilderOutput.zh-CN';
import { useWorkspace } from '../store';
import { SavedQuerySaveGroup } from './SavedQuerySaveGroup';

export interface QueryBuilderSaveTarget { name: string; group?: SavedQueryGroupTarget }
export type QueryBuilderOutputTarget = 'open' | 'view' | QueryBuilderSaveTarget;

/** 在构建器复核来源后新建本机条目，保存明确的数据库上下文。 */
export async function saveQueryBuilderSql(target: QueryBuilderSaveTarget, connectionId: string, database: string, sql: string) {
  const saved = await invoke('queries.create', { ...target, connectionId, context: { state: 'known', database }, sql });
  useWorkspace.getState().notify(text.saved(saved.name));
}

/** 复制只使用本次已提交渲染的 SQL。打开保存区不会冻结草稿，提交时使用当时的预览。 */
export function QueryBuilderOutput({ preview, sql, disabled, current, onSave }: {
  preview?: object; sql?: string; disabled: boolean; current(): boolean; onSave(target: QueryBuilderSaveTarget): void;
}) {
  const ticket = {}, committed = useRef<object | undefined>(undefined);
  useLayoutEffect(() => {
    committed.current = ticket;
    return () => { if (committed.current === ticket) committed.current = undefined; };
  });
  const [name, setName] = useState('');
  const [group, setGroup] = useState<SavedQueryGroupTarget>();
  const [feedback, setFeedback] = useState<{ preview: object; message: string; failed: boolean }>();
  const allowed = () => committed.current === ticket && !disabled && !!preview && !!sql && current();
  const notice = feedback?.preview === preview ? feedback : undefined;

  function copy() {
    if (!preview || !sql || !allowed()) return;
    try {
      writeTableClipboardEvent(allowed, data => data.setData('text/plain', sql));
      setFeedback({ preview, message: text.copied, failed: false });
    } catch (reason) { setFeedback({ preview, message: errorMessage(reason), failed: true }); }
  }

  return <div>
    <button type="button" disabled={disabled || !sql} onClick={copy}>{text.copy}</button>
    {notice && <p role={notice.failed ? 'alert' : 'status'}>{notice.message}</p>}
    <details>
      <summary>{text.save}</summary>
      <form onSubmit={event => {
        event.preventDefault();
        if (allowed() && name.trim()) onSave({ name: name.trim(), ...(group ? { group } : {}) });
      }}>
        <p className="muted small">{text.hint}</p>
        <label>{text.name}<input value={name} maxLength={256} disabled={disabled} onChange={event => setName(event.target.value)}/></label>
        <SavedQuerySaveGroup disabled={disabled} target={group} onChange={setGroup}/>
        <button type="submit" disabled={disabled || !sql || !name.trim()}>{text.confirm}</button>
      </form>
    </details>
  </div>;
}
