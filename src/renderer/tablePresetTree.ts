import { postgresRelationName } from '../shared/postgresSql';
import type { TablePresetTarget } from '../shared/tablePresets';
import type { TablePresetTabKind } from '../shared/tablePresetTab';

const listeners = new Map<string, Set<() => void>>();
function key(kind: TablePresetTabKind, target: TablePresetTarget): string {
  const relation = kind === 'postgres' ? postgresRelationName(target.table) : target.table;
  return JSON.stringify([kind, target.connectionId, target.database, relation]);
}

/** 只通知展开的同一关系节点。别名与 public 限定名共用更新范围。 */
export function onTablePresetsChanged(kind: TablePresetTabKind, target: TablePresetTarget, listener: () => void): () => void {
  const id = key(kind, target), group = listeners.get(id) ?? new Set();
  group.add(listener);
  listeners.set(id, group);
  return () => { group.delete(listener); if (!group.size) listeners.delete(id); };
}

export function tablePresetsChanged(kind: TablePresetTabKind, target: TablePresetTarget): void {
  for (const listener of listeners.get(key(kind, target)) ?? []) listener();
}
