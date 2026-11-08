import { z } from 'zod';

const identity = z.string().min(1).max(128).refine(value => !value.includes('\0'));
export const mysqlSqlFileTitle = '执行 MySQL／MariaDB SQL 文件';
export const mysqlSqlFileMaxBytes = 10 * 1024 ** 3;
export const mysqlSqlFileEncodings = ['utf8', 'utf16le', 'gb18030'] as const;
export const mysqlSqlFileChooseSchema = z.object({
  connectionId: identity,
  database: z.string().min(1).refine(value => [...value].length <= 64 && !value.includes('\0')).nullable(),
  encoding: z.enum(mysqlSqlFileEncodings),
}).strict();
export const mysqlSqlFileExecuteSchema = mysqlSqlFileChooseSchema.extend({
  fileToken: z.uuid(), taskId: identity, acknowledgeScript: z.literal(true),
});
export const mysqlSqlFilePickSchema = mysqlSqlFileChooseSchema.or(mysqlSqlFileChooseSchema.pick({ encoding: true }));
export const mysqlSqlInspectionVersion = z.string().regex(/^\d{1,2}\.\d{1,2}\.\d{1,2}$/);
export const mysqlSqlFileCancelInspectionSchema = z.object({ operationId: z.uuid() }).strict();
export const mysqlSqlFileInspectionSchema = mysqlSqlFileCancelInspectionSchema.extend({
  fileToken: z.uuid(), family: z.enum(['mysql', 'mariadb']), version: mysqlSqlInspectionVersion,
}).strict();
export type MysqlSqlFileChooseInput = z.infer<typeof mysqlSqlFileChooseSchema>;
export type MysqlSqlFileExecuteInput = z.infer<typeof mysqlSqlFileExecuteSchema>;
export type MysqlSqlFilePickInput = z.infer<typeof mysqlSqlFilePickSchema>;
export type MysqlSqlFileInspectionInput = z.infer<typeof mysqlSqlFileInspectionSchema>;
export interface MysqlSqlFileChoice { token: string; name: string; bytes: number }
export interface MysqlSqlFileInspection {
  statements: number;
  structure: number;
  changes: number;
  destructive: number;
  databaseActions: { action: 'use' | 'create' | 'drop'; name: string }[];
  moreDatabases: boolean;
  issue?: { reason: 'lexical' | 'encoding' | 'file' | 'budget' | 'cancelled' | 'client'; nextStatement: number };
}
