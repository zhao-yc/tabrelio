import JSZip from 'jszip';
import { savedQueryArchiveLimits, type SavedQueryReadTextInput } from '../shared/savedQuerySearch';
import type { QueryFileEncoding } from '../shared/contracts';
import { encodeQueryFile, writeQueryFileBytes } from './queryFiles';

/** 序号保留选取顺序并解决同名；文件名仅是单个可移植的路径段。 */
function sqlEntryName(name: string, index: number, ordinalWidth: number): string {
  const safe = name.replace(/[^\p{L}\p{M}\p{N}\p{S} _().-]|[<>:"/\\|?*]/gu, '_').trim().replace(/\.sql$/iu, '');
  const stem = [...safe].slice(0, 50).join('').replace(/^[ .]+|[ .]+$/g, '');
  return `${String(index + 1).padStart(ordinalWidth, '0')}-${stem || '查询'}.sql`;
}

/** 每条脚本无损编码，全部核对后才生成一个 ZIP，任何失败都不发布部分归档。 */
export async function writeQuerySqlArchive(path: string, items: readonly SavedQueryReadTextInput[], read: (item: SavedQueryReadTextInput) => { name: string; sql: string }, check: () => void, encoding: QueryFileEncoding = 'utf8'): Promise<void> {
  const zip = new JSZip();
  const ordinalWidth = Math.max(3, String(items.length).length);
  let size = 0;
  for (const [index, item] of items.entries()) {
    check();
    const query = read(item);
    const content = encodeQueryFile(query.sql, encoding);
    size += content.length;
    if (size > savedQueryArchiveLimits.bytes) throw Error('所选 SQL 正文合计超过 32 MiB，未保存 ZIP');
    zip.file(sqlEntryName(query.name, index, ordinalWidth), content);
  }
  const archive = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
  await writeQueryFileBytes(path, archive, check);
}
