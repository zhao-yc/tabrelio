import { z } from 'zod';
import { tableDataCompareRequestSchema } from './postgresDataCompare';
import { sqliteDataCompareSchema } from './sqliteDataCompare';

const network = tableDataCompareRequestSchema.shape.source;
const sqlite = sqliteDataCompareSchema.shape.source;
export const batchPairLimit = 32;
export type ComparePair = { source: string; target: string };
export type CompareScope = Omit<z.infer<typeof network>, 'table'>;
const networkScope = network.omit({ table: true });
const sqliteScope = sqlite.omit({ table: true });

export function sameCompareScope(source: CompareScope, target: CompareScope): boolean {
  return source.connectionId === target.connectionId && source.database === target.database;
}

/** 同一侧只能使用每张表一次。同一范围内不得把表与自身配对。 */
export const dataCompareBatchConfigurationSchema = z.discriminatedUnion('family', [
  z.object({
    family: z.enum(['mysql', 'postgresql']), source: networkScope, target: networkScope,
    pairs: z.array(z.object({ source: network.shape.table, target: network.shape.table }).strict()).min(1).max(batchPairLimit),
  }).strict(),
  z.object({
    family: z.literal('sqlite'), source: sqliteScope, target: sqliteScope,
    pairs: z.array(z.object({ source: sqlite.shape.table, target: sqlite.shape.table }).strict()).min(1).max(batchPairLimit),
  }).strict(),
]).refine(({ source, target, pairs }) =>
  new Set(pairs.map(pair => pair.source)).size === pairs.length &&
  new Set(pairs.map(pair => pair.target)).size === pairs.length &&
  (!sameCompareScope(source, target) || pairs.every(pair => pair.source !== pair.target)),
'比较方案含重复映射或将表与自身比较');
export type DataCompareBatchConfiguration = z.infer<typeof dataCompareBatchConfigurationSchema>;
