import {z} from 'zod';
import type {SavedQuery} from './contracts';
import {savedQueryGroupScopeSchema} from './savedQueryOrganization';
import {querySqlExportEncodingSchema,savedQueryArchiveLimits,savedQueryDatabaseScopeSchema,savedQueryOpenBatchLimits,savedQueryReadTextSchema,savedQueryScopeSchema} from './savedQuerySearch';
import{localSqlPageLimits,localSqlPageNextSchema,localSqlPageReleaseSchema,type LocalSqlPage}from'./localSqlPages';

/** 列表按需取概要；正文只在明确打开时通过原摘要重新读取。 */
export const savedQueryPageLimits=localSqlPageLimits;
const savedQueryPageSortSchema = z.enum(['recent', 'oldest', 'name-asc', 'name-desc', 'opened']);
export type SavedQueryPageSort = z.infer<typeof savedQueryPageSortSchema>;
export const savedQueryPageInputSchema=z.object({taskId:z.string().uuid(),search:z.string().max(512),onError:z.enum(['stop','continue']),group:savedQueryGroupScopeSchema.optional(),scope:savedQueryScopeSchema.optional(),database:savedQueryDatabaseScopeSchema.optional(),sort:savedQueryPageSortSchema.optional(),favoritesOnly:z.literal(true).optional()}).strict();
const savedQueryArchiveFiltersSchema = savedQueryPageInputSchema.omit({ taskId: true, onError: true });
export type SavedQueryArchiveFilters = z.infer<typeof savedQueryArchiveFiltersSchema>;
export const savedQueryFilteredArchiveLimits = { records: 10_000, files: 1000 } as const;
/** 路径只能来自原生保存窗口，筛选与显式摘要是两种互斥的范围。 */
export const savedQueryExportSqlArchiveSchema = z.union([
 z.object({ items: z.array(savedQueryReadTextSchema).min(1).max(savedQueryArchiveLimits.files)
  .refine(items => new Set(items.map(item => item.id)).size === items.length, '选中的查询不能重复'), encoding: querySqlExportEncodingSchema.optional() }).strict(),
 z.object({ filters: savedQueryArchiveFiltersSchema, encoding: querySqlExportEncodingSchema.optional() }).strict(),
]);
export type SavedQueryExportSqlArchiveInput = z.infer<typeof savedQueryExportSqlArchiveSchema>;
export const savedQueryPageNextSchema=localSqlPageNextSchema;
export const savedQueryPageReleaseSchema=localSqlPageReleaseSchema;
export const savedQueryDeleteCheckedSchema=z.object({id:z.string().min(1).max(200),digest:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export const savedQueryFavoriteSchema = savedQueryDeleteCheckedSchema.extend({ expectedRevision: z.string().regex(/^[a-f0-9]{64}$/), favorite: z.boolean() }).strict();
export type SavedQueryFavoriteInput = z.infer<typeof savedQueryFavoriteSchema>;
export const savedQueryRecentLimit = 100;
export const savedQueryRememberOpenSchema = z.object({
 ids: z.array(savedQueryDeleteCheckedSchema.shape.id).min(1).max(savedQueryOpenBatchLimits.queries)
  .refine(ids => new Set(ids).size === ids.length, '打开记录不能包含重复查询'),
}).strict();
export type SavedQueryRememberOpenInput = z.infer<typeof savedQueryRememberOpenSchema>;
export type SavedQueryPageInput=z.infer<typeof savedQueryPageInputSchema>;
export interface SavedQueryPageEntry{query:Omit<SavedQuery,'sql'>;digest:string;sqlPreview:string;sqlUnits:number;previewTruncated:boolean;groupId?:string;favorite?:true}
export type SavedQueryPage=LocalSqlPage<SavedQueryPageEntry>;
export interface SavedQueryPagePosition{updatedAt:string;id:string;nameKey?:Uint8Array;openOrder?:number}
