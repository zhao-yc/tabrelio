import type { ResultColumn } from '../shared/contracts';
import { postgresTableLimits, type PostgresTableChange, type PostgresTableColumn, type PostgresTableField, type PostgresTablePage } from '../shared/postgresTable';
import type { DraftRow } from './dataChanges';
import { ownCell } from './lib';
import type { PageTextPatch } from './pageFindReplace';
import { postgresTableFindZh as text } from './locales/postgresTableFind.zh-CN';

type Prior = (key: string) => PostgresTableChange | undefined;

/** 用本页原行和现有更新草稿构造查找视图，保留网格行索引；DEFAULT 还没有可查找的值。 */
export function postgresFindRows(page: PostgresTablePage, prior: Prior): DraftRow[] {
  return page.rows.map((row, index) => {
    const key = page.rowKeys?.[index];
    const change = key ? prior(key) : undefined;
    let data = row;
    if (change?.kind === 'update') {
      data = { ...row };
      for (const { column, value } of change.fields) {
        if (value.mode === 'text' || value.mode === 'null') data[column] = value.mode === 'null' ? null : value.value;
        else delete data[column];
      }
    }
    return { id: String(index), data, inserted: false, deleted: change?.kind === 'delete' };
  });
}

/** PostgreSQL 协议也将数字、日期等作为字符串传输，替换资格必须由目录类型确定。 */
export function postgresFindWritable(column: PostgresTableColumn): boolean {
  return !column.generated && !column.binary && /^(?:text|character(?: varying)?(?:\([1-9]\d*\))?)$/.test(column.type);
}

export interface PostgresFindPlan {
  changes: Extract<PostgresTableChange, { kind: 'update' }>[];
  patches: { row: number; column: ResultColumn; before: string; after: string }[];
}

/** 核对线程返回的原文及可写列，再把整批结果合并到现有更新草稿。 */
export function postgresFindPlan(page: PostgresTablePage, rows: readonly DraftRow[], columns: readonly PostgresTableColumn[],
  replacements: readonly PageTextPatch[], prior: Prior): PostgresFindPlan {
  if (!page.pageToken || !page.capabilities.update || rows.length !== page.rows.length) throw Error(text.stale);
  const byKey = new Map(columns.map(column => [column.key, column]));
  const grouped = new Map<number, Map<string, PostgresTableField>>();
  const patches: PostgresFindPlan['patches'] = [];
  let total = 0;
  for (const { rowId, key, before, after } of replacements) {
    const row = Number(rowId), column = byKey.get(key);
    if (!column || !page.columns.includes(column) || !postgresFindWritable(column) || rows[row]?.id !== rowId ||
        rows[row].deleted || ownCell(rows[row].data, key) !== before) throw Error(text.stale);
    if (/[\u0000\uD800-\uDFFF]/u.test(after)) throw Error(text.invalidValue);
    if (before === after) continue;
    total += 32 + after.length * 4;
    if (after.length > postgresTableLimits.value || total > postgresTableLimits.draft) throw Error(text.limit);
    const fields = grouped.get(row) ?? new Map<string, PostgresTableField>();
    if (fields.has(key)) throw Error(text.stale);
    fields.set(key, { column: key, value: { mode: 'text', value: after } });
    grouped.set(row, fields);
    patches.push({ row, column, before, after });
  }
  if (!grouped.size) throw Error(text.noChange);
  const changes: PostgresFindPlan['changes'] = [];
  for (const [row, fields] of grouped) {
    const key = page.rowKeys?.[row];
    if (!key) throw Error(text.stale);
    const previous = prior(key);
    if (previous?.kind === 'delete') throw Error(text.stale);
    const existing = previous?.kind === 'update' ? previous.fields.filter(field => !fields.has(field.column)) : [];
    changes.push({ kind: 'update', row, fields: [...existing, ...fields.values()] });
  }
  return { changes, patches };
}
