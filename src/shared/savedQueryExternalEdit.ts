import { z } from 'zod';
import { savedQueryReadTextSchema } from './savedQuerySearch';
import type { QueryFileTextDifference } from './queryFileReload';

const session = z.object({ sessionId: z.string().uuid() }).strict();
export const savedQueryExternalSchemas = {
  'queries.externalStart': savedQueryReadTextSchema,
  'queries.externalResume': z.object({}).strict(),
  'queries.externalReopen': session,
  'queries.externalPreview': session,
  'queries.externalApply': session.extend({ previewId: z.string().uuid() }),
  'queries.externalDiscard': session,
  'queries.externalKeep': session,
};

export interface SavedQueryExternalSession { sessionId: string; queryId: string; name: string; path: string; committed: boolean; launchFailed?: boolean; }
export interface SavedQueryExternalPreview { previewId: string; changed: boolean; difference: QueryFileTextDifference; }
export interface SavedQueryExternalReceipt { cleanupPending: boolean; }

export const savedQueryExternalZh = {
  open: '用外部编辑器编辑',
  resume: '继续外部编辑',
  reopen: '重新打开编辑副本',
  noRecovery: '没有待继续的外部编辑。',
  recovered: '已恢复上次的编辑副本。',
  reopenFailed: '编辑副本已保留，请检查外部编辑器设置后重试打开。',
  title: '保存查询的外部编辑',
  hint: '在外部编辑器保存并关闭副本，回到此处读取改动。只有确认写回后，查询库才会更新。',
  location: '编辑副本路径',
  read: '读取外部改动',
  apply: '写回原保存查询',
  discard: '放弃改动并删除副本',
  keep: '保留副本并结束',
  kept: '编辑副本已保留在系统临时目录。',
  retryCleanup: '重试清理编辑副本',
  same: '副本与原查询正文一致。',
  before: '原查询变更片段',
  after: '外部编辑后的片段',
  empty: '（空）',
  truncated: '仅显示变更片段的前部。确认后写入完整正文。',
  saved: '已写回原保存查询。',
  cleanup: '查询库已更新。请关闭外部编辑器中的文件，再清理编辑副本。',
  cleanupFailed: '无法删除编辑副本。请关闭外部编辑器中的文件并重试。',
  missing: '原保存查询已删除，副本未写回。',
  stale: '原保存查询已修改，副本未写回。可从外部编辑器另存。',
  busy: '请先结束当前外部编辑。上次未完成时可选择「继续外部编辑」。',
  expired: '原外部编辑会话已失效。',
  changed: '副本在预览后发生变化，请重新读取。',
  readFailed: '无法读取编辑副本，请核对文件、编码和大小。',
  startFailed: '无法创建外部编辑副本。',
  exit: '外部编辑副本会留在系统临时目录。重启后可从保存查询列表选择「继续外部编辑」。',
} as const;
