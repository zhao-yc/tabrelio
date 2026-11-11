import { isAbsolute } from 'node:path';
import type { CellValue, QueryResult, ResultColumn } from '../../shared/contracts';
import { postgresIdentifier } from '../../shared/postgresSql';
import { resultExportColumns } from '../../shared/resultExport';
import { EXCEL_LIMITS } from '../../shared/excelTransfer';
import { AtomicFile, nativeAtomicFileIO } from '../atomicFile';
import { exportExcelWorkbook, type ExcelExportSheet } from '../excelFiles';
import { queryExportSelectsRowResult, queryStreamExportLimits } from '../../shared/queryStreamExport';
import { postgresQueryExportSchema, postgresQueryExportStatements, postgresQueryInsertColumnsForResult, type PostgresQueryExportInput, type PostgresQueryExportOutput } from '../../shared/postgresQueryExport';
import { createQueryStreamFile, type QueryStreamFile } from '../queryStreamFile';
import type { PostgresConnection } from './connection';
import { postgresParameterBindings } from './parameters';
import { readPostgresSqlExportSettings, writePostgresSqlPreamble, writePostgresSqlRows } from './sqlExport';

export type PostgresQueryExportRequest = PostgresQueryExportInput & {filePath: string};

/** 空结果仍交一次列描述。等待当前批次落盘后才拉取下一批。 */
async function* queryExportBatches(connection: PostgresConnection, check: () => void) {
  const batchRows = 64;
  let columns: ResultColumn[] | undefined;
  for (;;) {
    check();
    const batch = await connection.query('FETCH FORWARD 64 FROM dbark_query_export', undefined,
      {rows: batchRows, bytes: queryStreamExportLimits.rowBytes * 4});
    if (batch.postgresCommand !== 'FETCH' || batch.truncated || batch.affectedRows !== batch.rows.length || !batch.columns.length)
      throw Error('PostgreSQL 导出批次不完整或超过大小预算');
    if (columns && (batch.columns.length !== columns.length || batch.columns.some((column, i) =>
      column.name !== columns![i].name || column.type !== columns![i].type))) throw Error('PostgreSQL 导出列描述已变化');
    columns = batch.columns;
    yield batch;
    if (batch.rows.length < batchRows) return;
  }
}

/** 先交付首批列描述，随后复用同一批次迭代器并逐行消费。 */
async function* queryExportRows(first: QueryResult,
  batches: ReturnType<typeof queryExportBatches>): AsyncGenerator<CellValue[]> {
  let batch = first;
  for (;;) {
    for (const row of batch.rows) yield batch.columns.map(column => row[column.key]);
    const next = await batches.next();
    if (next.done) return;
    batch = next.value;
  }
}

/** 复用同名游标时，先确认原游标真实关闭。扩展协议同时约束只允许一条命令。 */
async function openExportCursor(connection: PostgresConnection, sql: string, values: unknown[] | undefined) {
  const declared = await connection.query('DECLARE dbark_query_export NO SCROLL CURSOR FOR\n' + sql,
    values, {rows: 0, bytes: 1024}, undefined, 'extended');
  if (declared.postgresCommand !== 'DECLARE') throw Error('PostgreSQL 未确认导出游标');
}
async function closeExportCursor(connection: PostgresConnection) {
  const closed = await connection.query('CLOSE dbark_query_export', undefined, {rows: 0, bytes: 1024});
  if (closed.postgresCommand !== 'CLOSE') throw Error('PostgreSQL 未确认游标关闭');
}

