import { mysqlQueryStageLimit, mysqlQueryStageSchema, type MysqlQueryStatusEntry, type MysqlQueryStatusReport } from '../shared/mysqlQueryStatus';
import { connect, execute, type ManagedConnection } from './connection';

const schema = 'performance_schema';
const statement = schema + '.events_statements_current';
const history = schema + '.events_stages_history';
const consumerSql = `SELECT NAME AS name FROM ${schema}.setup_consumers WHERE ENABLED = 'YES' AND NAME IN
  ('global_instrumentation', 'thread_instrumentation', 'events_statements_current',
   'events_stages_current', 'events_stages_history', 'events_stages_history_long')`;
const phaseTimeoutMs = 2500;

/** 观察连接只读 Performance Schema。执行前后核对同一物理线程和新事件，不读取 SQL 或参数。 */
export class MysqlQueryStages {
  private readonly controller = new AbortController();
  private observer?: ManagedConnection;
  private scope?: string;
  private stageTable?: string;

  constructor(private readonly source: ManagedConnection, private readonly report: MysqlQueryStatusReport) {
    report.stageCollection = 'unavailable';
  }

  async open(): Promise<void> {
    const { queryTraceId, connection, profile } = this.source;
    const id = connection.threadId;
    if (!queryTraceId || !/^[0-9a-f-]{36}$/.test(queryTraceId) || !Number.isSafeInteger(id) || id! <= 0) return;
    await this.withDeadline(async () => {
      const observer = this.observer = await connect(profile, null, this.controller.signal);
      const { rows: [setting] } = await execute<{ enabled: number }[]>(observer, 'SELECT @@performance_schema AS enabled');
      if (setting?.enabled === 0) { this.report.stageCollection = 'disabled'; return; }
      const { rows } = await execute<{ name: string }[]>(observer, consumerSql);
      const enabled = new Set(rows.map(row => row.name));
      const stageTable = enabled.has('events_stages_history') ? history :
        enabled.has('events_stages_history_long') ? history + '_long' : undefined;
      if (!stageTable || !['global_instrumentation', 'thread_instrumentation', 'events_statements_current',
        'events_stages_current'].every(name => enabled.has(name))) { this.report.stageCollection = 'disabled'; return; }
      // 握手随机标识防止代理换后端或连接号复用时读取其它线程。限定值均由引擎生成。
      const scope = `FROM ${schema}.threads t JOIN ${schema}.session_connect_attrs a
        ON a.PROCESSLIST_ID=t.PROCESSLIST_ID AND a.ATTR_NAME='tabrelio_query_trace' AND BINARY a.ATTR_VALUE='${queryTraceId}'`;
      const { rows: identity } = await execute(observer, `SELECT 1 ${scope} WHERE t.PROCESSLIST_ID=${id} LIMIT 2`);
      if (identity.length !== 1) return;
      this.scope = scope;
      this.stageTable = stageTable;
      this.report.stageCollection = 'ready';
    });
  }

  async before(): Promise<string | undefined> {
    const observer = this.observer, id = this.source.connection.threadId;
    if (!observer || !this.scope || this.controller.signal.aborted || this.source.broken || !Number.isSafeInteger(id)) return;
    return this.withDeadline(async () => {
      const { rows: [row] } = await execute<{ watermark: string }[]>(observer,
        `SELECT CAST(COALESCE(MAX(s.EVENT_ID),0) AS CHAR) AS watermark ${this.scope}
         LEFT JOIN ${statement} s ON s.THREAD_ID=t.THREAD_ID WHERE t.PROCESSLIST_ID=${id}`);
      return /^\d{1,20}$/.test(row?.watermark ?? '') ? row.watermark : undefined;
    });
  }

  async after(watermark: string, entry: MysqlQueryStatusEntry): Promise<void> {
    const observer = this.observer, id = this.source.connection.threadId;
    if (!observer || !this.stageTable || this.controller.signal.aborted || this.source.broken || !Number.isSafeInteger(id)) return;
    await this.withDeadline(async () => {
      const { rows } = await execute<{ name: string; picoseconds: string | null }[]>(observer,
        `SELECT p.EVENT_NAME AS name,CAST(p.TIMER_WAIT AS CHAR) AS picoseconds ${this.scope}
         JOIN ${statement} s ON s.THREAD_ID=t.THREAD_ID
         JOIN ${this.stageTable} p ON p.THREAD_ID=s.THREAD_ID AND p.NESTING_EVENT_ID=s.EVENT_ID AND p.NESTING_EVENT_TYPE='STATEMENT'
         WHERE t.PROCESSLIST_ID=${id} AND s.EVENT_ID>${watermark} AND s.END_EVENT_ID IS NOT NULL AND s.OBJECT_TYPE IS NULL
         AND (s.EVENT_NAME LIKE 'statement/sql/%' OR s.EVENT_NAME='statement/com/Query')
         AND p.END_EVENT_ID IS NOT NULL
         ORDER BY p.EVENT_ID LIMIT ${mysqlQueryStageLimit + 1}`);
      const stages = rows.slice(0, mysqlQueryStageLimit).flatMap(({ name, picoseconds }) => {
        if (picoseconds !== null && !/^\d{1,20}$/.test(picoseconds)) return [];
        const stage = mysqlQueryStageSchema.safeParse({ name, elapsedMs: picoseconds === null ? null : Number(picoseconds) / 1e9 });
        return stage.success ? [stage.data] : [];
      });
      if (stages.length) entry.stages = { rows: stages, limited: rows.length > mysqlQueryStageLimit };
    });
  }

  /** 取消和超时只销毁观察连接，原查询仍沿自己的取消与结果路径。 */
  cancel(): void { this.controller.abort(); }

  async close(): Promise<void> {
    try { await this.observer?.close({ strict: true }); }
    catch { this.cancel(); this.report.stageCollection = 'unavailable'; }
  }

  private async withDeadline<T>(read: () => Promise<T>): Promise<T | undefined> {
    if (this.controller.signal.aborted) return;
    const timer = setTimeout(() => this.cancel(), phaseTimeoutMs);
    timer.unref();
    try { return await read(); }
    catch {
      this.report.stageCollection = 'unavailable';
      this.cancel();
    } finally { clearTimeout(timer); }
  }
}
