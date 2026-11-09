import type { CellValue, QueryResult } from '../../shared/contracts';
import type { PostgresColumnReference } from '../../shared/postgresResultOrigins';
import { postgresIdentifier, scanPostgresEditorTokens } from '../../shared/postgresSql';
import type { PostgresConnection } from './connection';
import type { PostgresReferenceRowVersion } from './tableReferences';
import { readPostgresResultOrigins } from './resultOrigins';

type Token = NonNullable<ReturnType<typeof scanPostgresEditorTokens>>[number];
const keyword = (token: Token | undefined, value: string) => token?.kind === 'word' && token.text.toLowerCase() === value;
const punct = (token: Token | undefined, value: string) => token?.kind === 'punct' && token.text === value;
const identifier = (token: Token | undefined) => token?.kind === 'word' ? token.text.replace(/[A-Z]/g, c => c.toLowerCase())
  : token?.kind === 'identifier' && !token.open ? token.text : undefined;
const blocked = () => Error('PostgreSQL 查询原记录无法核验，请重新执行查询');
const budget = () => ({ rows: 2, bytes: 8 * 1024 * 1024 });

/** 只接受单一直接表引用及直接列投影，拒绝自连接、聚合和复合查询造成的原行歧义。 */
export function postgresQueryRecordTable(sql: string, standardStrings: boolean): { schema?: string; name: string } | undefined {
  if (sql.length > 262144) return;
  const tokens = scanPostgresEditorTokens(sql, 16384, standardStrings)?.filter(token => token.kind !== 'blocked' || token.text !== 'comment');
  if (!tokens || !keyword(tokens[0], 'select')) return;
  if (punct(tokens.at(-1), ';')) tokens.pop();
  if (tokens.slice(1).some(token => punct(token, ';') || ['select', 'union', 'intersect', 'except', 'group', 'having', 'window', 'into', 'for'].some(word => keyword(token, word)))) return;
  const from = tokens.findIndex(token => keyword(token, 'from'));
  if (from < 2) return;
  const projection = tokens.slice(1, from);
  if (keyword(projection[0], 'all')) projection.shift();
  if (!projection.length || keyword(projection[0], 'distinct') ||
      projection.some(token => !identifier(token) && !['.', '*', ','].some(value => punct(token, value)))) return;
  let i = from + 1;
  const first = identifier(tokens[i++]);
  if (!first || ['only', 'lateral'].some(word => keyword(tokens[i - 1], word))) return;
  const schema = punct(tokens[i], '.') ? first : undefined;
  const name = schema ? identifier(tokens[++i]) : first;
  if (schema) i++;
  if (!name) return;
  const suffix = (token: Token | undefined) => ['where', 'order', 'limit', 'offset', 'fetch'].some(word => keyword(token, word));
  if (keyword(tokens[i], 'as')) {
    if (!identifier(tokens[++i])) return;
    i++;
  } else if (identifier(tokens[i]) && !suffix(tokens[i]) &&
      !['join', 'left', 'right', 'full', 'inner', 'cross', 'natural', 'tablesample'].some(word => keyword(tokens[i], word))) i++;
  if (tokens[i] && !suffix(tokens[i])) return;
  return { schema, name };
}

export interface PostgresQueryRecordSource {
  executionId: string;
  server: string;
  identity: string;
  table: NonNullable<ReturnType<typeof postgresQueryRecordTable>>;
  result: QueryResult;
  origins: NonNullable<PostgresColumnReference>[];
  capabilities: { update: boolean; delete: boolean };
}

