import type { QueryResult, ResultColumn } from '../shared/contracts';
import { queryResultVisibleColumns, type QueryResultColumnLayout } from './queryResultColumns';
import { prepareQueryResultOrganization, type QueryResultOrganization } from './queryResultHistory';
import { matchQueryResultKeyword, projectQueryResultKeyword } from './queryResultKeyword';
import type { SortDialect } from './queryResultSort';

export interface QueryResultArchiveView {
  result: QueryResult;
  columns: ResultColumn[];
}

/** 在临时控制器里按网格相同顺序重建一组结果。旧规则失效时拒绝导出，避免悄悄多写原始行列。 */
export function prepareQueryResultArchiveView(source: QueryResult, layout: QueryResultColumnLayout | undefined,
  organization: QueryResultOrganization | undefined, readKeyword: (source: QueryResult, columns: readonly ResultColumn[]) => string | undefined,
  dialect?: SortDialect): QueryResultArchiveView {
  const columns = layout ? queryResultVisibleColumns(source.columns, layout) : source.columns;
  let result = source;
  if (organization) {
    const prepared = prepareQueryResultOrganization(source, [], columns, organization, dialect);
    result = prepared.sorter.view(prepared.sortBinding)!.result;
  }
  const keyword = readKeyword(source, columns);
  if (keyword) result = projectQueryResultKeyword(result, matchQueryResultKeyword(source, columns, keyword));
  return { result, columns };
}
