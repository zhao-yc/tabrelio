import type { CellValue, QueryOutcome, QueryResult } from '../../shared/contracts';
import type { PostgresColumnReference } from '../../shared/postgresResultOrigins';
import type { PostgresQueryRowSql } from '../../shared/postgresQueryRecord';
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

interface QueryTable { schema?: string; name: string; }
interface QueryTables extends QueryTable { joins?: QueryTable[]; anchorIndex?: number; }
export const qualifiedQueryTable = ({ schema, name }: QueryTable) =>
  (schema ? postgresIdentifier(schema) + '.' : '') + postgresIdentifier(name);
const suffix = (token: Token | undefined) => ['where', 'order', 'limit', 'offset', 'fetch'].some(word => keyword(token, word));
const joinModifiers = ['left', 'right', 'full', 'inner', 'cross', 'natural'];

function queryTableAt(tokens: Token[], start: number) {
  let end = start;
  const first = identifier(tokens[end++]);
  if (!first || ['only', 'lateral'].some(word => keyword(tokens[start], word))) return;
  const schema = punct(tokens[end], '.') ? first : undefined;
  const name = schema ? identifier(tokens[end + 1]) : first;
  if (schema) end += 2;
  if (!name) return;
  let qualifier = name;
  if (keyword(tokens[end], 'as')) {
    const alias = identifier(tokens[++end]);
    if (!alias) return;
    qualifier = alias;
    end++;
  } else if (identifier(tokens[end]) && !suffix(tokens[end]) &&
      !['join', 'on', 'using', 'tablesample', ...joinModifiers].some(word => keyword(tokens[end], word))) {
    qualifier = identifier(tokens[end++])!;
  }
  return { table: { schema, name }, qualifier, end };
}

/** 在发生星号展开前，定位明确引用左表的投影。目录在查询后变化也不能调换主表。 */
function joinAnchorIndex(tokens: Token[], top: ReadonlySet<number>, start: number, from: number, qualifier: string) {
  let position = 0;
  for (let end = start; end <= from; end++) {
    if (end !== from && (!top.has(end) || !punct(tokens[end], ','))) continue;
    const column = tokens[start + 2];
    const direct = identifier(tokens[start]) === qualifier && punct(tokens[start + 1], '.') &&
      (identifier(column) || punct(column, '*'));
    if (direct && (end === start + 3 || end === start + 4 && identifier(tokens[start + 3]) ||
        end === start + 5 && keyword(tokens[start + 3], 'as') && identifier(tokens[start + 4]))) return position;
    for (let index = start; index < end; index++) {
      if (top.has(index) && punct(tokens[index], '*') && (index === start || punct(tokens[index - 1], '.'))) return;
    }
    start = end + 1;
    position++;
  }
}

