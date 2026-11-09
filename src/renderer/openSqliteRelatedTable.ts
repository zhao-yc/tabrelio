import type { SqliteIncomingOutput } from '../shared/sqliteIncoming';
import { sqliteRelatedTabPrefix } from '../shared/sqliteRelatedTab';
import { uid } from './lib';
import { sqliteRelatedTableZh as text } from './locales/sqliteRelatedTable.zh-CN';
import { registerSqliteRelatedTable, sqliteRelatedTableRelation, sqliteRelatedTargetGuard, watchSqliteRelatedScope } from './sqliteRelatedTable';
import { useWorkspace } from './store';

/** 只把已读取子页的固定外键范围交给新标签，新标签与原查询或表页各自关闭。 */
export function openSqliteRelatedTable(output: SqliteIncomingOutput, { connectionId, profile, version }: {
  connectionId: string; profile: unknown; version: number;
}): void {
  const workspace = useWorkspace.getState(), input = output.request;
  if (input.incoming !== 'page' || input.connectionId !== connectionId) throw Error(text.expired);
  if (workspace.settings.tabs.length >= 100) throw Error(text.tabsFull);
  const relation = sqliteRelatedTableRelation(output), id = sqliteRelatedTabPrefix + uid(), table = input.childTable;
  const scope = registerSqliteRelatedTable(id, relation, sqliteRelatedTargetGuard(useWorkspace.getState, { id, connectionId, table, profile, version }));
  try {
    workspace.openTab({ id, kind: 'table', title: text.title(table), connectionId, database: 'main', table });
    watchSqliteRelatedScope(scope, useWorkspace.subscribe);
    if (!scope.current()) throw Error(text.expired);
  } catch (failure) { scope.invalidate(); throw failure; }
}
