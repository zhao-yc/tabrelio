import type { QueryResult, SqliteResultColumnOrigin } from '../shared/contracts';
import { sqliteDefinitionTokens } from '../shared/sqliteCompletionAnalysis';
import { foldSqliteCompletionName as fold } from '../shared/sqliteCompletion';
import { quoteSqliteIdentifier as quote } from '../shared/sqliteReadSql';
import type { SqliteTablePage } from '../shared/sqliteTableBrowse';
import type { SqliteDriverSession } from '../engine/sqlite/session';
import type { SqliteFileIdentity, SqliteValue } from '../engine/sqlite/protocol';

type Token = ReturnType<typeof sqliteDefinitionTokens>[number];
type Projection = 'column' | 'wildcard' | 'expression';
const word = (token: Token | undefined, value: string) => token?.kind === 'id' && !token.quoted && fold(token.value) === value;
const symbol = (token: Token | undefined, value: string) => token?.kind === 'symbol' && token.value === value;
const blocked = () => Error('SQLite 查询结果无法核验为当前原记录，请重新执行查询');
const scalarFunctions = new Set(['abs', 'cast', 'char', 'coalesce', 'concat', 'concat_ws', 'date', 'datetime', 'format', 'hex',
  'ifnull', 'iif', 'instr', 'json_array_length', 'json_extract', 'json_type', 'julianday', 'length', 'lower', 'ltrim',
  'nullif', 'octet_length', 'printf', 'quote', 'replace', 'round', 'rtrim', 'strftime', 'substr', 'substring', 'time',
  'trim', 'typeof', 'unicode', 'unixepoch', 'upper']);
const scalarGrammar = new Set(['when', 'then', 'else', 'and', 'or', 'not', 'in', 'is']);
const scalarLiterals = new Set(['null', 'true', 'false', 'current_date', 'current_time', 'current_timestamp']);
const castTypes = new Set(['char', 'varchar', 'decimal', 'numeric']);

export interface SqliteQueryRecordSource {
  table: string;
  taskId: string;
  identity: SqliteFileIdentity;
  schemaVersion: string;
  keyed: boolean;
  result: QueryResult;
  origins: readonly SqliteResultColumnOrigin[];
}

function directProjection(tokens: Token[]): Projection {
  let cursor = 0;
  while (tokens[cursor]?.kind === 'id' && symbol(tokens[cursor + 1], '.')) cursor += 2;
  if (symbol(tokens[cursor], '*') && cursor === tokens.length - 1) return 'wildcard';
  const column = tokens[cursor], next = tokens[cursor + 1];
  if (column?.kind !== 'id' || cursor === 0 && !column.quoted &&
      (scalarLiterals.has(fold(column.value)) || word(column, 'x') && next?.kind === 'string' && column.end === next.start)) return 'expression';
  const alias = (token?: Token) => token?.kind === 'id' || token?.kind === 'string';
  const rest = tokens.length - cursor - 1;
  return rest === 0 || rest === 1 && alias(next) || rest === 2 && word(next, 'as') && alias(tokens[cursor + 2]) ? 'column' : 'expression';
}

function queryProjection(tokens: Token[]): Projection[] | undefined {
  if (!tokens.length || word(tokens[0], 'distinct')) return;
  const parts: Token[][] = [];
  let start = 0;
  for (const [index, token] of tokens.entries()) if (token.depth === 0 && symbol(token, ',')) {
    parts.push(tokens.slice(start, index));
    start = index + 1;
  }
  parts.push(tokens.slice(start));
  if (parts.some(part => !part.length || part.some((token, index) => {
    if (token.kind !== 'id' || !symbol(part[index + 1], '(')) return false;
    const name = fold(token.value);
    return token.quoted || symbol(part[index - 1], '.') ||
      !scalarFunctions.has(name) && !scalarGrammar.has(name) && !(word(part[index - 1], 'as') && castTypes.has(name));
  }))) return;
  const projection = parts.map(directProjection);
  return projection.every(kind => kind === 'expression') ? undefined : projection;
}

