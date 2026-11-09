import { copyInsertSqlLimits as limits } from '../shared/copyInsertSql';
import { copyInsertSqlZh as text } from '../shared/copyInsertSql.zh-CN';
import { postgresDdlLiteral, postgresNewIdentifier } from '../shared/postgresCreateTable';
import { postgresIdentifier, postgresRelationName } from '../shared/postgresSql';
import type { QueryResult } from '../shared/contracts';
import type { PostgresQueryRowSql } from '../shared/postgresQueryRecord';
import { isPostgresSqlExportColumn, isPostgresSqlExportRelation, type PostgresTableColumn, type PostgresTablePage } from '../shared/postgresTable';
import type { PostgresDraftEntry } from '../shared/postgresTableDraft';
import { primaryKeyCopyZh as keyText } from './locales/primaryKeyCopy.zh-CN';
import { updateSqlCopyZh as updateText } from './locales/updateSqlCopy.zh-CN';
import { cellText, ownCell } from './lib';

const utf8 = new TextEncoder();
type SqlColumn = Pick<PostgresTableColumn, 'key' | 'name' | 'primary' | 'generated' | 'identityAlways'> & { sequenceDefault?: boolean };
type SqlRows = Pick<PostgresTablePage, 'rows' | 'rowKeys' | 'relationKind' | 'primaryKey'> & { columns: SqlColumn[] };
const updateColumn = (column: SqlColumn) => !column.primary && !column.generated && !column.identityAlways && !column.sequenceDefault;
const pageAvailable = (page: PostgresTablePage) => !!page.exportToken && !page.truncated && isPostgresSqlExportRelation(page.relationKind);

/** 仅从已加载原页生成可审阅 SQL。隐藏列仍按目录读取，计算生成列交由目标表重算。 */
export function postgresCopyInsertSql(table: string, page: PostgresTablePage, indices: ReadonlySet<number>,
  draft: readonly PostgresDraftEntry[]): string {
  if (!pageAvailable(page)) throw Error(text.target);
  return insertSql(table, page, indices, draft);
}

function insertSql(table: string, page: SqlRows, indices: ReadonlySet<number>, draft: readonly PostgresDraftEntry[]): string {
  const { schema, name } = postgresRelationName(table);
  const columns = page.columns.filter(isPostgresSqlExportColumn);
  if (!columns.length || ![schema, name, ...columns.map(column => column.name)].every(value => postgresNewIdentifier.safeParse(value).success) ||
      new Set(columns.map(column => column.name)).size !== columns.length) throw Error(text.target);
  const changed = new Set(draft.map(entry => entry.rowKey));
  const prefix = 'INSERT INTO ' + postgresIdentifier(schema) + '.' + postgresIdentifier(name) +
    ' (' + columns.map(column => postgresIdentifier(column.name)).join(', ') + ')' +
    (columns.some(column => column.identityAlways) ? ' OVERRIDING SYSTEM VALUE' : '') + ' VALUES (';
  return copyRows(page, indices, columns, text, (values, index) => {
    const key = page.rowKeys?.[index];
    if (key !== undefined && changed.has(key)) throw Error(text.draft);
    return prefix + values.join(', ') + ');';
  }, '\n');
}

/** 沿实际主键顺序构造每行条件，普通表保留 ONLY，分区表读取全部分区。 */
export function postgresCopyPrimaryKeyQuery(table: string, page: PostgresTablePage, indices: ReadonlySet<number>): string {
  if (!pageAvailable(page)) throw Error(keyText.target);
  return primaryKeyQuery(table, page, indices);
}

function primaryKeyQuery(table: string, page: SqlRows, indices: ReadonlySet<number>): string {
  const { target, columns } = primaryKeyTarget(table, page);
  const prefix = 'SELECT * FROM ' + target + '\nWHERE ';
  const predicates = copyRows(page, indices, columns, keyText, values => primaryKeyCondition(columns, values),
    '\n   OR ', utf8.encode(prefix).length + 1);
  return prefix + predicates + ';';
}

/** 普通表使用 ONLY 避免同主键继承子表被更新，分区表仍由服务器路由。 */
function primaryKeyTarget(table: string, page: SqlRows) {
  const keys = page.primaryKey;
  if (!keys?.length) throw Error(keyText.target);
  const { schema, name } = postgresRelationName(table);
  const primary = page.columns.filter(column => column.primary);
  const byName = new Map(primary.map(column => [column.name, column]));
  if (primary.length !== keys.length || new Set(keys).size !== keys.length ||
      ![schema, name, ...keys].every(value => postgresNewIdentifier.safeParse(value).success) ||
      keys.some(key => !byName.has(key))) throw Error(keyText.target);
  const columns = keys.map(key => byName.get(key)!);
  const target = (page.relationKind === 'r' ? 'ONLY ' : '') + postgresIdentifier(schema) + '.' + postgresIdentifier(name);
  return { target, columns };
}

function primaryKeyCondition(columns: readonly { name: string }[], values: readonly string[]): string {
  if (values.includes('NULL')) throw Error(keyText.incomplete);
  return '(' + columns.map(({ name }, index) => postgresIdentifier(name) + ' = ' + values[index]).join(' AND ') + ')';
}

/** 使用完整原主键，省略主键、生成字段和标识字段；任何选中草稿使整批复制失败。 */
export function postgresCopyUpdateSql(table: string, page: PostgresTablePage, indices: ReadonlySet<number>,
  draft: readonly PostgresDraftEntry[]): string {
  if (!pageAvailable(page)) throw Error(keyText.target);
  return updateSql(table, page, indices, draft);
}

