import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import iconv from 'iconv-lite';
import { previewFile } from '../../src/engine/files';
import { inspectImportFile, readVerifiedImportRecords } from '../../src/engine/importNewTableSource';
import { txtImportDefaults, txtImportOptionsSchema, type TxtImportOptions } from '../../src/shared/txtImport';
import { validateCommand } from '../../src/shared/validation';
import { importPresetConfigurationSchema } from '../../src/shared/importPresets';
import { sqliteImportSourceOptionsKey } from '../../src/shared/sqliteImportSource';

let folder: string, filePath: string;
beforeEach(async () => { folder = await mkdtemp(join(tmpdir(), 'tabrelio-txt-')); filePath = join(folder, 'source.txt'); });
afterEach(async () => { await rm(folder, { recursive: true, force: true }); });

it('TXT 自定义分隔、记录换行和单引号保留精确数值及 NULL／空文本', async () => {
  const txtOptions: TxtImportOptions = { mode: 'delimited', delimiter: '||', quote: 'single', recordDelimiter: 'cr', hasHeader: true };
  const content = "\uFEFFid||note||marker\r9223372036854775807||'甲''||乙'||\\N\r";
  await writeFile(filePath, content, 'utf16le');
  const inspected = await inspectImportFile({filePath, fileToken: 'file', taskId: 'task', format: 'txt', encoding: 'utf16le', txtOptions}, () => {});
  expect(inspected.columns).toEqual(['id', 'note', 'marker']);
  expect(inspected.rows).toEqual([{id: '9223372036854775807', note: "甲'||乙", marker: null}]);
  const rows = [];
  for await (const row of readVerifiedImportRecords({filePath, format: 'txt', encoding: 'utf16le', txtOptions, expectedSource: inspected.source}, () => {})) rows.push(row);
  expect(rows).toEqual(inspected.rows);
  await writeFile(filePath, content.replace('乙', '丙'), 'utf16le');
  await expect(async () => {
    for await (const _row of readVerifiedImportRecords({filePath, format: 'txt', encoding: 'utf16le', txtOptions, expectedSource: inspected.source}, () => {})) { /* 读到原字节核验终点。 */ }
  }).rejects.toThrow('变化');
});

it('固定列宽按码点切割，保留无表头首行，拒绝样本之后的短行', async () => {
  const txtOptions: TxtImportOptions = { mode: 'fixed', widths: '2, 3, 2', trimPadding: true, hasHeader: false, recordDelimiter: 'auto' };
  const input = {filePath, format: 'txt' as const, encoding: 'utf8', txtOptions};
  const first = ['🚢甲', ' 乙 ', '\\N'].join(''), second = ['🚢丙', ' 丙 ', '  '].join('');
  await writeFile(filePath, first + '\r\n' + second + '\r\n');
  expect(await previewFile(input)).toEqual({columns: ['第1列', '第2列', '第3列'], rows: [
    {'第1列': '🚢甲', '第2列': '乙', '第3列': null}, {'第1列': '🚢丙', '第2列': '丙', '第3列': ''},
  ]});
  await writeFile(filePath, (first + '\n').repeat(21) + '短行');
  await expect(previewFile(input)).rejects.toThrow('固定列宽');
});

it('TXT 按 GB18030 无引号读取，拒绝截断的四字节字符', async () => {
  const txtOptions: TxtImportOptions = { mode: 'delimited', delimiter: '|', quote: 'none', recordDelimiter: 'lf', hasHeader: false };
  const input = {filePath, format: 'txt' as const, encoding: 'gb18030', txtOptions};
  const bytes = iconv.encode('🚢|"甲"\n', 'gb18030');
  await writeFile(filePath, bytes);
  expect(await previewFile(input)).toEqual({columns: ['第1列', '第2列'], rows: [{'第1列': '🚢', '第2列': '"甲"'}]});
  await writeFile(filePath, Buffer.concat([bytes, bytes.subarray(0, 3)]));
  await expect(previewFile(input)).rejects.toThrow();
});

