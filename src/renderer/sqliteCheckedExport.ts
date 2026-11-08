import type { ResultColumn, ResultExportData } from '../shared/contracts';
import type { SqliteTablePage } from '../shared/sqliteTableBrowse';
import { projectQueryResultRows } from './queryResultColumns';

export function sqliteCheckedExportSignature(page: SqliteTablePage, columns: readonly ResultColumn[]): string {
  const { connectionId, database, table, kind } = page.target;
  return JSON.stringify([connectionId, database, table, kind, page.schemaKey, page.limit, columns.map(({ key, name }) => [key, name])]);
}

export function snapshotSqliteCheckedExport(page: SqliteTablePage, columns: ResultColumn[], selected: ReadonlySet<number>): ResultExportData | undefined {
  if (!selected.size) return;
  return structuredClone(projectQueryResultRows(page.result, columns, [...selected].sort((a, b) => a - b)));
}
