import { useRef, useState } from 'react';
import type { SavedQueryGroupTarget, SavedQueryOrganizationSnapshot } from '../../shared/savedQueryOrganization';
import { errorMessage, invoke } from '../lib';
import { savedQueryOrganizationZh as text } from '../locales/savedQueryOrganization.zh-CN';
import { readSavedQueryOrganization, savedQueryOrganizationTree } from '../savedQueryOrganizationUi';

interface Props {
  disabled: boolean;
  target?: SavedQueryGroupTarget;
  onChange(target?: SavedQueryGroupTarget): void;
}

/** 只在用户请求时读取分组。刷新不擅自将旧目标改为未分组，也不替用户确认新路径。 */
export function SavedQuerySaveGroup({ disabled, target, onChange }: Props) {
  const [snapshot, setSnapshot] = useState<SavedQueryOrganizationSnapshot>();
  const [loading, setLoading] = useState(false), [error, setError] = useState('');
  const pending = useRef(false);
  async function load() {
    if (pending.current) return;
    pending.current = true;
    setLoading(true);
    setError('');
    try { setSnapshot(readSavedQueryOrganization(await invoke('queries.organizationGet', {}))); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { pending.current = false; setLoading(false); }
  }
  const groups = snapshot ? savedQueryOrganizationTree(snapshot) : [];
  const selected = target && target.expectedRevision === snapshot?.revision && groups.some(group => group.id === target.id)
    ? 'group:' + target.id : target ? '-' : '';
  return <div className="saved-query-save-group" style={{ maxWidth: '100%' }}>
    {snapshot && <select aria-label={text.saveGroup} value={selected}
      disabled={disabled || loading} style={{ maxWidth: '100%' }} onChange={event => {
        const value = event.target.value;
        const group = groups.find(item => 'group:' + item.id === value);
        onChange(group ? { id: group.id, expectedRevision: snapshot.revision } : undefined);
      }}>
      {selected === '-' && <option value="-" disabled>{text.reselectSaveGroup}</option>}
      <option value="">{text.unfiled}</option>
      {groups.map(group => <option key={group.id} value={'group:' + group.id}>{group.path}</option>)}
    </select>}
    <button type="button" disabled={disabled || loading} onClick={() => void load()}>
      {loading ? text.loadSaveGroups : snapshot ? text.refreshSaveGroups : text.chooseSaveGroup}
    </button>
    {error && <p role="alert">{error}</p>}
  </div>;
}
