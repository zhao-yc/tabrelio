import type { ColumnInfo, DataRow, TablePage } from '../shared/contracts';
import { copyInsertSqlLimits as limits } from '../shared/copyInsertSql';
import { tableCopyMetadataKey } from '../shared/tableCopySource';
import type { DraftRow } from './dataChanges';
import { changedDraftHistoryBytes, draftHistoryLimits } from './draftHistory';
import { ownCell, parseCell } from './lib';
import { gridRangeFillColumns, gridRangeIntegerSequence, type GridRangeFillInput, type GridRangeFillSide } from './gridRangeFill';
import type { GridRangeTarget } from './useGridCellRange';
import { gridRangeFillZh as rangeText } from './locales/gridRangeFill.zh-CN';
import { assertRecordBatchFields, recordBatchCellBytes, sameRecordBatchRow } from './recordDuplicateBatch';
import { recordCopyMetadataReason, type RecordCopyPage } from './recordCopySource';
import { recordInputLimits, recordReadonlyReason, recordTargetKey, type RecordContext, type RecordInput } from './recordViews';
import { recordViewZh } from './locales/recordViews.zh-CN';
import { recordBatchFillZh as text } from './locales/recordBatchFill.zh-CN';

export interface BatchFillAssignment { column: string; input: RecordInput }
export interface BatchFillSourceBudget { rows: number; cells: number; bytes: number }

/** 普通列不含任何可靠定位键、自增或生成字段，使用原表页可编辑对象门。 */
export function batchFillColumns(context: RecordContext): ColumnInfo[] {
  if (recordReadonlyReason(context)) return [];
  const info = context.info!;
  return info.columns.filter(column => !column.generated && !/\bauto_increment\b/i.test(column.extra) && !info.primaryKey.includes(column.name) && !info.editableKey.includes(column.name));
}
/** 共享原批量值校验，任何非法值/字节预算错误都在分配新行前拒绝。 */
function bytes(value: unknown): number { try { return recordBatchCellBytes(value); } catch { throw Error(text.budget); } }
function same(left: DraftRow['data'], right: DraftRow['data']): boolean { try { return sameRecordBatchRow(left, right); } catch { throw Error(text.source); } }

/** 只消费当前页，不补取；原始数据按加载顺序逐行匹配，任一无效都不能静默跳过。 */
function selectedRows(rows: DraftRow[], ids: ReadonlySet<string>, context: RecordContext, binding: RecordCopyPage | null, page: TablePage | null, sourceBudget?: BatchFillSourceBudget): DraftRow[] {
  const reason = recordReadonlyReason(context); if (reason) throw Error(reason);
  const info = context.info!;
  if (info.database !== context.target.database || info.name !== context.target.table || !page || binding?.page !== page || recordCopyMetadataReason(context, binding) || page.copySource && (page.copySource.status !== 'ready' || page.copySource.missingColumns.length || !Number.isFinite(page.copySource.expiresAt) || page.copySource.expiresAt <= Date.now() || !page.copySource.pageRef || page.copySource.rowRefs.length !== page.rows.length)) throw Error(text.source);
  if (!ids.size || ids.size > limits.rows || new Set(rows.map(row => row.id)).size !== rows.length) throw Error(text.selection);
  const keys = page.columns.map(column => column.key), names = info.columns.map(column => column.name);
  if (names.length > limits.columns || ids.size * names.length > limits.cells || new Set(names).size !== names.length || new Set(keys).size !== keys.length || keys.length !== names.length || names.some(name => !keys.includes(name))) throw Error(text.source);
  const originals = rows.filter(row => !row.inserted);
  if (originals.length !== page.rows.length || originals.some((row, index) => !row.original || !same(row.original, page.rows[index]))) throw Error(text.source);
  const selected = rows.filter(row => ids.has(row.id));
  if (selected.length !== ids.size || selected.some(row => row.inserted || row.deleted || !row.original)) throw Error(text.selection);
  const budget = sourceBudget ?? { rows: 0, cells: 0, bytes: 2 };
  budget.rows += selected.length;
  budget.cells += selected.length * names.length;
  if (budget.rows > limits.rows || budget.cells > limits.cells) throw Error(text.selection);
  for (const row of selected) {
    try { assertRecordBatchFields(row.data); assertRecordBatchFields(row.original); } catch { throw Error(text.source); }
    if ([row.data, row.original!].some(data => Object.keys(data).length !== names.length || names.some(name => !Object.hasOwn(data, name) || data[name] === undefined))) throw Error(text.source);
    if (info.editableKey.some(key => row.original![key] === null || row.original![key] === undefined)) throw Error(text.source);
    for (const name of names) { budget.bytes += bytes(name) + bytes(row.data[name]) + bytes(row.original![name]) + 4; if (budget.bytes > limits.inputBytes) throw Error(text.budget); }
  }
  return selected;
}

