import { useEffect, useRef, useState } from 'react';
import type { ConnectionProfile, DatabaseObject } from '../shared/contracts';
import { postgresIdentifier, postgresRelationName } from '../shared/postgresSql';
import { resolveQueryDatabase } from '../shared/queryContext';
import { appModalSelector, isAppModalNode } from './modalSelectors';
import { sidebarConnectionEnd } from './sidebarNodeRequests';
import { sidebarLocateZh as text } from './locales/sidebarLocate.zh-CN';
import { useWorkspace, type WorkspaceTab } from './store';

interface SidebarLocation {
  connectionId: string;
  database?: string;
  relation?: string;
}
export interface SidebarLocateRequest extends SidebarLocation {
  current(): boolean;
  fail(message: string): void;
  complete(reveal: () => void): void;
}

/** 查询没有确定的库时只定位所属连接；表页必须提供明确的库和实际关系名。 */
export function sidebarLocation(tab: WorkspaceTab | undefined, profile: ConnectionProfile | undefined): SidebarLocation | undefined {
  if (!tab || !profile || tab.connectionId !== profile.id) return;
  const connectionId = profile.id;
  if (tab.kind === 'query') {
    const context = resolveQueryDatabase(tab.database, tab.databaseContext);
    return context.state === 'known' && context.database ? { connectionId, database: context.database } : { connectionId };
  }
  if (!tab.database) return;
  if (tab.kind === 'objects') return { connectionId, database: tab.database };
  if (!tab.table) return;
  let relation = tab.table;
  if (profile.dialect === 'postgresql') {
    try {
      const { schema, name } = postgresRelationName(tab.table);
      relation = postgresIdentifier(schema) + '.' + postgresIdentifier(name);
    } catch { return; }
  }
  return { connectionId, database: tab.database, relation };
}

/** 数据页的原定位不会从名称猜对象类型；只认目录中唯一的同名表或视图。 */
export function sidebarLocatedObject(objects: readonly DatabaseObject[], relation: string | undefined): DatabaseObject | undefined {
  if (relation === undefined) return;
  const matches = objects.filter(object => (object.kind === 'table' || object.kind === 'view') && object.name === relation);
  return matches.length === 1 ? matches[0] : undefined;
}

function locationSnapshot(state: ReturnType<typeof useWorkspace.getState>) {
  const tab = state.settings.tabs.find(tab => tab.id === state.settings.activeTabId) ?? state.settings.tabs[0];
  const profile = state.connections.find(profile => profile.id === tab?.connectionId);
  const location = sidebarLocation(tab, profile);
  const version = profile ? state.connectionVersions[profile.id] ?? 0 : 0;
  return { location, profile, version, key: JSON.stringify([tab?.id, location]) };
}

/** 一次定位只归属原标签和连接修订；新输入、选择或标签切换会撤销迟到的焦点操作。 */
export function useSidebarLocate() {
  const [request, setRequest] = useState<SidebarLocateRequest>();
  const live = useRef<{ request: SidebarLocateRequest; release(): void } | undefined>(undefined);
  const cancel = () => {
    const previous = live.current;
    if (!previous) return;
    live.current = undefined;
    previous.release();
    setRequest(undefined);
  };
  useEffect(() => () => {
    live.current?.release();
    live.current = undefined;
  }, []);

  function start(): boolean {
    cancel();
    const workspace = useWorkspace.getState(), original = locationSnapshot(workspace);
    if (!original.location || document.querySelector(appModalSelector)) return false;
    if (sidebarConnectionEnd(original.location.connectionId)) { workspace.notify(text.closing, true); return false; }
    const intent: SidebarLocateRequest = {
      ...original.location,
      current() {
        if (live.current?.request !== intent) return false;
        const state = useWorkspace.getState(), next = locationSnapshot(state);
        return next.key === original.key && next.profile === original.profile &&
          next.version === original.version && state.selection === workspace.selection && !document.querySelector(appModalSelector);
      },
      fail(message) {
        if (!intent.current()) return;
        cancel(); useWorkspace.getState().notify(message, true);
      },
      complete(reveal) {
        if (!intent.current()) return;
        cancel(); reveal();
      },
    };
    const cancelIntent = () => { if (live.current?.request === intent) cancel(); };
    const unsubscribe = useWorkspace.subscribe(() => { if (!intent.current()) cancelIntent(); });
    const dialogs = new MutationObserver(records => {
      if (records.some(record => record.type === 'attributes'
        ? isAppModalNode(record.target)
        : [...record.addedNodes, ...record.removedNodes].some(node => isAppModalNode(node) ||
          node.nodeType === 1 && !!(node as Element).querySelector(appModalSelector)))) cancelIntent();
    });
    dialogs.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['role'] });
    document.addEventListener('pointerdown', cancelIntent, true);
    document.addEventListener('focusin', cancelIntent, true);
    document.addEventListener('keydown', cancelIntent, true);
    window.addEventListener('blur', cancelIntent);
    live.current = { request: intent, release() {
      unsubscribe();
      dialogs.disconnect();
      document.removeEventListener('pointerdown', cancelIntent, true);
      document.removeEventListener('focusin', cancelIntent, true);
      document.removeEventListener('keydown', cancelIntent, true);
      window.removeEventListener('blur', cancelIntent);
    } };
    setRequest(intent);
    return true;
  }

  return { request, start, cancel };
}
