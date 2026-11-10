import { z } from 'zod';
import { queryBuilderColumnAliasesSchema } from './queryBuilderProjection';
import { foreignKeyJoinSqlAlias, type ForeignKeyJoinSide } from './tableForeignKeyJoinSources';

export const mysqlQueryProjectionLimit = 1024;
export const mysqlQueryProjectionSchema = z.array(queryBuilderColumnAliasesSchema.element
  .extend({ alias: queryBuilderColumnAliasesSchema.element.shape.alias
    .refine(value => value.trimEnd() === value, 'MySQL／MariaDB 的输出别名末尾不能是空白。').optional() }))
  .min(1).max(mysqlQueryProjectionLimit);
export type MysqlQueryProjection = z.infer<typeof mysqlQueryProjectionSchema>;

/** 列键绑定来源位置；重复关联同一物理表时，输出仍能各自改名及排序。 */
export const mysqlQueryOutputKey = (side: ForeignKeyJoinSide, column: string) => foreignKeyJoinSqlAlias(side) + '.' + column;

export function mysqlSelectedOutputKeys(child: readonly string[], parent: readonly string[] = [],
  extra: readonly { columns: readonly string[] }[] = []): string[] {
  return [...child.map(name => mysqlQueryOutputKey('child', name)), ...parent.map(name => mysqlQueryOutputKey('parent', name)),
    ...extra.flatMap((item, index) => item.columns.map(name => mysqlQueryOutputKey(`t${index + 3}`, name)))];
}

/** 显式顺序必须是选中字段的完整排列，避免错列设计悄悄生成另一条查询。 */
export function assertMysqlQueryProjection(projection: MysqlQueryProjection, selected: readonly string[]) {
  const remaining = new Set(selected);
  if (projection.length !== selected.length || projection.some(item => !remaining.delete(item.column)))
    throw Error('输出顺序必须恰好包含每个已选字段一次。');
}
