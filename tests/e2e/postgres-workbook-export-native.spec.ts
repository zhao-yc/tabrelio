import { Client } from 'pg';
import ExcelJS from 'exceljs';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { basename } from 'node:path';
import { postgresWorkbookExportZh as text } from '../../src/renderer/locales/workbookExport.zh-CN';
import { test, expect, desktop, page } from './desktop-fixture';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.skip(process.env.DBARK_POSTGRES_WORKSPACE_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
test.setTimeout(60_000);

test('PostgreSQL 对象列表跨 schema 导出同名关系，所有工作表沿用原读快照', async ({}, info) => {
  const user = process.env.DBARK_POSTGRES_TEST_USER ?? '', database = process.env.DBARK_POSTGRES_TEST_DATABASE ?? '';
  const password = process.env.DBARK_POSTGRES_TEST_PASSWORD ?? '', port = Number(process.env.DBARK_POSTGRES_TEST_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pg_[a-f0-9]{12}$/.test(user) || database !== user ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('需要本轮独占回环库');
  const observer = new Client({ host: '127.0.0.1', port, user, database, password, connectionTimeoutMillis: 3000 });
  await observer.connect();
  try {
    await observer.query(`CREATE SCHEMA workbook_reports;
      CREATE TABLE public."明细/表"(id bigint PRIMARY KEY, note text, payload bytea);
      INSERT INTO public."明细/表" VALUES (9223372036854775807, '原快照', decode('00ff', 'hex')), (2, NULL, decode('', 'hex'));
      CREATE VIEW workbook_reports."明细/表" AS SELECT '跨 schema 视图'::text AS label,
        pg_catalog.pg_advisory_xact_lock(62308914)::text AS barrier;
      CREATE TABLE workbook_reports."空表"(header text);`);
    const connectionId = await page.evaluate(async profile => (await window.dbark.invoke('connections.save', profile)).id, {
      id: '', name: '本例 PostgreSQL 多表导出', group: '', color: '#123456', dialect: 'postgresql' as const,
      host: '127.0.0.1', port, user, database, password, rememberPassword: false,
    });
    await page.evaluate(async ({ connectionId, database }) => {
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'pg-workbook-objects', tabs: [
        { id: 'pg-workbook-objects', kind: 'objects', title: '原对象列表', connectionId, database, objectCategory: 'table' },
      ] });
    }, { connectionId, database });
    await page.reload();
    await mkdir(info.outputDir, { recursive: true });
    const output = info.outputPath('PostgreSQL 多表工作簿.xlsx');
    await desktop.evaluate(({ dialog, BrowserWindow }, filePath) => {
      const original = dialog.showSaveDialog;
      let count = 0;
      dialog.showSaveDialog = (async (...args: unknown[]) => {
        const options = args.at(-1) as Electron.SaveDialogOptions;
        if (++count > 3 || args[0] !== BrowserWindow.getAllWindows()[0] || options.filters?.[0]?.extensions[0] !== 'xlsx')
          throw Error('仅允许本例工作簿保存位置');
        return { canceled: false, filePath };
      }) as typeof original;
      Object.assign(globalThis, { restorePgWorkbookChooser() { dialog.showSaveDialog = original; return count; } });
    }, output);
    const objects = page.locator('.object-browser:visible'), modal = page.getByRole('dialog', { name: text.title, exact: true });
    const launch = () => objects.getByRole('button', { name: text.open, exact: true }).click();
    const view = () => modal.getByRole('checkbox', { name: /workbook_reports.*明细\/表/ }).check();
    const table = () => modal.getByRole('checkbox', { name: /public.*明细\/表/ }).check();
    const choose = async () => {
      await modal.getByRole('button', { name: text.choose, exact: true }).click();
      await expect(modal.getByRole('button', { name: basename(output), exact: true })).toBeVisible();
    };
    const start = () => modal.getByRole('button', { name: text.export, exact: true }).click();
    const waitForCursor = () => expect.poll(async () => Number((await observer.query(`SELECT count(*) AS n FROM pg_stat_activity
      WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event='advisory'`)).rows[0].n), { timeout: 8_000 }).toBe(1);
    await launch(); await view(); await table();
    await modal.getByRole('checkbox', { name: /workbook_reports.*空表/ }).check();
    await expect(modal.getByRole('list', { name: text.order }).getByRole('listitem')).toHaveText([
      '"workbook_reports"."明细/表" → 明细_表', '"public"."明细/表" → 明细_表 (2)', '"workbook_reports"."空表" → 空表',
    ]);
    await choose();
    await observer.query('SELECT pg_advisory_lock(62308914)');
    try {
      await start();
      // 首个游标等待独占锁时，另一会话更新第二个对象，核实跨工作表仍保持首次快照。
      await waitForCursor();
      await observer.query(`UPDATE public."明细/表" SET note='并发连接已提交' WHERE id=9223372036854775807`);
    } finally { await observer.query('SELECT pg_advisory_unlock(62308914)'); }
    await expect(modal.getByRole('status')).toContainText(text.complete(3, 3));
    expect((await observer.query(`SELECT note FROM public."明细/表" WHERE id=9223372036854775807`)).rows[0].note).toBe('并发连接已提交');
    const book = new ExcelJS.Workbook();
    await book.xlsx.readFile(output);
    expect(book.worksheets.map(sheet => [sheet.name, sheet.rowCount])).toEqual([['明细_表', 2], ['明细_表 (2)', 3], ['空表', 1]]);
    expect(book.worksheets[0].getCell('A2').text).toBe('跨 schema 视图');
    const tableRows = [2, 3].map(row => ['A', 'B', 'C'].map(col => book.worksheets[1].getCell(col + row).text));
    expect(tableRows).toEqual([['2', '\\N', '\\B:'], ['9223372036854775807', '原快照', '\\B:AP8=']]);
    expect(book.worksheets[2].getCell('A1').text).toBe('header');
    await modal.screenshot({ path: info.outputPath('PostgreSQL 多表工作簿导出.png') });

    const original = await readFile(output);
    await modal.getByRole('button', { name: text.close, exact: true }).click();
    await launch(); await view(); await table(); await choose();
    await observer.query('SELECT pg_advisory_lock(62308914)');
    try {
      await start(); await waitForCursor();
      await modal.getByRole('button', { name: text.cancel, exact: true }).click();
      await expect(modal.getByRole('alert')).toBeVisible();
      await expect.poll(() => page.evaluate(async () => (await window.dbark.invoke('tasks.list', {}))
        .some(task => task.kind === 'postgres.workbookExport' && task.status === 'cancelled'))).toBe(true);
    } finally { await observer.query('SELECT pg_advisory_unlock(62308914)'); }
    expect(await readFile(output)).toEqual(original);
    await modal.getByRole('button', { name: text.close, exact: true }).click();
    await launch(); await table(); await view(); await choose();
    await observer.query('DROP VIEW workbook_reports."明细/表"');
    await start();
    await expect(modal.getByRole('alert')).toContainText('关系不存在');
    expect(await readFile(output)).toEqual(original);
    expect((await readdir(info.outputDir)).filter(name => name.endsWith('.partial'))).toEqual([]);
    expect(await desktop.evaluate(() => (globalThis as typeof globalThis & { restorePgWorkbookChooser(): number }).restorePgWorkbookChooser())).toBe(3);
  } finally { await observer.end(); }
});
