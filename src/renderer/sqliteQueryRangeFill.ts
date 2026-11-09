import { sqliteEditValueSchema, sqliteTableEditLimits, type SqliteEditValue } from '../shared/sqliteTableEdit';
import { gridRangeFillColumns, gridRangeFillSource, type GridRangeFillInput } from './gridRangeFill';
import { gridRangeFillZh as text } from './locales/gridRangeFill.zh-CN';
import { sqliteColumnAcceptsTransferValue } from './sqliteRecordTransfer';
import { prepareSqliteFill } from './sqliteTableFill';
import type { SqliteTableEditor } from './sqliteTableEditor';

export interface SqliteQueryRangeFill {
  columns: string[];
  input: GridRangeFillInput;
}

/** 只使用整批已核验的原行，按用户看到的行列顺序生成一组类型化差异。 */
export function stageSqliteQueryRangeFill(editor: SqliteTableEditor, { columns, input }: SqliteQueryRangeFill): number {
  const page = editor.page, edit = page.edit, rows = editor.view.rows;
  const locator = edit?.kind === 'editable' ? edit.locator : undefined;
  if (edit?.kind !== 'editable' || !locator || !rows.length) throw Error(text.stale);
  const fields = columns.map(name => edit.columns.findIndex(field => field.name === name));
  if (fields.some(index => index < 0)) throw Error(text.stale);
  const side = input.kind === 'left' || input.kind === 'right' ? gridRangeFillColumns(fields, input.kind) : undefined;
  const vertical = input.kind === 'up' || input.kind === 'down'
    ? gridRangeFillSource({ rows, startRow: 0, keys: columns }, input.kind, row => row.deleted) : undefined;
  const targets = side?.targets ?? fields, affectedRows = vertical?.rows ?? rows;
  if (new Set(targets).size !== targets.length || targets.some(index => {
    const field = edit.columns[index];
    return field.primary || field.generated || locator.columns.includes(field.name);
  })) throw Error(text.target);
  if (affectedRows.length * targets.length > sqliteTableEditLimits.cells) throw Error(text.limit);
  const entered = side || vertical ? undefined : sqliteEditValueSchema.parse(input.kind === 'null'
    ? { kind: 'null' } : { kind: input.kind, value: input.value });
  const patches = affectedRows.map(row => ({
    rowId: row.id,
    fields: targets.map(column => {
      const value: SqliteEditValue = entered ?? sqliteEditValueSchema.parse(side ? row.values[side.source] : vertical?.source.values[column]);
      const field = edit.columns[column];
      if (!sqliteColumnAcceptsTransferValue(field, !!edit.strict, value, !!(side || vertical))) throw Error(text.incompatible(field.name));
      return { column, value };
    }),
  }));
  return editor.editRecords(prepareSqliteFill(page, rows, affectedRows), patches);
}
