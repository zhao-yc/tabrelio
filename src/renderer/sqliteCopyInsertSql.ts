import { copyInsertSqlLimits as limits } from '../shared/copyInsertSql';
import { copyInsertSqlZh as text } from '../shared/copyInsertSql.zh-CN';
import { sqliteInsertIdentifier, sqliteInsertIdentifierKey } from '../shared/resultSql';
import { sqliteInsertLiteral, sqliteInsertRowWriter, type SqliteValue } from '../shared/sqliteInsertLiteral';
import { sqliteResultCellMatches } from '../shared/sqliteResultStorage';
import { assertSqliteStorageTypes, type SqliteTablePage } from '../shared/sqliteTableBrowse';
import { quoteSqliteIdentifier } from '../shared/sqliteReadSql';
import { primaryKeyCopyZh as keyText } from './locales/primaryKeyCopy.zh-CN';
import { updateSqlCopyZh as updateText } from './locales/updateSqlCopy.zh-CN';
import { ownCell } from './lib';
import { sameSqliteBatchValue } from './sqliteRecordBatch';
import type { SqliteDraftRow } from './sqliteTableEditor';

const utf8 = new TextEncoder();

/** 编辑网格只允许从与原编辑快照逐格相同的已有记录取得行号。 */
export function sqliteCopyInsertDraftRows(page: SqliteTablePage, rows: readonly SqliteDraftRow[]): string {
  return sqliteCopyInsertSql(page, cleanDraftIndices(page, rows));
}

/** 赋值语句只读取原页值，已有草稿、删除和新增行都不能进入生成范围。 */
function cleanDraftIndices(page: SqliteTablePage, rows: readonly SqliteDraftRow[]): Set<number> {
  if (page.edit?.kind !== 'editable') throw Error(text.target);
  const indices = new Set<number>();
  for (const row of rows) {
    const original = row.index === undefined ? undefined : page.edit.rows[row.index];
    if (row.index === undefined || !original || row.deleted || row.values.length !== original.length ||
        original.some((value, index) => !sameSqliteBatchValue(value, row.values[index]))) throw Error(text.draft);
    if (indices.has(row.index)) throw Error(text.selection);
    indices.add(row.index);
  }
  return indices;
}

/** 原结果列和存储类型须一一对应。生成列省略，网格隐藏列仍保留。 */
export function sqliteCopyInsertSql(page: SqliteTablePage, indices: ReadonlySet<number>): string {
  if (page.insertCopy !== true || page.target.kind !== 'table' || page.target.database !== 'main' ||
      page.result.truncated || !page.storageTypes) throw Error(text.target);
  const columns = page.columns.flatMap((column, index) => column.generated ? [] : [{ name: column.name, index }]);
  if (!columns.length || ![page.target.table, ...columns.map(column => column.name)].every(value => sqliteInsertIdentifier.safeParse(value).success) ||
      new Set(columns.map(column => sqliteInsertIdentifierKey(column.name))).size !== columns.length ||
      page.result.columns.length !== page.columns.length ||
      page.result.columns.some((column, index) => column.key !== 'c' + index || column.name !== page.columns[index].name)) throw Error(text.target);
  const render = sqliteInsertRowWriter('main', page.target.table, columns.map(column => column.name));
  return copyRows(page, indices, columns, text, render, '').join('').slice(0, -1);
}

/** 选中已有草稿时仍定位数据库里的原记录，新增行没有原主键来源。 */
export function sqliteCopyPrimaryKeyDraftRows(page: SqliteTablePage, rows: readonly SqliteDraftRow[]): string {
  if (page.edit?.kind !== 'editable') throw Error(keyText.target);
  const indices = new Set<number>();
  for (const row of rows) {
    if (row.index === undefined || !page.edit.rows[row.index] || indices.has(row.index)) throw Error(keyText.selection);
    indices.add(row.index);
  }
  return sqliteCopyPrimaryKeyQuery(page, indices);
}

/** 大组条件采用平衡分组，避免默认 1000 层表达式上限拒绝满页查询。 */
function joinConditions(parts: readonly string[], separator: string): string {
  if (parts.length <= 32) return parts.join(separator);
  const middle = Math.floor(parts.length / 2);
  return '(' + joinConditions(parts.slice(0, middle), separator) + separator + joinConditions(parts.slice(middle), separator) + ')';
}

export function sqliteCopyPrimaryKeyQuery(page: SqliteTablePage, indices: ReadonlySet<number>): string {
  const columns = primaryKeyColumns(page);
  const prefix = 'SELECT * FROM "main".' + quoteSqliteIdentifier(page.target.table) + '\nWHERE ';
  const separator = '\n   OR ';
  const predicates = copyRows(page, indices, columns, keyText, values => primaryKeyCondition(columns, values),
    separator, utf8.encode(prefix).length + 1);
  const sql = prefix + joinConditions(predicates, separator) + ';';
  if (utf8.encode(sql).length > limits.sqlBytes) throw Error(keyText.limit);
  return sql;
}

