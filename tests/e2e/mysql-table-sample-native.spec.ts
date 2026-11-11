import { confirmOwnedDesktopExit, expect, page, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';
import { queryResultStatisticsZh as calendar } from '../../src/renderer/locales/queryResultStatistics.zh-CN';
import { tableStatisticsZh as stats } from '../../src/renderer/locales/tableStatistics.zh-CN';
import { tableHistogramZh as histogram } from '../../src/renderer/locales/tableHistogram.zh-CN';
import { tableSortZh as sort } from '../../src/renderer/locales/tableSort.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import type { NetworkConnectionProfile } from '../../src/shared/contracts';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });
test.skip(!process.env.DBARK_MYSQL_SAMPLE_DIALECT, '仅在显式启用的隔离 MySQL 或 MariaDB 源码窗口运行');

test('表页样本按已应用筛选与排序取前 N 行，三种统计共享范围', async ({}, info) => {
  const dialect = process.env.DBARK_MYSQL_SAMPLE_DIALECT, database = process.env.DBARK_MYSQL_SAMPLE_DATABASE ?? '';
  const password = process.env.DBARK_MYSQL_SAMPLE_PASSWORD ?? '', port = Number(process.env.DBARK_MYSQL_SAMPLE_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || process.env.DBARK_EXECUTABLE_PATH || process.env.DBARK_DEV_URL ||
      dialect !== 'mysql' && dialect !== 'mariadb' || !/^tabrelio_js_[a-f0-9]{12}$/.test(database) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535)
    throw Error('只允许本例源码与隔离回环数据库');
  try {
    const profile: NetworkConnectionProfile = { id: '', name: '表页抽样验收', dialect, group: '', color: '#123456', host: '127.0.0.1',
      port, user: database, database, password, rememberPassword: false };
    await page.evaluate(async input => {
      const connection = await window.dbark.invoke('connections.save', input);
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, pageSize: 50, activeTabId: 'events',
        tabs: ['events', 'events_view'].map(name => ({
          id: name, title: name, kind: 'table', connectionId: connection.id, database: input.database, table: name,
        })),
      });
    }, profile);
    await page.reload();
    const tab = page.locator('.table-tab:visible'), grid = tab.getByRole('grid');
    const rowMarker = (id: number) => grid.getByRole('gridcell', { name: 'marker-' + id, exact: true });
    const bar = tab.locator('.table-action-bar'), pageSize = bar.getByLabel(zh.table.text021, { exact: true });
    await expect(rowMarker(1)).toBeVisible();
    await expect(pageSize).toBeEnabled();
    await (await navigationMenuItem(tab, { name: sort.entry, exact: true })).click();
    const sorting = tab.getByRole('region', { name: sort.title, exact: true });
    await sorting.getByRole('button', { name: sort.add, exact: true }).click();
    await sorting.getByLabel(sort.field(1), { exact: true }).selectOption('id');
    await sorting.getByLabel(sort.direction(1), { exact: true }).selectOption('DESC');
    await sorting.getByRole('button', { name: sort.apply, exact: true }).click();
    await expect(rowMarker(120)).toBeVisible();
    await expect(pageSize).toBeEnabled();
    await (await navigationMenuItem(tab, { name: zh.table.text006, exact: true })).click();
    const filter = tab.locator('.filter-rule-form');
    await filter.getByLabel(zh.table.text009, { exact: true }).selectOption('bucket');
    await filter.getByLabel(zh.table.filterOperatorLabel, { exact: true }).selectOption('=');
    await filter.getByLabel(zh.table.text011, { exact: true }).fill('1');
    await filter.getByRole('button', { name: zh.table.text013, exact: true }).click();
    await expect(rowMarker(120)).toHaveCount(0);
    await expect(rowMarker(100)).toBeVisible();
    await bar.getByRole('button', { name: zh.common.pageNext, exact: true }).click();
    await expect(rowMarker(50)).toBeVisible();

    const tasks = () => page.evaluate(() => window.dbark.invoke('tasks.list', {}));
    const dialog = page.getByRole('dialog', { name: stats.title, exact: true });
    const read = () => dialog.getByRole('button', { name: /^(?:开始|重新)统计$/ }).click();
    const open = async () => {
      await expect(pageSize).toBeEnabled();
      await (await navigationMenuItem(tab, { name: stats.title, exact: true })).click();
    };
    const scope = dialog.getByLabel(stats.scopeMode, { exact: true });
    const size = dialog.getByLabel(stats.sampleLimit, { exact: true });
    const sampled = dialog.getByLabel(stats.sampledRows, { exact: true });
    await open();
    const baseline = await tasks();
    await scope.selectOption('first');
    await size.fill('0');
    await read();
    await expect(dialog.getByRole('alert')).toContainText(stats.sampleLimitInvalid);
    await size.fill('7');
    await dialog.getByRole('checkbox', { name: stats.selectColumn('amount'), exact: true }).check();
    await dialog.getByRole('checkbox', { name: stats.distinctOption, exact: true }).check();
    await dialog.getByLabel(histogram.column, { exact: true }).selectOption('amount');
    expect(await tasks()).toEqual(baseline);
    await read();
    await expect(sampled).toHaveText('7');
    await expect(dialog.getByText(stats.sampledScope(7), { exact: true })).toBeVisible();
    const summary = dialog.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'amount', exact: true }) });
    await expect(summary.getByRole('cell').nth(3)).toHaveText('6');
    await expect(summary).toContainText('9007199254740993.0094');
    await expect(summary).toContainText('9007199254740993.0100');
    const ranges = dialog.getByRole('region', { name: histogram.title, exact: true }).locator('tbody td:first-of-type');
    expect((await ranges.allTextContents()).map(Number).reduce((sum, count) => sum + count, 0)).toBe(6);
    await dialog.screenshot({ path: info.outputPath('表页前N条统计.png') });

    await dialog.getByLabel(stats.analysis, { exact: true }).selectOption('calendar');
    await dialog.getByLabel(stats.calendarColumn, { exact: true }).selectOption('occurred');
    await dialog.getByLabel(calendar.calendarUnit, { exact: true }).selectOption('day');
    await expect(sampled).toHaveCount(0);
    await read();
    await expect(sampled).toHaveText('7');
    const chart = dialog.getByRole('table', { name: calendar.calendar, exact: true });
    await expect(chart.getByRole('rowheader')).toHaveText(['2024-02-29', '2024-03-01']);
    await expect(chart.locator('tbody td:first-of-type')).toHaveText(['3', '3']);
    await expect(dialog.getByLabel(calendar.nulls, { exact: true })).toHaveText('1');
    await size.fill('200');
    await read();
    await expect(sampled).toHaveText('100');
    await scope.selectOption('all');
    await read();
    await expect(dialog.getByLabel(stats.rowCount, { exact: true })).toHaveText('100');
    await dialog.getByRole('button', { name: stats.close, exact: true }).click();
    await expect(rowMarker(50)).toBeVisible();
    expect((await tasks()).filter(task => task.kind === 'table.page')).toEqual(baseline.filter(task => task.kind === 'table.page'));

    await page.locator('[data-workspace-tab-id="events_view"]').getByRole('button', { name: 'events_view', exact: true }).click();
    await expect(bar).toContainText(zh.table.text016.replace('{0}', '5'));
    await open();
    await scope.selectOption('first');
    await size.fill('2');
    await expect(dialog.getByLabel(histogram.column, { exact: true })).toBeDisabled();
    await read();
    await expect(sampled).toHaveText('2');
    await dialog.getByRole('button', { name: stats.close, exact: true }).click();
    expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  }
});
