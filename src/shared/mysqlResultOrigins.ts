import { z } from 'zod';

const id = z.string().min(1).max(200);
export const mysqlResultOriginOpenSchema = z.object({
  connectionId: id, sessionId: id, executionId: id, taskId: id,
  resultIndex: z.number().int().min(0).max(199), columnIndex: z.number().int().min(0).max(4095),
}).strict();
export type MysqlResultOriginOpenInput = z.infer<typeof mysqlResultOriginOpenSchema>;

export interface MysqlResultOriginTarget { database: string; table: string; column: string; }
export type MysqlResultColumnOrigin = (MysqlResultOriginTarget & { scope: 'catalog' | 'temporary' | 'unverified' }) | null;
