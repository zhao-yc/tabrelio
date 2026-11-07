import ExcelJS from 'exceljs';
import type { NetworkConnectionProfile } from '../../src/shared/contracts';
import type { RowDataPacket } from 'mysql2/promise';
import { basename } from 'node:path';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { mysqlWorkbookExportZh } from '../../src/renderer/locales/workbookExport.zh-CN';
import { test, expect, desktop, page } from './desktop-fixture';
import { isolatedDatabase } from './live-helpers';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.skip(process.env.DBARK_MYSQL_WORKBOOK_EXPORT_NATIVE !== '1', '需要本轮隔离 MySQL 或 MariaDB');
test.setTimeout(90_000);

test('对象列表多工作表 Excel 导出沿原快照，取消和后续工作表失败保留原文件', async ({}, info) => {
  const port = Number(process.env.DBARK_TEST_PORT), password = process.env.DBARK_TEST_PASSWORD ?? '';
  const dialect = process.env.DBARK_SEARCH_EDIT_DIALECT, host = process.env.DBARK_TEST_HOST;
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || host !== '127.0.0.1' || (dialect !== 'mysql' && dialect !== 'mariadb') ||
      !Number.isInteger(port) || port <= 1024 || port > 65535 || !/^[a-f0-9]{64}$/.test(password) ||
      !/^tabrelio-search-[a-f0-9]{12}$/.test(process.env.DBARK_MYSQL_SEARCH_CONTAINER ?? '')) throw Error('需要本轮独占回环库');
  const text = mysqlWorkbookExportZh(dialect);
  await isolatedDatabase(async ({ observer, database }) => {
    await observer.query('USE ??', [database]);
    const stem = '订单' + '甲'.repeat(29), tableName = stem + '表', viewName = stem + '视图';
    const lock = database + '_xlsx';
    await observer.query('CREATE TABLE ?? (id BIGINT PRIMARY KEY, note LONGTEXT, payload BLOB) ENGINE=InnoDB', [tableName]);
    await observer.query('INSERT INTO ?? VALUES (9223372036854775807,?,X\'00FF\'),(2,NULL,X\'\')', [tableName, '原快照']);
    await observer.query('CREATE VIEW ?? AS SELECT ? AS label, GET_LOCK(?, 20) AS barrier', [viewName, '真实视图', lock]);
    await observer.query('CREATE TABLE History (header TEXT) ENGINE=InnoDB');
    const connection: NetworkConnectionProfile = {
      id: '', name: '本例多表工作簿', dialect, group: '', color: '#123456', host, port, database,
      user: process.env.DBARK_TEST_USER ?? 'root', password, rememberPassword: false,
    };
    const profile = await page.evaluate(input => window.dbark.invoke('connections.save', input), connection);
    await page.evaluate(async ({ connectionId, database }) => {
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'mysql-workbook-objects', tabs: [
        { id: 'mysql-workbook-objects', title: '原对象列表', kind: 'objects', connectionId, database, objectCategory: 'table' },
      ] });
    }, { connectionId: profile.id, database });
    await page.reload();
    await mkdir(info.outputDir, { recursive: true });
    const output = info.outputPath('多表工作簿.xlsx');
    await desktop.evaluate(({ dialog, BrowserWindow }, filePath) => {
      const original = dialog.showSaveDialog;
      let count = 0;
      dialog.showSaveDialog = (async (...args: unknown[]) => {
        const options = args.at(-1) as Electron.SaveDialogOptions;
        if (++count > 3 || args[0] !== BrowserWindow.getAllWindows()[0] || options.filters?.[0]?.extensions[0] !== 'xlsx')
          throw Error('仅允许本例工作簿保存位置');
        return { canceled: false, filePath };
      }) as typeof original;
      Object.assign(globalThis, { restoreMysqlWorkbookChooser() { dialog.showSaveDialog = original; return count; } });
    }, output);
    const objects = page.locator('.object-browser:visible'), modal = page.getByRole('dialog', { name: text.title, exact: true });
    const launch = () => objects.getByRole('button', { name: text.open, exact: true }).click();
    const view = () => modal.getByRole('checkbox', { name: new RegExp(viewName) }).check();
    const table = () => modal.getByRole('checkbox', { name: new RegExp(tableName) }).check();
    const choose = async () => {
      await modal.getByRole('button', { name: text.choose, exact: true }).click();
      await expect(modal.getByRole('button', { name: basename(output), exact: true })).toBeVisible();
    };
    const start = () => modal.getByRole('button', { name: text.export, exact: true }).click();
    const close = () => modal.getByRole('button', { name: text.close, exact: true }).click();
    const waitForView = () => expect.poll(async () => Number((await observer.query<RowDataPacket[]>(`
      SELECT COUNT(*) AS n FROM information_schema.PROCESSLIST
      WHERE ID <> CONNECTION_ID() AND LOWER(COALESCE(STATE, '')) LIKE '%user lock%'
    `))[0][0].n), { timeout: 9_000 }).toBe(1);

    await launch(); await view(); await table();
    await modal.getByRole('checkbox', { name: /History/ }).check();
    const duplicate = stem.slice(0, 27) + ' (2)';
    await expect(modal.getByRole('list', { name: text.order }).getByRole('listitem')).toHaveText([
      viewName + ' → ' + stem, tableName + ' → ' + duplicate, 'History → History (2)',
    ]);
    await choose();
    await observer.query('SELECT GET_LOCK(?, 0)', [lock]);
    try {
      await start(); await waitForView();
      await observer.query('UPDATE ?? SET note=? WHERE id=9223372036854775807', [tableName, '并发连接已提交']);
    } finally { await observer.query('SELECT RELEASE_LOCK(?)', [lock]); }
    await expect(modal.getByRole('status')).toContainText(text.complete(3, 3));
    expect((await observer.query<RowDataPacket[]>('SELECT note FROM ?? WHERE id=9223372036854775807', [tableName]))[0][0].note).toBe('并发连接已提交');
    const book = new ExcelJS.Workbook();
    await book.xlsx.readFile(output);
    expect(book.worksheets.map(sheet => [sheet.name, sheet.rowCount])).toEqual([[stem, 2], [duplicate, 3], ['History (2)', 1]]);
    expect(book.worksheets[0].getCell('A2').text).toBe('真实视图');
    expect([2, 3].map(row => ['A', 'B', 'C'].map(col => book.worksheets[1].getCell(col + row).text))).toEqual([
      ['2', '\\N', '\\B:'], ['9223372036854775807', '原快照', '\\B:AP8='],
    ]);
    expect(book.worksheets[2].getCell('A1').text).toBe('header');
    await modal.screenshot({ path: info.outputPath('多表工作簿导出.png') });

    const original = await readFile(output);
    await close(); await launch(); await view(); await table(); await choose();
    await observer.query('SELECT GET_LOCK(?, 0)', [lock]);
    try {
      await start(); await waitForView();
      await modal.getByRole('button', { name: text.cancel, exact: true }).click();
      await expect(modal.getByRole('alert')).toBeVisible();
      await expect.poll(() => page.evaluate(async () => (await window.dbark.invoke('tasks.list', {}))
        .some(task => task.kind === 'mysql.workbookExport' && task.status === 'cancelled'))).toBe(true);
    } finally { await observer.query('SELECT RELEASE_LOCK(?)', [lock]); }
    expect(await readFile(output)).toEqual(original);
    await close(); await launch(); await view(); await table(); await choose();
    await observer.query('UPDATE ?? SET note=REPEAT(?,32768) WHERE id=2', [tableName, 'x']);
    await start();
    await expect(modal.getByRole('alert')).toContainText('32767');
    expect(await readFile(output)).toEqual(original);
    expect((await readdir(info.outputDir)).filter(name => name.endsWith('.partial'))).toEqual([]);
    expect(await desktop.evaluate(() => (globalThis as typeof globalThis & { restoreMysqlWorkbookChooser(): number }).restoreMysqlWorkbookChooser())).toBe(3);
  }, info, { captureFailureScreenshot: false });
});
