import { z } from 'zod';
import { batchPairLimit, sameCompareScope } from './dataCompareBatch';
import { dataCompareMappingSchema } from './dataCompareMapping';
import { batchSyncActions } from './dataCompareBatchSync';
import { tableDataCompareRequestSchema } from './postgresDataCompare';

const endpoint = tableDataCompareRequestSchema.shape.source;
const scope = endpoint.omit({ table: true });

/** 表名使用 MySQL 目录原名，点号属于表名。同一库内的来源表和目标表不得重叠。 */
export const mysqlBatchSyncPreviewSchema = z.object({
  source: scope, target: scope,
  pairs: z.array(z.object({ source: endpoint.shape.table, target: endpoint.shape.table, mapping: dataCompareMappingSchema.optional() }).strict()).min(2).max(batchPairLimit),
  actions: z.array(z.enum(batchSyncActions)).min(1).max(3),
  taskId: z.uuid(),
}).strict().refine(({ source, target, pairs, actions }) => {
  const sources = new Set(pairs.map(pair => pair.source)), targets = new Set(pairs.map(pair => pair.target));
  return sources.size === pairs.length && targets.size === pairs.length && new Set(actions).size === actions.length &&
    (!sameCompareScope(source, target) || pairs.every(pair => !sources.has(pair.target)));
}, '多表同步不允许重复表、重复操作或同库内的来源与目标重叠');

export type MysqlBatchSyncPreviewInput = z.infer<typeof mysqlBatchSyncPreviewSchema>;
