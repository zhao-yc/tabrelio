import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test, expect, page, desktop, dataDir, pageErrors } from './desktop-fixture';
import { queryCloseZh as text } from '../../src/renderer/locales/queryClose.zh-CN';

test('从对象页关闭未固定的混合标签，可中途取消并从剩余标签重试', async ({}, info) => {
  const path = join(realpathSync(dataDir), '批量关闭只读样本.sqlite');
  const database = new DatabaseSync(path);
  try { database.exec("CREATE TABLE sample(id INTEGER PRIMARY KEY, note TEXT); INSERT INTO sample VALUES(1, '原记录');"); }
  finally { database.close(); }
  const original = readFileSync(path);
  // 只替换本例窗口的一次文件选择；授权和 SQLite 连接仍经过生产 IPC。
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
    const id = 'close-all-sqlite';
    const file = await window.dbark.invoke('files.choose', { purpose: 'sqlite-database', sqliteConnectionId: id });
    if (!file) throw Error('未选中本例文件');
    const connection = await window.dbark.invoke('connections.save', {
      id, name: '本地只读样本', dialect: 'sqlite', group: '', color: '#51bda5',
      sqlite: { fileToken: file.token, readOnly: true, busyTimeoutMs: 1000 },
    });
    const settings = await window.dbark.invoke('settings.get', {});
    const base = { connectionId: connection.id, database: 'main' };
    await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'objects', tabs: [
      { ...base, id: 'empty', kind: 'query', title: '空查询', sql: '' },
      { ...base, id: 'first', kind: 'query', title: '首份草稿', sql: 'SELECT 11;' },
      { ...base, id: 'table', kind: 'table', title: '表数据', table: 'sample' },
      { ...base, id: 'pinned', kind: 'query', title: '固定查询', sql: 'SELECT 22;', queryPinned: true },
      { ...base, id: 'objects', kind: 'objects', title: '对象浏览', objectCategory: 'table' },
      { ...base, id: 'last', kind: 'query', title: '末份草稿', sql: 'SELECT 33;' },
    ] });
  });
  await page.reload();
  await expect(page.locator('.object-browser:visible').getByText('sample', { exact: true })).toBeVisible();
  const ids = () => page.locator('[data-workspace-tab-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-workspace-tab-id')));
  const read = () => page.evaluate(() => window.dbark.invoke('settings.get', {}));
  const before = await read();
  const enabled = () => desktop.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('close-all-tabs')?.enabled === true);
  async function closeAll() {
    await expect.poll(enabled).toBe(true);
    await desktop.evaluate(({ Menu, BrowserWindow }) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById('close-all-tabs'), windows = BrowserWindow.getAllWindows();
      if (!item?.enabled || windows.length !== 1) throw Error('未找到当前窗口的关闭命令');
      item.click(item, windows[0], {} as Electron.KeyboardEvent);
    });
  }
  const confirm = page.getByRole('dialog', { name: text.title, exact: true });
  const action = (name: string) => confirm.getByRole('button', { name, exact: true });

  await closeAll();
  await expect(confirm).toBeVisible();
  await expect.poll(enabled).toBe(false);
  expect(await ids()).toEqual(['first', 'table', 'pinned', 'objects', 'last']);
  await action(text.cancel).click();
  await expect(confirm).toBeHidden();
  await expect.poll(async () => (await read()).tabs).toEqual(before.tabs.slice(1));

  await closeAll();
  await action(text.discard).click();
  await expect.poll(ids).toEqual(['pinned', 'last']);
  await expect(confirm).toBeVisible();
  await action(text.keepDraft).click();
  await expect(confirm).toBeHidden();
  await expect.poll(async () => (await read()).tabs).toEqual([before.tabs[3]]);
  expect(await ids()).toEqual(['pinned']);
  await expect.poll(enabled).toBe(false);
  await expect.poll(() => desktop.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('retained-query-list')?.enabled === true)).toBe(true);
  await page.locator('.tab-strip').screenshot({ path: info.outputPath('workspace-close-all.png') });
  expect(readFileSync(path)).toEqual(original);
  expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
  expect(pageErrors).toEqual([]);
});
