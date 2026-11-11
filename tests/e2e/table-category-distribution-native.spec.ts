import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Locator, TestInfo } from '@playwright/test';
import { confirmOwnedDesktopExit, dataDir, desktop, expect, page, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';
import { sqliteValueOptionsZh as sqlite } from '../../src/renderer/locales/sqliteValueOptions.zh-CN';
import { postgresTableZh as postgres } from '../../src/renderer/locales/postgresTable.zh-CN';
import { valueDistributionZh as distribution } from '../../src/renderer/locales/valueDistribution.zh-CN';
import { gridHeaderMenuZh as header } from '../../src/renderer/locales/gridHeaderMenu.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });

/** 用独立准备的固定数据验证分母和余数，搜索变更与本地翻页仍由原窗口处理。 */
async function inspectDistribution(dialog: Locator, controls: { read: Locator; search: Locator; order: Locator; next: Locator }, info: TestInfo, screenshot: string) {
  const chart = dialog.getByRole('table', { name: distribution.title, exact: true });
  const summary = dialog.getByRole('group', { name: distribution.title, exact: true });
  const toggle = dialog.getByRole('checkbox', { name: distribution.enable, exact: true });
  const hot = chart.getByRole('row').filter({ hasText: /"hot"/i });
  await expect(toggle).not.toBeChecked();
  await controls.order.selectOption('count-desc');
  await toggle.check();
  await expect(chart).toHaveCount(0);
  await controls.read.click();
  await expect(summary).toContainText(distribution.totals('640', '529'));
  await expect(summary).toContainText(distribution.remainder('29', '29', '4.53%'));
  await expect(hot.getByRole('cell', { name: '15.63%', exact: true })).toBeVisible();
  await expect(chart.getByRole('row').filter({ hasText: '"NULL"' })).toHaveCount(1);
  await expect(chart.getByRole('row').filter({ hasText: /(?:^| · )NULL10/ })).toHaveCount(1);
  await dialog.screenshot({ path: info.outputPath(screenshot) });
  await controls.next.click();
  await expect(hot).toHaveCount(0);
  await expect(summary).toContainText(distribution.totals('640', '529'));
  await controls.search.fill('s052');
  await controls.read.click();
  await expect(summary).toContainText(distribution.totals('6', '6'));
  await expect(chart.getByRole('cell', { name: '16.67%', exact: true })).toHaveCount(6);
  await controls.search.fill('absent');
  await controls.read.click();
  await expect(summary).toContainText(distribution.totals('0', '0'));
  await expect(chart).toHaveCount(0);
  await controls.search.fill('');
  await controls.read.click();
  await hot.getByRole('checkbox').check();
}

async function openColumnValues(grid: Locator) {
  await grid.getByRole('columnheader', { name: 'category', exact: true }).click({ button: 'right' });
  await page.getByRole('menu', { name: header.menu, exact: true }).getByRole('menuitem', { name: header.columnValues, exact: true }).click();
}

async function verifyAppliedCategory(open: () => Promise<void>, dialog: Locator, read: string, close: string) {
  await open();
  await dialog.getByRole('checkbox', { name: distribution.enable, exact: true }).check();
  await dialog.getByRole('button', { name: read, exact: true }).click();
  await expect(dialog.getByRole('group', { name: distribution.title, exact: true })).toContainText(distribution.totals('100', '1'));
  await dialog.getByRole('button', { name: close, exact: true }).click();
}

test.describe('SQLite 类别分布', () => {
  test.skip(process.env.DBARK_SQLITE_CATEGORY_NATIVE !== '1', '仅在显式启用的 SQLite 源码窗口运行');
  test('完整分布保留存储类型，选择后应用原筛选草稿', async ({}, info) => {
    if (process.env.DBARK_INTEGRATION_ENABLED !== '0' || process.env.DBARK_EXECUTABLE_PATH || process.env.DBARK_DEV_URL)
      throw Error('只允许 SQLite 离线源码验收');
    const file = join(realpathSync(dataDir), '类别分布.sqlite');
    const db = new DatabaseSync(file);
    try {
      db.exec('CREATE TABLE events(id INTEGER PRIMARY KEY, bucket INTEGER, category COLLATE NOCASE)');
      const insert = db.prepare('INSERT INTO events VALUES (?, ?, ?)');
      for (let id = 1; id <= 650; id++) {
        const value = id <= 525 ? 's' + String(id).padStart(4, '0') :
          id <= 625 || id > 640 ? 'hot' : id <= 635 ? null : id <= 639 ? '' : 'NULL';
        insert.run(id, id <= 640 ? 1 : 2, value === 'hot' && id >= 600 && id <= 625 ? 'HOT' : value);
      }
    } finally { db.close(); }
    const hash = () => createHash('sha256').update(readFileSync(file)).digest('hex'), before = hash();
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
        const id = 'sqlite-table-categories';
        const picked = await window.dbark.invoke('files.choose', { purpose: 'sqlite-database', sqliteConnectionId: id });
        if (!picked) throw Error('未获得本例文件授权');
        const connection = await window.dbark.invoke('connections.save', { id, name: 'SQLite 类别分布', dialect: 'sqlite', group: '', color: '#123456',
          sqlite: { fileToken: picked.token, readOnly: true, busyTimeoutMs: 1000 } });
        const settings = await window.dbark.invoke('settings.get', {});
        await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'events', tabs: [
          { id: 'events', title: 'events', kind: 'table', connectionId: connection.id, database: 'main', table: 'events' },
        ] });
      });
      await page.reload();
      const tab = page.locator('.sqlite-table-tab:visible'), grid = tab.getByRole('grid');
      const apply = tab.getByRole('button', { name: '应用 SQLite 筛选排序', exact: true });
      await expect(grid).toBeVisible();
      if (!await apply.isVisible()) await (await navigationMenuItem(tab.locator('.toolbar'), { name: '筛选与排序', exact: true })).click();
      await tab.getByLabel('SQLite 每页条数', { exact: true }).fill('5');
      await tab.getByRole('button', { name: '添加 SQLite 筛选条件', exact: true }).click();
      await tab.getByLabel('SQLite 筛选 1 字段', { exact: true }).selectOption('bucket');
      await tab.getByLabel('SQLite 筛选 1 运算符', { exact: true }).selectOption('eq');
      await tab.getByLabel('SQLite 筛选 1 值类型', { exact: true }).selectOption('integer');
      await tab.getByLabel('SQLite 筛选 1 条件值', { exact: true }).fill('1');
      await apply.click();
      const firstPage = grid.getByRole('gridcell', { name: /^s000[1-5]$/ });
      await expect(firstPage).toHaveCount(5);
      const lookups = () => page.evaluate(async () => (await window.dbark.invoke('tasks.list', {})).filter(task => task.kind === 'sqlite.valueOptions'));
      expect(await lookups()).toHaveLength(0);
      await openColumnValues(grid);
      const dialog = page.getByRole('dialog', { name: sqlite.title, exact: true });
      await inspectDistribution(dialog, { read: dialog.getByRole('button', { name: sqlite.read, exact: true }),
        search: dialog.getByLabel(sqlite.search, { exact: true }), order: dialog.getByLabel(sqlite.order, { exact: true }),
        next: dialog.getByRole('button', { name: sqlite.next, exact: true }) }, info, 'SQLite类别分布.png');
      expect((await lookups()).map(task => task.status)).toEqual(Array(4).fill('completed'));
      await dialog.getByRole('button', { name: sqlite.add, exact: true }).click();
      await expect(firstPage).toHaveCount(5);
      await apply.click();
      await expect(grid.getByRole('gridcell', { name: /^hot$/i })).toHaveCount(5);
      await verifyAppliedCategory(() => openColumnValues(grid), dialog, sqlite.read, sqlite.close);
      expect((await lookups()).map(task => task.status)).toEqual(Array(5).fill('completed'));
      expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
      expect(pageErrors).toEqual([]);
      expect(hash()).toBe(before);
      await confirmOwnedDesktopExit(info);
    } catch (reason) {
      retainOwnedDesktopResources(info);
      throw reason;
    }
  });
});

