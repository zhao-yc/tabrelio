import { planSnapshotOutcome, type PlanSnapshotDocument, type SqliteExplainSnapshotDocument } from './explainSnapshot';
import { explainSnapshotZh as text } from './explainSnapshot.zh-CN';
import { comparePlanNodes, ordinalPlanPaths, ordinalPlanPathOrder, type PlanComparison, type PlanComparisonSourceNode } from './planComparison';
import type { SqliteExplainPlan } from './sqliteExplain';

/** EQP 编号只用于重建文件内的父子关系，跨文件按原树中的同级位置对齐。 */
function sourceNodes(plan?: SqliteExplainPlan): Map<string, PlanComparisonSourceNode> {
  const nodes = plan?.nodes;
  if (!nodes?.length) throw Error(text.compareIncomplete);
  const source = new Map<string, PlanComparisonSourceNode>();
  ordinalPlanPaths(nodes, (path, { depth, detail }) => {
    const label = detail.length <= 240 ? detail : detail.slice(0, 240).replace(/[\uD800-\uDBFF]$/, '') + '…';
    source.set(path, { depth, label, fields: new Map([['detail', detail]]) });
  });
  return source;
}

function snapshotNodes(snapshot: SqliteExplainSnapshotDocument): Map<string, PlanComparisonSourceNode> {
  return sourceNodes(planSnapshotOutcome(snapshot).sqliteExplain);
}

/** 比较完整的 SQLite EQP 关系树，使用快照中的原始节点说明。 */
export function compareSqlitePlanSnapshots(left: PlanSnapshotDocument, right: PlanSnapshotDocument): PlanComparison {
  if (left.kind !== 'dbark.sqlite-explain-snapshot' || right.kind !== 'dbark.sqlite-explain-snapshot') throw Error(text.sqliteCompareUnsupported);
  return comparePlanNodes(snapshotNodes(left), snapshotNodes(right), value => value, ordinalPlanPathOrder);
}

/** 当前计划已由驱动回包生成，直接比较其节点，不受快照文件的编码预算约束。 */
export function compareCurrentSqlitePlan(baseline: PlanSnapshotDocument, current: SqliteExplainPlan): PlanComparison {
  if (baseline.kind !== 'dbark.sqlite-explain-snapshot') throw Error(text.sqliteCompareBaselineRequired);
  return comparePlanNodes(snapshotNodes(baseline), sourceNodes(current), value => value, ordinalPlanPathOrder);
}
