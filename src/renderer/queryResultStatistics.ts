import type { CellValue, DataRow, QueryResult, ResultColumn } from '../shared/contracts';
import { compareQueryResultFilterKeys, queryResultFilterKey, queryResultSortKind, queryResultSortLimits, type SortDialect } from './queryResultSort';
import { queryResultStatisticsZh as text } from './locales/queryResultStatistics.zh-CN';
import { captureSqliteResultFilterSource, type SqliteResultFilterSource } from './sqliteResultFilterSource';
import { compareSqliteResultKeys, sqliteResultComparisonKey, type SqliteResultComparisonKey } from './sqliteResultCompare';
import { QueryResultFrequencyCounter, queryResultFrequencyRow, type QueryResultFrequency, type QueryResultFrequencyEntry, type QueryResultFrequencyKind } from './queryResultFrequency';
import { captureQueryResultCellFilter, queryResultCellFilterRule } from './queryResultCellFilter';
import { queryResultFilterLimits, type QueryResultFilterGroup, type QueryResultFilterRule } from './queryResultFilter';
import { sqliteResultCellMatches } from '../shared/sqliteResultStorage';
import { QueryResultHistogramCounter, type QueryResultHistogram, type QueryResultHistogramBins } from './queryResultHistogram';

export interface QueryResultStatisticsCapture {
  readonly column: Readonly<ResultColumn>;
  readonly rowCount: number;
  readonly selected: boolean;
}
export interface QueryResultStatisticsResult {
  readonly count: number; readonly nonNull: number; readonly nulls: number;
  readonly distinct?: number; readonly min?: string; readonly max?: string; readonly sum?: string; readonly average?: string;
  readonly standardDeviation?: string; readonly standardDeviationRounded?: true;
  readonly approximate: boolean; readonly floatInput: boolean; readonly averageRounded: boolean; readonly reason?: string;
  readonly sqliteTypes?: Readonly<Record<'integer' | 'real' | 'text' | 'blob' | 'null', number>>;
  readonly frequency?: QueryResultFrequency;
  readonly quality?: Readonly<{ emptyText: number; singletons: number }>;
  readonly histogram?: QueryResultHistogram;
}
type OrdinaryKey = ReturnType<typeof queryResultFilterKey>;
type Key = OrdinaryKey | SqliteResultComparisonKey;
interface ValueStamp { value: unknown; units: number; prototype?: object | null; fields?: readonly (readonly [PropertyKey, unknown])[]; }
interface StatisticsSource {
  columns: readonly ResultColumn[]; rows: readonly DataRow[]; columnRefs: readonly ResultColumn[]; metadata: readonly ResultColumn[];
  rowRefs: readonly DataRow[]; indices: readonly number[]; selection?: ReadonlySet<number>;
  sqlite?: SqliteResultFilterSource;
  dialect?: SortDialect;
}
interface Binding extends StatisticsSource { values: readonly ValueStamp[]; invalid: boolean; }
const bindings = new WeakMap<QueryResultStatisticsCapture, Binding>();
const frequencyOwners = new WeakMap<QueryResultFrequency, { capture: QueryResultStatisticsCapture; hasNull: boolean }>();
const setSize = Object.getOwnPropertyDescriptor(Set.prototype, 'size')!.get!;

/** 百分比以当前统计范围的行数为分母；无行时比例没有定义。 */
export function queryResultPercentage(count: number, total: number): string {
  if (!total) return text.unavailable;
  const basis = Math.floor((count * 10000 + total / 2) / total);
  return `${Math.floor(basis / 100)}.${String(basis % 100).padStart(2, '0')}%`;
}

