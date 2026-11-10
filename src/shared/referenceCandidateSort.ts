import { z } from 'zod';

export const referenceCandidateSortSchema = z.object({
  column: z.string().min(1).max(1024).refine(name => !name.includes('\0') && !/[\uD800-\uDFFF]/u.test(name)),
  direction: z.enum(['ASC', 'DESC']),
}).strict();
export type ReferenceCandidateSort = z.infer<typeof referenceCandidateSortSchema>;
