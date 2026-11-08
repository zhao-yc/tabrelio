import { z } from 'zod';
import { completionIdentifier } from './completionLexical';

export const mysqlViewDependenciesSchema = z.object({
  connectionId: z.string().min(1).max(128),
  database: z.string().refine(completionIdentifier),
  name: z.string().refine(completionIdentifier),
}).strict();
export type MysqlViewDependenciesInput = z.infer<typeof mysqlViewDependenciesSchema>;
export interface MysqlViewDependency { database: string; name: string; }
export interface MysqlViewDependencies {
  source: 'catalogue' | 'definitions';
  referenced: MysqlViewDependency[];
  referencing: MysqlViewDependency[];
  skipped: number;
  referencedUnknown: boolean;
  truncated: boolean;
}
