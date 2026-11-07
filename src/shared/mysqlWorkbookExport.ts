import { z } from 'zod';
import { EXCEL_LIMITS } from './excelTransfer';

const identifier = z.string().min(1).max(64).refine(value => !/[\u0000\uD800-\uDFFF]/u.test(value));
/** 一个工作簿只读取原目录中的同库对象，路径和 SQL 均由可信进程生成。 */
export const mysqlWorkbookExportSchema = z.object({
  connectionId: z.string().min(1).max(200), database: identifier,
  taskId: z.string().min(1).max(200), fileToken: z.string().min(1).max(200),
  objects: z.array(z.object({ name: identifier, kind: z.enum(['table', 'view']) }).strict())
    .min(2).max(EXCEL_LIMITS.maxSheets).refine(objects => new Set(objects.map(object => object.name)).size === objects.length, '工作簿导出对象不能重复'),
}).strict();
export type MysqlWorkbookExportInput = z.infer<typeof mysqlWorkbookExportSchema>;
