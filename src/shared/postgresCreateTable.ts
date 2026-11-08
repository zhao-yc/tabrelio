import { z } from 'zod';
import { assertPostgresCheckExpression, postgresIdentifier } from './postgresSql';

const utf8 = new TextEncoder();
const key = z.string().min(1).max(512).refine(value => !value.includes('\0'));
export const postgresNewIdentifier = z.string().min(1).max(63).refine(value =>
  utf8.encode(value).byteLength <= 63 && !/[\u0000-\u001f\u007f\uD800-\uDFFF]/u.test(value) && !!value.trim(),
'标识符不能为空，且最多允许 63 个 UTF-8 字节');
export const postgresDdlText = z.string().max(4096).refine(value => !/[\u0000\uD800-\uDFFF]/u.test(value));
const target = z.object({ connectionId: key, database: key }).strict();

export const postgresCreateTypes = [
  'bigint', 'integer', 'smallint', 'text', 'varchar', 'numeric', 'boolean', 'date', 'timestamp',
  'timestamptz', 'uuid', 'jsonb', 'bytea', 'real', 'double precision',
] as const;
const type = z.enum(postgresCreateTypes);
const integerTypes = new Set<string>(['bigint', 'integer', 'smallint']);
export const postgresColumnTypeSchema = z.object({
  type,
  length: z.number().int().min(1).max(10485760).optional(),
  precision: z.number().int().min(1).max(1000).optional(),
  scale: z.number().int().min(0).max(1000).optional(),
}).strict().superRefine((field, context) => {
  const issue = (message: string) => context.addIssue({ code: 'custom', message });
  if (field.length !== undefined && field.type !== 'varchar') issue('只有 varchar 支持长度');
  if ((field.precision !== undefined || field.scale !== undefined) && field.type !== 'numeric') issue('只有 numeric 支持精度和小数位');
  if (field.scale !== undefined && (field.precision === undefined || field.scale > field.precision)) issue('numeric 小数位不能超过精度');
});
export type PostgresColumnType = z.infer<typeof postgresColumnTypeSchema>;
export const postgresDefaultPresetSchema = z.enum(['currentDate', 'currentTimestamp', 'randomUuid', 'timeOrderedUuid']);
export type PostgresDefaultPreset = z.infer<typeof postgresDefaultPresetSchema>;
export const postgresDefaultPresets = postgresDefaultPresetSchema.options;
export const postgresDefaultPresetSql: Record<PostgresDefaultPreset, string> = {
  currentDate: 'CURRENT_DATE', currentTimestamp: 'CURRENT_TIMESTAMP',
  randomUuid: 'pg_catalog.gen_random_uuid()', timeOrderedUuid: 'pg_catalog.uuidv7()',
};
export type PostgresColumnDefault =
  { mode: 'none' | PostgresDefaultPreset } | { mode: 'literal'; value: string };
export const postgresGenerationExpressionSchema = z.string().max(16384).superRefine((value, context) => {
  try { assertPostgresCheckExpression(value, '生成列'); }
  catch (reason) { context.addIssue({ code: 'custom', message: (reason as Error).message }); }
});
const postgresColumnGenerationSchema = z.object({
  mode: z.enum(['stored', 'virtual']), expression: postgresGenerationExpressionSchema,
}).strict();
export type PostgresColumnGeneration = z.infer<typeof postgresColumnGenerationSchema>;

export function postgresGenerationMinimum(mode: PostgresColumnGeneration['mode']): number {
  return mode === 'virtual' ? 180000 : 120000;
}

/** 建表类型与目录类型的拼写不同，且已有时间戳列可能带精度。 */
export function acceptsPostgresDefaultPreset(type: string, preset: PostgresDefaultPreset): boolean {
  if (preset === 'currentDate') return type === 'date';
  if (preset === 'currentTimestamp') return type === 'timestamp' || type === 'timestamptz' ||
    /^timestamp(?:\(\d+\))? (?:with|without) time zone$/.test(type);
  return type === 'uuid';
}

/** 目录读取使用 pg_catalog 搜索路径，内置函数可能省略其 schema。 */
export function matchesPostgresDefaultPreset(expression: unknown, preset: PostgresDefaultPreset): boolean {
  const sql = postgresDefaultPresetSql[preset];
  return expression === sql || (sql.startsWith('pg_catalog.') && expression === sql.slice('pg_catalog.'.length));
}

