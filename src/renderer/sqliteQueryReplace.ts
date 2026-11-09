import type { QueryResult, ResultColumn } from '../shared/contracts';
import { sqliteQueryEditMaxRows } from '../shared/sqliteTableBrowse';
import { sqliteTableEditLimits } from '../shared/sqliteTableEdit';
import type { DraftRow } from './dataChanges';
import { ownCell } from './lib';
import { sqliteResultOriginsZh as text } from './locales/sqliteResultOrigins.zh-CN';
import type { PageTextPatch } from './pageFindReplace';
import type { SqliteTableEditor } from './sqliteTableEditor';

interface Patch { row: number; column: ResultColumn; field: string; before: string; after: string }
export interface SqliteQueryReplacePlan {
  positions: number[];
  patches: Patch[];
}

/** 搜索仍使用完整结果。替换线程只接收已核对来源的原生 TEXT 格，不把数字显示文本当作原值。 */
export function sqliteQueryReplacementRows(result: QueryResult, fields: ReadonlyMap<string, string>): DraftRow[] {
  const columns = result.columns.flatMap((column, index) => fields.has(column.key) ? [{ key: column.key, index }] : []);
  return result.rows.map((row, index) => {
    const storage = result.sqliteStorage?.rows[index];
    const data = Object.fromEntries(columns.flatMap(column => {
      const value = ownCell(row, column.key);
      return storage?.[column.index] === 't' && typeof value === 'string' ? [[column.key, value]] : [];
    }));
    return { id: String(index), data, inserted: false, deleted: false };
  });
}

/** 用当前显示位置和原存储类复核线程回包。同一行重复投影的原字段只写一次。 */
export function planSqliteQueryReplace(rows: readonly DraftRow[], visible: readonly ResultColumn[],
  fields: ReadonlyMap<string, string>, input: readonly PageTextPatch[]): SqliteQueryReplacePlan {
  const columns = new Map(visible.map(column => [column.key, column]));
  const patches = new Map<string, Patch>();
  for (const { rowId, key, before, after } of input) {
    const row = Number(rowId), column = columns.get(key), field = fields.get(key);
    if (!Number.isSafeInteger(row) || String(row) !== rowId || !column || !field || typeof before !== 'string' || typeof after !== 'string' ||
        !rows[row] || ownCell(rows[row].data, key) !== before) throw Error(text.editStale);
    if (before === after) continue;
    const identity = JSON.stringify([row, field]), previous = patches.get(identity);
    if (previous && (previous.before !== before || previous.after !== after)) throw Error(text.editStale);
    if (!previous) patches.set(identity, { row, column, field, before, after });
  }
  if (!patches.size) throw Error(text.replaceNoChange);
  const changes = [...patches.values()], positions = [...new Set(changes.map(patch => patch.row))].sort((a, b) => a - b);
  if (positions.length > sqliteQueryEditMaxRows || changes.length > sqliteTableEditLimits.cells) throw Error(text.replaceLimit);
  return { positions, patches: changes };
}

/** 独立快照按原字段重新解析列位置，整批复核 TEXT 旧值后才交已有编辑器暂存。 */
export function stageSqliteQueryReplace(editor: SqliteTableEditor, plan: SqliteQueryReplacePlan): number {
  const edit = editor.page.edit, rows = editor.view.rows;
  if (edit?.kind !== 'editable' || !edit.locator || plan.positions.length !== rows.length) throw Error(text.editStale);
  const lookup = new Map(plan.positions.map((position, index) => [position, rows[index]]));
  const columns = new Map(edit.columns.map((column, index) => [column.name, { column, index }]));
  const keys = new Set(edit.locator.columns);
  const patches = plan.patches.map(({ row, field, before, after }) => {
    const original = lookup.get(row), target = columns.get(field);
    if (!original || !target || target.column.generated || target.column.primary || keys.has(field)) throw Error(text.editStale);
    return { rowId: original.id, column: target.index, before, after };
  });
  return editor.replaceTextCells(patches);
}
