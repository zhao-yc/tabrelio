import { test as baseTest, expect } from '@playwright/test';
import { sqliteWorkbookExportZh as text } from '../../src/renderer/locales/sqliteWorkbookExport.zh-CN';

const active = process.env.DBARK_SQLITE_WORKBOOK_EXPORT_NATIVE_TEST === '1' &&
  !process.argv.some(argument => argument === '--list' || argument.startsWith('--list='));
if (active && (process.env.DBARK_INTEGRATION_ENABLED !== '0' || !['darwin', 'win32'].includes(process.platform)))
  throw Error('SQLite 工作簿验收只使用 Windows 或 macOS 上的独占本机文件');
const test: typeof baseTest = active ? (require('./desktop-fixture') as typeof import('./desktop-fixture')).test : baseTest;
test.skip(!active, '需要显式启用 SQLite 工作簿本机验收');
test.use({ trace: 'off', screenshot: 'off', video: 'off', ...(active ? { preserveOnUnconfirmedExit: true } : {}) });

test('SQLite 对象列表按勾选顺序将表、视图和空表写入同一本 Excel', async ({}, info) => {
  const runtime = require('./desktop-fixture') as typeof import('./desktop-fixture');
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
  const { join, basename } = require('node:path') as typeof import('node:path');
  const { copyFile, mkdir, readFile, readdir } = require('node:fs/promises') as typeof import('node:fs/promises');
  const { randomUUID } = require('node:crypto') as typeof import('node:crypto');
  const ExcelJS = require('exceljs') as typeof import('exceljs');
  const { application, page } = runtime.ownedDesktopResources(info);
  const database = join(runtime.dataDir, '工作簿源.sqlite'), output = join(runtime.dataDir, 'SQLite 多表工作簿.xlsx');
  const db = new DatabaseSync(database);
  try {
    db.exec(`CREATE TABLE "销售/甲"(id INTEGER PRIMARY KEY,note TEXT,payload BLOB);
      INSERT INTO "销售/甲" VALUES(9223372036854775807,NULL,X'00FF'),(2,'',X'');
      CREATE VIEW "销售:甲" AS SELECT note,id FROM "销售/甲" WHERE id = 2;
      CREATE TABLE "空表"(label TEXT);`);
  } finally { db.close(); }
  const before = await readFile(database);
  try {
    // 只模拟本例对话框的文件选择，真实 Main 授权、SQLite utility 和文件写入均透传。
    await application.evaluate(({ dialog, BrowserWindow }, paths) => {
      const open = dialog.showOpenDialog, save = dialog.showSaveDialog;
      let opens = 0, saves = 0;
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        const options = args.at(-1) as Electron.OpenDialogOptions;
        if (++opens !== 1 || args[0] !== BrowserWindow.getAllWindows()[0] || !options.properties?.includes('openFile') ||
            !options.filters?.[0]?.extensions.includes('sqlite')) throw Error('越过本例数据库选择范围');
        return { canceled: false, filePaths: [paths.database] };
      }) as typeof open;
      dialog.showSaveDialog = (async (...args: unknown[]) => {
        const options = args.at(-1) as Electron.SaveDialogOptions;
        if (++saves !== 1 || args[0] !== BrowserWindow.getAllWindows()[0] || options.filters?.[0]?.extensions[0] !== 'xlsx')
          throw Error('越过本例工作簿保存范围');
        return { canceled: false, filePath: paths.output };
      }) as typeof save;
      Object.assign(globalThis, { restoreWorkbookChooser() { dialog.showOpenDialog = open; dialog.showSaveDialog = save; return [opens, saves]; } });
    }, { database, output });
    await page.evaluate(async id => {
      const picked = await window.dbark.invoke('files.choose', { purpose: 'sqlite-database', sqliteConnectionId: id });
      if (!picked) throw Error('本例原生文件选择未确认');
      const connection = await window.dbark.invoke('connections.save', {
        id, name: '本例 SQLite 多表工作簿', group: '', color: '#123456', dialect: 'sqlite',
        sqlite: { fileToken: picked.token, readOnly: true, busyTimeoutMs: 100 },
      });
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'workbook-objects', tabs: [
        { id: 'workbook-objects', kind: 'objects', title: 'main 对象', connectionId: connection.id, database: 'main', objectCategory: 'table' },
      ] });
    }, randomUUID());
    await page.reload();
    const browser = page.locator('.object-browser:visible');
    await browser.getByRole('button', { name: text.open, exact: true }).click();
    const modal = page.getByRole('dialog', { name: text.title, exact: true });
    const choose = modal.getByRole('button', { name: text.choose, exact: true });
    await expect(choose).toBeDisabled();
    await modal.getByRole('checkbox', { name: /销售:甲/ }).check();
    await expect(choose).toBeDisabled();
    await modal.getByRole('checkbox', { name: /销售\/甲/ }).check();
    await modal.getByRole('checkbox', { name: /空表/ }).check();
    await expect(modal.getByRole('list', { name: text.order }).getByRole('listitem')).toHaveText([
      '销售:甲 → 销售_甲', '销售/甲 → 销售_甲 (2)', '空表 → 空表',
    ]);
    await choose.click();
    await expect(modal.getByRole('button', { name: basename(output), exact: true })).toBeVisible();
    await modal.getByRole('button', { name: text.export, exact: true }).click();
    await expect(modal.getByRole('status')).toContainText(text.complete(3, 3));
    await expect(modal.getByRole('button', { name: basename(output), exact: true })).toBeDisabled();

    const book = new ExcelJS.Workbook();
    await book.xlsx.readFile(output);
    expect(book.worksheets.map(sheet => [sheet.name, sheet.rowCount])).toEqual([['销售_甲', 2], ['销售_甲 (2)', 3], ['空表', 1]]);
    expect(book.worksheets[0].getCell('A1').text).toBe('note');
    expect(book.worksheets[0].getCell('B2').text).toBe('2');
    const data = book.worksheets[1];
    expect(data.getColumn(1).values).toHaveLength(4);
    const rows = [2, 3].map(index => ['A', 'B', 'C'].map(column => data.getCell(column + index).text));
    expect(rows.sort()).toEqual([['2', '', '\\B:'], ['9223372036854775807', '\\N', '\\B:AP8=']].sort());
    expect(book.worksheets[2].getCell('A1').text).toBe('label');
    expect(await readFile(database)).toEqual(before);
    expect((await readdir(runtime.dataDir)).filter(name => name.endsWith('.partial'))).toEqual([]);
    expect(await application.evaluate(() => (globalThis as typeof globalThis & { restoreWorkbookChooser(): number[] }).restoreWorkbookChooser())).toEqual([1, 1]);
    await mkdir(info.outputDir, { recursive: true });
    await modal.screenshot({ path: info.outputPath('SQLite 多表工作簿导出.png') });
    await copyFile(output, info.outputPath(basename(output)));
    await runtime.confirmOwnedDesktopExit(info);
  } catch (reason) {
    runtime.retainOwnedDesktopResources(info);
    throw reason;
  }
});
