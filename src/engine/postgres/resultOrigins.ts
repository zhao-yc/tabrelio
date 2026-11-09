import type { FieldDef } from 'pg';
import type { PostgresColumnReference, PostgresResultOrigin } from '../../shared/postgresResultOrigins';
import type { PostgresConnection } from './connection';

/** RowDescription 的关系 OID 可能以驱动的有符号 Int32 形式到达。零表示服务器未提供来源。 */
export function postgresColumnReferences(fields: readonly FieldDef[]): PostgresColumnReference[] {
  if (fields.length > 1024) return [];
  return fields.map(({ tableID, columnID }) => Number.isInteger(tableID) && tableID >= -0x80000000 &&
    tableID <= 0xffffffff && tableID !== 0 && Number.isInteger(columnID) && columnID >= -32768 && columnID <= 32767 && columnID !== 0
    ? { relation: tableID >>> 0, attribute: columnID } : null);
}

/** 按协议行位置解析当前目录；表达式或已删除的对象保留空位，临时对象不能跨连接打开。 */
export async function readPostgresResultOrigins(connection: Pick<PostgresConnection, 'query'>,
  columns: readonly PostgresColumnReference[]): Promise<PostgresResultOrigin[]> {
  const origins: PostgresResultOrigin[] = columns.map(() => null);
  const references = columns.flatMap((column, index) => column ? [{ position: index, ...column }] : []);
  if (!references.length) return origins;
  const result = await connection.query(
    `SELECT x.position::text, n.nspname::text, c.relname::text, a.attname::text,
            (c.relpersistence <> 't' AND c.relkind IN ('r','p','v','m','f')
              AND pg_catalog.has_schema_privilege(n.oid, 'USAGE'))::text
     FROM pg_catalog.jsonb_to_recordset($1::pg_catalog.jsonb) AS x(position integer, relation oid, attribute smallint)
     JOIN pg_catalog.pg_class c ON c.oid = x.relation
     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum = x.attribute AND NOT a.attisdropped`,
    [JSON.stringify(references)], { rows: references.length, bytes: 1024 * 1024 }, undefined, 'extended');
  if (result.truncated) throw Error('PostgreSQL 来源目录结果超过预算');
  for (const row of result.rows) {
    const { c0, c1, c2, c3, c4 } = row, position = Number(c0);
    if (!Number.isSafeInteger(position) || typeof c0 !== 'string' || String(position) !== c0 || !columns[position] || origins[position] ||
        ![c1, c2, c3].every(value => typeof value === 'string' && value.length > 0 && value.length <= 512) ||
        (c4 !== 'true' && c4 !== 'false')) throw Error('PostgreSQL 来源目录返回了非预期字段');
    origins[position] = { schema: c1 as string, table: c2 as string, column: c3 as string, canOpen: c4 === 'true' };
  }
  return origins;
}
