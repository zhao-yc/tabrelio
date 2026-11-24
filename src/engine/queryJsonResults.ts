import type { QueryExportColumn, QueryExportFrame } from '../shared/queryStreamExport';
import { validQueryResultTitle } from '../shared/queryResultTitle';

export const queryJsonResultsStart = '{"format":"DBArk-query-results","version":1,"results":[';
export const queryJsonResultsEnd = '\n]}\n';

/** 所有连接使用同一版本的结果元数据，输出键与原列名分别保留。 */
export function queryJsonRowsStart(
  frame: Pick<Extract<QueryExportFrame, { kind: 'rows-start' }>, 'resultOrdinal' | 'statementOrdinal' | 'rowResultOrdinal' | 'title'>,
  columns: readonly QueryExportColumn[],
): string {
  const { resultOrdinal, statementOrdinal, rowResultOrdinal, title } = frame;
  const metadata = { resultOrdinal, statementOrdinal, kind: 'rows', rowResultOrdinal,
    ...(validQueryResultTitle(title) ? { label: title } : {}), columns: columns.map(({ key: _key, ...column }) => column) };
  return (resultOrdinal > 1 ? ',\n' : '\n') + JSON.stringify(metadata).slice(0, -1) + ',"rows":[\n';
}

export function queryJsonRowsEnd(rows: number, warningCount?: number): string {
  return '\n],"rowsWritten":' + rows + (warningCount === undefined ? '' : ',"warningCount":' + warningCount) + '}';
}
