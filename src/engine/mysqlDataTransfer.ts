import { createHash } from 'node:crypto';
import type { ResultSetHeader } from 'mysql2';
import { mysqlDataTransferLimits as limits, type MysqlDataTransferEndpoint } from '../shared/mysqlDataTransfer';
import { assertTableStructureExportable } from '../shared/tableColumnPatches';
import { completionQuery } from './completionQuery';
import { readSchemaComparisonTarget } from './schemaCompare';
import { identifier, qualified } from './sql';
import { structureDocumentOf, structureTaskQuery, type StructureTaskContext } from './structureDefinition';
import { tableDefinitionTokens } from './tableColumnDefinition';
import { readTableIndexDefinition } from './tableIndexDefinition';

export interface TransferTable {
  name: string; definition: string; columns: { name: string; binary: boolean; expression: string }[];
  mode: string; version: string; dialect: 'mysql' | 'mariadb'; identity: string; definitionKey: string;
}
type Values = (string | null)[];
export interface TransferRows { values: Values[]; digest: string; bytes: number; }
type Row = Record<string, unknown>;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const word = (token: { kind: string; value: string } | undefined) => token?.kind === 'word' ? token.value.toUpperCase() : '';
const supportedType = /^(?:TINYINT|SMALLINT|MEDIUMINT|INT|INTEGER|BIGINT|DECIMAL|NUMERIC|CHAR|VARCHAR|TINYTEXT|TEXT|MEDIUMTEXT|LONGTEXT|BINARY|VARBINARY|TINYBLOB|BLOB|MEDIUMBLOB|LONGBLOB|DATE|TIME|DATETIME|TIMESTAMP|YEAR|ENUM|SET)\b/i;
const binaryType = /^(?:BINARY|VARBINARY|TINYBLOB|BLOB|MEDIUMBLOB|LONGBLOB)\b/i;
const query = <T>(context: StructureTaskContext, sql: string, values: (string | Buffer | null)[] = []) =>
  completionQuery<T>(context.managed, context, sql, values);

/** 只从服务器原始定义生成单条 CREATE，剥离运行中的自增计数，不复制外键、可执行选项或表达式。 */
export async function readTransferTable(context: StructureTaskContext, endpoint: MysqlDataTransferEndpoint, name: string): Promise<TransferTable> {
  const read = await readSchemaComparisonTarget(context, { ...endpoint, table: name }), doc = structureDocumentOf(read);
  const indexes = readTableIndexDefinition(doc);
  if (!doc.columns.length || doc.columns.length > 128 ||
      doc.items.filter(item => item.kind === 'constraint').length !== indexes.indexes.length ||
      indexes.indexes.some(index => !['ordinary', 'unique', 'primary'].includes(index.kind) || index.opaqueReasons.length ||
        index.parts.some(part => !part.columnName)) ||
      doc.columns.some(column => !column.type.known || !supportedType.test(column.type.raw) ||
        column.attributes.some(attribute => !['nullable', 'default', 'comment', 'charset', 'collation', 'auto-increment', 'on-update'].includes(attribute.kind)) ||
        column.default.kind === 'opaque') ||
      tableDefinitionTokens(read.source, read.context).some(token => token.kind === 'executable'))
    throw Error('表 ' + name + ' 含当前数据传输不支持的字段、索引或约束');
  assertTableStructureExportable(doc, read.normalizedMode);
  const tail = tableDefinitionTokens(doc.tail.raw, read.context);
  const options: string[] = [];
  let engine = false;
  // 表定义解析器的尾部区间从字段列表自身的闭括号开始。
  if (tail[0]?.kind !== 'symbol' || tail[0].value !== ')') throw Error('表定义缺少可确认的字段边界');
  for (let i = 1; i < tail.length;) {
    const start = tail[i].start;
    if (word(tail[i]) === 'DEFAULT') i++;
    const key = word(tail[i++]), separator = tail[i++], value = tail[i++];
    if (!['ENGINE', 'CHARSET', 'COLLATE', 'ROW_FORMAT', 'COMMENT', 'AUTO_INCREMENT'].includes(key) ||
        separator?.value !== '=' || !value ||
        (key === 'COMMENT' ? value.kind !== 'string' : !/^[A-Za-z0-9_]+$/.test(value.value)))
      throw Error('表 ' + name + ' 含当前数据传输不支持的表选项');
    if (key === 'ENGINE') engine = word(value) === 'INNODB';
    if (key !== 'AUTO_INCREMENT') options.push(doc.tail.raw.slice(start, value.end));
  }
  if (!engine) throw Error('数据传输仅支持普通 InnoDB 表');
  const columns = doc.columns.map(column => {
    const binary = binaryType.test(column.type.raw), field = identifier(column.name);
    return { name: column.name, binary, expression: 'HEX(' + (binary ? field : 'CAST(' + field + ' AS CHAR CHARACTER SET utf8mb4)') + ')' };
  });
  // SHOW CREATE 可能在目标展开可推导的 CHARACTER SET；用目录中的实际编码判断语义，
  // 其余属性与约束继续使用定义词法，不把隐式编码差异当作可忽略。
  const canonical = doc.items.map(item => {
    let raw = item.raw;
    if (item.kind === 'column') {
      const encoding = item.attributes.filter(attribute => attribute.kind === 'charset' || attribute.kind === 'collation');
      for (const attribute of encoding.reverse()) {
        raw = raw.slice(0, attribute.range.start - item.range.start) + ' ' + raw.slice(attribute.range.end - item.range.start);
      }
    }
    return tableDefinitionTokens(raw, read.context).map(token => [token.kind, token.value]);
  });
  return { name, definition: '(\n  ' + doc.items.map(item => item.raw.trim()).join(',\n  ') + '\n) ' + options.join(' '),
    columns, mode: read.normalizedMode, version: read.serverVersion, dialect: read.context.dialect, identity: read.identity,
    definitionKey: digest([canonical, options, read.encodings, read.tableEncoding, read.nullability]) };
}

