import type { TableHistogramRange, TableHistogramRequest } from '../shared/tableHistogram';

export const queryResultHistogramBins = [5, 10, 20] as const;
export type QueryResultHistogramBins = TableHistogramRequest['bins'];
export interface QueryResultHistogram {
  column: string;
  requestedBins: QueryResultHistogramBins;
  approximate: boolean;
  finite: string;
  nonFinite: string;
  nonNumeric: string;
  nulls: string;
  ranges: TableHistogramRange[];
}
interface Decimal { coefficient: bigint; scale: number }

/** 第一遍收集已验证的有限值并统一极值尺度，第二遍分批计数；始终不使用浮点边界。 */
export class QueryResultHistogramCounter {
  private readonly values: Decimal[] = [];
  private min = 0n;
  private max = 0n;
  private scale = 0;
  private edges?: bigint[];
  private counts: number[] = [];
  processed = 0;

  constructor(private readonly bins: QueryResultHistogramBins) {}

  get size(): number { return this.values.length; }

  add(value: Decimal): void {
    if (!this.size) {
      this.min = this.max = value.coefficient;
      this.scale = value.scale;
    } else {
      if (value.scale > this.scale) {
        const factor = 10n ** BigInt(value.scale - this.scale);
        this.min *= factor;
        this.max *= factor;
        this.scale = value.scale;
      }
      const units = value.coefficient * 10n ** BigInt(this.scale - value.scale);
      if (units < this.min) this.min = units;
      if (units > this.max) this.max = units;
    }
    this.values.push(value);
  }

  /** 区间左闭右开，最后一段包含最大值。向上量化后移除重复起点，保留最大值所在段。 */
  step(): boolean {
    if (!this.size) return true;
    if (!this.edges) {
      const starts = [this.min];
      const span = this.max - this.min, bins = BigInt(this.bins);
      for (let index = 1; index < this.bins; index++) {
        const bound = this.min + (span * BigInt(index) + bins - 1n) / bins;
        if (bound > starts.at(-1)!) starts.push(bound);
      }
      this.counts = starts.map(() => 0);
      this.edges = starts;
    }
    const end = Math.min(this.size, this.processed + 128);
    for (; this.processed < end; this.processed++) {
      const value = this.values[this.processed];
      const units = value.coefficient * 10n ** BigInt(this.scale - value.scale);
      let bucket = this.edges.length - 1;
      while (units < this.edges[bucket]) bucket--;
      this.counts[bucket]++;
    }
    return this.processed === this.size;
  }

  /** 调用方只在完整计数并再次核验原结果身份后发布。 */
  ranges(format: (units: bigint, scale: number) => string): TableHistogramRange[] {
    const starts = this.edges ?? [];
    return starts.map((lower, index) => ({
      lower: format(lower, this.scale),
      upper: format(starts[index + 1] ?? this.max, this.scale),
      upperInclusive: index === starts.length - 1,
      count: String(this.counts[index]),
    }));
  }

  clear(): void {
    this.values.length = 0;
    this.edges = undefined;
    this.counts = [];
  }
}
