import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test, expect, page, desktop, dataDir, pageErrors, launchDesktop, quitDesktop } from './desktop-fixture';
import { openTabSearchZh as searchText } from '../../src/renderer/locales/openTabSearch.zh-CN';

test('原生命令和快捷键可在最近访问的查询及表页之间往返，关闭和重启更新历史', async ({}, info) => {
  const path = join(realpathSync(dataDir), '访问记录只读样本.sqlite');
  const database = new DatabaseSync(path);
  try { database.exec("CREATE TABLE sample(id INTEGER PRIMARY KEY, note TEXT); INSERT INTO sample VALUES(1, '原记录');"); }
  finally { database.close(); }
  const original = readFileSync(path);
  // 只替换本窗口的一次文件选择，授权和 SQLite 表数据走生产入口。
  await desktop.evaluate(({ dialog, BrowserWindow }, file) => {
    const open = dialog.showOpenDialog;
    dialog.showOpenDialog = (async (...args: unknown[]) => {
      dialog.showOpenDialog = open;
      const windows = BrowserWindow.getAllWindows(), options = args.at(-1) as Electron.OpenDialogOptions;
      if (windows.length !== 1 || args[0] !== windows[0] || !options.filters?.[0]?.extensions.includes('sqlite')) {
        throw Error('只允许测试窗口选取本例的 SQLite 文件');
      }
      return { canceled: false, filePaths: [file] };
    }) as typeof open;
  }, path);
  await page.evaluate(async () => {
    const id = 'last-used-sqlite';
    const file = await window.dbark.invoke('files.choose', { purpose: 'sqlite-database', sqliteConnectionId: id });
    if (!file) throw Error('未选中本例文件');
    const connection = await window.dbark.invoke('connections.save', {
      id, name: '本地只读样本', dialect: 'sqlite', group: '', color: '#51bda5',
      sqlite: { fileToken: file.token, readOnly: true, busyTimeoutMs: 1000 },
    });
    const settings = await window.dbark.invoke('settings.get', {});
    const base = { connectionId: connection.id, database: 'main' };
    await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'first', tabs: [
      { ...base, id: 'table', kind: 'table', title: '表数据', table: 'sample' },
      { ...base, id: 'first', kind: 'query', title: '最先查看', sql: 'SELECT 11;' },
      { ...base, id: 'objects', kind: 'objects', title: '未访问对象页', objectCategory: 'table' },
      { ...base, id: 'last', kind: 'query', title: '最近查询', sql: 'SELECT 33;' },
    ] });
  });
  await page.reload();
  const tab = (id: string) => page.locator(`[data-workspace-tab-id="${id}"]`);
  const active = (id: string) => expect(tab(id)).toHaveAttribute('data-active-workspace-tab', 'true');
  const enabled = () => desktop.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('last-used-tab')?.enabled === true);
  const read = () => page.evaluate(() => window.dbark.invoke('settings.get', {}));
  const before = await read();
  const primary = process.platform === 'darwin' ? 'Meta' : 'Control';
  const shortcut = () => page.keyboard.press(primary + '+Shift+F6');
  async function openLastUsed() {
    await expect.poll(enabled).toBe(true);
    await desktop.evaluate(({ Menu, BrowserWindow }) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById('last-used-tab'), windows = BrowserWindow.getAllWindows();
      if (!item?.enabled || windows.length !== 1) throw Error('未找到当前窗口的切换命令');
      item.click(item, windows[0], {} as Electron.KeyboardEvent);
    });
  }

  await active('first');
  await expect.poll(enabled).toBe(false);
  await tab('table').locator('.tab-select').click();
  await expect(page.locator('.sqlite-table-tab:visible').getByRole('gridcell', { name: '原记录', exact: true })).toBeVisible();
  await tab('last').locator('.tab-select').click();
  await active('last');
  await openLastUsed();
  await active('table');
  await shortcut();
  await active('last');

  await page.keyboard.press(primary + '+Shift+A');
  const dialog = page.getByRole('dialog', { name: searchText.title, exact: true });
  await expect(dialog).toBeVisible();
  const input = dialog.getByRole('combobox', { name: searchText.searchLabel, exact: true });
  const rows = dialog.getByRole('listbox').getByRole('option');
  const stripOrder = dialog.getByRole('button', { name: searchText.stripOrder, exact: true });
  const recentOrder = dialog.getByRole('button', { name: searchText.recentOrder, exact: true });
  await expect(stripOrder).toHaveAttribute('aria-pressed', 'true');
  await expect(rows.locator('strong')).toHaveText(['表数据', '最先查看', '未访问对象页', '最近查询']);
  await input.press('ArrowDown');
  await expect(rows.filter({ hasText: '表数据' })).toHaveAttribute('aria-selected', 'true');
  await input.press('Tab');
  await expect(stripOrder).toBeFocused();
  await stripOrder.press('Tab');
  await expect(recentOrder).toBeFocused();
  await recentOrder.press('Space');
  await expect(recentOrder).toHaveAttribute('aria-pressed', 'true');
  await expect(input).toBeFocused();
  await expect(rows.locator('strong')).toHaveText(['最近查询', '表数据', '最先查看', '未访问对象页']);
  await expect(rows.filter({ hasText: '表数据' })).toHaveAttribute('aria-selected', 'true');
  await dialog.screenshot({ path: info.outputPath('open-tab-search-recent.png') });
  await input.fill('query');
  await expect(rows.locator('strong')).toHaveText(['最近查询', '最先查看']);
  await stripOrder.click();
  await expect(rows.locator('strong')).toHaveText(['最先查看', '最近查询']);
  await recentOrder.click();
  await expect.poll(enabled).toBe(false);
  await shortcut();
  await expect(dialog).toBeVisible();
  await active('last');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await page.keyboard.press(primary + '+Shift+A');
  await expect(recentOrder).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  await tab('table').locator('.tab-close').click();
  await expect(tab('table')).toHaveCount(0);
  await openLastUsed();
  await active('first');
  await expect.poll(async () => (await read()).activeTabId).toBe('first');
  const expected = before.tabs.slice(1);
  expect((await read()).tabs).toEqual(expected);
  await page.locator('.tab-strip').screenshot({ path: info.outputPath('workspace-last-used-tab.png') });
  await quitDesktop(); await launchDesktop();
  await active('first');
  await expect.poll(enabled).toBe(false);
  await page.keyboard.press(primary + '+Shift+A');
  await expect(page.getByRole('button', { name: searchText.stripOrder, exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  expect((await read()).tabs).toEqual(expected);
  expect(readFileSync(path)).toEqual(original);
  expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
  expect(pageErrors).toEqual([]);
});
