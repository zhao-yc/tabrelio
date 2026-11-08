import { txtExportOptionsSchema } from './txtExport';
import { dataFileFormats, dataMarkupFormats, dataMarkupText, xmlRecordLayouts } from './dataMarkupExport';
import { z } from 'zod';
import { csvExportDelimiters } from './csvExport';
import { postgresQueryInsertTargetSchema } from './postgresQueryExport';
import { sqliteQueryInsertTargetSchema } from './sqliteQueryExport';
import { queryInsertTargetSchema } from './queryInsertExport';
import { queryStreamExportLimits } from './queryStreamExport';

export const fullQueryExportProfileLimits = { count: 32, name: 80, bytes: 2 * 1024 * 1024 };
const name = z.string().trim().min(1).max(fullQueryExportProfileLimits.name)
  .refine(value => !/[\p{Cc}]/u.test(value), '方案名称不能包含控制字符');
const encoding = z.enum(['utf8', 'utf16le', 'gb18030']);
const revision = z.string().uuid();
export const fullQueryExportProfileScope = z.object({
  dialect: z.enum(['sqlite', 'postgresql', 'mysql', 'mariadb']), area: z.literal('table').optional(),
}).strict();

const delimiter = z.enum(csvExportDelimiters);
const ordinal = z.number().int().min(1).max(queryStreamExportLimits.results);
export const queryStreamProfileSettingsSchema = z.discriminatedUnion('format', [
  z.object({ format: z.literal('csv'), encoding, delimiter, ordinal }).strict(),
  z.object({ format: z.literal('csv-zip'), encoding, delimiter }).strict(),
  z.object({ format: z.literal('json'), encoding }).strict(),
  z.object({ format: z.literal('txt'), encoding, txtOptions: txtExportOptionsSchema, ordinal }).strict(),
  z.object({ format: z.enum(xmlRecordLayouts), ordinal }).strict(),
  z.object({ format: z.enum(['xlsx', 'html', 'xml']) }).strict(),
  z.object({ format: z.literal('sql'), encoding, target: queryInsertTargetSchema }).strict(),
]);

// 只保存精确列名及顺序。查询条件、对象标识和授权继续由当前表页提供。
const tableSettings = z.object({
  format: z.enum(['csv', 'json', 'xlsx', 'sql', 'copy', 'sql-backup', ...dataFileFormats]), encoding,
  columns: z.array(z.string().min(1).max(512).refine(value => !value.includes('\0'))).max(queryStreamExportLimits.columns),
  delimiter: delimiter.optional(), txtOptions: txtExportOptionsSchema.optional(),
  sqlContent: z.enum(['data', 'structure', 'structure-data']).optional(),
}).strict().refine(value => {
  const { format, columns, encoding, delimiter, txtOptions, sqlContent } = value;
  const whole = format === 'sql-backup' || sqlContent === 'structure';
  const fixedEncoding = format === 'xlsx' || format === 'copy' || format === 'sql-backup' || !!dataMarkupText(format);
  return (columns.length === 0) === whole && new Set(columns).size === columns.length &&
    (delimiter !== undefined) === (format === 'csv' || format === 'copy') &&
    (txtOptions !== undefined) === (format === 'txt') &&
    (sqlContent === undefined || format === 'sql') && (!fixedEncoding || encoding === 'utf8');
}, '表数据导出方案的格式或字段无效');

// 仅持久化格式参数，严格拒绝 SQL、绑定值、连接及文件授权等额外字段。
const options = z.discriminatedUnion('format', [
  z.object({ format: z.literal('csv'), encoding, delimiter }).strict(),
  z.object({ format: z.literal('json'), encoding }).strict(),
  z.object({ format: z.literal('txt'), encoding, txtOptions: txtExportOptionsSchema }).strict(),
  z.object({ format: z.enum(['xlsx', ...dataMarkupFormats]) }).strict(),
  z.object({ format: z.literal('sql'), target: z.union([sqliteQueryInsertTargetSchema, postgresQueryInsertTargetSchema]) }).strict(),
  z.object({ format: z.literal('stream'), settings: queryStreamProfileSettingsSchema }).strict(),
  z.object({ format: z.literal('table'), settings: tableSettings }).strict(),
]);
const profile = z.object({ name, options }).strict();
const stored = profile.extend({ revision });

const selection = z.object({ name, revision }).strict();
export const fullQueryExportProfileMutation = z.discriminatedUnion('kind', [
  fullQueryExportProfileScope.extend({ kind: z.literal('add'), profile }).strict(),
  fullQueryExportProfileScope.extend({ kind: z.literal('update'), selected: selection, profile }).strict(),
  fullQueryExportProfileScope.extend({ kind: z.literal('delete'), selected: selection }).strict(),
]).refine(input => input.kind === 'delete' || matchesScope(input, input.profile.options), '导出选项与方案的使用范围不一致');

export type FullQueryExportProfileScope = z.infer<typeof fullQueryExportProfileScope>;
export type FullQueryExportDialect = FullQueryExportProfileScope['dialect'];
export type FullQueryExportOptions = z.infer<typeof options>;
export type TableExportProfileSettings = z.infer<typeof tableSettings>;
export type FullQueryExportProfile = z.infer<typeof stored>;
export type FullQueryExportProfileMutation = z.infer<typeof fullQueryExportProfileMutation>;

function matchesScope({ dialect, area }: FullQueryExportProfileScope, value: FullQueryExportOptions): boolean {
  if (area === 'table') {
    if (value.format !== 'table') return false;
    const settings = value.settings;
    if (dialect === 'postgresql') return settings.sqlContent === undefined && settings.columns.length <= 1022 &&
      (settings.format !== 'sql' || settings.encoding === 'utf8');
    return settings.format !== 'copy' && settings.format !== 'sql-backup' &&
      (settings.sqlContent === undefined || dialect === 'sqlite');
  }
  if (value.format === 'table') return false;
  if (dialect === 'mysql' || dialect === 'mariadb') return value.format === 'stream';
  if (value.format === 'stream') return false;
  return value.format !== 'sql' || ('database' in value.target) === (dialect === 'sqlite');
}

/** 从对话框生成最小格式选项，未完成的投影不能保存成方案。 */
export function tableExportProfileOptions(value: TableExportProfileSettings): FullQueryExportOptions | undefined {
  const { format, encoding, columns, delimiter, txtOptions, sqlContent } = value;
  const result = tableSettings.safeParse({
    format, encoding, columns,
    ...(format === 'csv' || format === 'copy' ? { delimiter } : {}),
    ...(format === 'txt' ? { txtOptions } : {}),
    ...(format === 'sql' && sqlContent !== undefined ? { sqlContent } : {}),
  });
  return result.success ? { format: 'table', settings: result.data } : undefined;
}

/** 查询和表页按数据库类型独立保存，损坏或未知版本不静默覆盖。 */
export function readFullQueryExportProfiles(scope: FullQueryExportProfileScope, data: string): FullQueryExportProfile[] {
  if (new TextEncoder().encode(data).length > fullQueryExportProfileLimits.bytes) throw Error('导出方案总大小不能超过 2 MiB');
  const { profiles } = z.object({ version: z.literal(1), profiles: z.array(stored).max(fullQueryExportProfileLimits.count) }).strict().parse(JSON.parse(data));
  if (new Set(profiles.map(item => item.name)).size !== profiles.length || profiles.some(item => !matchesScope(scope, item.options)))
    throw Error('导出方案中存在重名或不匹配的使用范围');
  return profiles;
}
