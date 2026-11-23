import type { SqliteSchemaObjectKind } from '../shared/sqliteCompletion';

/** 补全与完整定义共用 SQLite 的实际 DROP 查找规则。库、类型和查询模板都只来自固定取值。 */
export function sqliteDropObjectQuery(
  object: SqliteSchemaObjectKind, schema: 'main' | 'temp' | undefined, match: { prefix: string } | { exact: string },
): { sql: string; parameters: string[] } {
  const relation = object === 'table' || object === 'view';
  const sources = relation ?
    "SELECT name,schema,type,NULL AS owner,1 AS removable FROM pragma_table_list() WHERE schema IN ('main','temp')" :
    "SELECT name,'main' AS schema,type,tbl_name AS owner,sql IS NOT NULL AS removable FROM main.sqlite_schema WHERE type = ? " +
    "UNION ALL SELECT name,'temp',type,tbl_name,sql IS NOT NULL FROM temp.sqlite_schema WHERE type = ?";
  // TABLE 与 VIEW 共用关系命名空间。INDEX、TRIGGER 的同名遮蔽各自独立于其它对象类型。
  const scope = schema ? 'p.schema = ?' :
    "(p.schema = 'temp' OR NOT EXISTS (SELECT 1 FROM objects t WHERE t.schema = 'temp' AND t.name = p.name COLLATE NOCASE))";
  const type = object === 'table' ? "p.type IN ('table','virtual')" : 'p.type = ?';
  const exact = 'exact' in match;
  const matches = exact ? 'p.name = ? COLLATE NOCASE' : 'substr(p.name,1,length(?)) = ? COLLATE NOCASE';
  return {
    sql: 'WITH objects AS (' + sources + ') SELECT p.name,p.schema,p.owner FROM objects p WHERE ' + scope + ' AND ' + type +
      " AND p.removable = 1 AND substr(p.name,1,7) COLLATE NOCASE <> 'sqlite_' AND " + matches +
      ' ORDER BY p.schema DESC,p.name COLLATE NOCASE,p.name LIMIT ' + (exact ? '1' : '257'),
    parameters: [...(relation ? [] : [object, object]), ...(schema ? [schema] : []), ...(object === 'table' ? [] : [object]),
      ...(exact ? [match.exact] : [match.prefix, match.prefix])],
  };
}
