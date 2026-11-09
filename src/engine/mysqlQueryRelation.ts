import { createHash } from 'node:crypto';
import type { FieldPacket } from 'mysql2';
import type { CellValue, DataRow, QueryResult, TableInfo, TablePage } from '../shared/contracts';
import type { DataSearchColumnMetadata } from '../shared/dataSearch';
import type { SqlLexicalMode } from '../shared/queryParameters';
import { buildDataSearchRecordWhere, recordDefinitionDigest } from './dataSearchRecords';
import { identifier, inlineParameters, qualified, serializeCell } from './sql';
import { tableDefinitionTokens, type TableDefinitionToken } from './tableColumnDefinition';
import type { ManagedConnection } from './connection';

const word = (token?: TableDefinitionToken) => token?.kind === 'word' ? token.value.toUpperCase() : '';
const name = (token?: TableDefinitionToken) => token && (token.kind === 'word' || token.kind === 'identifier') ? token.value : undefined;
const symbol = (token: TableDefinitionToken | undefined, value: string) => token?.kind === 'symbol' && token.value === value;
const blocked = () => Error('MySQL／MariaDB 查询原记录无法核验，请重新执行查询');

/** 协议列来源仍不足以区别视图、临时表与自连接。先限定单表直接投影的语法。 */
export function mysqlQueryRelationTarget(sql: string, mode: SqlLexicalMode, dialect: 'mysql' | 'mariadb') {
  if (mode.ansiQuotesKnown === false || mode.noBackslashEscapesKnown === false) return;
  let tokens: TableDefinitionToken[];
  try { tokens = tableDefinitionTokens(sql, { mode, dialect }); } catch { return; }
  if (symbol(tokens.at(-1), ';')) tokens.pop();
  if (word(tokens[0]) !== 'SELECT' || tokens.slice(1).some(token => token.kind === 'executable' || symbol(token, ';') ||
    symbol(token, '@') || ['SELECT', 'UNION', 'INTERSECT', 'EXCEPT', 'GROUP', 'HAVING', 'WINDOW', 'INTO', 'FOR', 'LOCK', 'PROCEDURE'].includes(word(token)))) return;
  const from = tokens.findIndex((token, index) => index > 1 && word(token) === 'FROM');
  if (from < 0) return;
  const projection = tokens.slice(word(tokens[1]) === 'ALL' ? 2 : 1, from);
  if (!projection.length || ['DISTINCT', 'DISTINCTROW'].includes(word(projection[0])) ||
      projection.some(token => !name(token) && !['.', '*', ','].some(value => symbol(token, value)))) return;
  const first = name(tokens[from + 1]);
  if (!first) return;
  const qualifiedTable = symbol(tokens[from + 2], '.');
  const table = qualifiedTable ? name(tokens[from + 3]) : first;
  if (!table) return;
  let cursor = from + (qualifiedTable ? 4 : 2);
  const suffix = (token?: TableDefinitionToken) => ['WHERE', 'ORDER', 'LIMIT'].includes(word(token));
  if (word(tokens[cursor]) === 'AS') {
    if (!name(tokens[++cursor])) return;
    cursor++;
  } else if (name(tokens[cursor]) && !suffix(tokens[cursor]) &&
      !['JOIN', 'LEFT', 'RIGHT', 'INNER', 'CROSS', 'NATURAL', 'STRAIGHT_JOIN', 'PARTITION', 'USE', 'IGNORE', 'FORCE'].includes(word(tokens[cursor]))) cursor++;
  if (tokens[cursor] && !suffix(tokens[cursor])) return;
  return { database: qualifiedTable ? first : undefined, table };
}

export interface MysqlQueryRelationSource {
  executionId: string;
  context: string;
  database: string;
  table: string;
  columns: string[];
  result: QueryResult;
}

/** 记录原生列位置，结果别名和显示顺序不参与库表身份。 */
export function mysqlQueryRelationOrigin(managed: ManagedConnection, target: NonNullable<ReturnType<typeof mysqlQueryRelationTarget>>,
  fields: readonly FieldPacket[]) {
  const directory = managed.sessionObjects?.snapshot();
  const context = managed.queryRowContext, first = fields[0], database = first?.schema ?? first?.db, table = first?.orgTable;
  if (!context || !directory || directory.uncertain || !database || !table || fields.length > 1024) return;
  const equal = (a: string, b: string) => directory.caseMode ? a.toLowerCase() === b.toLowerCase() : a === b;
  if (!equal(table, target.table) || target.database && !equal(database, target.database) ||
      fields.some(field => (field.schema ?? field.db) !== database || field.orgTable !== table || !field.orgName) ||
      directory.objects.some(object => equal(database, object.database) && equal(table, object.name))) return;
  return { context, database, table, columns: fields.map(field => field.orgName) };
}

