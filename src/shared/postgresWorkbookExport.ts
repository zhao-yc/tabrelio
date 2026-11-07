import { z } from 'zod';
import { EXCEL_LIMITS } from './excelTransfer';
import { postgresIdentifier, postgresRelationName } from './postgresSql';
import { postgresTableTargetSchema } from './postgresTable';

/** 对象必须使用目录的完整限定名，不能借 search_path 或传入 SQL。 */
const qualifiedRelation = postgresTableTargetSchema.shape.table.refine(value => {
  const { schema, name } = postgresRelationName(value);
  return !!schema && !!name && !/[\uD800-\uDFFF]/u.test(schema + name) &&
    value === postgresIdentifier(schema) + '.' + postgresIdentifier(name);
}, '工作簿需要 PostgreSQL 目录中的完整限定名');

export const postgresWorkbookExportSchema = z.object({
  connectionId: postgresTableTargetSchema.shape.connectionId, database: postgresTableTargetSchema.shape.database,
  taskId: postgresTableTargetSchema.shape.tabId, fileToken: z.string().min(1).max(200),
  objects: z.array(z.object({ name: qualifiedRelation, kind: z.enum(['table', 'view']) }).strict())
    .min(2).max(EXCEL_LIMITS.maxSheets).refine(objects => new Set(objects.map(object => object.name)).size === objects.length, '工作簿导出对象不能重复'),
}).strict();
export type PostgresWorkbookExportInput = z.infer<typeof postgresWorkbookExportSchema>;
