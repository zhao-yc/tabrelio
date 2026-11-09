import type { QueryFileEncoding } from '../shared/contracts';
import type { NavigableStatement } from '../shared/statementNavigation';
import { writeTableClipboardEvent } from './gridClipboard';
import { errorMessage, invoke } from './lib';
import { statementNavigationZh as text } from './locales/statementNavigation.zh-CN';
import { statementDraftSql } from './queryDuplicateIntent';
import type { StatementNavigationController } from './statementNavigationController';
import { useWorkspace } from './store';

export type StatementSelectionDestination = 'clipboard' | 'query' | { encoding: QueryFileEncoding };

/** 三种输出共用本次目录签发的原文，生成脚本时保留语句顺序和客户端分隔符。 */
export function extractStatementSelection(controller: StatementNavigationController, ranges: readonly NavigableStatement[],
  destination: StatementSelectionDestination, open: () => void): void | Promise<void> {
  return controller.extract(ranges, (source, dialect, current) => {
    if (destination === 'query') { open(); return; }
    if (typeof destination === 'object') return saveStatements(
      () => statementDraftSql(source, ranges, dialect), destination.encoding, current);
    try {
      const sql = statementDraftSql(source, ranges, dialect);
      writeTableClipboardEvent(current, data => data.setData('text/plain', sql));
      useWorkspace.getState().notify(text.copied(ranges.length));
    } catch { useWorkspace.getState().notify(current() ? text.copyUnavailable : text.reasons.stale, true); }
  });
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
