import { z } from 'zod';

const name = z.string().min(1).max(512).refine(value =>
  !value.includes('\0') && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value));
export const dataCompareMappingLimit = 64;

/** 映射按显式配对及顺序投影，任意一侧的字段均不得被重复领取。 */
export const dataCompareMappingSchema = z.array(z.object({ source: name, target: name, key: z.boolean() }).strict())
  .min(1).max(dataCompareMappingLimit).refine(items =>
    items.some(item => item.key) &&
    new Set(items.map(item => item.source)).size === items.length &&
    new Set(items.map(item => item.target)).size === items.length,
  '至少标记一对匹配键，且同一字段不能重复映射');
export type DataCompareMapping = z.infer<typeof dataCompareMappingSchema>;
export type CompareSide = 'source' | 'target';

export function mappedKeyNames(mapping: DataCompareMapping, side: CompareSide): string[] {
  return mapping.filter(item => item.key).map(item => item[side]);
}

/** 只从真实目录领取字段。过期或伪造名称不得用于生成 SQL。 */
export function mappedColumns<Column extends { name: string }>(columns: Column[], mapping: DataCompareMapping, side: CompareSide): Column[] {
  const directory = new Map(columns.map(column => [column.name, column]));
  return mapping.map(pair => {
    const column = directory.get(pair[side]);
    if (!column) throw Error((side === 'source' ? '左侧' : '右侧') + '映射字段不存在：' + pair[side]);
    return column;
  });
}

/** 左右互换时保持字段对顺序与联合键标记。 */
export function reverseDataCompareMapping(mapping: DataCompareMapping): DataCompareMapping {
  return mapping.map(({ source, target, key }) => ({ source: target, target: source, key }));
}
