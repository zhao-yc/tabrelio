import { test, expect, page, pageErrors, confirmOwnedDesktopExit, retainOwnedDesktopResources } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';
import { postgresColumnStatisticsZh as stats } from '../../src/renderer/locales/postgresColumnStatistics.zh-CN';
import { postgresTableZh as tableText } from '../../src/renderer/locales/postgresTable.zh-CN';
import { queryResultStatisticsZh as calendar } from '../../src/renderer/locales/queryResultStatistics.zh-CN';
import { tableStatisticsZh as scope } from '../../src/renderer/locales/tableStatistics.zh-CN';
import { tableSortZh as sort } from '../../src/renderer/locales/tableSort.zh-CN';
import { tableHistogramZh as histogram } from '../../src/renderer/locales/tableHistogram.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });
test.skip(process.env.DBARK_POSTGRES_CALENDAR_NATIVE !== '1', '仅在显式启用的隔离 PostgreSQL 源码验收运行');

test('PostgreSQL 表和视图日期分布、已排序样本概况及直方图', async ({}, info) => {
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
      await window.dbark.invoke('settings.save', { ...settings, pageSize: 5, activeTabId: 'events',
        tabs: ['events', 'events_view', 'wide_calendar'].map(name => ({
          id: name, title: name, kind: 'table', connectionId: connection.id, database: input.database, table: '"public"."' + name + '"',
        })),
      });
    }, { id: '', name: '日期分布验收', dialect: 'postgresql' as const, group: '', color: '#123456', host: '127.0.0.1',
      port, user, database, password, rememberPassword: false });
    await page.reload();
    const tab = page.locator('.postgres-table-tab:visible'), grid = tab.getByRole('grid');
    await expect(grid).toBeVisible();
    await expect(tab.getByLabel(tableText.pageSize, { exact: true })).toHaveValue('5');
    await tab.getByRole('button', { name: tableText.advancedFilter, exact: true }).click();
    const advanced = tab.getByRole('region', { name: tableText.advancedFilter, exact: true });
    const draft = advanced.getByLabel(zh.table.text011, { exact: true });
    await advanced.getByLabel(zh.table.text009, { exact: true }).selectOption('bucket');
    await advanced.getByLabel(zh.table.filterOperatorLabel, { exact: true }).selectOption('=');
    await draft.fill('1');
    await advanced.getByRole('button', { name: zh.table.text013, exact: true }).click();
    await advanced.getByRole('button', { name: tableText.applyAdvancedFilter, exact: true }).click();
    const firstFive = grid.getByRole('gridcell', { name: /^marker-[1-5]$/ });
    await expect(firstFive).toHaveCount(5);
    await draft.fill('2');

    const dialog = page.getByRole('dialog', { name: stats.title, exact: true });
    const chart = dialog.getByRole('table', { name: calendar.calendar, exact: true });
    const open = async () => (await navigationMenuItem(tab, { name: stats.title, exact: true })).click();
    const chooseField = (name: string) => dialog.getByLabel(stats.field, { exact: true }).selectOption({ label: name });
    const chooseUnit = (unit: string) => dialog.getByLabel(calendar.calendarUnit, { exact: true }).selectOption(unit);
    const run = () => dialog.getByRole('button', { name: stats.readCalendar, exact: true }).click();
    const close = () => dialog.getByRole('button', { name: stats.close, exact: true }).click();
    async function distribution(labels: string[], counts: string[], nulls: string, ungrouped: string) {
      await expect(dialog.getByLabel(stats.rows, { exact: true })).toHaveText('100');
      await expect(chart.getByRole('rowheader')).toHaveText(labels);
      expect(await chart.locator('tbody tr').evaluateAll(rows => rows.map(row => row.querySelector('td')?.textContent))).toEqual(counts);
      await expect(dialog.getByLabel(calendar.nulls, { exact: true })).toHaveText(nulls);
      await expect(dialog.getByLabel(calendar.calendarUngrouped, { exact: true })).toHaveText(ungrouped);
    }
    async function selectTab(name: string) {
      await page.locator('[data-workspace-tab-id="' + name + '"]').getByRole('button', { name, exact: true }).click();
      await expect(grid).toBeVisible();
    }

    await open();
    await chooseField('occurred');
    await chooseUnit('day');
    await expect(chart).toHaveCount(0);
    await run();
    await distribution(['0001-02-29 BC', '2024-02-29', '2024-03-01', '10000-01-01'], ['1', '45', '49', '1'], '2', '2');
    await dialog.screenshot({ path: info.outputPath('PostgreSQL表页日期分布.png') });
    await chooseUnit('year');
    await expect(chart).toHaveCount(0);
    await run();
    await distribution(['0001 BC', '2024', '10000'], ['1', '94', '1'], '2', '2');
    await chooseField('logged');
    await chooseUnit('day');
    await run();
    await distribution(['2024-03-01', '2024-07-01'], ['45', '54'], '1', '0');
    await expect(dialog.getByText(stats.calendarZone('Europe/Paris'), { exact: true })).toBeVisible();
    await close();
    await expect(draft).toHaveValue('2');
    await expect(firstFive).toHaveCount(5);

    const tasks = () => page.evaluate(() => window.dbark.invoke('tasks.list', {}));
    const marker = (id: number) => grid.getByRole('gridcell', { name: 'marker-' + id, exact: true });
    await tab.getByRole('button', { name: sort.entry, exact: true }).click();
    const sorting = page.getByRole('dialog', { name: sort.entry, exact: true });
    await sorting.getByRole('button', { name: sort.add, exact: true }).click();
    await sorting.getByLabel(sort.field(1), { exact: true }).selectOption('id');
    await sorting.getByLabel(sort.direction(1), { exact: true }).selectOption('DESC');
    await sorting.getByRole('button', { name: sort.apply, exact: true }).click();
    await expect(marker(100)).toBeVisible();
    await tab.getByRole('button', { name: tableText.next, exact: true }).click();
    await expect(marker(95)).toBeVisible();
    await expect(marker(100)).toHaveCount(0);
    const baseline = await tasks();
    await open();
    await dialog.getByLabel(scope.scopeMode, { exact: true }).selectOption('first');
    const sampleLimit = dialog.getByLabel(scope.sampleLimit, { exact: true });
    const readSummary = () => dialog.getByRole('button', { name: stats.read, exact: true }).click();
    await sampleLimit.fill('100001');
    await readSummary();
    await expect(dialog.getByRole('alert')).toContainText(scope.sampleLimitInvalid);
    await sampleLimit.fill('7');
    await chooseField('id');
    expect(await tasks()).toEqual(baseline);
    await readSummary();
    const metric = (name: string) => dialog.getByRole('rowheader', { name, exact: true }).locator('..').getByRole('cell');
    await expect(dialog.getByText(scope.sampledScope(7), { exact: true })).toBeVisible();
    await expect(metric(scope.sampledRows)).toHaveText('7');
    await expect(metric(stats.min)).toHaveText('94');
    await expect(metric(stats.max)).toHaveText('100');
    await expect(metric(stats.sum)).toHaveText('679');
    await dialog.screenshot({ path: info.outputPath('PostgreSQL表页前7条字段概况.png') });
    await dialog.getByLabel(histogram.bins, { exact: true }).selectOption('5');
    await dialog.getByRole('button', { name: stats.readHistogram, exact: true }).click();
    const distributionChart = dialog.getByRole('region', { name: histogram.title, exact: true });
    await expect(dialog.getByText(scope.sampledRows + '：7', { exact: true })).toBeVisible();
    await expect(distributionChart.getByRole('rowheader').first()).toContainText('[94,');
    await expect(distributionChart.getByRole('rowheader').last()).toContainText(', 100]');
    const frequencies = await distributionChart.locator('tbody tr > td:nth-child(2)').allTextContents();
    expect(frequencies.reduce((total, value) => total + Number(value), 0)).toBe(7);
    await dialog.screenshot({ path: info.outputPath('PostgreSQL表页前7条数值分布.png') });
    await chooseField('occurred');
    await chooseUnit('day');
    await run();
    await expect(dialog.getByLabel(scope.sampledRows, { exact: true })).toHaveText('7');
    await expect(chart.getByRole('rowheader')).toHaveText(['0001-02-29 BC', '2024-03-01', '10000-01-01']);
    await expect(dialog.getByLabel(calendar.nulls, { exact: true })).toHaveText('2');
    await expect(dialog.getByLabel(calendar.calendarUngrouped, { exact: true })).toHaveText('2');
    await dialog.screenshot({ path: info.outputPath('PostgreSQL表页前7条日期分布.png') });
    await dialog.getByLabel(scope.scopeMode, { exact: true }).selectOption('all');
    await expect(chart).toHaveCount(0);
    await run();
    await distribution(['0001-02-29 BC', '2024-02-29', '2024-03-01', '10000-01-01'], ['1', '45', '49', '1'], '2', '2');
    await close();
    await expect(marker(95)).toBeVisible();

    await selectTab('events_view');
    await open();
    await chooseField('day_value');
    await run();
    await distribution(['0001-02 BC', '2024-02', '2024-03', '5874897-12'], ['1', '45', '49', '1'], '2', '2');
    await dialog.getByRole('button', { name: stats.read, exact: true }).click();
    await expect(dialog.getByRole('table', { name: stats.title, exact: true })).toContainText('100');
    await close();

    await selectTab('wide_calendar');
    await open();
    await chooseField('occurred');
    await chooseUnit('day');
    await run();
    await expect(dialog.getByRole('alert')).toContainText('超过 4096 个');
    await expect(chart).toHaveCount(0);
    await chooseUnit('month');
    await run();
    await expect(dialog.getByLabel(calendar.calendarGrouped, { exact: true })).toHaveText('4097');
    await close();
    await tab.getByRole('button', { name: tableText.advancedFilter, exact: true }).click();
    await advanced.getByLabel(zh.table.text009, { exact: true }).selectOption('id');
    await advanced.getByLabel(zh.table.filterOperatorLabel, { exact: true }).selectOption('!=');
    await draft.fill('4096');
    await advanced.getByRole('button', { name: zh.table.text013, exact: true }).click();
    await advanced.getByRole('button', { name: tableText.applyAdvancedFilter, exact: true }).click();
    await open();
    await chooseField('occurred');
    await chooseUnit('day');
    await run();
    await expect(dialog.getByLabel(calendar.calendarGrouped, { exact: true })).toHaveText('4096');
    await expect(dialog.getByLabel(stats.rows, { exact: true })).toHaveText('4098');
    await expect(dialog.getByLabel(calendar.nulls, { exact: true })).toHaveText('1');
    await expect(dialog.getByLabel(calendar.calendarUngrouped, { exact: true })).toHaveText('1');
    await expect(chart.getByRole('rowheader').first()).toHaveText('2000-01-01');
    await dialog.getByRole('button', { name: zh.common.pageNext, exact: true }).click();
    await expect(chart.getByRole('rowheader').first()).toHaveText('2000-02-20');
    await close();
    expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  }
});
