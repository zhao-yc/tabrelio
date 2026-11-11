/** 先按整数四舍五入再显示，避免大计数转成 Number 后丢失低位。 */
export function statisticsPercentage(count: string | number, total: string | number): string {
  const denominator = BigInt(total);
  if (denominator === 0n) return '—';
  const basis = (BigInt(count) * 10000n + denominator / 2n) / denominator;
  return `${basis / 100n}.${String(basis % 100n).padStart(2, '0')}%`;
}