/** 原生来源不区分括号列和直接列；语法证明单表基数，单独记录计算列以免参与写入和定位。 */
export function sqliteQueryRecordTarget(sql: string): { table: string; projection: Projection[] } | undefined {
  // 原生行注释只在 LF 结束，防止孤立 CR 令补全词法看到原生未执行的令牌。
  if (/--[^\n]*\r(?!\n)/.test(sql)) return;
  let tokens: Token[];
  try { tokens = sqliteDefinitionTokens(sql, true); } catch { return; }
  if (symbol(tokens.at(-1), ';')) tokens.pop();
  if (!word(tokens[0], 'select') || tokens.slice(1).some(token => symbol(token, ';') ||
      ['select', 'union', 'intersect', 'except', 'group', 'having', 'window'].some(name => word(token, name)))) return;
  const from = tokens.findIndex((token, index) => index > 1 && token.depth === 0 && word(token, 'from'));
  if (from < 0) return;
  const projection = queryProjection(tokens.slice(word(tokens[1], 'all') ? 2 : 1, from));
  if (!projection) return;
  let i = from + 1;
  if (symbol(tokens[i + 1], '.')) {
    if (tokens[i]?.kind !== 'id' || fold(tokens[i].value) !== 'main') return;
    i += 2;
  }
  const name = tokens[i++];
  if (name?.kind !== 'id') return;
  const suffix = (token: Token | undefined) => ['where', 'order', 'limit'].some(value => word(token, value));
  if (word(tokens[i], 'as')) {
    if (tokens[++i]?.kind !== 'id') return;
    i++;
  } else if (tokens[i]?.kind === 'id' && !suffix(tokens[i]) &&
      (tokens[i].quoted || !['join', 'left', 'right', 'full', 'inner', 'outer', 'cross', 'natural', 'indexed', 'not'].some(value => word(tokens[i], value)))) i++;
  if (tokens[i] && !suffix(tokens[i])) return;
  return { table: name.value, projection };
}

/** 单表的每处通配符都展开为同样宽度，按实际结果列数计算表达式位置。 */
export function sqliteQueryComputedPositions(projection: Projection[], width: number): number[] | undefined {
  const wildcards = projection.filter(kind => kind === 'wildcard').length;
  const expansion = wildcards ? 1 + (width - projection.length) / wildcards : 1;
  if (!Number.isSafeInteger(expansion) || expansion < 1 || !wildcards && width !== projection.length) return;
  const computed: number[] = [];
  let index = 0;
  for (const kind of projection) {
    if (kind === 'expression') computed.push(index);
    index += kind === 'wildcard' ? expansion : 1;
  }
  return computed;
}

/** 同时核对 main 目录修订与临时同名对象，后者可以遮蔽未限定的原表。 */
export async function sqliteQueryRecordSchema(driver: SqliteDriverSession, table: string): Promise<{ version: string; keys: string[] } | undefined> {
  let row: readonly SqliteValue[] | undefined;
  await driver.execute("SELECT schema_version, EXISTS(SELECT 1 FROM temp.sqlite_schema WHERE name=? COLLATE NOCASE AND type IN ('table','view')), " +
    "(SELECT json_group_array(name ORDER BY pk) FROM pragma_table_xinfo(?, 'main') WHERE pk>0) FROM pragma_schema_version " +
    "WHERE EXISTS(SELECT 1 FROM pragma_table_list WHERE schema='main' AND name=? COLLATE NOCASE AND type='table' AND substr(name,1,7)<>'sqlite_')",
    { parameters: [table, table, table], maxRows: 1, onBatch: batch => { row = batch.rows[0]; } });
  const [version, shadow, rawKeys] = row ?? [];
  if (!version || typeof version !== 'object' || version.type !== 'integer' ||
      !shadow || typeof shadow !== 'object' || shadow.type !== 'integer' || shadow.value !== '0' || typeof rawKeys !== 'string') return;
  const keys: unknown = JSON.parse(rawKeys);
  if (Array.isArray(keys) && keys.every(key => typeof key === 'string')) return { version: version.value, keys };
}

