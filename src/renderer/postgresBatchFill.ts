import type { DataRow } from '../shared/contracts';
import { postgresTableLimits, type PostgresTableChange, type PostgresTableColumn, type PostgresTableField, type PostgresTablePage } from '../shared/postgresTable';
import { ownCell } from './lib';
import { postgresBatchFillZh as text } from './locales/postgresBatchFill.zh-CN';
import { postgresBatchEditableColumn, postgresBatchRows, postgresBatchValueEqual, postgresBatchValueValid } from './postgresBatchSelection';
import { postgresClipboardFieldValue } from './postgresGridPaste';
import { gridRangeFillZh as rangeText } from './locales/gridRangeFill.zh-CN';
import { gridRangeFillColumns, gridRangeFillSource, gridRangeIntegerSequence, type GridRangeFillDirection, type GridRangeFillInput, type GridRangeFillSide } from './gridRangeFill';
import type { GridRangeTarget } from './useGridCellRange';

type RecordUpdate = Extract<PostgresTableChange, { kind: 'update' }>;

/** 查询范围已按显示顺序回查原行，复制从该快照取值，只给变化的目标格生成草稿。 */
export function postgresQueryRangeFillChanges(page: PostgresTablePage, columns: readonly PostgresTableColumn[],
  input: GridRangeFillInput): RecordUpdate[] {
  const { kind, value } = input;
  const range = { startRow: 0, rows: page.rows, keys: columns.map(column => column.key) };
  const noDraft = () => undefined;
  if (kind === 'integer' || kind === 'real') throw Error(rangeText.target);
  if (kind === 'sequence') return postgresRangeFillSequence(page, columns, range, input, noDraft);
  if (kind === 'up' || kind === 'down') return postgresRangeFillFromRow(page, columns, range, kind, noDraft);
  if (kind === 'left' || kind === 'right') return postgresRangeFillAcross(page, columns, range, kind, noDraft);
  return postgresRangeFillChanges(page, columns, 0, page.rows.length, kind === 'null' ? null : value, noDraft);
}

const postgresIntegerBits = new Map([['smallint', 16], ['integer', 32], ['bigint', 64]]);

/** 序列只写内置整数列，沿用原行版本、当前草稿和整批暂存。 */
export function postgresRangeFillSequence(page: PostgresTablePage, columns: readonly PostgresTableColumn[],
  range: GridRangeTarget<DataRow>, input: GridRangeFillInput, prior: (key: string) => PostgresTableChange | undefined): RecordUpdate[] {
  if (columns.length !== 1) throw Error(rangeText.sequenceShape);
  const [column] = columns, bits = postgresIntegerBits.get(column.type);
  if (!bits || !page.columns.includes(column) || !postgresBatchEditableColumn(column) ||
      column.sequenceDefault || column.binary || !page.capabilities.update) throw Error(rangeText.incompatible(column.name));
  if (range.rows.length > postgresTableLimits.changes) throw Error(rangeText.limit);
  const selected = new Set(range.rows.map((_, index) => range.startRow + index));
  const rows = postgresBatchRows(page, selected, prior), valueAt = gridRangeIntegerSequence(input, rows.length, bits);
  return rows.flatMap(({ index: row, original, previous }, index) => {
    const fields = postgresFilledFields(original, [{ column: column.key, value: { mode: 'text', value: valueAt(index) } }], previous);
    return fields ? [{ kind: 'update', row, fields }] : [];
  });
}

/** 矩形只转换一次统一值，再交给既有的原行账本和批量字段校验。 */
export function postgresRangeFillChanges(page: PostgresTablePage, columns: readonly PostgresTableColumn[],
  start: number, count: number, value: string | null, prior: (key: string) => PostgresTableChange | undefined) {
  if (!Number.isInteger(start) || !Number.isInteger(count) || start < 0 || count < 1 || start + count > page.rows.length ||
      count > postgresTableLimits.changes) throw Error(rangeText.target);
  const fields = columns.map(column => {
    if (column.binary && value !== null) throw Error(rangeText.target);
    return { column: column.key, value: postgresClipboardFieldValue(value, column) };
  });
  const selected = new Set(Array.from({ length: count }, (_, index) => start + index));
  return postgresBatchFillChanges(page, columns, selected, fields, prior);
}

