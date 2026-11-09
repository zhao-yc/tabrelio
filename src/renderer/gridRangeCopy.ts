import { encodeGridCsv, encodeGridJson, writeTableClipboardEvent, type ClipboardCell } from './gridClipboard';
import { gridRangeCopyZh as text } from './locales/gridRangeCopy.zh-CN';

export function gridRangeCopyActions(copy: (format: 'plain' | 'headers' | 'csv' | 'json') => void) {
  return [
    { label: text.copy, run: () => copy('plain') },
    { label: text.withHeaders, run: () => copy('headers') },
    { label: text.csv, run: () => copy('csv') },
    { label: text.json, run: () => copy('json') },
  ];
}

/** 按选区列序使用现有编码器。仅写纯文本，以免应用内粘贴把 CSV 或 JSON 当作普通选区。 */
export function copyGridRangeText<Value>(names: readonly string[], rows: readonly (readonly Value[])[],
  format: 'csv' | 'json', current: () => boolean, convert: (value: Value) => ClipboardCell): void {
  const columns = names.map((name, index) => ({ name, key: String(index) }));
  const encode = format === 'csv' ? encodeGridCsv : encodeGridJson;
  const content = encode(columns, rows, (row, key) => convert(row[Number(key)]));
  writeTableClipboardEvent(current, data => data.setData('text/plain', content));
}
