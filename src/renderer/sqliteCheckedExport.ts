import type { ResultColumn, ResultExportData } from '../shared/contracts';
import { validateResultExportData } from '../shared/resultExport';
import type { SqliteTablePage } from '../shared/sqliteTableBrowse';
import { projectQueryResultRows } from './queryResultColumns';
import { sqliteCheckedExportZh as text } from './locales/sqliteCheckedExport.zh-CN';

export interface SqliteCheckedExport {
  readonly scope: object;
  readonly signature: string;
  readonly pages: ReadonlyMap<number, ResultExportData>;
  readonly result: ResultExportData;
}

export function sqliteCheckedExportSignature(page: SqliteTablePage, columns: readonly ResultColumn[]): string {
  const { connectionId, database, table, kind } = page.target;
  return JSON.stringify([connectionId, database, table, kind, page.schemaKey, page.limit, columns.map(({ key, name }) => [key, name])]);
}

/** 每页只保存选中的投影。替换、删除或超预算拒绝都在发布新收集前完成。 */
export function collectSqliteCheckedExport(scope: object, current: SqliteCheckedExport | undefined, page: SqliteTablePage, columns: ResultColumn[], selected: ReadonlySet<number>): SqliteCheckedExport | undefined {
  const signature = sqliteCheckedExportSignature(page, columns);
  if (current && (current.scope !== scope || current.signature !== signature)) throw Error(text.invalid);
  const pages = new Map(current?.pages);
  if (!selected.size) pages.delete(page.offset);
  else {
    const indices = [...selected].sort((a, b) => a - b);
    pages.set(page.offset, structuredClone(projectQueryResultRows(page.result, columns, indices)));
  }
  if (!pages.size) return;
  const ordered = [...pages].sort(([left], [right]) => left - right).map(([, value]) => value);
  const result = { columns: ordered[0].columns, rows: ordered.flatMap(value => value.rows), truncated: ordered.some(value => value.truncated) };
  validateResultExportData(result);
  return { scope, signature, pages, result };
}
