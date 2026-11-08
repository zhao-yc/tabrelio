import { z } from 'zod';
import { postgresCreateTableSchemasSchema, postgresDdlLiteral, postgresDdlText, postgresNewIdentifier } from './postgresCreateTable';
import { postgresStructureInputSchema } from './postgresStructure';
import { postgresIdentifier, splitPostgresSql } from './postgresSql';

const sqlBudget = 128 * 1024;
const definitionSchema = z.string().min(1).max(sqlBudget).refine(value =>
  new TextEncoder().encode(value).length <= sqlBudget && !/[\u0000\uD800-\uDFFF]/u.test(value), '视图定义须为 128 KiB 内有效文本');
const viewColumnName = z.string().min(1).max(63).refine(value =>
  new TextEncoder().encode(value).length <= 63 && !/[\u0000\uD800-\uDFFF]/u.test(value),
'输出列名须为 1～63 个 UTF-8 字节');
export const postgresViewColumnsSchema = z.array(viewColumnName).max(1600).refine(names =>
  new Set(names).size === names.length, '输出列名不能重复');

export const postgresCreateViewPreviewSchema = postgresCreateTableSchemasSchema.extend({
  schema: postgresNewIdentifier,
  view: postgresNewIdentifier,
  definition: definitionSchema,
  columnNames: postgresViewColumnsSchema.optional(),
  comment: postgresDdlText,
  materialized: z.object({ populate: z.boolean() }).strict().optional(),
}).strict();
export type PostgresCreateViewKind = 'ordinary' | 'materialized';
export type PostgresCreateViewInput = z.infer<typeof postgresCreateViewPreviewSchema>;
export const postgresEditViewPreviewSchema = postgresStructureInputSchema.extend({
  definition: definitionSchema,
  columnNames: postgresViewColumnsSchema.optional(),
  stamp: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type PostgresEditViewInput = z.infer<typeof postgresEditViewPreviewSchema>;
export const postgresViewQueryInspectSchema = postgresCreateTableSchemasSchema.extend({
  definition: definitionSchema,
  columnNames: postgresViewColumnsSchema.optional(),
  mode: z.enum(['rows', 'explain']),
}).strict();
export type PostgresViewQueryInspectInput = z.infer<typeof postgresViewQueryInspectSchema>;
export const postgresViewQuerySampleRows = 100;

const viewManageTarget = postgresStructureInputSchema.extend({
  stamp: z.string().regex(/^[a-f0-9]{64}$/),
  relationKind: z.literal('materialized').optional(),
});
export const postgresViewManagePreviewSchema = z.discriminatedUnion('action', [
  viewManageTarget.extend({ action: z.literal('rename'), name: postgresNewIdentifier }).strict(),
  viewManageTarget.extend({ action: z.literal('drop') }).strict(),
]);
export type PostgresViewManageInput = z.infer<typeof postgresViewManagePreviewSchema>;

/** 统一使用同一个词法边界保留有效的单条查询定义。 */
export function postgresViewQuery(definition: string): string {
  const [query, extra] = splitPostgresSql(definition);
  if (!query || extra || query.parameters.length || !['SELECT', 'WITH', 'VALUES', 'TABLE'].includes(query.keyword))
    throw Error('视图定义须为单条不含位置参数的 SELECT、WITH、VALUES 或 TABLE 查询');
  // 行尾注释后预留换行，保证预览脚本的分号仍有语法意义。
  return query.sql.trim() + '\n';
}

/** 文件载入先核对正文预算和单条查询边界，保留原文供设计器预览。 */
export function preparePostgresViewDefinition(definition: string): string {
  postgresViewQuery(definitionSchema.parse(definition));
  return definition;
}

export function postgresViewColumnsSql(names: readonly string[] | undefined): string {
  return names?.length ? ' (' + names.map(postgresIdentifier).join(', ') + ')' : '';
}

/** 定义只允许一条不带参数的查询，保留字符串、注释和美元引号原文。 */
export function postgresCreateViewPlan(raw: PostgresCreateViewInput) {
  const input = postgresCreateViewPreviewSchema.parse(raw);
  if (input.schema.startsWith('pg_') || input.schema === 'information_schema') throw Error('请选择普通用户 schema');
  const table = postgresIdentifier(input.schema) + '.' + postgresIdentifier(input.view);
  const type = input.materialized ? 'MATERIALIZED VIEW ' : 'VIEW ';
  const fill = input.materialized ? input.materialized.populate ? 'WITH DATA' : 'WITH NO DATA' : '';
  const statements = ['CREATE ' + type + table + postgresViewColumnsSql(input.columnNames) + ' AS\n' + postgresViewQuery(input.definition) + fill];
  if (input.comment) statements.push('COMMENT ON ' + type + table + ' IS ' + postgresDdlLiteral(input.comment));
  return { table, statements };
}
