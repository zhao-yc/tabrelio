import { useEffect, useId, useRef, useState } from 'react';
import type { ConnectionProfile } from '../../shared/contracts';
import { queryDatabasePatch } from '../../shared/queryContext';
import type { QueryTargetDraft } from '../queryDuplicateIntent';
import { invoke, errorMessage } from '../lib';
import { useWorkspace } from '../store';
import { queryDuplicateZh as text } from '../locales/queryDuplicate.zh-CN';
import { zh } from '../locales/zh-CN';
import { ErrorBox, Field, Modal } from './ui';

interface Target { profile: ConnectionProfile; version: number }

/** 只把已捕获的正文交给明确选择的目标。目录读取由用户触发，副本没有原会话或文件来源。 */
export function QueryTargetDialog({ draft, onClose }: { draft: QueryTargetDraft; onClose(): void }) {
  const connections = useWorkspace(state => state.connections);
  const [target, setTarget] = useState<Target>(), targetRef = useRef<Target | undefined>(undefined);
  const [database, setDatabase] = useState(''), [databases, setDatabases] = useState<string[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const closed = useRef(false), pending = useRef<object | undefined>(undefined), listId = useId();
  const sqlite = target?.profile.dialect === 'sqlite', postgres = target?.profile.dialect === 'postgresql';

  function close(): void {
    if (closed.current) return;
    closed.current = true; pending.current = undefined; onClose();
  }
  useEffect(() => {
    closed.current = false;
    const stop = useWorkspace.subscribe(state => { if (state.settings.activeTabId !== draft.sourceTabId) close(); });
    return () => { closed.current = true; pending.current = undefined; stop(); };
  }, [draft, onClose]);

  function select(id: string): void {
    const state = useWorkspace.getState(), profile = state.connections.find(item => item.id === id);
    const next = profile && { profile, version: state.connectionVersions[id] ?? 0 };
    targetRef.current = next; pending.current = undefined;
    setTarget(next); setDatabase(profile?.dialect === 'sqlite' ? 'main' : profile?.database || (profile?.dialect === 'postgresql' ? 'postgres' : ''));
    setDatabases([]); setError(''); setBusy(false);
  }

  /** 连接重新选择或修订变化后，旧目录响应及提交都不能作用到新目标。 */
  function current(expected: Target | undefined): expected is Target {
    const state = useWorkspace.getState();
    return !!expected && !closed.current && expected === targetRef.current && state.settings.activeTabId === draft.sourceTabId &&
      state.connections.find(item => item.id === expected.profile.id) === expected.profile &&
      (state.connectionVersions[expected.profile.id] ?? 0) === expected.version;
  }

  async function readDatabases(): Promise<void> {
    if (!current(target)) { setError(text.targetChanged); return; }
    if (pending.current || sqlite) return;
    const connectionId = target.profile.id, request = {};
    pending.current = request; setBusy(true); setError('');
    const live = () => pending.current === request && current(target);
    try {
      await invoke('connections.open', { id: connectionId });
      if (!live()) return;
      const names = await invoke('metadata.databases', { connectionId });
      if (live()) setDatabases(names);
    } catch (reason) { if (live()) setError(errorMessage(reason)); }
    finally { if (pending.current === request) { pending.current = undefined; setBusy(false); } }
  }

  function open(): void {
    if (!current(target)) { setError(text.targetChanged); return; }
    if (pending.current) return;
    const value = sqlite ? 'main' : database || null;
    if (postgres && value === null || value && (value.length > 256 || value.includes('\0'))) { setError(text.targetDatabaseInvalid); return; }
    const state = useWorkspace.getState();
    if (state.settings.tabs.length >= 100) { setError(text.tooMany); return; }
    close();
    state.openTab({ kind: 'query', title: draft.title, sql: draft.sql, connectionId: target.profile.id,
      ...queryDatabasePatch({ state: 'known', database: value }) });
  }

  return <Modal title={text.targetAction} onClose={close}>
    <form onSubmit={event => { event.preventDefault(); open(); }}>
      <div className="modal-content form-grid">
        <p className="muted full">{text.targetHint}</p>
        <Field label={text.targetConnection} full><select aria-label={text.targetConnection} value={target?.profile.id ?? ''}
          onChange={event => select(event.target.value)}><option value="">{text.targetPlaceholder}</option>
          {connections.map(profile => <option value={profile.id} key={profile.id}>{profile.name} · {profile.dialect}</option>)}
        </select></Field>
        <Field label={text.targetDatabase} full><input aria-label={text.targetDatabase} list={listId} value={database}
          disabled={!target} readOnly={sqlite} required={postgres} maxLength={256} placeholder={target && !postgres && !sqlite ? text.targetNoDatabase : undefined}
          onChange={event => setDatabase(event.target.value)}/><datalist id={listId}>{databases.map(name => <option key={name} value={name}/>)}</datalist></Field>
        {target && !sqlite && <button type="button" disabled={busy} onClick={() => void readDatabases()}>{text.targetRead}</button>}
        <ErrorBox message={error}/>
      </div>
      <footer className="modal-footer"><button type="button" onClick={close}>{zh.common.cancel}</button><span className="grow"/>
        <button type="submit" className="primary" disabled={!target || busy}>{text.targetOpen}</button>
      </footer>
    </form>
  </Modal>;
}
