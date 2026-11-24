interface ComparedField { name: string; left?: string; right?: string; }
interface ComparedNode {
  path: string;
  depth: number;
  left?: string;
  right?: string;
  status: 'added' | 'removed' | 'changed' | 'same';
  fields: ComparedField[];
  changedFields: number;
}
export interface PlanComparison { nodes: ComparedNode[]; different: number; }
export interface PlanComparisonSourceNode { depth: number; label: string; fields: Map<string, string>; }

/** 对象键顺序不构成变化，数组顺序和精确数值文本参与比较。 */
export function orderPlanField(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(orderPlanField);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, child]) => [key, orderPlanField(child)]));
}

/** 保留字段的完整文本，包括解析器保存的精确数值。界面负责预览截断。 */
export function readJsonPlanField(value?: string): string | undefined {
  if (value === undefined) return;
  const decoded: unknown = JSON.parse(value);
  return typeof decoded === 'string' ? decoded : value;
}

/** 按原树的先序深度推导同级位置，避免依赖源文件编号或行号。 */
export function ordinalPlanPaths<T extends { depth: number }>(nodes: T[], visit: (path: string, node: T) => void): void {
  const positions: number[] = [];
  for (const node of nodes) {
    positions.length = node.depth + 1;
    positions[node.depth] = (positions[node.depth] ?? 0) + 1;
    visit(positions.join('.'), node);
  }
}

export const ordinalPlanPathOrder = new Intl.Collator('en', { numeric: true }).compare;

/** 保留完整字段差异。比较只纳入解析器确认的原节点和字段。 */
export function comparePlanNodes(
  before: Map<string, PlanComparisonSourceNode>,
  after: Map<string, PlanComparisonSourceNode>,
  display: (value?: string) => string | undefined,
  sortPaths?: (left: string, right: string) => number,
): PlanComparison {
  const paths = [...new Set([...before.keys(), ...after.keys()])];
  if (sortPaths) paths.sort(sortPaths);
  const nodes: ComparedNode[] = [];
  let different = 0;
  for (const path of paths) {
    const a = before.get(path), b = after.get(path);
    const fields: ComparedField[] = [];
    for (const name of new Set([...(a?.fields.keys() ?? []), ...(b?.fields.keys() ?? [])])) {
      const original = a?.fields.get(name), target = b?.fields.get(name);
      if (original === target) continue;
      fields.push({ name, left: display(original), right: display(target) });
    }
    const changedFields = fields.length;
    const status = !a ? 'added' : !b ? 'removed' : changedFields ? 'changed' : 'same';
    if (status !== 'same') different++;
    nodes.push({ path, depth: (a ?? b)!.depth, left: a?.label, right: b?.label, status, fields, changedFields });
  }
  return { nodes, different };
}
