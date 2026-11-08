import { z } from 'zod';
import { dataCompareBatchConfigurationSchema } from './dataCompareBatch';
import { tableDataCompareRequestSchema } from './postgresDataCompare';
import { sqliteDataCompareSchema } from './sqliteDataCompare';
import { sqliteTableFilterSchema } from './sqliteTableBrowse';

export const dataCompareProfileLimits = { count: 32, name: 80, bytes: 2 * 1024 * 1024 };
const family = z.enum(['mysql', 'postgresql', 'sqlite']);
export const dataCompareProfileScope = z.object({ family, area: z.literal('batch').optional() }).strict();
export type DataCompareProfileScope = z.infer<typeof dataCompareProfileScope>;
export type DataCompareProfileFamily = z.infer<typeof family>;
const network = tableDataCompareRequestSchema.omit({ taskId: true, summaryOnly: true });
const sqlite = sqliteDataCompareSchema.shape;
const networkFilter = network.shape.filter.unwrap().refine(value => value.text.length > 0, '请填写要保存的筛选文本');

/** 保存实际用于比较的条件。已有差异、勾选、同步确认及凭据不属于配置。 */
export const dataCompareConfigurationSchema = z.discriminatedUnion('family', [
  network.extend({ family: z.enum(['mysql', 'postgresql']), filter: networkFilter.optional() }).strict(),
  z.object({
    family: z.literal('sqlite'), source: sqlite.source, target: sqlite.target,
    filter: z.object({ column: sqliteTableFilterSchema.shape.column, value: sqliteTableFilterSchema.shape.value.unwrap() }).strict().optional(),
  }).strict(),
]).refine(({ source, target }) =>
  source.connectionId !== target.connectionId || source.database !== target.database || source.table !== target.table,
'请选择不同的左右表');
export type DataCompareConfiguration = z.infer<typeof dataCompareConfigurationSchema>;

const name = z.string().trim().min(1).max(dataCompareProfileLimits.name).refine(value => !/\p{Cc}/u.test(value));
const profileConfiguration = z.union([dataCompareConfigurationSchema, dataCompareBatchConfigurationSchema]);
export type DataCompareProfileConfiguration = z.infer<typeof profileConfiguration>;
const profile = z.object({ name, configuration: profileConfiguration }).strict();

function matchesScope(scope: DataCompareProfileScope, configuration: DataCompareProfileConfiguration): boolean {
  return scope.family === configuration.family && (scope.area === 'batch') === ('pairs' in configuration);
}
const selection = z.object({ name, revision: z.uuid() }).strict();
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const stored = profile.extend({ revision: z.uuid(), bindings: z.tuple([digest, digest]) });
export const dataCompareProfileReadSchema = dataCompareProfileScope.extend({ selected: selection }).strict();
export const dataCompareProfileMutationSchema = z.discriminatedUnion('kind', [
  dataCompareProfileScope.extend({ kind: z.literal('add'), profile }).strict(),
  dataCompareProfileReadSchema.extend({ kind: z.literal('update'), profile }).strict(),
  dataCompareProfileReadSchema.extend({ kind: z.literal('delete') }).strict(),
]).refine(input => input.kind === 'delete' || matchesScope(input, input.profile.configuration), '比较方案与当前入口或数据库类型不一致');
export type DataCompareProfileSummary = z.infer<typeof selection>;
export type DataCompareProfileMutation = z.infer<typeof dataCompareProfileMutationSchema>;
export type StoredDataCompareProfile = z.infer<typeof stored>;

/** 保留已有文档，损坏、重名或未来版本均拒绝自动覆盖。 */
export function readDataCompareProfiles(scope: DataCompareProfileScope, data: string): StoredDataCompareProfile[] {
  if (new TextEncoder().encode(data).length > dataCompareProfileLimits.bytes) throw Error('比较方案总大小不能超过 2 MiB');
  const { profiles } = z.object({ version: z.literal(1), profiles: z.array(stored).max(dataCompareProfileLimits.count) }).strict().parse(JSON.parse(data));
  if (new Set(profiles.map(item => item.name)).size !== profiles.length || profiles.some(item => !matchesScope(scope, item.configuration)))
    throw Error('比较方案存在重名或类型不一致');
  return profiles;
}
