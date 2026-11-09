import type { DataRow, FilterRule, ResultColumn } from '../shared/contracts';
import { postgresAdvancedTableFilterSchema } from '../shared/postgresTable';
import type { QueryResultCopyCell } from './queryResultHeaderCopy';
import { tableCellFilterZh as text } from './locales/tableCellFilter.zh-CN';
import { filterDraftFromRule } from './tableFilters';
import { orderedTableRange, tableCellBoundSymbols, type TableCellFilterMode } from './tableCellFilter';

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
  else if (mode === 'contains' || mode === 'notContains') {
    if (typeof value !== 'string' || !value || value.includes('\0') ||
        !/^(?:text|character varying|character|varchar|char)(?:\(\d+\))?$/i.test(column.type)) throw Error(text.unavailable);
    operator = mode === 'contains' ? 'CONTAINS' : 'NOT CONTAINS';
  } else {
    // format_type 返回目录声明，包括精度和时间类型的时区限定。
    if (!(typeof value === 'number' || typeof value === 'string' && value.length) ||
        !/^(?:smallint|integer|bigint|numeric(?:\(\d+,\s*-?\d+\))?|real|double precision|date|(?:time|timestamp)(?:\(\d+\))? (?:with|without) time zone)$/i.test(column.type)) throw Error(text.unavailable);
    operator = tableCellBoundSymbols[mode];
  }
  const rule: FilterRule = { column: column.name, operator, ...(value === null ? {} : { value: String(value) }) };
  postgresAdvancedTableFilterSchema.parse({ mode: 'all', rules: [rule] });
  return filterDraftFromRule(rule);
}

/** PostgreSQL 数值按原文本精确比较；无时区时序走现有原字段比较器。 */
export function postgresTableRangeFilterDraft(first: QueryResultCopyCell, last: QueryResultCopyCell, columns: readonly ResultColumn[], rows: readonly DataRow[]) {
  const left = postgresTableCellFilterDraft(first, columns, rows, 'gte');
  const right = postgresTableCellFilterDraft(last, columns, rows, 'gte');
  const column = first.column!;
  if (column !== last.column) throw Error(text.unavailable);
  const declared = column.type.toUpperCase();
  const temporal = /^(DATE|TIME|TIMESTAMP)(?:\(\d+\))?(?: WITHOUT TIME ZONE)?$/.exec(declared);
  const type = temporal ? temporal[1] : declared.replace(/\(\d+,\s*-?\d+\)$/, '');
  // 避免推断不同偏移、日期显示格式和超出本地比较范围的时间值。
  if (!temporal && !/^(SMALLINT|INTEGER|BIGINT|NUMERIC|REAL|DOUBLE PRECISION)$/.test(type)) throw Error(text.unavailable);
  const [value, upperValue] = orderedTableRange({ ...column, type: type === 'TIMESTAMP' && temporal ? 'DATETIME' : type },
    left.value, right.value, temporal ? undefined : 'postgresql');
  return { ...left, operator: 'BETWEEN' as const, value, upperValue };
}
