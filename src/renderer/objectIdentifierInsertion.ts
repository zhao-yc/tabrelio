import type { ConnectionProfile } from '../shared/contracts';
import { resolveQueryDatabase } from '../shared/queryContext';
import type { WorkspaceTab } from './store';

export const objectIdentifierDragType = 'application/x-dbark-object-identifier';
export interface QueryIdentifier { connectionId: string; database: string; sql: string; }

/** 只有同连接的编辑器能接收对象。PostgreSQL 的 schema 限定名只能在当前数据库解释。 */
export function canInsertObjectIdentifier(tab: WorkspaceTab | undefined, profile: ConnectionProfile, database: string): boolean {
  if (tab?.kind !== 'query' || tab.connectionId !== profile.id) return false;
  if (profile.dialect !== 'postgresql') return true;
  const context = resolveQueryDatabase(tab.database, tab.databaseContext, profile.database || 'postgres');
  return context.state === 'known' && context.database === database;
}
