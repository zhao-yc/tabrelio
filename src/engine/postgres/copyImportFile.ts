import { constants, type BigIntStats } from 'node:fs';
import { lstat, open, type FileHandle } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parse as streamCsv } from 'csv-parse';
import { parse } from 'csv-parse/sync';
import { csvImportColumnName, csvImportDelimiter, csvImportHasHeader, csvRangeInvalid, csvRangeOption, validCsvRange, type CsvImportDelimiter } from '../../shared/csvImport';
import { importRecordRange, type ImportRecordRange } from '../../shared/importRecordRange';

const headerLimit = 256 * 1024;
const sampleRows = 5, sampleColumns = 12, sampleCellLength = 120;
const fileLimit = 10n * 1024n ** 3n;
const utf8Bom = Buffer.from([0xef, 0xbb, 0xbf]);
const changed = 'CSV 文件已变化，请重新选择并核对列映射';
export interface PostgresCopySource {
  path: string;
  version: string;
  bytes: number;
  offset: number;
  delimiter: CsvImportDelimiter;
  hasHeader: boolean;
  header: string[];
  selection?: { end: number; records: number };
}
type NativeRecord = (Buffer | null)[];

/** 二进制解析保留 NULL 和带引号空串的区别。 */
function nativeCell(value: string | Buffer, context: { quoting: boolean }) {
  return value.length || context.quoting ? value : null;
}

/** 只打开本地普通文件，版本同时含物理身份和纳秒修改时钟。 */
function version(stat: BigIntStats) {
  if (!stat.isFile() || stat.ino <= 0n || stat.size < 1n || stat.size > fileLimit)
    throw Error('请选择非空且不超过 10 GiB 的普通 CSV 文件');
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
}

/** 复核打开的句柄及原路径，文件替换或在途修改都不能通过提交门。 */
async function assertVersion(path: string, handle: FileHandle, expected: string) {
  if (version(await handle.stat({ bigint: true })) !== expected ||
      version(await lstat(path, { bigint: true })) !== expected) throw Error(changed);
}

/** 避免被替换为链接或管道后转读其它来源，Windows 仍以句柄和路径身份双核对。 */
function openRead(path: string) {
  return open(path, constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW | constants.O_NONBLOCK));
}

/** 解析有界前缀，保留已读完整记录，正文仍交给 PostgreSQL 校验和导入。 */
function readPreview(input: Buffer, delimiter: CsvImportDelimiter, hasHeader: boolean, more: boolean) {
  const records: NativeRecord[] = [];
  const limit = sampleRows + Number(hasHeader);
  let sampleLimited = false;
  try {
    parse(input, {
      delimiter, encoding: null, to: limit,
      // CSV 解析器在二进制模式下把 Buffer 传给 cast；引用状态区分 NULL 和空字符串。
      cast(value, context) { return nativeCell(value, context); },
      on_record(record, info) {
        const end = info.bytes;
        // 只有从文件实际读完或确认遇到记录边界，才采用这条记录。
        if (end <= headerLimit && (!more || [10, 13].includes(input[end - 1])))
          records.push(record as unknown as NativeRecord);
        else sampleLimited = true;
        return null;
      },
    });
  } catch { sampleLimited = true; }
  return summarize(records, hasHeader, sampleLimited || more && records.length < limit);
}

function summarize(records: NativeRecord[], hasHeader: boolean, sampleLimited: boolean) {
  const first = records[0];
  const invalid = hasHeader ? 'CSV 表头无效或超过大小限制，请检查 UTF-8 文件和分隔符' :
    '无法从文件前 256 KiB 读取完整首条 CSV 记录，请检查 UTF-8 文件和分隔符';
  if (!first?.length || first.length > 1022) throw Error(invalid);
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  let header: string[];
  try {
    header = first.map((value, index) => {
      const name = value === null ? '' : decoder.decode(value);
      if (name.includes('\0') || hasHeader && name.length > 512) throw Error(invalid);
      return hasHeader ? name : csvImportColumnName(index);
    });
  } catch { throw Error(invalid); }
  const sample: (string | null)[][] = [];
  for (const record of records.slice(Number(hasHeader))) {
    try {
      const row = record.map(value => value === null ? null : decoder.decode(value));
      if (row.some(value => value?.includes('\0'))) throw Error();
      sample.push(row.slice(0, sampleColumns).map(value => value && value.length > sampleCellLength
        ? value.slice(0, sampleCellLength).replace(/[\uD800-\uDBFF]$/, '') + '…' : value));
    } catch { sampleLimited = true; break; }
  }
  return { header, sample, sampleLimited };
}

