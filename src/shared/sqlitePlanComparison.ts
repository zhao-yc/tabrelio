import { planSnapshotOutcome, type PlanSnapshotDocument, type SqliteExplainSnapshotDocument } from './explainSnapshot';
import { explainSnapshotZh as text } from './explainSnapshot.zh-CN';
import { comparePlanNodes, type PlanComparison, type PlanComparisonSourceNode } from './planComparison';

const pathOrder = new Intl.Collator('en', { numeric: true });

/** EQP 编号只用于重建文件内的父子关系，跨文件按原树中的同级位置对齐。 */
function sourceNodes(snapshot: SqliteExplainSnapshotDocument): Map<string, PlanComparisonSourceNode> {
  const nodes = planSnapshotOutcome(snapshot).sqliteExplain?.nodes;
  if (!nodes?.length) throw Error(text.compareIncomplete);
  const positions: number[] = [];
  const source = new Map<string, PlanComparisonSourceNode>();
  for (const { depth, detail } of nodes) {
    positions.length = depth + 1;
    positions[depth] = (positions[depth] ?? 0) + 1;
    const label = detail.length <= 240 ? detail : detail.slice(0, 240).replace(/[\uD800-\uDBFF]$/, '') + '…';
    source.set(positions.join('.'), { depth, label, fields: new Map([['detail', detail]]) });
  }
  return source;
}

/** 比较完整的 SQLite EQP 关系树，使用快照中的原始节点说明。 */
export function compareSqlitePlanSnapshots(left: PlanSnapshotDocument, right: PlanSnapshotDocument): PlanComparison {
  if (left.kind !== 'dbark.sqlite-explain-snapshot' || right.kind !== 'dbark.sqlite-explain-snapshot') throw Error(text.sqliteCompareUnsupported);
  return comparePlanNodes(sourceNodes(left), sourceNodes(right), value => value, pathOrder.compare);
}
