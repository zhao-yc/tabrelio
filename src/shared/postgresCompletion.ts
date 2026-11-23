import { z } from 'zod';

export const postgresCompletionLimits = { source: 64 * 1024, tokens: 4096, items: 120, relations: 8, name: 256 } as const;
export const postgresJoinColumnLimit = 256;
const text = z.string().max(postgresCompletionLimits.name).refine(value => !value.includes('\0'));
const name = text.refine(value => value.length > 0);
const target = z.object({ connectionId: name, database: name, prefix: text, sessionId: name.optional() });
const fieldIdentifier = name.refine(value => !/[\uD800-\uDFFF]/u.test(value) && new TextEncoder().encode(value).length <= 63);
const catalogRelation = z.object({ name: fieldIdentifier, schema: fieldIdentifier.optional() }).strict();
export type PostgresCatalogRelation = z.infer<typeof catalogRelation>;
const conflictSelection = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('constraint'), allowExclusion: z.literal(true).optional() }).strict(),
  z.object({ mode: z.literal('key'), used: z.array(fieldIdentifier).max(31)
    .refine(items => new Set(items).size === items.length) }).strict(),
]);
export type PostgresConflictSelection = z.infer<typeof conflictSelection>;
const functionCall = z.object({
  argumentCount: z.number().int().min(0).max(postgresCompletionLimits.tokens), scalarAlias: name.optional(),
}).strict();
const functionMember = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('function'), schema: name.optional(), name, call: functionCall }).strict(),
  z.object({ kind: z.literal('declared'), names: z.array(name).min(1).max(postgresCompletionLimits.items) }).strict(),
  z.object({ kind: z.literal('unknown') }).strict(),
]);
const functionLayout = z.object({
  aliasCount: z.number().int().min(1).max(postgresCompletionLimits.tokens), ordinality: z.literal(true).optional(),
  members: z.array(functionMember).min(1).max(postgresCompletionLimits.relations),
}).strict();
export const postgresCompletionReferenceSchema = z.object({ schema: name.optional(), name,
  functionCall: functionCall.optional(), functionLayout: functionLayout.optional(),
  columnAccess: z.enum(['select', 'insert', 'update']).optional(),
}).strict().refine(ref => !(ref.functionCall && ref.functionLayout) &&
  (!ref.columnAccess || !ref.functionCall && !ref.functionLayout));
export type PostgresCompletionReference = z.infer<typeof postgresCompletionReferenceSchema>;
const routine = z.object({ context: z.enum(['expression', 'from', 'call']), schema: name.optional() }).strict();
export type PostgresRoutineCompletionTarget = z.infer<typeof routine>;

/** 只接受解析后的目录目标，绝不把编辑器 SQL 交给数据库补全入口。 */
export const postgresCompletionSchema = z.discriminatedUnion('kind', [
  target.extend({ kind: z.literal('relations'), schema: name.optional(), routine: routine.optional(), mergeTarget: z.literal(true).optional() }).strict(),
  target.extend({ kind: z.literal('columns'), relations: z.array(postgresCompletionReferenceSchema).min(1).max(postgresCompletionLimits.relations),
    routine: routine.optional() }).strict(),
  target.extend({ kind: z.literal('columnDetails'), prefix: fieldIdentifier,
    relations: z.array(catalogRelation).min(1).max(postgresCompletionLimits.relations) }).strict(),
  target.extend({ kind: z.literal('joinColumns'), prefix: z.literal(''),
    relations: z.array(catalogRelation).min(1).max(postgresCompletionLimits.relations) }).strict(),
  target.extend({ kind: z.literal('conflictTargets'), relation: catalogRelation, selection: conflictSelection }).strict(),
  target.extend({ kind: z.literal('routines'), routine }).strict(),
  target.extend({ kind: z.literal('signatures'), prefix: name, routine }).strict(),
]);
export type PostgresCompletionInput = z.infer<typeof postgresCompletionSchema>;
export const postgresRoutineParameterSchema = z.object({
  name: z.string().nullable(), type: z.string().min(1), mode: z.enum(['i', 'o', 'b', 'v', 't']),
}).strict();
export type PostgresRoutineParameter = z.infer<typeof postgresRoutineParameterSchema> & { optional: boolean };
export type PostgresCompletionItem =
  | { kind: 'schema'; name: string }
  | { kind: 'table' | 'view'; schema: string; name: string }
  | { kind: 'column'; reference: number; name: string; type: string }
  | { kind: 'joinColumns'; reference: number; names: string[] }
  | { kind: 'conflictConstraint'; name: string; constraint: 'primary' | 'unique' | 'exclusion' }
  | { kind: 'conflictKey'; name: string; columns: string[]; primary: boolean }
  | { kind: 'columnDetail'; reference: number; name: string; schema: string; relation: string; type: string;
    nullable: boolean; expression: string | null; generated: boolean; comment: string | null; temporary: boolean }
  | { kind: 'routine'; schema: string; name: string; arguments: string; returns: string | null; category: 'f' | 'p' | 'a' | 'w';
    parameters?: PostgresRoutineParameter[]; directArguments?: number };
export interface PostgresCompletionResult {
  items: PostgresCompletionItem[];
  incomplete: boolean;
  deferred?: 'transaction' | 'busy';
}