/** 流式确定原字节边界，选中的数据连续发送，保留 PostgreSQL 的原生 CSV 值语义。 */
async function inspectCopyRange(stream: Readable, delimiter: CsvImportDelimiter,
  range: ReturnType<typeof importRecordRange>, bom: number, check: () => void, complete: boolean) {
  const { headerRow, firstDataRow, lastDataRow } = range;
  const hasHeader = headerRow > 0;
  const parser = streamCsv({
    delimiter, encoding: null, info: true, relax_column_count: true, max_record_size: 64 * 1024 * 1024,
    cast(value, context) { return nativeCell(value, context); },
  });
  // 多选逐份完整检查原字节编码，列数只约束所选数据，允许范围外有说明和汇总。
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const encoding = complete ? new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      try { decoder.decode(chunk, { stream: true }); callback(null, chunk); }
      catch (error) { callback(error as Error); }
    },
    flush(callback) {
      try { decoder.decode(); callback(); }
      catch (error) { callback(error as Error); }
    },
  }) : undefined;
  const done = encoding ? pipeline(stream, encoding, parser) : pipeline(stream, parser);
  void done.catch(() => undefined);
  const sample: NativeRecord[] = [];
  let previous = bom, offset = -1, end = -1, records = 0, sampleBytes = 0, width = 0;
  try {
    for await (const { record, info } of parser as AsyncIterable<{ record: NativeRecord; info: { bytes: number; records: number } }>) {
      check();
      const start = previous;
      previous = info.bytes + bom;
      if (info.records === headerRow || !hasHeader && info.records === firstDataRow) {
        if (previous - start > headerLimit) throw Error('字段名记录或首条数据超过预览大小限制');
        width = record.length;
        // 具名字段只用于映射，数据的 COPY 字节区间从第一条选中数据开始。
        if (hasHeader) sample.push(record);
      }
      if (info.records < firstDataRow || info.records > lastDataRow) continue;
      if (complete && (record.length !== width || record.some(value => value?.includes(0))))
        throw Error('CSV 记录列数与字段名不符，或含有不支持的空字节');
      if (records === 0) offset = start;
      records++;
      end = previous;
      if (records <= sampleRows && sampleBytes + end - start <= headerLimit) {
        sample.push(record);
        sampleBytes += end - start;
      } else sampleBytes = headerLimit;
    }
    await done;
  } catch {
    check();
    throw Error('无法读取 PostgreSQL CSV 记录范围，请检查文件格式、引号和记录号');
  } finally {
    await done.catch(() => undefined);
  }
  if (!records) throw Error('指定范围没有可导入的 CSV 数据');
  return { offset, selection: { end, records }, ...summarize(sample, hasHeader, records > sample.length - Number(hasHeader)) };
}

/** 文件授权固定记录解释及字节边界，样本单独返回。 */
export async function inspectPostgresCopySource(path: string, delimiter: CsvImportDelimiter, csvHasHeader?: boolean,
  csvRowRange?: ImportRecordRange, check = () => {}, complete = false) {
  if (!isAbsolute(path) || path.includes('\0')) throw Error('未取得授权 CSV 文件路径');
  csvImportDelimiter('csv', delimiter);
  const hasHeader = csvImportHasHeader('csv', csvHasHeader);
  if (!validCsvRange({ csvHasHeader, ...csvRangeOption(csvRowRange) })) throw Error(csvRangeInvalid);
  const range = importRecordRange(hasHeader, csvRowRange);
  const fullScan = range.skipsRecords || complete;
  const stat = await lstat(path, { bigint: true });
  const expected = version(stat), bytes = Number(stat.size);
  const handle = await openRead(path);
  try {
    await assertVersion(path, handle, expected);
    const prefix = Buffer.allocUnsafe(Math.min(bytes, fullScan ? utf8Bom.length : headerLimit + utf8Bom.length + 1));
    let length = 0;
    while (length < prefix.length) {
      const { bytesRead } = await handle.read(prefix, length, prefix.length - length, length);
      if (!bytesRead) throw Error(changed);
      length += bytesRead;
    }
    const offset = prefix.subarray(0, 3).equals(utf8Bom) ? 3 : 0;
    if (fullScan) {
      if (offset === bytes) throw Error('指定范围没有可导入的 CSV 数据');
      const stream = handle.createReadStream({ autoClose: false, start: offset, end: bytes - 1 });
      const { offset: start, selection, header, sample, sampleLimited } = await inspectCopyRange(stream, delimiter, range, offset, check, complete);
      await assertVersion(path, handle, expected);
      const source: PostgresCopySource = { path, version: expected, bytes, offset: start, delimiter, hasHeader: false, header, selection };
      return { source, sample, sampleLimited };
    }
    const { header, sample, sampleLimited } = readPreview(prefix.subarray(offset), delimiter, hasHeader, bytes > length);
    await assertVersion(path, handle, expected);
    const source: PostgresCopySource = { path, version: expected, bytes, offset, delimiter, hasHeader, header };
    return { source, sample, sampleLimited };
  } finally { await handle.close(); }
}

/** 按已检查文件的准确字节范围推送 COPY，读完再核路径和版本。 */
export async function readPostgresCopySource(source: PostgresCopySource,
  consume: (stream: Readable) => Promise<number>): Promise<number> {
  const { path, version: expected, offset, bytes, selection } = source;
  if (version(await lstat(path, { bigint: true })) !== expected) throw Error(changed);
  const handle = await openRead(path);
  try {
    await assertVersion(path, handle, expected);
    const end = selection?.end ?? bytes;
    const stream = handle.createReadStream({ autoClose: false, start: offset, end: end - 1 });
    const checked = Readable.from(checkCopyEndMarker(stream), { objectMode: false });
    try {
      const rows = await consume(checked);
      if (stream.bytesRead !== end - offset) throw Error(changed);
      await assertVersion(path, handle, expected);
      if (selection && rows !== selection.records) throw Error('PostgreSQL COPY 回执与选中的 CSV 记录数不一致');
      return rows;
    } finally { checked.destroy(); stream.destroy(); }
  } finally { await handle.close(); }
}

/** 旧版本可能把单独一行的未引用反斜线加句点解释为结束标记。跨块追踪原字节及引号，避免静默丢尾行。 */
async function* checkCopyEndMarker(stream: Readable): AsyncGenerator<Buffer> {
  let quoted = false, marker = 0;
  const check = () => {
    if (marker === 2) throw Error('CSV 中单独一行的反斜线加句点需要用双引号包围');
  };
  for await (const chunk of stream) {
    for (const byte of chunk as Buffer) {
      if (byte === 34) quoted = !quoted;
      if (!quoted && (byte === 10 || byte === 13)) { check(); marker = 0; }
      else if (marker === 0 && byte === 92) marker = 1;
      else if (marker === 1 && byte === 46) marker = 2;
      else marker = -1;
    }
    yield chunk;
  }
  check();
}
