import type { QueryOutcome } from './contracts';
import type { PlanSnapshotDocument } from './explainSnapshot';
import { explainSnapshotZh as text } from './explainSnapshot.zh-CN';
import { explainNodeLimitWarning, parseExplainPlan, planValueAtPath, readExplainJson, type ExplainDialect } from './explain';
import { comparePlanNodes, readJsonPlanField, orderPlanField, ordinalPlanPaths, ordinalPlanPathOrder, type PlanComparison, type PlanComparisonSourceNode } from './planComparison';
import { parseQueryAnalyzePlan } from './queryAnalyze';

/** JSON 节点只比较自己的字段，子树在其自身路径上单独计入差异。 */
function jsonNodes(raw: string, dialect: ExplainDialect, version: string): Map<string, PlanComparisonSourceNode> {
  const plan = parseExplainPlan(raw, dialect, version);
  if (!plan.nodes.length || plan.warnings.includes(explainNodeLimitWarning) || plan.nodes.some(node => node.pathTruncated))
    throw Error(text.compareIncomplete);
  const document = readExplainJson(raw);
  if (!document || typeof document !== 'object' || !Object.keys(document).length) throw Error(text.compareIncomplete);
  const nodePaths = new Map(plan.nodes.map(node => [node.id, node.path]));
  const childKeys = new Map<string, Set<string>>();
  for (const node of plan.nodes) {
    if (node.parent === undefined) continue;
    const relative = node.path.slice(nodePaths.get(node.parent)!.length + 1);
    const key = relative.split('/', 1)[0].replaceAll('~1', '/').replaceAll('~0', '~');
    const keys = childKeys.get(node.parent) ?? new Set<string>();
    keys.add(key); childKeys.set(node.parent, keys);
  }
  const source = new Map<string, PlanComparisonSourceNode>();
  for (const node of plan.nodes) {
    const value = planValueAtPath(document, node.path);
    const entries: [string, unknown][] = value && typeof value === 'object' ? Object.entries(value) : [['value', value]];
    const fields = new Map<string, string>();
    for (const [key, member] of entries) {
      if (!childKeys.get(node.id)?.has(key)) fields.set(key, JSON.stringify(orderPlanField(member)));
    }
    const label = [node.kind, node.name, node.index].filter(Boolean).join(' · ');
    source.set('$' + node.path, { depth: node.depth, label, fields });
  }
  return source;
}

/** MySQL TREE 依赖解析器确认完整层级和原指标，行号变化不影响节点对齐。 */
function treeNodes(raw: string, version: string): Map<string, PlanComparisonSourceNode> {
  const plan = parseQueryAnalyzePlan(raw, 'mysql', version, 'tree');
  if (!plan.nodes.length || plan.warnings.length) throw Error(text.compareIncomplete);
  const source = new Map<string, PlanComparisonSourceNode>();
  ordinalPlanPaths(plan.nodes, (path, node) => {
    const fields = new Map(node.metrics.map(metric => [metric.source, metric.value]));
    fields.set(text.compareDescription, node.label);
    if (node.neverExecuted) fields.set(text.compareNeverExecuted, text.compareYes);
    source.set(path, { depth: node.depth, label: node.label, fields });
  });
  return source;
}

type RawPlan = { raw: string; version: string };
type RawPlanResult = PlanSnapshotDocument['result'] | QueryOutcome['results'][number];

/** 旧快照也能打开，进入比较时原文须对应完整的单格数据库回包。 */
function completeResult(raw: string, result?: RawPlanResult): boolean {
  return !!result && !result.truncated && result.columns.length === 1 && result.rows.length === 1 &&
    Object.getOwnPropertyDescriptor(result.rows[0], result.columns[0].key)?.value === raw;
}

function compareRaw(left: RawPlan, right: RawPlan, dialect: ExplainDialect, format: 'json' | 'tree'): PlanComparison {
  if (format === 'tree') return comparePlanNodes(treeNodes(left.raw, left.version), treeNodes(right.raw, right.version), value => value, ordinalPlanPathOrder);
  return comparePlanNodes(jsonNodes(left.raw, dialect, left.version), jsonNodes(right.raw, dialect, right.version), readJsonPlanField);
}

/** 两种服务端的指标含义不同，且估算、实测与文本格式分别校验。 */
export function compareMysqlPlanSnapshots(left: PlanSnapshotDocument, right: PlanSnapshotDocument): PlanComparison {
  if ((left.dialect !== 'mysql' && left.dialect !== 'mariadb') || right.dialect !== left.dialect || left.kind !== right.kind ||
      left.format === 'text' || right.format !== left.format) throw Error(text.mysqlCompareUnsupported);
  if (left.rawTruncated || right.rawTruncated || !completeResult(left.raw, left.result) || !completeResult(right.raw, right.result))
    throw Error(text.compareIncomplete);
  return compareRaw({ raw: left.raw, version: left.serverVersion }, { raw: right.raw, version: right.serverVersion }, left.dialect, left.format);
}

/** 当前回包直接与已保存的同类基准比较，无需复制或保存查询结果。 */
export function compareCurrentMysqlPlan(baseline: PlanSnapshotDocument, outcome: QueryOutcome): PlanComparison {
  const current = outcome.analysis ?? outcome.explain;
  const kind = outcome.analysis ? 'dbark.analyze-snapshot' : 'dbark.explain-snapshot';
  if ((baseline.dialect !== 'mysql' && baseline.dialect !== 'mariadb') || baseline.kind !== kind ||
      baseline.format === 'text' || current?.dialect !== baseline.dialect || current.format !== baseline.format) throw Error(text.mysqlCompareUnsupported);
  if (baseline.rawTruncated || current.rawTruncated || !completeResult(baseline.raw, baseline.result) ||
      outcome.results.length !== 1 || !completeResult(current.raw, outcome.results[0]))
    throw Error(text.compareIncomplete);
  return compareRaw({ raw: baseline.raw, version: baseline.serverVersion }, current, baseline.dialect, baseline.format);
}
