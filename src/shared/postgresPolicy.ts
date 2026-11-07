import { z } from 'zod';
import { postgresNewIdentifier } from './postgresCreateTable';
import { assertPostgresCheckExpression } from './postgresSql';

export const postgresPolicyCommands = ['ALL', 'SELECT', 'INSERT', 'UPDATE', 'DELETE'] as const;
const command = z.enum(postgresPolicyCommands);
const name = z.string().min(1).max(512).refine(value => !/[\u0000\uD800-\uDFFF]/u.test(value));
const oid = z.string().regex(/^\d+$/);
const expression = (label: string) => z.string().max(16384).superRefine((value, context) => {
  try { assertPostgresCheckExpression(value, label); }
  catch (reason) { context.addIssue({ code: 'custom', message: (reason as Error).message }); }
});

const definition = z.object({
  command, permissive: z.boolean(),
  roles: z.array(name).min(1).max(64).nullable(),
  using: expression('USING').nullable(),
  check: expression('WITH CHECK').nullable(),
}).strict().superRefine((draft, context) => {
  const issue = (message: string) => context.addIssue({ code: 'custom', message });
  if (draft.roles && new Set(draft.roles).size !== draft.roles.length) issue('策略角色不能重复');
  if (draft.command === 'INSERT' && draft.using !== null) issue('INSERT 策略仅支持 WITH CHECK');
  if ((draft.command === 'SELECT' || draft.command === 'DELETE') && draft.check !== null)
    issue('SELECT 和 DELETE 策略仅支持 USING');
});
export type PostgresPolicyDefinition = z.infer<typeof definition>;
export const postgresPolicyChangeSchema = z.discriminatedUnion('kind', [
  definition.safeExtend({ kind: z.literal('create'), name: postgresNewIdentifier }),
  definition.safeExtend({ kind: z.literal('edit'), from: name }),
  z.object({ kind: z.literal('rename'), from: name, name: postgresNewIdentifier }).strict(),
  z.object({ kind: z.literal('drop'), from: name }).strict(),
  z.object({ kind: z.literal('state'), enabled: z.boolean(), forced: z.boolean() }).strict(),
]);
export type PostgresPolicyChange = z.infer<typeof postgresPolicyChangeSchema>;
export const postgresPolicyCatalogSchema = z.object({
  oid, name, command, permissive: z.boolean(), roles: z.array(z.object({ oid, name }).strict()).min(1),
  using: z.string().nullable(), check: z.string().nullable(), comment: z.string().nullable(), rebuildBlocked: z.boolean(),
}).strict();
export type PostgresPolicyCatalog = z.infer<typeof postgresPolicyCatalogSchema>;

/** ALTER POLICY 只能替换已明确提供的条件，清除条件或改命令、类型需要原事务内重建。 */
export function postgresPolicyRequiresReplacement(old: PostgresPolicyCatalog, draft: PostgresPolicyDefinition): boolean {
  return old.command !== draft.command || old.permissive !== draft.permissive ||
    (old.using !== null && draft.using === null) || (old.check !== null && draft.check === null);
}
