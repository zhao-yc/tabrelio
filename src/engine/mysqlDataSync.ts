import type { CellValue, DataRow, RowChange, TableInfo } from '../shared/contracts';
import { postgresDataCompareLimits as limits, type PostgresDataCompareEndpoint as Target } from '../shared/postgresDataCompare';
import type { PostgresTableOutcome } from '../shared/postgresTable';
import { applyTableTransactionGroups, emptyTableApplyEvidence } from './tableApplyTransaction';
import { command, header, readTarget } from './tableFilteredUpdateProtocol';
import { configureTableFilteredDeleteForeignKeys, readTableFilteredDeleteTarget } from './tableFilteredDeleteProtocol';
import { identifier, qualified, deserializeCell, typedCellPlaceholder } from './sql';
import type { StructureTaskContext } from './structureDefinition';
import { validateLosslessImport } from './losslessImport';
import { tableDataKey } from './tableDataDifferences';
import { structureTaskQuery } from './structureDefinition';

export type MysqlSyncTarget = Awaited<ReturnType<typeof readTarget>>;
export interface MysqlSyncRow { before?: CellValue[]; after?: CellValue[]; }
interface CompareColumn { name: string; type: string; }
export interface MysqlSyncEvidence {
  metadata: MysqlSyncTarget; columns: string[]; rows: MysqlSyncRow[];
  mapped?: { keys: string[]; originals: CompareColumn[] };
}
export type MysqlPageParameters = (string | number | boolean | null | Buffer)[];
export type MysqlSyncContext = StructureTaskContext & {
  page(sql: string, params: MysqlPageParameters): Promise<{ rows: DataRow[]; columns: { name: string }[]; hasMore: boolean }>;
};
export const readMysqlSyncTarget = readTarget;

const types = /^(?:tinyint|smallint|mediumint|int|bigint|decimal|float|double|real|bit|date|year|time|datetime|timestamp|char|varchar|tinytext|text|mediumtext|longtext|binary|varbinary|tinyblob|blob|mediumblob|longblob|json|enum|set)\b/i;
const geometry = /^(?:geometry|point|linestring|polygon|multipoint|multilinestring|multipolygon|geometrycollection)\b/i;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** 比较和事务复核共用真实列名、无损二进制协议与整表预算。 */
export async function readMysqlCompareRows(context: MysqlSyncContext, target: Target, columns: CompareColumn[],
  where = '', params: MysqlPageParameters = [], locked = false): Promise<DataRow[]> {
  const projection = columns.map(({ name, type }) => {
    const field = identifier(name);
    return geometry.test(type) ? 'CAST(' + field + ' AS BINARY) AS ' + field : field;
  });
  const sql = 'SELECT ' + projection.join(', ') + ' FROM ' + qualified(target.database, target.table) +
    where + ' LIMIT ' + (limits.rows + 1) + (locked ? ' FOR UPDATE' : '');
  const end = context.commandStarted();
  try {
    const page = await context.page(sql, params);
    context.checkCancelled();
    if (page.hasMore) throw Error('MySQL／MariaDB 比较超过每侧 10,000 行，请缩小筛选范围');
    if (page.columns.length !== columns.length || page.columns.some((column, index) => column.name !== columns[index].name))
      throw Error('读取期间表结构已变化，请重新比较');
    return page.rows;
  } finally { end(); }
}

export function mysqlSyncSupported(info: TableInfo, names: string[], keys: string[]) {
  return info.columns.length === names.length && info.columns.every(column => names.includes(column.name) && types.test(column.type)) &&
    same(info.editableKey, keys) && same(info.primaryKey, keys) && keys.every(name => !info.columns.find(column => column.name === name)?.generated);
}

export function mysqlMappedSyncSupported(info: TableInfo, names: string[]) {
  return names.every(name => info.columns.some(column => column.name === name && !column.generated && types.test(column.type)));
}

export interface MysqlSyncGroup { target: Target; evidence: MysqlSyncEvidence; rows: MysqlSyncRow[]; }

