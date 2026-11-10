import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeQuerySqlArchive } from '../../src/main/querySqlArchive';
import { validateCommand } from '../../src/shared/validation';
import { savedQueryArchiveLimits } from '../../src/shared/savedQuerySearch';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const refs = ['甲', '乙'].map(id => ({ id, digest: 'a'.repeat(64) }));
const sql = ["-- 😀\r\nDELIMITER $$\nSELECT 9007199254740993$$", 'SELECT 2;\r\n'];
const record = (id: string, index: number, name = '../COM1\uD800.SQL') => ({ id, sql: sql[index], name, updatedAt: '2026-11-03' });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dbark-query-archive-'));
  roots.push(root);
  const target = join(root, '查询.zip');
  return { root, target };
}

describe('保存查询批量 ZIP', () => {
  it('严格 IPC 拒绝重复、路径、SQL、额外参数和超量', () => {
    const parse = (value: unknown) => validateCommand('queries.exportSqlArchive', value);
    expect(parse({ items: refs })).toEqual({ items: refs });
    for (const encoding of ['utf8', 'utf16le', 'gb18030']) expect(parse({ items: refs, encoding })).toEqual({ items: refs, encoding });
    for (const value of [{ items: [] }, { items: [refs[0], refs[0]] }, { items: [{ ...refs[0], sql: 'SELECT 1' }] }, { items: refs, path: '输入路径' }, { items: refs, encoding: 'utf16be' }, { items: Array.from({ length: savedQueryArchiveLimits.files + 1 }, (_, index) => ({ ...refs[0], id: `${index}` })) }]) {
      expect(() => parse(value)).toThrow();
    }
  });

  it('同名和路径段字符生成可移植的独立文件，逐字节保留 SQL', async () => {
    const { target } = await fixture();
    await writeQuerySqlArchive(target, refs, item => record(item.id, refs.indexOf(item)), () => {});
    const zip = await JSZip.loadAsync(await readFile(target), { checkCRC32: true });
    expect(Object.keys(zip.files)).toEqual(['001-_COM1_.sql', '002-_COM1_.sql']);
    for (const [index, entry] of Object.values(zip.files).entries()) expect(await entry.async('nodebuffer')).toEqual(Buffer.from(sql[index]));
  });

  it('后一个记录过期、正文不可编码或超预算时保留原文件且无临时文件', async () => {
    const { root, target } = await fixture();
    await writeFile(target, '原文件');
    const exportWith = (read: Parameters<typeof writeQuerySqlArchive>[2]) => writeQuerySqlArchive(target, refs, read, () => {});
    await expect(exportWith(item => { if (item === refs[1]) throw Error('已修改'); return record(item.id, 0); })).rejects.toThrow('已修改');
    await expect(exportWith(item => ({ ...record(item.id, 0), sql: item === refs[0] ? sql[0] : '\0' }))).rejects.toThrow('NUL');
    const bigSql = 'x'.repeat(17 * 1024 * 1024);
    await expect(exportWith(item => ({ ...record(item.id, 0), sql: bigSql }))).rejects.toThrow('32 MiB');
    expect(await readFile(target, 'utf8')).toBe('原文件');
    expect(await readdir(root)).toEqual(['查询.zip']);
  });

  it('暂存写入时归属失效，拒绝替换目标并清理暂存', async () => {
    const { root, target } = await fixture();
    await writeFile(target, '原文件');
    const check = vi.fn(() => { if (check.mock.calls.length === 5) throw Error('原文档失效'); });
    await expect(writeQuerySqlArchive(target, refs, item => record(item.id, 0), check)).rejects.toThrow('原文档失效');
    expect(await readFile(target, 'utf8')).toBe('原文件');
    expect(await readdir(root)).toEqual(['查询.zip']);
  });

  it('历史 ZIP 验证编码和准确的记录摘要，预算包含 UTF-16LE BOM 和编码扩张', async () => {
    const parse = (value: unknown) => validateCommand('history.exportSqlArchive', value);
    const input = { items: refs, encoding: 'utf16le' };
    expect(parse(input)).toEqual(input);
    for (const patch of [{ items: [refs[0], refs[0]] }, { items: [] }, { encoding: 'ascii' }, { path: '任意.zip' },
      { items: [{ ...refs[0], digest: 'bad' }] }, { items: [{ ...refs[0], sql: '伪造 SQL' }] },
      { items: Array.from({ length: 101 }, (_, index) => ({ ...refs[0], id: String(index) })) }])
      expect(() => parse({ ...input, ...patch })).toThrow();
    const { root, target } = await fixture();
    await writeFile(target, '原文件');
    const bigSql = 'x'.repeat(8 * 1024 * 1024);
    await expect(writeQuerySqlArchive(target, refs, () => ({ name: '历史', sql: bigSql }), () => {}, 'utf16le')).rejects.toThrow('32 MiB');
    expect(await readFile(target, 'utf8')).toBe('原文件');
    expect(await readdir(root)).toEqual(['查询.zip']);
  });

  it('筛选归档请求只接收浏览条件，1000 条的编号仍按名称排序', async () => {
    const filters = { search: '原始文字', fields: ['sql'], scope: { kind: 'all' }, status: 'failed', database: { kind: 'known', database: 'Sales' }, sort: 'slowest' };
    const input = { filters, encoding: 'utf8' };
    expect(validateCommand('history.exportSqlArchive', input)).toEqual(input);
    for (const invalid of [{ ...input, items: refs }, { ...input, filters: { ...filters, onError: 'continue' } }, { ...input, filters: { ...filters, taskId: '外部任务' } }])
      expect(() => validateCommand('history.exportSqlArchive', invalid)).toThrow();
    const { target } = await fixture(), items = Array.from({ length: 1000 }, (_, index) => ({ ...refs[0], id: String(index) }));
    await writeQuerySqlArchive(target, items, () => ({ name: '历史', sql: 'SELECT 1;' }), () => {});
    const zip = await JSZip.loadAsync(await readFile(target), { checkCRC32: true });
    const names = Object.keys(zip.files);
    expect(names).toHaveLength(1000);
    expect(names).toEqual([...names].sort());
    expect([names[0], names.at(-1)]).toEqual(['0001-历史.sql', '1000-历史.sql']);
  });
});
