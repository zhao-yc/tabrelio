import type { NavigableStatement } from '../shared/statementNavigation';
import { writeTableClipboardEvent } from './gridClipboard';
import { statementNavigationZh as text } from './locales/statementNavigation.zh-CN';
import { statementDraftSql } from './queryDuplicateIntent';
import type { StatementNavigationController } from './statementNavigationController';
import { useWorkspace } from './store';

export type StatementSelectionDestination = 'clipboard' | 'query';

/** 剪贴板只从本次用户动作写纯文本，打开新查询继续使用原草稿租约。 */
export function extractStatementSelection(controller: StatementNavigationController, ranges: readonly NavigableStatement[],
  destination: StatementSelectionDestination, open: () => void): void {
  controller.extract(ranges, (source, dialect, current) => {
    if (destination === 'query') { open(); return; }
    try {
      const sql = statementDraftSql(source, ranges, dialect);
      writeTableClipboardEvent(current, data => data.setData('text/plain', sql));
      useWorkspace.getState().notify(text.copied(ranges.length));
    } catch { useWorkspace.getState().notify(current() ? text.copyUnavailable : text.reasons.stale, true); }
  });
}