export function transferCreateSql(target: MysqlDataTransferEndpoint, table: TransferTable): string {
  return 'CREATE TABLE ' + qualified(target.database, table.name) + ' ' + table.definition;
}

/** 目标必须是已存在的准确库名；表和视图同名均在任何写入前拦截。 */
export async function transferDestination(context: StructureTaskContext, endpoint: MysqlDataTransferEndpoint, tables: TransferTable[]) {
  const dialect = context.managed.status.dialect, version = context.managed.status.version;
  if (dialect !== 'mysql' && dialect !== 'mariadb') throw Error('数据传输需要 MySQL 或 MariaDB');
  const [facts] = (await query<Row[]>(context, 'SELECT @@hostname AS host, @@server_id AS serverId, @@port AS port, ' +
    'CURRENT_USER() AS account, @@SESSION.sql_mode AS mode, @@GLOBAL.read_only AS readOnly' +
    (dialect === 'mysql' ? ', @@server_uuid AS uuid' : ''))).rows;
  const familyVersion = (value: string) => value.replace(/^5\.5\.5-/, '').match(/^\d+\.\d+(?=\.)/)?.[0];
  if (!facts || ![0, '0'].includes(facts.readOnly as 0 | '0') || typeof facts.mode !== 'string' ||
      !facts.mode.split(',').some(mode => mode === 'STRICT_TRANS_TABLES' || mode === 'STRICT_ALL_TABLES') ||
      !['8.0', '8.4', '10.11', '11.4'].includes(familyVersion(version) ?? '') ||
      tables.some(table => table.dialect !== dialect || familyVersion(table.version) !== familyVersion(version) || table.mode !== facts.mode))
    throw Error('源和目标需要相同的已支持服务器系列、主次版本及严格 SQL 模式，且目标可写');
  const schemas = (await query<Row[]>(context, 'SELECT SCHEMA_NAME AS name, DEFAULT_CHARACTER_SET_NAME AS charset, DEFAULT_COLLATION_NAME AS collation ' +
    'FROM information_schema.SCHEMATA WHERE BINARY SCHEMA_NAME = BINARY ?', [endpoint.database])).rows;
  if (schemas.length !== 1 || schemas[0].name !== endpoint.database) throw Error('未找到准确的目标数据库');
  const names = tables.map(table => table.name);
  const occupied = (await query<Row[]>(context, 'SELECT TABLE_NAME AS name FROM information_schema.TABLES ' +
    'WHERE BINARY TABLE_SCHEMA = BINARY ? AND LOWER(TABLE_NAME) IN (' + names.map(() => 'LOWER(?)').join(', ') + ') LIMIT 1',
  [endpoint.database, ...names])).rows;
  if (occupied.length) throw Error('目标库已有同名表或视图：' + String(occupied[0].name));
  return { stamp: digest([facts, schemas[0], dialect, version]), version };
}

