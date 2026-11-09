import type { DataRow, FilterRule, ResultColumn } from '../shared/contracts';
import { postgresAdvancedTableFilterSchema } from '../shared/postgresTable';
import type { QueryResultCopyCell } from './queryResultHeaderCopy';
import { tableCellFilterZh as text } from './locales/tableCellFilter.zh-CN';
import { filterDraftFromRule } from './tableFilters';
import { isTableCellTextMode, orderedTableRange, tableCellBoundSymbols, tableCellTextSymbols, type TableCellFilterMode } from './tableCellFilter';
import { isPostgresResultIdentifierType } from './postgresResultIdentifier';
import { queryResultFilterKey } from './queryResultSort';

/** 将新接入的有序类型映射到协议名。interval 目录声明可包含精度及字段范围。 */
export function postgresTableSpecialOrderedType(type: string) {
  const declared = type.toUpperCase();
  if (isPostgresResultIdentifierType(declared)) return declared;
  if (/^INTERVAL(?:\([0-6]\)| (?:YEAR(?: TO MONTH)?|MONTH|DAY(?: TO (?:HOUR|MINUTE|SECOND))?|HOUR(?: TO (?:MINUTE|SECOND))?|MINUTE(?: TO SECOND)?|SECOND)(?:\([0-6]\))?)?$/.test(declared)) return 'INTERVAL';
}

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
  else if (isTableCellTextMode(mode)) {
    if (typeof value !== 'string' || !value || value.includes('\0') ||
        !/^(?:text|character varying|character|varchar|char)(?:\(\d+\))?$/i.test(column.type)) throw Error(text.unavailable);
    operator = tableCellTextSymbols[mode];
  } else {
    // format_type 返回目录声明，包括精度和时间类型的时区限定。
    const type = postgresTableSpecialOrderedType(column.type);
    if (type) {
      if (typeof value !== 'string') throw Error(text.unavailable);
      queryResultFilterKey({ ...column, type }, value, 'postgresql');
    } else if (!(typeof value === 'number' || typeof value === 'string' && value.length) ||
        !/^(?:smallint|integer|bigint|numeric(?:\(\d+,\s*-?\d+\))?|real|double precision|date|(?:time|timestamp)(?:\(\d+\))? (?:with|without) time zone)$/i.test(column.type)) throw Error(text.unavailable);
    operator = tableCellBoundSymbols[mode];
  }
  const rule: FilterRule = { column: column.name, operator, ...(value === null ? {} : { value: String(value) }) };
  postgresAdvancedTableFilterSchema.parse({ mode: 'all', rules: [rule] });
  return filterDraftFromRule(rule);
}

/** 将目录声明映射到协议类型，复用查询结果的精确端点比较。 */
export function postgresTableRangeFilterDraft(first: QueryResultCopyCell, last: QueryResultCopyCell, columns: readonly ResultColumn[], rows: readonly DataRow[]) {
  const left = postgresTableCellFilterDraft(first, columns, rows, 'gte');
  const right = postgresTableCellFilterDraft(last, columns, rows, 'gte');
  const column = first.column!;
  if (column !== last.column) throw Error(text.unavailable);
  const declared = column.type.toUpperCase();
  const temporal = /^(TIME|TIMESTAMP)(?:\(\d+\))? (WITH|WITHOUT) TIME ZONE$/.exec(declared);
  const type = postgresTableSpecialOrderedType(declared) ?? (temporal
    ? temporal[2] === 'WITH' ? temporal[1] + 'TZ' : temporal[1] : declared.replace(/\(\d+,\s*-?\d+\)$/, ''));
  const [value, upperValue] = orderedTableRange({ ...column, type }, left.value, right.value, 'postgresql');
  return { ...left, operator: 'BETWEEN' as const, value, upperValue };
}
