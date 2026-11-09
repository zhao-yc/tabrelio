import { assertCopyInsertSqlInput, copyInsertNumericLiteral, copyInsertSqlLimits } from '../shared/copyInsertSql';
import { copyInsertSqlZh } from '../shared/copyInsertSql.zh-CN';
import type { TableInfo } from '../shared/contracts';
import { mysqlQueryRowSqlMessages as text, type MysqlQueryRowSqlInput } from '../shared/mysqlQueryRowSql';
import { mysqlQueryKeysUnique, mysqlQueryRelationSelect, type MysqlQueryRelationSource } from './mysqlQueryRelation';
import { identifier, inlineParameters, qualified, typedCellPlaceholder } from './sql';

/** 只用原执行保存的行与可信列序号。SQL 草稿从不隐式重跑原查询或执行写入。 */
export function buildMysqlQueryRowSql(source: MysqlQueryRelationSource, info: TableInfo, { kind, rowIndices }: Pick<MysqlQueryRowSqlInput, 'kind' | 'rowIndices'>): string {
  if (source.result.truncated || info.objectKind !== 'table' || info.engine.toUpperCase() !== 'INNODB' ||
      info.database !== source.database || info.name !== source.table) throw Error(text.source);
  const target = qualified(info.database, info.name), keyed = kind !== 'insert', assigns = kind === 'insert' || kind === 'update';
  const keyPositions = info.primaryKey.map(name => source.columns.indexOf(name));
  if (keyed && !mysqlQueryKeysUnique(source.result, keyPositions)) throw Error(text.key);
  const projected = new Map<string, number>();
  for (const [index, name] of source.columns.entries()) if (name !== null && !projected.has(name)) projected.set(name, index);
  const known = new Set(info.columns.map(column => column.name));
  if ([...projected.keys()].some(name => !known.has(name))) throw Error(text.stale);
  const columns = assigns ? info.columns.filter(column => projected.has(column.name) && !column.generated &&
    !/\binvisible\b/i.test(column.extra) && (kind === 'insert' || !info.primaryKey.includes(column.name) && !/\bauto_increment\b/i.test(column.extra))) : [];
  if (assigns && !columns.length) throw Error(text.fields);
  if (rowIndices.length * (columns.length + (keyed ? keyPositions.length : 0)) > copyInsertSqlLimits.cells)
    throw Error(copyInsertSqlZh.limit);
  const selected = rowIndices.map(index => {
    const row = source.result.rows[index];
    if (!row) throw Error(text.stale);
    for (const [position, field] of source.columns.entries()) {
      if (field === null) continue;
      const key = source.result.columns[position]?.key, first = source.result.columns[projected.get(field)!]?.key;
      if (!key || !first || !Object.hasOwn(row, key) || JSON.stringify(row[key]) !== JSON.stringify(row[first])) throw Error(text.stale);
    }
    return row;
  });
  const rows = assigns ? selected.map(row => Object.fromEntries(columns.map(column =>
    [column.name, row[source.result.columns[projected.get(column.name)!].key]]))) : [];
  if (assigns) assertCopyInsertSqlInput({ database: info.database, table: info.name,
    columns: columns.map(({ name, type, nullable, generated, extra }) => ({ name, type, nullable, generated, extra })), rows });
  let bytes = 0;
  const statements = rowIndices.map((index, position) => {
    const values = columns.map(column => {
      const value = rows[position][column.name];
      return copyInsertNumericLiteral(column, value) ?? inlineParameters(typedCellPlaceholder(column, value), [value]);
    });
    const key = keyed ? mysqlQueryRelationSelect(source, info, index).searchKey : undefined;
    const where = key ? inlineParameters(key.sql, key.params) : '';
    let sql: string;
    if (kind === 'select') sql = `SELECT * FROM ${target} WHERE ${where};`;
    else if (kind === 'delete') sql = `DELETE FROM ${target} WHERE ${where};`;
    else if (kind === 'insert') sql = `INSERT INTO ${target} (${columns.map(column => identifier(column.name)).join(', ')}) VALUES (${values.join(', ')});`;
    else sql = `UPDATE ${target} SET ${columns.map((column, i) => identifier(column.name) + ' = ' + values[i]).join(', ')} WHERE ${where};`;
    bytes += Buffer.byteLength(sql) + (position ? 1 : 0);
    if (bytes > copyInsertSqlLimits.sqlBytes) throw Error(copyInsertSqlZh.limit);
    return sql;
  });
  return statements.join('\n');
}
