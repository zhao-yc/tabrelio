import { z } from 'zod';
import { postgresDdlText, postgresNewIdentifier } from './postgresCreateTable';
import { assertPostgresCheckExpression, scanPostgresEditorTokens } from './postgresSql';
import type { PostgresStructureResult, PostgresStructureTrigger } from './postgresStructure';

export const postgresTriggerEvents = ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] as const;
export const postgresTriggerModeSchema = z.enum(['O', 'D', 'R', 'A']);
export type PostgresTriggerMode = z.infer<typeof postgresTriggerModeSchema>;
// 位掩码与 PostgreSQL pg_trigger.h 中的事件、时机和级别一致。
export const postgresTriggerEventBits = { INSERT: 4, DELETE: 8, UPDATE: 16, TRUNCATE: 32 } as const;
export const postgresTriggerReplaceMinimum = 140000;
const existingName = z.string().min(1).max(512).refine(value => !value.includes('\0'));

const definition = z.object({
  timing: z.enum(['BEFORE', 'AFTER']),
  events: z.array(z.enum(postgresTriggerEvents)).min(1).max(4),
  level: z.enum(['ROW', 'STATEMENT']),
  updateOf: z.array(existingName).max(64),
  condition: z.string().max(16384).optional(),
  functionSchema: existingName,
  functionName: existingName,
  args: z.array(postgresDdlText).max(16),
  oldTable: postgresNewIdentifier.optional(),
  newTable: postgresNewIdentifier.optional(),
}).strict().superRefine((draft, context) => {
  const issue = (message: string) => context.addIssue({ code: 'custom', message });
  if (new Set(draft.events).size !== draft.events.length || new Set(draft.updateOf).size !== draft.updateOf.length)
    issue('触发事件和字段不能重复');
  if (draft.level === 'ROW' && draft.events.includes('TRUNCATE')) issue('TRUNCATE 只支持语句级触发器');
  if (draft.updateOf.length && !draft.events.includes('UPDATE')) issue('指定 UPDATE 字段时须选择 UPDATE 事件');
  if (draft.oldTable || draft.newTable) {
    const [event] = draft.events;
    if (draft.timing !== 'AFTER' || draft.events.length !== 1 || draft.updateOf.length || event === 'TRUNCATE')
      issue('过渡表需要单事件 AFTER 触发器，且不能限定 UPDATE 字段');
    if ((draft.oldTable && event === 'INSERT') || (draft.newTable && event === 'DELETE') ||
        (draft.oldTable && draft.oldTable === draft.newTable)) issue('过渡表别名与触发事件不兼容或重复');
  }
  if (draft.condition !== undefined) {
    try { assertPostgresCheckExpression(draft.condition, 'WHEN'); }
    catch (reason) { issue((reason as Error).message); }
  }
});

export const postgresTriggerChangeSchema = z.discriminatedUnion('kind', [
  definition.safeExtend({ kind: z.literal('create'), name: postgresNewIdentifier }),
  definition.safeExtend({ kind: z.literal('replace'), from: existingName }),
  z.object({ kind: z.literal('rename'), from: existingName, name: postgresNewIdentifier }).strict(),
  z.object({ kind: z.literal('mode'), from: existingName, mode: postgresTriggerModeSchema }).strict(),
  z.object({ kind: z.literal('drop'), from: existingName }).strict(),
]);
export type PostgresTriggerChange = z.infer<typeof postgresTriggerChangeSchema>;
export type PostgresTriggerDefinition = z.infer<typeof definition>;

/** 目录提供身份和字段序号，反编译文本只用于读取带引号的 WHEN 和 TG_ARGV。 */
export function postgresTriggerEditorDraft(trigger: PostgresStructureTrigger,
  columns: PostgresStructureResult['columns']): PostgresTriggerDefinition | undefined {
  if (trigger.internal || trigger.inherited || trigger.constraint || trigger.extensionBound ||
      !trigger.functionSchema || !trigger.functionName || trigger.eventBits & ~63 || trigger.definition.length > 256 * 1024) return;
  const source = trigger.definition;
  const tokens = scanPostgresEditorTokens(source, 16384, true);
  if (!tokens?.length || tokens.some(token => token.open)) return;
  let execute = tokens.length - 2;
  while (execute >= 0 && !(tokens[execute].kind === 'word' && tokens[execute].text === 'EXECUTE' &&
    tokens[execute + 1].kind === 'word' && tokens[execute + 1].text === 'FUNCTION')) execute--;
  const punct = (index: number, value: string) => tokens[index]?.kind === 'punct' && tokens[index].text === value;
  if (execute < 0 || !punct(tokens.length - 1, ')')) return;
  const opening = tokens.findIndex((token, index) => index > execute + 2 && token.kind === 'punct' && token.text === '(');
  if (opening < 0) return;
  const args: string[] = [];
  for (let index = opening + 1; index < tokens.length - 1; index += 2) {
    const token = tokens[index];
    const raw = source.slice(token.start, token.end);
    if (token.kind !== 'blocked' || !raw.startsWith("'") || (index + 1 < tokens.length - 1 &&
        (!punct(index + 1, ',') || index + 2 >= tokens.length - 1))) return;
    // pg_get_triggerdef 在 standard_conforming_strings=on 时只加倍单引号。
    args.push(raw.slice(1, -1).replaceAll("''", "'"));
  }
  if (args.length !== trigger.argumentCount) return;
  let condition: string | undefined;
  if (trigger.conditional) {
    const when = tokens.findIndex((token, index) => index < execute && token.kind === 'word' &&
      token.text === 'WHEN' && punct(index + 1, '('));
    if (when < 0 || !punct(execute - 1, ')')) return;
    condition = source.slice(tokens[when + 1].end, tokens[execute - 1].start);
  }
  const result = definition.safeParse({
    timing: trigger.eventBits & 2 ? 'BEFORE' : 'AFTER', level: trigger.eventBits & 1 ? 'ROW' : 'STATEMENT',
    events: postgresTriggerEvents.filter(event => trigger.eventBits & postgresTriggerEventBits[event]),
    updateOf: trigger.updatePositions.map(position => columns.find(column => column.position === position)?.name),
    functionSchema: trigger.functionSchema, functionName: trigger.functionName, condition, args,
    oldTable: trigger.oldTable ?? undefined, newTable: trigger.newTable ?? undefined,
  });
  return result.success ? result.data : undefined;
}