/** 工作簿的全部游标顺序共用一个只读快照，文件在游标和物理会话收尾后发布。 */
export async function exportPostgresQuery(input: PostgresQueryExportRequest,
  connect: (action: (connection: PostgresConnection) => Promise<void>) => Promise<void>,
  check: () => void, publish: () => void, progress: (rows: number) => void): Promise<PostgresQueryExportOutput> {
  const { filePath, sql, format, encoding, csvDelimiter, txtOptions, parameters, insertTarget } = input;
  postgresQueryExportSchema.parse({connectionId: input.connectionId, database: input.database, taskId: input.taskId,
    fileToken: input.fileToken, sql, format, encoding, csvDelimiter, ...(txtOptions ? {txtOptions} : {}), parameters, insertTarget});
  if (!isAbsolute(filePath) || filePath.includes('\0')) throw Error('主进程未提供授权的导出路径');
  let file: QueryStreamFile | undefined, atomic: AtomicFile | undefined;
  let rows = 0;
  try {
    await connect(async connection => {
      check();
      const workbook = format === 'xlsx';
      const source = postgresQueryExportStatements(sql, connection.standardStrings, workbook);
      const bindings = postgresParameterBindings(source.names, parameters);
      const valuesFor = (names: readonly string[]) => bindings && names.map(name => bindings.get(name));
      const beginSql = workbook ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN READ ONLY';
      const begun = await connection.query(beginSql, undefined, {rows: 0, bytes: 1024});
      if (begun.postgresCommand !== 'BEGIN' || !connection.state().transactionKnown || !connection.state().transactionOpen)
        throw Error('PostgreSQL 未确认只读事务');
      check();
      if (workbook) {
        const destination = atomic = await AtomicFile.create(filePath, 'utf8', check, publish, nativeAtomicFileIO,
          EXCEL_LIMITS.maxCompressedBytes, undefined, true);
        async function* sheets(): AsyncGenerator<ExcelExportSheet> {
          for (const [index, part] of source.statements.entries()) {
            check();
            await openExportCursor(connection, part.sql, valuesFor(part.names));
            const batches = queryExportBatches(connection, check);
            const first = await batches.next();
            if (first.done) throw Error('PostgreSQL Excel 导出缺少列描述');
            const result = first.value;
            yield {
              name: source.statements.length === 1 ? '数据' : `结果 ${index + 1}`,
              columns: resultExportColumns(result.columns).map(({exportName}, i) => ({name: exportName, type: result.columns[i].type})),
              async writeRows(write) {
                for await (const row of queryExportRows(result, batches)) await write(row);
              },
            };
            check();
            await closeExportCursor(connection);
          }
        }
        ({rows} = await exportExcelWorkbook({filePath, sheets: sheets(), deferredAtomicFile: destination,
          checkCancelled: check, onCommitStart: publish, onProgress: progress}));
      } else {
        const insertSettings = format === 'sql' ? await readPostgresSqlExportSettings(connection) : undefined;
        check();
        const part = source.statements[0];
        await openExportCursor(connection, part.sql, valuesFor(part.names));
        const batches = queryExportBatches(connection, check);
        if (format === 'sql') {
          const first = await batches.next();
          if (first.done || !insertTarget || !insertSettings) throw Error('PostgreSQL INSERT 导出缺少列描述或目标');
          const target = postgresIdentifier(insertTarget.schema) + '.' + postgresIdentifier(insertTarget.table);
          const names = postgresQueryInsertColumnsForResult(insertTarget, first.value.columns.map(column => column.name));
          const columns = names.map(name => ({name, identityAlways: false}));
          const destination = atomic = await AtomicFile.create(filePath, 'utf8', check, publish, nativeAtomicFileIO, queryStreamExportLimits.fileBytes);
          const write = (chunk: string) => destination.write(chunk);
          await writePostgresSqlPreamble(insertSettings, write, '完整查询 INSERT 导出');
          rows = await writePostgresSqlRows(target, columns, queryExportRows(first.value, batches), write, progress);
          await write('COMMIT;\n');
        } else {
          const output = file = await createQueryStreamFile({filePath, format, encoding, csvDelimiter, txtOptions,
            resultSelection: queryExportSelectsRowResult(format) ? {kind: 'row-result', ordinal: 1} : {kind: 'all'},
            checkCancelled: check, onCommitStart: publish});
          const first = await batches.next();
          if (first.done) throw Error('PostgreSQL 导出缺少列描述');
          const result = first.value;
          const headers = resultExportColumns(result.columns).map((column, index) => ({
            ...column, position: index + 1, type: result.columns[index].type,
          }));
          await output.write({kind: 'rows-start', resultOrdinal: 1, statementOrdinal: 1, rowResultOrdinal: 1, columns: headers});
          for await (const values of queryExportRows(result, batches)) {
            await output.write({kind: 'row', resultOrdinal: 1, values});
            if (++rows % 256 === 0) progress(rows);
          }
          await output.write({kind: 'rows-end', resultOrdinal: 1});
        }
        check();
        await closeExportCursor(connection);
      }
      check();
      const ended = await connection.query('COMMIT', undefined, {rows: 0, bytes: 1024});
      const state = connection.state();
      if (ended.postgresCommand !== 'COMMIT' || !state.transactionKnown || state.transactionOpen)
        throw Error('PostgreSQL 未确认完整读取结束');
    });
    check();
    if (atomic) await atomic.commit();
    else if (file) await file.complete();
    else throw Error('PostgreSQL 导出未生成文件');
    return {rows, fileCommitted: true};
  } finally {
    await atomic?.dispose();
    await file?.abort();
  }
}
