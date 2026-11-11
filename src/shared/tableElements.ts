import { z } from 'zod';

const identifier = (length: number) => z.string().min(1).max(length).refine(value => !value.includes('\0'));
/** 树节点只按原连接和表读取目录，不接收用户 SQL、会话或编辑参数。 */
export const tableElementsTargetSchema = z.object({
  connectionId: identifier(200),
  database: identifier(256),
  table: identifier(512),
}).strict();
export type TableElementsTarget = z.infer<typeof tableElementsTargetSchema>;

type ForeignKeyIdentity = { name: string; ordinal?: never } | { name?: never; ordinal: number };
export interface TableElements {
  columns: { name: string; type: string; primary: boolean; generated: boolean }[];
  indexes: { name: string; unique: boolean; primary: boolean; partial?: boolean }[];
  foreignKeys: (ForeignKeyIdentity & {
    reference?: { namespace?: string; table: string; pairs: { local: string; remote: string | null }[] };
  })[];
}
