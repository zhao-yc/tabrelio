import type { DataRow } from '../shared/contracts';
import { postgresTableLimits, type PostgresTableColumn, type PostgresTableField, type PostgresTablePage } from '../shared/postgresTable';
import type { PostgresDraftEntry } from '../shared/postgresTableDraft';
import { ownCell } from './lib';
import { postgresBatchFillZh as text } from './locales/postgresBatchFill.zh-CN';
import { assertPostgresBatchFillFields, postgresFilledFields } from './postgresBatchFill';
import { postgresBatchEditableColumn, postgresBatchRows } from './postgresBatchSelection';
import { postgresCheckedPageCurrent, type PostgresCheckedPage } from './postgresCheckedPages';

interface FillRow { readonly row: number; readonly rowKey: string; readonly original: DataRow }
export interface PostgresCheckedFillPage extends PostgresCheckedPage {
  readonly bytes: number;
  readonly columns: ReadonlySet<string>;
  readonly rows: readonly FillRow[];
}

/** 只保存勾选行的可填充字段原值。缓存总预算独立于最终写入字段的线路预算。 */
export const postgresCheckedFillBytes = 4 * postgresTableLimits.draft;

export function capturePostgresCheckedFill(page: PostgresTablePage, offset: number, visible: readonly PostgresTableColumn[],
  selected: ReadonlySet<number>, draft: readonly PostgresDraftEntry[], remaining = postgresCheckedFillBytes): PostgresCheckedFillPage {
  if (!page.writeExpiresAt || page.writeExpiresAt <= Date.now()) throw Error(text.pagesExpired);
  if (!page.capabilities.update) throw Error(text.rows);
  const prior = new Map(draft.map(entry => [entry.rowKey, entry.change]));
  const rows = postgresBatchRows(page, selected, key => prior.get(key));
  const columns = visible.filter(column => page.columns.includes(column) && postgresBatchEditableColumn(column) &&
    rows.every(row => ownCell(row.original, column.key) !== undefined));
  if (!columns.length) throw Error(text.fields);
  let bytes = 128;
  const data = rows.map(({ key: rowKey, index: row, original }) => {
    bytes += 128 + rowKey.length * 2;
    const values = Object.fromEntries(columns.map(({ key }) => {
      const value = ownCell(original, key)!;
      bytes += 64 + (key.length + (typeof value === 'string' ? value.length : value && typeof value === 'object' ? value.base64.length : 0)) * 2;
      if (bytes > remaining) throw Error(text.pagesBudget);
      return [key, value && typeof value === 'object' ? { ...value } : value];
    }));
    return { row, rowKey, original: values };
  });
  return { offset, token: page.pageToken!, valid: true, expiresAt: page.writeExpiresAt, columns: new Set(columns.map(column => column.key)), rows: data, bytes };
}

/** 重叠主键及已标记删除的目标拒绝整批。已有更新始终沿用首次编辑的令牌和版本。 */
export function planPostgresCheckedFill(pages: readonly PostgresCheckedFillPage[], columns: readonly PostgresTableColumn[],
  fields: readonly PostgresTableField[], draft: PostgresDraftEntry[]) {
  if (!pages.length || pages.some(page => !postgresCheckedPageCurrent(page))) throw Error(text.pagesExpired);
  assertPostgresBatchFillFields(columns.filter(column => pages.every(page => page.columns.has(column.key))), fields);
  const prior = new Map(draft.map(entry => [entry.rowKey, entry]));
  const seen = new Set<string>(), changed = new Map<string, PostgresDraftEntry>();
  for (const page of [...pages].sort((left, right) => left.offset - right.offset)) {
    for (const { row, rowKey, original } of page.rows) {
      if (seen.has(rowKey)) throw Error(text.pagesOverlap);
      seen.add(rowKey);
      const previous = prior.get(rowKey);
      if (previous?.change.kind === 'delete') throw Error(text.stale);
      const next = postgresFilledFields(original, fields, previous?.change);
      if (!next) continue;
      changed.set(rowKey, { rowKey, offset: previous?.offset ?? page.offset,
        change: { kind: 'update', row: previous?.change.kind === 'update' ? previous.change.row : row,
          pageToken: previous?.change.pageToken ?? page.token, fields: next } });
    }
  }
  return { count: changed.size, entries: changed.size ? [...draft.filter(entry => !entry.rowKey || !changed.has(entry.rowKey)), ...changed.values()] : draft };
}
