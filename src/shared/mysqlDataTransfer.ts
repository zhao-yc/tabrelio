import { z } from 'zod';
import { mysqlBackupDatabase, mysqlBackupTableName } from './mysqlDatabaseBackup';

export const mysqlDataTransferTitle = 'MySQL／MariaDB 数据传输';
export const mysqlDataTransferLimits = { tables: 32, rows: 10000, bytes: 16 * 1024 * 1024, rowBytes: 1024 * 1024, definitionBytes: 2 * 1024 * 1024, ttlMs: 120000 } as const;
const id = z.string().min(1).max(200);
export const mysqlDataTransferEndpointSchema = z.object({ connectionId: id, database: mysqlBackupDatabase }).strict();
export const mysqlDataTransferPreviewSchema = z.object({
  taskId: id, source: mysqlDataTransferEndpointSchema, target: mysqlDataTransferEndpointSchema,
  tables: z.array(mysqlBackupTableName).min(1).max(mysqlDataTransferLimits.tables).refine(tables => new Set(tables.map(table => table.toLowerCase())).size === tables.length),
  content: z.enum(['schema', 'all']),
}).strict().refine(input => input.source.connectionId !== input.target.connectionId || input.source.database.toLowerCase() !== input.target.database.toLowerCase(),
  '请选择不同的源端和目标端');
export const mysqlDataTransferApplySchema = z.object({
  taskId: id, previewId: z.uuid(), source: mysqlDataTransferEndpointSchema, target: mysqlDataTransferEndpointSchema,
  confirmation: mysqlBackupDatabase, acknowledge: z.literal(true),
}).strict();
export const mysqlDataTransferReleaseSchema = z.object({ previewId: z.uuid() }).strict();
export type MysqlDataTransferEndpoint = z.infer<typeof mysqlDataTransferEndpointSchema>;
export type MysqlDataTransferPreviewInput = z.infer<typeof mysqlDataTransferPreviewSchema>;
export type MysqlDataTransferApplyInput = z.infer<typeof mysqlDataTransferApplySchema>;
export interface MysqlDataTransferPreview {
  previewId: string; expiresAt: string; sourceVersion: string; targetVersion: string;
  tables: { name: string; sql: string }[];
}
export interface MysqlDataTransferResult {
  status: 'completed' | 'incomplete' | 'unknown';
  tables: { name: string; structure: 'pending' | 'submitted' | 'created'; rows: number | null }[];
  message?: string;
}
