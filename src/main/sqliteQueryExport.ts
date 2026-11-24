import { isXmlFormat } from '../shared/dataMarkupExport';
import { sqliteQueryInsertColumnsForResult, type SqliteQueryExportInput, type SqliteQueryExportSource } from '../shared/sqliteQueryExport';
import { validateSqliteQueryParameters } from '../shared/sqliteQueryParameters';
import { resultExportColumns } from '../shared/resultExport';
import { createExcelWorkbookWriter } from '../engine/excelFiles';
import { csvExportDelimiter } from '../shared/csvExport';
import { csvCell, csvHeader } from '../engine/files';
import { sqliteNamedParameterNames, sqliteParameterInfo, sqliteParameterPlan } from '../engine/sqlite/parameters';
import { sqliteStatementRanges } from '../engine/sqlite/currentStatement';
import { EXCEL_LIMITS, excelWorksheetNames } from '../shared/excelTransfer';
import { queryResultTitle } from '../shared/queryResultTitle';
import { sqliteLeadingKeyword } from '../shared/sqliteStatementScanner';
import type { QueryParameterNames } from '../shared/queryParameters';
import { sqliteInsertRowWriter } from '../shared/sqliteInsertLiteral';
import type { SqliteValue } from '../engine/sqlite/protocol';
import type { SqliteDriverSession } from '../engine/sqlite/session';
import type { SqliteExportDestination, SqliteTableExportFile } from './sqliteTableExport';
import { sqliteWorkspaceValue } from './sqliteQuerySession';
import { dataFileWriter } from '../engine/dataMarkupExport';
import { prepareQueryCsvZip, QueryCsvArchive } from '../engine/queryCsvZip';
import { queryStreamExportLimits } from '../shared/queryStreamExport';

export type SqliteQueryExportRequest = SqliteQueryExportInput & SqliteExportDestination;

/** 先核对全文和数量，原生只读进程仍逐条复核实际语句类型和尾部。 */
function sqliteQueryExportStatements(sql: string, format?: SqliteQueryExportInput['format']) {
  const limit = format === 'xlsx' ? EXCEL_LIMITS.maxSheets : format === 'csv-zip' ? queryStreamExportLimits.results : 1;
  const statements = sqliteStatementRanges(sql);
  if (!statements.length || statements.length > limit)
    throw Error(limit === 1 ? 'SQLite 完整导出只接受单条 SELECT 或 WITH 查询' :
      `SQLite ${format === 'xlsx' ? 'Excel' : 'CSV ZIP'} 导出需要 1 至 ${limit} 条查询`);
  if (statements.some(part => !['SELECT', 'WITH'].includes(sqliteLeadingKeyword(part.sql) ?? '')))
    throw Error('SQLite 完整导出只接受 SELECT 或 WITH 查询');
  return statements;
}

/** 多结果导出内重复名称只询问一次，每条语句只绑定实际引用的值。 */
export function sqliteQueryExportParameterNames({sql, workbook, csvZip, sqliteNavicatParameters}: SqliteQueryExportSource): QueryParameterNames {
  sqliteQueryExportStatements(sql, workbook ? 'xlsx' : csvZip ? 'csv-zip' : undefined);
  return sqliteParameterInfo(sql, sqliteNavicatParameters);
}

/** 打开源库前核对全部语句和参数。每条语句只发送原生驱动要求的实际绑定。 */
export function sqliteQueryExportPlan(input: SqliteQueryExportInput) {
  const multiple = input.format === 'xlsx' || input.format === 'csv-zip';
  const statements = sqliteQueryExportStatements(input.sql, input.format);
  const {sql, names} = sqliteParameterPlan(input.sql, input.sqliteNavicatParameters);
  const values = validateSqliteQueryParameters(input.parameters ?? []);
  if (values.size !== names.length || names.some(name => !values.has(name))) throw Error('SQLite 导出参数必须完整匹配模板中的参数名称');
  return statements.map(part => {
    const statement = multiple ? sql.slice(part.start, part.end) : sql;
    const used = multiple && statements.length > 1 ? sqliteNamedParameterNames(statement) : names;
    const title = multiple ? queryResultTitle(part.sql, 'sqlite') : undefined;
    return {sql: statement, namedParameters: Object.fromEntries(used.map(name => [':' + name, values.get(name)!])) as Record<string, SqliteValue>,
      ...(title ? {title} : {})};
  });
}

