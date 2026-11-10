import { createHash } from 'node:crypto';
import type { QueryOutcome, TableInfo } from '../shared/contracts';
import { buildForeignKeyJoin, foreignKeyJoinMetadataKey } from '../shared/tableForeignKeyJoin';
import { mysqlJoinPreviewOptions, mysqlJoinPreviewRelation, mysqlJoinSampleRows, type MysqlJoinPreviewInput, type MysqlJoinPreviewTarget } from '../shared/mysqlJoinPreview';
import { completionQuery } from './completionQuery';
import { tableInfo } from './metadata';
import { readMysqlPreviewRows } from './mysqlViewQueryInspect';
import { identifier } from './sql';
import { structureTaskQuery, type StructureTaskContext } from './structureDefinition';

/** 独立连接逐表核目录，保留设计原排序与 LIMIT。采样上限只截断返回，不改写原查询语义。 */
export async function previewMysqlJoin(context: StructureTaskContext, input: MysqlJoinPreviewInput, stop: () => Promise<void>): Promise<QueryOutcome> {
  const control = (sql: string) => structureTaskQuery(context, sql);
  await control('USE ' + identifier(input.source.database));
  await control('SET SESSION lock_wait_timeout = 5');
  await control('START TRANSACTION READ ONLY');
  try {
    const tables = new Map<string, { info: TableInfo; digest: string }>();
    async function read(target: MysqlJoinPreviewTarget): Promise<TableInfo> {
      context.checkCancelled();
      const key = JSON.stringify([target.database, target.table]);
      let record = tables.get(key);
      if (!record) {
        const info = await tableInfo(context.managed, target.database, target.table, (sql, params = []) => completionQuery(context.managed, context, sql, params));
        const digest = createHash('sha256').update(foreignKeyJoinMetadataKey(info), 'utf8').digest('hex');
        record = { info, digest };
        tables.set(key, record);
      }
      if (record.info.database !== target.database || record.info.name !== target.table || record.digest !== target.digest)
        throw Error('JOIN 的表结构已变化，请重新读取结构后预览。');
      return record.info;
    }
    const child = await read(input.source), parent = await read(input.parent);
    const additional: TableInfo[] = [];
    for (const step of input.steps) additional.push(await read(step.target));
    const query = buildForeignKeyJoin(child, parent, mysqlJoinPreviewRelation(input), input.kind, input.limit, mysqlJoinPreviewOptions(input, additional)).sql;
    const result = await readMysqlPreviewRows(context, query, mysqlJoinSampleRows, 512 * 1024, stop);
    return { results: [result], elapsedMs: result.elapsedMs };
  } finally {
    if (!context.managed.broken && !context.managed.signal?.aborted) await control('ROLLBACK AND NO CHAIN NO RELEASE');
  }
}
