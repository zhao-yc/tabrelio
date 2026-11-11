import { z } from 'zod';

export const mysqlQueryStatusLimit = 200;
export const mysqlQueryStageLimit = 64;

export const mysqlQueryStageSchema = z.object({
  name: z.string().max(128).regex(/^stage\/[a-zA-Z0-9_]+\/[a-zA-Z0-9_ /.()-]+$/).refine(name => name === name.trim()),
  elapsedMs: z.number().finite().nonnegative().nullable(),
}).strict();
const stageCollectionSchema = z.enum(['ready', 'disabled', 'unavailable']);

export interface MysqlQueryStatusEntry {
  ordinal: number;
  status: 'completed' | 'failed';
  elapsedMs: number;
  /** 客户端观测到的 MySQL 协议字节，含包头和完整响应。无法采集时省略。 */
  traffic?: { sent: number; received: number };
  stages?: { rows: z.infer<typeof mysqlQueryStageSchema>[]; limited: boolean };
}

export interface MysqlQueryStatusReport {
  entries: MysqlQueryStatusEntry[];
  omitted: number;
  termination?: 'cancelled' | 'failed';
  stageCollection?: z.infer<typeof stageCollectionSchema>;
}

/** 任务事件仅传递有界数值和枚举，不能夹带 SQL、参数或错误正文。 */
export const mysqlQueryStatusReportSchema = z.object({
  entries: z.array(z.object({
    ordinal: z.number().int().min(1).max(mysqlQueryStatusLimit),
    status: z.enum(['completed', 'failed']),
    elapsedMs: z.number().finite().nonnegative(),
    traffic: z.object({
      sent: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      received: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    }).strict().optional(),
    stages: z.object({ rows: z.array(mysqlQueryStageSchema).min(1).max(mysqlQueryStageLimit), limited: z.boolean() }).strict().optional(),
  }).strict()).max(mysqlQueryStatusLimit),
  omitted: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  termination: z.enum(['cancelled', 'failed']).optional(),
  stageCollection: stageCollectionSchema.optional(),
}).strict().refine(report => report.entries.every((entry, index) => entry.ordinal === index + 1));
