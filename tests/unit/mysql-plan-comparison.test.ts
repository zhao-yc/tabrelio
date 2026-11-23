import { expect, it } from 'vitest';
import type { QueryOutcome } from '../../src/shared/contracts';
import { parseExplainPlan, type ExplainDialect } from '../../src/shared/explain';
import { capturePlanSnapshot, decodePlanSnapshot, encodePlanSnapshot } from '../../src/shared/explainSnapshot';
import { explainSnapshotZh as text } from '../../src/shared/explainSnapshot.zh-CN';
import { compareCurrentPlan, comparePlanSnapshots } from '../../src/shared/planSnapshotComparison';
import { parseQueryAnalyzePlan } from '../../src/shared/queryAnalyze';

function outcome(raw: string, dialect: ExplainDialect = 'mysql', analyzed = false, truncated = false): QueryOutcome {
  const version = dialect === 'mysql' ? '8.4.9' : '11.4.10-MariaDB';
  return { elapsedMs: 0, results: [{ columns: [{ key: 'c0', name: 'EXPLAIN', type: 'STRING' }],
    rows: [{ c0: raw }], elapsedMs: 0, statement: '', truncated }],
    ...(analyzed ? { analysis: parseQueryAnalyzePlan(raw, dialect, version, dialect === 'mysql' ? 'tree' : 'json', truncated) }
      : { explain: { ...parseExplainPlan(raw, dialect, version), rawTruncated: truncated } }),
  };
}

const capture = (...args: Parameters<typeof outcome>) => decodePlanSnapshot(encodePlanSnapshot(capturePlanSnapshot(outcome(...args))));

it('JSON 路径隔离子节点，按原精度对比字段并忽略对象键顺序', () => {
  const left = '{"query_block":{"nested_loop":[{"table":{"table_name":"订单","rows_examined_per_scan":9007199254740993,"cost_info":{"read_cost":"1.10","eval_cost":"0.10"}}}]}}';
  const right = '{"query_block":{"nested_loop":[{"table":{"cost_info":{"eval_cost":"0.10","read_cost":"1.10"},"table_name":"订单","rows_examined_per_scan":9007199254740994}},{"table":{"table_name":"商品"}}]}}';
  const result = comparePlanSnapshots(capture(left), capture(right));
  expect(result.different).toBe(2);
  expect(result.nodes.filter(node => node.status !== 'same')).toMatchObject([
    { path: '$/query_block/nested_loop/0/table', status: 'changed', fields: [{ name: 'rows_examined_per_scan', left: '9007199254740993', right: '9007199254740994' }] },
    { path: '$/query_block/nested_loop/1/table', status: 'added' },
  ]);
  expect(compareCurrentPlan(capture(left), outcome(right))).toEqual(result);
});

it('MariaDB 实测比较可读取未知层及服务器精确计时，同一字段按原路径显示', () => {
  const raw = '{"query_block":{"r_total_time_ms":0.0100,"扩展/项~":{"r_table_time_ms":0.0200}}}';
  const left = capture(raw, 'mariadb', true);
  const right = outcome(raw.replace('0.0200', '0.0201'), 'mariadb', true);
  expect(compareCurrentPlan(left, right)).toMatchObject({ different: 1 });
  expect(compareCurrentPlan(left, right).nodes.at(-1)).toMatchObject({
    path: '$/query_block/扩展~1项~0', status: 'changed', fields: [{ name: 'r_table_time_ms', left: '0.0200', right: '0.0201' }],
  });
  expect(() => comparePlanSnapshots(left, capture(raw, 'mariadb'))).toThrow(text.mysqlCompareUnsupported);
  expect(() => compareCurrentPlan(left, outcome(raw, 'mysql'))).toThrow(text.mysqlCompareUnsupported);
});

it('MySQL TREE 忽略原文行号，说明和原实测指标分别比较', () => {
  const root = '-> Filter: (id > 2)  (cost=1.10 rows=2) (actual time=0.010..0.021 rows=2 loops=1)';
  const child = '    -> Table scan on subject  (cost=0.012 rows=4) (never executed)';
  const left = capture(root + '\n' + child, 'mysql', true);
  const right = '\n' + root.replace('0.021', '0.022') + '\n\n' + child;
  const result = compareCurrentPlan(left, outcome(right, 'mysql', true));
  expect(result.nodes.map(node => [node.path, node.status])).toEqual([['1', 'changed'], ['1.1', 'same']]);
  expect(result.nodes[0].fields).toEqual([{ name: 'actual.last_row_time_ms', left: '0.021', right: '0.022' }]);
  expect(comparePlanSnapshots(left, capture(root, 'mysql', true)).nodes[1]).toMatchObject({
    status: 'removed', fields: expect.arrayContaining([{ name: text.compareNeverExecuted, left: text.compareYes, right: undefined }]),
  });
  expect(() => comparePlanSnapshots(left, capture(root + '\n不是可识别的计划行', 'mysql', true))).toThrow(text.compareIncomplete);
});

it('超出节点预算、关系路径过长及截断的结果不能作为完整比较', () => {
  const left = capture('{"query_block":{"table":{"table_name":"t"}}}');
  const oversized = JSON.stringify({ nested_loop: Array.from({ length: 300 }, () => ({ table: { table_name: 't' } })) });
  expect(() => compareCurrentPlan(left, outcome(oversized))).toThrow(text.compareIncomplete);
  expect(() => compareCurrentPlan(left, outcome(JSON.stringify({ ['路'.repeat(2050)]: { value: 1 } })))).toThrow(text.compareIncomplete);
  expect(() => comparePlanSnapshots(left, capture('{}'))).toThrow(text.compareIncomplete);
  expect(() => compareCurrentPlan(left, outcome('{"query_block":{}}', 'mysql', false, true))).toThrow(text.compareIncomplete);
  expect(() => comparePlanSnapshots(left, { ...left, result: { ...left.result, rows: [] } })).toThrow(text.compareIncomplete);
});