/** 每张表使用冻结行生成写入计划，并在同一会话内验证旧值和写入后的完整行。 */
function prepareGroup(context: MysqlSyncContext, { target, evidence, rows }: MysqlSyncGroup) {
  const { mapped, columns } = evidence;
  const originals = mapped?.originals.map(column => column.name) ?? columns;
  const compileInfo = (base: TableInfo): TableInfo => mapped ? { ...base,
    columns: base.columns.filter(column => columns.includes(column.name)), editableKey: mapped.keys } : base;
  const info = compileInfo(evidence.metadata.source);
  const toRow = (names: string[], values: CellValue[]) => Object.fromEntries(names.map((name, index) => [name, values[index]]));
  const selected = rows.map(({ before, after }) => ({
    before: before && toRow(originals, before), after: after && toRow(columns, after),
  }));
  const order = (row: typeof selected[number]) => !row.after ? 0 : row.before ? 1 : 2;
  selected.sort((a, b) => order(a) - order(b));
  const changes: RowChange[] = selected.map(({ before, after }) => {
    if (!after) return { kind: 'delete', before: before! };
    const writable = info.columns.filter(column => !column.generated && (!mapped || !before ||
      !mapped.keys.includes(column.name) && !same(before[column.name], after[column.name])));
    const values = Object.fromEntries(writable.map(column => {
      validateLosslessImport(column, after[column.name], context.managed.status.dialect);
      return [column.name, after[column.name]];
    }));
    if (mapped && before) {
      if (!writable.length) throw Error('所选映射差异没有可更新的非键字段');
      for (const name of mapped.keys) after[name] = before[name];
    }
    return before ? { kind: 'update', before, values } : { kind: 'insert', values };
  });
  const table = qualified(target.database, target.table), projection = evidence.columns.map(identifier).join(', ');
  const reread = async (key: DataRow, expected: DataRow | undefined, locked: boolean) => {
    const keys = info.primaryKey.map(name => info.columns.find(column => column.name === name)!);
    const predicate = keys.map(column => identifier(column.name) + ' <=> ' + typedCellPlaceholder(column, key[column.name])).join(' AND ');
    const params = keys.map(column => deserializeCell(key[column.name]));
    const end = context.commandStarted();
    try {
      const result = await context.page('SELECT ' + projection + ' FROM ' + table + ' WHERE ' + predicate + ' LIMIT 2' + (locked ? ' FOR UPDATE' : ''), params);
      if (result.hasMore || result.rows.length !== (expected ? 1 : 0) || (expected &&
        !evidence.columns.every(name => same(expected[name], result.rows[0][name]))))
        throw Error(locked ? '右侧原值已变化，请重新比较' : '右侧写入回读值与冻结左侧值不一致');
    } finally { end(); }
  };

  const verifyMapped = async (phase: 'before' | 'after') => {
    if (!mapped) return;
    const proofColumns = phase === 'before' ? mapped.originals : mapped.originals.filter(column => columns.includes(column.name));
    const keyTypes = mapped.keys.map(name => mapped.originals.find(column => column.name === name)!.type);
    const key = (row: DataRow) => tableDataKey(mapped.keys.map(name => row[name]), keyTypes);
    const expected = new Map(selected.map(row => [key(row.before ?? row.after!), row[phase]]));
    const actual = new Set<string>();
    // 无唯一索引时也需要阻止幻行。读尽预算内目标并保留扫描范围的记录锁和间隙锁。
    const current = await readMysqlCompareRows(context, target, proofColumns, '', [], true);
    for (const row of current) {
      const id = key(row);
      if (!expected.has(id)) continue;
      const value = expected.get(id);
      if (!value || actual.has(id) || proofColumns.some(({ name }) => !same(value[name], row[name])))
        throw Error(phase === 'before' ? '右侧映射键重复或原值已变化，请重新比较' : '右侧写入回读值或映射键行数与预览不一致');
      actual.add(id);
    }
    if ([...expected].some(([id, value]) => !!value !== actual.has(id)))
      throw Error(phase === 'before' ? '右侧映射键或原行已变化，请重新比较' : '右侧写入回读缺少预期记录');
  };

  return {
    info, changes,
    lockInfo: async () => {
      // 在独立事务内取得目标表元数据锁，再检查真实定义、授权、触发器及依赖。
      const end = context.commandStarted();
      try { await context.page('SELECT ' + projection + ' FROM ' + table + ' LIMIT 0 FOR UPDATE', []); }
      finally { end(); }
      const base = await readTarget(context, target);
      if (selected.some(row => !!row.before)) {
        const proof = await readTableFilteredDeleteTarget(context, target, base);
        if (proof.dependencies.length) throw Error('右侧表被外键引用，整批未写入');
      }
      if (base.definitionDigest !== evidence.metadata.definitionDigest || base.serverIdentity !== evidence.metadata.serverIdentity)
        throw Error('右侧表结构、权限或服务器已变化，请重新比较');
      if (mapped) await verifyMapped('before');
      else for (const row of selected) if (row.before) await reread(row.before, row.before, true);
      return compileInfo(base.source);
    },
    afterWrite: mapped ? undefined : (index: number) => {
      const row = selected[index];
      return reread(row.after ?? row.before!, row.after, false);
    },
    verifyWrites: mapped ? () => verifyMapped('after') : undefined,
  };
}