export const postgresCreateColumnSchema = postgresColumnTypeSchema.safeExtend({
  name: postgresNewIdentifier, nullable: z.boolean(), primary: z.boolean(), unique: z.boolean(),
  identity: z.enum(['none', 'always', 'byDefault']),
  generation: postgresColumnGenerationSchema.optional(),
  default: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('none') }).strict(), z.object({ mode: z.literal('literal'), value: postgresDdlText }).strict(),
    z.object({ mode: postgresDefaultPresetSchema }).strict(),
  ]),
  comment: postgresDdlText,
}).superRefine((field, context) => {
  const issue = (message: string) => context.addIssue({ code: 'custom', message });
  if (field.identity !== 'none' && (!integerTypes.has(field.type) || field.default.mode !== 'none')) issue('标识列需要整数类型，且不能另设默认值');
  if (field.generation && (field.identity !== 'none' || field.default.mode !== 'none')) issue('生成列不能同时设置标识属性或普通默认值');
  const mode = field.default.mode;
  if (mode !== 'none' && mode !== 'literal' && !acceptsPostgresDefaultPreset(field.type, mode))
    issue(postgresDefaultPresetSql[mode] + ' 与字段类型不兼容');
});

export const postgresPartitionStrategies = ['range', 'list', 'hash'] as const;
const partitionValue = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('value'), value: postgresDdlText }).strict(),
  z.object({ kind: z.literal('min') }).strict(),
  z.object({ kind: z.literal('max') }).strict(),
]);
const bounds = {
  default: z.object({ kind: z.literal('default') }).strict(),
  range: z.object({ kind: z.literal('range'), from: z.array(partitionValue).min(1).max(32),
    to: z.array(partitionValue).min(1).max(32) }).strict(),
  list: z.object({ kind: z.literal('list'), values: z.array(postgresDdlText.nullable()).min(1).max(128) }).strict(),
  hash: z.object({ kind: z.literal('hash'), modulus: z.number().int().min(1).max(2147483647),
    remainder: z.number().int().min(0).max(2147483646) }).strict(),
};
const childName = { name: postgresNewIdentifier };
export const postgresPartitionBoundSchema = z.discriminatedUnion('kind', [bounds.default, bounds.range, bounds.list, bounds.hash]);
export const postgresPartitionChildSchema = z.discriminatedUnion('kind', [
  bounds.default.extend(childName), bounds.range.extend(childName), bounds.list.extend(childName), bounds.hash.extend(childName),
]);
export type PostgresPartitionBound = z.infer<typeof postgresPartitionBoundSchema>;
const partitionSchema = z.object({
  strategy: z.enum(postgresPartitionStrategies),
  keys: z.array(postgresNewIdentifier).min(1).max(32),
  children: z.array(postgresPartitionChildSchema).max(32),
}).strict();
export type PostgresPartitionDesign = z.infer<typeof partitionSchema>;
export type PostgresPartitionValue = z.infer<typeof partitionValue>;

/** 复用建表和维护的边界规则，返回需要计入请求预算的文字字节数。 */
export function validatePostgresPartitionBound(child: PostgresPartitionBound, strategy: PostgresPartitionDesign['strategy'],
  keyCount: number, issue: (message: string) => void): number {
  if (child.kind !== strategy && (child.kind !== 'default' || strategy === 'hash'))
    issue('子分区类型必须与分区策略匹配，HASH 不支持默认分区');
  let bytes = 0;
  if (child.kind === 'range') {
    for (const tuple of [child.from, child.to]) {
      if (tuple.length !== keyCount) issue('RANGE 上下界的值数必须与分区键一致');
      const unbounded = tuple.findIndex(value => value.kind !== 'value');
      if (unbounded >= 0 && tuple.slice(unbounded).some(value => value.kind !== tuple[unbounded].kind))
        issue('MINVALUE 或 MAXVALUE 后的分区键必须使用相同边界');
      for (const value of tuple) if (value.kind === 'value') bytes += utf8.encode(value.value).byteLength;
    }
  } else if (child.kind === 'list') {
    if (new Set(child.values).size !== child.values.length) issue('同一 LIST 子分区的值不能重复');
    for (const value of child.values) if (value !== null) bytes += utf8.encode(value).byteLength;
  } else if (child.kind === 'hash' && child.remainder >= child.modulus) issue('HASH 余数必须小于模数');
  return bytes;
}