/** 原页/选择/来源的本机一次性意图；观察到失效后即使ABA恢复也不能再暂存。 */
export class BatchFillIntent {
  private stopped = false;
  private readonly target: string;
  private readonly metadata: string;
  private readonly ids: Set<string>;
  private readonly snapshots: { row: DraftRow; data: DraftRow['data']; original: DraftRow['data'] }[];
  constructor(readonly rows: DraftRow[], readonly selected: ReadonlySet<string>, readonly context: RecordContext, readonly binding: RecordCopyPage | null, readonly page: TablePage | null, sourceBudget?: BatchFillSourceBudget) {
    const chosen = selectedRows(rows, selected, context, binding, page, sourceBudget);
    if (!batchFillColumns(context).length) throw Error(text.column);
    this.target = recordTargetKey(context.target); this.metadata = tableCopyMetadataKey(context.info!); this.ids = new Set(selected);
    this.context = { ...context, target: { ...context.target } };
    this.snapshots = chosen.map(row => ({ row, data: structuredClone(row.data), original: structuredClone(row.original!) }));
  }
  /** 关闭、重载、选中或外部编辑变化同步撤销，不释放后重新领取旧授权。 */
  invalidate(): void { this.stopped = true; }
  /** 弹窗自身处理迟到事件后也能显示同步失效，不能依赖父页一定重绘。 */
  get invalidated(): boolean { return this.stopped; }
  reason(rows: DraftRow[], ids: ReadonlySet<string>, context: RecordContext, binding: RecordCopyPage | null, page: TablePage | null): string {
    if (this.stopped) return text.changed;
    try {
      if (rows !== this.rows || ids !== this.selected || ids.size !== this.ids.size || [...ids].some(id => !this.ids.has(id)) || context.info !== this.context.info || context.generation !== this.context.generation || context.connectionVersion !== this.context.connectionVersion || recordTargetKey(context.target) !== this.target || !context.info || tableCopyMetadataKey(context.info) !== this.metadata || binding !== this.binding || page !== this.page) throw Error(text.changed);
      selectedRows(rows, ids, context, binding, page);
      if (this.snapshots.some(saved => rows.find(row => row.id === saved.row.id) !== saved.row || !same(saved.row.data, saved.data) || !same(saved.row.original!, saved.original))) throw Error(text.changed);
      return '';
    } catch (reason) { this.stopped = true; return reason instanceof Error ? reason.message : text.changed; }
  }
  /** 所有字段/行/输入/线路及历史预算通过后仅返回一个不可变新数组，调用方只发布一次。 */
  consume(columnName: string, input: RecordInput, rows: DraftRow[], ids: ReadonlySet<string>, context: RecordContext, binding: RecordCopyPage | null, page: TablePage | null): DraftRow[] {
    return this.consumeAssignments([{ column: columnName, input }], rows, ids, context, binding, page);
  }
  /** 输入失败保留意图供修正，只有完整生成替换行后才消费。 */
  consumeAssignments(assignments: readonly BatchFillAssignment[], rows: DraftRow[], ids: ReadonlySet<string>, context: RecordContext, binding: RecordCopyPage | null, page: TablePage | null): DraftRow[] {
    const reason = this.reason(rows, ids, context, binding, page); if (reason) throw Error(reason);
    const result = prepareBatchFill(assignments, rows, ids, context);
    this.stopped = true;
    return result;
  }
}

