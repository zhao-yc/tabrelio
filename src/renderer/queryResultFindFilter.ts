import type { QueryResult, ResultColumn } from '../shared/contracts';
import { queryResultFilterOperators, type QueryResultFilterRule } from './queryResultFilter';
import { queryResultFindLimits, type QueryResultFindMode } from './queryResultFind';
import type { SortDialect } from './queryResultSort';

/** MySQL 的 TEXT 和字节列可能共用 BLOB 类型号。只用完整返回结果的实际表示确认文字列。 */
export function queryResultFindTextFilterable(column: ResultColumn | undefined, source: QueryResult | undefined, dialect?: SortDialect): boolean {
  if (!column || !source || !queryResultFilterOperators(column, undefined, dialect).includes('empty')) return false;
  if (column.type === 'SQLITE') return !!source.sqliteStorage;
  for (const row of source.rows) {
    const field = Object.getOwnPropertyDescriptor(row, column.key);
    if (!field || !('value' in field) || field.value !== null && typeof field.value !== 'string') return false;
  }
  return true;
}

/** 只带入可审阅的单列原值条件。显示预览和大小写折叠的匹配不转换为筛选。 */
export function queryResultFindFilterRule(
  column: ResultColumn | undefined, mode: QueryResultFindMode, query: string, caseSensitive: boolean,
  textFilterable: boolean,
): QueryResultFilterRule | undefined {
  if (!column || mode === 'regex') return;
  if (mode === 'null') return { column: column.key, operator: 'null', value: '' };

  if (!textFilterable) return;
  if (mode !== 'empty' && (!caseSensitive || !query || query.length > queryResultFindLimits.queryUnits || /\p{Surrogate}/u.test(query))) return;

  return {
    column: column.key, operator: mode === 'whole' ? 'eq' : mode, value: mode === 'empty' ? '' : query,
    ...(column.type === 'SQLITE' ? { sqliteType: 'text' as const } : {}),
  };
}