/** 识别普通 FROM 和保持左侧原行身份的 INNER／LEFT JOIN。协议和目录再核对实际关系。 */
export function postgresQueryRecordTable(sql: string, standardStrings: boolean): QueryTables | undefined {
  if (sql.length > 262144) return;
  const tokens = scanPostgresEditorTokens(sql, 16384, standardStrings)?.filter(token => token.kind !== 'blocked' || token.text !== 'comment');
  if (!tokens || !keyword(tokens[0], 'select')) return;
  if (punct(tokens.at(-1), ';')) tokens.pop();
  if (keyword(tokens[1], 'distinct')) return;
  const closing: string[] = [];
  const top = new Set<number>();
  let from = -1;
  for (let index = 1; index < tokens.length; index++) {
    const token = tokens[index];
    if (punct(token, ';') || keyword(token, 'select') || keyword(token, 'over') && punct(tokens[index - 1], ')')) return;
    if (!closing.length) top.add(index);
    if (punct(token, '(') || punct(token, '[')) closing.push(token.text === '(' ? ')' : ']');
    else if (punct(token, ')') || punct(token, ']')) {
      if (closing.pop() !== token.text) return;
    } else if (!closing.length) {
      if (['union', 'intersect', 'except', 'group', 'having', 'window', 'into', 'for'].some(word => keyword(token, word))) return;
      // IS [NOT] DISTINCT FROM 是比较运算符，不是关系子句。
      if (from < 0 && keyword(token, 'from') && !keyword(tokens[index - 1], 'distinct')) from = index;
    }
  }
  if (closing.length || from <= (keyword(tokens[1], 'all') ? 2 : 1)) return;
  const first = queryTableAt(tokens, from + 1);
  if (!first) return;
  let index = first.end;
  const joins: QueryTable[] = [];
  while (tokens[index] && !suffix(tokens[index])) {
    if (keyword(tokens[index], 'left')) {
      index++;
      if (keyword(tokens[index], 'outer')) index++;
    } else if (keyword(tokens[index], 'inner')) index++;
    if (!keyword(tokens[index], 'join') || joins.length === 8) return;
    const joined = queryTableAt(tokens, index + 1);
    if (!joined || !['on', 'using'].some(word => keyword(tokens[joined.end], word))) return;
    joins.push(joined.table);
    index = joined.end + 1;
    const condition = index;
    while (tokens[index]) {
      if (top.has(index)) {
        if (punct(tokens[index], ',')) return;
        const next = keyword(tokens[index + 1], 'outer') ? index + 2 : index + 1;
        if (suffix(tokens[index]) || keyword(tokens[index], 'join') ||
            joinModifiers.some(word => keyword(tokens[index], word)) && keyword(tokens[next], 'join')) break;
      }
      index++;
    }
    if (index === condition) return;
  }
  if (!joins.length) return first.table;
  const anchorIndex = joinAnchorIndex(tokens, top, keyword(tokens[1], 'all') ? 2 : 1, from, first.qualifier);
  if (anchorIndex !== undefined) return { ...first.table, joins, anchorIndex };
}

/** 每张参与表须在 RowDescription 中留下自己的物理 OID，以排除别名、自连接和目录漂移歧义。 */
export async function postgresQueryJoinTarget(connection: Pick<PostgresConnection, 'query'>, table: QueryTables,
  origins: readonly PostgresColumnReference[]): Promise<number | undefined> {
  const names = [table, ...(table.joins ?? [])].map(qualifiedQueryTable);
  const projected = new Set(origins.flatMap(origin => origin ? [origin.relation] : []));
  if (projected.size !== names.length) return;
  const found = await connection.query(`SELECT c.oid::text
    FROM pg_catalog.jsonb_array_elements_text($1::pg_catalog.jsonb) WITH ORDINALITY AS x(name, pos)
    JOIN pg_catalog.pg_class c ON c.oid = pg_catalog.to_regclass(x.name)::oid
    WHERE c.relkind = 'r' AND c.relpersistence IN ('p', 'u') AND NOT c.relispartition AND NOT c.relhasrules
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_inherits i WHERE i.inhparent = c.oid)
    ORDER BY x.pos`, [JSON.stringify(names)], { rows: names.length, bytes: 4096 }, undefined, 'extended');
  const oids = found.rows.map(row => Number(row.c0));
  if (found.truncated || oids.length !== names.length || new Set(oids).size !== names.length || oids.some(oid => !projected.has(oid))) return;
  return table.anchorIndex !== undefined && origins[table.anchorIndex]?.relation === oids[0] ? oids[0] : undefined;
}

