import { z } from 'zod';
import { copyInsertSqlLimits } from './copyInsertSql';
import { mysqlQueryRelationSchema } from './mysqlQueryRelation';

export const mysqlQueryRowSqlSchema = mysqlQueryRelationSchema.omit({ rowIndex: true }).extend({
  kind: z.enum(['select', 'insert', 'update', 'delete']),
  rowIndices: z.array(mysqlQueryRelationSchema.shape.rowIndex).min(1).max(copyInsertSqlLimits.rows)
    .refine(indices => new Set(indices).size === indices.length, '所选查询记录重复'),
});
export type MysqlQueryRowSqlInput = z.infer<typeof mysqlQueryRowSqlSchema>;

export const mysqlQueryRowSqlMessages = {
  source: '需要可核验的 InnoDB 原表和完整查询结果。',
  key: '查询结果需要直接返回完整且唯一的原表主键。',
  fields: '所选查询记录没有可生成 SQL 的原表字段。',
  stale: '查询原行或字段来源已变化，请重新执行查询。',
} as const;
