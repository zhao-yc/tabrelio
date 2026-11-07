import type { RowDataPacket } from 'mysql2/promise';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { importBatchZh as text } from '../../src/renderer/components/ImportBatchDialog';
import { zh } from '../../src/renderer/locales/zh-CN';
import { txtImportZh } from '../../src/shared/txtImport';
import { importRecordRangeZh } from '../../src/shared/importRecordRange';
import { dataDir, desktop, expect, page, test } from './desktop-fixture';
import { enabled, isolatedDatabase } from './live-helpers';
import { navigationMenuItem } from './navigation-menu';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.skip(!enabled || process.env.DBARK_IMPORT_BATCH_NATIVE !== '1', '需要本轮独占回环库');
test.setTimeout(100_000);

const sources = {
  csv: ['报表说明\r\nid,payload\r\n1,"第一份\r\n换行"\r\n汇总', '报表说明\r\npayload,id\r\n第二份,2\r\n汇总'],
  txt: ['id\tpayload\n1\t第一份', 'payload\tid\n第二份\t2'],
  json: ['[{"id":1,"payload":"第一份"}]', '[{"payload":"第二份","id":2}]'],
  xml: ['<rows><RECORD id="1" payload="第一份"/></rows>', '<rows><RECORD payload="第二份" id="2"/></rows>'],
} as const;

for (const format of ['csv', 'txt', 'json', 'xml'] as const) test('多文件导入逐份预检后一次提交 ' + format, async ({}, info) => {
  const port = Number(process.env.DBARK_TEST_PORT);
  if (process.env.DBARK_TEST_HOST !== '127.0.0.1' || !Number.isInteger(port) || port <= 1024 || port > 65535 ||
      !/^tabrelio-search-[a-f0-9]{12}$/.test(process.env.DBARK_MYSQL_SEARCH_CONTAINER ?? '')) throw Error('需要本轮独占回环库');
  await isolatedDatabase(async ({ observer, database, connectionId }) => {
    await observer.query('USE ??', [database]);
    await observer.query('CREATE TABLE batch_target (id INT PRIMARY KEY, note TEXT) ENGINE=InnoDB');
    const first = join(dataDir, '第一份.' + format), second = join(dataDir, '第二份.' + format);
    const [initial, original] = sources[format];
    await writeFile(first, initial);
    await writeFile(second, original);
    await page.evaluate(async ({ connectionId, database }) => {
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'batch-table', tabs: [
        { id: 'batch-table', title: 'batch_target', kind: 'table', connectionId, database, table: 'batch_target' },
      ] });
    }, { connectionId, database });
    await page.reload();
    await desktop.evaluate(({ dialog, BrowserWindow }, { filePaths, format }) => {
      const original = dialog.showOpenDialog;
      let count = 0;
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        const options = args.at(-1) as Electron.OpenDialogOptions;
        if (args[0] !== BrowserWindow.getAllWindows()[0] || !options.properties?.includes('multiSelections') ||
            options.filters?.[0]?.extensions[0] !== format) throw Error('只允许本例指定格式的原生多选');
        count++;
        return { canceled: false, filePaths };
      }) as typeof original;
      Object.assign(globalThis, { restoreBatchPicker: () => { dialog.showOpenDialog = original; return count; } });
    }, { filePaths: [first, second], format });
    const table = page.locator('.table-tab:visible');
    const modal = page.getByRole('dialog', { name: text.title, exact: true });
    const records = async () => (await observer.query<RowDataPacket[]>('SELECT id, note FROM batch_target ORDER BY id'))[0];
    const confirm = modal.getByRole('button', { name: text.commit, exact: true });
    const preflight = modal.getByRole('button', { name: text.preflight, exact: true });
    for (const changed of format === 'csv' ? [true, false] : [false]) {
      await expect(table.getByRole('grid')).toBeVisible();
      await (await navigationMenuItem(table, { name: zh.common.import, exact: true })).click();
      const originalDialog = page.getByRole('dialog', { name: zh.transfer.text004 + ' · ' + database + '.batch_target', exact: true });
      if (format === 'csv') {
        await originalDialog.getByLabel(importRecordRangeZh.headerRow, { exact: true }).fill('2');
        await originalDialog.getByLabel(importRecordRangeZh.lastDataRow, { exact: true }).fill('3');
      } else {
        await originalDialog.getByRole('combobox').first().selectOption(format);
        if (format === 'txt') await originalDialog.getByRole('checkbox', { name: txtImportZh.hasHeader, exact: true }).check();
      }
      await originalDialog.getByRole('button', { name: text.open, exact: true }).click();
      await modal.getByRole('button', { name: text.choose, exact: true }).click();
      await expect(modal.getByText(text.scanned(2, 2), { exact: true })).toBeVisible();
      await expect(confirm).toBeDisabled();
      const payload = modal.getByLabel(text.mapping('payload'), { exact: true });
      await payload.selectOption('note');
      await preflight.click();
      await expect(modal.getByText(text.checked(2), { exact: true })).toBeVisible();
      await expect(confirm).toBeEnabled();
      await payload.selectOption('');
      await expect(confirm).toBeDisabled();
      await payload.selectOption('note');
      await preflight.click();
      await expect(modal.getByText(text.checked(2), { exact: true })).toBeVisible();
      expect(await records()).toEqual([]);
      if (changed) await writeFile(second, original.replace('汇总', '改动'));
      else if (format === 'csv') await modal.screenshot({ path: info.outputPath('CSV 多文件预检确认.png') });
      await confirm.click();
      if (changed) {
        await expect(modal).toContainText('整文件目标表事务已确认回滚');
        await expect(modal).toContainText('第 2 个文件');
        expect(await records()).toEqual([]);
        await writeFile(second, original);
      } else {
        await expect(modal.getByText(text.committed(2, 2), { exact: true })).toBeVisible();
        expect(await records()).toEqual([{ id: 1, note: format === 'csv' ? '第一份\r\n换行' : '第一份' }, { id: 2, note: '第二份' }]);
      }
      await modal.getByRole('button', { name: text.close, exact: true }).click();
      await expect(modal).toBeHidden();
    }
    expect(await desktop.evaluate(() => (globalThis as typeof globalThis & { restoreBatchPicker(): number }).restoreBatchPicker())).toBe(format === 'csv' ? 2 : 1);
    if (format === 'csv') {
      await writeFile(info.outputPath('第一份合成样例.csv'), initial);
      await writeFile(info.outputPath('第二份合成样例.csv'), original);
    }
  }, info, { captureFailureScreenshot: false });
});
