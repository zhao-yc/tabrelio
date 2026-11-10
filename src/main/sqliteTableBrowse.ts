import type { DataRow, QueryResult } from '../shared/contracts';
import { createHash } from 'node:crypto';
import { sqliteTableBrowseLimits as limits, sqliteLastPagePosition, sqliteQueryRecordIndices, sqliteRowCountSchema, sqliteTablePageSchema, type SqliteTableColumn, type SqliteTableFilter, type SqliteTablePage, type SqliteTablePageInput } from '../shared/sqliteTableBrowse';
import type { SqliteDriverSession } from '../engine/sqlite/session';
import { sqliteCopySourceSchema, sqliteExportTextFunction, type SqliteColumn, type SqliteValue } from '../engine/sqlite/protocol';
import { sqliteWorkspaceValue } from './sqliteQuerySession';
import type { SqliteQueryRecordPredicate } from './sqliteQueryRecord';
import type { SqliteTableEditPage } from '../shared/sqliteTableEdit';
import { buildSqliteReadPlan, buildSqliteRelationPredicate, quoteSqliteIdentifier } from '../shared/sqliteReadSql';
import { tableReadStatements } from '../shared/tableReadStatements';
export { quoteSqliteIdentifier } from '../shared/sqliteReadSql';

/** 仅供准确目录编译器生成的字段表达式使用；TEXT按源编码逐字节核对，其它存储类型原样返回。 */
export function sqliteExactTextProjection(column: string): string {
  return 'CASE WHEN typeof(' + column + ') = \'text\' THEN ' + sqliteExportTextFunction + '(' + column + ', CAST(' + column + ' AS BLOB)) ELSE ' + column + ' END';
}

export interface SqliteEditReadPlan {
  project?: (column: string) => string; extraColumn?: string; referenceColumns?: readonly number[];
  capture(rows: SqliteValue[][]): SqliteTableEditPage;
}

export interface SqliteTableBrowseControl {
  check(): void;
  beginCleanup(): void;
  cleanupFailed(reason: unknown): void;
  recordReadAttempt?(sql: string): void;
  queryRecord?(primaryKey: SqliteTablePage['primaryKey'], columns: SqliteTableColumn[]): Promise<SqliteQueryRecordPredicate[]>;
  searchRecord?(catalogue: SqliteTableCatalogue): Promise<{ where: string; parameters: SqliteValue[] }>;
  prepareEdit?(catalogue: SqliteTableCatalogue, driver: SqliteDriverSession): Promise<SqliteEditReadPlan>;
}

/** 本地边界取消只中止本次只读快照，不可冒充原生强退或退出确认。 */
export class SqliteTableBrowseCancelled extends Error {
  constructor() { super('SQLite表浏览已取消，未发布分页结果'); this.name = 'SqliteTableBrowseCancelled'; }
}

/** 类型参数先规范化成driver合同，整数不经Number，REAL负零不丢失。 */
function operand(value: NonNullable<SqliteTableFilter['value']>): SqliteValue {
  switch (value.kind) {
    case 'text': return value.value;
    case 'integer': return { type: 'integer', value: BigInt(value.value).toString() };
    case 'real': { const number = Number(value.value); return { type: 'real', value: Object.is(number, -0) ? '-0' : String(number) }; }
    case 'blob': return { type: 'binary', base64: Buffer.from(value.value, 'hex').toString('base64') };
  }
}

/** 每列都来自真实元数据白名单；运算符固定，所有筛选值及分页数字均使用typed绑定。 */
export function buildSqliteTableSelect(source: SqliteTablePageInput, columns: readonly SqliteTableColumn[], selected?: readonly string[], complete = false, project?: (qualifiedColumn: string) => string): { sql: string; parameters: SqliteValue[] } {
  const plan = buildSqliteReadPlan(source, columns, selected, complete, project);
  return { sql: plan.sql, parameters: plan.parameters.map(parameter => parameter.kind === 'storage-type' ? parameter.value : parameter.kind === 'count' ? { type: 'integer' as const, value: String(parameter.value) } : operand(parameter.value)) };
}

