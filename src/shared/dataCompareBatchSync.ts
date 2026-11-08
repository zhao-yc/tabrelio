import { z } from 'zod';
import type { DataCompareMapping } from './dataCompareMapping';

export const batchSyncActions = ['insert', 'update', 'delete'] as const;
export type BatchSyncAction = typeof batchSyncActions[number];
export type BatchSyncCounts = Record<BatchSyncAction, number>;
export const batchSyncLimits = { candidates: 2000, previewBytes: 8 * 1024 * 1024, selected: 100, writeBytes: 1024 * 1024, page: 25 } as const;

interface BatchSyncCell<Value> { sourceColumn: string; targetColumn: string; source?: Value; target?: Value; }
interface BatchSyncRow<Value> { action: BatchSyncAction; key: Value[]; cells: BatchSyncCell<Value>[]; writeBytes: number; }
interface BatchSyncTable<Value> { table: string; confirmation: string; counts: BatchSyncCounts; rows: BatchSyncRow<Value>[]; }
export interface BatchSyncPreview<Key> {
  previewId: string;
  confirmation: string;
  counts: BatchSyncCounts;
  tables: BatchSyncTable<Key>[];
}

export function batchSyncPreviewRow<Value>(action: BatchSyncAction, row: { key: Value[]; cells: { column: number; source?: Value; target?: Value }[] },
  columns: string[], evidence: unknown, mapping?: DataCompareMapping): BatchSyncRow<Value> {
  return { action, key: row.key, writeBytes: jsonBytes(evidence) + 1, cells: row.cells.map(({ column, source, target }) => ({
    sourceColumn: columns[column], targetColumn: mapping?.[column].target ?? columns[column], source, target,
  })) };
}

const utf8 = new TextEncoder();
const jsonBytes = (value: unknown) => utf8.encode(JSON.stringify(value)).length;

/** 同时计入冻结证据和字段详情，候选分页不放宽进程间负载预算。 */
export function createBatchSyncPreviewBudget() {
  let rows = 0, bytes = 0;
  return (row: BatchSyncRow<unknown>) => {
    if (++rows > batchSyncLimits.candidates) throw Error('多表同步预览最多 2,000 条差异，请减少表对或操作范围');
    bytes += row.writeBytes + jsonBytes(row);
    if (bytes > batchSyncLimits.previewBytes) throw Error('多表同步预览超过 8 MiB，请减少表对或操作范围');
  };
}

export function batchSyncConfirmation(targets: readonly string[]): string {
  return targets.length > 1 ? targets[0] + ` 等 ${targets.length} 张表` : targets[0] ?? '';
}

/** 序号只引用原预览。按原表和行顺序提取，禁止重复或引用预览之外的记录。 */
export function resolveBatchSyncSelection(tables: readonly BatchSyncTable<unknown>[], selected?: readonly number[]) {
  const wanted = selected && new Set(selected);
  const counts: BatchSyncCounts = { insert: 0, update: 0, delete: 0 };
  let ordinal = 0, matched = 0, writeBytes = 1;
  const groups = tables.flatMap((table, tableIndex) => {
    const counts: BatchSyncCounts = { insert: 0, update: 0, delete: 0 };
    const rows = table.rows.flatMap((row, rowIndex) => {
      const id = ordinal++;
      if (wanted && !wanted.has(id)) return [];
      matched++;
      writeBytes += row.writeBytes;
      counts[row.action]++;
      return [rowIndex];
    });
    return rows.length ? [{ tableIndex, rows, counts }] : [];
  });
  if (selected && matched !== selected.length) throw Error('同步选择包含重复或已失效的预览记录');
  for (const group of groups) for (const action of batchSyncActions) counts[action] += group.counts[action];
  return { groups, counts, rowCount: matched, writeBytes,
    confirmation: batchSyncConfirmation(groups.map(group => tables[group.tableIndex].confirmation)) };
}

export function batchSyncSelectionIssue(selection: { rowCount: number; writeBytes: number }) {
  if (selection.rowCount > batchSyncLimits.selected) return '单次同步最多提交 100 条差异，请减少选择';
  if (selection.writeBytes > batchSyncLimits.writeBytes) return '所选写入证据超过 1 MiB，请减少选择';
}

/** 引擎和 Main 都从可信预览计算预算，不能由页面提供写入大小。 */
export function requireBatchSyncSelection(tables: readonly BatchSyncTable<unknown>[], selected?: readonly number[]) {
  const selection = resolveBatchSyncSelection(tables, selected);
  const issue = batchSyncSelectionIssue(selection);
  if (!selection.rowCount || issue) throw Error(issue ?? '至少选中一条差异');
  return selection;
}

const selection = z.array(z.number().int().min(0).max(batchSyncLimits.candidates - 1)).min(1).max(batchSyncLimits.selected).refine(
  rows => new Set(rows).size === rows.length, '同步选择不能重复');
export const batchSyncApplySchema = z.object({
  previewId: z.uuid(), taskId: z.uuid(), confirmation: z.string().min(1).max(1024), selected: selection.optional(),
}).strict();
export type BatchSyncApplyInput = z.infer<typeof batchSyncApplySchema>;
