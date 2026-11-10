import { useState } from 'react';
import type { ConnectionProfile } from '../../shared/contracts';
import type { SavedQueryRebindInput } from '../../shared/savedQueryRebind';
import { savedQueryPagesZh as text } from '../locales/savedQueryPages.zh-CN';
import type { SelectedSavedQuery } from '../savedQueryOrganizationUi';

/** 显示完整选择和目标草稿，只有确认按钮会提交本地查询元数据。 */
export function SavedQueryRebindEditor({ rows, connections, busy, onCancel, onConfirm }: {
  rows: readonly SelectedSavedQuery[]; connections: readonly ConnectionProfile[]; busy: boolean;
  onCancel(): void; onConfirm(target: SavedQueryRebindInput['target']): void;
}) {
  const [choice, setChoice] = useState(''), [database, setDatabase] = useState('');
  const profile = connections.find(item => 'connection:' + item.id === choice), sqlite = profile?.dialect === 'sqlite';
  const target = profile ? { connectionId: profile.id, database: sqlite ? 'main' : database || null } : null;
  return <section className="saved-query-organization-editor" role="group" aria-label={text.rebindTitle}>
    <h3>{text.rebindTitle}</h3><p>{text.rebindHint}</p>
    <label>{text.rebindConnection}<select aria-label={text.rebindConnection} value={choice} disabled={busy}
      onChange={event => { setChoice(event.target.value); setDatabase(''); }}>
      <option value="">{text.rebindChoose}</option><option value="unbound">{text.unbound}</option>
      {connections.map(item => <option key={item.id} value={'connection:' + item.id}>{item.name}</option>)}
    </select></label>
    {profile && <label>{text.rebindDatabase}<input aria-label={text.rebindDatabase} value={sqlite ? 'main' : database} readOnly={sqlite}
      disabled={busy} maxLength={256} placeholder={text.rebindNoDatabase} onChange={event => setDatabase(event.target.value)}/></label>}
    <ol>{rows.map(row => <li key={row.id}>{row.name} <code>{row.id}</code></li>)}</ol>
    <footer><button type="button" disabled={busy} onClick={onCancel}>{text.rebindCancel}</button><span className="grow"/>
      <button className="primary" type="button" disabled={busy || !profile && choice !== 'unbound'} onClick={() => onConfirm(target)}>{text.rebindConfirm(rows.length)}</button>
    </footer>
  </section>;
}