/** 编辑旧行校验复用同一固定谓词，不解析或截取已生成SQL。 */
export function buildSqliteTableRelationWhere(relation: import('../shared/sqliteTableBrowse').SqliteTableRelation): { sql: string; parameters: SqliteValue[] } {
  const parameters: SqliteValue[] = [], sql = buildSqliteRelationPredicate(relation, name => '"__dbark_source".' + quoteSqliteIdentifier(name), parameter => { if (parameter.kind !== 'operand') throw Error('SQLite关联参数类型无效'); parameters.push(operand(parameter.value)); return '?'; }); return { sql, parameters };
}

export interface SqliteTableCatalogue {
  kind: 'table' | 'view'; columns: SqliteTableColumn[]; schemaSql: string; schemaKey: string; xinfo: SqliteValue[][];
}
/** 精确SQL原文和按cid顺序的完整xinfo共同签名，包括隐藏/生成列及默认值，不能只比显示列名。 */
export function sqliteTableSchemaKey(schemaSql: string, xinfo: readonly (readonly SqliteValue[])[]): string {
  return createHash('sha256').update(JSON.stringify({ schemaSql, xinfo })).digest('hex');
}

/** 单条查询只收完整结果；截断不能伪造目录完整、页尾或没有下一页。 */
async function rows(driver: SqliteDriverSession, sql: string, parameters: SqliteValue[], maxRows: number, control: SqliteTableBrowseControl, header?: (columns: SqliteColumn[]) => void, maxBytes: number = limits.resultBytes, record?: (sql: string) => void): Promise<SqliteValue[][]> {
  control.check(); const values: SqliteValue[][] = [];
  const result = await driver.execute(sql, {
    parameters, maxRows, batchRows: Math.min(200, maxRows), maxBytes,
    onStatement: statement => { control.check(); if (statement.index !== 0) throw Error('SQLite表浏览出现了额外语句'); header?.(statement.columns); },
    onBatch: batch => { control.check(); if (batch.index !== 0 || values.length + batch.rows.length > maxRows) throw Error('SQLite表浏览结果行超出本页预算'); values.push(...batch.rows); },
  }, record && (() => record(sql)));
  control.check();
  if (result.statements.length !== 1 || result.statements[0].truncated || result.statements[0].rows !== values.length) throw Error('SQLite表浏览结果或元数据超过预算，无法确认完整分页；请减少每页行数或缩小范围');
  return values;
}

export { rows as readSqliteTableRows };

/** 关联范围必须在同一物理事务中核目录；无关联的既有读取不增加目录IO。 */
export async function verifySqliteTableScope(driver: SqliteDriverSession, input: { table: string; relation?: import('../shared/sqliteTableBrowse').SqliteTableRelation }, control: SqliteTableBrowseControl): Promise<void> {
  if (input.relation) { const { verifySqliteTableRelation } = await import('./sqliteTableRelation'); await verifySqliteTableRelation(driver, input.table, input.relation, control); }
}

/** 在调用方已打开的快照中计数，只投影常量，不解码无关列的原值。 */
export async function countSqliteMatchingRows(driver: SqliteDriverSession, input: Pick<SqliteTablePageInput, 'connectionId' | 'database' | 'table' | 'taskId' | 'mode' | 'filters' | 'relation'>, columns: readonly SqliteTableColumn[], control: SqliteTableBrowseControl, record?: (sql: string) => void): Promise<string> {
  await verifySqliteTableScope(driver, input, control);
  const { connectionId, database, table, taskId, mode, filters, relation } = input;
  const source = buildSqliteTableSelect({ connectionId, database, table, taskId, mode, filters, ...(relation ? { relation } : {}), sort: [], offset: 0, limit: 1 }, columns, [columns[0].name], true, () => '1');
  const sql = 'SELECT count(*) FROM (' + source.sql + ') AS "__dbark_count"';
  const result = await rows(driver, sql, source.parameters, 1, control, columns => {
    if (columns.length !== 1) throw Error('SQLite匹配行数返回非预期列');
  }, 1024, record);
  const value = result[0]?.[0];
  if (result.length !== 1 || result[0].length !== 1 || !value || typeof value !== 'object' || value.type !== 'integer') throw Error('SQLite匹配行数返回不完整');
  return sqliteRowCountSchema.parse(value.value);
}

