import type { ColumnEnumeration } from '../../shared/contracts';
import type { PostgresConnection } from './connection';

const maxLabels = 4096;
const maxRows = 8192;

/** 按声明类型查找标量枚举，包括域的基础类型。任何不完整目录都回退到原文本输入。 */
export async function readPostgresTableEnumerations(connection: Pick<PostgresConnection, 'query'>,
  declared: readonly string[]): Promise<ReadonlyMap<string, ColumnEnumeration>> {
  if (!declared.length) return new Map();
  const result = await connection.query(`
    WITH RECURSIVE type_chain(declared, actual, depth) AS (
      SELECT t.oid, t.oid, 0 FROM pg_catalog.pg_type t WHERE t.oid = ANY($1::oid[])
      UNION ALL
      SELECT chain.declared, t.typbasetype, chain.depth + 1
      FROM type_chain chain JOIN pg_catalog.pg_type t ON t.oid = chain.actual
      WHERE t.typtype = 'd' AND t.typbasetype <> 0 AND chain.depth < 32
    )
    SELECT chain.declared::text, item.enumlabel::text
    FROM type_chain chain JOIN pg_catalog.pg_type t ON t.oid = chain.actual AND t.typtype = 'e'
    CROSS JOIN LATERAL (
      SELECT e.enumlabel, e.enumsortorder FROM pg_catalog.pg_enum e WHERE e.enumtypid = t.oid
      ORDER BY e.enumsortorder LIMIT $2
    ) item
    ORDER BY chain.declared, item.enumsortorder LIMIT $3
  `, [declared, maxLabels + 1, maxRows + 1], { rows: maxRows + 1, bytes: 2 * 1024 * 1024 });
  const choices = new Map<string, ColumnEnumeration>();
  if (result.truncated || result.rows.length > maxRows) return choices;
  const requested = new Set(declared), labels = new Map<string, Set<string>>();
  for (const row of result.rows) {
    if (typeof row.c0 !== 'string' || !requested.has(row.c0) || typeof row.c1 !== 'string') return new Map();
    let members = labels.get(row.c0);
    if (!members) { members = new Set(); labels.set(row.c0, members); }
    if (members.has(row.c1)) return new Map();
    members.add(row.c1);
  }
  for (const [type, members] of labels) {
    if (members.size <= maxLabels) choices.set(type, { kind: 'ENUM', values: [...members] });
  }
  return choices;
}
