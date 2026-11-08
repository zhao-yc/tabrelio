import { z } from 'zod';
import type { SqliteValue } from '../engine/sqlite/protocol';
import { batchPairLimit } from './dataCompareBatch';
import { sqliteDataCompareSchema } from './sqliteDataCompare';
import type { SqliteTableEditCounts } from './sqliteTableEdit';

const { connectionId, table } = sqliteDataCompareSchema.shape.source.shape;
export const sqliteBatchSyncActions = ['insert', 'update', 'delete'] as const;
export type SqliteBatchSyncAction = typeof sqliteBatchSyncActions[number];
/** 一个事务只写入一个右侧文件，每张目标表仅出现一次。自定义字段映射不能进入写入合同。 */
export const sqliteBatchSyncPreviewSchema = z.object({
  sourceConnectionId: connectionId, targetConnectionId: connectionId,
  pairs: z.array(z.object({ source: table, target: table }).strict()).min(2).max(batchPairLimit),
  actions: z.array(z.enum(sqliteBatchSyncActions)).min(1).max(3),
  taskId: z.uuid(),
}).strict().refine(({ pairs, actions, sourceConnectionId, targetConnectionId }) => {
  const sources = new Set(pairs.map(pair => pair.source)), targets = new Set(pairs.map(pair => pair.target));
  return sources.size === pairs.length && targets.size === pairs.length && new Set(actions).size === actions.length &&
    (sourceConnectionId !== targetConnectionId || pairs.every(pair => !sources.has(pair.target)));
}, '多表同步不允许重复表、重复操作或同文件中的来源与目标重叠');
export type SqliteBatchSyncPreviewInput = z.infer<typeof sqliteBatchSyncPreviewSchema>;
export interface SqliteBatchSyncPreview {
  previewId: string;
  confirmation: string;
  counts: SqliteTableEditCounts;
  tables: { table: string; counts: SqliteTableEditCounts; rows: { action: SqliteBatchSyncAction; key: SqliteValue[] }[] }[];
}
