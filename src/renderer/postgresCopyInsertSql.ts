import { copyInsertSqlLimits as limits } from '../shared/copyInsertSql';
import { copyInsertSqlZh as text } from '../shared/copyInsertSql.zh-CN';
import { postgresDdlLiteral, postgresNewIdentifier } from '../shared/postgresCreateTable';
import { postgresIdentifier, postgresRelationName } from '../shared/postgresSql';
import { isPostgresSqlExportColumn, isPostgresSqlExportRelation, type PostgresTablePage } from '../shared/postgresTable';
import type { PostgresDraftEntry } from '../shared/postgresTableDraft';
import { cellText, ownCell } from './lib';

const utf8 = new TextEncoder();

/** 仅从已加载原页生成可审阅 SQL。隐藏列仍按目录读取，计算生成列交由目标表重算。 */
export function postgresCopyInsertSql(table: string, page: PostgresTablePage, indices: ReadonlySet<number>,
  draft: readonly PostgresDraftEntry[]): string {
  if (!page.exportToken || page.truncated || !isPostgresSqlExportRelation(page.relationKind)) throw Error(text.target);
  if (!indices.size) throw Error(text.selection);
  const { schema, name } = postgresRelationName(table);
  const columns = page.columns.filter(isPostgresSqlExportColumn);
  if (!columns.length || ![schema, name, ...columns.map(column => column.name)].every(value => postgresNewIdentifier.safeParse(value).success) ||
      new Set(columns.map(column => column.name)).size !== columns.length) throw Error(text.target);
  if (indices.size > limits.rows || columns.length > limits.columns || indices.size * columns.length > limits.cells) throw Error(text.limit);

  const changed = new Set(draft.map(entry => entry.rowKey));
  const prefix = 'INSERT INTO ' + postgresIdentifier(schema) + '.' + postgresIdentifier(name) +
    ' (' + columns.map(column => postgresIdentifier(column.name)).join(', ') + ')' +
    (columns.some(column => column.identityAlways) ? ' OVERRIDING SYSTEM VALUE' : '') + ' VALUES (';
  let inputBytes = 0, sqlBytes = 0;
  const statements: string[] = [];
  for (const index of [...indices].sort((left, right) => left - right)) {
    const row = page.rows[index], key = page.rowKeys?.[index];
    if (!Number.isSafeInteger(index) || index < 0 || !row) throw Error(text.selection);
    if (key !== undefined && changed.has(key)) throw Error(text.draft);
    const values = columns.map(column => {
      const value = ownCell(row, column.key);
      if (value === undefined) throw Error(text.incomplete);
      if (value === null) return 'NULL';
      const source = typeof value === 'string' ? value : typeof value === 'object' && value.type === 'binary' ? value.base64 : undefined;
      if (typeof source !== 'string') throw Error(text.type);
      if (source.length > limits.cellBytes) throw Error(text.limit);
      const size = utf8.encode(source).length;
      inputBytes += size;
      if (size > limits.cellBytes || inputBytes > limits.inputBytes) throw Error(text.limit);
      if (typeof value === 'string') {
        if (/[\u0000\uD800-\uDFFF]/u.test(value)) throw Error(text.type);
        return postgresDdlLiteral(value);
      }
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/][AQgw]==|[A-Za-z0-9+/]{2}[AEIMQUYcgkosw048]=)?$/.test(source))
        throw Error(text.type);
      return postgresDdlLiteral('\\x' + cellText(value).slice(2));
    });
    const statement = prefix + values.join(', ') + ');';
    sqlBytes += utf8.encode(statement).length + (statements.length ? 1 : 0);
    if (sqlBytes > limits.sqlBytes) throw Error(text.limit);
    statements.push(statement);
  }
  return statements.join('\n');
}
