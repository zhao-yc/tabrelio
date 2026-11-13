import { test, expect, page, desktop, pageErrors } from './desktop-fixture';
import { queryCloseZh as text } from '../../src/renderer/locales/queryClose.zh-CN';
import type { UiCommandId } from '../../src/shared/uiCommands';

test('从窗口菜单恢复较早的同名草稿，保留另一份供快捷重开', async ({}, info) => {
  const title = '离线同名草稿';
  const drafts = [
    { id: 'older-closed', database: '旧草稿库', sql: 'SELECT 900719925474099312345;\r\n-- 较早草稿😀' },
    { id: 'newer-closed', database: '新草稿库', sql: 'SELECT 42;\n-- 较新草稿' },
  ];
  const connection = await page.evaluate(async ({ title, drafts }) => {
    const profile = await window.dbark.invoke('connections.save', {
      id: '', name: '离线草稿连接', group: '', color: '#51bda5', dialect: 'mysql', host: '127.0.0.1', port: 1, user: 'offline',
    });
    const settings = await window.dbark.invoke('settings.get', {});
    await window.dbark.invoke('settings.save', {
      ...settings, activeTabId: drafts[0].id,
      tabs: drafts.map(draft => ({
        ...draft, kind: 'query', title, connectionId: profile.id,
        databaseContext: { state: 'known', database: draft.database }, queryResultPlacement: 'beside', queryEditorWidth: 510,
      })),
    });
    return profile.id;
  }, { title, drafts });
  await page.reload();
  await expect(page.locator('.query-tab:visible .monaco-editor')).toBeVisible();
  const tabs = () => page.locator('[data-workspace-tab-id]');
  const enabled = (id: UiCommandId) => desktop.evaluate(({ Menu }, id) => Menu.getApplicationMenu()?.getMenuItemById(id)?.enabled === true, id);
  async function clickMenu(id: UiCommandId) {
    await expect.poll(() => enabled(id)).toBe(true);
    await desktop.evaluate(({ Menu, BrowserWindow }, id) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById(id), windows = BrowserWindow.getAllWindows();
      if (!item?.enabled || windows.length !== 1) throw Error('找不到隔离窗口的原生命令');
      item.click(item, windows[0], {} as Electron.KeyboardEvent);
    }, id);
  }
  expect(await enabled('retained-query-list')).toBe(false);
  for (const { id } of drafts) {
    await tabs().and(page.locator(`[data-workspace-tab-id="${id}"]`)).locator('.tab-close').click();
    const close = page.getByRole('dialog', { name: text.title, exact: true });
    await close.getByRole('button', { name: text.keepDraft, exact: true }).click();
    await expect(close).toBeHidden();
  }
  await expect(tabs()).toHaveCount(0);
  const list = page.getByRole('dialog', { name: text.retainedTitle, exact: true });
  await clickMenu('retained-query-list');
  await expect(list.getByRole('button', { name: text.retainedOpen(title, 1), exact: true })).toContainText('新草稿库');
  await expect(list.getByRole('button', { name: text.retainedOpen(title, 2), exact: true })).toContainText('旧草稿库');
  await page.keyboard.press('Escape');
  await expect(list).toBeHidden();
  await expect(tabs()).toHaveCount(0);
  await clickMenu('retained-query-list');
  const older = list.getByRole('button', { name: text.retainedOpen(title, 2), exact: true });
  await expect(older).toContainText('较早草稿😀');
  await list.screenshot({ path: info.outputPath('retained-queries.png') });
  await older.focus();
  await page.keyboard.press('Enter');
  await expect(list).toBeHidden();
  await expect(tabs()).toHaveCount(1);

  const persisted = () => page.evaluate(() => window.dbark.invoke('settings.get', {}));
  await expect.poll(async () => (await persisted()).tabs.map(tab => tab.sql)).toEqual([drafts[0].sql]);
  const first = (await persisted()).tabs[0];
  expect(first.id).not.toBe(drafts[0].id);
  expect(first).toMatchObject({
    title, connectionId: connection, databaseContext: { state: 'known', database: drafts[0].database },
    queryResultPlacement: 'beside', queryEditorWidth: 510,
  });
  // 等已恢复标签的编辑器挂载，再使用窗口菜单公开的重开快捷键。
  await expect(page.locator('.query-tab:visible .monaco-editor').getByRole('textbox')).toBeVisible();
  await expect.poll(() => enabled('reopen-query')).toBe(true);
  await page.keyboard.press('ControlOrMeta+Shift+T');
  await expect(tabs()).toHaveCount(2);
  await expect.poll(async () => (await persisted()).tabs.map(tab => tab.sql)).toEqual(drafts.map(draft => draft.sql));
  expect((await persisted()).tabs[1].id).not.toBe(drafts[1].id);
  await expect.poll(() => enabled('retained-query-list')).toBe(false);
  await expect.poll(() => enabled('reopen-query')).toBe(false);
  expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
  expect(await page.evaluate(() => window.dbark.invoke('tasks.list', {}))).toEqual([]);
  expect(pageErrors).toEqual([]);
});
