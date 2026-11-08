import { copyInsertSqlLimits as limits } from '../shared/copyInsertSql';
import { copyInsertSqlZh as text } from '../shared/copyInsertSql.zh-CN';
import { sqliteInsertIdentifier, sqliteInsertIdentifierKey } from '../shared/resultSql';
import { sqliteInsertRowWriter, type SqliteValue } from '../shared/sqliteInsertLiteral';
import { sqliteResultCellMatches } from '../shared/sqliteResultStorage';
import { assertSqliteStorageTypes, type SqliteTablePage } from '../shared/sqliteTableBrowse';
import { ownCell } from './lib';
import { sameSqliteBatchValue } from './sqliteRecordBatch';
import type { SqliteDraftRow } from './sqliteTableEditor';

const utf8 = new TextEncoder();

/** 编辑网格只允许从与原编辑快照逐格相同的已有记录取得行号。 */
export function sqliteCopyInsertDraftRows(page: SqliteTablePage, rows: readonly SqliteDraftRow[]): string {
  if (page.edit?.kind !== 'editable') throw Error(text.target);
  const indices = new Set<number>();
  for (const row of rows) {
    const original = row.index === undefined ? undefined : page.edit.rows[row.index];
    if (row.index === undefined || !original || row.deleted || row.values.length !== original.length ||
        original.some((value, index) => !sameSqliteBatchValue(value, row.values[index]))) throw Error(text.draft);
    if (indices.has(row.index)) throw Error(text.selection);
    indices.add(row.index);
  }
  return sqliteCopyInsertSql(page, indices);
}

/** 原结果列和存储类型须一一对应。生成列省略，网格隐藏列仍保留。 */
export function sqliteCopyInsertSql(page: SqliteTablePage, indices: ReadonlySet<number>): string {
  if (page.insertCopy !== true || page.target.kind !== 'table' || page.target.database !== 'main' ||
      page.result.truncated || !page.storageTypes) throw Error(text.target);
  if (!indices.size) throw Error(text.selection);
  const columns = page.columns.flatMap((column, index) => column.generated ? [] : [{ name: column.name, index }]);
  if (indices.size > limits.rows || columns.length > limits.columns || indices.size * columns.length > limits.cells) throw Error(text.limit);
  if (!columns.length || ![page.target.table, ...columns.map(column => column.name)].every(value => sqliteInsertIdentifier.safeParse(value).success) ||
      new Set(columns.map(column => sqliteInsertIdentifierKey(column.name))).size !== columns.length ||
      page.result.columns.length !== page.columns.length ||
      page.result.columns.some((column, index) => column.key !== 'c' + index || column.name !== page.columns[index].name)) throw Error(text.target);
  assertSqliteStorageTypes(page);
  const render = sqliteInsertRowWriter('main', page.target.table, columns.map(column => column.name));
  let inputBytes = 0, sqlBytes = 0;
  const statements: string[] = [];
  for (const index of [...indices].sort((left, right) => left - right)) {
    const row = page.result.rows[index], storage = page.storageTypes[index];
    if (!Number.isSafeInteger(index) || index < 0 || !row || !storage) throw Error(text.selection);
    const values = columns.map(({ index: column }): SqliteValue => {
      const code = storage[column], value = ownCell(row, 'c' + column);
      if (value === undefined) throw Error(text.incomplete);
      const payload = typeof value === 'string' ? value : value && typeof value === 'object' ? value.base64 : undefined;
      if (payload !== undefined) {
        if (payload.length > limits.cellBytes) throw Error(text.limit);
        const size = utf8.encode(payload).length;
        inputBytes += size;
        if (size > limits.cellBytes || inputBytes > limits.inputBytes) throw Error(text.limit);
      }
      if (!sqliteResultCellMatches(code, value)) throw Error(text.type);
      return code === 'i' || code === 'r'
        ? { type: code === 'i' ? 'integer' : 'real', value: value as string }
        : value as SqliteValue;
    });
    const statement = render(values);
    sqlBytes += utf8.encode(statement).length;
    if (sqlBytes > limits.sqlBytes) throw Error(text.limit);
    statements.push(statement);
  }
  return statements.join('').slice(0, -1);
}
