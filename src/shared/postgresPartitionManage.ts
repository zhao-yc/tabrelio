import { z } from 'zod';
import { postgresCreateTableApplySchema, postgresPartitionBoundSchema, postgresPartitionChildSchema, type PostgresPartitionDesign } from './postgresCreateTable';
import { postgresStructureInputSchema } from './postgresStructure';

const name = z.string().min(1).max(512).refine(value => !/[\u0000\uD800-\uDFFF]/u.test(value));
const target = postgresStructureInputSchema.extend({ stamp: z.string().regex(/^[a-f0-9]{64}$/), schema: name });
export const postgresPartitionManagePreviewSchema = z.discriminatedUnion('action', [
  target.extend({ action: z.literal('create'), child: postgresPartitionChildSchema }).strict(),
  target.extend({ action: z.literal('attach'), bound: postgresPartitionBoundSchema, existingName: name }).strict(),
  target.extend({ action: z.literal('detach'), existingName: name }).strict(),
]);
export const postgresPartitionManageApplySchema = postgresCreateTableApplySchema.extend({ confirmed: z.literal(true) }).strict();
export type PostgresPartitionManagePreview = z.infer<typeof postgresPartitionManagePreviewSchema>;
export type PostgresPartitionManageApply = z.infer<typeof postgresPartitionManageApplySchema>;
export interface PostgresPartitionCatalog {
  stamp: string;
  strategy: PostgresPartitionDesign['strategy'];
  keyDefinition: string;
  keys: (string | null)[];
  manageable: boolean;
  schemas: string[];
  children: { schema: string; name: string; kind: 'r' | 'p' | 'f'; bound: string; pending: boolean }[];
}
