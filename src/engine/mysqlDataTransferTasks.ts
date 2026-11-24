import { randomUUID } from 'node:crypto';
import type { ResultSetHeader } from 'mysql2';
import { mysqlDataTransferApplySchema, mysqlDataTransferLimits as limits, mysqlDataTransferPreviewSchema,
  type MysqlDataTransferEndpoint, type MysqlDataTransferPreviewInput,
  type MysqlDataTransferPreview, type MysqlDataTransferResult } from '../shared/mysqlDataTransfer';
import { readTransferRows, readTransferTable, transferCreateSql, transferDestination, writeTransferRows,
  type TransferRows, type TransferTable } from './mysqlDataTransfer';
import { qualified } from './sql';
import { structureTaskQuery, type StructureTaskContext } from './structureDefinition';

interface Plan {
  request: MysqlDataTransferPreviewInput; definitions: TransferTable[]; stamp: string;
  expires: number; revision: number; owner: string;
}
interface Ports {
  source<T>(endpoint: MysqlDataTransferEndpoint, action: (context: StructureTaskContext) => Promise<T>): Promise<T>;
  target<T>(endpoint: MysqlDataTransferEndpoint, taskId: string, action: (context: StructureTaskContext) => Promise<T>,
    write?: { tables: string[]; protected(): boolean }): Promise<T>;
}
const endpointMatches = (left: MysqlDataTransferEndpoint, right: MysqlDataTransferEndpoint) =>
  left.connectionId === right.connectionId && left.database === right.database;
const status = (plan: Plan): MysqlDataTransferResult => ({
  status: 'incomplete', tables: plan.definitions.map(table => ({ name: table.name, structure: 'pending', rows: null })),
});

/** 一次性预览只存目录和定义，数据留在当次执行的有界内存快照。 */
export class MysqlDataTransferTasks {
  private readonly previews = new Map<string, Plan>();
  private running = false;
  constructor(private readonly ports: Ports, private readonly now = Date.now) {}

  private prune() { for (const [id, plan] of this.previews) if (plan.expires <= this.now()) this.previews.delete(id); }
  release(id: string, owner: string) { if (this.previews.get(id)?.owner === owner) this.previews.delete(id); }

  /** 两侧均为专用连接；所有选中对象通过检查后才发布可确认的预览。 */
  async preview(input: unknown, revision: number, owner: string): Promise<MysqlDataTransferPreview> {
    const request = mysqlDataTransferPreviewSchema.parse(input);
    this.prune();
    if (!owner || this.running || this.previews.size >= 8) throw Error('数据传输任务繁忙或预览已达上限');
    this.running = true;
    try {
      const result = await this.ports.target(request.target, request.taskId, async target => {
        const definitions = await this.readSource(request, target);
        const destination = await transferDestination(target, request.target, definitions);
        return { definitions, destination };
      });
      const previewId = randomUUID(), expires = this.now() + limits.ttlMs;
      this.previews.set(previewId, { request, definitions: result.definitions, stamp: result.destination.stamp, expires, owner, revision });
      return { previewId, expiresAt: new Date(expires).toISOString(), sourceVersion: result.definitions[0].version,
        targetVersion: result.destination.version, tables: result.definitions.map(table => ({ name: table.name, sql: transferCreateSql(request.target, table) })) };
    } finally { this.running = false; }
  }

