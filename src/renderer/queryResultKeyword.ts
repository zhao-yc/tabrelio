import type { DataRow, QueryResult, ResultColumn } from '../shared/contracts';
import { projectSqliteResultStorage } from '../shared/sqliteResultStorage';
import { queryResultKeywordZh as text } from './locales/queryResultKeyword.zh-CN';

export const queryResultKeywordLimits = { needle: 256, cells: 2_000_000, units: 8 * 1024 * 1024 } as const;

/** 在当前原快照建立命中集合，使条件和排序的后续变化无需重新扫描文本。 */
export function matchQueryResultKeyword(source: QueryResult, columns: readonly ResultColumn[], keyword: string): ReadonlySet<DataRow> {
  if (keyword.length > queryResultKeywordLimits.needle || source.rows.length * columns.length > queryResultKeywordLimits.cells) throw Error(text.budget);
  const needle = keyword.toLowerCase();
  const matches = new Set<DataRow>();
  let units = 0;
  const keys = columns.map(column => column.key);
  for (const row of source.rows) {
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(row, key);
      if (!descriptor || !('value' in descriptor)) throw Error(text.invalid);
      const value = descriptor.value;
      // 搜索完整原文和数值的显示文本，跳过 NULL 与字节，避免把预览或二进制转换当成字段值。
      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') continue;
      const raw = String(value);
      units += raw.length;
      if (units > queryResultKeywordLimits.units) throw Error(text.budget);
      const folded = raw.toLowerCase();
      units += folded.length;
      if (units > queryResultKeywordLimits.units) throw Error(text.budget);
      if (!folded.includes(needle)) continue;
      matches.add(row);
      break;
    }
  }
  return matches;
}

/** 在已整理行中保持顺序和原行引用，同步投影 SQLite 逐格存储类型。 */
export function projectQueryResultRows(result: QueryResult, indices: readonly number[]): QueryResult {
  const rows = indices.map(index => result.rows[index]);
  return Object.freeze({ ...result, rows: Object.freeze(rows) as QueryResult['rows'], ...projectSqliteResultStorage(result, indices) });
}

export function projectQueryResultKeyword(result: QueryResult, matches: ReadonlySet<DataRow>): QueryResult {
  const indices: number[] = [];
  result.rows.forEach((row, index) => { if (matches.has(row)) indices.push(index); });
  return projectQueryResultRows(result, indices);
}