/** 自有数据描述符是唯一读取入口，原数组、行、元数据及字节对象上的访问器均不执行。 */
function own(value: unknown, key: PropertyKey): unknown {
  if (!value || typeof value !== 'object') throw Error(text.invalid);
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !('value' in descriptor)) throw Error(text.invalid);
  return descriptor.value;
}
/** 有界检查每个数组索引，不能用迭代器跳过稀疏项或执行自定义读取。 */
function array<T>(value: readonly T[], limit: number, minimum = 0): T[] {
  if (!Array.isArray(value)) throw Error(text.invalid);
  const length = own(value, 'length');
  if (!Number.isSafeInteger(length) || (length as number) < minimum) throw Error(text.invalid);
  if ((length as number) > limit) throw Error(text.budget);
  const result: T[] = [];
  for (let index = 0; index < (length as number); index++) result.push(own(value, String(index)) as T);
  return result;
}
/** 内置Set端口保留选择对象身份，显示索引排序，不调用外部size或迭代器。 */
function positions(selection: ReadonlySet<number>, length: number): number[] {
  let size: number;
  try { size = setSize.call(selection); } catch { throw Error(text.invalid); }
  if (!Number.isSafeInteger(size) || size < 1) throw Error(text.invalid);
  if (size > length || size > queryResultSortLimits.rows) throw Error(text.budget);
  const result: number[] = [];
  for (const index of Set.prototype.values.call(selection) as IterableIterator<number>) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= length) throw Error(text.invalid);
    result.push(index);
  }
  return result.sort((left, right) => left - right);
}
/** 重复显示名合法，内部key必须唯一，所有列的完整元数据都参与来源身份。 */
function metadata(column: ResultColumn): ResultColumn {
  const key = own(column, 'key'), name = own(column, 'name'), type = own(column, 'type');
  if (typeof key !== 'string' || !key || typeof name !== 'string' || typeof type !== 'string') throw Error(text.invalid);
  if (key.length > 4096 || name.length > 4096 || type.length > 4096) throw Error(text.budget);
  return Object.freeze({ key, name, type });
}
/** 不序列化未知对象；字节及坏协议对象只留有界浅身份，不能触发getter或递归。 */
function stamp(value: unknown, charge: (units: number) => void): ValueStamp {
  let units = 0;
  const count = (length: number) => { charge(length); units += length; };
  if (typeof value === 'string') count(value.length);
  else count(1);
  if (!value || typeof value !== 'object') return { value, units };
  const keys = Reflect.ownKeys(value);
  if (keys.length > 16) throw Error(text.budget);
  const fields = keys.map(key => {
    const field = own(value, key);
    if (typeof field === 'string') count(field.length);
    return Object.freeze([key, field] as const);
  });
  if (units > 32768) throw Error(text.budget);
  return { value, units, prototype: Object.getPrototypeOf(value), fields };
}
/** 原值对象的字段变化也撤销统计，不把同一字节引用视为内容恒定。 */
function sameValue(value: unknown, before: ValueStamp): boolean {
  if (!Object.is(value, before.value)) return false;
  if (!before.fields) return true;
  const keys = Reflect.ownKeys(value as object);
  return Object.getPrototypeOf(value) === before.prototype && keys.length === before.fields.length && before.fields.every(([key, field], index) => keys[index] === key && Object.is(own(value, key), field));
}

