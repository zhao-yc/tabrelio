import type { QueryFileEncoding } from '../shared/contracts';
import { savedQueryOriginContext } from '../shared/queryBinding';
import type { NavigableStatement } from '../shared/statementNavigation';
import { writeTableClipboardEvent } from './gridClipboard';
import { errorMessage, invoke } from './lib';
import { statementNavigationZh as text } from './locales/statementNavigation.zh-CN';
import { statementDraftSql } from './queryDuplicateIntent';
import type { StatementNavigationController } from './statementNavigationController';
import { useWorkspace, type WorkspaceTab } from './store';

export type StatementSelectionDestination = 'clipboard' | 'query' | { encoding: QueryFileEncoding } | { libraryName: string };
export interface StatementQueryOutput { current(): boolean; libraryName?: string; }

/** 各输出共用本次目录签发的原文，生成脚本时保留语句顺序和客户端分隔符。 */
export function extractStatementSelection(controller: StatementNavigationController, ranges: readonly NavigableStatement[],
  destination: StatementSelectionDestination, open: (output: StatementQueryOutput) => void | Promise<void>): void | Promise<void> {
  const result = controller.extract(ranges, (source, dialect, current) => {
    if (destination === 'query') return open({ current });
    if (typeof destination === 'object' && 'libraryName' in destination) return open({ current, libraryName: destination.libraryName });
    if (typeof destination === 'object') return saveStatements(
      () => statementDraftSql(source, ranges, dialect), destination.encoding, current);
    try {
      const sql = statementDraftSql(source, ranges, dialect);
      writeTableClipboardEvent(current, data => data.setData('text/plain', sql));
      useWorkspace.getState().notify(text.copied(ranges.length));
    } catch { useWorkspace.getState().notify(current() ? text.copyUnavailable : text.reasons.stale, true); }
  });
  if (!result && typeof destination === 'object' && 'libraryName' in destination)
    return Promise.reject(Error(text.reasons.stale));
  return result;
}

/** 只新建查询库条目，不接管或修改原编辑器的文件与查询来源。 */
export async function saveStatementQuery(candidate: Omit<WorkspaceTab, 'id'>, name: string): Promise<void> {
  const context = savedQueryOriginContext(candidate.database, candidate.databaseContext);
  const saved = await invoke('queries.create', { name, connectionId: candidate.connectionId, sql: candidate.sql ?? '', context });
  useWorkspace.getState().notify(text.librarySaved(saved.name));
}

/** 原生选择器返回后仍需核对原目录。文件授权与写入沿用主进程的 SQL 保存边界。 */
async function saveStatements(read: () => string, encoding: QueryFileEncoding, current: () => boolean): Promise<void> {
  try {
    const sql = read();
    const selected = await invoke('files.choose', { purpose: 'export', format: 'sql', suggestedName: text.scriptFile });
    if (!selected) return;
    if (!current()) throw Error(text.reasons.stale);
    await invoke('files.writeQuery', { fileToken: selected.token, encoding, sql });
    useWorkspace.getState().notify(text.saved(selected.name));
  } catch (reason) { useWorkspace.getState().notify(errorMessage(reason), true); }
}
