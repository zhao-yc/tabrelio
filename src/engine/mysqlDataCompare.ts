import { mappedColumns, mappedKeyNames, type CompareSide } from '../shared/dataCompareMapping';
import { randomUUID } from 'node:crypto';
import type { CellValue, TaskEvent } from '../shared/contracts';
import { batchSyncApplySchema, batchSyncConfirmation, batchSyncPreviewRow, createBatchSyncPreviewBudget, requireBatchSyncSelection, type BatchSyncPreview } from '../shared/dataCompareBatchSync';
import { mysqlBatchSyncPreviewSchema } from '../shared/mysqlBatchSync';
import { mysqlDataCompareSchema, mysqlDataCompareZh as text, mysqlDataSyncZh } from '../shared/mysqlDataCompare';
import { postgresDataCompareLimits as limits, postgresDataSyncLimits as syncLimits,
  postgresDataSyncPreviewSchema, postgresDataSyncApplySchema, type PostgresDataSyncPreview, type PostgresDataCompareEndpoint as Endpoint, type PostgresDataCompareInput as Input } from '../shared/postgresDataCompare';
import { execute, type ManagedConnection } from './connection';
import { identifier, qualified } from './sql';
import { compareMappedTableData, compareTableData, type TableDataSnapshot } from './tableDataDifferences';
import { applyMysqlDataSyncGroups, mysqlMappedSyncSupported, mysqlSyncSupported, readMysqlCompareRows, readMysqlSyncTarget,
  type MysqlSyncContext, type MysqlSyncEvidence, type MysqlSyncGroup, type MysqlSyncRow, type MysqlSyncTarget } from './mysqlDataSync';

interface QueryContext {
  managed: ManagedConnection;
  checkCancelled(): void;
  commandStarted(): () => void;
}
type Context = MysqlSyncContext;
interface CompareSnapshot extends TableDataSnapshot {
  originals?: { columns: TableDataSnapshot['columns']; rows: TableDataSnapshot['rows'] };
}
type Scope = { owner: string; connectionRevision: number };
interface SyncRecord extends Scope {
  id: string; expires: number; source: Endpoint; target: Endpoint; evidence: MysqlSyncEvidence;
  preview?: { report: PostgresDataSyncPreview; rows: MysqlSyncRow[] };
}
interface BatchRecord extends Scope {
  report: BatchSyncPreview<CellValue>; expires: number; sourceId: string; groups: MysqlSyncGroup[];
}
interface Work {
  input: { source: { connectionId: string }; target: { connectionId: string } }; childId?: string; stop?: Promise<void>; cancelled: boolean; timedOut: boolean; done: Promise<void>;
}
interface Host {
  run<T>(connectionId: string, taskId: string, action: (context: Context) => Promise<T>, write?: { targets: Endpoint[]; commitProtected(): boolean }): Promise<T>;
  cancel(taskId: string): Promise<void>;
}
const scope = ' WHERE BINARY TABLE_SCHEMA = BINARY ? AND BINARY TABLE_NAME = BINARY ?';

async function query<T = Record<string, unknown>[]>(context: QueryContext, sql: string, params: string[] = []) {
  const end = context.commandStarted();
  try { const result = await execute<T>(context.managed, sql, params); context.checkCancelled(); return result.rows; }
  finally { end(); }
}

export async function mysqlCompareCatalogue(context: QueryContext, database?: string, table?: string): Promise<string[]> {
  if (database && table) return (await describe(context, { database, table }, true)).columns.map(column => column.name);
  const rows = database
    ? await query<{ name: string }[]>(context, `SELECT t.TABLE_NAME AS name FROM information_schema.TABLES t
      WHERE BINARY t.TABLE_SCHEMA = BINARY ? AND t.TABLE_TYPE = 'BASE TABLE' AND t.ENGINE = 'InnoDB'
      ORDER BY t.TABLE_NAME LIMIT 10001`, [database])
    : await query<{ name: string }[]>(context, `SELECT SCHEMA_NAME AS name FROM information_schema.SCHEMATA
      WHERE LOWER(SCHEMA_NAME) NOT IN ('mysql','information_schema','performance_schema','sys')
      ORDER BY SCHEMA_NAME LIMIT 10001`);
  if (rows.length > 10000) throw Error('比较目录超过显示预算');
  return rows.map(row => row.name);
}

/** 整数显示宽度不影响值的取值范围。ZEROFILL 仍保留原声明，枚举字面量不改写。 */
function declaration(value: string) {
  return /\bzerofill\b/i.test(value) ? value : value.replace(/^(tinyint|smallint|mediumint|int|bigint)\(\d+\)/i, '$1');
}

