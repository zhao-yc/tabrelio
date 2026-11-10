import type { CellValue, ColumnInfo, DataRow, TablePage } from '../shared/contracts';
import { assertCopyInsertSqlInput, copyInsertColumnKind, copyInsertNumericLiteral, copyInsertSqlLimits as limits, type CopyInsertSqlInput } from '../shared/copyInsertSql';
import { copyInsertSqlZh as text } from '../shared/copyInsertSql.zh-CN';
import { tableReadIdentifier, tableReadTextLiteral } from '../shared/tableReadSql';
import { decodeBinaryCell } from './binaryCell';
import { primaryKeyCopyZh as keyText } from './locales/primaryKeyCopy.zh-CN';
import { updateSqlCopyZh as updateText } from './locales/updateSqlCopy.zh-CN';
import { ownCell } from './lib';
import type { DraftRow } from './dataChanges';
import { recordCopyMetadataReason, type RecordCopyPage } from './recordCopySource';
import type { RecordContext } from './recordViews';

/** 精确比较已加载快照，不能用 JSON 把 -0、缺失字段与 NULL 折叠成同一值。 */
function sameRow(left: DataRow | undefined, right: DataRow): boolean {
  return !!left && Object.keys(left).length === Object.keys(right).length && Object.keys(right).every(key => {
    if (!Object.hasOwn(left, key)) return false;
    const a = left[key], b = right[key];
    return a && b && typeof a === 'object' && typeof b === 'object' ? a.type === b.type && a.base64 === b.base64 : Object.is(a, b);
  });
}
/** 仅从当前表页选取原始行，不补取缺失值，不推断查询结果目标，也不包含任何行草稿。 */
export function prepareCopyInsertSql(context: RecordContext, binding: RecordCopyPage | null, page: TablePage | null, rows: DraftRow[], ids: ReadonlySet<string>): CopyInsertSqlInput {
  const selected = copyOriginalRows(context, binding, page, rows, ids);
  const info = context.info!;
  const input: CopyInsertSqlInput = {
    database: info.database, table: info.name,
    columns: info.columns.map(({ name, type, nullable, generated, extra }) => ({ name, type, nullable, generated, extra })),
    rows: selected
  };
  assertCopyInsertSqlInput(input);
  return structuredClone(input);
}

/** SQL 数据复制以当前无草稿的原行作值来源，缺列或归属变化时整组拒绝。 */
function copyOriginalRows(context: RecordContext, binding: RecordCopyPage | null, page: TablePage | null,
  rows: readonly DraftRow[], ids: ReadonlySet<string>): DataRow[] {
  const info = context.info;
  if (context.busy || context.stale || !context.loaded) throw new Error(text.busy);
  // 完整表页只有目录指纹，补取租约仅在缺列时存在。两者都必须通过目录和原值校验。
  if (!info || info.objectKind !== 'table' || info.database !== context.target.database || info.name !== context.target.table ||
      !page || binding?.page !== page || recordCopyMetadataReason(context, binding) || page.copySource?.missingColumns.length) throw new Error(text.target);
  if (!ids.size || rows.filter(row => ids.has(row.id)).length !== ids.size) throw new Error(text.selection);
  const originals = rows.filter(row => !row.inserted);
  if (originals.length !== page.rows.length || originals.some((row, index) => !sameRow(row.original, page.rows[index]))) throw new Error(text.target);
  const selected = rows.filter(row => ids.has(row.id));
  if (selected.some(row => row.inserted || row.deleted || !sameRow(row.original, row.data))) throw new Error(text.draft);
  return selected.map(row => row.original!);
}

const utf8 = new TextEncoder();

