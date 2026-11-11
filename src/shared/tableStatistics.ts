import type { CellValue, FilterGroup, FilterMode, FilterRule, TableInfo } from './contracts';
import { z } from 'zod';
import { sortRulesSchema } from './filtering';

export const tableStatisticsLimits = { columns: 12, metadataRows: 4096, cellBytes: 256 * 1024, bytes: 8 * 1024 * 1024 } as const;
export const tableStatisticsSampleMax = 100_000;
export const tableStatisticsSampleSchema = z.object({ limit: z.number().int().min(1).max(tableStatisticsSampleMax), sort: sortRulesSchema }).strict();
export type TableStatisticsSample = z.infer<typeof tableStatisticsSampleSchema>;
export interface TableStatisticsInput { connectionId: string; database: string; table: string; taskId: string; columns: string[]; filters: FilterRule[]; filterMode?: FilterMode; filterGroup?: FilterGroup; distinct?: boolean; histogram?: import('./tableHistogram').TableHistogramRequest; calendar?: import('./tableCalendar').TableCalendarRequest; sample?: TableStatisticsSample; }
interface StatisticsCounts { name: string; type: string; nonNull: string; nulls: string; }
export type TableColumnStatistics = StatisticsCounts & (
  { kind: 'numeric'; min: CellValue; max: CellValue; sum: string | null; avg: string | null; approximate: boolean; distinct?: string }
  | { kind: 'ordered'; min: CellValue; max: CellValue; distinct?: string }
  | { kind: 'count-only'; reason: string }
);
export interface TableStatisticsOutput { source: TableInfo; sourceDigest: string; rowCount: string; columns: TableColumnStatistics[]; warnings: string[]; histogram?: import('./tableHistogram').TableHistogram; calendar?: import('./tableCalendar').TableCalendar; sample?: TableStatisticsSample; }
export const tableStatisticsMessages = {
  invalid: '表统计字段、原服务器结果或元数据无效，请重新读取。', stale: '统计期间表或视图定义已变化，未发布混合结构的统计结果。',
  budget: '统计结果超过有界预算；MIN/MAX不会被截断或悄悄替换成NULL，请减少所选列或调整筛选。',
  serverWarning: '服务器聚合返回警告或警告状态无法确认，未发布可能截断或转换的统计值。',
  countOnly: 'JSON、空间或尚未证明的类型只提供非空与NULL计数。',
  approximate: 'FLOAT/DOUBLE/REAL的极值、合计与平均值为服务器浮点近似结果。',
  scope: '统计覆盖当前服务器筛选的全部匹配行；使用独立只读会话，不包含用户会话尚未提交的数据。',
  sampleScope: '独立只读会话先应用筛选和表页排序，再取前 N 条。统计结果仅描述本次样本。',
  sampleHistogram: '抽样数值分布需要有非空唯一键的 InnoDB 表，才能让极值和区间计数读取同一批样本。',
  distinct: '非NULL不同值数量由服务器COUNT(DISTINCT)计算，遵循原列排序规则；不把客户端文本或字节比较当作服务器相等语义。',
  conservative: '复杂表定义使用完整原文绑定；包括表尾计数在内的任何变化都会使本次统计失效。',
} as const;

/** 多次读取的直方图需要可重复读与完整排序键，单语句的概况和日期分布不受此限。 */
export function tableStatisticsCanSampleHistogram(source: TableInfo): boolean {
  return source.objectKind === 'table' && source.engine.toUpperCase() === 'INNODB' && source.editableKey.length > 0;
}

/** 原字段元数据决定聚合能力，不能由回包自报kind把未知类型升级或把数值降级。 */
export function tableStatisticsColumnKind(type: string): 'numeric' | 'ordered' | 'count-only' {
  const name = type.trim();
  if (/^(?:TINYINT|SMALLINT|MEDIUMINT|INT|INTEGER|BIGINT|DECIMAL|NUMERIC|FIXED|FLOAT|DOUBLE|REAL|BIT|BOOL|BOOLEAN|YEAR)\b/i.test(name)) return 'numeric';
  if (/^(?:CHAR|VARCHAR|TINYTEXT|TEXT|MEDIUMTEXT|LONGTEXT|ENUM|SET|BINARY|VARBINARY|TINYBLOB|BLOB|MEDIUMBLOB|LONGBLOB|DATE|TIME|DATETIME|TIMESTAMP)\b/i.test(name)) return 'ordered';
  return 'count-only';
}
