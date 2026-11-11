import { isXmlFormat } from '../shared/dataMarkupExport';
import { sqliteQueryInsertColumnsForResult, type SqliteQueryExportInput } from '../shared/sqliteQueryExport';
import { validateSqliteQueryParameters } from '../shared/sqliteQueryParameters';
import { resultExportColumns } from '../shared/resultExport';
import { createExcelWorkbookWriter } from '../engine/excelFiles';
import { csvExportDelimiter } from '../shared/csvExport';
import { csvCell, csvHeader } from '../engine/files';
import { sqliteNamedParameterNames, sqliteParameterInfo, sqliteParameterPlan } from '../engine/sqlite/parameters';
import { sqliteStatementRanges } from '../engine/sqlite/currentStatement';
import { EXCEL_LIMITS } from '../shared/excelTransfer';
import { sqliteLeadingKeyword } from '../shared/sqliteStatementScanner';
import type { QueryParameterNames } from '../shared/queryParameters';
import { sqliteInsertRowWriter } from '../shared/sqliteInsertLiteral';
import type { SqliteValue } from '../engine/sqlite/protocol';
import type { SqliteDriverSession } from '../engine/sqlite/session';
import type { SqliteExportDestination, SqliteTableExportFile } from './sqliteTableExport';
import { sqliteWorkspaceValue } from './sqliteQuerySession';
import { dataFileWriter } from '../engine/dataMarkupExport';

export type SqliteQueryExportRequest = SqliteQueryExportInput & SqliteExportDestination;

/** 先核对全文和数量，原生只读进程仍逐条复核实际语句类型和尾部。 */
function sqliteQueryExportStatements(sql: string, workbook = false) {
  const statements = sqliteStatementRanges(sql);
  if (workbook ? statements.length < 1 || statements.length > EXCEL_LIMITS.maxSheets : statements.length !== 1)
    throw Error(workbook ? 'SQLite Excel 导出需要 1 至 64 条查询' : 'SQLite 完整导出只接受单条 SELECT 或 WITH 查询');
  if (statements.some(part => !['SELECT', 'WITH'].includes(sqliteLeadingKeyword(part.sql) ?? '')))
    throw Error('SQLite 完整导出只接受 SELECT 或 WITH 查询');
  return statements;
}

/** 工作簿内重复名称只询问一次，执行时每条语句只绑定实际引用的值。 */
export function sqliteQueryExportParameterNames(sql: string, workbook = false, navicat = false): QueryParameterNames {
  sqliteQueryExportStatements(sql, workbook);
  return sqliteParameterInfo(sql, navicat);
}

/** 打开源库前核对全部语句和参数。每条语句只发送原生驱动要求的实际绑定。 */
export function sqliteQueryExportPlan(input: SqliteQueryExportInput) {
  const workbook = input.format === 'xlsx';
  const statements = sqliteQueryExportStatements(input.sql, workbook);
  const {sql, names} = sqliteParameterPlan(input.sql, input.sqliteNavicatParameters);
  const values = validateSqliteQueryParameters(input.parameters ?? []);
  if (values.size !== names.length || names.some(name => !values.has(name))) throw Error('SQLite 导出参数必须完整匹配模板中的参数名称');
  return statements.map(part => {
    const statement = workbook ? sql.slice(part.start, part.end) : sql;
    const used = workbook && statements.length > 1 ? sqliteNamedParameterNames(statement) : names;
    return {sql: statement, namedParameters: Object.fromEntries(used.map(name => [':' + name, values.get(name)!])) as Record<string, SqliteValue>};
  });
}

/** 全部工作表沿同一物理只读连接。文件只暂存，由外层在原进程退出后发布。 */
export async function prepareSqliteQueryExport(driver: SqliteDriverSession, input: SqliteQueryExportRequest,
  queries: ReturnType<typeof sqliteQueryExportPlan>, file: SqliteTableExportFile, check: () => void, progress: (rows: number) => void): Promise<number> {
  const workbook = input.format === 'xlsx';
  const markup = dataFileWriter(input.format, input.txtOptions);
  const delimiter = csvExportDelimiter(input.format, input.csvDelimiter);
  type Workbook = Awaited<ReturnType<typeof createExcelWorkbookWriter>>;
  let excel: Workbook | undefined;
  let count = 0;
  try {
    check();
    if (workbook) {
      if (!driver.readOnly || (await driver.execute('BEGIN')).transaction !== true)
        throw Error('SQLite 未确认工作簿的独立只读事务');
      check();
      // BEGIN 延后获取快照。先实际读取主库，避免常量查询先运行、后续工作表才固定快照。
      if ((await driver.execute('SELECT 1 FROM main.sqlite_schema LIMIT 1', {maxRows: 1})).transaction !== true)
        throw Error('SQLite 未确认工作簿读快照');
    }
    for (const [index, query] of queries.entries()) {
      check();
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
          if (workbook) {
            if (!excel) {
              await file.open();
              excel = await createExcelWorkbookWriter({filePath: input.filePath, deferredAtomicFile: file.excelFile(),
                checkCancelled: check, onCommitStart: () => { throw Error('SQLite Excel 不能自行发布文件'); }});
            }
            const headers = resultExportColumns(columns.map((name, index) => ({key: String(index), name})));
            sheet = await excel.startSheet(queries.length === 1 ? '数据' : `结果 ${index + 1}`,
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
              if (sheet) await sheet.write(values);
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
          workbook && result.transaction !== true) throw Error('SQLite 查询导出未取得完整原生结果，文件未发布');
      sheet?.close();
    }
    if (workbook) {
      if (!excel || (await excel.complete()).rows !== count) throw Error('SQLite Excel 导出行数与原结果不一致');
      check();
      // 成功时明确结束快照。失败或取消由外层关闭原只读进程并等待退出。
      if ((await driver.execute('ROLLBACK')).transaction !== false) throw Error('SQLite 未确认工作簿快照结束');
      check();
    }
    if (input.format === 'json') await file.write('\n]\n');
    if (markup) await file.write(markup.tableEnd(count) + markup.documentEnd);
    return count;
  } finally { await excel?.dispose(); }
}