/** 生成可独立执行的精确条件。浮点型主键缺少可核对的原始位值，拒绝猜测相等。 */
function primaryKeyTerm(column: ColumnInfo, value: CellValue, epoch: string | undefined): string {
  const identifier = tableReadIdentifier(column.name);
  const metadata = { ...column, generated: false, extra: '' };
  let kind: ReturnType<typeof copyInsertColumnKind>;
  try { kind = copyInsertColumnKind(metadata); } catch { throw Error(keyText.type); }
  if (kind === 'float') throw Error(keyText.type);
  if (kind === 'binary') {
    return identifier + ' = ' + mysqlCopyBinaryLiteral(column.type, value);
  }
  if (kind === 'text') {
    if (typeof value !== 'string') throw Error(keyText.type);
    if (/^TIMESTAMP\b/i.test(column.type)) {
      if (epoch === undefined || !/^\d{1,12}(?:\.\d{1,6})?$/.test(epoch)) throw Error(keyText.incomplete);
      if (!/^0(?:\.0+)?$/.test(epoch)) return 'UNIX_TIMESTAMP(' + identifier + ') = CAST(' + epoch + ' AS DECIMAL(20,6))';
    }
    // 转为原显示文本后比较可覆盖旧数据中的零日期，避免不同 SQL mode 将其隐式解释为非法值。
    const left = /^(?:DATE|DATETIME|TIMESTAMP|TIME)\b/i.test(column.type) ? 'CAST(' + identifier + ' AS CHAR CHARACTER SET utf8mb4)' : identifier;
    return left + ' = ' + tableReadTextLiteral(value);
  }
  let numeric: string | undefined;
  try { numeric = copyInsertNumericLiteral(metadata, value); } catch { throw Error(keyText.type); }
  if (!numeric) throw Error(keyText.type);
  if (kind === 'integer' && /\bunsigned\b/i.test(column.type)) {
    if (BigInt(numeric) > 18446744073709551615n) throw Error(keyText.type);
    return identifier + ' = CAST(CAST(' + numeric + ' AS DECIMAL(20,0)) AS UNSIGNED)';
  }
  return identifier + ' = ' + numeric;
}

/** BIT 需要定型到无符号整数，避免高位比较和赋值落入浮点转换。 */
function mysqlCopyBinaryLiteral(type: string, value: CellValue): string {
  if (!value || typeof value !== 'object') throw Error(keyText.type);
  const bytes = decodeBinaryCell(value)!;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  const bit = /^BIT(?:\((\d+)\))?$/i.exec(type);
  if (!bit) return "X'" + hex + "'";
  const width = Number(bit[1] ?? 1), numeric = hex ? BigInt('0x' + hex) : -1n;
  if (width < 1 || width > 64 || bytes.length > Math.ceil(width / 8) || numeric < 0n || numeric >= (1n << BigInt(width)))
    throw Error(keyText.type);
  return 'CAST(CAST(' + numeric + ' AS DECIMAL(20,0)) AS UNSIGNED)';
}

/** 仅从已核验目录的原页按勾选顺序范围复制，不将本地修改或临时新增作为数据库主键。 */
export function prepareCopyPrimaryKeyQuery(context: RecordContext, binding: RecordCopyPage | null, page: TablePage | null,
  rows: readonly DraftRow[], ids: ReadonlySet<string>): string {
  const info = context.info;
  if (!info) throw Error(keyText.target);
  const prefix = 'SELECT * FROM ' + tableReadIdentifier(info.database) + '.' + tableReadIdentifier(info.name) + '\nWHERE ';
  const separator = '\n   OR ';
  return prefix + copyPrimaryKeyRows(context, binding, page, rows, ids, condition => condition,
    separator, utf8.encode(prefix).length + 1) + ';';
}

/** SET 仅取原页普通字段；WHERE 与原主键查询共用同一精度和时区证明。 */
export function prepareCopyUpdateSql(context: RecordContext, binding: RecordCopyPage | null, page: TablePage | null,
  rows: readonly DraftRow[], ids: ReadonlySet<string>): string {
  const originals = copyOriginalRows(context, binding, page, rows, ids);
  const info = context.info!;
  const keys = new Set(info.primaryKey);
  const columns = info.columns.filter(column => !keys.has(column.name) && !column.generated && !/\b(?:auto_increment|invisible)\b/i.test(column.extra))
    .map(({ name, type, nullable, generated, extra }) => ({ name, type, nullable, generated, extra }));
  if (!keys.size || !columns.length || ids.size * (columns.length + keys.size) > limits.cells) throw Error(updateText.target);
  const input = { database: info.database, table: info.name, columns,
    rows: originals.map(row => Object.fromEntries(columns.map(column => [column.name, ownCell(row, column.name)]))) };
  assertCopyInsertSqlInput(input);
  const table = tableReadIdentifier(info.database) + '.' + tableReadIdentifier(info.name);
  return copyPrimaryKeyRows(context, binding, page, rows, ids, (condition, index) => {
    const row = input.rows[index];
    const assignments = columns.map(column => {
      const value = row[column.name];
      const literal = value === null ? 'NULL' : typeof value === 'object' ? mysqlCopyBinaryLiteral(column.type, value)
        : copyInsertNumericLiteral(column, value) ?? tableReadTextLiteral(String(value));
      return tableReadIdentifier(column.name) + ' = ' + literal;
    });
    return 'UPDATE ' + table + '\nSET ' + assignments.join(', ') + '\nWHERE ' + condition + ';';
  }, '\n');
}

