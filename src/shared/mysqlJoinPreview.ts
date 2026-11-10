import { z } from 'zod';
import { completionIdentifier } from './completionLexical';
import type { ForeignKeyJoinOptions, ForeignKeyJoinRelation, ManualJoinStep } from './tableForeignKeyJoin';

export const mysqlJoinSampleRows = 100;
const name = z.string().refine(completionIdentifier);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const target = z.object({ database: name, table: name, digest }).strict();
const step = z.object({ target, source: z.number().int().min(0).max(6), kind: z.enum(['INNER', 'LEFT']),
  pairs: z.array(z.unknown()).min(1).max(64), columns: z.array(name).max(4096), on: z.unknown().optional(),
}).strict();

/** IPC 只接收结构化设计和目录摘要。SQL 由引擎用实时目录编译。 */
export const mysqlJoinPreviewSchema = z.object({
  connectionId: z.string().min(1).max(128),
  taskId: z.string().uuid(),
  mode: z.enum(['rows', 'explain', 'explainText']).optional(),
  source: target,
  parent: target,
  relation: z.union([name, z.array(z.unknown()).min(1).max(64)]),
  kind: z.enum(['INNER', 'LEFT', 'RIGHT']),
  limit: z.number().int().min(1).max(100000),
  options: z.unknown().refine(value => !!value && typeof value === 'object' && !Array.isArray(value) && !('additionalJoins' in value)),
  steps: z.array(step).max(6),
}).strict().superRefine((input, context) => {
  // 列、规则及分组的完整语义由共享生成器复核，先限制整体请求大小。
  try {
    if (new TextEncoder().encode(JSON.stringify(input)).length <= 2 * 1024 * 1024) return;
  } catch { /* 拒绝不可序列化的负载。 */ }
  context.addIssue({ code: 'custom', message: 'JOIN 预览请求超出限制或包含无效结构。' });
});
export type MysqlJoinPreviewInput = z.infer<typeof mysqlJoinPreviewSchema>;
export type MysqlJoinPreviewTarget = MysqlJoinPreviewInput['source'];

/** 这些字段只在引擎得到真实目录后交给结构校验器，绝不作为原 SQL 字符串处理。 */
export function mysqlJoinPreviewOptions(input: MysqlJoinPreviewInput, tables: readonly ManualJoinStep['target'][]): ForeignKeyJoinOptions {
  const options = input.options as ForeignKeyJoinOptions;
  if (!input.steps.length) return options;
  return { ...options, additionalJoins: input.steps.map((value, index) => ({ ...value, target: tables[index] } as ManualJoinStep)) };
}
export function mysqlJoinPreviewRelation(input: MysqlJoinPreviewInput): ForeignKeyJoinRelation {
  return input.relation as ForeignKeyJoinRelation;
}
