import { confirmOwnedDesktopExit, expect, page, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';
import { queryResultStatisticsZh as calendar } from '../../src/renderer/locales/queryResultStatistics.zh-CN';
import { tableStatisticsZh as stats } from '../../src/renderer/locales/tableStatistics.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import type { NetworkConnectionProfile } from '../../src/shared/contracts';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });

test('表和视图的全筛选日期分布保留日历及会话时区语义', async ({}, info) => {
  const dialect = process.env.DBARK_TABLE_CALENDAR_DIALECT;
  test.skip(!dialect, '仅在显式启用的隔离源码验收运行');
  const database = process.env.DBARK_TABLE_CALENDAR_DATABASE ?? '';
  const port = Number(process.env.DBARK_TABLE_CALENDAR_PORT);
  const password = process.env.DBARK_TABLE_CALENDAR_PASSWORD ?? '';
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || process.env.DBARK_DEV_URL || process.env.DBARK_EXECUTABLE_PATH ||
      dialect !== 'mysql' && dialect !== 'mariadb' || !/^tabrelio_js_[a-f0-9]{12}$/.test(database) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535)
    throw Error('只允许本例源码与隔离回环数据库');
  try {
    const profile: NetworkConnectionProfile = { id: '', dialect, name: '日期分布验收', host: '127.0.0.1', database,
      user: database, password, port, group: '', color: '#123456', rememberPassword: false };
    await page.evaluate(async profile => {
      const connection = await window.dbark.invoke('connections.save', profile);
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'events', pageSize: 50, tabs: [
        { id: 'events', kind: 'table', title: '日期表', connectionId: connection.id, database: profile.database, table: 'events' },
        { id: 'view', kind: 'table', title: '日期视图', connectionId: connection.id, database: profile.database, table: 'events_view' },
      ] });
    }, profile);
    await page.reload();
    const grid = page.locator('.table-grid-wrap:visible').getByRole('grid');
    const bar = page.locator('.table-action-bar:visible');
    await expect(grid).toBeVisible();
    await expect(bar.getByLabel(zh.table.text021, { exact: true })).toHaveValue('50');
    const filterToggle = async (name: RegExp) => {
      const button = page.getByRole('button', { name });
      return await button.isVisible() ? button : await navigationMenuItem(page.locator('.table-tab:visible'), { name });
    };
    await (await filterToggle(/^筛选$/)).click();
    const filter = page.locator('.filter-rule-form');
    await filter.getByLabel(zh.table.text009, { exact: true }).selectOption('bucket');
    await filter.getByLabel(zh.table.filterOperatorLabel, { exact: true }).selectOption('=');
    await filter.getByLabel(zh.table.text011, { exact: true }).fill('1');
    await filter.getByRole('button', { name: zh.table.text013, exact: true }).click();
    await expect(page.locator('.expanded-filter-panel')).toContainText('bucket');
    // 尚未提交的条件草稿不能进入独立统计请求。
    await filter.getByLabel(zh.table.text011, { exact: true }).fill('2');
    await expect(bar).toContainText(zh.table.text016.replace('{0}', '50'));

    const dialog = page.getByRole('dialog', { name: stats.title, exact: true });
    const chart = dialog.getByRole('table', { name: calendar.calendar, exact: true });
    const tasks = () => page.evaluate(() => window.dbark.invoke('tasks.list', {}));
    const baseline = await tasks();
    const open = async () => {
      const button = page.getByRole('button', { name: stats.title, exact: true });
      await (await button.isVisible() ? button : await navigationMenuItem(page.locator('.table-tab:visible'), { name: stats.title, exact: true })).click();
      await expect(dialog.getByLabel(stats.analysis, { exact: true })).toHaveValue('summary');
      await dialog.getByLabel(stats.analysis, { exact: true }).selectOption('calendar');
    };
    const run = () => dialog.getByRole('button', { name: stats.start, exact: true }).click();
    const close = () => dialog.getByRole('button', { name: stats.close, exact: true }).click();
    const chooseColumn = (name: string) => dialog.getByLabel(stats.calendarColumn, { exact: true }).selectOption(name);
    const chooseUnit = (unit: string) => dialog.getByLabel(calendar.calendarUnit, { exact: true }).selectOption(unit);
    async function distribution(labels: string[], counts: string[], nulls: string, ungrouped: string) {
      await expect(dialog.getByLabel(stats.rowCount, { exact: true })).toHaveText('100');
      await expect(chart.getByRole('rowheader')).toHaveText(labels);
      expect(await chart.locator('tbody tr').evaluateAll(rows => rows.map(row => row.querySelector('td')?.textContent))).toEqual(counts);
      await expect(dialog.getByLabel(calendar.nulls, { exact: true })).toHaveText(nulls);
      await expect(dialog.getByLabel(calendar.calendarUngrouped, { exact: true })).toHaveText(ungrouped);
    }

    await open();
    await chooseColumn('occurred');
    await chooseUnit('day');
    expect(await tasks()).toEqual(baseline);
    await run();
    await distribution(['2024-02-29', '2024-03-01', '2025-01-01'], ['45', '49', '2'], '2', '2');
    await dialog.screenshot({ path: info.outputPath('表数据统计日期分布.png') });
    await chooseUnit('year');
    await expect(chart).toHaveCount(0);
    await run();
    await distribution(['2024', '2025'], ['94', '2'], '2', '2');
    await chooseColumn('logged');
    await chooseUnit('day');
    await run();
    await distribution(['2024-03-01'], ['99'], '1', '0');
    await expect(dialog.getByText(stats.calendarZone('+02:00'), { exact: true })).toBeVisible();
    await close();
    await expect(filter.getByLabel(zh.table.text011, { exact: true })).toHaveValue('2');
    expect((await tasks()).filter(task => task.kind === 'table.page')).toEqual(baseline.filter(task => task.kind === 'table.page'));

    await page.locator('[data-workspace-tab-id="view"]').getByRole('button', { name: '日期视图', exact: true }).click();
    await expect(grid).toBeVisible();
    await open();
    await chooseColumn('day_value');
    await run();
    await distribution(['2024-02', '2024-03', '2025-01'], ['45', '49', '2'], '2', '2');
    await dialog.getByLabel(stats.analysis, { exact: true }).selectOption('summary');
    await expect(chart).toHaveCount(0);
    await run();
    await expect(dialog.getByLabel(stats.rowCount, { exact: true })).toHaveText('100');
    await close();
    await expect.poll(async () => (await tasks()).filter(task => task.kind === 'table.statistics').map(task => task.status))
      .toEqual(Array(5).fill('completed'));
    expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  }
});
