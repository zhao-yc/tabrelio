import { Client } from 'pg';
import { mkdir, writeFile } from 'node:fs/promises';
import iconv from 'iconv-lite';
import ExcelJS from 'exceljs';
import { excelImportZh } from '../../src/shared/excelTransfer';
import { importRecordRangeZh } from '../../src/shared/importRecordRange';
import { txtImportZh } from '../../src/shared/txtImport';
import { postgresTableImportZh as text } from '../../src/renderer/locales/postgresTableImport.zh-CN';
import { postgresTableZh } from '../../src/renderer/locales/postgresTable.zh-CN';
import { fileImportConflictZh as conflict } from '../../src/renderer/locales/fileImportConflict.zh-CN';
import { test, expect, desktop, page } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.skip(process.env.DBARK_POSTGRES_WORKSPACE_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
test.setTimeout(110_000);

function isolatedPostgres() {
  const user = process.env.DBARK_POSTGRES_TEST_USER ?? '', database = process.env.DBARK_POSTGRES_TEST_DATABASE ?? '';
  const password = process.env.DBARK_POSTGRES_TEST_PASSWORD ?? '', port = Number(process.env.DBARK_POSTGRES_TEST_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pg_[a-f0-9]{12}$/.test(user) || database !== user ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('需要本轮独占回环库');
  const observer = new Client({ host: '127.0.0.1', port, user, database, password, connectionTimeoutMillis: 3000 });
  return { observer, user, database, password, port };
}

test('PostgreSQL 多文件导入共用映射和事务，原生 CSV 保留 NULL 与空字符串', async ({}, info) => {
  const { observer, user, database, password, port } = isolatedPostgres();
  await observer.connect();
  try {
    await observer.query('CREATE TABLE public.batch_import_target (id bigint PRIMARY KEY, note text)');
    const snapshot = async () => (await observer.query('SELECT id::text, note FROM public.batch_import_target ORDER BY id::bigint')).rows;
    const profile = await page.evaluate(async input => (await window.dbark.invoke('connections.save', input)).id, {
      id: '', name: '本例 PostgreSQL 批量导入', dialect: 'postgresql' as const, group: '', color: '#123456',
      host: '127.0.0.1', port, user, database, password, rememberPassword: false,
    });
    await page.evaluate(async ({ connectionId, database }) => {
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'batch_import_target', tabs: [
        { id: 'batch_import_target', title: 'batch_import_target', kind: 'table', connectionId, database, table: '"public"."batch_import_target"' },
      ] });
    }, { connectionId: profile, database });
    await page.reload();
    const tab = page.locator('.postgres-table-tab:visible');
    const modal = page.getByRole('dialog', { name: text.title, exact: true });
    await expect(tab.getByRole('grid')).toBeVisible();
    await mkdir(info.outputDir, { recursive: true });
    const native = [info.outputPath('批次甲.csv'), info.outputPath('批次乙.csv')];
    const incompatible = info.outputPath('字段不符.csv'), duplicate = info.outputPath('跨文件重复键.csv');
    const body = '说明\r\nnote,id\r\n"",2\r\n汇总';
    await writeFile(native[0], '说明\r\nid,note\r\n1,\r\n汇总');
    await writeFile(native[1], body);
    await writeFile(incompatible, '说明\r\nid,other\r\n2,不同字段\r\n汇总');
    await writeFile(duplicate, '说明\r\nid,note\r\n1,重复\r\n汇总');
    const options = [
      { format: 'csv', mode: 'tabrelio', bodies: ['id,note\n3,\\N', 'note,id\n多编码🚢,4'], notes: [null, '多编码🚢'] },
      { format: 'txt', bodies: ['id\tnote\n5\t分隔甲', 'note\tid\n分隔乙\t6'], notes: ['分隔甲', '分隔乙'] },
      { format: 'json', bodies: ['[{"id":7,"note":"精确甲"}]', '[{"note":"精确乙","id":9223372036854775807}]'], notes: ['精确甲', '精确乙'] },
      { format: 'xml', bodies: ['<rows><RECORD id="8" note="记录甲"/></rows>', '<rows><RECORD note="记录乙" id="9"/></rows>'], notes: ['记录甲', '记录乙'] },
    ] as const;
    const groups = [[native[0], incompatible], native, native, [native[0], duplicate]];
    for (const item of options) {
      const files = item.bodies.map((_body, index) => info.outputPath('附加' + index + '.' + item.format));
      for (const [index, path] of files.entries())
        await writeFile(path, item.format === 'csv' ? iconv.encode(item.bodies[index], 'gb18030') : item.bodies[index]);
      groups.push(files);
    }
    await desktop.evaluate(({ dialog, BrowserWindow }, groups) => {
      const original = dialog.showOpenDialog;
      let count = 0;
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        const paths = groups[count++], options = args.at(-1) as Electron.OpenDialogOptions;
        if (args[0] !== BrowserWindow.getAllWindows()[0] || !options.properties?.includes('multiSelections') ||
            !paths?.every(path => path.endsWith('.' + options.filters?.[0]?.extensions[0]))) throw Error('仅允许本例原生多选');
        return { canceled: false, filePaths: paths };
      }) as typeof original;
      Object.assign(globalThis, { restorePgBatchPicker: () => { dialog.showOpenDialog = original; return count; } });
    }, groups);
    const open = async (format = 'csv') => {
      await (await navigationMenuItem(tab, { name: text.open, exact: true })).click();
      await modal.getByLabel(text.format, { exact: true }).selectOption(format);
    };
    const choose = () => modal.getByRole('button', { name: text.chooseBatch, exact: true }).click();
    const confirm = modal.getByRole('button', { name: text.confirm, exact: true });
    const batchFiles = modal.getByRole('list', { name: text.batchFiles, exact: true });
    const ranges = async () => {
      await modal.getByLabel(importRecordRangeZh.headerRow, { exact: true }).fill('2');
      await modal.getByLabel(importRecordRangeZh.lastDataRow, { exact: true }).fill('3');
    };
    await open(); await ranges(); await choose();
    await expect(modal).toContainText('第 2 个文件未通过扫描');
    await expect(confirm).toBeDisabled();
    await choose();
    await expect(batchFiles.getByRole('listitem')).toHaveCount(2);
    await expect(modal).toContainText(text.records(2));
    await writeFile(native[1], body.replace('汇总', '改动'));
    await confirm.click();
    await expect(modal).toBeHidden();
    await expect(tab).toContainText('整批已回滚');
    await expect(tab).toContainText('第 2 个文件导入失败');
    expect(await snapshot()).toEqual([]);
    await writeFile(native[1], body);
    await tab.getByRole('button', { name: postgresTableZh.refresh, exact: true }).click();

    await open(); await ranges(); await choose();
    await expect(batchFiles.getByRole('listitem')).toHaveCount(2);
    await modal.screenshot({ path: info.outputPath('PostgreSQL 多文件导入确认.png') });
    await confirm.click();
    await expect(tab).toContainText('PostgreSQL 已提交导入 2 个文件，共 2 行');
    expect(await snapshot()).toEqual([{ id: '1', note: null }, { id: '2', note: '' }]);

    await open(); await ranges(); await choose();
    await expect(batchFiles.getByRole('listitem')).toHaveCount(2);
    await modal.getByLabel(conflict.mode, { exact: true }).selectOption('upsert');
    await modal.getByLabel(conflict.key, { exact: true }).selectOption({ label: 'batch_import_target_pkey (id)' });
    await modal.getByRole('button', { name: text.confirmConflict, exact: true }).click();
    await expect(modal).toBeHidden();
    await expect(tab).toContainText('整批已回滚');
    expect(await snapshot()).toEqual([{ id: '1', note: null }, { id: '2', note: '' }]);
    await tab.getByRole('button', { name: postgresTableZh.refresh, exact: true }).click();

    const ids = [['3', '4'], ['5', '6'], ['7', '9223372036854775807'], ['8', '9']];
    for (const [index, item] of options.entries()) {
      await open(item.format);
      if (item.format === 'csv') {
        await modal.getByLabel(text.csvProtocol, { exact: true }).selectOption('tabrelio');
        await modal.getByLabel(text.encoding, { exact: true }).selectOption('gb18030');
      }
      if (item.format === 'txt') await modal.getByRole('checkbox', { name: txtImportZh.hasHeader, exact: true }).check();
      await choose();
      await expect(batchFiles.getByRole('listitem')).toHaveCount(2);
      await confirm.click();
      await expect(modal).toBeHidden();
      await expect(tab).toContainText('PostgreSQL 已提交导入 2 个文件，共 2 行');
      expect((await snapshot()).filter(row => ids[index].includes(row.id))).toEqual(ids[index].map((id, at) => ({ id, note: item.notes[at] })));
    }
    expect(await desktop.evaluate(() => (globalThis as typeof globalThis & { restorePgBatchPicker(): number }).restorePgBatchPicker())).toBe(groups.length);
  } finally { await observer.end(); }
});