/** 为已验证的本地选区生成新行，跨页时同样只解析一次输入并共用整组选区的预算。 */
export function prepareBatchFill(assignments: readonly BatchFillAssignment[], rows: DraftRow[], ids: ReadonlySet<string>, context: RecordContext,
  onlyNull = false): DraftRow[] {
  const columns = batchFillColumns(context), values = new Map<string, DraftRow['data'][string]>();
  const selected = onlyNull ? rows.filter(row => ids.has(row.id)) : undefined;
  let preparedBytes = 2;
  if (!Array.isArray(assignments) || !assignments.length || assignments.length > columns.length || assignments.length > limits.columns) throw Error(text.assignments);
  for (const assignment of assignments) {
    if (!assignment || values.has(assignment.column)) throw Error(text.assignments);
    const column = columns.find(column => column.name === assignment.column); if (!column) throw Error(text.column);
    const input = assignment.input;
    if (!input || !['text', 'json', 'binary', 'null'].includes(input.mode) || typeof input.text !== 'string' || input.text.length > recordInputLimits.field) throw Error(text.budget);
    if (input.mode === 'null' && !column.nullable) throw Error(recordViewZh.nullForbidden);
    if (/^(?:TINYBLOB|BLOB|MEDIUMBLOB|LONGBLOB|BINARY|VARBINARY|BIT)\b/i.test(column.type) && !['binary', 'null'].includes(input.mode)) throw Error(text.column);
    const value = parseCell(input.text, input.mode as 'text' | 'json' | 'binary' | 'null');
    // 已准备字段就是最终线路的必要下界；扇出必超预算时不继续解析后续大值或分配行。
    const count = selected?.filter(row => ownCell(row.data, column.name) === null).length ?? ids.size;
    preparedBytes += (bytes(column.name) + bytes(value) + 4) * count;
    if (preparedBytes > limits.inputBytes) throw Error(text.budget);
    values.set(column.name, value);
  }
  if (!onlyNull) return applyBatchFill(values, rows, ids);
  // 只认当前草稿中的真实 NULL，缺失字段仍交给数据库的 DEFAULT。
  const next = applyBatchRowPatches(rows, row => {
    if (!ids.has(row.id)) return;
    const targets = [...values].filter(([key]) => ownCell(row.data, key) === null);
    if (targets.length) return Object.fromEntries(targets);
  });
  if (next === rows) throw Error(rangeText.noNull);
  return next;
}

/** 同列复制使用原协议值，避免精确数字或 BLOB 经输入文本重新解析。 */
export function prepareBatchFillFromRow(keys: readonly string[], source: DraftRow, rows: DraftRow[],
  ids: ReadonlySet<string>, context: RecordContext): DraftRow[] {
  const columns = new Map(batchFillColumns(context).map(column => [column.name, column]));
  if (!keys.length || keys.length > limits.columns) throw Error(text.assignments);
  const values = new Map<string, DraftRow['data'][string]>();
  let preparedBytes = 0;
  for (const key of keys) {
    const column = columns.get(key), value = ownCell(source.data, key);
    if (value === undefined) throw Error(rangeText.missing);
    if (!column || value === null && !column.nullable) throw Error(rangeText.target);
    preparedBytes += bytes(key) + bytes(value) + 4;
    if (preparedBytes * ids.size + 2 > limits.inputBytes) throw Error(text.budget);
    values.set(key, value);
  }
  return applyBatchFill(values, rows, ids);
}

/** 原批量草稿和撤销预算共用，只有整组通过后才分配已修改的行。 */
function applyBatchFill(values: ReadonlyMap<string, DraftRow['data'][string]>, rows: DraftRow[], ids: ReadonlySet<string>): DraftRow[] {
  // 新增草稿的 DEFAULT 尚未存字段，明确赋值时需把它加入数据而不是略过。
  const patch = Object.fromEntries(values);
  return applyBatchRowPatches(rows, row => ids.has(row.id) ? patch : undefined);
}

