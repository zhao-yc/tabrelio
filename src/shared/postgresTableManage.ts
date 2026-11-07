import { z } from 'zod';
import { postgresCreateTableApplySchema, postgresNewIdentifier } from './postgresCreateTable';
import { postgresStructureInputSchema } from './postgresStructure';

const target = postgresStructureInputSchema.extend({ stamp: z.string().regex(/^[a-f0-9]{64}$/) });
export const postgresTableManagePreviewSchema = z.discriminatedUnion('action', [
  target.extend({ action: z.literal('rename'), name: postgresNewIdentifier }).strict(),
  target.extend({ action: z.literal('drop') }).strict(),
]);
export const postgresTableManageApplySchema = postgresCreateTableApplySchema.extend({ confirmed: z.literal(true) });
export type PostgresTableManageInput = z.infer<typeof postgresTableManagePreviewSchema>;
export type PostgresTableManageApply = z.infer<typeof postgresTableManageApplySchema>;
