import type { ComparePair } from '../shared/dataCompareBatch';
import type { BatchSyncAction, BatchSyncPreview } from '../shared/dataCompareBatchSync';
import { postgresRelationName } from '../shared/postgresSql';

/** 先匹配准确全名。PostgreSQL 两端仅在同一个短名各自唯一时才跨 Schema 建议映射。 */
export function suggestComparePairs(left: string[], right: string[], postgres: boolean, sameScope: boolean): ComparePair[] {
  if (sameScope) return [];
  const available = new Set(right);
  const exact = left.filter(name => available.has(name)).map(name => ({ source: name, target: name }));
  if (!postgres) return exact;
  const byName = (items: string[]) => {
    const index = new Map<string, string | undefined>();
    for (const relation of items) {
      const { name } = postgresRelationName(relation);
      index.set(name, index.has(name) ? undefined : relation);
    }
    return index;
  };
  const leftNames = byName(left), rightNames = byName(right);
  for (const [name, source] of leftNames) {
    const target = rightNames.get(name);
    if (source && target && source !== target) exact.push({ source, target });
  }
  return exact;
}

export interface BatchPreviewFilter { table: string; action: BatchSyncAction | ''; key: string; }

/** 序号在原预览中生成。筛选、分页和批量勾选只引用该序号。 */
export function indexBatchPreview(tables: BatchSyncPreview<string>['tables']) {
  let ordinal = 0;
  return tables.map(table => ({ ...table, rows: table.rows.map(row => ({ ...row, ordinal: ordinal++ })) }));
}

/** 在界面已显示的精确键文本上匹配，避免把大整数或二进制键转成数值。 */
export function filterBatchPreview(tables: ReturnType<typeof indexBatchPreview>, filter: BatchPreviewFilter) {
  const key = filter.key.trim().toLowerCase();
  return tables.flatMap(table => {
    if (filter.table && table.table !== filter.table) return [];
    const rows = table.rows.filter(row => (!filter.action || row.action === filter.action) &&
      (!key || row.key.join(' / ').toLowerCase().includes(key)));
    return rows.length ? [{ ...table, rows }] : [];
  });
}
