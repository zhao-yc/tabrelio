import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { confirmOwnedDesktopExit, dataDir, desktop, expect, page, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { queryResultStatisticsZh as text } from '../../src/renderer/locales/queryResultStatistics.zh-CN';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });
test.skip(process.env.DBARK_SQLITE_QUERY_CALENDAR_NATIVE !== '1', '仅在显式启用的离线 SQLite 验收运行');

test('SQLite 真实查询的日期分布保留原日历日期、勾选范围和存储类型', async ({}, info) => {
  if (process.env.DBARK_INTEGRATION_ENABLED !== '0' || process.env.DBARK_EXECUTABLE_PATH || process.env.DBARK_DEV_URL)
    throw Error('只允许离线 SQLite 源码验收');
  const database = join(realpathSync(dataDir), '查询日期分布.sqlite');
  const db = new DatabaseSync(database);
  try {
    db.exec(`CREATE TABLE events(id INTEGER PRIMARY KEY, occurred);
      INSERT INTO events VALUES (1,'2024-02-29'),(2,'2024-02-29 18:00:00.000001'),(3,'2024-03-01T00:30:00+02:00'),
        (4,'2025-01-01'),(5,'2023-02-29'),(6,20240301),(7,NULL),(8,X'323032342D30322D3239');`);
  } finally { db.close(); }
  try {
    await desktop.evaluate(({ dialog, BrowserWindow }, path) => {
      const open = dialog.showOpenDialog;
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        dialog.showOpenDialog = open;
        if (args[0] !== BrowserWindow.getAllWindows()[0] || !(args.at(-1) as Electron.OpenDialogOptions).filters?.[0]?.extensions.includes('sqlite'))
          throw Error('只允许本窗口选择本例 SQLite 文件');
        return { canceled: false, filePaths: [path] };
      }) as typeof open;
    }, database);
    await page.evaluate(async () => {
      const id = 'sqlite-query-calendar';
      const file = await window.dbark.invoke('files.choose', { purpose: 'sqlite-database', sqliteConnectionId: id });
      if (!file) throw Error('未获得本例文件授权');
      const profile = await window.dbark.invoke('connections.save', { id, name: 'SQLite 日期验收', dialect: 'sqlite', group: '', color: '#123456',
        sqlite: { fileToken: file.token, readOnly: true, busyTimeoutMs: 1000 } });
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: id, tabs: [
        { id, title: '日期验收', kind: 'query', connectionId: profile.id, database: 'main', sql: 'SELECT id, occurred FROM events ORDER BY id' },
      ] });
    });
    await page.reload();
    const query = page.locator('.query-tab:visible'), grid = query.getByRole('grid');
    await query.locator('.monaco-editor').getByRole('textbox').press(process.platform === 'darwin' ? 'Meta+r' : 'Control+r');
    const first = grid.getByRole('gridcell', { name: '2024-02-29', exact: true });
    const third = grid.getByRole('gridcell', { name: '2024-03-01T00:30:00+02:00', exact: true });
    await first.locator('..').getByRole('checkbox').check();
    await third.locator('..').getByRole('checkbox').check();
    const receipts = () => page.evaluate(async () => ({ history: await window.dbark.invoke('history.list', {}), tasks: await window.dbark.invoke('tasks.list', {}) }));
    const baseline = await receipts();
    expect(baseline.history[0].success).toBe(true);
    await first.click();
    await query.getByRole('button', { name: text.open, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: text.title, exact: true });
    await expect(dialog.getByLabel(text.scope, { exact: true })).toHaveValue('selected');
    await expect(dialog.getByLabel(text.column, { exact: true })).toHaveValue('c1');
    await dialog.getByRole('button', { name: text.calendar, exact: true }).click();
    const table = dialog.getByRole('table', { name: text.calendar, exact: true });
    await expect(table.getByRole('rowheader')).toHaveText(['2024-02', '2024-03']);
    await expect(dialog.getByLabel(text.calendarGrouped, { exact: true })).toHaveText('2');
    await dialog.getByLabel(text.scope, { exact: true }).selectOption('all');
    await dialog.getByLabel(text.calendarUnit, { exact: true }).selectOption('day');
    await expect(table.getByRole('rowheader')).toHaveText(['2024-02-29', '2024-03-01', '2025-01-01']);
    await expect(table.locator('tbody tr').first().getByRole('cell').first()).toHaveText('2');
    await expect(dialog.getByLabel(text.calendarGrouped, { exact: true })).toHaveText('4');
    await expect(dialog.getByLabel(text.calendarUngrouped, { exact: true })).toHaveText('3');
    await expect(dialog.getByLabel(text.nulls, { exact: true })).toHaveText('1');
    await dialog.screenshot({ path: info.outputPath('SQLite查询日期分布.png') });
    await dialog.getByLabel(text.calendarUnit, { exact: true }).selectOption('year');
    await expect(table.getByRole('rowheader')).toHaveText(['2024', '2025']);
    await expect(table.locator('tbody tr').first().getByRole('cell').first()).toHaveText('3');
    await dialog.getByRole('button', { name: text.close, exact: true }).last().click();
    expect(await receipts()).toEqual(baseline);
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  }
});
