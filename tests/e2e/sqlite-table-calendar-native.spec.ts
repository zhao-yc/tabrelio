import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { confirmOwnedDesktopExit, dataDir, desktop, expect, page, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';
import { queryResultStatisticsZh as calendar } from '../../src/renderer/locales/queryResultStatistics.zh-CN';
import { sqliteStatisticsZh as statistics } from '../../src/renderer/locales/sqliteStatistics.zh-CN';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });
test.skip(process.env.DBARK_SQLITE_TABLE_CALENDAR_NATIVE !== '1', '仅在显式启用的离线 SQLite 验收运行');

test('SQLite 表页按已应用条件统计全部匹配日期并拒绝超限区间', async ({}, info) => {
  if (process.env.DBARK_INTEGRATION_ENABLED !== '0' || process.env.DBARK_EXECUTABLE_PATH || process.env.DBARK_DEV_URL)
    throw Error('只允许隔离 SQLite 源码验收');
  const file = join(realpathSync(dataDir), '全筛选日期分布.sqlite');
  const db = new DatabaseSync(file);
  try {
    db.exec(`PRAGMA encoding='UTF-16le';
      CREATE TABLE events(id INTEGER PRIMARY KEY, bucket INTEGER, occurred);
      CREATE VIEW wide_calendar AS WITH RECURSIVE series(id) AS (VALUES(1) UNION ALL SELECT id+1 FROM series WHERE id<4097)
      SELECT id, date('2000-01-01', '+' || id || ' days') AS occurred FROM series;`);
    const insert = db.prepare('INSERT INTO events VALUES(?,?,?)');
    for (let id = 1; id <= 120; id++) {
      const value = id <= 45 ? '2024-02-29' : id <= 94 ? '2024-03-01T00:30:00+02:00' : id <= 96 ? '2025-01-01' :
        id === 97 ? '2023-02-29' : id === 98 ? 20240301 : id === 99 ? '长文本'.repeat(24000) : id === 100 ? null : '2026-04-01';
      insert.run(id, id <= 100 ? 1 : 2, value);
    }
  } finally { db.close(); }
  const hash = () => createHash('sha256').update(readFileSync(file)).digest('hex');
  const before = hash();
  try {
    await desktop.evaluate(({ dialog, BrowserWindow }, path) => {
      const open = dialog.showOpenDialog;
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        dialog.showOpenDialog = open;
        if (args[0] !== BrowserWindow.getAllWindows()[0] || !(args.at(-1) as Electron.OpenDialogOptions).filters?.[0]?.extensions.includes('sqlite'))
          throw Error('只允许本窗口选择本例 SQLite 文件');
        return { canceled: false, filePaths: [path] };
      }) as typeof open;
    }, file);
    await page.evaluate(async () => {
      const id = 'sqlite-table-calendar';
      const selected = await window.dbark.invoke('files.choose', { purpose: 'sqlite-database', sqliteConnectionId: id });
      if (!selected) throw Error('未获得本例文件授权');
      const profile = await window.dbark.invoke('connections.save', { id, name: 'SQLite 日期分布验收', dialect: 'sqlite', group: '', color: '#123456',
        sqlite: { fileToken: selected.token, readOnly: true, busyTimeoutMs: 1000 } });
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'events', tabs: [
        { id: 'events', title: '日期表', kind: 'table', connectionId: profile.id, database: 'main', table: 'events' },
        { id: 'wide', title: '长日期范围', kind: 'table', connectionId: profile.id, database: 'main', table: 'wide_calendar' },
      ] });
    });
    await page.reload();
    const table = page.locator('.sqlite-table-tab:visible');
    const grid = table.getByRole('grid');
    const tasks = () => page.evaluate(() => window.dbark.invoke('tasks.list', {}));
    const current = () => page.evaluate(() => window.dbark.invoke('settings.get', {}));
    const filterValue = table.getByLabel('SQLite 筛选 1 条件值', { exact: true });
    await expect(grid).toBeVisible();
    const filters = () => navigationMenuItem(table.locator('.toolbar'), { name: '筛选与排序', exact: true });
    const apply = table.getByRole('button', { name: '应用 SQLite 筛选排序', exact: true });
    if (!await apply.isVisible()) await (await filters()).click();
    await table.getByLabel('SQLite 每页条数', { exact: true }).fill('5');
    await table.getByRole('button', { name: '添加 SQLite 筛选条件', exact: true }).click();
    await table.getByLabel('SQLite 筛选 1 字段', { exact: true }).selectOption('bucket');
    await table.getByLabel('SQLite 筛选 1 运算符', { exact: true }).selectOption('eq');
    await table.getByLabel('SQLite 筛选 1 值类型', { exact: true }).selectOption('integer');
    await filterValue.fill('1');
    await apply.click();
    await expect(grid.getByRole('gridcell', { name: '2024-02-29', exact: true })).toHaveCount(5);
    // 保留尚未应用的条件，统计必须继续使用已经应用的 bucket=1。
    await filterValue.fill('2');
    await (await filters()).click();
    const baseline = await tasks(), tabs = (await current()).tabs;
    const dialog = page.getByRole('dialog', { name: statistics.title, exact: true });
    const chart = dialog.getByRole('table', { name: calendar.calendar, exact: true });
    async function open() {
      await (await navigationMenuItem(table, { name: statistics.entry, exact: true })).click();
      await dialog.getByLabel(statistics.column, { exact: true }).selectOption('occurred');
      await dialog.getByLabel(statistics.analysis, { exact: true }).selectOption('calendar');
    }
    const run = () => dialog.getByRole('button', { name: statistics.read, exact: true }).click();
    const close = () => dialog.getByRole('button', { name: statistics.close, exact: true }).click();
    const counts = () => chart.locator('tbody tr').evaluateAll(rows => rows.map(row => row.querySelector('td')?.textContent));
    await open();
    expect(await tasks()).toEqual(baseline);
    await run();
    await expect(chart.getByRole('rowheader')).toHaveText(['2024-02', '2024-03', '2025-01']);
    expect(await counts()).toEqual(['45', '49', '2']);
    await expect(dialog.getByLabel(calendar.calendarGrouped, { exact: true })).toHaveText('96');
    await expect(dialog.getByLabel(calendar.calendarUngrouped, { exact: true })).toHaveText('3');
    await expect(dialog.getByLabel(calendar.nulls, { exact: true })).toHaveText('1');
    await dialog.screenshot({ path: info.outputPath('SQLite表页全筛选日期分布.png') });
    await dialog.getByLabel(calendar.calendarUnit, { exact: true }).selectOption('year');
    await expect(chart).toHaveCount(0);
    await run();
    await expect(chart.getByRole('rowheader')).toHaveText(['2024', '2025']);
    expect(await counts()).toEqual(['94', '2']);
    await close();
    await expect(grid.getByRole('gridcell', { name: '2024-02-29', exact: true })).toHaveCount(5);
    await (await filters()).click();
    await expect(filterValue).toHaveValue('2');
    expect((await current()).tabs).toEqual(tabs);
    expect((await tasks()).filter(task => task.kind === 'sqlite.tablePage')).toEqual(baseline.filter(task => task.kind === 'sqlite.tablePage'));

    await page.locator('[data-workspace-tab-id="wide"]').getByRole('button', { name: '长日期范围', exact: true }).click();
    await expect(grid).toBeVisible();
    await open();
    await dialog.getByLabel(calendar.calendarUnit, { exact: true }).selectOption('day');
    await run();
    await expect(dialog.getByRole('alert')).toContainText('超过 4096 个');
    await expect(chart).toHaveCount(0);
    await dialog.getByLabel(calendar.calendarUnit, { exact: true }).selectOption('month');
    await run();
    await expect(dialog.getByLabel(calendar.calendarGrouped, { exact: true })).toHaveText('4097');
    await close();
    await expect.poll(async () => (await tasks()).filter(task => task.kind === 'sqlite.calendar').map(task => task.status).sort())
      .toEqual(['completed', 'completed', 'completed', 'failed']);
    expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(hash()).toBe(before);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  }
});
