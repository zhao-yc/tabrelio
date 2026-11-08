import { postgresTableLimits, type PostgresTableColumn } from '../shared/postgresTable';
import type { PostgresDraftEntry } from '../shared/postgresTableDraft';
import { postgresBatchEditZh as text } from './locales/postgresBatchEdit.zh-CN';
import { postgresBatchEditedFields, type PostgresBatchEditInput } from './postgresBatchEdit';
import { postgresBatchEditableColumn, type PostgresBatchRow } from './postgresBatchSelection';
import type { PostgresCheckedFillPage } from './postgresCheckedFill';
import { postgresCheckedPageCurrent } from './postgresCheckedPages';

/** 窗口编号独立于页内行号，确认时按目标原页或首次暂存的令牌写入草稿。 */
export function planPostgresCheckedEdit(pages: readonly PostgresCheckedFillPage[], columns: readonly PostgresTableColumn[],
  draft: PostgresDraftEntry[], pageSize: number) {
  const check = () => {
    if (!pages.length || pages.some(page => !postgresCheckedPageCurrent(page))) throw Error(text.pagesExpired);
  };
  check();
  const prior = new Map(draft.map(entry => [entry.rowKey, entry]));
  const seen = new Set<string>();
  const ordered = [...pages].sort((left, right) => left.offset - right.offset);
  const targets = ordered.flatMap(page => page.rows.map(row => ({ page, row })));
  if (!targets.length || targets.length > postgresTableLimits.changes) throw Error(text.stale);
  const positions: { page: number; row: number }[] = [];
  const rows: PostgresBatchRow[] = targets.map(({ page, row }, index) => {
    if (seen.has(row.rowKey)) throw Error(text.pagesOverlap);
    seen.add(row.rowKey);
    const previous = prior.get(row.rowKey)?.change;
    if (previous?.kind === 'delete') throw Error(text.stale);
    positions.push({ page: Math.floor(page.offset / pageSize) + 1, row: row.row + 1 });
    return { index, key: row.rowKey, original: row.original, previous };
  });
  const writable = new Map(columns.filter(column => postgresBatchEditableColumn(column) &&
    pages.every(page => page.columns.has(column.key))).map(column => [column.key, column]));
  return {
    rows, positions,
    groups: ordered.map(page => ({ index: Math.floor(page.offset / pageSize) + 1, count: page.rows.length })),
    entries(inputs: PostgresBatchEditInput) {
      check();
      const changed = new Map<string, PostgresDraftEntry | undefined>();
      for (const [index, values] of [...inputs].sort(([left], [right]) => left - right)) {
        const target = targets[index], row = rows[index];
        if (!target || !row) throw Error(text.stale);
        const fields = postgresBatchEditedFields(writable, row.original, values, row.previous);
        if (!fields) continue;
        const previous = prior.get(row.key);
        const originalUpdate = previous?.change.kind === 'update' ? previous.change : undefined;
        changed.set(row.key, fields.length ? {
          rowKey: row.key, offset: previous?.offset ?? target.page.offset,
          change: { kind: 'update', row: originalUpdate?.row ?? target.row.row,
            pageToken: originalUpdate?.pageToken ?? target.page.token, fields },
        } : undefined);
      }
      return { count: changed.size, entries: changed.size
        ? [...draft.filter(entry => !entry.rowKey || !changed.has(entry.rowKey)), ...[...changed.values()].filter(entry => entry !== undefined)]
        : draft };
    },
  };
}
