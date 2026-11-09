import { z } from 'zod';

const id = z.string().min(1).max(200);
const columnReference = z.object({
  relation: z.number().int().min(1).max(0xffffffff),
  attribute: z.number().int().min(-32768).max(32767).refine(value => value !== 0),
}).strict();

export const postgresResultOriginsSchema = z.object({
  sessionId: id, connectionId: id, database: id, columns: z.array(columnReference.nullable()).min(1).max(1024),
}).strict();
export type PostgresResultOriginsInput = z.infer<typeof postgresResultOriginsSchema>;
export type PostgresColumnReference = z.infer<typeof columnReference> | null;
export type PostgresResultOrigin = { schema: string; table: string; column: string; canOpen: boolean } | null;