/** 调用方已BEGIN；精确目录和完整xinfo属于同一物理读快照，导出和分页共享来源指纹。 */
export async function readSqliteTableCatalogue(driver: SqliteDriverSession, table: string, control: SqliteTableBrowseControl, schema: 'main' | typeof sqliteCopySourceSchema = 'main'): Promise<SqliteTableCatalogue> {
  const actualSchema = schema === sqliteCopySourceSchema ? sqliteCopySourceSchema : 'main';
  const objects = await rows(driver, `SELECT name,type,sql FROM ${actualSchema}.sqlite_schema WHERE name = ? COLLATE BINARY AND type IN ('table','view') LIMIT 2`, [table], 2, control);
  if (objects.length !== 1 || objects[0][0] !== table || !['table', 'view'].includes(String(objects[0][1])) || typeof objects[0][2] !== 'string') throw Error('SQLite目标表或视图已不存在，请刷新对象目录');
  const catalogue = await rows(driver, `SELECT cid,name,type,"notnull",dflt_value,pk,hidden FROM pragma_table_xinfo(?, '${actualSchema}') ORDER BY cid LIMIT ?`, [table, { type: 'integer', value: String(limits.columns + 1) }], limits.columns + 1, control);
  if (!catalogue.length || catalogue.length > limits.columns) throw Error('SQLite表没有可浏览列或列目录超过预算');
  const columns: SqliteTableColumn[] = [];
  for (const row of catalogue) {
    const hidden = row[6] && typeof row[6] === 'object' && row[6].type === 'integer' ? row[6].value : undefined;
    if (row.length !== 7 || typeof row[1] !== 'string' || !row[1] || row[1].includes('\0') || typeof row[2] !== 'string' || !['0', '1', '2', '3'].includes(hidden ?? '')) throw Error('SQLite真实列目录无效，请刷新表结构');
    if (hidden !== '1') columns.push({ name: row[1], declaredType: row[2], ...(['2', '3'].includes(hidden!) ? { generated: true } : {}) });
  }
  if (!columns.length) throw Error('SQLite表没有可浏览列或列目录超过预算');
  return { kind: objects[0][1] as 'table' | 'view', columns, schemaSql: objects[0][2], schemaKey: sqliteTableSchemaKey(objects[0][2], catalogue), xinfo: catalogue };
}

/** 显式主键查询使用索引排序规则，字段声明的排序规则可能与主键索引不同。 */
async function readSqliteBrowseKeys(driver: SqliteDriverSession, table: string, catalogue: SqliteTableCatalogue,
  control: SqliteTableBrowseControl): Promise<{ primaryKey?: SqliteTablePage['primaryKey']; rowidAlias?: string }> {
  const fields = catalogue.xinfo.flatMap(row => {
    const rank = row[5];
    return rank && typeof rank === 'object' && rank.type === 'integer' && rank.value !== '0'
      ? [{ rank: Number(rank.value), name: row[1], type: row[2] }] : [];
  }).sort((left, right) => left.rank - right.rank);
  if (!fields.length || fields.some((field, index) => field.rank !== index + 1 || typeof field.name !== 'string' ||
      !catalogue.columns.some(column => column.name === field.name))) return {};
  const parts = await rows(driver, "SELECT part.name, part.coll FROM pragma_index_list(?, 'main') AS idx " +
    "LEFT JOIN pragma_index_xinfo(idx.name, 'main') AS part ON part.key=1 WHERE idx.origin='pk' ORDER BY part.seqno LIMIT ?",
  [table, { type: 'integer', value: String(fields.length + 1) }], fields.length + 1, control);
  if (!parts.length && fields.length === 1 && String(fields[0].type).toUpperCase() === 'INTEGER')
    return { primaryKey: [{ name: fields[0].name as string, collation: 'BINARY' }], rowidAlias: fields[0].name as string };
  if (parts.length !== fields.length) return {};
  const keys: NonNullable<SqliteTablePage['primaryKey']> = [];
  for (const [index, [name, rawCollation]] of parts.entries()) {
    const collation = typeof rawCollation === 'string' ? rawCollation.toUpperCase() : undefined;
    if (typeof name !== 'string' || name !== fields[index].name ||
        (collation !== 'BINARY' && collation !== 'NOCASE' && collation !== 'RTRIM')) return {};
    keys.push({ name, collation });
  }
  return { primaryKey: keys };
}