/** 在原查询会话按其搜索路径确认真正的关系、有效主键及物理文件。 */
export async function postgresQueryRecordIdentity(connection: PostgresConnection, relation: string, oid: number) {
  const result = await connection.query(`SELECT c.relfilenode::text, current_user::text,
    (SELECT pg_catalog.jsonb_agg(k.attnum ORDER BY k.ordinality)::text
     FROM pg_catalog.pg_index i, LATERAL pg_catalog.unnest(i.indkey) WITH ORDINALITY k(attnum, ordinality)
     WHERE i.indrelid=c.oid AND i.indisprimary AND i.indisvalid AND k.ordinality<=i.indnkeyatts),
    pg_catalog.has_table_privilege(c.oid, 'UPDATE'), pg_catalog.has_table_privilege(c.oid, 'DELETE')
    FROM pg_catalog.pg_class c WHERE c.oid=$2::oid AND c.oid=pg_catalog.to_regclass($1)::oid
      AND c.relkind='r' AND c.relpersistence IN ('p','u') AND NOT c.relispartition AND NOT c.relhasrules
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_inherits h WHERE h.inhparent=c.oid)`,
    [relation, String(oid)], budget(), undefined, 'extended');
  const row = result.rows[0];
  if (result.truncated || result.rows.length !== 1 || typeof row.c0 !== 'string' ||
      typeof row.c1 !== 'string' || typeof row.c2 !== 'string') return;
  const keys: unknown = JSON.parse(row.c2);
  if (Array.isArray(keys) && keys.length && keys.every(key => Number.isSafeInteger(key) && key > 0))
    return { keys: keys as number[], identity: JSON.stringify([row.c0, row.c1, keys]),
      capabilities: { update: row.c3 === 't', delete: row.c4 === 't' } };
}

/** 独立连接必须仍在原服务器和库，来源目录使用服务器报告的关系 OID。 */
export async function resolvePostgresQueryRecord(connection: PostgresConnection, source: PostgresQueryRecordSource) {
  if (connection.serverIdentity !== source.server) throw blocked();
  const origins = await readPostgresResultOrigins(connection, source.origins);
  const first = origins[0];
  if (!first?.canOpen || first.table !== source.table.name || source.table.schema && first.schema !== source.table.schema ||
      origins.some(origin => !origin || origin.schema !== first.schema || origin.table !== first.table)) throw blocked();
  return { table: postgresIdentifier(first.schema) + '.' + postgresIdentifier(first.table),
    columns: origins.map(origin => origin!.column) };
}

function parameter(value: CellValue): string | Buffer {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') return Buffer.from(value.base64, 'base64');
  throw blocked();
}

function sameCell(before: CellValue, after: CellValue): boolean {
  return before && typeof before === 'object'
    ? !!after && typeof after === 'object' && before.base64 === after.base64
    : Object.is(before, after);
}

/** 主键定位后按原投影原文核对，再捕获整行的 ctid/xmin；写入沿用现有原行保护。 */
export async function verifyPostgresQueryEdit(connection: PostgresConnection, source: PostgresQueryRecordSource,
  rowIndices: readonly number[], resolved: Awaited<ReturnType<typeof resolvePostgresQueryRecord>>,
  relation: { oid: string; sql: string; keys: string[] }) {
  const oid = String(source.origins[0].relation);
  if (relation.oid !== oid || relation.sql !== resolved.table || !relation.keys.length) throw blocked();
  const checkServer = async (current: PostgresConnection) => {
    if (current.serverIdentity !== source.server ||
        (await postgresQueryRecordIdentity(current, resolved.table, Number(oid)))?.identity !== source.identity) throw blocked();
  };
  await checkServer(connection);
  const locked = await resolvePostgresQueryRecord(connection, source);
  if (locked.table !== resolved.table || locked.columns.some((column, index) => column !== resolved.columns[index])) throw blocked();
  const fields = locked.columns.map(postgresIdentifier);
  const keys = relation.keys.map(key => {
    const position = resolved.columns.indexOf(key);
    if (position < 0) throw Error('PostgreSQL 查询结果需要包含原表的完整主键');
    return source.result.columns[position].key;
  });
  const where = relation.keys.map((key, index) => postgresIdentifier(key) + ' = $' + (index + 1)).join(' AND ');
  const sql = 'SELECT tableoid::text, ctid::text, xmin::text, ' + fields.join(', ') +
    ' FROM ONLY ' + relation.sql + ' WHERE ' + where + ' LIMIT 2';
  const originals: PostgresReferenceRowVersion[] = [];
  for (const index of rowIndices) {
    const row = source.result.rows[index];
    if (!row) throw blocked();
    const found = await connection.query(sql, keys.map(key => parameter(row[key])), budget(), undefined, 'extended');
    const original = found.rows[0];
    if (found.truncated || found.rows.length !== 1 || original.c0 !== oid || typeof original.c1 !== 'string' || typeof original.c2 !== 'string' ||
        source.result.columns.some((column, i) => !sameCell(row[column.key], original['c' + (i + 3)]))) throw blocked();
    originals.push({ tableOid: oid, tid: original.c1, version: original.c2 });
  }
  return { originals, checkServer };
}