it('TXT 按逻辑记录选取字段名及包含端点的数据，范围外字节仍纳入核验', async () => {
  const txtOptions = { ...txtImportDefaults, delimiter: '|', hasHeader: true, headerRow: 3, firstDataRow: 5, lastDataRow: 6 };
  const content = '说明\r\n\r\nid|note\r\n跳过|不等列|附注\r\n1|"引号内\r\n换行"\r\n2|末条\r\n汇总';
  await writeFile(filePath, content);
  const input = { filePath, format: 'txt' as const, encoding: 'utf8' as const, txtOptions };
  const result = await inspectImportFile({ ...input, fileToken: 'file', taskId: 'task' }, () => {});
  expect(result.columns).toEqual(['id', 'note']);
  expect(result.rows).toEqual([{ id: '1', note: '引号内\r\n换行' }, { id: '2', note: '末条' }]);
  await writeFile(filePath, content.replace('汇总', '改动'));
  await expect(async () => {
    for await (const _row of readVerifiedImportRecords({ ...input, expectedSource: result.source }, () => {})) { /* 消费整文件。 */ }
  }).rejects.toThrow('变化');
  await writeFile(filePath, '说明');
  await expect(previewFile(input)).rejects.toThrow('没有指定的字段名记录');
});

it('TXT 无表头从第一条选中记录推断列，固定宽度只校验所选记录', async () => {
  const input = { filePath, format: 'txt' as const, encoding: 'utf8' };
  const range = { firstDataRow: 2, lastDataRow: 2 };
  await writeFile(filePath, '很长的报表标题和版本说明\n🚢甲\n尾');
  const fixed: TxtImportOptions = { mode: 'fixed', recordDelimiter: 'lf', widths: '1,1', hasHeader: false, trimPadding: true, ...range };
  expect(await previewFile({ ...input, txtOptions: fixed })).toEqual({ columns: ['第1列', '第2列'], rows: [{ 第1列: '🚢', 第2列: '甲' }] });
  await expect(previewFile({ ...input, txtOptions: { ...fixed, lastDataRow: 3 } })).rejects.toThrow('固定列宽');
  await writeFile(filePath, '说明\n1|甲\n2|乙|多列');
  const delimited = { ...txtImportDefaults, delimiter: '|', ...range };
  expect(await previewFile({ ...input, txtOptions: delimited })).toEqual({ columns: ['第1列', '第2列'], rows: [{ 第1列: '1', 第2列: '甲' }] });
  await expect(previewFile({ ...input, txtOptions: { ...delimited, lastDataRow: 3 } })).rejects.toThrow('列数');
});

it('TXT 拒绝反向、非整数及与字段名位置冲突的范围', () => {
  for (const invalid of [
    { headerRow: 2 }, { hasHeader: true, headerRow: 2, firstDataRow: 2 },
    { firstDataRow: 4, lastDataRow: 3 }, { firstDataRow: 1.5 }, { lastDataRow: 0 },
  ]) expect(txtImportOptionsSchema.safeParse({ ...txtImportDefaults, ...invalid }).success).toBe(false);
});

it('TXT 解释在预览、预检、提交、预设和 SQLite 来源指纹中保持独立', () => {
  const txtOptions = { ...txtImportDefaults, hasHeader: true, headerRow: 2, firstDataRow: 4, lastDataRow: 5 };
  const request = { fileToken: 'file', format: 'txt', encoding: 'utf8', txtOptions };
  const target = { connectionId: 'connection', database: 'db', table: 'table', taskId: 'task', mapping: {id: 'id'} };
  expect(validateCommand('files.preview', request)).toMatchObject({txtOptions});
  expect(validateCommand('files.preflight', {...target, ...request})).toMatchObject({txtOptions});
  expect(validateCommand('files.import', {...target, ...request, transactionMode: 'atomic'})).toMatchObject({txtOptions});
  expect(validateCommand('files.inspectImport', { ...request, taskId: 'task' })).toMatchObject({txtOptions});
  expect(validateCommand('sqlite.tableImport.inspect', { ...request, connectionId: target.connectionId, database: 'main', table: target.table, taskId: target.taskId })).toMatchObject({txtOptions});
  expect(() => validateCommand('files.preview', {...request, format: 'csv'})).toThrow();
  expect(() => validateCommand('files.preview', {...request, txtOptions: {...txtImportDefaults, delimiter: '"'}})).toThrow();
  expect(importPresetConfigurationSchema.parse({ format: 'txt', encoding: 'utf8', txtOptions, columns: ['id'], mapping: {id: 'id'} })).toMatchObject({txtOptions});
  expect(sqliteImportSourceOptionsKey({...request, format: 'txt', encoding: 'utf8'})).not.toBe(
    sqliteImportSourceOptionsKey({...request, format: 'txt', encoding: 'utf8', txtOptions: {...txtOptions, lastDataRow: 6}}));
});
