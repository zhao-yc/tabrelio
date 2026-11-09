import type { DataRow, FilterRule, ResultColumn } from '../shared/contracts';
import { postgresAdvancedTableFilterSchema } from '../shared/postgresTable';
import type { QueryResultCopyCell } from './queryResultHeaderCopy';
import { tableCellFilterZh as text } from './locales/tableCellFilter.zh-CN';
import { filterDraftFromRule } from './tableFilters';
import type { TableCellFilterMode } from './tableCellFilter';

/** 只取当前页原格的自有标量，列名和值走正式高级筛选合同。 */
export function postgresTableCellFilterDraft(cell: QueryResultCopyCell, columns: readonly ResultColumn[], rows: readonly DataRow[], mode: TableCellFilterMode = false) {
  const { column, row, index } = cell;
  if (!column || !columns.includes(column) || !Number.isSafeInteger(index) || index < 0 || rows[index] !== row) throw Error(text.unavailable);
  const field = Object.getOwnPropertyDescriptor(row, column.key);
  if (!field || !('value' in field)) throw Error(text.unavailable);
  const value: unknown = field.value;
  const scalar = typeof value === 'string' || typeof value === 'boolean' ||
    typeof value === 'number' && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value));
  if (value !== null && !scalar) throw Error(text.unavailable);
  let operator: FilterRule['operator'];
  if (typeof mode === 'boolean') operator = value === null ? mode ? 'IS NOT NULL' : 'IS NULL' : mode ? '!=' : '=';
  else {
    if (typeof value !== 'string' || !value || value.includes('\0') ||
        !/^(?:text|character varying|character|varchar|char)(?:\(\d+\))?$/i.test(column.type)) throw Error(text.unavailable);
    operator = mode === 'contains' ? 'CONTAINS' : 'NOT CONTAINS';
  }
  const rule: FilterRule = { column: column.name, operator, ...(value === null ? {} : { value: String(value) }) };
  postgresAdvancedTableFilterSchema.parse({ mode: 'all', rules: [rule] });
  return filterDraftFromRule(rule);
}
