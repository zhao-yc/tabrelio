import { queryDatabasePatch } from '../shared/queryContext';
import { copyInsertSqlZh } from '../shared/copyInsertSql.zh-CN';
import { primaryKeyCopyZh as text } from './locales/primaryKeyCopy.zh-CN';
import { updateSqlCopyZh } from './locales/updateSqlCopy.zh-CN';
import { deleteSqlCopyZh } from './locales/deleteSqlCopy.zh-CN';
import { useWorkspace } from './store';

export type RowSqlKind = 'select' | 'insert' | 'update' | 'delete';
const titles = { select: text.queryTitle, insert: copyInsertSqlZh.queryTitle, update: updateSqlCopyZh.queryTitle, delete: deleteSqlCopyZh.queryTitle };

/** 只创建普通查询草稿。保留 SQL 的完整表名，仅缩短标签显示名。 */
export function openRowSqlDraft(
  target: { connectionId: string; database: string; table: string },
  kind: RowSqlKind,
  sql: string,
  openTab = useWorkspace.getState().openTab,
): void {
  if (useWorkspace.getState().settings.tabs.length >= 100) throw Error(text.tabs);
  let table = target.table.slice(0, 180);
  if (/[\uD800-\uDBFF]$/.test(table)) table = table.slice(0, -1);
  if (table.length !== target.table.length) table += '…';
  openTab({ kind: 'query', title: titles[kind](table), connectionId: target.connectionId,
    ...queryDatabasePatch({ state: 'known', database: target.database }), sql });
}
