import { z } from 'zod';
import { savedQueryImportTargetSchema, savedQueryReadTextSchema } from './savedQuerySearch';

export const savedQueryRebindLimits = { items: 100, bytes: 128 * 1024 * 1024 } as const;
/** 批量改绑只接受原记录摘要及已保存连接的编号，正文与凭据留在主进程。 */
export const savedQueryRebindSchema = z.object({
  queries: z.array(savedQueryReadTextSchema).min(1).max(savedQueryRebindLimits.items)
    .refine(items => new Set(items.map(item => item.id)).size === items.length, '所选查询不能重复'),
  expectedConnectionRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  target: savedQueryImportTargetSchema.nullable(),
}).strict();
export type SavedQueryRebindInput = z.infer<typeof savedQueryRebindSchema>;
