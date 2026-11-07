import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inspectPostgresCopySource, readPostgresCopySource } from '../../src/engine/postgres/copyImportFile';
import { postgresImportColumnOrder } from '../../src/engine/postgres/importSource';

/** 测试使用真实文件句柄，覆盖预览前缀和选择阶段的文件身份读取。 */
async function inspect(csv: string, hasHeader?: boolean) {
  const directory = await mkdtemp(join(tmpdir(), 'tabrelio-copy-preview-'));
  try {
    const file = join(directory, '源.csv');
    await writeFile(file, csv);
    return await inspectPostgresCopySource(file, ';', hasHeader);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

describe('PostgreSQL CSV 导入样本', () => {
  it('批次完整扫描验证样本后的选中行，并按实际字段对齐文件列序', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tabrelio-copy-batch-'));
    try {
      const path = join(directory, '批次.csv');
      const body = '编号;值\r\n' + '1;正确\r\n'.repeat(6);
      await writeFile(path, body);
      const checked = await inspectPostgresCopySource(path, ';', true, undefined, undefined, true);
      expect(checked.source).toMatchObject({ header: ['编号', '值'], hasHeader: false, selection: { records: 6 } });
      expect(checked.sample).toHaveLength(5);
      await writeFile(path, body + '2;正文;多列\r\n');
      await expect(inspectPostgresCopySource(path, ';', true, undefined, undefined, true)).rejects.toThrow('无法读取');
      await writeFile(path, Buffer.concat([Buffer.from(body), Buffer.from([0xff])]));
      await expect(inspectPostgresCopySource(path, ';', true, { lastDataRow: 7 }, undefined, true)).rejects.toThrow('无法读取');
      expect(postgresImportColumnOrder(['编号', '值'], ['值', '编号'])).toEqual([1, 0]);
      expect(postgresImportColumnOrder(['编号', '值'], ['编号', '编号'])).toBeUndefined();
      expect(postgresImportColumnOrder(['编号', ''], ['', '编号'])).toBeUndefined();
      expect(postgresImportColumnOrder(['编号', ''], ['编号', ''])).toEqual([0, 1]);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('跨读取块按逻辑记录截取原字节，保留 NULL、空字符串和引号内换行', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tabrelio-copy-range-'));
    try {
      const path = join(directory, '范围.csv');
      const selected = ';1;"引号内\r\n换行"\r\n"";2;正文\r\n';
      const content = '\uFEFF' + '报表说明' + 'A'.repeat(65522) + '\r\n\r\n值;编号;说明\r\n忽略\r\n' + selected + '汇总';
      await writeFile(path, content);
      const range = { headerRow: 3, firstDataRow: 5, lastDataRow: 6 };
      const { source, sample } = await inspectPostgresCopySource(path, ';', true, range);
      expect(source).toMatchObject({ hasHeader: false, header: ['值', '编号', '说明'], selection: { records: 2 } });
      expect(sample).toEqual([[null, '1', '引号内\r\n换行'], ['', '2', '正文']]);
      const copy = async (stream: NodeJS.ReadableStream, rows: number) => {
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(Buffer.from(chunk));
        expect(Buffer.concat(chunks)).toEqual(Buffer.from(selected));
        return rows;
      };
      await expect(readPostgresCopySource(source, stream => copy(stream, 2))).resolves.toBe(2);
      await expect(readPostgresCopySource(source, stream => copy(stream, 1))).rejects.toThrow('回执');
      await writeFile(path, content.replace('汇总', '改动'));
      await expect(readPostgresCopySource(source, stream => copy(stream, 2))).rejects.toThrow('已变化');
      await expect(inspectPostgresCopySource(path, ';', false, { firstDataRow: 100 })).rejects.toThrow('没有可导入');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('默认跳过表头，无表头时把第一条完整记录纳入预览', async () => {
    const csv = '\uFEFF"含\r\n换行";编号\r\n;9007199254740994\r\n"";9007199254740995\r\n';
    const ordinary = await inspect(csv);
    expect(ordinary.source).toMatchObject({ hasHeader: true, header: ['含\r\n换行', '编号'] });
    expect(ordinary.sample).toEqual([[null, '9007199254740994'], ['', '9007199254740995']]);
    expect(ordinary.sampleLimited).toBe(false);
    const headerless = await inspect(csv, false);
    expect(headerless.source).toMatchObject({ hasHeader: false, header: ['第1列', '第2列'] });
    expect(headerless.sample[0]).toEqual(['含\r\n换行', '编号']);
  });

  it('样本限制为五行十二列，截短值时保留 Unicode 字符边界', async () => {
    const names = Array.from({ length: 13 }, (_, i) => '列' + i);
    const row = ['甲'.repeat(119) + '🙂最后', ...names.slice(1)];
    const data = [names.join(';'), ...Array<string>(7).fill(row.join(';'))].join('\n');
    const { source, sample } = await inspect(data);
    expect(source.header).toEqual(names);
    expect(sample).toHaveLength(5);
    expect(sample.every(record => record.length === 12 && record[0] === '甲'.repeat(119) + '…')).toBe(true);
  });

  it('前缀截断的记录不进入样本，也不伪造无表头首行', async () => {
    const large = '跨边界'.repeat(100_000);
    expect(await inspect('甲;乙\n保留;1\n"' + large + '";2\n')).toMatchObject({
      sample: [['保留', '1']], sampleLimited: true,
    });
    expect(await inspect('甲;乙\n保留;1\n' + large + ';2\n')).toMatchObject({
      sample: [['保留', '1']], sampleLimited: true,
    });
    await expect(inspect(large + ';2\n', false)).rejects.toThrow('完整首条 CSV 记录');
  });

  it('区分只有表头和后续记录无法预览', async () => {
    expect(await inspect('甲;乙')).toMatchObject({ sample: [], sampleLimited: false });
    expect(await inspect('甲;乙\n"未闭合')).toMatchObject({ sample: [], sampleLimited: true });
    expect(await inspect('甲;乙\n多余;1;2\n')).toMatchObject({ sample: [], sampleLimited: true });
  });
});