export interface SqliteQueryRecordPredicate {
  where: string;
  parameters: SqliteValue[];
  verify(row: readonly SqliteValue[]): void;
}

/** 同一个读快照先核对文件与目录，再按传入顺序为每条原行建立主键及原投影校验。 */
export async function sqliteQueryRecordPredicates(driver: SqliteDriverSession, source: SqliteQueryRecordSource, indices: readonly number[],
  primaryKey: SqliteTablePage['primaryKey'], columns: SqliteTablePage['columns']): Promise<SqliteQueryRecordPredicate[]> {
  const identity = driver.identity;
  if (!primaryKey?.length || !identity || identity.path !== source.identity.path || identity.device !== source.identity.device ||
      identity.inode !== source.identity.inode || (await sqliteQueryRecordSchema(driver, source.table))?.version !== source.schemaVersion)
    throw blocked();
  return indices.map(index => queryRecordPredicate(source, index, primaryKey, columns));
}

function queryRecordPredicate(source: SqliteQueryRecordSource, index: number, primaryKey: NonNullable<SqliteTablePage['primaryKey']>,
  columns: SqliteTablePage['columns']): SqliteQueryRecordPredicate {
  const values = sqliteQueryRecordValues(source, index, columns);
  const parameters: SqliteValue[] = [];
  const where = sqliteQueryRecordKey(values, primaryKey.map(key => key.name), value => {
    parameters.push(value);
    return '?';
  });
  return { where, parameters, verify(actual: readonly SqliteValue[]) {
    if (actual.length !== columns.length || columns.some((column, i) =>
      values.has(column.name) && JSON.stringify(actual[i]) !== JSON.stringify(values.get(column.name)))) throw blocked();
  } };
}

/** 按原生存储类还原直接投影；同一原列的多个别名须给出完全相同的值。 */
export function sqliteQueryRecordValues(source: SqliteQueryRecordSource, index: number, columns: SqliteTablePage['columns']): Map<string, SqliteValue> {
  const { result, origins } = source;
  const row = result.rows[index], storage = result.sqliteStorage?.rows[index];
  if (!row || storage?.length !== result.columns.length) throw blocked();
  const values = new Map<string, SqliteValue>();
  for (const [columnIndex, origin] of origins.entries()) {
    if (!origin) continue;
    if (!columns.some(column => column.name === origin.column)) throw blocked();
    const cell = row[result.columns[columnIndex].key], kind = storage[columnIndex];
    let value: SqliteValue;
    if (kind === 'n' && cell === null || kind === 't' && typeof cell === 'string') value = cell;
    else if ((kind === 'i' || kind === 'r') && typeof cell === 'string') value = { type: kind === 'i' ? 'integer' : 'real', value: cell };
    else if (kind === 'b' && cell && typeof cell === 'object') value = cell;
    else throw blocked();
    // node:sqlite 会将非法 TEXT 字节解码为替代字符，不能把有歧义的字节绑定到另一条原行。
    if (typeof value === 'string' && value.includes('\uFFFD')) throw blocked();
    if (values.has(origin.column) && JSON.stringify(values.get(origin.column)) !== JSON.stringify(value)) throw blocked();
    values.set(origin.column, value);
  }
  return values;
}

/** 比较存储类和原值，避免列排序规则或类型亲和性改变要定位的记录。 */
export function sqliteQueryRecordKey(values: ReadonlyMap<string, SqliteValue>, keys: readonly string[],
  parameter: (value: SqliteValue) => string): string {
  if (!keys.length) throw blocked();
  return keys.map(name => {
    const value = values.get(name);
    if (value === undefined || value === null) throw blocked();
    const storageClass = typeof value === 'string' ? 'text' : value.type === 'binary' ? 'blob' : value.type;
    const column = quote(name);
    return '(typeof(' + column + ')=' + parameter(storageClass) + ' AND ' + column + ' COLLATE BINARY IS ' + parameter(value) + ')';
  }).join(' AND ');
}
