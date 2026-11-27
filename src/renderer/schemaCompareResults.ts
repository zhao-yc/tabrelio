import { schemaCompareLimits, type SchemaCompareCategory, type SchemaCompareDifference, type SchemaCompareResult, type SchemaCompareStatus } from '../shared/schemaCompare';

export interface SchemaCompareResultsFilter {
  category: 'all' | SchemaCompareCategory;
  status: 'differences' | 'all' | SchemaCompareStatus;
  name: string;
}
export const defaultSchemaCompareResultsFilter: SchemaCompareResultsFilter = { category: 'all', status: 'differences', name: '' };
export type SchemaCompareResultsSelection = { snapshotId: string } & (
  | { kind: 'toggle'; id: string; checked: boolean }
  | { kind: 'selectVisible'; ids: readonly string[] }
  | { kind: 'clearVisible'; ids: readonly string[] }
  | { kind: 'clearHidden'; ids: readonly string[] }
);

/** 类别和原始名称共同标识差异；搜索大小写归一不影响选择身份。 */
export function schemaCompareResultsId(row: Pick<SchemaCompareDifference, 'category' | 'name'>): string {
  return JSON.stringify([row.category, row.name]);
}

/** 只投影当前报告，不排序或修改输入；名称为普通子串，绝不解释为正则或 SQL。 */
export function projectSchemaCompareResults(report: SchemaCompareResult, filter: SchemaCompareResultsFilter, selectedIds: readonly string[]) {
  const name = filter.name.toLowerCase();
  const rows = report.rows.filter(row => (filter.category === 'all' || row.category === filter.category)
    && (filter.status === 'all' || (filter.status === 'differences' ? row.status !== 'same' : row.status === filter.status))
    && row.name.toLowerCase().includes(name));
  const visible = new Set(rows.map(schemaCompareResultsId));
  return { rows, total: report.rows.length, hiddenSelectedIds: [...new Set(selectedIds)].filter(id => !visible.has(id)) };
}

/** 父级核对当前快照后仍按原报告校验意图；迟到事件不能把旧选择集合覆盖回来。 */
export function applySchemaCompareResultsSelection(report: SchemaCompareResult, previous: string[], event: SchemaCompareResultsSelection): string[] {
  if (event.snapshotId !== report.snapshotId) return previous;
  if (event.kind === 'clearHidden') {
    const cleared = new Set(event.ids);
    return previous.filter(id => !cleared.has(id));
  }
  if (event.kind === 'clearVisible') {
    const cleared = new Set(event.ids);
    return previous.filter(id => !cleared.has(id));
  }
  if (event.kind === 'selectVisible') {
    const rows = new Set(report.rows.filter(row => row.status !== 'same' && row.status !== 'unknown').map(schemaCompareResultsId));
    const ids = [...new Set(event.ids)].filter(id => rows.has(id));
    const next = [...new Set([...previous, ...ids])];
    return next.length <= schemaCompareLimits.selections ? next : previous;
  }
  const row = report.rows.find(item => schemaCompareResultsId(item) === event.id);
  if (!row || row.status === 'same' || row.status === 'unknown') return previous;
  if (event.checked) return previous.includes(event.id) || previous.length >= schemaCompareLimits.selections ? previous : [...previous, event.id];
  return previous.filter(id => id !== event.id);
}