/** BEGIN后的首个目录读取固定本页快照；元数据、筛选排序和行读取全部使用同一个只读物理连接。 */
export async function readSqliteTablePage(driver: SqliteDriverSession, source: SqliteTablePageInput, control: SqliteTableBrowseControl): Promise<SqliteTablePage> {
  const requested = sqliteTablePageSchema.parse(source), started = performance.now();
  const readSql: string[] = [];
  const record = requested.includeReadStatements ? (sql: string) => { readSql.push(sql); control.recordReadAttempt?.(sql); } : undefined;
  let page: SqliteTablePage | undefined, failed = false, failure: unknown, editPlan: SqliteEditReadPlan | undefined, originalRows: SqliteValue[][] = [];
  let browseRowIdColumn = false;
  try {
    control.check(); await driver.execute('BEGIN'); control.check();
    const catalogue = await readSqliteTableCatalogue(driver, requested.table, control), { kind, columns, schemaKey } = catalogue;
    await verifySqliteTableScope(driver, requested, control);
    // sqlite_schema 把虚拟表与影子表也标作 table，复制资格须由同一快照的 table_list 确认。
    const relationType = kind === 'table' && !/^sqlite_/i.test(requested.table)
      ? await rows(driver, "SELECT type, wr FROM pragma_table_list WHERE schema='main' AND name=? COLLATE BINARY LIMIT 2", [requested.table], 2, control)
      : [];
    const insertCopy = relationType.length === 1 && relationType[0].length === 2 && relationType[0][0] === 'table';
    const wr = relationType[0]?.[1];
    const rowidTable = insertCopy && wr && typeof wr === 'object' && wr.type === 'integer' && wr.value === '0';
    const { primaryKey, rowidAlias } = insertCopy ? await readSqliteBrowseKeys(driver, requested.table, catalogue, control) : {};
    const matchingRows = requested.lastPage ? await countSqliteMatchingRows(driver, requested, columns, control, record) : undefined;
    const last = matchingRows === undefined ? undefined : sqliteLastPagePosition(matchingRows, requested.limit);
    const input = last ? { ...requested, lastPage: undefined, offset: last.offset } : requested;
    const queryRecords = input.queryRecord ? await control.queryRecord?.(primaryKey, columns) : undefined;
    if (input.queryRecord && queryRecords?.length !== sqliteQueryRecordIndices(input.queryRecord).length)
      throw Error('SQLite 查询结果缺少原行核验');
    const searchRecord = input.searchRecordRef ? await control.searchRecord?.(catalogue) : undefined;
    if (input.searchRecordRef && !searchRecord) throw Error('SQLite 搜索记录缺少原行核验');
    const focused = !!(queryRecords || searchRecord);
    editPlan = input.editing && control.prepareEdit ? await control.prepareEdit(catalogue, driver) : undefined;
    // 无编辑快照的只读页也必须核对原TEXT字节，不能将驱动替代字符作为真实数据交给网格。
    const project = editPlan?.project ?? sqliteExactTextProjection;
    // INTEGER PRIMARY KEY 别名和编辑定位列可直接复用；其它表仅使用未被真实字段遮蔽的名称。
    const rowIdField = rowidTable && rowidAlias ? columns.findIndex(column => column.name === rowidAlias) : -1;
    const rowIdName = rowidTable && rowIdField < 0 && columns.length < limits.columns &&
      ['rowid', '_rowid_', 'oid'].find(name => !catalogue.xinfo.some(field => String(field[1]).toLowerCase() === name));
    browseRowIdColumn = !!rowIdName && !editPlan?.extraColumn;
    const extraColumn = editPlan?.extraColumn ?? (rowIdName ? '"__dbark_source".' + quoteSqliteIdentifier(rowIdName) : undefined);
    const extra = extraColumn ? 1 : 0;
    const rowIdIndex = rowIdField >= 0 ? rowIdField + extra : rowIdName ? 0 : -1;
    const request = focused ? undefined : buildSqliteTableSelect(input, columns, undefined, false, project);
    const read = (sql: string, parameters: SqliteValue[], count: number, maxBytes?: number) => {
      const extraAlias = browseRowIdColumn ? '"__dbark_browse_rowid"' : '"__dbark_edit_locator"';
      const statement = extraColumn ? 'SELECT ' + extraColumn + ' AS ' + extraAlias + ', ' + sql.slice(7) : sql;
      return rows(driver, statement, parameters, count, control, actual => {
        if (actual.length !== columns.length + extra || actual.slice(extra).some((column, index) => column.name !== columns[index].name)) throw Error('SQLite实际结果列与本页快照目录不一致');
      }, (maxBytes ?? limits.resultBytes) + (browseRowIdColumn ? count * 64 : 0), request ? record : undefined);
    };
    const values = request ? await read(request.sql, request.parameters, input.limit + 1) : [];
    if (focused) {
      const projection = 'SELECT ' + columns.map(column => project(quoteSqliteIdentifier(column.name)) + ' AS ' + quoteSqliteIdentifier(column.name)).join(', ') +
        ' FROM main.' + quoteSqliteIdentifier(input.table) + ' AS "__dbark_source" WHERE ';
      const predicates = queryRecords ?? [{ ...searchRecord!, verify: undefined }];
      let remaining = limits.resultBytes;
      // 每个键单独绑定以避免复合键耗尽参数上限；全部在同一读事务内，累计共享单页预算。
      for (const predicate of predicates) {
        if (remaining <= 0) throw Error('SQLite 查询原记录超过单页预算，请缩小范围');
        const found = await read(projection + predicate.where + ' LIMIT 2', predicate.parameters, 2, remaining);
        if (found.length !== 1) throw Error(queryRecords
          ? 'SQLite 查询原记录已变化或移除，请重新查询' : 'SQLite 搜索记录已变化或移除，请重新搜索');
        predicate.verify?.(found[0].slice(extra));
        remaining -= Buffer.byteLength(JSON.stringify(browseRowIdColumn ? found[0].slice(1) : found[0])) + 1;
        if (remaining < 0) throw Error('SQLite 查询原记录超过单页预算，请缩小范围');
        values.push(found[0]);
      }
    }
    if (last && values.length !== last.rows) throw Error('SQLite末页行数与同一快照内的计数不一致，请重试');
    originalRows = values.slice(0, input.limit);
    const rowIds = rowIdIndex < 0 ? undefined : originalRows.map(row => {
      const value = row[rowIdIndex];
      if (!value || typeof value !== 'object' || value.type !== 'integer') throw Error('SQLite ROWID 读取结果类型不符');
      return value.value;
    });
    const result: QueryResult = {
      columns: columns.map((column, index) => ({ key: 'c' + index, name: column.name, type: 'SQLITE' })),
      rows: originalRows.map(original => { const row = original.slice(extra);
        if (row.length !== columns.length) throw Error('SQLite实际结果行与本页列目录不一致');
        return Object.fromEntries(row.map((value, index) => ['c' + index, sqliteWorkspaceValue(value)])) as DataRow;
      }), truncated: false, elapsedMs: 0, statement: request?.sql ?? '',
    };
    // 每格一个协议类型码，不新增SQL；与去掉编辑定位列后的本页原值一一对应。
    const storageTypes = originalRows.map(row => row.slice(extra).map(value => value === null ? 'n' : typeof value === 'string' ? 't' : value.type === 'integer' ? 'i' : value.type === 'real' ? 'r' : 'b').join(''));
    page = { target: { connectionId: input.connectionId, database: 'main', table: input.table, kind }, columns, schemaKey, result, storageTypes, ...(rowIds ? { rowIds } : {}), ...(insertCopy ? { insertCopy: true } : {}), ...(primaryKey ? { primaryKey } : {}), offset: input.offset, limit: input.limit, hasMore: values.length > input.limit, ...(matchingRows === undefined ? {} : { matchingRows }), ...(input.relation ? { relation: input.relation } : {}) };
  } catch (reason) { failed = true; failure = reason; }
  // 即使边界取消也只回滚本次独立只读快照，绝不借用户查询标签的事务。
  control.beginCleanup();
  if (driver.isUsable && driver.transaction === true) {
    try { await driver.execute('ROLLBACK'); }
    catch (reason) { control.cleanupFailed(reason); if (failed) failure = new AggregateError([failure, reason], 'SQLite表浏览失败且原读快照回滚未确认', { cause: failure }); else { failed = true; failure = reason; } }
  } else if (!driver.isClosed && driver.transaction !== false) {
    const reason = Error('SQLite表浏览原读快照事务状态未知，须确认原driver关闭'); control.cleanupFailed(reason);
    if (failed) failure = new AggregateError([failure, reason], 'SQLite表浏览失败且读快照状态未知', { cause: failure }); else { failed = true; failure = reason; }
  }
  if (failed) throw failure;
  control.check(); page!.result.elapsedMs = performance.now() - started;
  if (readSql.length) page!.readStatements = tableReadStatements(...readSql);
  if (Buffer.byteLength(JSON.stringify({ result: page!.result, storageTypes: page!.storageTypes })) > limits.resultBytes) throw Error('SQLite表浏览结果对象超过16MiB预算，请减少每页行数或缩小范围');
  if (editPlan) {
    page!.edit = editPlan.capture(browseRowIdColumn ? originalRows.map(row => row.slice(1)) : originalRows);
    if (page!.edit.kind === 'editable' && editPlan.referenceColumns?.length) page!.referenceColumns = editPlan.referenceColumns;
  }
  return page!;
}

/** 目录及派生读取使用同一快照，回滚完成前不交付结果。 */
export async function withSqliteReadSnapshot<T>(driver: SqliteDriverSession, control: SqliteTableBrowseControl, read: () => Promise<T>): Promise<T> {
  let output: T | undefined, failed = false, failure: unknown;
  try {
    control.check(); await driver.execute('BEGIN'); control.check();
    output = await read();
  } catch (reason) { failed = true; failure = reason; }
  control.beginCleanup();
  if (driver.isUsable && driver.transaction === true) try { await driver.execute('ROLLBACK'); } catch (reason) { control.cleanupFailed(reason); failure = failed ? new AggregateError([failure, reason], 'SQLite只读操作失败且回滚未确认', { cause: failure }) : reason; failed = true; }
  else if (!driver.isClosed && driver.transaction !== false) { const reason = Error('SQLite只读操作原只读快照状态未知'); control.cleanupFailed(reason); failure = failed ? new AggregateError([failure, reason], 'SQLite只读操作与收尾失败', { cause: failure }) : reason; failed = true; }
  if (failed) throw failure; control.check(); return output!;
}
