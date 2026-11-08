import { z } from 'zod';
import { postgresCreateTableApplySchema } from './postgresCreateTable';
import { postgresIdentifier } from './postgresSql';
import { postgresStructureInputSchema } from './postgresStructure';

export const postgresRelationMaintenanceAction = z.enum(['analyze', 'vacuum', 'vacuumAnalyze', 'reindex']);
export type PostgresRelationMaintenanceAction = z.infer<typeof postgresRelationMaintenanceAction>;
export const postgresRelationMaintenancePreviewSchema = postgresStructureInputSchema.extend({
  action: postgresRelationMaintenanceAction, stamp: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export const postgresRelationMaintenanceApplySchema = postgresCreateTableApplySchema.extend({ confirmed: z.literal(true) }).strict();
export type PostgresRelationMaintenancePreview = z.infer<typeof postgresRelationMaintenancePreviewSchema>;
export type PostgresRelationMaintenanceApply = z.infer<typeof postgresRelationMaintenanceApplySchema>;

export interface PostgresRelationMaintenanceCatalog {
  stamp: string;
  actions: Record<PostgresRelationMaintenanceAction, boolean>;
  indexes: { name: string; valid: boolean }[];
  lastVacuum: string | null;
  lastAnalyze: string | null;
  vacuumCount: string;
  analyzeCount: string;
}

/** 每次只生成一条准确限定的命令。普通 VACUUM 保留尾部空页给原表复用。 */
export function postgresRelationMaintenanceSql(schema: string, name: string, version: number, action: PostgresRelationMaintenanceAction): string {
  const table = postgresIdentifier(schema) + '.' + postgresIdentifier(name);
  const target = version >= 180000 ? 'ONLY ' + table : table;
  if (action === 'analyze') return 'ANALYZE ' + target;
  if (action === 'reindex') return 'REINDEX TABLE ' + table;
  return 'VACUUM (' + (action === 'vacuumAnalyze' ? 'ANALYZE, ' : '') + 'TRUNCATE OFF) ' + target;
}