/** 只有预定义语法和转义后的数据进入服务器边界表达式。 */
export function postgresPartitionBoundSql(child: PostgresPartitionBound): string {
  const tuple = (values: PostgresPartitionValue[]) => '(' + values.map(value =>
    value.kind === 'value' ? postgresDdlLiteral(value.value) : value.kind === 'min' ? 'MINVALUE' : 'MAXVALUE').join(', ') + ')';
  if (child.kind === 'default') return 'DEFAULT';
  if (child.kind === 'range') return 'FOR VALUES FROM ' + tuple(child.from) + ' TO ' + tuple(child.to);
  if (child.kind === 'list') return 'FOR VALUES IN (' + child.values.map(value => value === null ? 'NULL' : postgresDdlLiteral(value)).join(', ') + ')';
  return 'FOR VALUES WITH (MODULUS ' + child.modulus + ', REMAINDER ' + child.remainder + ')';
}

/** 表单只提交结构化字段；分区边界作为数据传入，不能成为 SQL 片段。 */
export const postgresCreateTablePreviewSchema = target.extend({
  schema: postgresNewIdentifier, table: postgresNewIdentifier, columns: z.array(postgresCreateColumnSchema).min(1).max(128), comment: postgresDdlText,
  partition: partitionSchema.optional(),
}).strict().superRefine((input, context) => {
  if (input.schema.startsWith('pg_') || input.schema === 'information_schema') context.addIssue({ code: 'custom', message: '请选择普通用户 schema' });
  if (new Set(input.columns.map(field => field.name)).size !== input.columns.length) context.addIssue({ code: 'custom', message: '字段名称不能重复' });
  if (input.columns.filter(field => field.primary).length > 32) context.addIssue({ code: 'custom', message: '主键最多允许 32 列' });
  let textSize = input.columns.reduce((total, field) => total + utf8.encode(field.comment).byteLength +
    (field.default.mode === 'literal' ? utf8.encode(field.default.value).byteLength : 0) +
    (field.generation ? utf8.encode(field.generation.expression).byteLength : 0), utf8.encode(input.comment).byteLength);
  const partition = input.partition;
  if (partition) {
    const issue = (message: string) => context.addIssue({ code: 'custom', path: ['partition'], message });
    const { strategy, keys, children } = partition;
    if (strategy === 'list' && keys.length !== 1) issue('LIST 分区只能选择一个字段');
    if (new Set(keys).size !== keys.length || keys.some(key => !input.columns.some(field => field.name === key && !field.generation)))
      issue('请选择互不重复、存在且不是生成列的分区键');
    if (input.columns.some(field => field.primary) && keys.some(key => !input.columns.some(field => field.name === key && field.primary)))
      issue('分区表的主键必须包含全部分区键');
    if (input.columns.some(field => field.unique && (keys.length !== 1 || keys[0] !== field.name)))
      issue('单字段唯一约束必须包含全部分区键');
    if (new Set([input.table, ...children.map(child => child.name)]).size !== children.length + 1)
      issue('父表和子分区的名称不能重复');
    if (children.filter(child => child.kind === 'default').length > 1) issue('同一父表只能有一个默认分区');
    for (const child of children) textSize += validatePostgresPartitionBound(child, strategy, keys.length, issue);
  }
  if (textSize > 128 * 1024) context.addIssue({ code: 'custom', message: '默认值、生成表达式、注释与分区边界超过建表预算' });
});
export const postgresCreateTableSchemasSchema = target;
export const postgresCreateTableApplySchema = target.extend({ token: z.uuid() }).strict();
export type PostgresCreateTableTarget = z.infer<typeof target>;
export type PostgresCreateTableInput = z.infer<typeof postgresCreateTablePreviewSchema>;
export type PostgresCreateColumn = z.infer<typeof postgresCreateColumnSchema>;
export type PostgresCreateTableApply = z.infer<typeof postgresCreateTableApplySchema>;
export interface PostgresTruncateScope { tables: string[]; sequences: string[]; }
export interface PostgresTableMoveScope { indexes: string[]; constraints: string[]; sequences: string[]; }
export interface PostgresCreateTablePreview {
  token: string; statements: string[]; truncateScope?: PostgresTruncateScope; moveScope?: PostgresTableMoveScope;
}
export interface PostgresCreateTableOutcome {
  outcome: 'committed' | 'notSent' | 'rolledBack' | 'unknown';
  message: string;
  table?: string;
  copiedRows?: string;
  identity?: string;
}

