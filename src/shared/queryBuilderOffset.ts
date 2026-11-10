import { z } from 'zod';

export const queryBuilderOffsetMax = 1_000_000_000;
export const queryBuilderOffsetError = '跳过行数须为 0～1000000000 的整数。';
export const queryBuilderOffsetSchema = z.number().int().min(0).max(queryBuilderOffsetMax);
export const queryBuilderOffsetDraftSchema = z.string().max(10).regex(/^(?:0|[1-9]\d{0,9})?$/)
  .refine(value => Number(value) <= queryBuilderOffsetMax, queryBuilderOffsetError);

/** 空白及零沿用旧 SQL，保留省略 OFFSET 时的预览和保存设计。 */
export function readQueryBuilderOffset(value: string | undefined): number {
  const parsed = queryBuilderOffsetDraftSchema.safeParse(value ?? '');
  if (!parsed.success) throw Error(queryBuilderOffsetError);
  return Number(parsed.data);
}
