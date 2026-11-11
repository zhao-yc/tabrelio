import type { QueryResult } from '../shared/contracts';
import { queryResultSnapshotLimits } from '../shared/queryResultSnapshot';
import { savedQueryRenameNameSchema } from '../shared/savedQueryRename';
import { queryPinsZh } from './locales/queryPins.zh-CN';
import { zh } from './locales/zh-CN';

export interface PinnedQueryResult { id: string; label: string; originalLabel?: string; result: QueryResult; bytes: number; }
export const pinLimits = { count: 5, bytes: 16 * 1024 * 1024 };

/** 固定的是当前已返回的完整快照，保留类型和精度；容量不足时拒绝而不截断旧结果。 */
export function snapshotQueryResult(pins: PinnedQueryResult[], result: QueryResult, id: string, label: string): PinnedQueryResult {
  if (!result.columns.length) throw new Error(zh.query.pinRequiresRows);
  if (pins.length >= pinLimits.count) throw new Error(zh.query.pinCountLimit);
  const bytes = new TextEncoder().encode(JSON.stringify(result)).byteLength;
  if (pins.reduce((total, pin) => total + pin.bytes, 0) + bytes > pinLimits.bytes) throw new Error(zh.query.pinMemoryLimit);
  return { id, label, result: structuredClone(result), bytes };
}

/** 名称沿用有效 Unicode 校验，并满足另存快照文件的 UTF-8 字节上限。 */
export function pinnedResultName(value: string): string | undefined {
  const parsed = savedQueryRenameNameSchema.safeParse(value.trim());
  if (parsed.success && new TextEncoder().encode(parsed.data).byteLength <= queryResultSnapshotLimits.nameBytes) return parsed.data;
}

/** 只替换原对象的名称元数据，保留结果、选择身份、容量和首次固定名称。 */
export function renamePinnedResult(pins: PinnedQueryResult[], target: PinnedQueryResult, value: string): PinnedQueryResult[] | undefined {
  const name = pinnedResultName(value);
  if (!name || name === target.label || !pins.includes(target)) return;
  return pins.map(pin => pin === target ? { ...pin, label: name, originalLabel: pin.originalLabel ?? pin.label } : pin);
}

/** 普通另存保持原文件行为，明确改过的名称才随文件保存。 */
export function pinnedResultSnapshotName(pin?: PinnedQueryResult): string | undefined {
  return pin?.originalLabel === undefined ? undefined : pin.label;
}

/** 短提示只展示已有结果的耗时和 SQL 预览，完整 SQL 仍沿用查看入口。 */
export function pinnedResultTooltip(pin: PinnedQueryResult): string {
  const sql = pin.result.statement.slice(0, 200).replace(/[\uD800-\uDBFF]$/, '').replace(/\s+/g, ' ').trim();
  return [pin.label, queryPinsZh.elapsed(pin.result.elapsedMs), sql && sql + (pin.result.statement.length > 200 ? '…' : '')]
    .filter(Boolean).join('\n');
}
