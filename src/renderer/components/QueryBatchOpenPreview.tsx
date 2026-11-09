import { useLayoutEffect, useRef } from 'react';
import type { ConnectionProfile } from '../../shared/contracts';
import { savedQueryPagesZh as text } from '../locales/savedQueryPages.zh-CN';
import { formatText, zh } from '../locales/zh-CN';

interface Props {
  rows: readonly { id: string; name: string }[];
  targets: ReadonlyMap<string, string>;
  connections: readonly ConnectionProfile[];
  busy: boolean;
  onTarget(id: string, connectionId: string): void;
  onCancel(): void;
  onConfirm(): void;
}

/** 历史和保存查询共享目标预览；此组件只选择连接，不读取或执行 SQL。 */
export function QueryBatchOpenPreview({ rows, targets, connections, busy, onTarget, onCancel, onConfirm }: Props) {
  const section = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    section.current?.focus();
    section.current?.scrollIntoView?.({ block: 'nearest' });
  }, []);
  return <section ref={section} tabIndex={-1} className="saved-query-organization-editor" role="group" aria-label={text.openBatchTitle}>
    <h3>{text.openBatchTitle}</h3><p>{text.openBatchHint}</p>
    <ol>{rows.map(item => <li key={item.id}>
      <label className="inline-field">{item.name} <select aria-label={formatText(text.connection, item.name)} disabled={busy}
        value={targets.get(item.id) ?? ''} onChange={event => onTarget(item.id, event.target.value)}>
        <option value="">{text.choose}</option>
        {connections.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
      </select></label>
    </li>)}</ol>
    <footer><button disabled={busy} onClick={onCancel}>{zh.common.cancel}</button><span className="grow"/>
      <button className="primary" disabled={busy || rows.some(({ id }) => !connections.some(profile => profile.id === targets.get(id)))}
        onClick={onConfirm}>{text.openBatchConfirm(rows.length)}</button>
    </footer>
  </section>;
}