export function mysqlQueryRelationSource(managed: ManagedConnection, target: NonNullable<ReturnType<typeof mysqlQueryRelationTarget>>,
  fields: readonly FieldPacket[], result: QueryResult, executionId: string): MysqlQueryRelationSource | undefined {
  // mysql2 的原始 PRI_KEY 标志只用于发现入口，真正完整主键以回查目录为准。
  if (fields.length !== result.columns.length || !result.rows.length ||
      !fields.some(field => typeof field.flags === 'number' && (field.flags & 2) !== 0)) return;
  const origin = mysqlQueryRelationOrigin(managed, target, fields);
  return origin && { ...origin, executionId, result };
}

/** 数值主键沿用精确十进制绑定，避免以双精度字符串比较相邻 BIGINT。 */
export function mysqlQueryRelationSelect(source: MysqlQueryRelationSource, info: TableInfo, index: number, lock = false) {
  const original = source.result.rows[index], names = info.columns.map(column => column.name);
  if (!original || info.objectKind !== 'table' || info.engine.toUpperCase() !== 'INNODB' || !info.primaryKey.length ||
      info.database !== source.database || info.name !== source.table || source.columns.some(column => !names.includes(column))) throw blocked();
  const values = new Map<string, CellValue>();
  for (const [position, column] of source.columns.entries()) {
    const key = source.result.columns[position].key, value = original[key];
    if (!Object.hasOwn(original, key) || (values.has(column) && JSON.stringify(values.get(column)) !== JSON.stringify(value))) throw blocked();
    values.set(column, value);
  }
  const keyColumns: Pick<DataSearchColumnMetadata, 'name' | 'binary' | 'dataType'>[] = [], keyValues: CellValue[] = [];
  for (const column of info.primaryKey) {
    const dataType = /^\w+/.exec(info.columns.find(item => item.name === column)?.type.toLowerCase() ?? '')?.[0];
    const value = values.get(column);
    if (value === undefined || value === null || !dataType || !/^(?:tinyint|smallint|mediumint|int|integer|bigint|decimal|numeric|year|char|varchar|binary|varbinary|date|datetime|time)$/.test(dataType)) throw blocked();
    keyColumns.push({ name: column, dataType, binary: dataType === 'binary' || dataType === 'varbinary' });
    keyValues.push(typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value);
  }
  const where = buildDataSearchRecordWhere({ keyColumns }, keyValues);
  const searchKey = { sql: where.sql, params: where.params.map(serializeCell) };
  const sql = inlineParameters('SELECT ' + names.map(identifier).join(',') + ' FROM ' + qualified(info.database, info.name) +
    ' WHERE ' + where.sql + ' LIMIT 2' + (lock ? ' FOR UPDATE' : ''), searchKey.params);
  return { sql, searchKey, verify(page: TablePage): DataRow {
    const row = page.rows[0];
    if (!row || page.rows.length !== 1 || page.hasMore || [...values].some(([column, value]) =>
      !Object.hasOwn(row, column) || JSON.stringify(row[column]) !== JSON.stringify(value))) throw blocked();
    return row;
  } };
}

/** 只保留原行及结构摘要。列顺序取可信目录，缺列或多列均不能伪造相同的完整原值。 */
export function mysqlQueryEditRowDigest(info: TableInfo, row: DataRow): string {
  if (Object.keys(row).length !== info.columns.length || info.columns.some(column => !Object.hasOwn(row, column.name))) throw blocked();
  return createHash('sha256').update(JSON.stringify(info.columns.map(column => row[column.name]))).digest('hex');
}

export function mysqlQueryEditSchemaDigest(managed: ManagedConnection, info: TableInfo): string {
  if (managed.sqlMode === undefined || !info.primaryKey.length || info.primaryKey.length !== info.editableKey.length ||
      info.primaryKey.some((name, index) => name !== info.editableKey[index])) throw blocked();
  return createHash('sha256').update(JSON.stringify([info.columns, info.primaryKey,
    recordDefinitionDigest(info.ddl, managed.sqlMode, managed.status.dialect)])).digest('hex');
}
