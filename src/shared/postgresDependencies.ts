import { z } from 'zod';

const identifier = z.string().min(1).max(256).refine(value => !/[\0\ud800-\udfff]/u.test(value));
export const postgresDependencyRelationSchema = z.object({
  oid: z.string().regex(/^[1-9]\d{0,9}$/).refine(value => Number(value) <= 0xffffffff),
  kind: z.enum(['r', 'p', 'v', 'm', 'f']),
  schema: identifier,
  name: identifier,
}).strict();
export type PostgresDependencyRelation = z.infer<typeof postgresDependencyRelationSchema>;

export const postgresDependencySchema = z.object({
  direction: z.enum(['referencedBy', 'references']),
  kind: z.string().min(1).nullable(),
  identity: z.string().min(1).nullable(),
  type: z.string().length(1),
  relation: postgresDependencyRelationSchema.optional(),
}).strict();

export type PostgresDependency = z.infer<typeof postgresDependencySchema>;
export type PostgresDependencies = { entries: PostgresDependency[]; limited: boolean };