/** 一个独立会话只发送一次 COMMIT。按表名顺序锁定全部目标，避免同批反向加锁。 */
export async function applyMysqlDataSyncGroups(context: MysqlSyncContext, groups: MysqlSyncGroup[],
  commitProtected: () => void): Promise<PostgresTableOutcome> {
  const facts = emptyTableApplyEvidence();
  try {
    const ordered = [...groups].sort((a, b) => Buffer.compare(Buffer.from(a.target.table), Buffer.from(b.target.table)));
    const prepared = ordered.map(group => prepareGroup(context, group));
    for (const sql of [
      "SET SESSION time_zone = '+00:00'", 'SET SESSION innodb_lock_wait_timeout = 5', 'SET SESSION lock_wait_timeout = 5',
      'SET SESSION unique_checks = 1',
      "SET SESSION sql_mode = CONCAT_WS(',', NULLIF(@@SESSION.sql_mode,''), IF(FIND_IN_SET('NO_AUTO_VALUE_ON_ZERO', @@SESSION.sql_mode), NULL, 'NO_AUTO_VALUE_ON_ZERO'))",
    ]) header(await command(context, sql, undefined), false, 0);
    await configureTableFilteredDeleteForeignKeys(context);
    if (groups.some(group => group.evidence.mapped)) {
      // 旧服务器可全局禁用间隙锁，无法证明完整键集合时拒绝事务。
      const unsafe = (await structureTaskQuery<Record<string, unknown>[]>(context, "SHOW VARIABLES LIKE 'innodb_locks_unsafe_for_binlog'")).rows;
      if (!Array.isArray(unsafe) || unsafe.length > 1 || unsafe.some(row => !['OFF', '0'].includes(String(row.Value))))
        throw Error('服务器无法保证映射键的间隙锁');
      header(await command(context, 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ', undefined), false, 0);
    }
    await applyTableTransactionGroups(prepared, {
      evidence: facts, strictSync: true, checkCancelled: context.checkCancelled, broken: () => context.managed.broken,
      cancelled: () => !!context.managed.signal?.aborted, emit: () => {},
      send: (sql, params, ack) => command(context, sql, params.length ? params.map(deserializeCell) : undefined,
        sql === 'COMMIT' ? commitProtected : undefined, ack),
      rollback: () => command(context, 'ROLLBACK', undefined, undefined, undefined, true),
    });
    return { outcome: 'committed', affected: facts.serverReportedRows, message: 'MySQL／MariaDB 已确认整批提交' };
  } catch (error) {
    if (facts.commitAcknowledged) return { outcome: 'committed', affected: facts.serverReportedRows, message: '已确认提交，请核对连接收尾' };
    const outcome = !facts.dmlMayHaveBeenSent ? 'notSent' : facts.rollbackAcknowledged && facts.transactionProtected ? 'rolledBack' : 'unknown';
    return { outcome, affected: 0, message: error instanceof Error ? error.message : String(error) };
  }
}
