import { z } from 'zod';
import type { DataCompareMapping } from './dataCompareMapping';

export const batchSyncActions = ['insert', 'update', 'delete'] as const;
export type BatchSyncAction = typeof batchSyncActions[number];
export type BatchSyncCounts = Record<BatchSyncAction, number>;

interface BatchSyncCell<Value> { sourceColumn: string; targetColumn: string; source?: Value; target?: Value; }
interface BatchSyncRow<Value> { action: BatchSyncAction; key: Value[]; cells: BatchSyncCell<Value>[]; }
interface BatchSyncTable<Value> { table: string; confirmation: string; counts: BatchSyncCounts; rows: BatchSyncRow<Value>[]; }
export interface BatchSyncPreview<Key> {
  previewId: string;
  confirmation: string;
  counts: BatchSyncCounts;
  tables: BatchSyncTable<Key>[];
}

export function batchSyncPreviewRow<Value>(action: BatchSyncAction, row: { key: Value[]; cells: { column: number; source?: Value; target?: Value }[] },
  columns: string[], mapping?: DataCompareMapping): BatchSyncRow<Value> {
  return { action, key: row.key, cells: row.cells.map(({ column, source, target }) => ({
    sourceColumn: columns[column], targetColumn: mapping?.[column].target ?? columns[column], source, target,
  })) };
}

export function batchSyncConfirmation(targets: readonly string[]): string {
  return targets.length > 1 ? targets[0] + ` 等 ${targets.length} 张表` : targets[0] ?? '';
}

/** 序号只引用原预览。按原表和行顺序提取，禁止重复或引用预览之外的记录。 */
export function resolveBatchSyncSelection(tables: readonly BatchSyncTable<unknown>[], selected?: readonly number[]) {
  const wanted = selected && new Set(selected);
  const counts: BatchSyncCounts = { insert: 0, update: 0, delete: 0 };
  let ordinal = 0, matched = 0;
  const groups = tables.flatMap((table, tableIndex) => {
    const counts: BatchSyncCounts = { insert: 0, update: 0, delete: 0 };
    const rows = table.rows.flatMap(({ action }, rowIndex) => {
      const id = ordinal++;
      if (wanted && !wanted.has(id)) return [];
      matched++;
      counts[action]++;
      return [rowIndex];
    });
    return rows.length ? [{ tableIndex, rows, counts }] : [];
  });
  if (selected && matched !== selected.length) throw Error('同步选择包含重复或已失效的预览记录');
  for (const group of groups) for (const action of batchSyncActions) counts[action] += group.counts[action];
  return { groups, counts, confirmation: batchSyncConfirmation(groups.map(group => tables[group.tableIndex].confirmation)) };
}

const selection = z.array(z.number().int().min(0).max(99)).min(1).max(100).refine(
  rows => new Set(rows).size === rows.length, '同步选择不能重复');
export const batchSyncApplySchema = z.object({
  previewId: z.uuid(), taskId: z.uuid(), confirmation: z.string().min(1).max(1024), selected: selection.optional(),
}).strict();
export type BatchSyncApplyInput = z.infer<typeof batchSyncApplySchema>;
