import { z } from 'zod';
import { completionIdentifier, quoteCompletionIdentifier } from './completionLexical';
import { mysqlViewDependenciesSchema } from './viewDependencies';

export const mysqlViewRenamePreviewSchema = mysqlViewDependenciesSchema.extend({
  newName: z.string().refine(completionIdentifier),
}).strict().refine(input => input.name !== input.newName, '新视图名称须与原名称不同');
export const mysqlViewRenameApplySchema = z.object({ token: z.string().uuid(), confirmed: z.literal(true) }).strict();
export type MysqlViewRenameTarget = z.infer<typeof mysqlViewRenamePreviewSchema>;
export interface MysqlViewRenamePreview { token: string; sql: string; sourceDdl: string; }
export interface MysqlViewRenameResult { verified: boolean; }

/** 只生成同库单对象的原生改名语句；两个标识符分别转义。 */
export function mysqlViewRenameSql(raw: MysqlViewRenameTarget): string {
  const { database, name, newName } = mysqlViewRenamePreviewSchema.parse(raw);
  const db = quoteCompletionIdentifier(database);
  return `RENAME TABLE ${db}.${quoteCompletionIdentifier(name)} TO ${db}.${quoteCompletionIdentifier(newName)};`;
}
