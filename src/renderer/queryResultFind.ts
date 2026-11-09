import type { DataRow, ResultColumn } from '../shared/contracts';
import { cellPreview, ownCell } from './lib';
import { queryResultRegexLimits } from './queryResultRegexProtocol';
import type { QueryResultRegexWorkerClient } from './queryResultRegexWorkerClient';
import { tableFindPattern } from './tableFindPattern';

export const queryResultFindLimits = { queryUnits: 256, chunkUnits: 8192, batchUnits: 32768, batchCells: 256, hits: 5000 } as const;
export interface QueryResultFindMatch { readonly row: number; readonly column: number; }
type RegexFailure = 'regex-invalid' | 'regex-timeout' | 'regex-budget' | 'regex-worker';
export type QueryResultFindPhase = 'searching' | 'complete' | 'limited' | 'invalid' | 'stopped' | RegexFailure;
export type QueryResultFindMode = 'contains' | 'whole' | 'startsWith' | 'endsWith' | 'null' | 'empty' | 'regex';
export const isTextResultFind = (mode: QueryResultFindMode): boolean => mode !== 'null' && mode !== 'empty';
export interface QueryResultFindProgress { phase: QueryResultFindPhase; count: number; scannedCells: number; totalCells: number; }

/** 只保留当前原文本引用和有限坐标；不复制行、不转数值、不解码完整二进制、不发请求。 */
export class QueryResultFindScan {
  private readonly keys: string[];
  private readonly targetColumn: number | undefined;
  private readonly scanColumnCount: number;
  private readonly rowCount: number;
  private readonly rowIndices?: readonly number[];
  private readonly totalCells: number;
  private readonly needle: string;
  private readonly edge?: { pattern: RegExp; units: number };
  private readonly matches: QueryResultFindMatch[] = [];
  private readonly matchCells = new Set<number>();
  private cursor = 0;
  private offset = 0;
  private text: string | undefined;
  private phase: QueryResultFindPhase;
  constructor(private readonly rows: DataRow[], private readonly columns: ResultColumn[], query: string, private readonly caseSensitive: boolean, private readonly isCurrent: () => boolean, columnKey?: string, private readonly mode: QueryResultFindMode = 'contains', private readonly regex?: QueryResultRegexWorkerClient, rowIndices?: readonly number[]) {
    this.rowCount = rows.length; this.keys = columns.map(column => column.key);
    this.targetColumn = columnKey === undefined ? undefined : this.keys.indexOf(columnKey);
    this.scanColumnCount = this.targetColumn === undefined ? this.keys.length : this.targetColumn < 0 ? 0 : 1;
    this.rowIndices = rowIndices && [...rowIndices];
    this.totalCells = (this.rowIndices?.length ?? this.rowCount) * this.scanColumnCount;
    // 勾选范围必须有序且无重复；扫描位置映射回网格的原行索引。
    const invalidRows = this.rowIndices?.some((row, index, indices) => !Number.isSafeInteger(row) || row < 0 || row >= this.rowCount || index > 0 && row <= indices[index - 1]);
    const usesText = isTextResultFind(mode), invalid = usesText && query.length > queryResultFindLimits.queryUnits;
    this.needle = !usesText || invalid ? '' : mode === 'regex' || caseSensitive ? query : query.toLowerCase();
    if (!invalid && (mode === 'startsWith' || mode === 'endsWith')) {
      const pattern = tableFindPattern({ query, caseSensitive, wholeCell: false, edge: mode === 'startsWith' ? 'start' : 'end' });
      this.edge = { pattern, units: query.length + 1 };
    }
    this.phase = this.targetColumn === -1 || invalidRows ? 'stopped' : invalid ? 'invalid' : (!usesText || query) && this.totalCells ? 'searching' : 'complete';
  }
  /** 首次观察到归属失效即永久撤销，恢复相等引用也不能复活旧查找。 */
  current(): boolean {
    if (this.phase === 'stopped') return false;
    try { if (!this.isCurrent() || this.rows.length !== this.rowCount || this.columns.length !== this.keys.length || this.keys.some((key, index) => this.columns[index].key !== key)) { this.cancel(); return false; } }
    catch { this.cancel(); return false; }
    return true;
  }
  /** 释放正在扫描的原文本及全部命中坐标，不修改源结果或业务选择。 */
  cancel(): void { this.phase = 'stopped'; this.text = undefined; this.matches.length = 0; this.matchCells.clear(); this.regex?.dispose(); }
  progress(): QueryResultFindProgress { this.current(); return { phase: this.phase, count: this.matches.length, scannedCells: this.cursor, totalCells: this.totalCells }; }
  /** 每格一个命中，位置只在同一活代次有效；导航不能使用已撤销快照。 */
  match(index: number): QueryResultFindMatch | undefined { return this.current() && Number.isSafeInteger(index) && index >= 0 ? this.matches[index] : undefined; }
  /** 只有完整结果才能用于批量勾选；同一原行的多个匹配单元格只消费一次。 */
  matchingRows(): ReadonlySet<number> | undefined {
    if (!this.current() || this.phase !== 'complete') return;
    return new Set(this.matches.map(match => match.row));
  }
  /** 网格已核对扫描归属。仅按有界命中索引取样，每个渲染单元格无需重新检查列布局。 */
  hasMatch(row: number, column: number): boolean {
    return row >= 0 && row < this.rowCount && column >= 0 && column < this.keys.length &&
      this.matchCells.has(row * this.keys.length + column);
  }
  private position(cursor: number): QueryResultFindMatch {
    const row = Math.floor(cursor / this.scanColumnCount);
    return { row: this.rowIndices?.[row] ?? row, column: this.targetColumn ?? cursor % this.scanColumnCount };
  }
  private addMatch(row: number, column: number): void {
    this.matches.push({ row, column });
    this.matchCells.add(row * this.keys.length + column);
  }

