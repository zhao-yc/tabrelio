import type { DataRow } from '../shared/contracts';
import { postgresTableLimits, type PostgresTableColumn, type PostgresTableField, type PostgresTablePage } from '../shared/postgresTable';
import type { PostgresDraftEntry } from '../shared/postgresTableDraft';
import { ownCell } from './lib';
import type { PostgresBatchEditInput } from './postgresBatchEdit';
import type { PostgresBatchRow } from './postgresBatchSelection';
import { postgresDuplicateFields, postgresDuplicateInput } from './postgresRecordDuplicate';
import { postgresCheckedPageCurrent, type PostgresCheckedPage } from './postgresCheckedPages';
import { postgresBatchDuplicateZh as text } from './locales/postgresBatchDuplicate.zh-CN';

interface CopyRow { index: number; key: string; draftKey?: string; original: DataRow }
export interface PostgresCheckedDuplicatePage extends PostgresCheckedPage {
  readonly bytes: number;
  readonly rows: readonly CopyRow[];
}
export const postgresCheckedDuplicateBytes = 4 * postgresTableLimits.draft;

/** 只捕获勾选原行的副本字段及主键显示值，后台页不保留完整结果。 */
export function capturePostgresCheckedDuplicate(page: PostgresTablePage, offset: number, selected: ReadonlySet<number>,
  remaining = postgresCheckedDuplicateBytes): PostgresCheckedDuplicatePage {
  if (!page.writeExpiresAt || page.writeExpiresAt <= Date.now()) throw Error(text.pagesExpired);
  if (!page.pageToken || !page.capabilities.insert || page.truncated || !selected.size || selected.size > postgresTableLimits.changes) throw Error(text.stale);
  const columns = page.columns.filter(column => column.primary || !column.generated && !column.sequenceDefault);
  const keys = new Set<string>();
  let bytes = 128;
  const rows = [...selected].sort((left, right) => left - right).map(index => {
    const key = page.copyRowKeys?.[index], original = page.rows[index];
    if (!Number.isSafeInteger(index) || !original || !key) throw Error(text.noSource);
    if (keys.has(key)) throw Error(text.pagesOverlap);
    keys.add(key);
    bytes += 128 + key.length * 2;
    if (bytes > remaining) throw Error(text.pagesBudget);
    const values = Object.fromEntries(columns.map(column => {
      const value = ownCell(original, column.key);
      if (value === undefined) throw Error(text.noSource);
      bytes += 64 + (column.key.length + (typeof value === 'string' ? value.length : value && typeof value === 'object' ? value.base64.length : 0)) * 2;
      if (bytes > remaining) throw Error(text.pagesBudget);
      return [column.key, value && typeof value === 'object' ? { ...value } : value];
    }));
    return { index, key, draftKey: page.rowKeys?.[index], original: values };
  });
  return { offset, token: page.pageToken, valid: true, expiresAt: page.writeExpiresAt, bytes, rows };
}

/** 编辑窗口索引按整批生成。同名页内索引不会把某个副本的字段写给另一页。 */
export function planPostgresCheckedDuplicate(pages: readonly PostgresCheckedDuplicatePage[], columns: readonly PostgresTableColumn[],
  draft: readonly PostgresDraftEntry[], pageSize: number) {
  if (!pages.length || pages.some(page => !postgresCheckedPageCurrent(page))) throw Error(text.pagesExpired);
  const prior = new Map(draft.map(entry => [entry.rowKey, entry.change])), keys = new Set<string>();
  const ordered = [...pages].sort((left, right) => left.offset - right.offset);
  const targets = ordered.flatMap(page => page.rows.map(row => ({ page, row })));
  if (!targets.length || targets.length > postgresTableLimits.changes) throw Error(text.rowsLimit);
  const initial = new Map<number, Map<string, PostgresTableField['value']>>();
  const positions: { page: number; row: number }[] = [];
  const rows: PostgresBatchRow[] = targets.map(({ page, row }, index) => {
    if (keys.has(row.key)) throw Error(text.pagesOverlap);
    keys.add(row.key);
    const previous = row.draftKey ? prior.get(row.draftKey) : undefined;
    if (previous?.kind === 'delete') throw Error(text.stale);
    const planned = postgresDuplicateFields(columns, row.original, previous);
    initial.set(index, new Map(planned.fields.map(field => [field.column, field.value])));
    positions.push({ page: Math.floor(page.offset / pageSize) + 1, row: row.index + 1 });
    return { index, key: row.key, original: row.original, previous: undefined };
  });
  const omitted = columns.filter(column => column.generated || column.sequenceDefault).map(column => column.name);
  const writable = new Map(columns.filter(column => !column.generated).map(column => [column.key, column]));
  return {
    rows, initial, omitted, positions,
    groups: ordered.map(page => ({ index: Math.floor(page.offset / pageSize) + 1, count: page.rows.length })),
    entries(inputs: PostgresBatchEditInput): PostgresDraftEntry[] {
      if (pages.some(page => !postgresCheckedPageCurrent(page))) throw Error(text.pagesExpired);
      if ([...inputs.keys()].some(index => !initial.has(index))) throw Error(text.stale);
      return [...draft, ...targets.map(({ page }, index): PostgresDraftEntry => ({
        offset: page.offset, change: { kind: 'insert', pageToken: page.token, fields: postgresDuplicateInput(writable, inputs.get(index) ?? initial.get(index)!) },
      }))];
    },
  };
}
