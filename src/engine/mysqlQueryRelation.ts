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

interface QueryTable { database?: string; table: string; alias: string }
type ProjectionKind = 'column' | 'expand' | 'expression';
interface QueryTarget { database?: string; table: string; joined?: QueryTable[]; projection?: ProjectionKind[] }
const suffix = (token?: TableDefinitionToken) => ['WHERE', 'ORDER', 'LIMIT'].includes(word(token));
const joinWords = new Set(['JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'FULL', 'CROSS', 'NATURAL', 'STRAIGHT_JOIN']);
// 只允许明确是标量的内置函数，不能从聚合、窗口或用户函数推断可编辑原行。
const scalarCalls = new Set(['ABS', 'CAST', 'CEIL', 'CEILING', 'COALESCE', 'CONCAT', 'CONCAT_WS', 'CONVERT', 'DATE',
  'DATE_FORMAT', 'FLOOR', 'GREATEST', 'IF', 'IFNULL', 'JSON_EXTRACT', 'JSON_UNQUOTE', 'LEAST', 'LENGTH', 'LOWER',
  'NULLIF', 'OCTET_LENGTH', 'ROUND', 'SUBSTR', 'SUBSTRING', 'TRIM', 'UPPER']);
const castTypes = new Set(['BINARY', 'CHAR', 'DECIMAL', 'DOUBLE', 'FLOAT', 'TIME', 'DATETIME']);
const expressionKeywords = new Set(['NULL', 'TRUE', 'FALSE', 'CURRENT_DATE', 'CURRENT_TIME', 'CURRENT_TIMESTAMP', 'LOCALTIME', 'LOCALTIMESTAMP']);
const scalarSyntax = new Set(['WHEN', 'THEN', 'ELSE', 'AND', 'OR', 'NOT', 'IN']);

function directProjection(tokens: TableDefinitionToken[]): ProjectionKind | undefined {
  let end = 0;
  while (name(tokens[end]) && symbol(tokens[end + 1], '.')) end += 2;
  if (symbol(tokens[end], '*') && end === tokens.length - 1) return 'expand';
  const column = tokens[end++];
  if (!name(column) || end === 1 && expressionKeywords.has(word(column))) return;
  const rest = tokens.length - end;
  if (rest === 0 || rest === 1 && name(tokens[end]) || rest === 2 && word(tokens[end]) === 'AS' && name(tokens[end + 1])) return 'column';
}

/** 从语法固定计算列的位置，协议把括号中的单列仍报为原列时也不能因此写入。 */
function queryProjection(tokens: TableDefinitionToken[]): ProjectionKind[] | undefined {
  if (!tokens.length || ['DISTINCT', 'DISTINCTROW'].includes(word(tokens[0]))) return;
  const parts: TableDefinitionToken[][] = [];
  let depth = 0, start = 0;
  for (const [index, token] of tokens.entries()) {
    if (symbol(token, ',') && depth === 0) { parts.push(tokens.slice(start, index)); start = index + 1; }
    else if (symbol(token, '(')) depth++;
    else if (symbol(token, ')')) { depth--; if (depth < 0) return; }
  }
  if (depth) return;
  parts.push(tokens.slice(start));
  if (parts.some(part => !part.length || part.some((token, index) => {
    if (!name(token) || !symbol(part[index + 1], '(')) return false;
    return symbol(part[index - 1], '.') || !scalarCalls.has(word(token)) && !scalarSyntax.has(word(token)) &&
      !(word(part[index - 1]) === 'AS' && castTypes.has(word(token)));
  }))) return;
  const kinds = parts.map(part => directProjection(part) ?? 'expression');
  if (kinds.includes('expression') && (kinds.every(kind => kind === 'expression') || kinds.filter(kind => kind === 'expand').length > 1)) return;
  return kinds;
}

function expressionIndices(projection: ProjectionKind[] | undefined, count: number): number[] | undefined {
  if (!projection) return [];
  const expansion = count - projection.length, wildcard = projection.indexOf('expand');
  if (expansion < 0 || wildcard < 0 && expansion !== 0) return;
  return projection.flatMap((kind, index) => kind === 'expression' ? [index + (wildcard >= 0 && index > wildcard ? expansion : 0)] : []);
}

function tableAt(tokens: TableDefinitionToken[], start: number) {
  const first = name(tokens[start]);
  if (!first) return;
  const qualifiedTable = symbol(tokens[start + 1], '.');
  const table = qualifiedTable ? name(tokens[start + 2]) : first;
  if (!table) return;
  let end = start + (qualifiedTable ? 3 : 1), alias = table;
  if (word(tokens[end]) === 'AS') {
    const explicit = name(tokens[++end]);
    if (!explicit) return;
    alias = explicit;
    end++;
  } else if (name(tokens[end]) && !suffix(tokens[end]) && !joinWords.has(word(tokens[end])) &&
      !['ON', 'USING', 'PARTITION', 'USE', 'IGNORE', 'FORCE'].includes(word(tokens[end]))) {
    alias = name(tokens[end++])!;
  }
  return { target: { database: qualifiedTable ? first : undefined, table, alias }, end };
}

/** 只接纳直接投影及保持左侧原行的 INNER／LEFT JOIN，实际来源仍由服务器列信息核验。 */
export function mysqlQueryRelationTarget(sql: string, mode: SqlLexicalMode, dialect: 'mysql' | 'mariadb'): QueryTarget | undefined {
  if (mode.ansiQuotesKnown === false || mode.noBackslashEscapesKnown === false) return;
  let tokens: TableDefinitionToken[];
  try { tokens = tableDefinitionTokens(sql, { mode, dialect }); } catch { return; }
  if (symbol(tokens.at(-1), ';')) tokens.pop();
  if (word(tokens[0]) !== 'SELECT' || tokens.slice(1).some(token => token.kind === 'executable' || symbol(token, ';') ||
    symbol(token, '@') || ['SELECT', 'UNION', 'INTERSECT', 'EXCEPT', 'GROUP', 'HAVING', 'WINDOW', 'OVER', 'INTO', 'FOR', 'LOCK', 'PROCEDURE'].includes(word(token)))) return;
  let depth = 0;
  const from = tokens.findIndex((token, index) => {
    if (symbol(token, '(')) depth++;
    if (symbol(token, ')')) depth--;
    return depth === 0 && index > 1 && word(token) === 'FROM';
  });
  if (from < 0) return;
  const projection = queryProjection(tokens.slice(word(tokens[1]) === 'ALL' ? 2 : 1, from));
  if (!projection) return;
  const first = tableAt(tokens, from + 1);
  if (!first) return;
  let cursor = first.end;
  const joined = [first.target];
  while (tokens[cursor] && !suffix(tokens[cursor])) {
    if (word(tokens[cursor]) === 'LEFT') {
      cursor++;
      if (word(tokens[cursor]) === 'OUTER') cursor++;
    } else if (word(tokens[cursor]) === 'INNER') cursor++;
    if (word(tokens[cursor]) !== 'JOIN' || joined.length === 9) return;
    const next = tableAt(tokens, cursor + 1);
    if (!next || !['ON', 'USING'].includes(word(tokens[next.end]))) return;
    joined.push(next.target);
    cursor = next.end + 1;
    const start = cursor;
    let depth = 0;
    while (tokens[cursor]) {
      const token = tokens[cursor];
      if (depth === 0 && (suffix(token) || joinWords.has(word(token)))) break;
      if (depth === 0 && symbol(token, ',')) return;
      if (symbol(token, '(')) depth++;
      if (symbol(token, ')')) { depth--; if (depth < 0) return; }
      cursor++;
    }
    if (depth || cursor === start) return;
  }
  const { database, table } = first.target;
  return { database, table, ...(joined.length > 1 ? { joined } : {}), ...(projection.includes('expression') ? { projection } : {}) };
}

type PhysicalTable = { database: string; table: string };
interface QueryOrigin extends PhysicalTable { context: string; columns: (string | null)[]; joined?: PhysicalTable[]; computed?: number[] }
export interface MysqlQueryRelationSource extends QueryOrigin {
  executionId: string;
  result: QueryResult;
  rowReadable?: true;
}

/** 协议虚拟表名与语法别名匹配，物理库表另行核对，排除自连接和临时对象。 */
export function mysqlQueryRelationOrigin(managed: ManagedConnection, target: QueryTarget, fields: readonly FieldPacket[]): QueryOrigin | undefined {
  const directory = managed.sessionObjects?.snapshot(), context = managed.queryRowContext;
  if (!context || !directory || directory.uncertain || !fields.length || fields.length > 1024) return;
  const computed = expressionIndices(target.projection, fields.length);
  if (!computed) return;
  const computedSet = new Set(computed), computedInfo = computed.length ? { computed } : {};
  const equal = (a: string, b: string) => directory.caseMode ? a.toLowerCase() === b.toLowerCase() : a === b;
  const shadowed = (database: string, table: string) => directory.objects.some(object => equal(database, object.database) && equal(table, object.name));
  if (!target.joined) {
    const first = fields.find((_, index) => !computedSet.has(index));
    const database = first?.schema ?? first?.db, table = first?.orgTable;
    if (!database || !table || !equal(table, target.table) || target.database && !equal(database, target.database) ||
        fields.some((field, index) => !computedSet.has(index) && ((field.schema ?? field.db) !== database || field.orgTable !== table || !field.orgName)) || shadowed(database, table)) return;
    return { context, database, table, columns: fields.map((field, index) => computedSet.has(index) ? null : field.orgName), ...computedInfo };
  }
  const currentDatabase = managed.completionDatabase?.known ? managed.completionDatabase.database : undefined;
  const resolved = new Map<QueryTable, PhysicalTable>(), columns: (string | null)[] = [];
  for (const [index, field] of fields.entries()) {
    if (computedSet.has(index)) { columns.push(null); continue; }
    const matches = target.joined.filter(ref => !!field.table && equal(ref.alias, field.table));
    const ref = matches[0], database = field.schema ?? field.db, table = field.orgTable;
    const expectedDatabase = ref?.database ?? currentDatabase;
    if (matches.length !== 1 || !database || !table || !field.orgName || !expectedDatabase ||
        !equal(database, expectedDatabase) || !equal(table, ref.table) || shadowed(database, table)) return;
    const previous = resolved.get(ref);
    if (previous && (previous.database !== database || previous.table !== table)) return;
    resolved.set(ref, { database, table });
    columns.push(ref === target.joined[0] ? field.orgName : null);
  }
  const physical = target.joined.map(ref => resolved.get(ref));
  if (physical.some(ref => !ref)) return;
  const joined = physical as PhysicalTable[];
  if (joined.some((ref, index) => joined.slice(0, index).some(other => equal(ref.database, other.database) && equal(ref.table, other.table)))) return;
  return { context, ...joined[0], columns, joined: joined.slice(1), ...computedInfo };
}

/** 对选定的主表协议列按原类型核对所有已返回行的主键唯一性。 */
export function mysqlQueryKeysUnique(result: QueryResult, indices: readonly number[]): boolean {
  if (!indices.length || result.truncated || !result.rows.length) return false;
  const keys = indices.map(index => result.columns[index]?.key);
  if (keys.some(key => key === undefined)) return false;
  const seen = new Set<string>();
  for (const row of result.rows) {
    const values = keys.map(key => row[key]);
    if (values.some(value => value === undefined || value === null)) return false;
    const signature = JSON.stringify(values);
    if (seen.has(signature)) return false;
    seen.add(signature);
  }
  return true;
}

export function mysqlQueryRelationSource(managed: ManagedConnection, target: QueryTarget,
  fields: readonly FieldPacket[], result: QueryResult, executionId: string, joinedPrimaryKey: readonly string[] = []): MysqlQueryRelationSource | undefined {
  if (fields.length !== result.columns.length) return;
  const origin = mysqlQueryRelationOrigin(managed, target, fields);
  if (!origin) return;
  // MySQL 连接查询可能不返回 PRI_KEY 标志，JOIN 必须使用目录的完整主键。
  const primary = fields.flatMap((field, index) => origin.columns[index] !== null && typeof field.flags === 'number' && (field.flags & 2) !== 0 ? [index] : []);
  const rowReadable = origin.joined ? mysqlQueryKeysUnique(result, joinedPrimaryKey.map(name => origin.columns.indexOf(name))) : result.rows.length > 0 && primary.length > 0;
  return { ...origin, executionId, result, ...(rowReadable ? { rowReadable: true as const } : {}) };
}

/** 数值主键沿用精确十进制绑定，避免以双精度字符串比较相邻 BIGINT。 */
export function mysqlQueryRelationSelect(source: MysqlQueryRelationSource, info: TableInfo, index: number, lock: boolean | 'share' = false) {
  const original = source.result.rows[index], names = info.columns.map(column => column.name);
  if (!original || info.objectKind !== 'table' || info.engine.toUpperCase() !== 'INNODB' || !info.primaryKey.length ||
      info.database !== source.database || info.name !== source.table || source.columns.some(column => column !== null && !names.includes(column))) throw blocked();
  const values = new Map<string, CellValue>();
  for (const [position, column] of source.columns.entries()) {
    if (column === null) continue;
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
    ' WHERE ' + where.sql + ' LIMIT 2' + (lock === 'share' ? ' LOCK IN SHARE MODE' : lock ? ' FOR UPDATE' : ''), searchKey.params);
  return { sql, searchKey, verify(page: TablePage): DataRow {
    const row = page.rows[0];
    if (!row || page.rows.length !== 1 || page.hasMore || [...values].some(([column, value]) =>
      !Object.hasOwn(row, column) || JSON.stringify(row[column]) !== JSON.stringify(value))) throw blocked();
    return row;
  } };
}

/** 只保留原行及结构摘要。列顺序取可信目录，缺列或多列均不能伪造相同的完整原值。 */
export function mysqlQueryEditRowDigest(info: Pick<TableInfo, 'columns'>, row: DataRow): string {
  if (Object.keys(row).length !== info.columns.length || info.columns.some(column => !Object.hasOwn(row, column.name))) throw blocked();
  return createHash('sha256').update(JSON.stringify(info.columns.map(column => row[column.name]))).digest('hex');
}

export function mysqlQueryEditSchemaDigest(managed: ManagedConnection, info: TableInfo, unkeyedInsert = false): string {
  if (managed.sqlMode === undefined || info.objectKind !== 'table' || info.engine.toUpperCase() !== 'INNODB' ||
      !unkeyedInsert && (!info.primaryKey.length || info.primaryKey.length !== info.editableKey.length ||
      info.primaryKey.some((name, index) => name !== info.editableKey[index]))) throw blocked();
  return createHash('sha256').update(JSON.stringify([info.columns, info.primaryKey,
    recordDefinitionDigest(info.ddl, managed.sqlMode, managed.status.dialect)])).digest('hex');
}
