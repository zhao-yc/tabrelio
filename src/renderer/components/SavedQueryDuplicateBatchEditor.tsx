import { useState } from 'react';
import { savedQueryDuplicateName, type SavedQueryDuplicateBatchInput } from '../../shared/savedQueryDuplicate';
import type { SavedQueryOrganizationSnapshot } from '../../shared/savedQueryOrganization';
import { savedQueryOrganizationZh as organizationText } from '../locales/savedQueryOrganization.zh-CN';
import { savedQueryPagesZh as text } from '../locales/savedQueryPages.zh-CN';
import { savedQueryOrganizationTree, type SelectedSavedQuery } from '../savedQueryOrganizationUi';

/** 批量副本逐条显示名称，原查询与目标分组只使用打开确认区时的快照。 */
export function SavedQueryDuplicateBatchEditor({ rows, snapshot, busy, onCancel, onConfirm }: {
  rows: readonly SelectedSavedQuery[]; snapshot: SavedQueryOrganizationSnapshot; busy: boolean;
  onCancel(): void; onConfirm(items: SavedQueryDuplicateBatchInput['items'], destination?: SavedQueryDuplicateBatchInput['destination']): void;
}) {
  const [names, setNames] = useState(() => rows.map(row => savedQueryDuplicateName(row.name)));
  const [group, setGroup] = useState('preserve');
  const tree = savedQueryOrganizationTree(snapshot);
  return <section className="saved-query-organization-editor saved-query-duplicate-batch-editor" role="group" aria-label={text.duplicateBatchTitle}>
    <h3>{text.duplicateBatchTitle}</h3><p>{text.duplicateBatchHint}</p>
    <label>{text.duplicateBatchDestination}<select aria-label={text.duplicateBatchDestination} value={group} disabled={busy} onChange={event => setGroup(event.target.value)}>
      <option value="preserve">{text.duplicateBatchPreserve}</option><option value="unfiled">{organizationText.unfiled}</option>
      {tree.map(item => <option key={item.id} value={'group:' + item.id}>{item.path}</option>)}
    </select></label>
    <ol>{rows.map((row, index) => <li key={row.id}>
      <span>{row.name} <code>{row.id}</code></span>
      <label>{text.duplicateBatchName(index + 1)}<input aria-label={text.duplicateBatchName(index + 1)} value={names[index]} maxLength={256} disabled={busy}
        onChange={event => { const name = event.target.value; setNames(current => current.map((value, i) => i === index ? name : value)); }}/></label>
    </li>)}</ol>
    <footer><button type="button" disabled={busy} onClick={onCancel}>{text.duplicateBatchCancel}</button><span className="grow"/>
      <button className="primary" type="button" disabled={busy || names.some(name => !name.trim())} onClick={() => onConfirm(
        rows.map(({ id, digest }, index) => ({ id, digest, name: names[index] })), group === 'preserve' ? undefined : { groupId: group === 'unfiled' ? null : group.slice('group:'.length) },
      )}>{text.duplicateBatchConfirm(rows.length)}</button>
    </footer>
  </section>;
}
