import { crc32 } from 'node:zlib';
import { fromBufferPromise, type Entry, type ZipFile } from 'yauzl';
import type { QueryFileEncoding } from '../shared/contracts';
import { savedQueryImportArchiveLimits as archiveLimits, savedQueryImportLimits } from '../shared/savedQuerySearch';
import { decodeQueryFile, importedQueryName, queryFileLimit } from './queryFiles';

/** 条目只转为内存中的 SQL，压缩包路径不会用于文件系统操作。 */
export async function readQuerySqlArchive(bytes: Buffer, encoding: QueryFileEncoding, check: () => void): Promise<{ name: string; sql: string }[]> {
  if (bytes.length > archiveLimits.archiveBytes) throw Error('ZIP 文件超过 34 MiB');
  const zip = await fromBufferPromise(bytes, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true })
    .catch(() => { throw Error('无法读取 ZIP 目录'); });
  try {
    if (zip.entryCount > archiveLimits.files) throw Error('ZIP 条目超过 1000 个');
    const entries = zip.eachEntry(), names = new Set<string>(), files: { name: string; sql: string }[] = [];
    let total = 0;
    for (let index = 0; index < zip.entryCount; index++) {
      check();
      const { value: entry, done } = await entries.next().catch(() => { throw Error('ZIP 条目目录无效'); });
      check();
      if (done) throw Error('ZIP 条目数量与目录不一致');
      const directory = entry.fileName.endsWith('/');
      const path = directory ? entry.fileName.slice(0, -1) : entry.fileName;
      const segments = path.split('/');
      const key = path.normalize('NFC').toLowerCase();
      const unixType = entry.versionMadeBy >>> 8 === 3 ? (entry.externalFileAttributes >>> 16) & 0xf000 : 0;
      if (segments.some(segment => !segment || segment === '.' || segment === '..' || /[\\:\u0000-\u001f\u007f-\u009f]/.test(segment)) ||
          names.has(key) || unixType && unixType !== (directory ? 0x4000 : 0x8000))
        throw Error('ZIP 包含重复或不支持的条目名称或文件类型');
      names.add(key);
      if (directory) {
        if (entry.uncompressedSize !== 0) throw Error('ZIP 目录条目不能包含文件正文');
        continue;
      }
      const fileName = segments.at(-1)!;
      if (!/\.sql$/i.test(fileName)) throw Error('ZIP 只能包含 SQL 文件和目录');
      if (!entry.canDecodeFileData()) throw Error('ZIP 包含加密或无法解压的 SQL 文件');
      if (entry.uncompressedSize > queryFileLimit) throw Error('ZIP 内单个 SQL 文件超过 20 MiB');
      total += entry.uncompressedSize;
      if (total > savedQueryImportLimits.bytes) throw Error('ZIP 内 SQL 文件解压后合计超过 32 MiB');
      const data = await readSqlEntry(zip, entry, check);
      files.push({ name: importedQueryName(fileName), sql: decodeQueryFile(data, encoding).sql });
    }
    check();
    if (!files.length) throw Error('ZIP 中没有可导入的 SQL 文件');
    return files;
  } finally { zip.close(); }
}

/** 逐条读有界字节，验证实际大小及 CRC 后才交给原 SQL 解码器。 */
async function readSqlEntry(zip: ZipFile, entry: Entry, check: () => void): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let length = 0, checksum = 0;
  try {
    const stream = await zip.openReadStreamPromise(entry);
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      check();
      length += chunk.length;
      if (length > entry.uncompressedSize) throw Error('大小与目录不一致');
      checksum = crc32(chunk, checksum);
      chunks.push(chunk);
    }
  } catch {
    check();
    throw Error('ZIP 内 SQL 文件解压失败或大小与目录不一致');
  }
  if (length !== entry.uncompressedSize || checksum !== entry.crc32) throw Error('ZIP 内 SQL 文件校验失败');
  return Buffer.concat(chunks, length);
}
