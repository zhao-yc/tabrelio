import { zh } from './locales/zh-CN';
import type { CellValue } from '../shared/contracts';
import type { DraftRow } from './dataChanges';
import { cellText } from './lib';
import { binaryByteLength } from './binaryCell';
import { tableHeaderCopyZh } from './locales/tableHeaderCopy.zh-CN';
import { resultExportColumns, resultExportLimits } from '../shared/resultExport';
import { gridJsonClipboardZh } from './locales/gridJsonClipboard.zh-CN';
import { gridCsvClipboardZh } from './locales/gridCsvClipboard.zh-CN';
import { csvCell, csvHeader } from '../shared/csvExport';

export const cellClipboardType = 'application/x-dbark-cells';
/** undefined 仅表示新增行尚未填写的 DEFAULT，不能编码成实际 NULL。 */
export type ClipboardCell = CellValue | undefined;
export const maxClipboardCharacters = 10_000_000;
export const maxClipboardCells = 50_000;

/** 仅需要更小行数预算的入口显式传入；普通网格复制粘贴继续使用原上限。 */
export interface ClipboardRowBudget { maximum: number; message: string; }

/** 沿原TSV词法只计数，不创建单元格字符串或行数组；引号内换行不产生新行。 */
function assertTabularRowBudget(text: string, budget: ClipboardRowBudget) {
  let rows = 0, quoted = false, content = false, hasCells = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { content = true; index++; }
      else if (char === '"') quoted = false;
      else content = true;
    } else if (char === '"' && !content) { quoted = true; hasCells = true; }
    else if (char === '\t') { hasCells = true; content = false; }
    else if (char === '\n' || char === '\r') {
      if (++rows > budget.maximum) throw new Error(budget.message);
      content = false; hasCells = false; if (char === '\r' && text[index + 1] === '\n') index++;
    } else content = true;
  }
  if (quoted) throw new Error(zh.clipboard.text003);
  // 末尾换行不制造新行，明确写出的空引号仍是一格。
  if ((content || hasCells || !rows) && rows + 1 > budget.maximum) throw new Error(budget.message);
}

/** 兼容电子表格的制表符格式，保留被引号包裹的换行、制表符和双引号。 */
export function parseTabularText(text: string): string[][] {
  if (text.length > maxClipboardCharacters) throw new Error(zh.clipboard.text001);
  const rows: string[][] = []; let row: string[] = [], value = '', quoted = false, explicitCell = false, cells = 0;
  /** 每个分隔符完成一个单元格，并在构建矩阵时限制总规模。 */
  const addCell = () => { row.push(value); value = ''; explicitCell = false; if (++cells > maxClipboardCells) throw new Error(zh.clipboard.text002); };
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { value += '"'; index++; }
      else if (char === '"') quoted = false;
      else value += char;
    } else if (char === '"' && value === '') { quoted = true; explicitCell = true; }
    else if (char === '\t') addCell();
    else if (char === '\n' || char === '\r') { addCell(); rows.push(row); row = []; if (char === '\r' && text[index + 1] === '\n') index++; }
    else value += char;
  }
  if (quoted) throw new Error(zh.clipboard.text003);
  if (value !== '' || explicitCell || row.length || !rows.length) { addCell(); rows.push(row); }
  return rows;
}

/** 计量转义后的字符数，配对代理项原样保留，孤立代理项按 JSON 的六字符转义计算。 */
function measureClipboardString(value: string, plainAvailable: number, typedAvailable = Infinity) {
  let plain = value.length, typed = value.length + 2, quoted = false;
  if (plain > plainAvailable || typed > typedAvailable) throw new Error(zh.clipboard.copySizeLimit);
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code === 34) { plain++; quoted = true; }
    else if (code === 9 || code === 10 || code === 13) quoted = true;
    if (code === 34 || code === 92 || code === 8 || code === 9 || code === 10 || code === 12 || code === 13) typed++;
    else if (code < 32) typed += 5;
    else if (code >= 0xd800 && code <= 0xdfff) {
      const next = value.charCodeAt(index + 1);
      if (code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) index++;
      else typed += 5;
    }
    if (plain + (quoted ? 2 : 0) > plainAvailable || typed > typedAvailable) throw new Error(zh.clipboard.copySizeLimit);
  }
  return { plain: plain + (quoted ? 2 : 0), typed };
}

const clipboardEmptyPacket = '{"version":1,"rows":[]}';
const clipboardDefault = { type: 'default' } as const;
const clipboardBinaryOverhead = '{"type":"binary","base64":""}'.length;

