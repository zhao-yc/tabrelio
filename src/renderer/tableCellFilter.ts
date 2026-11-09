import type { ColumnInfo, ResultColumn } from '../shared/contracts';
import type { DraftRow } from './dataChanges';
import { emptyFilterDraft, filterRuleFromDraft, type FilterDraft } from './tableFilters';
import { tableCellFilterZh as text } from './locales/tableCellFilter.zh-CN';
import { cellBoundOperators } from './queryResultCellFilter';
import { compareQueryResultFilterKeys, queryResultFilterKey, queryResultFilterLiteral, type SortDialect } from './queryResultSort';
import { queryResultFilterZh } from './locales/queryResultFilter.zh-CN';

export const tableCellTextSymbols = {
  contains: 'CONTAINS', notContains: 'NOT CONTAINS',
  startsWith: 'STARTS WITH', notStartsWith: 'NOT STARTS WITH',
  endsWith: 'ENDS WITH', notEndsWith: 'NOT ENDS WITH',
} as const;
type TableCellTextMode = keyof typeof tableCellTextSymbols;
export type TableCellFilterMode = boolean | TableCellTextMode | typeof cellBoundOperators[number];
export const tableCellTextActions = (Object.keys(tableCellTextSymbols) as TableCellTextMode[]).map(mode => [mode, text[mode]] as const);
export function isTableCellTextMode(mode: Exclude<TableCellFilterMode, boolean>): mode is TableCellTextMode {
  return Object.hasOwn(tableCellTextSymbols, mode);
}
export const tableCellBoundSymbols = { lt: '<', lte: '<=', gt: '>', gte: '>=' } as const;
export const tableCellBoundActions = cellBoundOperators.map(mode => [mode, queryResultFilterZh.cellBounds[mode]] as const);

/** 只复制已加载原格的标量；不读getter、不把二进制当文本、不把精确字符串转为数值。 */
export function tableCellFilterDraft(columns: readonly ColumnInfo[], rows: readonly DraftRow[], visible: readonly string[], selection: { rowId: string; key: string } | undefined, mode: TableCellFilterMode = false): FilterDraft {
  if (!selection || !visible.includes(selection.key)) throw Error(text.unavailable);
  const fields = columns.filter(column => column.name === selection.key);
  if (fields.length !== 1) throw Error(text.unavailable);
  const matches = rows.filter(row => row.id === selection.rowId), row = matches.length === 1 ? matches[0] : undefined;
  if (!row || row.inserted || row.deleted || !row.original) throw Error(text.unavailable);
  const value = Object.getOwnPropertyDescriptor(row.data, selection.key), original = Object.getOwnPropertyDescriptor(row.original, selection.key);
  if (!value || !original || !('value' in value) || !('value' in original) || !Object.is(value.value, original.value)) throw Error(text.unavailable);
  const cell: unknown = value.value;
  if (cell !== null && typeof cell !== 'string' && typeof cell !== 'boolean' && typeof cell !== 'number' || typeof cell === 'number' && (!Number.isFinite(cell) || Number.isInteger(cell) && !Number.isSafeInteger(cell))) throw Error(text.unavailable);
  let operator: FilterDraft['operator'];
  if (typeof mode === 'boolean') operator = cell === null ? mode ? 'IS NOT NULL' : 'IS NULL' : mode ? '!=' : '=';
  else if (isTableCellTextMode(mode)) {
    if (typeof cell !== 'string' || !cell || !/^(?:CHAR|VARCHAR|TINYTEXT|TEXT|MEDIUMTEXT|LONGTEXT)\b/i.test(fields[0].type)) throw Error(text.unavailable);
    operator = tableCellTextSymbols[mode];
  } else {
    // 数字外观不能证明字段支持有序比较。只认可实际数值和日期时间声明。
    if (!(typeof cell === 'number' || typeof cell === 'string' && cell.length) ||
        !/^(?:TINYINT|SMALLINT|MEDIUMINT|INT|INTEGER|BIGINT|DECIMAL|NUMERIC|FIXED|FLOAT|DOUBLE|REAL|YEAR|DATE|DATETIME|TIMESTAMP|TIME)\b/i.test(fields[0].type)) throw Error(text.unavailable);
    operator = tableCellBoundSymbols[mode];
  }
  const draft: FilterDraft = { ...emptyFilterDraft(selection.key), operator, value: cell === null ? '' : typeof cell === 'boolean' ? cell ? '1' : '0' : String(cell) };
  // 复用正式手工条件的单值预算及字段准入；这里不修改既有条件、不创建SQL。
  filterRuleFromDraft(draft, columns.map(column => column.name));
  return draft;
}

/** 仅用解析后的键排列端点；最终提交给服务器的参数仍是完整原文。 */
export function orderedTableRange(column: ResultColumn, left: string, right: string, dialect?: SortDialect): [string, string] {
  const key = (value: string) => queryResultFilterKey(column, queryResultFilterLiteral(column, value, dialect), dialect);
  return compareQueryResultFilterKeys(key(left), key(right)) > 0 ? [right, left] : [left, right];
}

/** 表格的原列声明与结果协议类型写法不同，先归一已认可的数值和时序类型。 */
export function tableRangeFilterDraft(columns: readonly ColumnInfo[], rows: readonly DraftRow[], visible: readonly string[], key: string, first: DraftRow, last: DraftRow): FilterDraft {
  const seed = (row: DraftRow) => tableCellFilterDraft(columns, rows, visible, { rowId: row.id, key }, 'gte');
  const left = seed(first), right = seed(last);
  const declared = columns.find(column => column.name === key)!.type;
  const base = /^[a-z]+/i.exec(declared)?.[0].toUpperCase();
  const type = base === 'FIXED' ? 'DECIMAL' : base === 'REAL' ? 'DOUBLE' : base!;
  const [value, upperValue] = orderedTableRange({ key, name: key, type }, left.value, right.value);
  return { ...left, operator: 'BETWEEN', value, upperValue };
}
