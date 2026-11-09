import type { DataRow, ResultColumn } from '../shared/contracts';
import { cellPreview, ownCell } from './lib';

export const queryResultFindLimits = { queryUnits: 256, chunkUnits: 8192, batchUnits: 32768, batchCells: 256, hits: 5000 } as const;
export interface QueryResultFindMatch { readonly row: number; readonly column: number; }
export type QueryResultFindPhase = 'searching' | 'complete' | 'limited' | 'invalid' | 'stopped';
export type QueryResultFindMode = 'contains' | 'whole' | 'null' | 'empty';
export const isTextResultFind = (mode: QueryResultFindMode): boolean => mode === 'contains' || mode === 'whole';
export interface QueryResultFindProgress { phase: QueryResultFindPhase; count: number; scannedCells: number; totalCells: number; }

/** 只保留当前原文本引用和有限坐标；不复制行、不转数值、不解码完整二进制、不发请求。 */
export class QueryResultFindScan {
  private readonly keys: string[];
  private readonly targetColumn: number | undefined;
  private readonly scanColumnCount: number;
  private readonly rowCount: number;
  private readonly needle: string;
  private readonly matches: QueryResultFindMatch[] = [];
  private readonly matchCells = new Set<number>();
  private cursor = 0;
  private offset = 0;
  private text: string | undefined;
  private phase: QueryResultFindPhase;
  constructor(private readonly rows: DataRow[], private readonly columns: ResultColumn[], query: string, private readonly caseSensitive: boolean, private readonly isCurrent: () => boolean, columnKey?: string, private readonly mode: QueryResultFindMode = 'contains') {
    this.rowCount = rows.length; this.keys = columns.map(column => column.key);
    this.targetColumn = columnKey === undefined ? undefined : this.keys.indexOf(columnKey);
    this.scanColumnCount = this.targetColumn === undefined ? this.keys.length : this.targetColumn < 0 ? 0 : 1;
    const usesText = isTextResultFind(mode), invalid = usesText && query.length > queryResultFindLimits.queryUnits;
    this.needle = !usesText || invalid ? '' : caseSensitive ? query : query.toLowerCase();
    this.phase = this.targetColumn === -1 ? 'stopped' : invalid ? 'invalid' : (!usesText || query) && rows.length && this.scanColumnCount ? 'searching' : 'complete';
  }
  /** 首次观察到归属失效即永久撤销，恢复相等引用也不能复活旧查找。 */
  current(): boolean {
    if (this.phase === 'stopped') return false;
    try { if (!this.isCurrent() || this.rows.length !== this.rowCount || this.columns.length !== this.keys.length || this.keys.some((key, index) => this.columns[index].key !== key)) { this.cancel(); return false; } }
    catch { this.cancel(); return false; }
    return true;
  }
  /** 释放正在扫描的原文本及全部命中坐标，不修改源结果或业务选择。 */
  cancel(): void { this.phase = 'stopped'; this.text = undefined; this.matches.length = 0; this.matchCells.clear(); }
  progress(): QueryResultFindProgress { this.current(); return { phase: this.phase, count: this.matches.length, scannedCells: this.cursor, totalCells: this.rowCount * this.scanColumnCount }; }
  /** 每格一个命中，位置只在同一活代次有效；导航不能使用已撤销快照。 */
  match(index: number): QueryResultFindMatch | undefined { return this.current() && Number.isSafeInteger(index) && index >= 0 ? this.matches[index] : undefined; }
  /** 网格已核对扫描归属。仅按有界命中索引取样，每个渲染单元格无需重新检查列布局。 */
  hasMatch(row: number, column: number): boolean {
    return row >= 0 && row < this.rowCount && column >= 0 && column < this.keys.length &&
      this.matchCells.has(row * this.keys.length + column);
  }
  /** 文本按原值分段，跨段重叠覆盖字面查询；每批字符/单元格均有硬上限。 */
  step(): QueryResultFindProgress {
    if (!this.current() || this.phase !== 'searching') return this.progress();
    let units = 0, cells = 0;
    const total = this.rowCount * this.scanColumnCount;
    try {
      while (this.cursor < total && units < queryResultFindLimits.batchUnits && cells < queryResultFindLimits.batchCells) {
        if (!this.current()) break;
        // 扫描进度使用缩小后的范围，命中和高亮仍使用完整可见布局中的坐标。
        const row = Math.floor(this.cursor / this.scanColumnCount), column = this.targetColumn ?? this.cursor % this.scanColumnCount;
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
          if (this.mode === 'whole') {
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
        if (found) {
          this.matches.push({ row, column });
          this.matchCells.add(row * this.keys.length + column);
        }
        if (complete) { this.cursor++; cells++; this.offset = 0; this.text = undefined; }
        if (this.matches.length >= queryResultFindLimits.hits) { this.phase = 'limited'; this.text = undefined; break; }
      }
      if (this.phase === 'searching' && this.cursor === total) this.phase = 'complete';
    } catch { this.cancel(); }
    return this.progress();
  }
}
