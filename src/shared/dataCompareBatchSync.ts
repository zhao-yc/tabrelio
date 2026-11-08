import { z } from 'zod';

export const batchSyncActions = ['insert', 'update', 'delete'] as const;
export type BatchSyncAction = typeof batchSyncActions[number];
export type BatchSyncCounts = Record<BatchSyncAction, number>;

export interface BatchSyncPreview<Key> {
  previewId: string;
  confirmation: string;
  counts: BatchSyncCounts;
  tables: { table: string; counts: BatchSyncCounts; rows: { action: BatchSyncAction; key: Key[] }[] }[];
}

export const batchSyncApplySchema = z.object({
  previewId: z.uuid(), taskId: z.uuid(), confirmation: z.string().min(1).max(1024),
}).strict();
export type BatchSyncApplyInput = z.infer<typeof batchSyncApplySchema>;