async function describe(context: QueryContext, target: Pick<Endpoint, 'database' | 'table'>, custom = false) {
  const params = [target.database, target.table];
  const tables = await query<{ engine: string; kind: string }[]>(context,
    'SELECT ENGINE AS engine, TABLE_TYPE AS kind FROM information_schema.TABLES' + scope, params);
  if (tables.length !== 1 || tables[0].kind !== 'BASE TABLE' || tables[0].engine?.toLowerCase() !== 'innodb')
    throw Error('比较需要两张可读取的 InnoDB 普通表');
  const columns = await query<{ name: string; type: string; dataType: string }[]>(context,
    'SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, DATA_TYPE AS dataType FROM information_schema.COLUMNS' +
    scope + ' ORDER BY BINARY COLUMN_NAME LIMIT 1025', params);
  const keys = custom ? [] : await query<{ name: string; prefix: string | null }[]>(context,
    'SELECT COLUMN_NAME AS name, SUB_PART AS prefix FROM information_schema.STATISTICS' + scope +
    " AND INDEX_NAME = 'PRIMARY' ORDER BY SEQ_IN_INDEX LIMIT 1025", params);
  if (!columns.length || columns.length > 1024 || (!custom && !keys.length) || keys.some(key => key.prefix !== null || !columns.some(col => col.name === key.name)))
    throw Error('两侧须有可完整读取的列和非前缀主键');
  return { columns, keys: keys.map(key => key.name) };
}

/** 先验目录，实际读取持有元数据锁，再复核原目录，防止混入并发 DDL。 */
async function readTable(context: Context, target: Endpoint, filter: Input['filter'], mapping: Input['mapping'], side: CompareSide,
  captureOriginals: boolean): Promise<CompareSnapshot> {
  const before = await describe(context, target, !!mapping);
  const columns = mapping ? mappedColumns(before.columns, mapping, side) : before.columns;
  const keys = mapping ? mappedKeyNames(mapping, side) : before.keys;
  const params: string[] = [];
  let where = '';
  if (filter?.text) {
    const column = before.columns.find(column => column.name === filter.column);
    if (!column) throw Error('两侧表均须存在筛选列');
    where = ' WHERE LOCATE(CAST(? AS BINARY), CAST(CONVERT(' + identifier(column.name) + ' USING utf8mb4) AS BINARY)) > 0';
    params.push(filter.text);
  }
  // 比较只显示映射列。完整右侧旧值超出预算时仍可返回原有只读结果。
  let originalRows: Awaited<ReturnType<typeof readMysqlCompareRows>> | undefined;
  if (captureOriginals) {
    try { originalRows = await readMysqlCompareRows(context, target, before.columns); }
    catch { context.checkCancelled(); }
  }
  const values = originalRows ?? await readMysqlCompareRows(context, target, columns, where, params);
  const after = await describe(context, target, !!mapping);
  if (JSON.stringify(before) !== JSON.stringify(after)) throw Error('读取期间表结构已变化，请重新比较');
  return { keys, columns: columns.map(({ name, type }) => ({ name, type: declaration(type) })),
    rows: values.map(row => columns.map(column => row[column.name])),
    ...(originalRows ? { originals: { columns: before.columns.map(({ name, type }) => ({ name, type })),
      rows: originalRows.map(row => before.columns.map(column => row[column.name])) } } : {}) };
}

/** 每个配置使用独占读连接。同一配置的两库可共享一个 InnoDB 读视图。 */
export class MysqlDataCompareTasks {
  private sync?: SyncRecord;
  private batch?: BatchRecord;
  private readonly active = new Map<string, Work>();
  constructor(private readonly host: Host, private readonly emit: (event: TaskEvent) => void) {}
  has(id: string) { return this.active.has(id); }

  private async withCompareTask<T>(input: Work['input'] & { taskId: string }, read: (work: Work, check: () => void) => Promise<T>) {
    if (this.active.has(input.taskId) || this.active.size >= 4) throw Error('MySQL／MariaDB 比较任务繁忙或编号重复');
    let finish!: () => void;
    const work: Work = { input, cancelled: false, timedOut: false, done: new Promise<void>(resolve => { finish = resolve; }) };
    this.sync = undefined;
    this.batch = undefined;
    this.active.set(input.taskId, work);
    const check = () => { if (work.cancelled) throw Error(work.timedOut ? text.timeout : text.cancelled); };
    const timer = setTimeout(() => {
      work.timedOut = true;
      void this.cancel(input.taskId).catch(() => undefined);
    }, limits.timeoutMs);
    timer.unref();
    try {
      this.emit({ taskId: input.taskId, status: 'running', progress: 0, message: text.running });
      const result = await read(work, check);
      check();
      return result;
    } catch (reason) {
      await work.stop;
      check();
      throw reason;
    } finally { clearTimeout(timer); this.active.delete(input.taskId); finish(); }
  }

