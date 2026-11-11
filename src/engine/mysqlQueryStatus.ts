import { mysqlQueryStatusLimit, type MysqlQueryStatusEntry, type MysqlQueryStatusReport } from '../shared/mysqlQueryStatus';

type Traffic = NonNullable<MysqlQueryStatusEntry['traffic']>;
type TrafficPort = { dbarkStartQueryTraffic?(): (() => Traffic | undefined) | undefined };

/** 只观测用户命令的发送和终态。采集故障只影响指标，不改变原 SQL 或事务的回执。 */
export class MysqlQueryStatusCollector {
  readonly report: MysqlQueryStatusReport = { entries: [], omitted: 0 };

  /** 终态独立复制，后续清理或复用连接不能改变已交付的诊断。 */
  terminal(termination: NonNullable<MysqlQueryStatusReport['termination']>): MysqlQueryStatusReport {
    return { ...structuredClone(this.report), termination };
  }

  begin(connection: object): (status: MysqlQueryStatusEntry['status'], submitted: boolean) => void {
    let stop: (() => Traffic | undefined) | undefined;
    try {
      if (this.report.entries.length < mysqlQueryStatusLimit) stop = (connection as TrafficPort).dbarkStartQueryTraffic?.();
    } catch { /* 驱动无法采集时仍可展示往返耗时。 */ }
    const started = performance.now();
    let finished = false;
    return (status, submitted) => {
      if (finished) return;
      finished = true;
      let traffic: Traffic | undefined;
      try {
        const sample = stop?.();
        if (sample && Number.isSafeInteger(sample.sent) && sample.sent > 0 &&
            Number.isSafeInteger(sample.received) && sample.received >= 0) traffic = { sent: sample.sent, received: sample.received };
      } catch { /* 独立的观测失败不能遮蔽用户命令。 */ }
      if (!submitted && !traffic) return;
      const { entries } = this.report;
      if (entries.length >= mysqlQueryStatusLimit) { this.report.omitted++; return; }
      entries.push({ ordinal: entries.length + 1, status, elapsedMs: performance.now() - started, ...(traffic ? { traffic } : {}) });
    };
  }
}
