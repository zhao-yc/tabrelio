import { useEffect, useRef, useState } from 'react';
import type { QueryFileEncoding } from '../../shared/contracts';
import { newQueryContext } from '../connectionChanges';
import { errorMessage, invoke, uid } from '../lib';
import { queryFilesZh as text } from '../locales/queryFiles.zh-CN';
import { zh } from '../locales/zh-CN';
import { appModalSelector, gridDialogCurrent } from '../modalSelectors';
import type { QueryFileTaskOperation, QueryFileTaskState } from '../queryFileTasks';
import { beginWorkspaceQueryFileTask } from '../workspaceQueryFileTask';
import { acquireWorkspaceBusy, beginQueryFileOpen, flushSettings, useWorkspace, type QueryFileOpenLease, type WorkspaceBusyLease, type WorkspaceTab } from '../store';
import { QueryFileTaskProgress } from './QueryFileTaskProgress';
import { RecentQueryFilesDialog } from './RecentQueryFilesDialog';
import { ErrorBox, Field, Modal, Spinner, UsageHelp } from './ui';

/** 空工作区和对象页使用同一个原生文件读取入口，先明确新查询的目标。 */
export function OpenQueryFileDialog({ mode, onClose }: { mode: 'open' | 'recent'; onClose(): void }) {
  const connections = useWorkspace(state => state.connections);
  const [initial] = useState(() => {
    const state = useWorkspace.getState();
    const first = state.connections[0]?.id ?? '';
    const selected = newQueryContext(state.selection, state.settings.tabs.find(item => item.id === state.settings.activeTabId), first);
    return state.connections.some(item => item.id === selected.connectionId) ? selected : { connectionId: first };
  });
  const [connectionId, setConnectionId] = useState(initial.connectionId);
  const [database, setDatabase] = useState(initial.database ?? '');
  const [encoding, setEncoding] = useState<QueryFileEncoding>('utf8');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [task, setTask] = useState<QueryFileTaskState>();
  const fields = useRef<HTMLDivElement>(null), active = useRef(false), taskOwner = useRef<QueryFileTaskOperation | undefined>(undefined);
  const profile = connections.find(item => item.id === connectionId), sqlite = profile?.dialect === 'sqlite';
  const ownsView = () => {
    const element = fields.current;
    return !!element && gridDialogCurrent(element, () => element.closest(appModalSelector) ?? undefined);
  };
  useEffect(() => () => { void taskOwner.current?.cancel(true); }, []);

  /** 读取阶段只登记空占位，失败收尾不会关闭或覆盖此前的活动标签。 */
  async function open(requestedEncoding: QueryFileEncoding, recentId?: string): Promise<boolean> {
    const state = useWorkspace.getState();
    if (active.current || !ownsView() || !profile || !state.connections.includes(profile)) return false;
    if (state.settings.tabs.length >= 100) throw Error(text.openTabLimit);
    const target: WorkspaceTab = { id: uid(), kind: 'query', title: text.opening, connectionId, sql: '',
      ...(sqlite ? { database: 'main', databaseContext: { state: 'known', database: 'main' } } as const : database ? { database } : {}) };
    active.current = true; setBusy(true); setTask(undefined);
    let opening: QueryFileOpenLease | undefined, job: WorkspaceBusyLease | undefined, opened = false;
    try {
      opening = beginQueryFileOpen(undefined, target, ownsView);
      job = acquireWorkspaceBusy(target.id);
      await flushSettings();
      if (!job.owns() || !opening.current()) throw Error(text.changed);
      const { taskId, owner } = beginWorkspaceQueryFileTask(target, 'open', () => opening?.current() === true, value => { if (ownsView()) setTask(value); });
      taskOwner.current = owner;
      const result = await invoke('queryFileSources.open', { tabId: target.id, taskId, encoding: requestedEncoding, ...(recentId ? { recentId } : {}) });
      owner.finish(result);
      if (result.state === 'blocked') throw Error(result.message);
      if (result.state === 'cancelled') return false;
      if (!owner.documentCurrent() || !job.owns() || !opening.apply(result.sql, result.binding)) throw Error(text.changed);
      opened = true;
      try { await flushSettings(); }
      catch { useWorkspace.getState().notify(text.openPersistFailed, true); }
      return true;
    } catch (reason) {
      taskOwner.current?.finish({ state: 'blocked', message: text.changed, wrote: 'no' });
      throw reason;
    } finally {
      taskOwner.current = undefined;
      opening?.dispose(!opened && job?.owns() === true);
      job?.release(); active.current = false;
      if (fields.current) setBusy(false);
    }
  }

  async function choose() {
    setError('');
    try { if (await open(encoding) && fields.current) onClose(); }
    catch (reason) { if (fields.current) setError(errorMessage(reason)); }
  }

  /** 最近列表与删除只有工作区元数据权限，不登记文件正文的占位标签。 */
  async function recentScope() {
    await flushSettings();
    if (!ownsView()) throw Error(text.changed);
    return { scope: 'workspace' } as const;
  }
  function targetFields(disabled: boolean) {
    return <div className="full form-grid" ref={fields}>
      <Field full label={zh.app.text049}><select aria-label={zh.app.text049} value={connectionId} disabled={disabled} onChange={event => { setConnectionId(event.target.value); setDatabase(''); }}>
        {connections.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></Field>
      <Field full label={zh.app.text050}><input aria-label={zh.app.text050} value={sqlite ? 'main' : database} readOnly={sqlite} disabled={disabled} maxLength={256}
        placeholder={zh.app.text052} onChange={event => setDatabase(event.target.value)}/></Field>
    </div>;
  }
  if (mode === 'recent') return <RecentQueryFilesDialog files={{ open, task, isBusy: () => active.current,
    recent: async () => invoke('queryFileSources.recent', await recentScope()),
    forgetRecent: async recentId => invoke('queryFileSources.forgetRecent', { ...await recentScope(), recentId }),
  }} targetFields={targetFields} canOpen={!!profile} onClose={onClose}/>;

  return <Modal title={text.open} onClose={() => { if (!active.current) onClose(); }}><form onSubmit={event => { event.preventDefault(); void choose(); }}>
    <div className="modal-content form-grid">
      <div className="full"><UsageHelp><p>{text.workspaceOpenHint}</p><p>{text.limitHint}</p></UsageHelp></div>
      {targetFields(busy)}
      <Field full label={text.encoding}><select aria-label={text.encoding} value={encoding} disabled={busy} onChange={event => setEncoding(event.target.value as QueryFileEncoding)}>
        <option value="utf8">{text.utf8}</option><option value="utf16le">{text.utf16le}</option><option value="gb18030">{text.gb18030}</option>
      </select></Field>
      <div className="full">{busy && task && <QueryFileTaskProgress task={task}/>}<ErrorBox message={error}/></div>
    </div><footer className="modal-footer"><span className="grow"/>{busy && <Spinner/>}
      <button type="button" disabled={busy} onClick={onClose}>{zh.common.cancel}</button>
      <button className="primary" type="submit" disabled={busy || !profile}>{text.openAction}</button>
    </footer>
  </form></Modal>;
}