  /** 每张表对沿用原生只读快照。批次在一个可取消任务中依次读取，各表对分别建立快照。 */
  private async readPair(input: Input, work: Work, check: () => void, capture: boolean) {
    let metadata: MysqlSyncTarget | undefined;
    const read = async (targets: Endpoint[]) => {
      check();
      work.childId = randomUUID();
      try {
        return await this.host.run(targets[0].connectionId, work.childId, async context => {
          await query(context, "SET SESSION time_zone = '+00:00'");
          await query(context, 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
          await query(context, 'START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
          const snapshots: CompareSnapshot[] = [];
          for (const target of targets) {
            check();
            const right = target === input.target;
            const captureRight = capture && right && !input.filter?.text && !input.summaryOnly;
            const snapshot = await readTable(context, target, input.filter, input.mapping, right ? 'target' : 'source',
              captureRight && !!input.mapping);
            snapshots.push(snapshot);
            if (captureRight && (!input.mapping || snapshot.originals)) {
              // 无法证明写入权限或结构时仍保留只读比较。取消不得从这个分支降级成成功。
              try {
                const candidate = await readMysqlSyncTarget(context, target);
                const names = snapshot.columns.map(column => column.name);
                if (input.mapping ? mysqlMappedSyncSupported(candidate.source, names) : mysqlSyncSupported(candidate.source, names, snapshot.keys))
                  metadata = candidate;
              } catch { context.checkCancelled(); }
            }
          }
          await query(context, 'COMMIT');
          return snapshots;
        });
      } finally { work.childId = undefined; }
    };
    const shared = input.source.connectionId === input.target.connectionId;
    const [left, right] = shared ? await read([input.source, input.target]) :
      [(await read([input.source]))[0], (await read([input.target]))[0]];
    check();
    const rows: MysqlSyncRow[] = [];
    const collect: Parameters<typeof compareTableData>[4] = metadata ? (after, before, position) => {
      rows.push({ before: position === undefined ? undefined : right.originals?.rows[position] ?? before, after });
    } : undefined;
    const result = input.mapping ? compareMappedTableData(left, right, shared, 'MySQL／MariaDB', input.mapping, collect) :
      compareTableData(left, right, shared, 'MySQL／MariaDB', collect);
    const evidence = metadata && rows.length ? { metadata, columns: right.columns.map(column => column.name), rows,
      ...(right.originals ? { mapped: { keys: right.keys, originals: right.originals.columns } } : {}) } : undefined;
    return { result, evidence };
  }

  async compare(raw: Input, scope?: Scope) {
    const input = mysqlDataCompareSchema.parse(raw);
    return this.withCompareTask(input, async (work, check) => {
      const { result, evidence } = await this.readPair(input, work, check, !!scope);
      if (input.summaryOnly) return { ...result, differences: [] };
      if (!scope || !evidence) return result;
      const id = randomUUID();
      this.sync = { ...scope, id, expires: Date.now() + syncLimits.lifetimeMs, source: input.source, target: input.target, evidence };
      setTimeout(() => { if (this.sync?.id === id) this.sync = undefined; }, syncLimits.lifetimeMs).unref();
      return { ...result, syncSnapshotId: id };
    });
  }

  async previewBatch(raw: unknown, scope: Scope): Promise<BatchSyncPreview<CellValue> | null> {
    const input = mysqlBatchSyncPreviewSchema.parse(raw);
    return this.withCompareTask(input, async (work, check) => {
      const groups: MysqlSyncGroup[] = [], tables: BatchSyncPreview<CellValue>['tables'] = [];
      const counts = { insert: 0, update: 0, delete: 0 };
      const actions = { 'source-only': 'insert', 'target-only': 'delete', different: 'update' } as const;
      const reserve = createBatchSyncPreviewBudget();
      for (const pair of input.pairs) {
        const target = { ...input.target, table: pair.target };
        const { result, evidence } = await this.readPair({
          source: { ...input.source, table: pair.source }, target, taskId: input.taskId, mapping: pair.mapping,
        }, work, check, true);
        const table = qualified(target.database, target.table);
        const tableCounts = { insert: 0, update: 0, delete: 0 };
        const rows: MysqlSyncGroup['rows'] = [], details: BatchSyncPreview<CellValue>['tables'][number]['rows'] = [];
        const columns = result.columns.map(column => column.name);
        for (const [index, difference] of result.differences.entries()) {
          const action = actions[difference.kind];
          if (!input.actions.includes(action)) continue;
          const row = evidence?.rows[index];
          if (!row) throw Error('右侧表不能生成同步证据：' + table);
          const detail = batchSyncPreviewRow(action, difference, columns, row, pair.mapping);
          reserve(detail);
          tableCounts[action]++; counts[action]++;
          rows.push(row); details.push(detail);
        }
        if (evidence && rows.length) {
          groups.push({ target, rows, evidence: { ...evidence, rows: [] } });
          tables.push({ table, confirmation: table, counts: tableCounts, rows: details });
        }
      }
      if (!groups.length) return null;
      const confirmation = batchSyncConfirmation(tables.map(table => table.confirmation));
      const report = { previewId: randomUUID(), confirmation, counts, tables };
      this.batch = { ...scope, expires: Date.now() + syncLimits.lifetimeMs, sourceId: input.source.connectionId, groups, report };
      setTimeout(() => { if (this.batch?.report.previewId === report.previewId) this.batch = undefined; }, syncLimits.lifetimeMs).unref();
      return report;
    });
  }

  private requireSync(scope: Scope, id: string) {
    const record = this.sync;
    if (!record || record.id !== id || record.owner !== scope.owner || record.connectionRevision !== scope.connectionRevision ||
        record.expires <= Date.now() || this.active.size) throw Error(mysqlDataSyncZh.stale);
    return record;
  }

  preview(raw: unknown, scope: Scope): PostgresDataSyncPreview {
    const input = postgresDataSyncPreviewSchema.parse(raw), record = this.requireSync(scope, input.snapshotId);
    record.preview = undefined;
    const rows = input.selected.map(index => record.evidence.rows[index]);
    if (rows.some(row => !row) || Buffer.byteLength(JSON.stringify(rows)) > syncLimits.bytes)
      throw Error('同步选择无效或超过 1 MiB，请减少所选行');
    const counts = { insert: 0, update: 0, delete: 0 };
    for (const row of rows) counts[!row.before ? 'insert' : !row.after ? 'delete' : 'update']++;
    const report = { previewId: randomUUID(), confirmation: qualified(record.target.database, record.target.table), counts };
    record.preview = { report, rows };
    return report;
  }

  /** 只领取一次原预览。任务登记保护提交边界，连接断开等待实际事务终态。 */
  async apply(raw: unknown, scope: Scope, target: Endpoint) {
    const input = postgresDataSyncApplySchema.parse(raw), record = this.requireSync(scope, input.snapshotId);
    const preview = record.preview;
    if (!preview || preview.report.previewId !== input.previewId || preview.report.confirmation !== input.confirmation ||
        JSON.stringify(record.target) !== JSON.stringify(target)) throw Error(mysqlDataSyncZh.stale);
    this.sync = undefined;
    return this.write(input.taskId, [{ target, evidence: record.evidence, rows: preview.rows }]);
  }

  /** 批次预览只能由原窗口对原连接领取一次，数据库与目标表均来自冻结快照。 */
  async applyBatch(raw: unknown, scope: Scope, targetConnectionId: string) {
    const input = batchSyncApplySchema.parse(raw), record = this.batch;
    if (!record || record.report.previewId !== input.previewId ||
        record.owner !== scope.owner || record.connectionRevision !== scope.connectionRevision ||
        record.expires <= Date.now() || this.active.size || record.groups[0].target.connectionId !== targetConnectionId)
      throw Error(mysqlDataSyncZh.stale);
    const selection = requireBatchSyncSelection(record.report.tables, input.selected);
    if (selection.confirmation !== input.confirmation) throw Error(mysqlDataSyncZh.stale);
    this.batch = undefined;
    return this.write(input.taskId, selection.groups.map(({ tableIndex, rows }) => {
      const group = record.groups[tableIndex];
      return { ...group, rows: rows.map(index => group.rows[index]) };
    }));
  }

  private async write(taskId: string, groups: MysqlSyncGroup[]) {
    let committing = false, receipt: Awaited<ReturnType<typeof applyMysqlDataSyncGroups>> | undefined;
    const targets = groups.map(group => group.target);
    try {
      await this.host.run(targets[0].connectionId, taskId, async context => {
        receipt = await applyMysqlDataSyncGroups(context, groups, () => { committing = true; });
      }, { targets, commitProtected: () => committing });
      return receipt!;
    } catch (reason) {
      if (receipt) return { ...receipt, message: receipt.message + '，连接收尾异常，请核对资源' };
      throw reason;
    }
  }

  async cancel(id: string) {
    const work = this.active.get(id);
    if (!work) return;
    work.cancelled = true;
    if (work.childId) work.stop ??= this.host.cancel(work.childId);
    try { await work.stop; }
    finally { await work.done; }
  }

  async close(connectionId?: string) {
    if (!connectionId || this.sync && [this.sync.source.connectionId, this.sync.target.connectionId].includes(connectionId)) this.sync = undefined;
    if (!connectionId || this.batch && [this.batch.sourceId, this.batch.groups[0].target.connectionId].includes(connectionId)) this.batch = undefined;
    const results = await Promise.allSettled([...this.active].filter(([, work]) => !connectionId ||
      [work.input.source.connectionId, work.input.target.connectionId].includes(connectionId)).map(([id]) => this.cancel(id)));
    const failed = results.find(result => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
  }
}
