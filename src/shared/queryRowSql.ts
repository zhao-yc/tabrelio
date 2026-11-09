import { z } from 'zod';
import { copyInsertSqlLimits } from './copyInsertSql';

const id = z.string().min(1).max(200);
export const queryRowSqlSchema = z.object({
  connectionId: id, sessionId: id, executionId: id, taskId: id,
  kind: z.enum(['select', 'insert', 'update', 'delete']),
  rowIndices: z.array(z.number().int().min(0).max(99999)).min(1).max(copyInsertSqlLimits.rows)
    .refine(indices => new Set(indices).size === indices.length, '所选查询记录重复'),
}).strict();
export type QueryRowSqlInput = z.infer<typeof queryRowSqlSchema>;
export interface QueryRowSqlOutput { database: string; table: string; sql: string }

export const mysqlQueryRowSqlMessages = {
  source: '需要可核验的 InnoDB 原表和完整查询结果。',
  key: '查询结果需要直接返回完整且唯一的原表主键。',
  fields: '所选查询记录没有可生成 SQL 的原表字段。',
  stale: '查询原行或字段来源已变化，请重新执行查询。',
} as const;

export const sqliteQueryRowSqlMessages = {
  source: '需要可核验的 SQLite 主库普通表和完整查询结果。',
  stale: 'SQLite 原查询的文件或表结构已变化，请重新执行查询。',
  key: 'SQLite 查询结果需要直接返回完整原表主键。',
  fields: '所选查询记录没有可生成 SQL 的原表字段。',
} as const;