  /** 正则接收完整单元格，才能保留首尾锚点及跨行语义。一次只复制一个有界批次。 */
  async stepRegex(): Promise<QueryResultFindProgress> {
    if (!this.current() || this.phase !== 'searching' || this.mode !== 'regex') return this.progress();
    if (!this.regex) return this.failRegex('regex-worker');
    const values: (string | null)[] = [], total = this.totalCells;
    let units = 0;
    try {
      for (let index = this.cursor; index < total && values.length < queryResultRegexLimits.batchCells; index++) {
        const { row, column } = this.position(index), value = ownCell(this.rows[row], this.keys[column]);
        const scalar = value == null || typeof value === 'object' ? null : String(value);
        const size = scalar?.length ?? 0;
        if (size > queryResultRegexLimits.valueUnits) return this.failRegex('regex-budget');
        if (values.length && units + size > queryResultFindLimits.batchUnits) break;
        units += size;
        values.push(scalar);
      }
      const result = await this.regex.run({ query: this.needle, caseSensitive: this.caseSensitive, values });
      if (!this.current()) return this.progress();
      if (result.status !== 'ready') return this.failRegex(result.status === 'cancelled' ? 'regex-worker' : `regex-${result.status}`);
      for (const hit of result.hits) {
        const { row, column } = this.position(this.cursor++);
        if (hit) this.addMatch(row, column);
        if (this.matches.length >= queryResultFindLimits.hits) break;
      }
      if (this.cursor === total) this.phase = 'complete';
      else if (this.matches.length >= queryResultFindLimits.hits) this.phase = 'limited';
      if (this.phase !== 'searching') this.regex.dispose();
      return this.progress();
    } catch { return this.failRegex('regex-worker'); }
  }

  private failRegex(phase: RegexFailure): QueryResultFindProgress {
    this.cancel();
    this.phase = phase;
    return this.progress();
  }
  /** 文本按原值分段，跨段重叠覆盖字面查询；每批字符/单元格均有硬上限。 */
  step(): QueryResultFindProgress {
    if (!this.current() || this.phase !== 'searching' || this.mode === 'regex') return this.progress();
    let units = 0, cells = 0;
    const total = this.totalCells;
    try {
      while (this.cursor < total && units < queryResultFindLimits.batchUnits && cells < queryResultFindLimits.batchCells) {
        if (!this.current()) break;
        // 扫描进度使用缩小后的范围，命中和高亮仍使用完整可见布局中的坐标。
        const { row, column } = this.position(this.cursor);
        const remaining = queryResultFindLimits.batchUnits - units;
        let found: boolean, complete = true;
        if (this.mode === 'contains') {
          if (this.text === undefined) {
            const value = ownCell(this.rows[row], this.keys[column]);
            // 默认模式沿用原显示语义和有界二进制预览。
            this.text = value && typeof value === 'object' ? cellPreview(value) : value === null ? 'NULL' : value === undefined ? '' : String(value);
          }
          // 余量不足时保留原offset，下一批接着处理原长值。
          if (Math.min(queryResultFindLimits.chunkUnits, this.text.length - this.offset) > remaining) break;
          const end = Math.min(this.text.length, this.offset + queryResultFindLimits.chunkUnits, this.offset + remaining);
          const piece = this.text.slice(this.offset, Math.min(this.text.length, end + this.needle.length));
          units += Math.max(1, end - this.offset);
          found = (this.caseSensitive ? piece : piece.toLowerCase()).includes(this.needle);
          complete = found || end === this.text.length;
          this.offset = end;
        } else {
          const value = ownCell(this.rows[row], this.keys[column]);
          if (this.edge) {
            const scalar = value == null || typeof value === 'object' ? '' : String(value);
            // 只检查原值的一端。多保留一个代码单元，避免在匹配边界拆开代理对。
            const size = Math.max(1, Math.min(scalar.length, this.edge.units));
            if (size > remaining) break;
            units += size;
            const piece = this.mode === 'startsWith' ? scalar.slice(0, size) : scalar.slice(-size);
            this.edge.pattern.lastIndex = 0;
            found = this.edge.pattern.test(piece);
          } else if (this.mode === 'whole') {
            // 整格只核对原标量。远长于搜索词的文本不折叠大小写，也不查二进制预览。
            const scalar = value == null || typeof value === 'object' ? undefined : String(value);
            const candidate = scalar !== undefined && scalar.length <= queryResultFindLimits.chunkUnits ? scalar : undefined;
            const size = Math.max(1, candidate?.length ?? 0);
            if (size > remaining) break;
            units += size;
            found = candidate !== undefined && (this.caseSensitive ? candidate : candidate.toLowerCase()) === this.needle;
          } else {
            units++;
            found = this.mode === 'null' ? value === null : value === '';
          }
        }
        if (found) this.addMatch(row, column);
        if (complete) { this.cursor++; cells++; this.offset = 0; this.text = undefined; }
        if (this.matches.length >= queryResultFindLimits.hits) {
          if (this.cursor < total) this.phase = 'limited';
          this.text = undefined;
          break;
        }
      }
      if (this.phase === 'searching' && this.cursor === total) this.phase = 'complete';
    } catch { this.cancel(); }
    return this.progress();
  }
}
