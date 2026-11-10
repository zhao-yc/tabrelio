import { test, expect, page, desktop, pageErrors, quitDesktop, launchDesktop } from './desktop-fixture';
import { queryTabRenameZh as text } from '../../src/renderer/locales/queryTabRename.zh-CN';
import { queryCloseZh } from '../../src/renderer/locales/queryClose.zh-CN';
import { openTabSearchZh } from '../../src/renderer/locales/openTabSearch.zh-CN';

test('可重命名后台查询标签，原来源和正文保留且重启可按新名称检索', async ({}, info) => {
  const originalTitle = '同名查询', newTitle = '月末排查 🚢', activeTitle = '当前查询副本';
  await page.evaluate(async title => {
    const connection = await window.dbark.invoke('connections.save', {
      id: '', name: '离线改名连接', group: '', color: '#51bda5', dialect: 'mysql', host: '127.0.0.1', port: 1, user: 'offline',
    });
    const sql = 'SELECT 900719925474099312345;\r\n-- 精确草稿 🚢';
    const saved = await window.dbark.invoke('queries.create', {
      name: '本地保存的原查询', connectionId: connection.id, context: { state: 'known', database: '已知库' }, sql,
    });
    const settings = await window.dbark.invoke('settings.get', {});
    await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'active', tabs: [
      { id: 'active', kind: 'query', title, connectionId: connection.id, sql: 'SELECT 42;' },
      { id: 'background', kind: 'query', title, connectionId: connection.id, database: '已知库',
        databaseContext: { state: 'known', database: '已知库' }, sql, sourceBinding: saved.source,
        queryResultPlacement: 'beside', queryEditorWidth: 510 },
    ] });
  }, originalTitle);
  await page.reload();
  await expect(page.locator('.query-tab:visible .monaco-editor')).toBeVisible();
  const read = () => page.evaluate(() => window.dbark.invoke('settings.get', {}));
  const before = await read(), queries = await page.evaluate(() => window.dbark.invoke('queries.list', {}));
  const tab = (id: string) => page.locator(`[data-workspace-tab-id="${id}"]`);
  const dialog = page.getByRole('dialog', { name: text.action, exact: true });
  const name = dialog.getByLabel(text.name, { exact: true });
  const confirm = dialog.getByRole('button', { name: text.confirm, exact: true });
  async function openBackground() {
    await tab('background').getByRole('button', { name: queryCloseZh.menuButton(originalTitle), exact: true }).click();
    await page.getByRole('menuitem', { name: text.action, exact: true }).click();
    await expect(name).toHaveValue(originalTitle);
  }
  await openBackground();
  await name.fill('   ');
  await expect(confirm).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect(await read()).toEqual(before);
  await openBackground();
  await name.fill(` ${newTitle} `);
  await dialog.screenshot({ path: info.outputPath('query-tab-rename.png') });
  await name.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(tab('background').locator('.tab-select')).toHaveText(newTitle);
  await expect(tab('active')).toHaveAttribute('data-active-workspace-tab', 'true');
  const expectedTabs = before.tabs.map(value => value.id === 'background' ? { ...value, title: newTitle } : value);
  await expect.poll(async () => (await read()).tabs).toEqual(expectedTabs);

  async function clickMenu(id: 'rename-query-tab' | 'tab-search') {
    await expect.poll(() => desktop.evaluate(({ Menu }, id) => Menu.getApplicationMenu()?.getMenuItemById(id)?.enabled === true, id)).toBe(true);
    await desktop.evaluate(({ Menu, BrowserWindow }, id) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById(id), windows = BrowserWindow.getAllWindows();
      if (!item?.enabled || windows.length !== 1) throw Error('缺少隔离窗口的原生命令');
      item.click(item, windows[0], {} as Electron.KeyboardEvent);
    }, id);
  }
  await clickMenu('rename-query-tab');
  await expect(name).toHaveValue(originalTitle);
  await name.fill(activeTitle);
  await confirm.click();
  await expect(dialog).toBeHidden();
  await expect(tab('active').locator('.tab-select')).toHaveText(activeTitle);
  await quitDesktop(); await launchDesktop();
  expect((await read()).tabs).toEqual(expectedTabs.map(value => value.id === 'active' ? { ...value, title: activeTitle } : value));
  expect(await page.evaluate(() => window.dbark.invoke('queries.list', {}))).toEqual(queries);
  await clickMenu('tab-search');
  const search = page.getByRole('dialog', { name: openTabSearchZh.title, exact: true });
  await search.getByRole('combobox', { name: openTabSearchZh.searchLabel, exact: true }).fill('月末排查');
  await expect(search.getByRole('option')).toHaveCount(1);
  await expect(search.getByRole('option')).toContainText(newTitle);
  expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
  expect(await page.evaluate(() => window.dbark.invoke('tasks.list', {}))).toEqual([]);
  expect(pageErrors).toEqual([]);
});
