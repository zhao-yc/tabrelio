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

/** 完整字段值决定差异，只有显示值和每节点展开的字段数受呈现预算约束。 */
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
    let changedFields = 0;
    for (const name of new Set([...(a?.fields.keys() ?? []), ...(b?.fields.keys() ?? [])])) {
      const original = a?.fields.get(name), target = b?.fields.get(name);
      if (original === target) continue;
      changedFields++;
      if (fields.length < 80) fields.push({ name, left: display(original), right: display(target) });
    }
    const status = !a ? 'added' : !b ? 'removed' : changedFields ? 'changed' : 'same';
    if (status !== 'same') different++;
    nodes.push({ path, depth: (a ?? b)!.depth, left: a?.label, right: b?.label, status, fields, changedFields });
  }
  return { nodes, different };
}
