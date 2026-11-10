import { copyGridColumnNames, encodeGridCsv, encodeGridJson, writeTableClipboardEvent, type ClipboardCell } from './gridClipboard';
import { gridRangeCopyZh as text } from './locales/gridRangeCopy.zh-CN';
import { gridHeaderMenuZh as headerText } from './locales/gridHeaderMenu.zh-CN';

export function gridRangeCopyActions(copy: (format: 'plain' | 'headers' | 'names' | 'csv' | 'json') => void) {
  return [
    { label: text.copy, run: () => copy('plain') },
    { label: text.withHeaders, run: () => copy('headers') },
    { label: text.namesOnly, run: () => copy('names') },
    { label: text.csv, run: () => copy('csv') },
    { label: text.json, run: () => copy('json') },
  ];
}

/** 两个入口只改变外部文本是否带列名，内部粘贴始终读取同一组数据行。 */
export function gridHeaderDataCopyActions(column: boolean, copy: (headers: boolean) => void) {
  return [
    { label: column ? headerText.copyColumnData : headerText.copyRowData, run: () => copy(false) },
    { label: column ? headerText.copyColumnDataWithName : headerText.copyRowDataWithNames, run: () => copy(true) },
  ];
}

/** 按原列键取显示名称，保留重复或空名称；本入口不读取选区的行值。 */
export function copyGridRangeNames(keys: readonly string[] | undefined, columns: readonly { key: string; name: string }[],
  current: () => boolean): void {
  if (!keys || !current()) return;
  const namesByKey = new Map(columns.map(column => [column.key, column.name]));
  const names: string[] = [];
  for (const key of keys) {
    const name = namesByKey.get(key);
    if (name === undefined) return;
    names.push(name);
  }
  copyGridColumnNames(names, current);
}

/** 按选区列序使用现有编码器。仅写纯文本，以免应用内粘贴把 CSV 或 JSON 当作普通选区。 */
export function copyGridRangeText<Value>(names: readonly string[], rows: readonly (readonly Value[])[],
  format: 'csv' | 'json', current: () => boolean, convert: (value: Value) => ClipboardCell): void {
  const columns = names.map((name, index) => ({ name, key: String(index) }));
  const encode = format === 'csv' ? encodeGridCsv : encodeGridJson;
  const content = encode(columns, rows, (row, key) => convert(row[Number(key)]));
  writeTableClipboardEvent(current, data => data.setData('text/plain', content));
}
