import { txtExportOptionsSchema, txtExportZh, validTxtExport } from './txtExport';
import { z } from 'zod';
import { csvExportDelimiters } from './csvExport';
import { queryParameterTypes, validateQueryParameters, type QueryParameterNames } from './queryParameters';
import { postgresNewIdentifier } from './postgresCreateTable';
import { currentPostgresStatement, splitPostgresParameterSql } from './postgresSql';
import { postgresParameterPlan } from './postgresParameters';
import { dataFileFormats, dataMarkupText } from './dataMarkupExport';
import { EXCEL_LIMITS } from './excelTransfer';

const parameters = z.array(z.object({name: z.string(), type: z.enum(queryParameterTypes), value: z.string().optional()}).strict())
  .max(200).superRefine((values, context) => {
    try { validateQueryParameters(values, 38); }
    catch { context.addIssue({code: 'custom', message: 'PostgreSQL 导出参数类型或预算无效'}); }
  });

const postgresQueryInsertColumns = z.array(postgresNewIdentifier).min(1).max(1024)
  .refine(names => new Set(names).size === names.length, 'PostgreSQL INSERT 目标字段不能重名');
export const postgresQueryInsertTargetSchema = z.object({
  schema: postgresNewIdentifier, table: postgresNewIdentifier, columns: postgresQueryInsertColumns.optional(),
}).strict();

/** 使用带双引号的标识符，大小写不同的名称各自保留。 */
export function postgresQueryInsertColumnsForResult(target: z.infer<typeof postgresQueryInsertTargetSchema>, source: string[]): string[] {
  const columns = target.columns ?? source;
  if (columns.length !== source.length) throw Error('PostgreSQL INSERT 目标字段数必须与查询结果列数一致');
  if (!postgresQueryInsertColumns.safeParse(columns).success) throw Error('PostgreSQL INSERT 字段名无效或重复，请填写唯一的目标字段或修改查询别名');
  return columns;
}

export const postgresQueryExportSchema = z.object({
  connectionId: z.string().min(1).max(200), database: z.string().min(1).max(256),
  taskId: z.string().min(1).max(200), fileToken: z.string().min(1).max(200),
  sql: z.string().min(1).max(4 * 1024 * 1024), format: z.enum(['csv', 'json', 'xlsx', 'sql', ...dataFileFormats]),
  encoding: z.enum(['utf8', 'utf16le', 'gb18030']), csvDelimiter: z.enum(csvExportDelimiters).optional(), txtOptions: txtExportOptionsSchema.optional(),
  parameters: parameters.optional(), insertTarget: postgresQueryInsertTargetSchema.optional(),
}).strict()
  .refine(validTxtExport, txtExportZh.invalid)
  .refine(input => input.csvDelimiter === undefined || input.format === 'csv', '分隔符仅用于 CSV 导出')
  .refine(input => input.format === 'sql' ? !!input.insertTarget : input.insertTarget === undefined, '仅 PostgreSQL INSERT SQL 导出需要明确目标')
  .superRefine((input, context) => {
    const markup = dataMarkupText(input.format);
    if (markup && input.encoding !== 'utf8') context.addIssue({ code: 'custom', path: ['encoding'], message: markup.utf8 });
  })
  .refine(input => input.format !== 'xlsx' && input.format !== 'sql' || input.encoding === 'utf8', 'PostgreSQL INSERT SQL 和 Excel 导出使用 UTF-8');

export type PostgresQueryExportInput = z.infer<typeof postgresQueryExportSchema>;
export interface PostgresQueryExportOutput { rows: number; fileCommitted: true; }

/** 导出使用独立会话，只有两种字符串模式都指向同一原语句和参数时才接受。 */
export function postgresCurrentQueryExportSource(source: string, offset: number): string {
  const primary = currentPostgresStatement(source, offset, true, true);
  const alternate = currentPostgresStatement(source, offset, false, true);
  if (offset > primary.end || primary.start !== alternate.start || primary.end !== alternate.end ||
      primary.parameters.length !== alternate.parameters.length ||
      primary.parameters.some((position, index) => position !== alternate.parameters[index]) ||
      JSON.stringify(primary.namedParameters) !== JSON.stringify(alternate.namedParameters))
    throw Error('当前位置没有边界明确的 PostgreSQL 导出语句');
  if (!['SELECT', 'WITH'].includes(primary.keyword))
    throw Error('请将光标放在要完整导出的 PostgreSQL SELECT 或 WITH 语句中');
  const end = source[primary.end] === ';' ? primary.end + 1 : primary.end;
  return source.slice(primary.start, end);
}

/** 保留每条原查询，为独立游标准备有序绑定，工作簿内同名或同编号复用输入。 */
export function postgresQueryExportStatements(sql: string, standardStrings: boolean, workbook = false) {
  const statements = splitPostgresParameterSql(sql, standardStrings);
  if (workbook ? statements.length < 1 || statements.length > EXCEL_LIMITS.maxSheets : statements.length !== 1)
    throw Error(workbook ? '完整 Excel 导出需要 1 至 64 条查询' : '完整导出需要一条 SELECT 或 WITH 查询');
  if (statements.some(part => !['SELECT', 'WITH'].includes(part.keyword))) throw Error('完整导出只接受 SELECT 或 WITH 查询');
  return postgresParameterPlan(statements);
}

/** 表单的两种候选字符串模式须同意原范围、绑定 SQL 和参数顺序，独立连接再按实际模式复核。 */
export function postgresExportParameterNames(sql: string, workbook = false): QueryParameterNames {
  const ordinary = postgresQueryExportStatements(sql, true, workbook), escaped = postgresQueryExportStatements(sql, false, workbook);
  if (ordinary.statements.length !== escaped.statements.length || ordinary.statements.some((part, index) => {
    const alternative = escaped.statements[index];
    return part.statement.start !== alternative.statement.start || part.statement.end !== alternative.statement.end ||
      part.sql !== alternative.sql || JSON.stringify(part.names) !== JSON.stringify(alternative.names);
  })) throw Error('导出参数需要边界明确的 PostgreSQL 查询');
  return {names: ordinary.names, warnings: [], maxDecimalScale: 38,
    allowTimeEndpointFraction: false, ansiQuotes: true, noBackslashEscapes: true};
}