/** 在同一个 InnoDB 快照内先核对行数与字节上限，再读取有界、可精确回读的十六进制值。 */
export async function readTransferRows(context: StructureTaskContext, endpoint: MysqlDataTransferEndpoint, table: TransferTable,
  remaining: { rows: number; bytes: number }): Promise<TransferRows> {
  const from = qualified(endpoint.database, table.name), expressions = table.columns.map(column => column.expression);
  const length = expressions.map(expression => 'COALESCE(OCTET_LENGTH(' + expression + '), 0) + 8').join(' + ');
  const [size] = (await structureTaskQuery<Row[]>(context, 'SELECT COUNT(*) AS records, COALESCE(SUM(' + length + '),0) AS bytes, ' +
    'COALESCE(MAX(' + length + '),0) AS largest FROM ' + from)).rows;
  const records = Number(size?.records), bytes = Number(size?.bytes), largest = Number(size?.largest);
  if (![records, bytes, largest].every(value => Number.isSafeInteger(value) && value >= 0) ||
      records > remaining.rows || bytes > remaining.bytes || largest > limits.rowBytes)
    throw Error('所选表超过本次数据传输的行数或字节上限');
  const rows = (await structureTaskQuery<Row[]>(context, 'SELECT ' +
    expressions.map((expression, index) => expression + ' AS v' + index).join(', ') + ' FROM ' + from + ' LIMIT ' + (records + 1))).rows;
  if (rows.length !== records) throw Error('快照行数已变化，未确认数据传输');
  const values = rows.map(row => table.columns.map((_, index) => {
    const value = row['v' + index];
    if (!(value === null || typeof value === 'string' && value.length % 2 === 0 && /^[0-9A-F]*$/.test(value)))
      throw Error('服务器返回无法证明原值的字段');
    return value;
  }));
  const actualBytes = values.reduce((total, row) => total + row.reduce((cells, value) => cells + (value?.length ?? 0) + 8, 0), 0);
  if (actualBytes !== bytes) throw Error('快照字节数不一致，未确认数据传输');
  return { values, digest: digest(values.map(digest).sort()), bytes };
}

/** 参数传输不拼接记录值，按包限制分批；有警告或写入行数不符时由调用方回滚。 */
export async function writeTransferRows(context: StructureTaskContext, target: MysqlDataTransferEndpoint, table: TransferTable, rows: TransferRows) {
  const head = 'INSERT INTO ' + qualified(target.database, table.name) + ' (' + table.columns.map(column => identifier(column.name)).join(', ') + ') VALUES ';
  // 驱动的 Buffer 参数仍可能声明为字符串类型，UNHEX 让目标服务器按原始二进制构造值。
  const group = '(' + table.columns.map(column => column.binary ? 'UNHEX(?)' : '?').join(', ') + ')';
  let index = 0;
  while (index < rows.values.length) {
    const params: (string | null)[] = [];
    let chunks = 0, bytes = 0;
    while (index < rows.values.length && chunks < 100 && bytes < 512 * 1024) {
      for (let i = 0; i < table.columns.length; i++) {
        const raw = rows.values[index][i];
        const value = raw === null || table.columns[i].binary ? raw : Buffer.from(raw, 'hex').toString('utf8');
        bytes += (value === null ? 0 : Buffer.byteLength(value)) + 8;
        params.push(value);
      }
      index++; chunks++;
    }
    const { rows: result } = await query<ResultSetHeader>(context, head + Array<string>(chunks).fill(group).join(', '), params);
    if (result.warningStatus !== 0 || result.affectedRows !== chunks) throw Error('目标写入返回警告或行数不一致');
  }
}
