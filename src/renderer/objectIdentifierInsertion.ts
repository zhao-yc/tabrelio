import type { ConnectionProfile } from '../shared/contracts';
import type { WorkspaceTab } from './store';

export const objectIdentifierDragType = 'application/x-dbark-object-identifier';

/** 只有同连接的编辑器能接收对象。PostgreSQL 的 schema 限定名只能在当前数据库解释。 */
export function canInsertObjectIdentifier(tab: WorkspaceTab | undefined, profile: ConnectionProfile, database: string): boolean {
  return tab?.kind === 'query' && tab.connectionId === profile.id &&
    (profile.dialect !== 'postgresql' || (tab.database || profile.database || 'postgres') === database);
}