/** 拒绝同一主键在返回结果中出现多次，覆盖集合返回函数扩行等情形。 */
export function postgresQueryHasUniqueKeys(result: QueryResult, origins: readonly PostgresColumnReference[], keys: readonly number[]): boolean {
  if (!keys.length) return false;
  const columns = keys.map(key => result.columns[origins.findIndex(origin => origin?.attribute === key)]?.key);
  if (columns.some(key => key === undefined)) return false;
  const seen = new Set<string>();
  for (const row of result.rows) {
    const values = columns.map(key => row[key]);
    if (values.some(value => typeof value !== 'string' && (!value || typeof value !== 'object'))) return false;
    const id = JSON.stringify(values);
    if (seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}

export interface PostgresQueryRecordSource {
  executionId: string;
  server: string;
  identity: string;
  table: NonNullable<ReturnType<typeof postgresQueryRecordTable>>;
  result: QueryResult;
  relationOid: number;
  origins: PostgresColumnReference[];
  capabilities: NonNullable<QueryOutcome['postgresQueryRecordCapabilities']>;
  joined?: true;
  replaceColumns: number[];
}

/** 在原查询会话按其搜索路径确认真正的关系、有效主键及物理文件。 */
export async function postgresQueryRecordIdentity(connection: PostgresConnection, relation: string, oid: number, includeRowSql = false) {
  const rowSqlColumns = includeRowSql ? `, n.nspname::text, c.relname::text,
    COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(a.attnum, a.attname::text,
      a.attgenerated <> '', a.attidentity = 'a', a.attidentity <> '' OR EXISTS (
        SELECT 1 FROM pg_catalog.pg_depend p JOIN pg_catalog.pg_class seq ON seq.oid=p.refobjid AND seq.relkind='S'
        WHERE p.classid='pg_catalog.pg_attrdef'::regclass AND p.objid=d.oid
          AND p.refclassid='pg_catalog.pg_class'::regclass AND p.refobjsubid=0)))::text
      FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped), '[]'),
    pg_catalog.has_table_privilege(c.oid, 'SELECT') AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint f WHERE f.contype='f' AND (f.conrelid=c.oid OR f.confrelid=c.oid))` : '';
  const result = await connection.query(`SELECT c.relfilenode::text, current_user::text,
    COALESCE((SELECT pg_catalog.jsonb_agg(k.attnum ORDER BY k.ordinality)::text
     FROM pg_catalog.pg_index i, LATERAL pg_catalog.unnest(i.indkey) WITH ORDINALITY k(attnum, ordinality)
     WHERE i.indrelid=c.oid AND i.indisprimary AND i.indisvalid AND k.ordinality<=i.indnkeyatts), '[]'),
    pg_catalog.has_table_privilege(c.oid, 'UPDATE'), pg_catalog.has_table_privilege(c.oid, 'DELETE'),
    pg_catalog.has_table_privilege(c.oid, 'INSERT'),
    COALESCE((SELECT pg_catalog.jsonb_agg(a.attnum)::text FROM pg_catalog.pg_attribute a
      WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''
        AND a.attidentity <> 'a' AND a.atttypid IN (25, 1042, 1043)), '[]')${rowSqlColumns}
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE c.oid=$2::oid AND c.oid=pg_catalog.to_regclass($1)::oid
      AND c.relkind='r' AND c.relpersistence IN ('p','u') AND NOT c.relispartition AND NOT c.relhasrules
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_inherits h WHERE h.inhparent=c.oid)`,
    [relation, String(oid)], budget(), undefined, 'extended');
  const row = result.rows[0];
  if (result.truncated || result.rows.length !== 1 || typeof row.c0 !== 'string' ||
      typeof row.c1 !== 'string' || typeof row.c2 !== 'string' || typeof row.c6 !== 'string') return;
  const keys: unknown = JSON.parse(row.c2);
  const textAttributes: unknown = JSON.parse(row.c6);
  if (Array.isArray(keys) && keys.every(key => Number.isSafeInteger(key) && key > 0))
    return { keys: keys as number[], identity: JSON.stringify([row.c0, row.c1, keys]),
      textAttributes: new Set<number>(Array.isArray(textAttributes) ? textAttributes : []),
      rowSql: typeof row.c7 === 'string' && typeof row.c8 === 'string' && typeof row.c9 === 'string'
        ? { table: qualifiedQueryTable({ schema: row.c7, name: row.c8 }), columns: row.c9 } : undefined,
      capabilities: { update: row.c3 === 't', delete: row.c4 === 't', insert: row.c5 === 't', reference: row.c10 === 't' } };
}

/** 以协议序号连接真实列名，重复投影只取第一次，计算列与连接表不进入 SQL。 */
export function postgresQueryRowSql(catalogue: { table: string; columns: string }, targets: readonly PostgresColumnReference[],
  keys: readonly number[], uniqueKeys: boolean): PostgresQueryRowSql | undefined {
  let decoded: unknown;
  try { decoded = JSON.parse(catalogue.columns); } catch { return; }
  if (!Array.isArray(decoded)) return;
  const columns: PostgresQueryRowSql['columns'] = [];
  const names = new Map<number, string>();
  const byAttribute = new Map(decoded.filter(item => Array.isArray(item)).map(item => [item[0], item]));
  for (const [position, origin] of targets.entries()) {
    if (!origin || names.has(origin.attribute)) continue;
    const entry = byAttribute.get(origin.attribute);
    if (!entry || typeof entry[1] !== 'string' || entry.slice(2).length !== 3 ||
        entry.slice(2).some(value => typeof value !== 'boolean')) return;
    const [, name, generated, identityAlways, sequenceDefault] = entry;
    columns.push({ position, name, primary: keys.includes(origin.attribute), generated: generated || identityAlways, identityAlways, sequenceDefault });
    names.set(origin.attribute, name);
  }
  if (!columns.length) return;
  const primaryKey = uniqueKeys && keys.every(key => names.has(key)) ? keys.map(key => names.get(key)!) : undefined;
  return { table: catalogue.table, columns, ...(primaryKey?.length ? { primaryKey } : {}) };
}

/** 独立连接必须仍在原服务器和库，来源目录使用服务器报告的关系 OID。 */
export async function resolvePostgresQueryRecord(connection: PostgresConnection, source: PostgresQueryRecordSource) {
  if (connection.serverIdentity !== source.server) throw blocked();
  const origins = await readPostgresResultOrigins(connection, source.origins);
  const first = origins.find(origin => origin !== null);
  if (!first?.canOpen || first.table !== source.table.name || source.table.schema && first.schema !== source.table.schema ||
      origins.some((origin, index) => source.origins[index] && (!origin || origin.schema !== first.schema || origin.table !== first.table)))
    throw blocked();
  return { table: postgresIdentifier(first.schema) + '.' + postgresIdentifier(first.table),
    columns: origins.map(origin => origin?.column ?? null) };
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

/** 只核对协议指向原表的投影值，不重新执行计算表达式。后续按整行版本定位。 */
export async function verifyPostgresQueryRecord(connection: PostgresConnection, source: PostgresQueryRecordSource,
  rowIndices: readonly number[], resolved: Awaited<ReturnType<typeof resolvePostgresQueryRecord>>,
  relation: { oid: string; sql: string; keys: string[] }) {
  const oid = String(source.relationOid);
  if (relation.oid !== oid || relation.sql !== resolved.table) throw blocked();
  const { server, identity } = source;
  const checkServer = async (current: PostgresConnection) => {
    if (current.serverIdentity !== server ||
        (await postgresQueryRecordIdentity(current, resolved.table, Number(oid)))?.identity !== identity) throw blocked();
  };
  await checkServer(connection);
  const locked = await resolvePostgresQueryRecord(connection, source);
  if (locked.table !== resolved.table || locked.columns.some((column, index) => column !== resolved.columns[index])) throw blocked();
  // 新增只核验原表及字段来源，不读取或锁定旧记录。
  if (!rowIndices.length) return { originals: [], checkServer };
  if (!relation.keys.length) throw blocked();
  const fields = locked.columns.flatMap((column, index) => column === null ? [] :
    [{ column: postgresIdentifier(column), key: source.result.columns[index].key }]);
  const keys = relation.keys.map(key => {
    const position = resolved.columns.indexOf(key);
    if (position < 0) throw Error('PostgreSQL 查询结果需要包含原表的完整主键');
    return source.result.columns[position].key;
  });
  const where = relation.keys.map((key, index) => postgresIdentifier(key) + ' = $' + (index + 1)).join(' AND ');
  const sql = 'SELECT tableoid::text, ctid::text, xmin::text, ' + fields.map(field => field.column).join(', ') +
    ' FROM ONLY ' + relation.sql + ' WHERE ' + where + ' LIMIT 2';
  const originals: PostgresReferenceRowVersion[] = [];
  for (const index of rowIndices) {
    const row = source.result.rows[index];
    if (!row) throw blocked();
    const found = await connection.query(sql, keys.map(key => parameter(row[key])), budget(), undefined, 'extended');
    const original = found.rows[0];
    if (found.truncated || found.rows.length !== 1 || original.c0 !== oid || typeof original.c1 !== 'string' || typeof original.c2 !== 'string' ||
        fields.some((field, i) => !sameCell(row[field.key], original['c' + (i + 3)]))) throw blocked();
    originals.push({ tableOid: oid, tid: original.c1, version: original.c2 });
  }
  return { originals, checkServer };
}