/** 来源优先取本地字段草稿，目的行继续按原主键及已保留的行版本暂存。 */
export function postgresRangeFillFromRow(page: PostgresTablePage, columns: readonly PostgresTableColumn[],
  range: GridRangeTarget<DataRow>, direction: GridRangeFillDirection, prior: (key: string) => PostgresTableChange | undefined) {
  const plan = gridRangeFillSource(range, direction, (_, index) => {
    const key = page.rowKeys?.[index];
    return !key || prior(key)?.kind === 'delete';
  });
  const source = prior(page.rowKeys![plan.sourceIndex]);
  const fields = columns.map(column => ({ column: column.key, value: fillSourceValue(plan.source, column, source) }));
  const selected = new Set(plan.rows.map((_, index) => plan.startRow + index));
  return postgresBatchFillChanges(page, columns, selected, fields, prior);
}

function fillSourceValue(row: DataRow, column: PostgresTableColumn, previous?: PostgresTableChange): PostgresTableField['value'] {
  const staged = previous?.kind === 'update' ? previous.fields.find(field => field.column === column.key)?.value : undefined;
  const value = staged ?? postgresClipboardFieldValue(ownCell(row, column.key), column);
  if (value.mode === 'default') throw Error(rangeText.missing);
  return value;
}

/** 横向复制逐行读取草稿，任何不兼容字段都在统一暂存前拒绝。 */
export function postgresRangeFillAcross(page: PostgresTablePage, columns: readonly PostgresTableColumn[],
  range: GridRangeTarget<DataRow>, side: GridRangeFillSide, prior: (key: string) => PostgresTableChange | undefined): RecordUpdate[] {
  const { source, targets } = gridRangeFillColumns(columns, side);
  if (!page.capabilities.update || columns.some(column => !page.columns.includes(column)) ||
      targets.some(column => !postgresBatchEditableColumn(column)) || targets.length > postgresTableLimits.fields)
    throw Error(rangeText.target);
  const selected = new Set(range.rows.map((_, index) => range.startRow + index));
  const rows = postgresBatchRows(page, selected, prior);
  let size = 0;
  const encoder = new TextEncoder();
  return rows.flatMap(({ index: row, original, previous }) => {
    const value = fillSourceValue(original, source, previous);
    if ('value' in value) size += encoder.encode(value.value).byteLength * targets.length;
    if (size > postgresTableLimits.draft) throw Error(rangeText.limit);
    const fields = targets.map(column => {
      if (value.mode !== 'null' && (column.type !== source.type || column.binary !== source.binary) ||
          !postgresBatchValueValid(column, value)) throw Error(rangeText.incompatible(column.name));
      return { column: column.key, value };
    });
    const next = postgresFilledFields(original, fields, previous);
    return next ? [{ kind: 'update', row, fields: next }] : [];
  });
}

/** 以明确的勾选行、原行键和可见列构造整批草稿。其它字段及已暂存行版本由原工作区保留。 */
export function postgresBatchFillChanges(page: PostgresTablePage, visible: readonly PostgresTableColumn[],
  selected: ReadonlySet<number>, fields: readonly PostgresTableField[], prior: (key: string) => PostgresTableChange | undefined): RecordUpdate[] {
  if (!page.capabilities.update) throw Error(text.rows);
  const rows = postgresBatchRows(page, selected, prior);
  assertPostgresBatchFillFields(visible.filter(column => page.columns.includes(column)), fields);
  return rows.flatMap(({ index: row, original, previous }) => {
    const next = postgresFilledFields(original, fields, previous);
    return next ? [{ kind: 'update', row, fields: next }] : [];
  });
}

export function assertPostgresBatchFillFields(columns: readonly PostgresTableColumn[], fields: readonly PostgresTableField[]): void {
  const seen = new Set<string>();
  if (!fields.length || fields.length > postgresTableLimits.fields) throw Error(text.fields);
  for (const { column: key, value } of fields) {
    const column = columns.find(item => item.key === key);
    if (!column || !postgresBatchEditableColumn(column) || seen.has(key)) throw Error(text.fields);
    if (!postgresBatchValueValid(column, value)) throw Error(text.invalid);
    seen.add(key);
  }
}

/** 以原始数据和已有草稿计算实际变更，无改动不生成新的历史步骤。 */
export function postgresFilledFields(original: DataRow, fields: readonly PostgresTableField[], previous?: PostgresTableChange): PostgresTableField[] | undefined {
  const previousFields = previous?.kind === 'update' ? previous.fields : [];
  const changed = fields.filter(field => {
    const raw = ownCell(original, field.column);
    if (raw === undefined) throw Error(text.rows);
    return !postgresBatchValueEqual(field.value, previousFields.find(item => item.column === field.column)?.value, raw);
  });
  if (!changed.length) return;
  const replaced = new Set(changed.map(field => field.column));
  return [...previousFields.filter(field => !replaced.has(field.column)), ...changed];
}
