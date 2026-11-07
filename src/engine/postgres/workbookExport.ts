import { isAbsolute } from 'node:path';
import { EXCEL_LIMITS, excelWorksheetNames } from '../../shared/excelTransfer';
import { postgresRelationName } from '../../shared/postgresSql';
import { postgresWorkbookExportSchema, type PostgresWorkbookExportInput } from '../../shared/postgresWorkbookExport';
import type { PostgresTableExportOutput } from '../../shared/postgresTable';
import { AtomicFile, nativeAtomicFileIO } from '../atomicFile';
import { exportExcelWorkbook, type ExcelExportSheet } from '../excelFiles';
import type { PostgresConnection } from './connection';
import { validatePostgresExportRow } from './tableExport';
import { beginPostgresTableTransaction, readExportCursor, readPostgresTableSelect, readRelation } from './tableWorkspace';

export type PostgresWorkbookExportRequest = PostgresWorkbookExportInput & { filePath: string };
// 驱动会扣减行数和字节额度，每条控制语句都要新建预算。
const controlResult = () => ({ rows: 1, bytes: 4096 });

/** 每个游标顺序耗尽，所有关系共享一次可重复读快照，连接关闭后才发布文件。 */
export async function exportPostgresWorkbook(input: PostgresWorkbookExportRequest,
  connect: (action: (connection: PostgresConnection) => Promise<void>) => Promise<void>,
  check: () => void, publish: () => void, progress: (rows: number) => void): Promise<PostgresTableExportOutput> {
  const { filePath } = input;
  const { objects } = postgresWorkbookExportSchema.parse({
    connectionId: input.connectionId, database: input.database, taskId: input.taskId, fileToken: input.fileToken, objects: input.objects,
  });
  if (!isAbsolute(filePath) || filePath.includes('\0')) throw Error('主进程未提供授权的导出路径');
  const names = excelWorksheetNames(objects.map(object => postgresRelationName(object.name).name));
  let staged: AtomicFile | undefined, rows = 0;
  try {
    await connect(async connection => {
      check();
      await beginPostgresTableTransaction(connection, 'page');
      if (!connection.state().transactionKnown || !connection.state().transactionOpen) throw Error('PostgreSQL 未确认工作簿读事务');
      async function* sheets(): AsyncGenerator<ExcelExportSheet> {
        for (const [index, object] of objects.entries()) {
          check();
          const relation = await readRelation(connection, object.name, true);
          const isView = relation.kind === 'v' || relation.kind === 'm';
          if (isView !== (object.kind === 'view') || relation.kind === 'f') throw Error('PostgreSQL 导出对象类型已变化或为外部表');
          const { sql, args } = readPostgresTableSelect(relation, {});
          const declared = await connection.query('DECLARE dbark_table_export NO SCROLL CURSOR FOR ' + sql, args, controlResult(), undefined, 'extended');
          if (declared.postgresCommand !== 'DECLARE') throw Error('PostgreSQL 未确认工作表游标');
          // 游标已持有关系锁。复核名称解析到的实际 OID，避免同名替换继承原目录。
          const bound = await connection.query('SELECT pg_catalog.to_regclass($1)::oid', [relation.sql], controlResult());
          if (bound.truncated || bound.rows.length !== 1 || bound.rows[0].c0 !== relation.oid) throw Error('PostgreSQL 导出关系已变化，请刷新对象列表');
          yield {
            name: names[index], columns: relation.columns.map(({ name, type }) => ({ name, type })),
            async writeRows(write) {
              for await (const row of readExportCursor(connection, relation.columns, check)) {
                validatePostgresExportRow(row);
                await write(row);
              }
            },
          };
          check();
          const closed = await connection.query('CLOSE dbark_table_export', undefined, controlResult());
          if (closed.postgresCommand !== 'CLOSE') throw Error('PostgreSQL 未确认工作表游标关闭');
        }
      }
      const file = staged = await AtomicFile.create(filePath, 'utf8', check, publish, nativeAtomicFileIO, EXCEL_LIMITS.maxCompressedBytes, undefined, true);
      ({ rows } = await exportExcelWorkbook({ filePath, sheets: sheets(), deferredAtomicFile: file, checkCancelled: check, onCommitStart: publish, onProgress: progress }));
      check();
      const ended = await connection.query('COMMIT', undefined, controlResult());
      if (ended.postgresCommand !== 'COMMIT' || !connection.state().transactionKnown || connection.state().transactionOpen)
        throw Error('PostgreSQL 未确认工作簿快照结束');
    });
    check();
    if (!staged) throw Error('PostgreSQL 工作簿未生成暂存文件');
    await staged.commit();
    return { rows, fileCommitted: true };
  } finally { await staged?.dispose(); }
}