/** 编码前累计两种格式的预算，超限时不生成矩阵文本或解码二进制。 */
function assertClipboardSize(values: ClipboardCell[][], headers?: readonly string[]): void {
  let plain = Math.max(0, values.length - 1), typed = clipboardEmptyPacket.length + values.length * 2 + plain;
  if (headers) {
    plain += 1 + Math.max(0, headers.length - 1);
    for (const name of headers) plain += measureClipboardString(name, maxClipboardCharacters - plain).plain;
  }
  for (const row of values) {
    const separators = Math.max(0, row.length - 1);
    plain += separators;
    typed += separators;
    for (const value of row) {
      if (typeof value === 'string') {
        const size = measureClipboardString(value, maxClipboardCharacters - plain, maxClipboardCharacters - typed);
        plain += size.plain;
        typed += size.typed;
      } else if (value && typeof value === 'object') {
        plain += 2 + binaryByteLength(value)! * 2;
        typed += clipboardBinaryOverhead + value.base64.length;
      } else {
        plain += cellText(value).length;
        typed += JSON.stringify(value === undefined ? clipboardDefault : value).length;
      }
      if (plain > maxClipboardCharacters || typed > maxClipboardCharacters) throw new Error(zh.clipboard.copySizeLimit);
    }
  }
  if (plain > maxClipboardCharacters || typed > maxClipboardCharacters) throw new Error(zh.clipboard.copySizeLimit);
}

/** 外部程序读取通用 TSV；DBArk 内部复制额外保存 NULL 和二进制类型。 */
export function encodeClipboard(values: ClipboardCell[][], headers?: readonly string[]) {
  if (values.reduce((count, row) => count + row.length, headers?.length ?? 0) > maxClipboardCells) throw new Error(zh.clipboard.copyLimit);
  assertClipboardSize(values, headers);
  /** 仅对含分隔符或引号的值加引号，确保电子表格可完整还原单元格边界。 */
  const quote = (value: ClipboardCell) => { const text = cellText(value); return /[\t\r\n"]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text; };
  const typed = JSON.stringify({ version: 1, rows: values.map(row => row.map(value => value === undefined ? clipboardDefault : value)) });
  if (typed.length > maxClipboardCharacters) throw new Error(zh.clipboard.copySizeLimit);
  const body = values.map(row => row.map(quote).join('\t')).join('\n');
  const text = headers ? headers.map(quote).join('\t') + '\n' + body : body;
  if (text.length > maxClipboardCharacters) throw new Error(zh.clipboard.copySizeLimit);
  return { text, typed };
}

/** JSON 使用与文件导出相同的列名映射。按格校验和计量，完整编码后才允许写剪贴板。 */
export function encodeGridJson<Row>(columns: readonly { key: string; name: string }[], rows: readonly Row[],
  read: (row: Row, key: string) => ClipboardCell): string {
  if (!columns.length || columns.length > resultExportLimits.columns || !rows.length) throw Error(gridJsonClipboardZh.invalid);
  if (columns.length * rows.length > maxClipboardCells) throw Error(zh.clipboard.copyLimit);
  if (columns.some(column => typeof column.name !== 'string' || column.name.length > 1024 ||
      typeof column.key !== 'string' || !column.key) || new Set(columns.map(column => column.key)).size !== columns.length)
    throw Error(gridJsonClipboardZh.invalid);
  const names = resultExportColumns(columns.map(({ key, name }) => ({ key, name })))
    .map(({ key, exportName }) => ({ key, label: JSON.stringify(exportName) + ': ' }));
  const parts: string[] = [];
  let units = 0;
  function append(part: string) {
    units += part.length;
    if (units > maxClipboardCharacters) throw Error(zh.clipboard.copySizeLimit);
    parts.push(part);
  }
  function encode(value: CellValue): string {
    const available = maxClipboardCharacters - units;
    if (typeof value === 'string') {
      measureClipboardString(value, Infinity, available);
      return JSON.stringify(value);
    }
    if (value === null || typeof value === 'boolean' ||
        typeof value === 'number' && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value)))
      return JSON.stringify(value);
    if (value && typeof value === 'object') {
      const type = Object.getOwnPropertyDescriptor(value, 'type')?.value;
      const base64 = Object.getOwnPropertyDescriptor(value, 'base64')?.value;
      if (type === 'binary' && typeof base64 === 'string' && Reflect.ownKeys(value).length === 2) {
        if (base64.length + clipboardBinaryOverhead > available) throw Error(zh.clipboard.copySizeLimit);
        const padding = base64.indexOf('=');
        if (base64.length % 4 === 0 && !/[^A-Za-z0-9+/=]/.test(base64) &&
            (padding < 0 || padding >= base64.length - 2 && /^={1,2}$/.test(base64.slice(padding))))
          return JSON.stringify({ type, base64 });
      }
    }
    throw Error(gridJsonClipboardZh.invalid);
  }
  append('[\n');
  rows.forEach((row, index) => {
    append(index ? ',\n  {' : '  {');
    let first = true;
    for (const { key, label } of names) {
      const value = read(row, key);
      // 编辑草稿的 DEFAULT 没有实际值，省略属性以区别于显式 NULL。
      if (value === undefined) continue;
      if (!first) append(', ');
      first = false;
      append(label);
      append(encode(value));
    }
    append('}');
  });
  append('\n]');
  return parts.join('');
}

