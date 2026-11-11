import type { TableInfo } from '../shared/contracts';
import { buildTableReadOrder } from '../shared/tableReadSql';
import { tableStatisticsSampleSchema, type TableStatisticsInput } from '../shared/tableStatistics';
import { buildTableFilterSql, identifier, qualified } from './sql';

type StatisticsScope = Pick<TableStatisticsInput, 'filters' | 'filterMode' | 'filterGroup' | 'sample'>;

/** LIMIT 放在聚合前，仅投影所需字段。筛选、NULL 位置和唯一键补序沿用原表页。 */
export function tableStatisticsSource(source: TableInfo, input: StatisticsScope, columns: readonly string[]) {
  const filter = buildTableFilterSql(source, input.filters, input.filterMode, input.filterGroup);
  const filtered = qualified(source.database, source.name) + (filter.where ? ' WHERE ' + filter.where : '');
  if (input.sample === undefined) return { sql: filtered, params: filter.params };
  const sample = tableStatisticsSampleSchema.parse(input.sample);
  const order = buildTableReadOrder(source, sample.sort);
  const projection = columns.length ? columns.map(identifier).join(',') : '1 AS \`sample_row\`';
  return { sql: `(SELECT ${projection} FROM ${filtered}${order ? ' ORDER BY ' + order : ''} LIMIT ${sample.limit}) AS \`dbark_stat_sample\``, params: filter.params };
}
