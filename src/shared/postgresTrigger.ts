import { z } from 'zod';
import { postgresDdlText, postgresNewIdentifier } from './postgresCreateTable';
import { assertPostgresCheckExpression } from './postgresSql';

export const postgresTriggerEvents = ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] as const;
export const postgresTriggerModeSchema = z.enum(['O', 'D', 'R', 'A']);
export type PostgresTriggerMode = z.infer<typeof postgresTriggerModeSchema>;
const existingName = z.string().min(1).max(512).refine(value => !value.includes('\0'));

const create = z.object({
  kind: z.literal('create'),
  name: postgresNewIdentifier,
  timing: z.enum(['BEFORE', 'AFTER']),
  events: z.array(z.enum(postgresTriggerEvents)).min(1).max(4),
  level: z.enum(['ROW', 'STATEMENT']),
  updateOf: z.array(existingName).max(64),
  condition: z.string().max(16384).optional(),
  functionSchema: existingName,
  functionName: existingName,
  args: z.array(postgresDdlText).max(16),
}).strict().superRefine((draft, context) => {
  const issue = (message: string) => context.addIssue({ code: 'custom', message });
  if (new Set(draft.events).size !== draft.events.length || new Set(draft.updateOf).size !== draft.updateOf.length)
    issue('触发事件和字段不能重复');
  if (draft.level === 'ROW' && draft.events.includes('TRUNCATE')) issue('TRUNCATE 只支持语句级触发器');
  if (draft.updateOf.length && !draft.events.includes('UPDATE')) issue('指定 UPDATE 字段时须选择 UPDATE 事件');
  if (draft.condition !== undefined) {
    try { assertPostgresCheckExpression(draft.condition, 'WHEN'); }
    catch (reason) { issue((reason as Error).message); }
  }
});

export const postgresTriggerChangeSchema = z.discriminatedUnion('kind', [
  create,
  z.object({ kind: z.literal('rename'), from: existingName, name: postgresNewIdentifier }).strict(),
  z.object({ kind: z.literal('mode'), from: existingName, mode: postgresTriggerModeSchema }).strict(),
  z.object({ kind: z.literal('drop'), from: existingName }).strict(),
]);
export type PostgresTriggerChange = z.infer<typeof postgresTriggerChangeSchema>;
