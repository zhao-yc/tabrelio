import { isAbsolute } from 'node:path';
import type { ResultSetHeader } from 'mysql2';
import { EXCEL_LIMITS, excelWorksheetNames } from '../shared/excelTransfer';
import { mysqlWorkbookExportSchema, type MysqlWorkbookExportInput } from '../shared/mysqlWorkbookExport';
import { selectTableFilteredExportColumns } from '../shared/tableFilteredExport';
import { buildTableReadOrder } from '../shared/tableReadSql';
import { AtomicFile, nativeAtomicFileIO } from './atomicFile';
import { exportExcelWorkbook, type ExcelExportSheet } from './excelFiles';
import { readIncomingReferenceTable } from './incomingReferences';
import { identifier, qualified } from './sql';
import { structureTaskQuery, type StructureTaskContext } from './structureDefinition';
import { streamTableExportRows, type PreparedTableFilteredExport, type TableFilteredExportControl } from './tableFilteredExport';

type MysqlWorkbookExportRequest = MysqlWorkbookExportInput & { filePath: string };

/** 一份只读一致性快照顺序消费所有选中对象，文件暂存与最终发布分开。 */
export async function prepareMysqlWorkbookExport(context: StructureTaskContext, request: MysqlWorkbookExportRequest,
  control: TableFilteredExportControl): Promise<PreparedTableFilteredExport> {
  const { filePath } = request, check = context.checkCancelled;
  const { database, objects } = mysqlWorkbookExportSchema.parse({
    connectionId: request.connectionId, database: request.database, taskId: request.taskId, fileToken: request.fileToken, objects: request.objects,
  });
  if (!isAbsolute(filePath) || filePath.includes('\0')) throw Error('主进程未提供授权的导出路径');
  const sheetNames = excelWorksheetNames(objects.map(object => object.name));
  await structureTaskQuery(context, 'SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  const begin = (await structureTaskQuery<ResultSetHeader>(context, 'START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY')).rows;
  if (!Number.isInteger(begin.serverStatus) || !(begin.serverStatus & 1) || begin.warningStatus !== 0)
    throw Error('服务器未确认只读一致性快照，工作簿未保存');
  // 在读取任何数据前取得所有关系的元数据锁，避免后续同名替换进入原工作簿。
  for (const object of objects) await structureTaskQuery(context, 'SELECT 1 FROM ' + qualified(database, object.name) + ' LIMIT 0');
  async function* sheets(): AsyncGenerator<ExcelExportSheet> {
    for (const [index, object] of objects.entries()) {
      check();
      const source = await readIncomingReferenceTable(context, { database, table: object.name }, true);
      if (source.objectKind !== object.kind) throw Error('导出对象类型已变化，请刷新对象列表');
      if (source.objectKind === 'table' && source.engine.toUpperCase() !== 'INNODB')
        throw Error('工作簿导出只支持 InnoDB 基本表和可读取的视图');
      const columns = selectTableFilteredExportColumns(source, { format: 'xlsx' });
      const order = buildTableReadOrder(source, []);
      const sql = 'SELECT ' + columns.map(column => identifier(column.name)).join(', ') +
        ' FROM ' + qualified(database, object.name) + (order ? ' ORDER BY ' + order : '');
      yield {
        name: sheetNames[index], columns: columns.map(({ name, type }) => ({ name, type })),
        async writeRows(write) {
          await streamTableExportRows(context, { sql, columns }, control.stop, async frame => {
            if (frame.kind === 'row') await write(frame.values);
          });
        },
      };
    }
  }
  const file = await AtomicFile.create(filePath, 'utf8', check, control.onCommitStart, control.io ?? nativeAtomicFileIO,
    EXCEL_LIMITS.maxCompressedBytes, undefined, true);
  try {
    const { rows } = await exportExcelWorkbook({ filePath, sheets: sheets(), deferredAtomicFile: file, checkCancelled: check,
      onCommitStart: control.onCommitStart, onProgress: control.onProgress });
    const end = (await structureTaskQuery<ResultSetHeader>(context, 'ROLLBACK AND NO CHAIN NO RELEASE')).rows;
    if (!Number.isInteger(end.serverStatus) || end.serverStatus & 1 || end.warningStatus !== 0)
      throw Error('服务器未确认工作簿读取事务结束，原文件保持');
    check();
    return { rows, get fileCommitted() { return file.fileCommitted; },
      async commit() { check(); await file.commit(); return { rows, fileCommitted: true }; },
      dispose: () => file.dispose() };
  } catch (error) {
    try { await file.dispose(); } catch (cleanup) { throw new AggregateError([error, cleanup], '工作簿导出失败且原暂存资源未确认清理', { cause: error }); }
    throw error;
  }
}
