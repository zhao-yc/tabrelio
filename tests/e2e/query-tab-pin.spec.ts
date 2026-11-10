import { test, expect, page, desktop, pageErrors, quitDesktop, launchDesktop } from './desktop-fixture';
import { queryCloseZh as text } from '../../src/renderer/locales/queryClose.zh-CN';
import type { UiCommandId } from '../../src/shared/uiCommands';

test('固定后台查询后批量关闭跳过它，重启后仍可取消固定并关闭', async ({}, info) => {
  await page.evaluate(async () => {
    const connection = await window.dbark.invoke('connections.save', {
      id: '', name: '离线工作台连接', group: '', color: '#51bda5', dialect: 'mysql', host: '127.0.0.1', port: 1, user: 'offline',
    });
    const settings = await window.dbark.invoke('settings.get', {});
    const query = { kind: 'query' as const, connectionId: connection.id };
    await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'active', tabs: [
      { ...query, id: 'left', title: '日常核对', sql: 'SELECT 1;', queryPinned: true },
      { ...query, id: 'active', title: '当前查询', sql: '' },
      { ...query, id: 'right', title: '月末查询', sql: 'SELECT 900719925474099312345;\r\n-- 核对草稿', queryEditorWidth: 510 },
      { ...query, id: 'temporary', title: '临时查询', sql: 'SELECT 42;' },
    ] });
  });
  await page.reload();
  await expect(page.locator('.query-tab:visible .monaco-editor')).toBeVisible();

  const read = () => page.evaluate(() => window.dbark.invoke('settings.get', {}));
  const before = await read();
  const tab = (id: string) => page.locator(`[data-workspace-tab-id="${id}"]`);
  const ids = () => page.locator('[data-workspace-tab-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-workspace-tab-id')));
  const native = (id: UiCommandId) => desktop.evaluate(({ Menu }, id) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(id);
    return item && { enabled: item.enabled, checked: item.checked };
  }, id);
  async function clickMenu(id: UiCommandId) {
    await expect.poll(async () => (await native(id))?.enabled).toBe(true);
    await desktop.evaluate(({ Menu, BrowserWindow }, id) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById(id), windows = BrowserWindow.getAllWindows();
      if (!item?.enabled || windows.length !== 1) throw Error('找不到隔离窗口的原生命令');
      item.click(item, windows[0], {} as Electron.KeyboardEvent);
    }, id);
  }
  const close = () => page.getByRole('dialog', { name: text.title, exact: true });
  const discard = () => close().getByRole('button', { name: text.discard, exact: true });

  await tab('right').getByRole('button', { name: text.menuButton('月末查询'), exact: true }).click();
  await page.getByRole('menuitem', { name: text.pin, exact: true }).click();
  await expect(tab('right').locator('.query-tab-pin')).toBeVisible();
  await expect(tab('right').locator('.tab-close')).toBeDisabled();
  await expect(tab('active')).toHaveAttribute('data-active-workspace-tab', 'true');
  expect(await ids()).toEqual(['left', 'active', 'right', 'temporary']);

  await clickMenu('close-other-queries');
  await discard().click();
  await expect(tab('temporary')).toHaveCount(0);
  await expect(close()).toBeHidden();
  await expect.poll(async () => (await native('close-other-queries'))?.enabled).toBe(false);
  await expect.poll(async () => (await native('close-left-queries'))?.enabled).toBe(false);
  await expect.poll(async () => (await native('close-right-queries'))?.enabled).toBe(false);
  const expected = before.tabs.slice(0, 3).map(value => value.id === 'right' ? { ...value, queryPinned: true } : value);
  await expect.poll(async () => (await read()).tabs).toEqual(expected);

  await quitDesktop();
  await launchDesktop();
  expect((await read()).tabs).toEqual(expected);
  expect(await ids()).toEqual(['left', 'active', 'right']);
  await expect(tab('right').locator('.query-tab-pin')).toBeVisible();
  await expect(tab('right').locator('.tab-close')).toBeDisabled();
  await tab('right').locator('.tab-select').click();
  await expect.poll(() => native('pin-query-tab')).toEqual({ enabled: true, checked: true });
  await expect.poll(async () => (await native('close-tab'))?.enabled).toBe(false);
  await page.locator('.tab-strip').screenshot({ path: info.outputPath('query-tab-pin.png') });
  await clickMenu('pin-query-tab');
  await expect(tab('right').locator('.query-tab-pin')).toHaveCount(0);
  await expect.poll(async () => (await read()).tabs[2].queryPinned).toBe(false);
  await tab('right').locator('.tab-close').click();
  await discard().click();
  await expect(tab('right')).toHaveCount(0);
  await expect.poll(async () => (await read()).tabs).toEqual(expected.slice(0, 2));
  expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
  expect(await page.evaluate(() => window.dbark.invoke('tasks.list', {}))).toEqual([]);
  expect(pageErrors).toEqual([]);
});
