import { z } from 'zod';

/** 补全仅传有界标识符，不接收SQL正文、文件路径、凭据或执行内容。 */
export const sqliteCompletionLimits = { entries: 256, sourceUnits: 262144, tokens: 16384, depth: 64, suggestions: 256, relations: 16, nameUnits: 512, prefixUnits: 128, outputBytes: 2 * 1024 * 1024, active: 8 } as const;
/** 高频目录任务只保留活动账本；专属命名空间确保迟到取消永不进入网络数据库驱动。 */
export const sqliteCompletionTaskPrefix = 'sqlite-completion:';
const unicode = (value: string) => !value.includes('\0') && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
const name = z.string().min(1).max(sqliteCompletionLimits.nameUnits).refine(value => value.length <= sqliteCompletionLimits.nameUnits && unicode(value));
const id = z.string().min(1).max(200).refine(value => value.length <= 200 && unicode(value));
const schema = z.enum(['main', 'temp']);
const functionName = z.string().max(sqliteCompletionLimits.prefixUnits).regex(/^[a-z][a-z0-9_]*$/);
const functionSignatures = z.array(z.object({ arity: z.number().int().min(-32768).max(32767), type: z.enum(['scalar', 'aggregate', 'window']) }).strict()).min(1).max(sqliteCompletionLimits.entries)
  .refine(value => new Set(value.map(({ arity, type }) => type + ':' + arity)).size === value.length);
export const sqliteAlterColumnMode = z.enum(['rename', 'drop', 'nullability']);
const columnMode = { tableFunction: z.literal(true).optional(), indexTable: z.literal(true).optional(), alterColumn: sqliteAlterColumnMode.optional() };
const oneColumnMode = (value: { tableFunction?: true; indexTable?: true; alterColumn?: z.infer<typeof sqliteAlterColumnMode> }) =>
  [value.tableFunction, value.indexTable, value.alterColumn].filter(Boolean).length <= 1;
const base = { connectionId: id, sessionId: id.optional(), taskId: id.refine(value => value.startsWith(sqliteCompletionTaskPrefix) && value.length > sqliteCompletionTaskPrefix.length), prefix: z.string().max(sqliteCompletionLimits.prefixUnits).refine(value => value.length <= sqliteCompletionLimits.prefixUnits && unicode(value)) };
export const sqliteCompletionInputSchema = z.discriminatedUnion('kind', [
  z.object({ ...base, kind: z.literal('relations'), schema: schema.optional(), indexTable: z.literal(true).optional(), alterTable: z.literal(true).optional() }).strict()
    .refine(value => !(value.indexTable && value.alterTable)),
  z.object({ ...base, kind: z.literal('columns'), schema: schema.optional(), table: name, ...columnMode }).strict().refine(oneColumnMode),
  z.object({ ...base, kind: z.literal('indexes'), schema: schema.optional(), table: name }).strict(),
  z.object({ ...base, kind: z.literal('functions'), prefix: base.prefix.regex(/^[a-z][a-z0-9_]*$/i), deterministicOnly: z.literal(true).optional() }).strict(),
  z.object({ ...base, kind: z.literal('collations') }).strict(),
  z.object({ ...base, kind: z.literal('stamp') }).strict(),
]);
export const sqliteCompletionEntrySchema = z.discriminatedUnion('kind', [
  z.object({ name, kind: z.enum(['table', 'view']), schema }).strict(),
  z.object({ name, kind: z.literal('column'), schema, table: name, declaredType: z.string().max(4096).refine(value => value.length <= 4096 && unicode(value)), generated: z.boolean(), hidden: z.boolean() }).strict(),
  z.object({ name, kind: z.literal('index'), schema, table: name, unique: z.boolean(), partial: z.boolean(), origin: z.enum(['c', 'u', 'pk']) }).strict(),
  z.object({ name: functionName, kind: z.literal('function'), signatures: functionSignatures }).strict(),
  z.object({ name, kind: z.literal('collation') }).strict(),
]);
export const sqliteCompletionOutputSchema = z.object({ entries: z.array(sqliteCompletionEntrySchema).max(sqliteCompletionLimits.entries), incomplete: z.boolean(), stamp: z.string().regex(/^-?\d{1,10}:-?\d{1,10}$/), sessionRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional() }).strict().refine(value => new TextEncoder().encode(JSON.stringify(value)).byteLength <= sqliteCompletionLimits.outputBytes, 'SQLite补全目录超过传输预算');
export type SqliteCompletionInput = z.infer<typeof sqliteCompletionInputSchema>;
export type SqliteCompletionEntry = z.infer<typeof sqliteCompletionEntrySchema>;
export type SqliteCompletionOutput = z.infer<typeof sqliteCompletionOutputSchema>;
type Lookup<T> = T extends SqliteCompletionInput ? Omit<T, 'connectionId' | 'sessionId' | 'taskId'> : never;
export type SqliteCompletionLookup = Lookup<SqliteCompletionInput>;
export const sqliteCompletionTableSchema = z.object({ name, schema: schema.optional() }).strict();
export type SqliteCompletionTable = z.infer<typeof sqliteCompletionTableSchema>;
export const sqliteCompletionSourceSchema = sqliteCompletionTableSchema.extend(columnMode).refine(oneColumnMode);
export type SqliteCompletionSource = z.infer<typeof sqliteCompletionSourceSchema>;

/** 所有列入口带上调用标记，只传来源和前缀。函数参数留在编辑器内。 */
export function sqliteCompletionColumns({ name, schema, tableFunction, indexTable, alterColumn }: SqliteCompletionSource, prefix: string): Extract<SqliteCompletionLookup, { kind: 'columns' }> {
  return { kind: 'columns', table: name, prefix, ...(schema ? { schema } : {}), ...(tableFunction ? { tableFunction } : {}),
    ...(indexTable ? { indexTable } : {}), ...(alterColumn ? { alterColumn } : {}) };
}

export function sqliteCompletionIndexes({ name, schema }: SqliteCompletionTable, prefix: string): Extract<SqliteCompletionLookup, { kind: 'indexes' }> {
  return { kind: 'indexes', table: name, prefix, ...(schema ? { schema } : {}) };
}

export function sqliteCompletionSourceKey({ name, schema, tableFunction, indexTable, alterColumn }: SqliteCompletionSource): string {
  return (tableFunction ? 'function' : indexTable ? 'index-table' : alterColumn ?? 'relation') + '\0' + (schema ?? '') + '\0' + foldSqliteCompletionName(name);
}

/** SQLite名称只折叠ASCII字母；Unicode不借JavaScript区域规则合并成另一标识符。 */
export function foldSqliteCompletionName(value: string): string { return value.replace(/[A-Z]/g, letter => letter.toLowerCase()); }
/** 建议始终插入单个双引号标识符，不是Monaco片段，也不能成为SQL命令。 */
export function quoteSqliteCompletionName(value: string): string { name.parse(value); return '"' + value.replaceAll('"', '""') + '"'; }