test.describe('PostgreSQL 类别分布', () => {
  test.skip(process.env.DBARK_POSTGRES_CATEGORY_NATIVE !== '1', '仅在显式启用的隔离 PostgreSQL 源码窗口运行');
  test('在完整匹配分组中计算分母，类别可加入原筛选草稿', async ({}, info) => {
    const database = process.env.DBARK_POSTGRES_TEST_DATABASE ?? '', user = process.env.DBARK_POSTGRES_TEST_USER;
    const password = process.env.DBARK_POSTGRES_TEST_PASSWORD ?? '', port = Number(process.env.DBARK_POSTGRES_TEST_PORT);
    if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || process.env.DBARK_EXECUTABLE_PATH || process.env.DBARK_DEV_URL ||
        !/^tabrelio_pg_[a-f0-9]{12}$/.test(database) || user !== database ||
        !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535)
      throw Error('只允许本例源码与隔离回环数据库');
    try {
      await page.evaluate(async input => {
        const connection = await window.dbark.invoke('connections.save', input);
        const settings = await window.dbark.invoke('settings.get', {});
        await window.dbark.invoke('settings.save', { ...settings, pageSize: 5, activeTabId: 'events', tabs: [
          { id: 'events', title: 'events', kind: 'table', connectionId: connection.id, database: input.database, table: '"public"."events"' },
        ] });
      }, { id: '', name: 'PostgreSQL 类别分布', dialect: 'postgresql' as const, group: '', color: '#123456', host: '127.0.0.1',
        port, user, database, password, rememberPassword: false });
      await page.reload();
      const tab = page.locator('.postgres-table-tab:visible'), grid = tab.getByRole('grid');
      await expect(grid).toBeVisible();
      await tab.getByRole('button', { name: postgres.advancedFilter, exact: true }).click();
      const advanced = tab.getByRole('region', { name: postgres.advancedFilter, exact: true });
      const apply = advanced.getByRole('button', { name: postgres.applyAdvancedFilter, exact: true });
      await advanced.getByLabel(zh.table.text009, { exact: true }).selectOption('bucket');
      await advanced.getByLabel(zh.table.filterOperatorLabel, { exact: true }).selectOption('=');
      await advanced.getByLabel(zh.table.text011, { exact: true }).fill('1');
      await advanced.getByRole('button', { name: zh.table.text013, exact: true }).click();
      await apply.click();
      const firstPage = grid.getByRole('gridcell', { name: /^s000[1-5]$/ });
      await expect(firstPage).toHaveCount(5);
      const labels = postgres.valueOptions, dialog = page.getByRole('dialog', { name: labels.open, exact: true });
      const open = async () => {
        await advanced.getByRole('button', { name: labels.open, exact: true }).click();
        await dialog.getByLabel(labels.column, { exact: true }).selectOption({ label: 'category' });
      };
      await open();
      await inspectDistribution(dialog, { read: dialog.getByRole('button', { name: labels.read, exact: true }),
        search: dialog.getByRole('searchbox', { name: labels.search, exact: true }), order: dialog.getByLabel(labels.order, { exact: true }),
        next: dialog.getByRole('button', { name: postgres.next, exact: true }) }, info, 'PostgreSQL类别分布.png');
      await dialog.getByRole('button', { name: labels.add, exact: true }).click();
      await expect(firstPage).toHaveCount(5);
      await apply.click();
      await expect(grid.getByRole('gridcell', { name: 'hot', exact: true })).toHaveCount(5);
      await verifyAppliedCategory(open, dialog, labels.read, postgres.cancel);
      expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
      expect(pageErrors).toEqual([]);
      await confirmOwnedDesktopExit(info);
    } catch (reason) {
      retainOwnedDesktopResources(info);
      throw reason;
    }
  });
});
