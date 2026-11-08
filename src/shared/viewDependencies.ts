import { z } from 'zod';
import { completionIdentifier } from './completionLexical';

export const mysqlViewDependenciesSchema = z.object({
  connectionId: z.string().min(1).max(128),
  database: z.string().refine(completionIdentifier),
  name: z.string().refine(completionIdentifier),
}).strict();
export const sqliteViewDependenciesSchema = z.object({
  connectionId: z.string().min(1).max(200),
  database: z.literal('main'),
  name: z.string().min(1).max(512).refine(value => !/[\u0000\uD800-\uDFFF]/u.test(value)),
}).strict();
export type SqliteViewDependenciesInput = z.infer<typeof sqliteViewDependenciesSchema>;
export type MysqlViewDependenciesInput = z.infer<typeof mysqlViewDependenciesSchema>;
export interface ViewDependency { database: string; name: string; }
export interface ViewDependencies {
  source: 'catalogue' | 'definitions';
  referenced: ViewDependency[];
  referencing: ViewDependency[];
  skipped: number;
  referencedUnknown: boolean;
  truncated: boolean;
}
