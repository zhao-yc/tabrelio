import { queryAnalyzeLimits, type QueryAnalyzeNode, type QueryAnalyzePlan } from './queryAnalyze';

interface Decimal { units: bigint; scale: number; }
export interface AnalyzeRowComparison {
  node: QueryAnalyzeNode;
  estimate: string;
  actual: string;
  delta: string;
}

/** 行数沿服务器原字符串计算。指数仅用于对齐小数点，限制不可信快照的展开规模。 */
function nonnegativeDecimal(value?: string): Decimal | undefined {
  if (value === undefined || value.length > queryAnalyzeLimits.metricValue) return;
  const match = /^\+?(\d+(?:\.\d*)?|\.\d+)(?:e([+-]?\d+))?$/i.exec(value);
  if (!match) return;
  const exponent = Number(match[2] ?? 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 512) return;
  const [whole, fraction = ''] = match[1].split('.');
  return { units: BigInt(whole + fraction), scale: fraction.length - exponent };
}

function atScale(value: Decimal, scale: number): bigint {
  return value.units * 10n ** BigInt(scale - value.scale);
}

function displayDelta({ units, scale }: Decimal): string {
  if (units === 0n) return '0';
  const digits = (units < 0n ? -units : units).toString().padStart(scale + 1, '0');
  const text = scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/0+$/, '').replace(/\.$/, '') : digits;
  return (units < 0n ? '-' : '+') + text;
}

/** 按同一节点、同一口径配对。循环为零或缺少实测证据时，不把空值当成零行。 */
export function queryAnalyzeRowComparisons(plan: QueryAnalyzePlan): AnalyzeRowComparison[] {
  if (plan.rawTruncated) return [];
  const postgres = plan.dialect === 'postgresql';
  const estimateSource = postgres ? 'Plan Rows' : 'rows';
  const loopSource = postgres ? 'Actual Loops' : plan.dialect === 'mysql' ? 'actual.loops' : 'r_loops';
  const rows = plan.nodes.flatMap(node => {
    if (node.neverExecuted) return [];
    const actualSource = postgres ? 'Actual Rows' : plan.dialect === 'mysql' ? 'actual.rows' : node.comparableReadRows;
    if (!actualSource) return [];
    const loops = nonnegativeDecimal(node.metrics.find(metric => metric.source === loopSource && metric.kind === 'actual' && metric.unit === 'loops')?.value);
    if (!loops || loops.units === 0n) return [];
    const estimate = node.metrics.find(metric => metric.source === estimateSource && metric.kind === 'estimate' && metric.unit === 'rows');
    const actual = node.metrics.find(metric => metric.source === actualSource && metric.kind === 'actual' && metric.unit === 'rows');
    if (!estimate || !actual) return [];
    const expected = nonnegativeDecimal(estimate.value), observed = nonnegativeDecimal(actual.value);
    if (!expected || !observed) return [];
    const scale = Math.max(expected.scale, observed.scale, 0);
    const units = atScale(observed, scale) - atScale(expected, scale);
    return [{ node, estimate: estimate.value, actual: actual.value, delta: displayDelta({ units, scale }),
      magnitude: { units: units < 0n ? -units : units, scale } }];
  });
  return rows.sort((left, right) => {
    const scale = Math.max(left.magnitude.scale, right.magnitude.scale);
    const a = atScale(left.magnitude, scale), b = atScale(right.magnitude, scale);
    return a === b ? 0 : a > b ? -1 : 1;
  }).map(({ magnitude, ...row }) => row);
}
