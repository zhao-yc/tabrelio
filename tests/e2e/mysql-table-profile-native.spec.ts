import { answerDialogs, confirmOwnedDesktopExit, desktop, expect, page, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';
import { tableGridZh as layoutText } from '../../src/renderer/locales/tableGrid.zh-CN';
import { tablePresetsZh as text } from '../../src/renderer/locales/tablePresets.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import type { CommandMap } from '../../src/shared/contracts';
import { tableFilterEnabledZh } from '../../src/renderer/locales/tableFilterEnabled.zh-CN';
import { tableFilteredSelectZh as selectText } from '../../src/renderer/locales/tableFilteredSelect.zh-CN';

type PageInput = CommandMap['table.page']['input'];

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

    // 旁观真实 Main 请求，核对展开只读配置、独立标签直接读首屏且没有无条件请求。
    await desktop.evaluate(({ ipcMain }, table) => {
      type Request = { command: string; input: PageInput };
      type Handler = (event: Electron.IpcMainInvokeEvent, request: Request) => Promise<unknown>;
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
      const original = handlers.get('dbark:request');
      if (!original) throw Error('缺少正式分页入口');
      const reads: PageInput[] = [];
      Object.assign(globalThis, { networkPresetTreeReads: reads });
      handlers.set('dbark:request', (event, request) => {
        if (request.command === 'table.page' && [table, 'profile_view'].includes(request.input.table)) reads.push(request.input);
        return original(event, request);
      });
    }, table);
    const reads = () => desktop.evaluate(() => (globalThis as typeof globalThis & { networkPresetTreeReads: PageInput[] }).networkPresetTreeReads);
    const settings = () => page.evaluate(() => window.dbark.invoke('settings.get', {}));
    const tree = page.locator('.sidebar');
    const branch = tree.getByRole('group', { name: text.treeExpand(table), exact: true });
    const entry = branch.getByRole('button', { name: text.treeOpen('组合方案'), exact: true });
    const openDatabase = async () => {
      await tree.getByRole('button', { name: '本例表方案', exact: true }).click();
      await tree.getByRole('button', { name: database, exact: true }).click();
    };
    const expandTree = async () => {
      await openDatabase();
      await tree.getByRole('button', { name: text.treeExpand(table), exact: true }).click();
      await expect(entry).toBeVisible();
    };
    await expandTree();
    expect(await reads()).toEqual([]);
    await (await navigationMenuItem(pane, { name: tableFilterEnabledZh.clear, exact: true })).click();
    await expect(data).toHaveCount(3);
    await pane.getByRole('button', { name: zh.table.text006, exact: true }).click();
    await pane.getByLabel(zh.table.text011, { exact: true }).fill('原标签输入');
    const beforeOpen = await reads();
    await entry.click();
    await expect(data).toHaveText(['match C', 'match A']);
    await expect(headers.nth(1)).toHaveCSS('width', '310px');
    await expect(headers.filter({ hasText: /^payload/i })).toHaveCount(0);
    await expect(pane.getByText(layoutText.unsaved, { exact: true })).toHaveCount(0);
    const first = (await reads()).slice(beforeOpen.length);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ page: 1, pageSize: (await settings()).pageSize, filters: [{ column: 'label', operator: 'LIKE', value: 'match%' }], sort: [{ column: 'id', direction: 'DESC' }] });
    await expect.poll(async () => (await settings()).tabs.length).toBe(2);
    const presetId = (await settings()).activeTabId!;
    expect(presetId).toMatch(/^mysql-preset:/);
    await entry.click();
    expect((await reads()).slice(beforeOpen.length)).toEqual(first);
    await page.screenshot({ path: info.outputPath('对象树独立表方案.png') });
    await (await navigationMenuItem(pane, { name: selectText.entry, exact: true })).click();
    const draft = page.getByRole('dialog', { name: selectText.title, exact: true });
    const sql = draft.getByLabel(selectText.preview, { exact: true });
    await expect(sql).toContainText("`label` LIKE _utf8mb4 X'" + Buffer.from('match%').toString('hex') + "'");
    await expect(sql).toContainText(/ORDER BY `id` DESC/);
    await draft.getByRole('button', { name: zh.common.close, exact: true }).click();
    expect((await reads()).slice(beforeOpen.length)).toEqual(first);

    await page.locator('[data-workspace-tab-id="profile"] .tab-select').click();
    await expect(data).toHaveCount(3);
    await expect(pane.getByLabel(zh.table.text011, { exact: true })).toHaveValue('原标签输入');
    await entry.click();
    await expect(data).toHaveText(['match C', 'match A']);
    await expect.poll(async () => (await settings()).activeTabId).toBe(presetId);
    const beforeReload = await reads();
    await page.reload();
    await expect(data).toHaveText(['match C', 'match A']);
    await expect(headers.nth(1)).toHaveCSS('width', '310px');
    const restored = (await reads()).slice(beforeReload.length);
    expect(restored).toHaveLength(2);
    expect(restored.filter(input => input.filters.length > 0)).toEqual([{ ...first[0], taskId: expect.any(String) }]);

    await page.locator('[data-workspace-tab-id="profile"] .tab-select').click();
    await expect(data).toHaveText(['match A', 'outside', 'match C']);
    await expect(headers.filter({ hasText: /^payload/i })).toBeVisible();
    await pane.getByRole('button', { name: zh.table.text006, exact: true }).click();
    await preset.getByRole('combobox', { name: text.choose, exact: true }).selectOption({ label: '组合方案' });
    await expandTree();
    await answerDialogs([0]);
    await preset.getByRole('button', { name: text.remove, exact: true }).click();
    await expect(branch.getByText(text.treeEmpty, { exact: true })).toBeVisible();
    await page.locator(`[data-workspace-tab-id="${presetId}"] .tab-select`).click();
    await expect(data).toHaveText(['match C', 'match A']);
    await expect.poll(async () => (await settings()).activeTabId).toBe(presetId);
    const beforeMissing = await reads();
    await page.reload();
    await expect(pane.getByText(text.tabMissing, { exact: true })).toBeVisible();
    await expect(data).toHaveCount(0);
    // 重载会恢复后台普通表的无条件首屏，失效方案及重试都不能增加分页。
    await expect.poll(async () => (await reads()).length).toBe(beforeMissing.length + 1);
    const afterMissing = await reads();
    expect(afterMissing.at(-1)?.filters).toEqual([]);
    await pane.getByRole('button', { name: text.retryOpen, exact: true }).click();
    await expect(pane.getByRole('button', { name: text.retryOpen, exact: true })).toBeEnabled();
    expect(await reads()).toEqual(afterMissing);

    await openDatabase();
    const view = tree.locator('.object-row').filter({ hasText: 'profile_view' });
    await view.locator('button.tree-label').click();
    await expect(data).toHaveCount(3);
    await view.getByRole('button', { name: text.treeExpand('profile_view'), exact: true }).click();
    const viewBranch = tree.getByRole('group', { name: text.treeExpand('profile_view'), exact: true });
    await expect(viewBranch.getByText(text.treeEmpty, { exact: true })).toBeVisible();
    await pane.getByRole('button', { name: zh.table.text006, exact: true }).click();
    await pane.getByLabel(zh.table.text009, { exact: true }).selectOption('label');
    await pane.getByLabel(zh.table.filterOperatorLabel, { exact: true }).selectOption('=');
    await pane.getByLabel(zh.table.text011, { exact: true }).fill('outside');
    await pane.getByRole('button', { name: zh.table.text013, exact: true }).click();
    await expect(data).toHaveText(['outside']);
    await preset.getByRole('textbox', { name: text.name, exact: true }).fill('视图方案');
    await preset.getByRole('button', { name: text.save, exact: true }).click();
    const viewEntry = viewBranch.getByRole('button', { name: text.treeOpen('视图方案'), exact: true });
    await expect(viewEntry).toBeVisible();
    const beforeView = await reads();
    await viewEntry.click();
    await expect(data).toHaveText(['outside']);
    expect((await reads()).slice(beforeView.length)).toEqual([expect.objectContaining({ table: 'profile_view', page: 1, filters: [expect.objectContaining({ column: 'label', value: 'outside' })] })]);
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  }
});