/** 横向填充逐行核对目标类型和 NULL，沿用现有字节预算及一次发布。 */
export function prepareBatchFillAcross(range: GridRangeTarget<DraftRow>, side: GridRangeFillSide, rows: DraftRow[],
  context: RecordContext): DraftRow[] {
  const { source, targets } = gridRangeFillColumns(range.keys, side);
  const writable = new Map(batchFillColumns(context).map(column => [column.name, column]));
  const original = context.info?.columns.find(column => column.name === source);
  const selected = new Set(range.rows);
  if (!original || range.rows.some((row, index) => row.deleted || rows[range.startRow + index] !== row)) throw Error(rangeText.target);
  const fields = targets.map(key => {
    const column = writable.get(key);
    if (!column) throw Error(rangeText.target);
    return column;
  });
  return applyBatchRowPatches(rows, row => {
    if (!selected.has(row)) return;
    const value = ownCell(row.data, source);
    if (value === undefined) throw Error(rangeText.missing);
    return Object.fromEntries(fields.map(column => {
      if (!row.inserted && !Object.hasOwn(row.data, column.name)) throw Error(rangeText.target);
      if (value === null ? !column.nullable : original.type !== column.type || original.characterSet !== column.characterSet)
        throw Error(rangeText.incompatible(column.name));
      return [column.name, value];
    }));
  });
}

const mysqlIntegerBits = new Map([['tinyint', 8], ['smallint', 16], ['mediumint', 24], ['int', 32], ['integer', 32], ['bigint', 64]]);

/** MySQL 和 MariaDB 按字段实际位宽校验，以协议字符串保留完整整数。 */
export function prepareBatchFillSequence(range: GridRangeTarget<DraftRow>, input: GridRangeFillInput, rows: DraftRow[],
  context: RecordContext): DraftRow[] {
  if (range.keys.length !== 1) throw Error(rangeText.sequenceShape);
  const [key] = range.keys;
  const column = batchFillColumns(context).find(item => item.name === key);
  const type = /^(\w+)(?:\(\d+\))?( unsigned)?( zerofill)?$/i.exec(column?.type.toLowerCase() ?? '');
  const bits = type && mysqlIntegerBits.get(type[1]);
  if (!column || !bits) throw Error(rangeText.incompatible(key));
  if (range.rows.length > limits.rows) throw Error(rangeText.limit);
  if (range.rows.some((row, index) => rows[range.startRow + index] !== row || row.deleted ||
      !row.inserted && ownCell(row.data, key) === undefined)) throw Error(rangeText.target);
  const valueAt = gridRangeIntegerSequence(input, range.rows.length, bits, !!(type?.[2] || type?.[3]));
  const values = new Map(range.rows.map((row, index) => [row, { [key]: valueAt(index) }]));
  return applyBatchRowPatches(rows, row => values.get(row));
}

function applyBatchRowPatches(rows: DraftRow[], patchFor: (row: DraftRow) => DataRow | undefined): DraftRow[] {
  let total = 2, history = 128;
  const replacements = new Map<DraftRow, { row: DraftRow; patch: DataRow }>();
  for (const row of rows) {
    const patch = patchFor(row);
    if (!patch) continue;
    const data = { ...row.data, ...patch };
    for (const [key, cell] of Object.entries(data)) { total += bytes(key) + bytes(cell) + 4; if (total > limits.inputBytes) throw Error(text.budget); }
    if (same(row.data, data)) continue;
    const next = { ...row, data }; history += changedDraftHistoryBytes(row, next); if (history > draftHistoryLimits.bytes) throw Error(text.budget);
    replacements.set(row, { row: next, patch });
  }
  // 最后才深复制新写入的二进制包装，各行不能共享可变值；original及无关字段引用保持。
  return replacements.size ? rows.map(row => {
    const next = replacements.get(row);
    return next ? { ...next.row, data: Object.fromEntries(Object.entries(next.row.data)
      .map(([key, cell]) => [key, Object.hasOwn(next.patch, key) ? structuredClone(cell) : cell])) } : row;
  }) : rows;
}
