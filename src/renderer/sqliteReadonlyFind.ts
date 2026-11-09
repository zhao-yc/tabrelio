import type { CellValue } from '../shared/contracts';
import { copySqliteResultStorage } from '../shared/sqliteResultStorage';
import type { SqliteTablePage } from '../shared/sqliteTableBrowse';
import type { SqliteOriginalValue } from '../shared/sqliteTableEdit';
import { cellText } from './lib';
import type { SqliteDraftRow } from './sqliteTableEditor';
import { sqliteFindLimits as limits, sqliteFindMessages } from './sqliteTableFind';

const invalid = () => Error(sqliteFindMessages.invalid);

export interface SqliteReadonlyFindSource {
  readonly rows: SqliteDraftRow[];
  current(): boolean;
}

/** 只读页使用浏览结果的逐格存储类型；原页没有类型事实时拒绝推断或授予编辑资格。 */
export function captureSqliteReadonlyFind(page: SqliteTablePage, visible: ReadonlySet<number>): SqliteReadonlyFindSource {
  if (!page.storageTypes || page.edit?.kind === 'editable') throw invalid();
  visible = new Set(visible);
  const result = page.result, columns = result.columns, originalRows = result.rows, types = page.storageTypes;
  const storage = copySqliteResultStorage({ version: 1, rows: types }, columns, originalRows);
  if (!visible.size || [...visible].some(index => !Number.isInteger(index) || !columns[index]) || columns.length !== page.columns.length || columns.some((column, index) => column.name !== page.columns[index].name)) throw invalid();
  const metadata = columns.map(column => ({ column, key: column.key, name: column.name, type: column.type }));
  let units = 0;
  const source = originalRows.map((row, index) => {
    const stamps: (string | null)[] = [];
    const values: (SqliteOriginalValue | undefined)[] = metadata.map(({ key }, column) => {
      if (!visible.has(column)) return;
      const code = storage.rows[index][column], value = Object.getOwnPropertyDescriptor(row, key)?.value as CellValue | undefined;
      const raw = value && typeof value === 'object' ? value.base64 : value;
      if (code === 'n') { stamps[column] = null; return { kind: 'null' }; }
      if (typeof raw !== 'string') throw invalid();
      stamps[column] = raw;
      units += code === 'b' ? raw.length * 1.5 : raw.length;
      if (units > limits.bytes) throw Error(sqliteFindMessages.budget);
      if (code !== 'b') return { kind: code === 'i' ? 'integer' : code === 'r' ? 'real' : 'text', value: raw };
      return { kind: 'blob', value: cellText({ type: 'binary', base64: raw }).slice(2) };
    });
    return { row, stamps, draft: { id: String(index), index, deleted: false, values } };
  });
  let live = true;
  return {
    rows: source.map(item => item.draft),
    current() {
      if (!live) return false;
      try {
        live = page.edit?.kind !== 'editable' && page.result === result && result.rows === originalRows && result.columns === columns &&
          page.storageTypes === types && types.length === source.length && originalRows.length === source.length &&
          columns.length === metadata.length && metadata.every(({ column, key, name, type }, index) =>
            columns[index] === column && column.key === key && column.name === name && column.type === type) &&
          source.every(({ row, stamps }, index) => originalRows[index] === row && types[index] === storage.rows[index] &&
            metadata.every(({ key }, column) => {
              if (!visible.has(column)) return true;
              const value = Object.getOwnPropertyDescriptor(row, key)?.value as CellValue | undefined;
              return storage.rows[index][column] === 'b'
                ? !!value && typeof value === 'object' && Object.getOwnPropertyDescriptor(value, 'type')?.value === 'binary' &&
                  Object.getOwnPropertyDescriptor(value, 'base64')?.value === stamps[column]
                : Object.is(value, stamps[column]);
            }));
      } catch { live = false; }
      return live;
    },
  };
}
