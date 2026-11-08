import { z } from 'zod';
import type { CellValue } from './contracts';
import { batchPairLimit, sameCompareScope } from './dataCompareBatch';
import { batchSyncActions, batchSyncApplySchema, type BatchSyncApplyInput, type BatchSyncPreview } from './dataCompareBatchSync';
import { postgresRelationName } from './postgresSql';
import { tableDataCompareRequestSchema } from './postgresDataCompare';

const endpoint = tableDataCompareRequestSchema.shape.source;
const scope = endpoint.omit({ table: true });

/** 单次事务只能写入一个已保存的右侧数据库。映射使用目录原名，不接受字段映射、SQL 或任意目标。 */
export const postgresBatchSyncPreviewSchema = z.object({
  source: scope, target: scope,
  pairs: z.array(z.object({ source: endpoint.shape.table, target: endpoint.shape.table }).strict()).min(2).max(batchPairLimit),
  actions: z.array(z.enum(batchSyncActions)).min(1).max(3),
  taskId: z.uuid(),
}).strict().refine(({ source, target, pairs, actions }) => {
  const relation = (name: string) => JSON.stringify(postgresRelationName(name));
  const sources = new Set(pairs.map(pair => relation(pair.source))), targets = new Set(pairs.map(pair => relation(pair.target)));
  return sources.size === pairs.length && targets.size === pairs.length && new Set(actions).size === actions.length &&
    (!sameCompareScope(source, target) || pairs.every(pair => !sources.has(relation(pair.target))));
}, '多表同步不允许重复表、重复操作或同库内的来源与目标重叠');

export const postgresBatchSyncApplySchema = batchSyncApplySchema;
export type PostgresBatchSyncPreviewInput = z.infer<typeof postgresBatchSyncPreviewSchema>;
export type PostgresBatchSyncApplyInput = BatchSyncApplyInput;
export type PostgresBatchSyncPreview = BatchSyncPreview<CellValue>;