/** 沿用文件 CSV 的列名和字段协议；未填写的默认值没有对应的 CSV 字段，整次复制拒绝。 */
export function encodeGridCsv<Row>(columns: readonly { key: string; name: string }[], rows: readonly Row[],
  read: (row: Row, key: string) => ClipboardCell): string {
  if (!columns.length || columns.length > resultExportLimits.columns || !rows.length ||
      columns.some(column => typeof column.name !== 'string' || column.name.length > 1024 || typeof column.key !== 'string' || !column.key) ||
      new Set(columns.map(column => column.key)).size !== columns.length) throw Error(gridCsvClipboardZh.invalid);
  if ((rows.length + 1) * columns.length > maxClipboardCells) throw Error(zh.clipboard.copyLimit);
  const names = resultExportColumns(columns.map(({ key, name }) => ({ key, name })));
  const parts = [names.map(column => csvHeader(column.exportName)).join(','), '\r\n'];
  let units = parts[0].length + 2;
  for (const row of rows) {
    for (const [index, { key }] of names.entries()) {
      const value = read(row, key);
      if (value === undefined) throw Error(gridCsvClipboardZh.defaultValue);
      if (typeof value === 'number' && (!Number.isFinite(value) || Number.isInteger(value) && !Number.isSafeInteger(value))) throw Error(gridCsvClipboardZh.invalid);
      if (typeof value === 'string' && value.length > maxClipboardCharacters - units) throw Error(zh.clipboard.copySizeLimit);
      if (value && typeof value === 'object') {
        const base64 = Object.getOwnPropertyDescriptor(value, 'base64')?.value;
        if (Object.getOwnPropertyDescriptor(value, 'type')?.value !== 'binary' || typeof base64 !== 'string' || Reflect.ownKeys(value).length !== 2)
          throw Error(gridCsvClipboardZh.invalid);
        if (base64.length + 7 > maxClipboardCharacters - units) throw Error(zh.clipboard.copySizeLimit);
        const padding = base64.indexOf('=');
        if (base64.length % 4 || /[^A-Za-z0-9+/=]/.test(base64) ||
            (padding >= 0 && (padding < base64.length - 2 || !/^={1,2}$/.test(base64.slice(padding))))) throw Error(gridCsvClipboardZh.invalid);
      }
      const field = csvCell(Object.is(value, -0) ? '-0' : value);
      const delimiter = index + 1 === names.length ? '\r\n' : ',';
      units += field.length + delimiter.length;
      if (units > maxClipboardCharacters) throw Error(zh.clipboard.copySizeLimit);
      parts.push(field, delimiter);
    }
  }
  return parts.join('');
}

/** 从显式复制入口同步写当前事件，不读取剪贴板，也不重试过期的操作。 */
export function writeTableClipboardEvent(current: () => boolean, write: (data: DataTransfer) => void, target: Document = document): void {
  if (!current()) throw Error(tableHeaderCopyZh.stale);
  let copied = false, failure: unknown;
  const copy = (event: ClipboardEvent) => {
    event.preventDefault(); event.stopImmediatePropagation();
    if (copied || failure) return;
    try {
      if (!current()) throw Error(tableHeaderCopyZh.stale);
      if (!event.clipboardData) throw Error(tableHeaderCopyZh.unavailable);
      write(event.clipboardData);
      copied = true;
    } catch (reason) {
      try { event.clipboardData?.clearData(); } catch { /* 只处理本次写入的格式。 */ }
      failure = reason;
    }
  };
  target.addEventListener('copy', copy, true);
  try {
    const accepted = target.execCommand('copy');
    if (failure) throw failure;
    if (!accepted || !copied) throw Error(tableHeaderCopyZh.unavailable);
  } finally { target.removeEventListener('copy', copy, true); }
}

