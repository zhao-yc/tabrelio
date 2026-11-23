import type { PlanSnapshotDocument } from './explainSnapshot';
import { explainSnapshotZh as text } from './explainSnapshot.zh-CN';
import { comparePlanNodes, type PlanComparison, type PlanComparisonSourceNode } from './planComparison';
import { visitPostgresPlans } from './postgresExplain';

/** 对象字段顺序不参与比较，数组顺序和原数值文本保留。 */
function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, child]) => [key, ordered(child)]));
}

/** 按原树路径收集节点自己的字段，子节点另成记录。 */
function sourceNodes(raw: string): Map<string, PlanComparisonSourceNode> {
  const nodes = new Map<string, PlanComparisonSourceNode>();
  const warnings = visitPostgresPlans(raw, (node, position, entry) => {
    const fields = new Map<string, string>();
    for (const [key, value] of Object.entries(node)) {
      if (key !== 'Plans') fields.set(key, JSON.stringify(ordered(value)));
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

/** 差异比较使用完整字节派生值，只对呈现给用户的文本截断。 */
function display(value?: string): string | undefined {
  if (value === undefined) return;
  const decoded: unknown = JSON.parse(value);
  const raw = typeof decoded === 'string' ? decoded : value;
  return raw.length <= 1800 ? raw : raw.slice(0, 1800).replace(/[\uD800-\uDBFF]$/, '') + '…';
}

/** 只有同类、完整的 PostgreSQL JSON 快照才能按结构位置比较。 */
export function comparePostgresPlanSnapshots(left: PlanSnapshotDocument, right: PlanSnapshotDocument): PlanComparison {
  if (left.kind !== right.kind || left.dialect !== 'postgresql' || right.dialect !== 'postgresql' ||
      left.format !== 'json' || right.format !== 'json') throw Error(text.compareUnsupported);
  if (left.rawTruncated || right.rawTruncated || left.result.truncated || right.result.truncated) throw Error(text.compareIncomplete);
  return comparePlanNodes(sourceNodes(left.raw), sourceNodes(right.raw), display);
}