/** 显式 E 字符串只含转义后的数据，不依赖服务器 standard_conforming_strings。 */
export function postgresDdlLiteral(value: string): string {
  return "E'" + value.replaceAll('\\', '\\\\').replaceAll("'", "''") + "'";
}

/** 建表和新增列共用同一份字段 SQL 与服务器默认值校验数据。 */
export function postgresColumnDefinition(field: PostgresCreateColumn) {
  const sqlType = postgresColumnTypeSql(field);
  const parts = [postgresIdentifier(field.name), sqlType];
  if (field.identity !== 'none') parts.push(field.identity === 'always' ? 'GENERATED ALWAYS AS IDENTITY' : 'GENERATED BY DEFAULT AS IDENTITY');
  // 换行隔离表达式尾部的行注释，避免吞掉客户端生成的右括号。
  if (field.generation) parts.push('GENERATED ALWAYS AS (\n' + field.generation.expression + '\n) ' + field.generation.mode.toUpperCase());
  if (!field.nullable || field.primary || field.identity !== 'none') parts.push('NOT NULL');
  if (field.unique) parts.push('UNIQUE');
  if (field.default.mode === 'literal') parts.push('DEFAULT ' + postgresDdlLiteral(field.default.value) + '::' + sqlType);
  if (field.default.mode !== 'literal' && field.default.mode !== 'none') parts.push('DEFAULT ' + postgresDefaultPresetSql[field.default.mode]);
  return { sql: parts.join(' '), check: field.default.mode === 'literal'
    ? { name: field.name, type: sqlType, value: field.default.value, length: field.length } : undefined };
}

/** 类型仅由白名单和受限整数构成，不将用户文本当作 SQL 类型表达式。 */
export function postgresColumnTypeSql(field: PostgresColumnType): string {
  if (field.type === 'varchar' && field.length !== undefined) return 'varchar(' + field.length + ')';
  if (field.type === 'numeric' && field.precision !== undefined) return 'numeric(' + field.precision + ', ' + (field.scale ?? 0) + ')';
  return field.type;
}

/** 同一计划生成预览和执行文本，默认值参数先经服务器实际类型校验。 */
export function postgresCreateTablePlan(raw: PostgresCreateTableInput): {
  table: string; statements: string[]; checks: { name: string; type: string; value: string }[];
} {
  const input = postgresCreateTablePreviewSchema.parse(raw);
  const table = postgresIdentifier(input.schema) + '.' + postgresIdentifier(input.table);
  const checks: { name: string; type: string; value: string }[] = [];
  const fields = input.columns.map(field => {
    const { sql, check } = postgresColumnDefinition(field);
    if (check) checks.push({ name: check.name, type: check.type, value: check.value });
    return '  ' + sql;
  });
  const primary = input.columns.filter(field => field.primary).map(field => postgresIdentifier(field.name));
  if (primary.length) fields.push('  PRIMARY KEY (' + primary.join(', ') + ')');
  const partition = input.partition;
  const partitionBy = partition ? ' PARTITION BY ' + partition.strategy.toUpperCase() +
    ' (' + partition.keys.map(postgresIdentifier).join(', ') + ')' : '';
  const statements = ['CREATE TABLE ' + table + ' (\n' + fields.join(',\n') + '\n)' + partitionBy];
  if (partition) {
    // 默认分区最后建立，避免添加每个显式分区时重复验证默认分区。
    const children = [...partition.children.filter(child => child.kind !== 'default'), ...partition.children.filter(child => child.kind === 'default')];
    for (const child of children) statements.push('CREATE TABLE ' + postgresIdentifier(input.schema) + '.' + postgresIdentifier(child.name) +
      ' PARTITION OF ' + table + ' ' + postgresPartitionBoundSql(child));
  }
  if (input.comment) statements.push('COMMENT ON TABLE ' + table + ' IS ' + postgresDdlLiteral(input.comment));
  for (const field of input.columns) if (field.comment) {
    statements.push('COMMENT ON COLUMN ' + table + '.' + postgresIdentifier(field.name) + ' IS ' + postgresDdlLiteral(field.comment));
  }
  return { table, statements, checks };
}