/** 菜单只复制命中的一格，沿用网格键盘复制的文本和类型化格式。 */
export function copyGridCellValue(value: ClipboardCell, current: () => boolean): void {
  const content = encodeClipboard([[value]]);
  writeTableClipboardEvent(current, data => {
    data.setData('text/plain', content.text);
    data.setData(cellClipboardType, content.typed);
  });
}

/** 只写一行表头文本。即使只有一个空别名，也显式编码空字段，避免写空剪贴板。 */
export function copyGridColumnNames(names: readonly string[], current: () => boolean): void {
  if (!current() || !names.length || names.some(name => typeof name !== 'string')) throw Error(tableHeaderCopyZh.stale);
  const { text } = encodeClipboard([[...names]]);
  writeTableClipboardEvent(current, data => data.setData('text/plain', text || '""'));
}

/** 剪贴板属于外部输入，类型化数据必须逐格校验，不能直接信任 JSON 内容。 */
export function decodeClipboard(typed: string, text: string, rowBudget?: ClipboardRowBudget): ClipboardCell[][] {
  if (!typed) {
    if (rowBudget) { if (text.length > maxClipboardCharacters) throw new Error(zh.clipboard.text001); assertTabularRowBudget(text, rowBudget); }
    return parseTabularText(text);
  }
  if (typed.length > maxClipboardCharacters) throw new Error(zh.clipboard.text004);
  let payload: unknown;
  try { payload = JSON.parse(typed); } catch { throw new Error(zh.clipboard.text005); }
  if (!payload || typeof payload !== 'object' || !Object.hasOwn(payload, 'version') || !('version' in payload) || payload.version !== 1 || !Object.hasOwn(payload, 'rows') || !('rows' in payload) || !Array.isArray(payload.rows)) throw new Error(zh.clipboard.text006);
  // JSON解析完成后先核外层行数，空行也占预算，禁止先map整批再交调用方拒绝。
  if (rowBudget && payload.rows.length > rowBudget.maximum) throw new Error(rowBudget.message);
  let count = 0;
  return payload.rows.map((row: unknown) => {
    if (!Array.isArray(row)) throw new Error(zh.clipboard.text007);
    return row.map((value: unknown): ClipboardCell => {
      if (++count > maxClipboardCells) throw new Error(zh.clipboard.text008);
      if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return value;
      if (value && typeof value === 'object' && Object.hasOwn(value, 'type') && 'type' in value && value.type === 'default' && Object.keys(value).length === 1) return undefined;
      if (value && typeof value === 'object' && Object.hasOwn(value, 'type') && 'type' in value && value.type === 'binary' && Object.hasOwn(value, 'base64') && 'base64' in value && typeof value.base64 === 'string' && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.base64)) return { type: 'binary', base64: value.base64 };
      throw new Error(zh.clipboard.text009);
    });
  });
}

/** 先验证整个目标区域再整体暂存，越界、生成列和待删除行均不允许部分粘贴。 */
export function pasteCells(rows: DraftRow[], keys: string[], rowId: string, columnKey: string, values: ClipboardCell[][], generated: ReadonlySet<string>): DraftRow[] {
  const startRow = rows.findIndex(row => row.id === rowId), startColumn = keys.indexOf(columnKey);
  if (startRow < 0 || startColumn < 0) throw new Error(zh.clipboard.text010);
  if (!values.length) return rows;
  if (startRow + values.length > rows.length || values.some(row => startColumn + row.length > keys.length)) throw new Error(zh.clipboard.text011);
  values.forEach((row, rowIndex) => {
    if (rows[startRow + rowIndex].deleted) throw new Error(zh.clipboard.text012);
    if (!rows[startRow + rowIndex].inserted && row.some(value => value === undefined)) throw new Error(zh.clipboard.defaultExisting);
    row.forEach((_, columnIndex) => { if (generated.has(keys[startColumn + columnIndex])) throw new Error(zh.clipboard.text013); });
  });
  return rows.map((row, index) => {
    if (index < startRow || index >= startRow + values.length) return row;
    const pasted = values[index - startRow];
    const defaults = new Set(pasted.flatMap((value, columnIndex) => value === undefined ? [keys[startColumn + columnIndex]] : []));
    // 自有条目和安全计算属性构建新对象；DEFAULT 删除字段，不触发 __proto__ setter 或继承原型成员。
    const existing = defaults.size ? Object.fromEntries(Object.entries(row.data).filter(([key]) => !defaults.has(key))) : row.data;
    const patch = Object.fromEntries(pasted.flatMap((value, columnIndex) => value === undefined ? [] : [[keys[startColumn + columnIndex], structuredClone(value)]]));
    return { ...row, data: { ...existing, ...patch } };
  });
}
