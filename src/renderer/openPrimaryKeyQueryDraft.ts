import { queryDatabasePatch } from '../shared/queryContext';
import { primaryKeyCopyZh as text } from './locales/primaryKeyCopy.zh-CN';
import { useWorkspace } from './store';

/** 只创建普通查询草稿。保留 SQL 的完整表名，仅缩短标签显示名。 */
export function openPrimaryKeyQueryDraft(
  target: { connectionId: string; database: string; table: string },
  sql: string,
  openTab = useWorkspace.getState().openTab,
): void {
  if (useWorkspace.getState().settings.tabs.length >= 100) throw Error(text.tabs);
  let table = target.table.slice(0, 180);
  if (/[\uD800-\uDBFF]$/.test(table)) table = table.slice(0, -1);
  if (table.length !== target.table.length) table += '…';
  openTab({ kind: 'query', title: text.queryTitle(table), connectionId: target.connectionId,
    ...queryDatabasePatch({ state: 'known', database: target.database }), sql });
}