/** 多组结果沿同一物理只读连接。文件只暂存，由外层在原进程退出后发布。 */
export async function prepareSqliteQueryExport(driver: SqliteDriverSession, input: SqliteQueryExportRequest,
  queries: ReturnType<typeof sqliteQueryExportPlan>, file: SqliteTableExportFile, check: () => void, progress: (rows: number) => void): Promise<number> {
  const workbook = input.format === 'xlsx';
  const sheetNames = workbook ? excelWorksheetNames(queries.map((query, index) =>
    query.title ?? (queries.length === 1 ? '数据' : `结果 ${index + 1}`))) : [];
  const markup = dataFileWriter(input.format, input.txtOptions);
  const csvZip = input.format === 'csv-zip';
  const delimiter = csvExportDelimiter(csvZip ? 'csv' : input.format, input.csvDelimiter);
  const archive = csvZip ? new QueryCsvArchive(file, input.encoding, check, delimiter) : undefined;
  const sharedSnapshot = workbook || csvZip;
  type Workbook = Awaited<ReturnType<typeof createExcelWorkbookWriter>>;
  let excel: Workbook | undefined;
  let count = 0;
  try {
    check();
    if (archive) {
      await prepareQueryCsvZip(input.filePath, check);
      await file.open();
    }
    if (sharedSnapshot) {
      if (!driver.readOnly || (await driver.execute('BEGIN')).transaction !== true)
        throw Error('SQLite 未确认导出的独立只读事务');
      check();
      // 先实际读取主库，避免常量查询先运行、后续结果才固定快照。
      if ((await driver.execute('SELECT 1 FROM main.sqlite_schema LIMIT 1', {maxRows: 1})).transaction !== true)
        throw Error('SQLite 未确认导出读快照');
    }
    for (const [index, query] of queries.entries()) {
      check();
      const ordinal = index + 1;
      let columns: string[] | undefined;
      let sheet: Awaited<ReturnType<Workbook['startSheet']>> | undefined;
      let insertRow: ReturnType<typeof sqliteInsertRowWriter> | undefined;
      let rows = 0;
      const result = await driver.streamQuery(query.sql, {
        namedParameters: query.namedParameters, batchRows: 100,
        onStatement: async statement => {
          check();
          if (statement.index !== 0 || columns || !statement.columns.length) throw Error('SQLite 查询导出必须恰好产生一组查询结果');
          columns = statement.columns.map(column => column.name);
          if (archive) {
            const headers = resultExportColumns(columns.map((name, index) => ({key: String(index), name})))
              .map((column, index) => ({...column, position: index + 1, type: 'SQLITE'}));
            await archive.start({resultOrdinal: ordinal, statementOrdinal: ordinal, rowResultOrdinal: ordinal, title: query.title}, headers);
            await archive.text(headers.map(column => csvHeader(column.exportName, delimiter)).join(delimiter) + '\r\n');
            return;
          }
          if (workbook) {
            if (!excel) {
              await file.open();
              excel = await createExcelWorkbookWriter({filePath: input.filePath, deferredAtomicFile: file.excelFile(),
                checkCancelled: check, onCommitStart: () => { throw Error('SQLite Excel 不能自行发布文件'); }});
            }
            const headers = resultExportColumns(columns.map((name, index) => ({key: String(index), name})));
            sheet = await excel.startSheet(sheetNames[index],
              headers.map(({exportName}) => ({name: exportName, type: 'SQLITE'})));
            return;
          }
          if (input.format === 'json' && new Set(columns).size !== columns.length) throw Error('JSON 导出需要不同的列名，请为重名列设置别名或选择 CSV／Excel／HTML');
          if (input.format === 'sql') {
            const target = input.insertTarget!;
            insertRow = sqliteInsertRowWriter(target.database, target.table, sqliteQueryInsertColumnsForResult(target, columns));
          }
          await file.open();
          if (insertRow) await file.write('-- SQLite 完整查询结果\n');
          else if (markup) {
            const headers = isXmlFormat(input.format) ? columns : resultExportColumns(columns.map((name, index) => ({key: String(index), name}))).map(column => column.exportName);
            await file.write(markup.documentStart() + markup.tableStart(headers));
          } else {
            if (input.encoding === 'utf16le') await file.write('\uFEFF');
            await file.write(input.format === 'csv' ? columns.map(name => csvHeader(name, delimiter)).join(delimiter) + '\r\n' : '[');
          }
        },
        onBatch: async batch => {
          check();
          if (batch.index !== 0 || !columns) throw Error('SQLite 查询导出结果与原生列定义不一致');
          for (const row of batch.rows) {
            check();
            if (row.length !== columns.length || !Number.isSafeInteger(count + 1)) throw Error('SQLite 查询导出行或计数无效');
            if (insertRow) await file.write(insertRow(row));
            else {
              const values = row.map(sqliteWorkspaceValue);
              // 原生流已限制单行大小，按归档编码逐行落盘后才接收下一批。
              if (archive) await archive.text(values.map(value => csvCell(value, delimiter)).join(delimiter) + '\r\n');
              else if (sheet) await sheet.write(values);
              else if (markup) await file.write(markup.row(values));
              else await file.write(input.format === 'csv' ? values.map(value => csvCell(value, delimiter)).join(delimiter) + '\r\n'
                : (rows ? ',\n' : '') + '{' + columns.map((name, index) => JSON.stringify(name) + ':' + JSON.stringify(values[index])).join(',') + '}');
            }
            rows++; count++;
          }
          progress(count);
        },
      });
      check();
      if (!columns || result.statements.length !== 1 || result.statements[0].truncated || result.statements[0].rows !== rows ||
          sharedSnapshot && result.transaction !== true) throw Error('SQLite 查询导出未取得完整原生结果，文件未发布');
      sheet?.close();
      if (archive) await archive.end(rows);
    }
    if (workbook && (!excel || (await excel.complete()).rows !== count)) throw Error('SQLite Excel 导出行数与原结果不一致');
    await archive?.complete();
    if (sharedSnapshot) {
      check();
      // 成功时明确结束快照。失败或取消由外层关闭原只读进程并等待退出。
      if ((await driver.execute('ROLLBACK')).transaction !== false) throw Error('SQLite 未确认导出快照结束');
      check();
    }
    if (input.format === 'json') await file.write('\n]\n');
    if (markup) await file.write(markup.tableEnd(count) + markup.documentEnd);
    return count;
  } finally { await excel?.dispose(); }
}
