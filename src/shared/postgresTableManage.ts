import { z } from 'zod';
import { postgresCreateTableApplySchema, postgresDdlText, postgresNewIdentifier } from './postgresCreateTable';
import { postgresStructureInputSchema } from './postgresStructure';
import { postgresSequenceInteger } from './postgresSequence';
import { postgresTriggerChangeSchema } from './postgresTrigger';
import { postgresPolicyChangeSchema } from './postgresPolicy';

const target = postgresStructureInputSchema.extend({ stamp: z.string().regex(/^[a-f0-9]{64}$/) });
const identityMode = z.enum(['always', 'byDefault']);
const identityChange = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('add'), mode: identityMode, start: postgresSequenceInteger }).strict(),
  z.object({ kind: z.literal('mode'), mode: identityMode }).strict(),
  z.object({ kind: z.literal('restart'), value: postgresSequenceInteger.optional() }).strict(),
  z.object({ kind: z.literal('drop') }).strict(),
]);
export type PostgresIdentityChange = z.infer<typeof identityChange>;
const commentTarget = target.extend({ action: z.literal('comment'),
  value: postgresDdlText.nullable().optional(),
  columns: z.array(z.object({
    position: z.number().int().min(1).max(2000),
    name: postgresStructureInputSchema.shape.table,
    value: postgresDdlText.nullable(),
  }).strict()).max(64),
}).strict().refine(draft => draft.value !== undefined || draft.columns.length > 0, '至少编辑一项注释')
  .refine(draft => new Set(draft.columns.map(column => column.position)).size === draft.columns.length, '字段注释不能重复')
  .refine(draft => [draft.value, ...draft.columns.map(column => column.value)]
    .reduce<number>((bytes, value) => bytes + new TextEncoder().encode(value ?? '').byteLength, 0) <= 128 * 1024, '注释草稿超过 128 KiB');
export const postgresTableManagePreviewSchema = z.discriminatedUnion('action', [
  target.extend({ action: z.literal('rename'), name: postgresNewIdentifier }).strict(),
  target.extend({ action: z.literal('move'), schema: postgresNewIdentifier }).strict(),
  target.extend({ action: z.literal('drop') }).strict(),
  target.extend({ action: z.literal('truncate'), identity: z.enum(['continue', 'restart']) }).strict(),
  commentTarget,
  target.extend({ action: z.literal('trigger'), change: postgresTriggerChangeSchema }).strict(),
  target.extend({ action: z.literal('policy'), change: postgresPolicyChangeSchema }).strict(),
  target.extend({ action: z.literal('identity'), position: z.number().int().min(1).max(2000),
    name: postgresStructureInputSchema.shape.table, change: identityChange }).strict(),
]);
export const postgresTableManageApplySchema = postgresCreateTableApplySchema.extend({ confirmed: z.literal(true) });
export type PostgresTableManageInput = z.infer<typeof postgresTableManagePreviewSchema>;
export type PostgresTableManageApply = z.infer<typeof postgresTableManageApplySchema>;
