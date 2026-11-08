import type { KeyboardEvent } from 'react';
import type { DatabaseObject } from '../shared/contracts';
import { postgresRelationSelect } from '../shared/postgresSql';
import { errorMessage, qualifiedName } from './lib';
import { objectQueryZh as text } from './locales/objectQuery.zh-CN';
import { appModalSelector } from './modalSelectors';
import { sqliteSelectSource } from './sqliteWorkspace';
import { useWorkspace, type WorkspaceTab } from './store';

/** 从明确的目录目标创建独立草稿。名称逐段引用，默认库沿用来源，无需连接或读取数据。 */
export function openObjectQuery(connectionId: string, database: string, object: DatabaseObject): void {
  const workspace = useWorkspace.getState();
  const dialect = workspace.connections.find(profile => profile.id === connectionId)?.dialect;
  if (!dialect || !database || object.kind !== 'table' && object.kind !== 'view' ||
      dialect === 'sqlite' && database !== 'main' || document.querySelector(appModalSelector)) return;
  if (workspace.settings.tabs.length >= 100) { workspace.notify(text.tabsFull, true); return; }
  try {
    const sql = dialect === 'sqlite' ? sqliteSelectSource(database, object) :
      dialect === 'postgresql' ? postgresRelationSelect(object.name) :
        'SELECT * FROM ' + qualifiedName(database, object.name) + ' LIMIT 100;';
    // 标签标题有持久化长度上限，SQL 始终保留完整名称。
    const title = object.name.length <= 256 ? object.name : object.name.slice(0, 255).replace(/[\uD800-\uDBFF]$/, '') + '…';
    workspace.openTab({ kind: 'query', connectionId, database, databaseContext: { state: 'known', database }, title, sql });
  } catch (reason) { workspace.notify(errorMessage(reason), true); }
}

/** 只从当前原数据标签打开，连接换绑或原标签已关闭时撤销旧入口。 */
export function openTableObjectQuery(tab: WorkspaceTab, version: number): void {
  const workspace = useWorkspace.getState();
  if (tab.kind !== 'table' || !tab.database || !tab.table || workspace.settings.activeTabId !== tab.id ||
      !workspace.settings.tabs.includes(tab) || (workspace.connectionVersions[tab.connectionId] ?? 0) !== version) return;
  openObjectQuery(tab.connectionId, tab.database, { kind: 'table', name: tab.table });
}

const isMac = () => globalThis.navigator?.platform?.startsWith('Mac') === true;
export const objectQueryShortcutLabel = (label = text.entry) => text.shortcut(label, isMac());
export const objectQueryKeyShortcuts = () => isMac() ? 'Meta+Shift+Y' : 'Control+Q';

/** 行和数据网格共享平台按键，保留输入法、编辑控件及模态窗口的按键所有权。 */
export function objectQueryShortcut(event: KeyboardEvent<HTMLElement>): boolean {
  if (event.defaultPrevented || event.nativeEvent.defaultPrevented || event.nativeEvent.isComposing ||
      event.keyCode === 229 || event.repeat || event.altKey) return false;
  const key = event.key.toLowerCase();
  const matches = isMac() ? key === 'y' && event.metaKey && event.shiftKey && !event.ctrlKey :
    key === 'q' && event.ctrlKey && !event.metaKey && !event.shiftKey;
  const target = event.target;
  if (!matches || !(target instanceof HTMLElement) || !event.currentTarget.contains(target) ||
      target.isContentEditable || target.closest('input, textarea, select, [role="textbox"], [role="menu"]') ||
      document.querySelector(appModalSelector)) return false;
  event.preventDefault();
  event.stopPropagation();
  return true;
}

/** 数据页只从本页网格接管快捷键，筛选表单和移植到其他页面的内容保持原行为。 */
export function tableObjectQueryShortcut(event: KeyboardEvent<HTMLDivElement>): boolean {
  const target = event.target;
  return target instanceof HTMLElement && target.closest('.workspace-tab') === event.currentTarget &&
    !!target.closest('[role="grid"]') && objectQueryShortcut(event);
}
