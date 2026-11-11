import { z } from 'zod';

export const sidebarStarLimit = 1000;

/** 连接星标仅保存本机连接 ID，与凭据、连接导出和对象收藏分开。 */
export const sidebarViewSchema = z.object({
  flat: z.boolean(),
  starred: z.array(z.string().min(1).max(200)).max(sidebarStarLimit)
    .refine(ids => new Set(ids).size === ids.length, '连接星标不能重复'),
}).strict();

export type SidebarView = z.infer<typeof sidebarViewSchema>;
