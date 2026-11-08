export const batchSyncActions = ['insert', 'update', 'delete'] as const;
export type BatchSyncAction = typeof batchSyncActions[number];
export type BatchSyncCounts = Record<BatchSyncAction, number>;

export interface BatchSyncPreview<Key> {
  previewId: string;
  confirmation: string;
  counts: BatchSyncCounts;
  tables: { table: string; counts: BatchSyncCounts; rows: { action: BatchSyncAction; key: Key[] }[] }[];
}