/** 使用原主键索引的比较规则，而不是按声明列排序规则猜测。 */
function primaryKeyColumns(page: SqliteTablePage) {
  const keys = page.primaryKey;
  if (page.insertCopy !== true || page.target.kind !== 'table' || page.target.database !== 'main' || page.result.truncated ||
      !page.storageTypes || !keys?.length || !sqliteInsertIdentifier.safeParse(page.target.table).success ||
      new Set(keys.map(key => sqliteInsertIdentifierKey(key.name))).size !== keys.length ||
      page.result.columns.length !== page.columns.length ||
      page.result.columns.some((column, index) => column.key !== 'c' + index || column.name !== page.columns[index].name)) throw Error(keyText.target);
  return keys.map(key => {
    const index = page.columns.findIndex(column => column.name === key.name);
    if (index < 0 || !sqliteInsertIdentifier.safeParse(key.name).success ||
        !['BINARY', 'NOCASE', 'RTRIM'].includes(key.collation)) throw Error(keyText.target);
    return { index, term: quoteSqliteIdentifier(key.name) + ' COLLATE ' + key.collation };
  });
}

function primaryKeyCondition(columns: readonly { term: string }[], values: readonly SqliteValue[]): string {
  if (values.includes(null)) throw Error(keyText.incomplete);
  return '(' + joinConditions(values.map((value, index) => columns[index].term + ' = ' + sqliteInsertLiteral(value)), ' AND ') + ')';
}

export function sqliteCopyUpdateDraftRows(page: SqliteTablePage, rows: readonly SqliteDraftRow[]): string {
  return sqliteCopyUpdateSql(page, cleanDraftIndices(page, rows));
}

export function sqliteCopyDeleteDraftRows(page: SqliteTablePage, rows: readonly SqliteDraftRow[]): string {
  return sqliteCopyDeleteSql(page, cleanDraftIndices(page, rows));
}

/** 用原主键索引的排序规则和原生存储值生成独立 DELETE 文本。 */
export function sqliteCopyDeleteSql(page: SqliteTablePage, indices: ReadonlySet<number>): string {
  const keys = primaryKeyColumns(page);
  const prefix = 'DELETE FROM "main".' + quoteSqliteIdentifier(page.target.table) + '\nWHERE ';
  return copyRows(page, indices, keys, keyText, values => prefix + primaryKeyCondition(keys, values) + ';', '\n').join('\n');
}

/** SET 用逐格原生类型生成字面量，WHERE 沿用原主键索引与完整键值。 */
export function sqliteCopyUpdateSql(page: SqliteTablePage, indices: ReadonlySet<number>): string {
  const keys = primaryKeyColumns(page);
  const keyIndices = new Set(keys.map(key => key.index));
  const columns = page.columns.flatMap((column, index) => column.generated || keyIndices.has(index) ? [] : [{ name: column.name, index }]);
  if (!columns.length || columns.some(column => !sqliteInsertIdentifier.safeParse(column.name).success) ||
      new Set(page.columns.map(column => sqliteInsertIdentifierKey(column.name))).size !== page.columns.length) throw Error(updateText.target);
  const table = '"main".' + quoteSqliteIdentifier(page.target.table);
  return copyRows(page, indices, [...keys, ...columns], text, values => {
    const set = columns.map(({ name }, index) => quoteSqliteIdentifier(name) + ' = ' + sqliteInsertLiteral(values[keys.length + index]));
    return 'UPDATE ' + table + '\nSET ' + set.join(', ') + '\nWHERE ' + primaryKeyCondition(keys, values.slice(0, keys.length)) + ';';
  }, '\n').join('\n');
}

/** 复制 INSERT 和原主键查询都只读原页的类型和值，并按整批字节预算生成。 */
function copyRows(page: SqliteTablePage, indices: ReadonlySet<number>, columns: readonly { index: number }[],
  errors: { selection: string; incomplete: string; type: string; limit: string },
  render: (values: readonly SqliteValue[]) => string, separator: string, sqlBytes = 0): string[] {
  if (!indices.size) throw Error(errors.selection);
  if (indices.size > limits.rows || columns.length > limits.columns || indices.size * columns.length > limits.cells) throw Error(errors.limit);
  assertSqliteStorageTypes(page);
  const separatorBytes = utf8.encode(separator).length;
  let inputBytes = 0;
  const statements: string[] = [];
  for (const index of [...indices].sort((left, right) => left - right)) {
    const row = page.result.rows[index], storage = page.storageTypes![index];
    if (!Number.isSafeInteger(index) || index < 0 || !row || !storage) throw Error(errors.selection);
    const values = columns.map(({ index: column }): SqliteValue => {
      const code = storage[column], value = ownCell(row, 'c' + column);
      if (value === undefined) throw Error(errors.incomplete);
      const payload = typeof value === 'string' ? value : value && typeof value === 'object' ? value.base64 : undefined;
      if (payload !== undefined) {
        if (payload.length > limits.cellBytes) throw Error(errors.limit);
        const size = utf8.encode(payload).length;
        inputBytes += size;
        if (size > limits.cellBytes || inputBytes > limits.inputBytes) throw Error(errors.limit);
      }
      if (!sqliteResultCellMatches(code, value)) throw Error(errors.type);
      return code === 'i' || code === 'r'
        ? { type: code === 'i' ? 'integer' : 'real', value: value as string }
        : value as SqliteValue;
    });
    const statement = render(values);
    sqlBytes += utf8.encode(statement).length + (statements.length ? separatorBytes : 0);
    if (sqlBytes > limits.sqlBytes) throw Error(errors.limit);
    statements.push(statement);
  }
  return statements;
}
