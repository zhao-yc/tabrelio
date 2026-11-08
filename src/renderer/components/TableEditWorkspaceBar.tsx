import { tableCheckedPageRows, type TableEditPage } from '../tableEditWorkspace';
import { tableEditWorkspaceZh as text } from '../locales/tableEditWorkspace.zh-CN';
/** 页号及勾选统计使用原缓存；恢复文件时只提供原草稿分组操作。 */
export function TableEditWorkspaceBar({ pages, current, selected, changes, stale, disabled, restored = false, onSelect, onDiscard, onDeleteChecked, onFillChecked, onDuplicateChecked, onEditChecked }: { pages: readonly TableEditPage[]; current?: TableEditPage; selected: ReadonlySet<string>; changes: number; stale: boolean; disabled: boolean; restored?: boolean; onSelect(page: TableEditPage): void; onDiscard(page: TableEditPage): void; onDeleteChecked?(): void; onFillChecked?(): void; onDuplicateChecked?(): void; onEditChecked?(): void }) {
  if (pages.length < 2 && !changes && !pages.some(page => page.history.status.undo || page.history.status.redo)) return null;
  const counts = pages.map(page => ({ page, count: restored ? 0 : tableCheckedPageRows(page, current, selected).length }));
  return <section className="info-strip" role="region" aria-label={text.region}>
    <p>{text.summary(pages.length, changes)}</p>
    <p className="muted small">{stale ? text.stale : restored ? text.restoredHint : text.hint}</p>
    <div className="query-row-details-actions">{counts.map(({ page, count }) => <span key={page.index}>
      <button aria-label={text.page(page.index)} aria-current={page === current ? 'page' : undefined} disabled={disabled || stale || page === current} onClick={() => onSelect(page)}>{page.index}{count > 0 && ' · ' + text.checked(count)}</button>
      <button aria-label={text.discard(page.index)} disabled={disabled} onClick={() => onDiscard(page)}>×</button>
    </span>)}
    {!restored && counts.some(({ page, count }) => page !== current && count > 0) && <>
      <button type="button" disabled={disabled || stale || !onEditChecked} onClick={onEditChecked}>{text.recordEditChecked}</button>
      <button type="button" disabled={disabled || stale || !onFillChecked} onClick={onFillChecked}>{text.fillChecked}</button>
      <button type="button" disabled={disabled || stale || !onDuplicateChecked} onClick={onDuplicateChecked}>{text.duplicateChecked}</button>
      <button type="button" disabled={disabled || stale || !onDeleteChecked} onClick={onDeleteChecked}>{text.deleteChecked}</button>
    </>}</div>
  </section>;
}