/** 多列扫描共享原行列身份、选择及 SQLite 存储代码，避免为每列重复保存元数据。 */
function statisticsSource(columns: readonly ResultColumn[], rows: readonly DataRow[], indices?: ReadonlySet<number>, sqliteSource?: QueryResult, dialect?: SortDialect): StatisticsSource {
  const columnRefs = array(columns, queryResultSortLimits.columns, 1), rowRefs = array(rows, queryResultSortLimits.rows);
  const descriptions = columnRefs.map(metadata);
  if (new Set(descriptions.map(item => item.key)).size !== columnRefs.length || new Set(rowRefs).size !== rowRefs.length || rowRefs.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw Error(text.invalid);
  return {
    columns, rows, columnRefs, metadata: descriptions, rowRefs,
    indices: indices === undefined ? rowRefs.map((_, index) => index) : positions(indices, rowRefs.length),
    selection: indices, sqlite: sqliteSource ? captureSqliteResultFilterSource(sqliteSource, columns, rows) : undefined, dialect,
  };
}
/** 按值核算原文预算；概览为全部列共用同一个预算。 */
function statisticsBudget(message: string) {
  let units = 0;
  return (length: number) => {
    if (length > queryResultSortLimits.valueUnits) throw Error(message);
    units += length;
    if (units > queryResultSortLimits.units) throw Error(message);
  };
}

function captureStatisticsColumn(source: StatisticsSource, columnIndex: number, charge: (units: number) => void): QueryResultStatisticsCapture {
  const column = source.metadata[columnIndex];
  if (!column) throw Error(text.invalid);
  const values = source.indices.map(index => stamp(own(source.rowRefs[index], column.key), charge));
  const capture = Object.freeze({ column, rowCount: values.length, selected: source.selection !== undefined });
  bindings.set(capture, { ...source, values, invalid: false });
  return capture;
}

/** 捕获原行列与当前范围；只冻结自有快照，不克隆或冻结来源。 */
export function captureQueryResultStatistics(columns: readonly ResultColumn[], rows: readonly DataRow[], column: ResultColumn, indices?: ReadonlySet<number>, sqliteSource?: QueryResult, dialect?: SortDialect): QueryResultStatisticsCapture {
  const source = statisticsSource(columns, rows, indices, sqliteSource, dialect);
  const capture = captureStatisticsColumn(source, source.columnRefs.indexOf(column), statisticsBudget(text.budget));
  if (!currentQueryResultStatistics(capture, columns, rows)) throw Error(text.stale);
  return capture;
}

/** 分批阶段仅检查固定大小结构及本批原格；避免每512行重复全表检查造成平方扫描。 */
function currentStructure(binding: StatisticsSource): boolean {
  if (own(binding.columns, 'length') !== binding.columnRefs.length || own(binding.rows, 'length') !== binding.rowRefs.length) return false;
  if (binding.selection && setSize.call(binding.selection) !== binding.indices.length) return false;
  for (let index = 0; index < binding.columnRefs.length; index++) {
    const column = own(binding.columns, String(index)) as ResultColumn, before = binding.metadata[index];
    if (column !== binding.columnRefs[index]) return false;
    const now = metadata(column);
    if (now.key !== before.key || now.name !== before.name || now.type !== before.type) return false;
  }
  return true;
}
/** 完整核验共享来源，每列的原格快照可以独立复核。 */
function currentStatisticsSource(source: StatisticsSource): boolean {
  if (!currentStructure(source) || source.sqlite && !source.sqlite.current()) return false;
  for (let index = 0; index < source.rowRefs.length; index++) if (own(source.rows, String(index)) !== source.rowRefs[index]) return false;
  if (!source.selection) return true;
  return positions(source.selection, source.rowRefs.length).every((index, position) => index === source.indices[position]);
}
function currentColumnValues(binding: Binding, key: string): boolean {
  if (binding.invalid) return false;
  return binding.indices.every((index, position) => sameValue(own(binding.rowRefs[index], key), binding.values[position]));
}
/** 完整核源时，任何已经观测到的数组、元数据、选择和原值漂移均永久失效。 */
export function currentQueryResultStatistics(capture: QueryResultStatisticsCapture, columns: readonly ResultColumn[], rows: readonly DataRow[]): boolean {
  const binding = bindings.get(capture);
  if (!binding || binding.invalid) return false;
  try {
    if (columns !== binding.columns || rows !== binding.rows || !currentStatisticsSource(binding) || !currentColumnValues(binding, capture.column.key)) throw Error(text.stale);
    return true;
  } catch { binding.invalid = true; return false; }
}

interface Decimal { coefficient: bigint; scale: number; }
/** 已由原比较器准入的数值转为系数/尺度；float只展开已有number，不能找回驱动丢失精度。 */
function decimal(value: string | number): Decimal {
  const raw = String(value), match = /^([+-]?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(raw);
  if (!match) throw Error(text.value);
  const fraction = match[3] ?? '', exponent = match[4] ? Number(match[4]) : 0;
  let coefficient = BigInt((match[1] === '-' ? '-' : '') + match[2] + fraction), scale = fraction.length - exponent;
  if (scale < 0) { coefficient *= 10n ** BigInt(-scale); scale = 0; }
  return { coefficient, scale };
}
/** 十进制展示不经Number，负零归零，并保留调用方指定的原尺度或精确扩展尺度。 */
function display(coefficient: bigint, scale: number): string {
  const negative = coefficient < 0n, digits = (negative ? -coefficient : coefficient).toString().padStart(scale + 1, '0');
  const fraction = scale ? digits.slice(-scale) : '';
  return (negative ? '-' : '') + (scale ? digits.slice(0, -scale) : digits) + (fraction ? '.' + fraction : '');
}
/** 仅约分系数与计数，原始十进制尺度不丢失；约分后分母仅含2/5时AVG可以精确表示。 */
function exactAverage(sum: Decimal, count: number): Decimal | undefined {
  let left = sum.coefficient < 0n ? -sum.coefficient : sum.coefficient, right = BigInt(count);
  while (right) { const remainder = left % right; left = right; right = remainder; }
  const divisor = BigInt(count) / left;
  let remaining = divisor, twos = 0, fives = 0;
  while (remaining % 2n === 0n) { remaining /= 2n; twos++; }
  while (remaining % 5n === 0n) { remaining /= 5n; fives++; }
  if (remaining !== 1n) return;
  const extra = Math.max(twos, fives);
  let coefficient = sum.coefficient / left * (10n ** BigInt(extra) / divisor), scale = sum.scale + extra;
  while (scale > sum.scale && coefficient % 10n === 0n) { coefficient /= 10n; scale--; }
  return { coefficient, scale };
}
/** 从高于根的二次幂开始，用整数牛顿迭代取得向下取整的平方根。 */
function integerSquareRoot(value: bigint): bigint {
  if (value < 2n) return value;
  let root = 1n << BigInt(Math.ceil(value.toString(2).length / 2));
  for (;;) {
    const next = (root + value / root) / 2n;
    if (next >= root) return root;
    root = next;
  }
}
/** 用同尺度的精确矩计算总体标准差。比较平方判断半位，无需把大数转为浮点。 */
function populationDeviation(sum: Decimal, squares: bigint, count: number): Pick<QueryResultStatisticsResult, 'standardDeviation' | 'standardDeviationRounded'> {
  const size = BigInt(count);
  const varianceNumerator = size * squares - sum.coefficient * sum.coefficient;
  const root = integerSquareRoot(varianceNumerator);
  const exact = root * root === varianceNumerator ? exactAverage({ coefficient: root, scale: sum.scale }, count) : undefined;
  const format = (coefficient: bigint, scale: number) => {
    const decimalText = display(coefficient, scale);
    if (!scale) return decimalText;
    let end = decimalText.length;
    while (decimalText[end - 1] === '0') end--;
    return decimalText.slice(0, decimalText[end - 1] === '.' ? end - 1 : end);
  };
  if (exact) return { standardDeviation: format(exact.coefficient, exact.scale) };

  const denominator = size * size;
  const precision = Math.max(sum.scale, 18);
  const numerator = varianceNumerator * 10n ** BigInt(2 * (precision - sum.scale));
  const lower = integerSquareRoot(numerator / denominator);
  const midpoint = 2n * lower + 1n;
  const rounded = 4n * numerator >= denominator * midpoint * midpoint ? lower + 1n : lower;
  return { standardDeviation: format(rounded, precision), standardDeviationRounded: true };
}
/** 不同值沿用原比较键：精确数值归一、文本区分大小写、时间保留返回字段语义。 */
function identity(key: OrdinaryKey): string {
  if (key === null) return 'null';
  if (typeof key === 'object') return `e:${key.negative ? '-' : ''}${key.whole}.${key.fraction}`;
  return `${typeof key}:${String(key)}`;
}

/** SQLite数值按数学值归一，TEXT与BLOB分域；整数永不转Number，完整字节不依赖显示文字。 */
function sqliteIdentity(key: SqliteResultComparisonKey): string {
  if (key.storage === 'number') return 'number:' + (typeof key.value === 'bigint' || Number.isInteger(key.value) ? BigInt(key.value).toString() : String(key.value));
  return key.storage + ':' + Array.from(key.bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}
/** 两种来源绝不交叉比较；SQLite沿已准入逐格类型使用数值、UTF-8和原字节顺序。 */
function compareKeys(left: Key, right: Key): number {
  if (left && typeof left === 'object' && 'sqlite' in left) {
    if (!right || typeof right !== 'object' || !('sqlite' in right)) throw Error(text.invalid);
    return compareSqliteResultKeys(left, right);
  }
  if (right && typeof right === 'object' && 'sqlite' in right) throw Error(text.invalid);
  return compareQueryResultFilterKeys(left, right);
}

/** 还原分布项的完整原值。SQLite 等值数值可跨 INTEGER／REAL，只有精确往返才追加另一种类型。 */
export function queryResultFrequencyFilter(frequency: QueryResultFrequency, entry: QueryResultFrequencyEntry | null): QueryResultFilterRule | QueryResultFilterGroup {
  const owner = frequencyOwners.get(frequency);
  const binding = owner && bindings.get(owner.capture);
  if (!owner || !binding || !currentQueryResultStatistics(owner.capture, binding.columns, binding.rows)) throw Error(text.stale);
  const column = binding.columnRefs.find(item => item.key === owner.capture.column.key)!;
  if (entry === null && owner.hasNull) return { column: column.key, operator: 'null', value: '' };
  const index = entry && frequency.entries.includes(entry) ? queryResultFrequencyRow(entry) : undefined;
  if (index === undefined) throw Error(text.stale);

  if (!binding.sqlite) {
    const cell = captureQueryResultCellFilter(binding.columns, binding.rows, { index, row: binding.rows[index], column }, undefined, binding.dialect);
    return queryResultCellFilterRule(cell, 'eq');
  }

  const { literal, sqliteType } = binding.sqlite.literal(index, column.key);
  if (!sqliteType || literal.length > queryResultFilterLimits.valueUnits) throw Error(text.frequencyFilterUnavailable);
  const rule: QueryResultFilterRule = { column: column.key, operator: 'eq', value: literal, sqliteType };
  if (sqliteType !== 'integer' && sqliteType !== 'real') return rule;

  const real = Number(literal);
  if (!Number.isInteger(real)) return rule;
  const integer = BigInt(real);
  const counterpart = sqliteType === 'integer'
    ? (integer === BigInt(literal) ? { sqliteType: 'real' as const, value: String(real) } : undefined)
    : (sqliteResultCellMatches('i', String(integer)) ? { sqliteType: 'integer' as const, value: String(integer) } : undefined);
  return counterpart ? { mode: 'OR', children: [rule, { ...rule, ...counterpart }] } : rule;
}

export class QueryResultStatisticsScan {
  private binding?: Binding;
  private capture?: QueryResultStatisticsCapture;
  private readonly total: number;
  private processed = 0;
  private nulls = 0;
  private cancelled = false;
  private completed = false;
  private published?: QueryResultStatisticsResult;
  private readonly distinct = new Map<string, boolean>();
  private singletons = 0;
  private emptyText = 0;
  private readonly frequency?: QueryResultFrequencyCounter;
  private readonly histogram?: QueryResultHistogramCounter;
  private readonly histogramBins?: QueryResultHistogramBins;
  private readonly qualityOnly: boolean;
  private minimum?: { key: Key; literal: string };
  private maximum?: { key: Key; literal: string };
  private sum: Decimal = { coefficient: 0n, scale: 0 };
  private sumOfSquares = 0n;
  private reason?: string;
  private sqliteTypes?: Record<'integer' | 'real' | 'text' | 'blob' | 'null', number>;
  private numericOnly = true;
  private finiteNumbers = true;
  private readonly kind: ReturnType<typeof queryResultSortKind>;
  private readonly numericColumn: boolean;
  private readonly floatingColumn: boolean;
  /** 私有WeakMap拒绝伪造capture；声明为字节的列即使返回字符串也不参加值聚合。 */
  constructor(capture: QueryResultStatisticsCapture, mode: boolean | 'quality' | { histogram: QueryResultHistogramBins } = false) {
    const binding = bindings.get(capture);
    if (!binding || !currentQueryResultStatistics(capture, binding.columns, binding.rows)) throw Error(text.stale);
    this.binding = binding; this.capture = capture; this.total = capture.rowCount; this.kind = queryResultSortKind(capture.column.type, binding.dialect);
    this.floatingColumn = this.kind === 'float' || this.kind === 'postgresFloat';
    this.numericColumn = this.kind === 'integer' || this.kind === 'decimal' || this.kind === 'postgresNumeric' || this.floatingColumn;
    const histogramBins = typeof mode === 'object' ? mode.histogram : undefined;
    this.histogramBins = histogramBins;
    this.qualityOnly = mode === 'quality';
    if (mode === true) this.frequency = new QueryResultFrequencyCounter();
    if (histogramBins && (binding.sqlite || this.numericColumn)) this.histogram = new QueryResultHistogramCounter(histogramBins);
    if (binding.sqlite) this.sqliteTypes = { integer: 0, real: 0, text: 0, blob: 0, null: 0 };
    else if (!this.kind || /^(?:TINY_|MEDIUM_|LONG_)?BLOB(?:\b|$)/i.test(capture.column.type.trim())) this.reason = text.unsupported;
  }
  /** 取消释放不同值集合及部分聚合，不能通过后续step/result复活旧结果。 */
  cancel(): void {
    if (this.published?.frequency) frequencyOwners.delete(this.published.frequency);
    this.cancelled = true;
    this.distinct.clear();
    this.frequency?.clear();
    this.histogram?.clear();
    this.minimum = undefined;
    this.maximum = undefined;
    this.published = undefined;
    this.sum = { coefficient: 0n, scale: 0 };
    this.sumOfSquares = 0n;
    this.binding = undefined;
    this.capture = undefined;
  }
  /** 坏值只撤销所有值指标，完整计数仍继续；不发布部分不同值或极值。 */
  private rejectValues(reason: string): void { this.reason = reason; this.distinct.clear(); this.frequency?.clear(); this.histogram?.clear(); this.minimum = undefined; this.maximum = undefined; this.sum = { coefficient: 0n, scale: 0 }; this.sumOfSquares = 0n; }
  /** 同一完整身份服务于摘要和分布；仅当前模式需要的集合持有它。 */
  private observeValue(identity: string, literal: string, kind: QueryResultFrequencyKind, index: number): void {
    if (this.frequency) {
      this.frequency.add(identity, literal, kind, index);
      return;
    }
    if (kind === 'text' && literal === '') this.emptyText++;
    // 摘要只需区分首次和重复，沿用完整比较键，无需为每个值保留预览或次数。
    const single = this.distinct.get(identity);
    if (single === undefined) {
      this.distinct.set(identity, true);
      this.singletons++;
    } else if (single) {
      this.distinct.set(identity, false);
      this.singletons--;
    }
  }
  /** 每批至多512个原格或32Ki原文；结构检查不遍历整张行数组，最后一次才全量复核。 */
  step(): { processed: number; total: number; done: boolean; binning?: true } {
    const total = this.total, binding = this.binding, capture = this.capture;
    if (this.cancelled) return { processed: this.processed, total, done: true };
    try {
      if (!binding || binding.invalid || !capture || !currentStructure(binding)) throw Error(text.stale);
      const end = Math.min(total, this.processed + 512);
      let units = 0;
      for (; this.processed < end; this.processed++) {
        const before = binding.values[this.processed];
        if (units && units + before.units > 32768) break;
        units += before.units;
        const index = binding.indices[this.processed], row = own(binding.rows, String(index));
        if (row !== binding.rowRefs[index] || binding.selection && !Set.prototype.has.call(binding.selection, index)) throw Error(text.stale);
        const value = own(row, capture.column.key);
        if (!sameValue(value, before)) throw Error(text.stale);
        if (value === null) {
          this.nulls++;
          if (binding.sqlite && !this.reason) { try { binding.sqlite.literal(index, capture.column.key); this.sqliteTypes!.null++; } catch { this.rejectValues(text.value); } }
          continue;
        }
        if (this.reason) continue;
        try {
          let key: Key, literal: string, numeric: boolean;
          if (binding.sqlite) {
            const cell = binding.sqlite.literal(index, capture.column.key), type = cell.sqliteType;
            if (!type) throw Error(text.value);
            this.sqliteTypes![type]++;
            key = sqliteResultComparisonKey(value as CellValue, ({ integer: 'i', real: 'r', text: 't', blob: 'b' } as const)[type]);
            if (!key) throw Error(text.value);
            literal = type === 'blob' ? `X'${cell.literal}'` : cell.literal;
            numeric = type === 'integer' || type === 'real';
            if (!this.histogramBins) this.observeValue(sqliteIdentity(key), literal, numeric ? 'number' : type === 'blob' ? 'blob' : 'text', index);
            this.numericOnly &&= numeric;
            if (type === 'real' && !Number.isFinite(Number(value))) { this.finiteNumbers = false; numeric = false; }
          } else {
            key = queryResultFilterKey(capture.column, value as CellValue, binding.dialect); literal = String(value);
            numeric = this.numericColumn;
            if (!this.histogramBins) this.observeValue(identity(key), literal, numeric ? 'number' : this.kind === 'text' ? 'text' : this.kind === 'postgresBoolean' ? 'boolean' : 'temporal', index);
            // PostgreSQL 特殊数值仍参与不同值、分布与极值，合计和平均只用于全有限的数值集合。
            if (numeric && typeof key === 'number' && !Number.isFinite(key)) { this.finiteNumbers = false; numeric = false; }
          }
          const numericValue = this.kind === 'postgresFloat' ? key as number : value as string | number;
          if (this.histogramBins) {
            if (numeric) this.histogram?.add(decimal(numericValue));
            continue;
          }
          if (this.qualityOnly) continue;
          if (!this.minimum || compareKeys(key, this.minimum.key) < 0) this.minimum = { key, literal };
          if (!this.maximum || compareKeys(key, this.maximum.key) > 0) this.maximum = { key, literal };
          if (numeric) {
            // 浮点聚合使用已验证的有限比较值，避免展开原文中任意长度的科学计数指数。
            const next = decimal(numericValue);
            const scale = Math.max(next.scale, this.sum.scale);
            const previousFactor = 10n ** BigInt(scale - this.sum.scale);
            const nextCoefficient = next.coefficient * 10n ** BigInt(scale - next.scale);
            // 平方和的尺度是合计尺度的两倍；值分布不需要额外的二阶矩。
            if (!this.frequency) this.sumOfSquares = this.sumOfSquares * previousFactor * previousFactor + nextCoefficient * nextCoefficient;
            this.sum = { coefficient: this.sum.coefficient * previousFactor + nextCoefficient, scale };
          }
        } catch { this.rejectValues(text.value); }
      }
      if (this.processed === total && !this.completed) {
        if (this.histogram && !this.reason && !this.histogram.step()) {
          return { processed: this.histogram.processed, total: this.histogram.size, done: false, binning: true };
        }
        if (!currentQueryResultStatistics(capture, binding.columns, binding.rows)) throw Error(text.stale);
        this.finish(); this.completed = true;
      }
      return { processed: this.processed, total, done: this.completed };
    } catch { if (binding) binding.invalid = true; this.cancel(); throw Error(text.stale); }
  }
  /** 发布的分布绑定到这次完整扫描，后续筛选用原列与原行验证身份。 */
  private finishFrequency(nonNull: number): { frequency?: QueryResultFrequency } {
    if (!this.frequency || !this.capture) return {};
    const frequency = this.frequency.result(nonNull);
    frequencyOwners.set(frequency, { capture: this.capture, hasNull: this.nulls > 0 });
    return { frequency };
  }
  /** 有限AVG先约分精确扩展；仅循环小数按最大原尺度或18位，用BigInt商余数实现half-away。 */
  private finish(): void {
    const count = this.total, nonNull = count - this.nulls, floatInput = this.sqliteTypes ? this.sqliteTypes.real > 0 : this.floatingColumn && nonNull > 0;
    if (this.histogramBins) {
      const counter = this.histogram;
      const nonNumeric = this.sqliteTypes ? this.sqliteTypes.text + this.sqliteTypes.blob : 0;
      const histogram = counter && !this.reason ? {
        column: this.capture!.column.name || this.capture!.column.key,
        requestedBins: this.histogramBins,
        approximate: floatInput,
        finite: String(counter.size),
        nonFinite: String(nonNull - nonNumeric - counter.size),
        nonNumeric: String(nonNumeric),
        nulls: String(this.nulls),
        ranges: counter.ranges(display),
      } : undefined;
      this.published = Object.freeze({ count, nonNull, nulls: this.nulls, approximate: floatInput, floatInput, averageRounded: false, histogram, reason: this.reason });
      counter?.clear();
      this.minimum = this.maximum = undefined;
      return;
    }
    const types = this.sqliteTypes && !this.reason ? { sqliteTypes: Object.freeze({ ...this.sqliteTypes }) } : {};
    const quality = this.frequency ? {} : { quality: Object.freeze({ emptyText: this.emptyText, singletons: this.singletons }) };
    if (!nonNull && (!this.sqliteTypes || !this.reason)) { this.published = Object.freeze({ count, nonNull, nulls: this.nulls, distinct: 0, approximate: false, floatInput: false, averageRounded: false, ...types, ...quality, ...this.finishFrequency(0) }); return; }
    if (this.reason) { this.published = Object.freeze({ count, nonNull, nulls: this.nulls, approximate: false, floatInput: false, averageRounded: false, reason: this.reason }); return; }
    let sum: string | undefined, average: string | undefined, averageRounded = false;
    let deviation: ReturnType<typeof populationDeviation> = {};
    if (!this.qualityOnly && this.finiteNumbers && (this.sqliteTypes ? this.numericOnly : this.numericColumn)) {
      sum = display(this.sum.coefficient, this.sum.scale);
      if (!this.frequency) deviation = populationDeviation(this.sum, this.sumOfSquares, nonNull);
      const finite = exactAverage(this.sum, nonNull);
      if (finite) average = display(finite.coefficient, finite.scale);
      else {
        const scale = Math.max(this.sum.scale, 18), numerator = this.sum.coefficient * 10n ** BigInt(scale - this.sum.scale), divisor = BigInt(nonNull);
        let quotient = numerator / divisor;
        const remainder = numerator % divisor, magnitude = remainder < 0n ? -remainder : remainder;
        averageRounded = remainder !== 0n;
        if (magnitude * 2n >= divisor) quotient += numerator < 0n ? -1n : 1n;
        average = display(quotient, scale);
      }
    }
    const reason = this.sqliteTypes && (!this.numericOnly || !this.finiteNumbers) ? text.sqliteNumericOnly :
      !this.finiteNumbers ? text.postgresNonFinite : undefined;
    this.published = Object.freeze({ count, nonNull, nulls: this.nulls, distinct: this.frequency?.distinct ?? this.distinct.size, min: this.minimum?.literal, max: this.maximum?.literal, sum, average, ...deviation, approximate: floatInput || averageRounded, floatInput, averageRounded, ...types, ...quality, ...(reason ? { reason } : {}), ...this.finishFrequency(nonNull) });
    this.distinct.clear(); this.frequency?.clear(); this.minimum = undefined; this.maximum = undefined;
    this.sumOfSquares = 0n;
  }
  /** 最后发布仍核源，调用方无需信任较早某一帧的current判断。 */
  result(): QueryResultStatisticsResult | undefined {
    const capture = this.capture, binding = this.binding;
    if (this.cancelled || !this.completed || !capture || !binding) return;
    if (!currentQueryResultStatistics(capture, binding.columns, binding.rows)) { this.cancel(); return; }
    return this.published;
  }
}

export interface QueryResultQualityColumn {
  column: Readonly<ResultColumn>;
  count: number;
  nulls: number;
  distinct?: number;
  emptyText?: number;
  singletonRows?: number;
  repeatedRows?: number;
}

/** 逐列分批扫描，只在所有列和原始来源都通过复核后一次发布。 */
export class QueryResultQualityOverviewScan {
  private readonly source: StatisticsSource;
  private readonly captures: QueryResultStatisticsCapture[];
  private readonly columns: QueryResultQualityColumn[] = [];
  private active?: QueryResultStatisticsScan;
  private cancelled = false;

  constructor(columns: readonly ResultColumn[], rows: readonly DataRow[], indices?: ReadonlySet<number>, sqliteSource?: QueryResult, dialect?: SortDialect) {
    this.source = statisticsSource(columns, rows, indices, sqliteSource, dialect);
    // 两个预算分别约束选中原格和共享坐标复核；超限时不能静默取前几列。
    if (this.total * this.source.indices.length > 200000 || this.total * rows.length > 1000000) throw Error(text.overviewBudget);
    const charge = statisticsBudget(text.overviewBudget);
    this.captures = this.source.columnRefs.map((_, index) => captureStatisticsColumn(this.source, index, charge));
  }

  get total(): number { return this.source.columnRefs.length; }

  step(): { processed: number; done: boolean } {
    const index = this.columns.length;
    if (this.cancelled || index === this.total) return { processed: index, done: true };
    this.active ??= new QueryResultStatisticsScan(this.captures[index], 'quality');
    if (!this.active.step().done) return { processed: index, done: false };
    const result = this.active.result();
    if (!result) throw Error(text.stale);
    const { count, nulls, nonNull, distinct, quality } = result;
    this.columns.push(Object.freeze({
      column: this.source.metadata[index], count, nulls, distinct,
      emptyText: quality?.emptyText, singletonRows: quality?.singletons,
      repeatedRows: quality && nonNull - quality.singletons,
    }));
    this.active = undefined;
    if (index + 1 === this.total) Object.freeze(this.columns);
    return { processed: index + 1, done: index + 1 === this.total };
  }

  /** 点击下钻前也复核此前所有列，来源漂移后不能重用旧概览。 */
  result(): readonly QueryResultQualityColumn[] | undefined {
    if (this.cancelled || this.columns.length !== this.total) return;
    try {
      if (currentStatisticsSource(this.source) && this.captures.every(capture => currentColumnValues(bindings.get(capture)!, capture.column.key))) return this.columns;
    } catch {}
    this.cancel();
  }

  cancel(): void {
    this.cancelled = true;
    this.active?.cancel();
    this.active = undefined;
    this.captures.length = 0;
  }
}
