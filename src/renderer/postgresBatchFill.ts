import type { DataRow } from '../shared/contracts';
import { postgresTableLimits, type PostgresTableChange, type PostgresTableColumn, type PostgresTableField, type PostgresTablePage } from '../shared/postgresTable';
import { ownCell } from './lib';
import { postgresBatchFillZh as text } from './locales/postgresBatchFill.zh-CN';
import { postgresBatchEditableColumn, postgresBatchRows, postgresBatchValueEqual, postgresBatchValueValid } from './postgresBatchSelection';

/** 以明确的勾选行、原行键和可见列构造整批草稿。其它字段及已暂存行版本由原工作区保留。 */
export function postgresBatchFillChanges(page: PostgresTablePage, visible: readonly PostgresTableColumn[],
  selected: ReadonlySet<number>, fields: readonly PostgresTableField[], prior: (key: string) => PostgresTableChange | undefined): PostgresTableChange[] {
  if (!page.capabilities.update) throw Error(text.rows);
  const rows = postgresBatchRows(page, selected, prior);
  assertPostgresBatchFillFields(visible.filter(column => page.columns.includes(column)), fields);
  return rows.flatMap(({ index: row, original, previous }) => {
    const next = postgresFilledFields(original, fields, previous);
    return next ? [{ kind: 'update', row, fields: next }] : [];
  });
}

export function assertPostgresBatchFillFields(columns: readonly PostgresTableColumn[], fields: readonly PostgresTableField[]): void {
  const seen = new Set<string>();
  if (!fields.length || fields.length > postgresTableLimits.fields) throw Error(text.fields);
  for (const { column: key, value } of fields) {
    const column = columns.find(item => item.key === key);
    if (!column || !postgresBatchEditableColumn(column) || seen.has(key)) throw Error(text.fields);
    if (!postgresBatchValueValid(column, value)) throw Error(text.invalid);
    seen.add(key);
  }
}

/** 以原始数据和已有草稿计算实际变更，无改动不生成新的历史步骤。 */
export function postgresFilledFields(original: DataRow, fields: readonly PostgresTableField[], previous?: PostgresTableChange): PostgresTableField[] | undefined {
  const previousFields = previous?.kind === 'update' ? previous.fields : [];
  const changed = fields.filter(field => {
    const raw = ownCell(original, field.column);
    if (raw === undefined) throw Error(text.rows);
    return !postgresBatchValueEqual(field.value, previousFields.find(item => item.column === field.column)?.value, raw);
  });
  if (!changed.length) return;
  const replaced = new Set(changed.map(field => field.column));
  return [...previousFields.filter(field => !replaced.has(field.column)), ...changed];
}
