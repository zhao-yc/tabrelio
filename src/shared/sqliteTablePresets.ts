import { z } from 'zod';
import { sqliteTableBrowseLimits, sqliteTablePageSchema, type SqliteTablePageInput } from './sqliteTableBrowse';
import { strictTableLayoutPreferences, tablePreferencesLimits } from './tablePreferences';

export const sqliteTablePresetLimits = { name: 80, perTarget: 20, targets: 500, entries: 500, entryBytes: 1024 * 1024, totalBytes: 8 * 1024 * 1024 } as const;
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1), digest = z.string().regex(/^[a-f0-9]{64}$/);
export const sqliteTablePresetTargetSchema = z.object({ connectionId: sqliteTablePageSchema.shape.connectionId, database: z.literal('main'), table: sqliteTablePageSchema.shape.table }).strict();
/** 只保存有界条件、排序和页长；不包含偏移、SQL、文件路径、行数据或写入能力。 */
export const sqliteTablePresetQuerySchema = z.object({ limit: sqliteTablePageSchema.shape.limit, mode: sqliteTablePageSchema.shape.mode, filters: sqliteTablePageSchema.shape.filters, sort: sqliteTablePageSchema.shape.sort }).strict().superRefine((query, context) => {
  const parsed = sqliteTablePageSchema.safeParse({ ...query, connectionId: 'preset-validation', database: 'main', table: 'preset-validation', taskId: 'preset-validation', offset: 0 });
  if (!parsed.success) for (const issue of parsed.error.issues) context.addIssue({ code: 'custom', path: issue.path, message: issue.message });
});
const name = sqliteTablePageSchema.shape.table.pipe(z.string().max(sqliteTablePresetLimits.name)).refine(value => value.trim().length > 0 && !/[\u0000-\u001f\u007f]/u.test(value), '方案名称不能为空或包含控制字符');
const entryShape = z.object({ id: z.string().uuid(), name, connectionDigest: digest, query: sqliteTablePresetQuerySchema }).strict();
function checkEntryBytes(value: z.infer<typeof entryShape>, context: z.RefinementCtx): void {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > sqliteTablePresetLimits.entryBytes) context.addIssue({ code: 'custom', message: '单项SQLite方案超过1MiB上限' });
}
const entry = entryShape.superRefine(checkEntryBytes);
export const sqliteTableLayoutPreferenceShape = strictTableLayoutPreferences(sqliteTablePageSchema.shape.table, sqliteTableBrowseLimits.columns);
const presetLayout = sqliteTableLayoutPreferenceShape.refine(value => value.columns.length > 0 &&
  new TextEncoder().encode(JSON.stringify(value)).byteLength <= tablePreferencesLimits.entryBytes, 'SQLite方案布局须包含可见列且不能超过512 KiB');
export const sqliteTablePresetLayoutsSchema = z.array(z.object({ id: z.uuid(), digest, layout: presetLayout }).strict())
  .max(sqliteTablePresetLimits.perTarget).refine(items => new Set(items.map(item => item.id)).size === items.length, 'SQLite方案布局编号重复');
// 查询和布局使用各自的单项预算，读取快照与旧文档持久化的校验一致。
const profileEntry = entryShape.extend({ layout: presetLayout.optional() }).superRefine(({ layout: _layout, ...value }, context) => checkEntryBytes(value, context));
export const sqliteTablePresetDocumentSchema = z.object({ version: z.literal(1), target: sqliteTablePresetTargetSchema, revision, entries: z.array(entry).max(sqliteTablePresetLimits.perTarget) }).strict().superRefine((document, context) => {
  if (new Set(document.entries.map(value => value.id)).size !== document.entries.length || new Set(document.entries.map(value => value.name)).size !== document.entries.length) context.addIssue({ code: 'custom', message: 'SQLite方案名称或编号重复' });
});
export const sqliteTablePresetSourceSchema = z.object({ connectionRevision: revision, connectionDigest: digest }).strict();
export const sqliteTablePresetSnapshotSchema = sqliteTablePresetDocumentSchema.safeExtend({
  entries: z.array(profileEntry).max(sqliteTablePresetLimits.perTarget), source: sqliteTablePresetSourceSchema, bindingToken: z.string().uuid(),
});
const checked = sqliteTablePresetTargetSchema.extend({ expectedRevision: revision, source: sqliteTablePresetSourceSchema, bindingToken: z.string().uuid() }).strict();
export const sqliteTablePresetSaveSchema = checked.extend({ name, query: sqliteTablePresetQuerySchema, layout: presetLayout.optional(), replaceId: z.string().uuid().optional() }).strict();
export const sqliteTablePresetSelectSchema = checked.extend({ id: z.string().uuid() }).strict();
export type SqliteTablePresetTarget = z.infer<typeof sqliteTablePresetTargetSchema>;
export type SqliteTablePresetQuery = Pick<SqliteTablePageInput, 'limit' | 'mode' | 'filters' | 'sort'>;
export type SqliteTablePresetProfile = SqliteTablePresetQuery & { layout?: z.infer<typeof presetLayout> };
export type SqliteTablePresetDocument = z.infer<typeof sqliteTablePresetDocumentSchema>;
export type SqliteTablePresetSource = z.infer<typeof sqliteTablePresetSourceSchema>;
export type SqliteTablePresetSnapshot = z.infer<typeof sqliteTablePresetSnapshotSchema>;
export type SqliteTablePresetStoredSnapshot = Omit<SqliteTablePresetSnapshot, 'bindingToken'>;
export type SqliteTablePresetSave = z.infer<typeof sqliteTablePresetSaveSchema>;
export type SqliteTablePresetSelect = z.infer<typeof sqliteTablePresetSelectSchema>;

/** 整份校验字段，包括停用条件；缺列不静默删除，也不执行元数据或数据查询。 */
export function validateSqlitePresetColumns(raw: unknown, columns: readonly string[]): SqliteTablePresetQuery {
  const query = sqliteTablePresetQuerySchema.parse(raw), names = new Set(columns);
  if (query.filters.some(filter => !names.has(filter.column)) || query.sort.some(sort => !names.has(sort.column))) throw Error('方案字段已不存在，未载入条件；请刷新结构或修改方案');
  return query;
}

/** 附带布局的方案也核对准确列名；任一缺失拒绝整份。 */
export function validateSqlitePresetProfile(raw: SqliteTablePresetProfile, columns: readonly string[]): SqliteTablePresetProfile {
  const { layout, ...query } = raw;
  const admitted = validateSqlitePresetColumns(query, columns);
  if (layout === undefined) return admitted;
  const preferences = presetLayout.parse(layout), names = new Set(columns);
  if (preferences.columns.some(column => !names.has(column.name))) throw Error('SQLite方案布局中的字段已不存在，整份方案未载入');
  return { ...admitted, layout: preferences };
}
