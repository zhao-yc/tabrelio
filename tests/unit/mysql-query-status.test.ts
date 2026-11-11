import { describe, expect, it } from 'vitest';
import { MysqlQueryStatusCollector } from '../../src/engine/mysqlQueryStatus';
import { mysqlQueryStatusLimit } from '../../src/shared/mysqlQueryStatus';

describe('MySQL 查询状态', () => {
  it('逐条结束且只发布一次，未投递命令不占序号', () => {
    const collector = new MysqlQueryStatusCollector();
    let stopped = 0;
    const connection = { dbarkStartQueryTraffic: () => () => { stopped++; return { sent: 14, received: 39 }; } };
    collector.begin({})('failed', false);
    const first = collector.begin(connection);
    first('completed', true);
    first('failed', true);
    collector.begin(connection)('failed', true);
    expect(stopped).toBe(2);
    expect(collector.report).toEqual({ omitted: 0, entries: [
      { ordinal: 1, status: 'completed', elapsedMs: expect.any(Number), traffic: { sent: 14, received: 39 } },
      { ordinal: 2, status: 'failed', elapsedMs: expect.any(Number), traffic: { sent: 14, received: 39 } },
    ] });
  });

  it('驱动不可用、无流量及无效计数不冒充零字节', () => {
    const collector = new MysqlQueryStatusCollector();
    collector.begin({})('completed', true);
    collector.begin({ dbarkStartQueryTraffic() { throw Error('观测异常'); } })('completed', true);
    collector.begin({ dbarkStartQueryTraffic: () => () => ({ sent: 0, received: 0 }) })('failed', false);
    collector.begin({ dbarkStartQueryTraffic: () => () => ({ sent: 42, received: -1 }) })('failed', true);
    expect(collector.report.entries).toHaveLength(3);
    expect(collector.report.entries.every(entry => !entry.traffic)).toBe(true);
  });

  it('超过预算只统计未展示的已投递命令', () => {
    const collector = new MysqlQueryStatusCollector();
    let acquired = 0;
    const connection = { dbarkStartQueryTraffic: () => { acquired++; return () => ({ sent: 1, received: 0 }); } };
    for (let i = 0; i < mysqlQueryStatusLimit + 3; i++) collector.begin(connection)('completed', true);
    collector.begin(connection)('failed', false);
    expect(acquired).toBe(mysqlQueryStatusLimit);
    expect(collector.report.entries).toHaveLength(mysqlQueryStatusLimit);
    expect(collector.report.omitted).toBe(3);
  });
});
