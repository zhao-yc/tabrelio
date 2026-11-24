import type { DataRow, RowChange } from '../shared/contracts';
import { ownCell, rowEqual } from './lib';

export interface DraftRow { id: string; data: DataRow; original?: DataRow; inserted: boolean; deleted: boolean; }

/** 单行和批量新增共用同一草稿语义；省略字段保持DEFAULT，不自动填入NULL或服务器默认值。 */
export function newDraftRow(id: string, data: DataRow = {}): DraftRow { return { id, data, inserted: true, deleted: false }; }

export function draftRowChanged(row: DraftRow | undefined): boolean {
  return !!row && (row.inserted || !!row.original && (row.deleted || !rowEqual(row.original, row.data)));
}

/** 仅比较已有记录的准确字段值，保持 NULL、空字符串与字节的区别。 */
export function draftCellChanged(row: DraftRow, key: string): boolean {
  if (row.inserted || row.deleted || !row.original) return false;
  const original = ownCell(row.original, key);
  return original !== undefined && JSON.stringify(original) !== JSON.stringify(ownCell(row.data, key));
}

/** 单格恢复只替换准确行的指定字段，可用原草稿账本撤销。 */
export function discardDraftCell(rows: DraftRow[], row: DraftRow, key: string): DraftRow[] {
  if (!rows.includes(row) || !draftCellChanged(row, key)) return rows;
  const original = row.original && ownCell(row.original, key);
  if (original === undefined) return rows;
  return rows.map(item => item === row ? { ...row, data: { ...row.data, [key]: structuredClone(original) } } : item);
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
