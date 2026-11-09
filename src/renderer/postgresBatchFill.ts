import type { DataRow } from '../shared/contracts';
import { postgresTableLimits, type PostgresTableChange, type PostgresTableColumn, type PostgresTableField, type PostgresTablePage } from '../shared/postgresTable';
import { ownCell } from './lib';
import { postgresBatchFillZh as text } from './locales/postgresBatchFill.zh-CN';
import { postgresBatchEditableColumn, postgresBatchRows, postgresBatchValueEqual, postgresBatchValueValid } from './postgresBatchSelection';
import { postgresClipboardFieldValue } from './postgresGridPaste';
import { gridRangeFillZh as rangeText } from './locales/gridRangeFill.zh-CN';
import { gridRangeFillSource, type GridRangeFillDirection } from './gridRangeFill';
import type { GridRangeTarget } from './useGridCellRange';

/** 矩形只转换一次统一值，再交给既有的原行账本和批量字段校验。 */
export function postgresRangeFillChanges(page: PostgresTablePage, columns: readonly PostgresTableColumn[],
  start: number, count: number, value: string | null, prior: (key: string) => PostgresTableChange | undefined) {
  if (!Number.isInteger(start) || !Number.isInteger(count) || start < 0 || count < 1 || start + count > page.rows.length ||
      count > postgresTableLimits.changes) throw Error(rangeText.target);
  const fields = columns.map(column => {
    if (column.binary && value !== null) throw Error(rangeText.target);
    return { column: column.key, value: postgresClipboardFieldValue(value, column) };
  });
  const selected = new Set(Array.from({ length: count }, (_, index) => start + index));
  return postgresBatchFillChanges(page, columns, selected, fields, prior);
}

/** 来源优先取本地字段草稿，目的行继续按原主键及已保留的行版本暂存。 */
export function postgresRangeFillFromRow(page: PostgresTablePage, columns: readonly PostgresTableColumn[],
  range: GridRangeTarget<DataRow>, direction: GridRangeFillDirection, prior: (key: string) => PostgresTableChange | undefined) {
  const plan = gridRangeFillSource(range, direction, (_, index) => {
    const key = page.rowKeys?.[index];
    return !key || prior(key)?.kind === 'delete';
  });
  const source = prior(page.rowKeys![plan.sourceIndex]);
  const fields = columns.map(column => {
    const staged = source?.kind === 'update' ? source.fields.find(field => field.column === column.key)?.value : undefined;
    const value = staged ?? postgresClipboardFieldValue(ownCell(plan.source, column.key), column);
    if (value.mode === 'default') throw Error(rangeText.missing);
    return { column: column.key, value };
  });
  const selected = new Set(plan.rows.map((_, index) => plan.startRow + index));
  return postgresBatchFillChanges(page, columns, selected, fields, prior);
}

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