test('PostgreSQL 多工作簿分别选择工作表并验证原文件，失败时整批回滚', async ({}, info) => {
  const { observer, user, database, password, port } = isolatedPostgres();
  await observer.connect();
  try {
    await observer.query('CREATE TABLE public.xlsx_batch_target (id bigint PRIMARY KEY, note text)');
    const snapshot = async () => (await observer.query('SELECT id::text, note FROM public.xlsx_batch_target ORDER BY id::bigint')).rows;
    const profile = await page.evaluate(async input => (await window.dbark.invoke('connections.save', input)).id, {
      id: '', name: '本例 PostgreSQL 工作簿导入', dialect: 'postgresql' as const, group: '', color: '#123456',
      host: '127.0.0.1', port, user, database, password, rememberPassword: false,
    });
    await page.evaluate(async ({ connectionId, database }) => {
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'xlsx_batch_target', tabs: [
        { id: 'xlsx_batch_target', title: 'xlsx_batch_target', kind: 'table', connectionId, database, table: '"public"."xlsx_batch_target"' },
      ] });
    }, { connectionId: profile, database });
    await page.reload();
    const tab = page.locator('.postgres-table-tab:visible');
    const modal = page.getByRole('dialog', { name: text.title, exact: true });
    await expect(tab.getByRole('grid')).toBeVisible();
    await mkdir(info.outputDir, { recursive: true });
    const names = ['工作簿甲.xlsx', '工作簿乙.xlsx'];
    const paths = names.map(name => info.outputPath(name));
    const writeWorkbook = async (index: number, note: string) => {
      const book = new ExcelJS.Workbook();
      book.addWorksheet('封面').addRows([['id', 'note'], ['100', '封面内容']]);
      if (index === 1) book.addWorksheet('索引').addRows([['id', 'note'], ['101', '索引内容']]);
      const sheet = book.addWorksheet(index === 0 ? '明细甲' : '明细乙');
      sheet.addRow(['汇报说明']);
      sheet.addRow(index === 0 ? ['id', 'note'] : ['note', 'id']);
      sheet.addRow(index === 0 ? ['55', '跳过'] : ['跳过', '56']);
      sheet.addRow(index === 0 ? ['1', note] : [note, '9223372036854775807']);
      sheet.addRow([{ formula: '1+1', result: 2 }]);
      await book.xlsx.writeFile(paths[index]);
    };
    await writeWorkbook(0, '\\N');
    await writeWorkbook(1, '批次乙🚢');
    await desktop.evaluate(({ dialog, BrowserWindow }, paths) => {
      const original = dialog.showOpenDialog;
      let count = 0;
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        const options = args.at(-1) as Electron.OpenDialogOptions;
        if (args[0] !== BrowserWindow.getAllWindows()[0] || !options.properties?.includes('multiSelections') ||
            options.filters?.[0]?.extensions[0] !== 'xlsx') throw Error('仅允许本例工作簿多选');
        count++;
        return { canceled: false, filePaths: paths };
      }) as typeof original;
      Object.assign(globalThis, { restorePgXlsxPicker: () => { dialog.showOpenDialog = original; return count; } });
    }, paths);
    const open = async () => {
      await (await navigationMenuItem(tab, { name: text.open, exact: true })).click();
      await modal.getByLabel(text.format, { exact: true }).selectOption('xlsx');
    };
    const choose = async () => {
      await modal.getByRole('button', { name: text.chooseWorkbooks, exact: true }).click();
      await modal.getByLabel(text.workbookSheet(0, names[0]), { exact: true }).selectOption('2');
      await modal.getByLabel(text.workbookSheet(1, names[1]), { exact: true }).selectOption('3');
      await modal.getByLabel(excelImportZh.header, { exact: true }).fill('2');
      await modal.getByLabel(excelImportZh.firstDataRow, { exact: true }).fill('4');
      await modal.getByLabel(excelImportZh.lastDataRow, { exact: true }).fill('4');
      await modal.getByLabel(excelImportZh.protocol, { exact: true }).selectOption('dbark-v1');
    };
    const scan = () => modal.getByRole('button', { name: excelImportZh.inspect, exact: true }).click();
    const confirm = modal.getByRole('button', { name: text.confirm, exact: true });
    const files = modal.getByRole('list', { name: text.batchFiles, exact: true });
    const checkPreview = async () => {
      await expect(files.getByRole('listitem')).toHaveCount(2);
      await expect(files).toContainText('明细甲');
      await expect(files).toContainText('明细乙');
      await expect(modal).toContainText(text.records(2));
    };

    await open();
    await choose();
    await writeWorkbook(1, '读取工作表目录后变化');
    await scan();
    await expect(modal).toContainText('工作簿在读取目录后已变化');
    await expect(confirm).toBeDisabled();
    expect(await snapshot()).toEqual([]);

    await writeWorkbook(1, '批次乙🚢');
    await choose();
    await scan();
    await checkPreview();
    await writeWorkbook(1, '扫描完成后变化');
    await confirm.click();
    await expect(modal).toBeHidden();
    await expect(tab).toContainText('整批已回滚');
    await expect(tab).toContainText('第 2 个文件导入失败');
    expect(await snapshot()).toEqual([]);
    await tab.getByRole('button', { name: postgresTableZh.refresh, exact: true }).click();

    await writeWorkbook(1, '批次乙🚢');
    await open();
    await choose();
    await scan();
    await checkPreview();
    await modal.screenshot({ path: info.outputPath('PostgreSQL Excel 多工作簿确认.png') });
    await confirm.click();
    await expect(tab).toContainText('PostgreSQL 已提交导入 2 个文件，共 2 行');
    expect(await snapshot()).toEqual([{ id: '1', note: null }, { id: '9223372036854775807', note: '批次乙🚢' }]);
    expect(await desktop.evaluate(() => (globalThis as typeof globalThis & { restorePgXlsxPicker(): number }).restorePgXlsxPicker())).toBe(3);
  } finally { await observer.end(); }
});
