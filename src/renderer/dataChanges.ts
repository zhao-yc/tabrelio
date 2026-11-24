import type { DataRow, RowChange } from '../shared/contracts';
import { ownCell, rowEqual } from './lib';

export interface DraftRow { id: string; data: DataRow; original?: DataRow; inserted: boolean; deleted: boolean; }

/** 单行和批量新增共用同一草稿语义；省略字段保持DEFAULT，不自动填入NULL或服务器默认值。 */
export function newDraftRow(id: string, data: DataRow = {}): DraftRow { return { id, data, inserted: true, deleted: false }; }

export function draftRowChanged(row: DraftRow | undefined): boolean {
  return !!row && (row.inserted || !!row.original && (row.deleted || !rowEqual(row.original, row.data)));
}

/** 只返回有实际差异的原值，保留 NULL、空字符串与字节的区别。 */
function draftCellBaseline(row: DraftRow, key: string) {
  if (row.inserted || row.deleted || !row.original) return;
  const original = ownCell(row.original, key);
  const value = ownCell(row.data, key);
  if (original !== undefined && !Object.is(original, value) && JSON.stringify(original) !== JSON.stringify(value)) return original;
}

export function draftCellsChanged(rows: readonly DraftRow[], keys: readonly string[]): boolean {
  return rows.some(row => keys.some(key => draftCellBaseline(row, key) !== undefined));
}

/** 整块恢复只替换仍准确匹配的字段；有旧行时整块拒绝。 */
export function discardDraftCells(rows: DraftRow[], selected: readonly DraftRow[], keys: readonly string[]): DraftRow[] {
  const originalRows = new Set(rows);
  if (selected.some(row => !originalRows.has(row))) return rows;
  const replacements = new Map<DraftRow, DraftRow>();
  for (const row of selected) {
    let data: DataRow | undefined;
    for (const key of keys) {
      const original = draftCellBaseline(row, key);
      if (original !== undefined) {
        // 目录允许与对象原型同名的字段，按自有字段恢复。
        data ??= { ...row.data };
        Object.defineProperty(data, key, { value: structuredClone(original), enumerable: true, writable: true, configurable: true });
      }
    }
    if (data) replacements.set(row, { ...row, data });
  }
  return replacements.size ? rows.map(row => replacements.get(row) ?? row) : rows;
}

/** 按原行对象定位。新增只移除本地行，已有行恢复读取时的完整原值及删除状态。 */
export function discardDraftRow(rows: DraftRow[], row: DraftRow): DraftRow[] {
  const index = rows.indexOf(row);
  if (index < 0 || !draftRowChanged(row)) return rows;
  if (row.inserted) return rows.filter(item => item !== row);
  const next = [...rows];
  next[index] = { ...row, data: row.original!, deleted: false };
  return next;
}

/** 保留载入时的完整快照用于乐观锁，只把实际修改字段发送给数据库。 */
export function collectChanges(rows: DraftRow[]): RowChange[] {
  return rows.flatMap<RowChange>(row => {
    if (row.inserted) return row.deleted ? [] : [{ kind: 'insert', values: row.data }];
    if (row.deleted) return [{ kind: 'delete', before: row.original! }];
    if (rowEqual(row.original!, row.data)) return [];
    const changed: DataRow = Object.fromEntries(Object.entries(row.data).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(ownCell(row.original!, key))));
    return [{ kind: 'update', before: row.original!, values: changed }];
  });
}