function updateSql(table: string, page: SqlRows, indices: ReadonlySet<number>, draft: readonly PostgresDraftEntry[]): string {
  const { target, columns: keys } = primaryKeyTarget(table, page);
  const columns = page.columns.filter(updateColumn);
  if (!columns.length || columns.some(column => !postgresNewIdentifier.safeParse(column.name).success) ||
      new Set(page.columns.map(column => column.name)).size !== page.columns.length ||
      new Set(page.columns.map(column => column.key)).size !== page.columns.length) throw Error(updateText.target);
  const changed = new Set(draft.map(entry => entry.rowKey));
  return copyRows(page, indices, [...keys, ...columns], text, (values, index) => {
    const key = page.rowKeys?.[index];
    if (key !== undefined && changed.has(key)) throw Error(text.draft);
    const set = columns.map(({ name }, index) => postgresIdentifier(name) + ' = ' + values[keys.length + index]);
    return 'UPDATE ' + target + '\nSET ' + set.join(', ') + '\nWHERE ' + primaryKeyCondition(keys, values.slice(0, keys.length)) + ';';
  }, '\n');
}

/** 普通表仅删除该关系中的原主键行；分区表交由 PostgreSQL 路由。 */
export function postgresCopyDeleteSql(table: string, page: PostgresTablePage, indices: ReadonlySet<number>,
  draft: readonly PostgresDraftEntry[]): string {
  if (!pageAvailable(page)) throw Error(keyText.target);
  return deleteSql(table, page, indices, draft);
}

function deleteSql(table: string, page: SqlRows, indices: ReadonlySet<number>, draft: readonly PostgresDraftEntry[]): string {
  const { target, columns } = primaryKeyTarget(table, page);
  const changed = new Set(draft.map(entry => entry.rowKey));
  return copyRows(page, indices, columns, keyText, (values, index) => {
    const key = page.rowKeys?.[index];
    if (changed.size && (key === undefined || changed.has(key))) throw Error(text.draft);
    return 'DELETE FROM ' + target + '\nWHERE ' + primaryKeyCondition(columns, values) + ';';
  }, '\n');
}

/** 查询只使用服务器核验的原列映射与当前显示行。复制不会借用表页写入能力。 */
export function postgresQueryRowSqlBuilders(source: PostgresQueryRowSql, result: QueryResult, rows: QueryResult['rows']) {
  const columns = source.columns.map(({ position, ...column }) => ({ ...column, key: result.columns[position]?.key }));
  if (!columns.length || columns.some(column => !column.key)) return;
  const page: SqlRows = { columns, rows, relationKind: 'r', primaryKey: source.primaryKey };
  const table = source.table;
  return {
    table,
    insert: columns.some(isPostgresSqlExportColumn) ? (indices: ReadonlySet<number>) => insertSql(table, page, indices, []) : undefined,
    update: !!source.primaryKey?.length && columns.some(updateColumn)
      ? (indices: ReadonlySet<number>) => updateSql(table, page, indices, []) : undefined,
    delete: source.primaryKey?.length ? (indices: ReadonlySet<number>) => deleteSql(table, page, indices, []) : undefined,
    select: source.primaryKey?.length ? (indices: ReadonlySet<number>) => primaryKeyQuery(table, page, indices) : undefined,
  };
}

/** 两个复制入口沿相同的值校验与字节预算，整组生成后才交给剪贴板。 */
function copyRows(page: SqlRows, indices: ReadonlySet<number>, columns: readonly { key: string }[],
  errors: { selection: string; incomplete: string; type: string; limit: string },
  render: (values: readonly string[], index: number) => string, separator: string, sqlBytes = 0): string {
  if (!indices.size) throw Error(errors.selection);
  if (indices.size > limits.rows || columns.length > limits.columns || indices.size * columns.length > limits.cells) throw Error(errors.limit);
  const separatorBytes = utf8.encode(separator).length;
  let inputBytes = 0;
  const statements: string[] = [];
  for (const index of [...indices].sort((left, right) => left - right)) {
    const row = page.rows[index];
    if (!Number.isSafeInteger(index) || index < 0 || !row) throw Error(errors.selection);
    const values = columns.map(column => {
      const value = ownCell(row, column.key);
      if (value === undefined) throw Error(errors.incomplete);
      if (value === null) return 'NULL';
      const source = typeof value === 'string' ? value : typeof value === 'object' && value.type === 'binary' ? value.base64 : undefined;
      if (typeof source !== 'string') throw Error(errors.type);
      if (source.length > limits.cellBytes) throw Error(errors.limit);
      const size = utf8.encode(source).length;
      inputBytes += size;
      if (size > limits.cellBytes || inputBytes > limits.inputBytes) throw Error(errors.limit);
      if (typeof value === 'string') {
        if (/[\u0000\uD800-\uDFFF]/u.test(value)) throw Error(errors.type);
        return postgresDdlLiteral(value);
      }
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/][AQgw]==|[A-Za-z0-9+/]{2}[AEIMQUYcgkosw048]=)?$/.test(source))
        throw Error(errors.type);
      return postgresDdlLiteral('\\x' + cellText(value).slice(2));
    });
    const statement = render(values, index);
    sqlBytes += utf8.encode(statement).length + (statements.length ? separatorBytes : 0);
    if (sqlBytes > limits.sqlBytes) throw Error(errors.limit);
    statements.push(statement);
  }
  return statements.join(separator);
}
