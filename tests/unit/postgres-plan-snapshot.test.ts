import { describe, expect, it } from 'vitest';
import type { QueryOutcome } from '../../src/shared/contracts';
import { capturePlanSnapshot, decodePlanSnapshot, encodePlanSnapshot, planSnapshotOutcome } from '../../src/shared/explainSnapshot';
import { parsePostgresAnalyze, parsePostgresExplain } from '../../src/shared/postgresExplain';
import { compareCurrentPostgresPlan, comparePostgresPlanSnapshots } from '../../src/shared/postgresPlanComparison';

/** 使用 PostgreSQL 的单列回包形状构造可往返文件。 */
function originalOutcome(raw: string, mode: 'json' | 'text' | 'actual' = 'json', truncated = false): QueryOutcome {
  const result = { columns: [{ key: 'c0', name: 'QUERY PLAN', type: 'JSON' }],
    rows: raw ? (mode === 'text' ? raw.split('\n') : [raw]).map(c0 => ({ c0 })) : [],
    statement: '不进入文件的查询正文', elapsedMs: 17, truncated };
  return { results: [result], elapsedMs: 17, transactionOpen: true,
    ...(mode === 'actual' ? { analysis: parsePostgresAnalyze(raw, '18.6', truncated) }
      : { explain: parsePostgresExplain(raw, '18.6', mode, truncated) }) };
}
const capture = (...args: Parameters<typeof originalOutcome>) => capturePlanSnapshot(originalOutcome(...args));

describe('PostgreSQL 计划快照与离线比较', () => {
  const baseline = '[{"Plan":{"Node Type":"Seq Scan","Relation Name":"订单","Plan Rows":9007199254740993,"Total Cost":1.10}}]';
  it('估算、文本和实测往返保留实际指标，排除执行上下文', () => {
    for (const [raw, mode] of [[baseline, 'json'], ['Seq Scan\n  Filter: (id > 2)', 'text'],
      ['[{"Plan":{"Node Type":"Result","Actual Loops":1,"Actual Total Time":0.100}}]', 'actual']] as const) {
      const snapshot = capture(raw, mode);
      const saved = encodePlanSnapshot(snapshot);
      expect(saved).not.toContain('不进入文件的查询正文');
      expect(saved).not.toContain('transactionOpen');
      const outcome = planSnapshotOutcome(decodePlanSnapshot(saved));
      expect(outcome.results[0].statement).toBe('');
      expect((outcome.analysis ?? outcome.explain)?.raw).toBe(raw);
      if (mode === 'actual') expect(outcome.analysis?.nodes[0].metrics).toContainEqual({
        source: 'Actual Total Time', value: '0.100', kind: 'actual', unit: 'ms',
      });
    }
  });

  it('按路径比较原精度、节点新增和字段顺序，拒绝异类及截断快照', () => {
    const target = capture('[{"Plan":{"Total Cost":1.10,"Plan Rows":9007199254740994,"Relation Name":"订单","Node Type":"Seq Scan","Plans":[{"Node Type":"Result"}]}}]');
    const left = capture(baseline);
    expect(comparePostgresPlanSnapshots(left, target)).toMatchObject({ different: 2, nodes: [
      { path: '/0/Plan', status: 'changed', fields: [{ name: 'Plan Rows', left: '9007199254740993', right: '9007199254740994' }] },
      { path: '/0/Plan/Plans/0', status: 'added', left: undefined },
    ] });
    expect(comparePostgresPlanSnapshots(target, left).nodes[1].status).toBe('removed');
    expect(comparePostgresPlanSnapshots(left, capture('[{"Plan":{"Total Cost":1.10,"Plan Rows":9007199254740993,"Relation Name":"订单","Node Type":"Seq Scan"}}]')).different).toBe(0);
    expect(() => comparePostgresPlanSnapshots(left, capture(baseline, 'actual'))).toThrow('估算与实测分别比较');
    expect(() => comparePostgresPlanSnapshots(left, capture('', 'json', true))).toThrow('缺少完整节点');
    expect(() => decodePlanSnapshot(JSON.stringify({ ...left, raw: '伪造原文' }))).toThrow('格式无效');
  });

  it('实测计划比较包含节点和整条语句的实际时间', () => {
    const actual = (time: string) => capture('[{"Plan":{"Node Type":"Result","Actual Rows":1},"Execution Time":' + time + '}]', 'actual');
    expect(comparePostgresPlanSnapshots(actual('0.01'), actual('0.02')).nodes[0].fields).toEqual([
      { name: 'Execution Time', left: '0.01', right: '0.02' },
    ]);
  });

  it('当前估算 JSON 与已存估算逐字段比较，截断和文本结果无法对照', () => {
    const left = capture(baseline);
    const current = originalOutcome(baseline.replace('9007199254740993', '9007199254740994'));
    expect(compareCurrentPostgresPlan(left, current).nodes[0].fields).toEqual([
      { name: 'Plan Rows', left: '9007199254740993', right: '9007199254740994' },
    ]);
    expect(() => compareCurrentPostgresPlan(left, originalOutcome(baseline, 'json', true))).toThrow('缺少完整节点');
    expect(() => compareCurrentPostgresPlan(left, originalOutcome('Seq Scan', 'text'))).toThrow('估算与实测分别比较');
    expect(() => compareCurrentPostgresPlan(left, originalOutcome(baseline, 'actual'))).toThrow('估算与实测分别比较');
  });

  it('当前实测与实测基准保留精确的节点和整条语句耗时，排除估算基准', () => {
    const raw = '[{"Plan":{"Node Type":"Result","Actual Total Time":0.001},"Execution Time":0.002}]';
    const stored = capture(raw, 'actual');
    const current = originalOutcome(raw.replace('0.001', '0.0011').replace('0.002', '0.0022'), 'actual');
    expect(compareCurrentPostgresPlan(stored, current).nodes[0].fields).toEqual([
      { name: 'Actual Total Time', left: '0.001', right: '0.0011' },
      { name: 'Execution Time', left: '0.002', right: '0.0022' },
    ]);
    expect(() => compareCurrentPostgresPlan(capture(baseline), current)).toThrow('估算与实测分别比较');
    expect(() => compareCurrentPostgresPlan(stored, { ...current, results: [] })).toThrow('缺少完整节点');
  });
});
