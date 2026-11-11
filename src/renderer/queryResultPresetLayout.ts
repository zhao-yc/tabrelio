import type { QueryResult, ResultColumn } from '../shared/contracts';
import { queryResultPresetValueSchema, type QueryResultOrganization, type QueryResultPresetValue } from '../shared/queryResultPresets';
import { queryResultVisibleColumns, setQueryResultFrozenThrough, type QueryResultColumnLayout } from './queryResultColumns';
import { captureQueryResultMemory, queryResultColumnsMatch, queryResultMemoryMatches } from './queryResultMemory';
import { queryResultPresetsZh as text } from './locales/queryResultPresets.zh-CN';
import type { SortDialect } from './queryResultSort';

/** 在已返回结果上捕获布局与整理规则。保存隐藏列原顺序及已设置的宽度。 */
export function captureQueryResultPreset(source: QueryResult, visible: ResultColumn[], configuration: QueryResultOrganization, layout?: QueryResultColumnLayout, dialect?: SortDialect): QueryResultPresetValue {
  const memory = captureQueryResultMemory(source, visible, configuration, layout?.frozenThrough, dialect);
  const widths = [...(layout?.widths ?? [])].map(([key, width]) => ({ key, width }));
  return queryResultPresetValueSchema.parse({ ...memory, layout: {
    order: layout?.order ?? source.columns.map(column => column.key),
    ...(widths.length ? { widths } : {}), ...(layout?.rowHeight !== undefined ? { rowHeight: layout.rowHeight } : {}),
  } });
}

/** 新方案可恢复自己的投影。旧方案继续核对当前可见顺序和显隐。 */
export function queryResultPresetMatches(value: QueryResultPresetValue, source: QueryResult | undefined, visible: readonly ResultColumn[]): boolean {
  return value.layout ? !!source && queryResultColumnsMatch(value.columns, source.columns) : queryResultMemoryMatches(value, source, visible);
}

/** 保留相同投影的数组身份，让只有像素或冻结变化的方案仍沿用筛选、排序历史。 */
export function prepareQueryResultPresetLayout(value: QueryResultPresetValue, source: QueryResult, visible: ResultColumn[], previous?: QueryResultColumnLayout) {
  if (!queryResultPresetMatches(value, source, visible)) throw Error(text.mismatch);
  const saved = value.layout;
  const keys = source.columns.map(column => column.key);
  const layout = setQueryResultFrozenThrough(saved ? {
    order: [...saved.order], visible: value.visible.map(column => column.key),
    ...(saved.widths ? { widths: new Map(saved.widths.map(({ key, width }) => [key, width])) } : {}),
    ...(saved.rowHeight !== undefined ? { rowHeight: saved.rowHeight } : {}),
  } : previous ?? { order: keys, visible: keys }, value.frozenThrough);
  const projected = queryResultVisibleColumns(source.columns, layout);
  const columns = projected.length === visible.length && projected.every((column, index) => column === visible[index]) ? visible : projected;
  return { layout, columns };
}
