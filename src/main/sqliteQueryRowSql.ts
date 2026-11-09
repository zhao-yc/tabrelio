import { copyInsertSqlLimits as limits } from '../shared/copyInsertSql';
import { copyInsertSqlZh as text } from '../shared/copyInsertSql.zh-CN';
import { sqliteInsertLiteral as literal, sqliteInsertRowWriter, type SqliteValue } from '../shared/sqliteInsertLiteral';
import { joinSqliteConditions, quoteSqliteIdentifier as quote } from '../shared/sqliteReadSql';
import { sqliteQueryRowSqlMessages as messages, type QueryRowSqlInput, type QueryRowSqlOutput } from '../shared/queryRowSql';
import type { SqliteDriverSession } from '../engine/sqlite/session';
import { sqliteQueryRecordKey, sqliteQueryRecordSchema, sqliteQueryRecordValues, type SqliteQueryRecordSource } from './sqliteQueryRecord';
import { readSqliteTableCatalogue, readSqliteTableRows, withSqliteReadSnapshot, type SqliteTableBrowseControl } from './sqliteTableBrowse';

/** 只读取同一文件的目录，生成值来自原查询快照，不再次执行查询或写入。 */
export async function readSqliteQueryRowSql(driver: SqliteDriverSession, source: SqliteQueryRecordSource,
  input: QueryRowSqlInput, control: SqliteTableBrowseControl): Promise<QueryRowSqlOutput> {
  const identity = driver.identity, table = source.table;
  if (source.result.truncated) throw Error(messages.source);
  if (!identity || identity.path !== source.identity.path ||
      identity.device !== source.identity.device || identity.inode !== source.identity.inode) throw Error(messages.stale);
  return withSqliteReadSnapshot(driver, control, async () => {
    const catalogue = await readSqliteTableCatalogue(driver, table, control);
    const relation = await readSqliteTableRows(driver, "SELECT type FROM pragma_table_list WHERE schema='main' AND name=? COLLATE BINARY LIMIT 2",
      [table], 2, control);
    const schema = await sqliteQueryRecordSchema(driver, table);
    control.check();
    if (catalogue.kind !== 'table' || /^sqlite_/i.test(table) || relation.length !== 1 || relation[0][0] !== 'table') throw Error(messages.source);
    if (schema?.version !== source.schemaVersion) throw Error(messages.stale);
    const { kind, rowIndices } = input, keyed = kind !== 'insert', assigns = kind === 'insert' || kind === 'update';
    const keys = keyed ? schema.keys : [];
    if (keyed && !source.keyed) throw Error(messages.key);
    const projected = new Set(source.origins.map(origin => origin?.column));
    const columns = assigns ? catalogue.columns.filter(column => !column.generated && projected.has(column.name) &&
      (kind === 'insert' || !keys.includes(column.name))) : [];
    if (assigns && !columns.length) throw Error(messages.fields);
    if (rowIndices.length * (columns.length + keys.length) > limits.cells) throw Error(text.limit);
    const target = '"main".' + quote(table), insert = sqliteInsertRowWriter('main', table, columns.map(column => column.name));
    let sqlBytes = 0, inputBytes = 0;
    const checkLiteral = (value: SqliteValue): void => {
      const raw = typeof value === 'string' ? value : value?.type === 'binary' ? value.base64 : value?.value;
      const bytes = raw === undefined ? 0 : Buffer.byteLength(raw);
      inputBytes += bytes;
      if (bytes > limits.cellBytes || inputBytes > limits.inputBytes) throw Error(text.limit);
    };
    const checkedLiteral = (value: SqliteValue) => { checkLiteral(value); return literal(value); };
    const statements = rowIndices.map(index => {
      control.check();
      const values = sqliteQueryRecordValues(source, index, catalogue.columns);
      const where = keyed ? sqliteQueryRecordKey(values, keys, checkedLiteral) : '';
      let statement: string;
      if (kind === 'select') statement = '(' + where + ')';
      else if (kind === 'delete') statement = 'DELETE FROM ' + target + ' WHERE ' + where + ';';
      else if (kind === 'insert') {
        // 先核对原值字节，避免在构造大字面量之后才拒绝。
        const row = columns.map(column => values.get(column.name)!);
        row.forEach(checkLiteral);
        statement = insert(row).trimEnd();
      } else statement = 'UPDATE ' + target + ' SET ' + columns.map(column =>
        quote(column.name) + ' = ' + checkedLiteral(values.get(column.name)!)).join(', ') + ' WHERE ' + where + ';';
      sqlBytes += Buffer.byteLength(statement) + 1;
      if (sqlBytes > limits.sqlBytes) throw Error(text.limit);
      return statement;
    });
    const sql = kind === 'select' ? 'SELECT * FROM ' + target + '\nWHERE ' + joinSqliteConditions(statements, '\n   OR ') + ';' : statements.join('\n');
    if (Buffer.byteLength(sql) > limits.sqlBytes) throw Error(text.limit);
    return { database: 'main', table, sql };
  });
}
