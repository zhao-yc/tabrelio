import type { QueryOutcome } from './contracts';
import type { PlanSnapshotDocument } from './explainSnapshot';
import { explainSnapshotZh as text } from './explainSnapshot.zh-CN';
import { comparePlanNodes, displayJsonPlanField, orderPlanField, type PlanComparison, type PlanComparisonSourceNode } from './planComparison';
import { visitPostgresPlans } from './postgresExplain';

/** 按原树路径收集节点自己的字段，子节点另成记录。 */
function sourceNodes(raw: string): Map<string, PlanComparisonSourceNode> {
  const nodes = new Map<string, PlanComparisonSourceNode>();
  const warnings = visitPostgresPlans(raw, (node, position, entry) => {
    const fields = new Map<string, string>();
    for (const [key, value] of Object.entries(node)) {
      if (key !== 'Plans') fields.set(key, JSON.stringify(orderPlanField(value)));
    }
    if (position.depth === 0) for (const key of ['Planning Time', 'Execution Time']) {
      if (Object.hasOwn(entry, key)) fields.set(key, JSON.stringify(entry[key]));
    }
    const label = [node['Node Type'], node['Relation Name'] ?? node['CTE Name'], node['Index Name']]
      .filter(value => typeof value === 'string').join(' · ').slice(0, 240).replace(/[\uD800-\uDBFF]$/, '');
    nodes.set(position.path, { depth: position.depth, label, fields });
  });
  if (warnings.length || !nodes.size) throw Error(text.compareIncomplete);
  return nodes;
}

/** 只有同类、完整的 PostgreSQL JSON 快照才能按结构位置比较。 */
export function comparePostgresPlanSnapshots(left: PlanSnapshotDocument, right: PlanSnapshotDocument): PlanComparison {
  if (left.kind !== right.kind || left.dialect !== 'postgresql' || right.dialect !== 'postgresql' ||
      left.format !== 'json' || right.format !== 'json') throw Error(text.compareUnsupported);
  if (left.rawTruncated || right.rawTruncated || left.result.truncated || right.result.truncated) throw Error(text.compareIncomplete);
  return comparePlanNodes(sourceNodes(left.raw), sourceNodes(right.raw), displayJsonPlanField);
}

/** 使用已返回的 JSON 对照同类基准。估算和实测指标分别比较。 */
export function compareCurrentPostgresPlan(baseline: PlanSnapshotDocument, outcome: QueryOutcome): PlanComparison {
  const current = outcome.analysis ?? outcome.explain;
  const kind = outcome.analysis ? 'dbark.analyze-snapshot' : 'dbark.explain-snapshot';
  if (baseline.kind !== kind || baseline.dialect !== 'postgresql' || baseline.format !== 'json' ||
      current?.dialect !== 'postgresql' || current.format !== 'json') throw Error(text.compareUnsupported);
  if (baseline.rawTruncated || baseline.result.truncated || current.rawTruncated ||
      outcome.results.length !== 1 || outcome.results[0].truncated) throw Error(text.compareIncomplete);
  return comparePlanNodes(sourceNodes(baseline.raw), sourceNodes(current.raw), displayJsonPlanField);
}
