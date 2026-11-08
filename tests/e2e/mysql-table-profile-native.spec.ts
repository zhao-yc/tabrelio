import { confirmOwnedDesktopExit, expect, page, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';
import { tableGridZh as layoutText } from '../../src/renderer/locales/tableGrid.zh-CN';
import { tablePresetsZh as text } from '../../src/renderer/locales/tablePresets.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });

test('MySQL 和 MariaDB 表方案恢复筛选排序和列布局', async ({}, info) => {
  test.skip(process.env.DBARK_MYSQL_PROFILE_NATIVE !== '1', '需要显式启用表方案专项');
  const dialect = process.env.DBARK_MYSQL_PROFILE_DIALECT;
  const database = process.env.DBARK_MYSQL_PROFILE_DATABASE ?? '', password = process.env.DBARK_MYSQL_PROFILE_PASSWORD ?? '';
  const port = Number(process.env.DBARK_MYSQL_PROFILE_PORT), table = 'profile_subject';
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || process.env.DBARK_EXECUTABLE_PATH || process.env.DBARK_DEV_URL ||
      (dialect !== 'mysql' && dialect !== 'mariadb') || !/^tabrelio_pf_[a-f0-9]{12}$/.test(database) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535)
    throw Error('只允许本轮独占回环测试库');
  try {
    await page.evaluate(async ({ table, ...input }) => {
      const connection = await window.dbark.invoke('connections.save', { ...input, host: '127.0.0.1', user: input.database,
        id: '', name: '本例表方案', group: '', color: '#123456', rememberPassword: false });
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'profile', tabs: [
        { id: 'profile', kind: 'table', title: table, connectionId: connection.id, database: input.database, table },
      ] });
    }, { dialect, database, password, port, table } as const);
    await page.reload();
    const pane = page.locator('.table-tab:visible');
    const grid = pane.getByRole('grid', { name: layoutText.grid, exact: true });
    const data = grid.getByRole('gridcell').filter({ hasText: /^(match A|match C|outside)$/ });
    const headers = grid.getByRole('columnheader');
    await expect(data).toHaveText(['match A', 'outside', 'match C']);
    await pane.getByRole('button', { name: zh.table.text006, exact: true }).click();
    await pane.getByLabel(zh.table.text009, { exact: true }).selectOption('label');
    await pane.getByLabel(zh.table.filterOperatorLabel, { exact: true }).selectOption('LIKE');
    await pane.getByLabel(zh.table.text011, { exact: true }).fill('match%');
    await pane.getByRole('button', { name: zh.table.text013, exact: true }).click();
    await expect(data).toHaveText(['match A', 'match C']);
    const id = headers.filter({ hasText: /^id/i });
    await id.click();
    await expect(id).toHaveAttribute('aria-sort', 'ascending');
    await expect(pane.locator('.loading-overlay')).toHaveCount(0);
    await id.click();
    await expect(data).toHaveText(['match C', 'match A']);

    const layout = page.getByRole('dialog', { name: layoutText.preferences, exact: true });
    const openLayout = async () => {
      await (await navigationMenuItem(pane, { name: layoutText.preferences, exact: true })).click();
      await expect(layout).toBeVisible();
    };
    const closeLayout = async () => {
      await layout.getByRole('button', { name: zh.common.close, exact: true }).click();
      await expect(layout).toBeHidden();
    };
    await openLayout();
    await layout.getByRole('checkbox', { name: '显示列 payload', exact: true }).uncheck();
    await layout.getByRole('button', { name: '前移 label', exact: true }).click();
    await layout.getByRole('button', { name: '前移 label', exact: true }).click();
    const width = layout.getByRole('spinbutton', { name: '列宽 label', exact: true });
    await width.fill('310');
    await width.press('Tab');
    await closeLayout();
    await expect(headers.nth(1)).toContainText('label');
    await expect(headers.filter({ hasText: /^payload/i })).toHaveCount(0);
    const preset = pane.getByRole('region', { name: text.title, exact: true });
    const include = preset.getByRole('checkbox', { name: text.includeLayout, exact: true });
    await expect(include).not.toBeChecked();
    await include.check();
    await preset.getByRole('textbox', { name: text.name, exact: true }).fill('组合方案');
    await preset.getByRole('button', { name: text.save, exact: true }).click();
    await expect(preset.getByText(text.saved)).toBeVisible();

    await openLayout();
    await layout.getByRole('checkbox', { name: '显示列 payload', exact: true }).check();
    await layout.getByRole('button', { name: '后移 label', exact: true }).click();
    await closeLayout();
    await pane.getByRole('button', { name: zh.common.clearAll, exact: true }).click();
    await expect(data).toHaveCount(3);
    await expect(headers.filter({ hasText: /^payload/i })).toBeVisible();
    await preset.getByRole('combobox', { name: text.choose, exact: true }).selectOption({ label: '组合方案' });
    await expect(preset.getByText(text.hasLayout)).toBeVisible();
    const apply = preset.getByRole('button', { name: text.apply, exact: true });
    await apply.click();
    await expect(preset.getByText(text.applyLayoutPrompt)).toBeVisible();
    await preset.getByRole('button', { name: text.cancelChange, exact: true }).click();
    await expect(data).toHaveCount(3);
    await expect(headers.filter({ hasText: /^payload/i })).toBeVisible();
    await apply.click();
    await preset.getByRole('button', { name: text.confirmApplyLayout, exact: true }).click();
    await expect(preset.getByText(text.appliedWithLayout)).toBeVisible();
    await expect(data).toHaveText(['match C', 'match A']);
    await expect(headers.nth(1)).toContainText('label');
    await expect(headers.filter({ hasText: /^payload/i })).toHaveCount(0);
    await expect(headers.nth(1)).toHaveCSS('width', '310px');
    await page.screenshot({ path: info.outputPath('表方案恢复筛选排序与布局.png') });

    // 命名方案写入本机，但表的默认布局仍需单独保存。
    await page.reload();
    await expect(data).toHaveText(['match A', 'outside', 'match C']);
    await expect(headers.filter({ hasText: /^payload/i })).toBeVisible();
    await pane.getByRole('button', { name: zh.table.text006, exact: true }).click();
    await preset.getByRole('combobox', { name: text.choose, exact: true }).selectOption({ label: '组合方案' });
    await apply.click();
    await expect(preset.getByText(text.appliedWithLayout)).toBeVisible();
    await expect(data).toHaveText(['match C', 'match A']);
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  }
});
