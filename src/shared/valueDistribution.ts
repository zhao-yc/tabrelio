import { z } from 'zod';

const countPattern = /^(?:0|[1-9]\d{0,19})$/;
const countSchema = z.string().refine(value => countPattern.test(value) && value === value.trim() && BigInt(value) <= 18446744073709551615n);
export const valueDistributionSchema = z.object({ rows: countSchema, groups: countSchema }).strict();
export type ValueDistribution = z.infer<typeof valueDistributionSchema>;

/** 同次聚合的总数须与已返回组守恒。其余组每组至少一行，不能混成一个可筛选值。 */
export function valueDistributionRemainder(raw: unknown, options: readonly { count: string }[], truncated: boolean) {
  const { rows, groups } = valueDistributionSchema.parse(raw);
  const hiddenRows = BigInt(rows) - options.reduce((total, item) => total + BigInt(countSchema.parse(item.count)), 0n);
  const hiddenGroups = BigInt(groups) - BigInt(options.length);
  if (options.some(item => item.count === '0') ||
      (truncated ? hiddenGroups <= 0n || hiddenRows < hiddenGroups : hiddenRows !== 0n || hiddenGroups !== 0n))
    throw Error('类别分布计数不完整');
  return { hiddenRows: String(hiddenRows), hiddenGroups: String(hiddenGroups) };
}