  private readSource(request: MysqlDataTransferPreviewInput, parent: StructureTaskContext, stage?: { rows: TransferRows[]; expected: TransferTable[] }) {
    return this.ports.source(request.source, async connection => {
      // 目标任务可取消；读取源端命令时也逐条核对父任务，禁止取消后转入建表。
      const context: StructureTaskContext = { ...connection, checkCancelled: () => { parent.checkCancelled(); connection.checkCancelled(); } };
      const mysql = context.managed.status.dialect === 'mysql';
      await structureTaskQuery(context, mysql ? 'SET SESSION max_execution_time = 15000' : 'SET SESSION max_statement_time = 15');
      await structureTaskQuery(context, 'SET SESSION lock_wait_timeout = 10');
      await structureTaskQuery(context, "SET SESSION time_zone = '+00:00'");
      await structureTaskQuery(context, 'SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await structureTaskQuery(context, 'START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
      const definitions: TransferTable[] = [];
      const budget = { rows: limits.rows as number, bytes: limits.bytes as number };
      let definitionsBytes = 0;
      for (const name of request.tables) {
        // 先获取读取元数据锁，防止 SHOW CREATE 与本快照中的 SELECT 观察到不同定义。
        const source = qualified(request.source.database, name);
        await structureTaskQuery(context, 'SELECT 1 FROM ' + source + ' LIMIT 0');
        const table = await readTransferTable(context, request.source, name);
        definitionsBytes += Buffer.byteLength(table.definition);
        if (definitionsBytes > limits.definitionBytes) throw Error('所选表定义超过传输上限');
        if (stage && JSON.stringify(table) !== JSON.stringify(stage.expected[definitions.length]))
          throw Error('来源实例、表定义或会话模式已变化，请重新预览');
        definitions.push(table);
        if (stage && request.content === 'all') {
          const rows = await readTransferRows(context, request.source, table, budget);
          budget.rows -= rows.values.length; budget.bytes -= rows.bytes; stage.rows.push(rows);
        }
      }
      await structureTaskQuery(context, 'ROLLBACK');
      return definitions;
    });
  }

  /** 所有数据先完成读取；创建日志与数据提交分开记录，DDL 中断后保留已确认的副本。 */
  async apply(input: unknown, revision: number, owner: string): Promise<MysqlDataTransferResult> {
    const checked = mysqlDataTransferApplySchema.parse(input);
    this.prune();
    const plan = this.previews.get(checked.previewId);
    if (!plan || plan.owner !== owner || plan.revision !== revision || this.running ||
        !endpointMatches(plan.request.source, checked.source) || !endpointMatches(plan.request.target, checked.target) ||
        checked.confirmation !== plan.request.target.database) throw Error('传输预览、连接或目标库确认已失效，请重新预览');
    this.previews.delete(checked.previewId);
    this.running = true;
    const result = status(plan);
    let committing = false, protectedCommand = false, stage = '重新核对源和目标';
    try {
      return await this.ports.target(checked.target, checked.taskId, async context => {
        const request = plan.request, { target } = request;
        const staged: TransferRows[] = [];
        await this.readSource(request, context, { rows: staged, expected: plan.definitions });
        const destination = await transferDestination(context, target, plan.definitions);
        if (destination.stamp !== plan.stamp || plan.expires <= this.now()) throw Error('目标目录或传输预览已变化，未创建表');
        await structureTaskQuery(context, 'SET SESSION lock_wait_timeout = 10');
        await structureTaskQuery(context, "SET SESSION time_zone = '+00:00'");
        for (const [index, table] of plan.definitions.entries()) {
          stage = '创建和核对目标表 ' + table.name;
          const receipt = result.tables[index];
          const { rows } = await structureTaskQuery<ResultSetHeader>(context, transferCreateSql(target, table), () => {
            receipt.structure = 'submitted'; protectedCommand = true;
          });
          protectedCommand = false;
          receipt.structure = 'created';
          const actual = await readTransferTable(context, target, table.name);
          if (rows.warningStatus !== 0 || actual.definitionKey !== table.definitionKey || actual.mode !== table.mode)
            throw Error('目标返回警告或建表回读与来源不一致');
        }
        if (request.content === 'all') {
          stage = '准备目标事务';
          const modes = plan.definitions[0].mode.split(',').filter(Boolean);
          if (!modes.includes('NO_AUTO_VALUE_ON_ZERO')) modes.push('NO_AUTO_VALUE_ON_ZERO');
          await structureTaskQuery(context, "SET SESSION sql_mode = '" + modes.join(',') + "'");
          await structureTaskQuery(context, 'SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
          await structureTaskQuery(context, 'START TRANSACTION');
          // 复核的空表范围和元数据锁保留到事务末尾，避免并发数据进入本轮副本。
          for (const table of plan.definitions) {
            stage = '重新核对空表 ' + table.name;
            const lock = context.managed.status.dialect === 'mysql' ? ' FOR SHARE' : ' LOCK IN SHARE MODE';
            const { rows } = await structureTaskQuery<{ records: string | number }[]>(context,
              'SELECT COUNT(*) AS records FROM ' + qualified(target.database, table.name) + lock);
            const actual = await readTransferTable(context, target, table.name);
            if (rows.length !== 1 || ![0, '0'].includes(rows[0].records) || actual.definitionKey !== table.definitionKey)
              throw Error('目标表已被改动或写入，停止本次数据传输');
          }
          for (const [index, table] of plan.definitions.entries()) {
            const rows = staged[index];
            stage = '写入数据 ' + table.name;
            await writeTransferRows(context, target, table, rows);
            stage = '回读数据 ' + table.name;
            const actual = await readTransferRows(context, target, table, { rows: rows.values.length, bytes: rows.bytes });
            if (actual.digest !== rows.digest || actual.values.length !== rows.values.length) throw Error('目标写入回读与来源快照不一致');
          }
          stage = '提交数据事务';
          await structureTaskQuery(context, 'COMMIT', () => { protectedCommand = true; committing = true; });
          committing = false; protectedCommand = false;
          staged.forEach((rows, index) => { result.tables[index].rows = rows.values.length; });
        }
        result.status = 'completed';
        stage = '等待目标连接收尾';
        return result;
      }, { tables: plan.request.tables, protected: () => protectedCommand });
    } catch (error) {
      if (result.tables.every(table => table.structure === 'pending')) throw error;
      const unconfirmed = committing || result.status === 'completed' || result.tables.some(table => table.structure === 'submitted');
      result.status = unconfirmed ? 'unknown' : 'incomplete';
      const code = (error as { code?: unknown })?.code;
      const serverCode = typeof code === 'string' && /^(?:ER_[A-Z0-9_]{1,80}|ECONNRESET|ETIMEDOUT)$/.test(code) ? '（' + code + '）' : '';
      result.message = stage + serverCode + '。' + (unconfirmed ? '部分操作或连接收尾尚未确认，请核对目标库及回执。' :
        '已确认创建的表保留，数据事务未确认提交。');
      return result;
    } finally { this.running = false; }
  }
}
