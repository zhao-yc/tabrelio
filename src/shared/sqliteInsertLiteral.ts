import { quoteSqliteIdentifier } from './sqliteReadSql';

/** INTEGER 保留精确原文，REAL 保留负零和无穷，TEXT 不按声明亲和性转换。 */
export type SqliteValue = null | string | { type: 'integer'; value: string } | { type: 'real'; value: string } | { type: 'binary'; base64: string };
const byteHex = Array.from({ length: 256 }, (_, byte) => byte.toString(16).padStart(2, '0'));

/** NUL不能通过依赖目标数据库编码的BLOB转TEXT；平衡连接树保留Unicode且不随NUL数线性增加表达式深度。 */
function sqliteTextLiteral(value: string): string {
  const quote = (text: string) => "'" + text.replaceAll("'", "''") + "'";
  if (!value.includes('\0')) return quote(value);
  const fragments = value.split('\0'), leaves: string[] = [];
  for (let index = 0; index < fragments.length; index++) { if (fragments[index]) leaves.push(quote(fragments[index])); if (index < fragments.length - 1) leaves.push('char(0)'); }
  const balanced = (start: number, end: number): string => { if (end - start === 1) return leaves[start]; const middle = start + Math.floor((end - start) / 2); return '(' + balanced(start, middle) + '||' + balanced(middle, end) + ')'; };
  return balanced(0, leaves.length);
}

/** SQLite字面量不沿用MySQL转义；REAL保持存储类别，文本始终保持跨目标编码的Unicode语义。 */
export function sqliteInsertLiteral(value: SqliteValue): string {
  if (value === null) return 'NULL';
  if (typeof value === 'string') return sqliteTextLiteral(value);
  if (value.type === 'binary') {
    const bytes = atob(value.base64);
    let hex = '';
    for (let index = 0; index < bytes.length; index++) hex += byteHex[bytes.charCodeAt(index)];
    return "X'" + hex + "'";
  }
  if (value.type === 'integer') return value.value;
  if (value.value === 'Infinity') return '9e999';
  if (value.value === '-Infinity') return '-9e999';
  return /[.eE]/.test(value.value) ? value.value : value.value + '.0';
}

/** 每批复用预编译的安全标识符前缀，按原列序写出 SQLite 原生值。 */
export function sqliteInsertRowWriter(database: string, table: string, columns: readonly string[]): (row: readonly SqliteValue[]) => string {
  const prefix = 'INSERT INTO ' + quoteSqliteIdentifier(database) + '.' + quoteSqliteIdentifier(table) +
    ' (' + columns.map(quoteSqliteIdentifier).join(', ') + ') VALUES (';
  return row => prefix + row.map(sqliteInsertLiteral).join(', ') + ');\n';
}