/** 先按原页拒绝任一选中草稿，再沿现有主键精度规则逐行生成文本。 */
export function prepareCopyDeleteSql(context: RecordContext, binding: RecordCopyPage | null, page: TablePage | null,
  rows: readonly DraftRow[], ids: ReadonlySet<string>): string {
  copyOriginalRows(context, binding, page, rows, ids);
  const { database, name } = context.info!;
  const prefix = 'DELETE FROM ' + tableReadIdentifier(database) + '.' + tableReadIdentifier(name) + '\nWHERE ';
  return copyPrimaryKeyRows(context, binding, page, rows, ids, condition => prefix + condition + ';', '\n');
}

/** 所有去向共用完整主键、逐行原始身份和最终字节预算。 */
function copyPrimaryKeyRows(context: RecordContext, binding: RecordCopyPage | null, page: TablePage | null,
  rows: readonly DraftRow[], ids: ReadonlySet<string>, render: (condition: string, index: number) => string,
  separator: string, sqlBytes = 0): string {
  const info = context.info;
  if (context.busy || context.stale || !context.loaded || !info || info.objectKind !== 'table' ||
      info.database !== context.target.database || info.name !== context.target.table || !page || binding?.page !== page ||
      recordCopyMetadataReason(context, binding) || !info.primaryKey.length ||
      new Set(info.primaryKey).size !== info.primaryKey.length) throw Error(keyText.target);
  if (!ids.size) throw Error(keyText.selection);
  if (ids.size > limits.rows || ids.size * info.primaryKey.length > limits.cells) throw Error(keyText.limit);
  const columns = info.primaryKey.map(name => {
    const column = info.columns.find(item => item.name === name);
    if (!column) throw Error(keyText.target);
    return column;
  });
  const originals = rows.filter(row => !row.inserted);
  if (originals.length !== page.rows.length) throw Error(keyText.target);
  const separatorBytes = utf8.encode(separator).length;
  let inputBytes = 0;
  const conditions: string[] = [];
  for (const [index, row] of originals.entries()) {
    if (!ids.has(row.id)) continue;
    const original = page.rows[index];
    if (!sameRow(row.original, original)) throw Error(keyText.target);
    const terms = columns.map(column => {
      const value = ownCell(original, column.name);
      if (value === undefined || value === null) throw Error(keyText.incomplete);
      const payload = typeof value === 'string' ? value : typeof value === 'object' ? value.base64 : String(value);
      if (payload.length > limits.cellBytes) throw Error(keyText.limit);
      const size = utf8.encode(payload).length;
      inputBytes += size;
      if (size > limits.cellBytes || inputBytes > limits.inputBytes) throw Error(keyText.limit);
      const epochs = page.primaryKeyEpochs?.[index];
      return primaryKeyTerm(column, value, epochs && Object.hasOwn(epochs, column.name) ? epochs[column.name] : undefined);
    });
    const condition = render('(' + terms.join(' AND ') + ')', conditions.length);
    sqlBytes += utf8.encode(condition).length + (conditions.length ? separatorBytes : 0);
    if (sqlBytes > limits.sqlBytes) throw Error(keyText.limit);
    conditions.push(condition);
  }
  if (conditions.length !== ids.size) throw Error(keyText.selection);
  return conditions.join(separator);
}
