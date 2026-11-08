import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AppSettings, CommandMap } from '../../src/shared/contracts';
import { confirmOwnedDesktopExit, dataDir, desktop, expect, page, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });
test.skip(process.env.DBARK_WORKSPACE_TAB_CYCLE_NATIVE !== '1' || process.env.DBARK_INTEGRATION_ENABLED !== '0',
  '需显式启用离线标签循环专项');

test('工作区双向快捷键按现有顺序循环并保留原标签和编辑内容', async ({}, info) => {
  if (process.env.DBARK_DEV_URL || process.env.DBARK_EXECUTABLE_PATH)
    throw Error('标签循环只使用原生源码窗口和本例临时 SQLite 文件');
  const mac = process.platform === 'darwin';
  const next = mac ? 'Meta+Shift+]' : 'Control+Tab';
  const previous = mac ? 'Meta+Shift+[' : 'Control+Shift+Tab';
  const menu = () => desktop.evaluate(({ Menu }) => ['next-tab', 'previous-tab'].map(id => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(id);
    return { enabled: item?.enabled, accelerator: item?.accelerator };
  }));
  const accelerators = mac ? ['Command+Shift+]', 'Command+Shift+['] : ['Control+Tab', 'Control+Shift+Tab'];
  const expectMenu = (enabled: boolean) => expect.poll(menu).toEqual(accelerators.map(accelerator => ({ enabled, accelerator })));
  const active = () => page.locator('.tab-strip [data-active-workspace-tab="true"]');
  const expectActive = (id: string) => expect(active()).toHaveAttribute('data-workspace-tab-id', id);
  const editor = () => page.locator('.query-tab:visible .monaco-editor').getByRole('textbox');
  const settings = () => page.evaluate(() => window.dbark.invoke('settings.get', {}));
  const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
  const installTabs = (tabs: AppSettings['tabs']) => page.evaluate(async tabs => {
    const state = await window.dbark.invoke('settings.get', {});
    await window.dbark.invoke('settings.save', { ...state, tabs, activeTabId: tabs[0].id });
  }, tabs);

  try {
    await expectMenu(false);
    const file = join(await realpath(dataDir), 'tab-cycle.sqlite');
    const fixture = new DatabaseSync(file);
    try { fixture.exec("CREATE TABLE subject (id INTEGER PRIMARY KEY, marker TEXT); INSERT INTO subject VALUES (1, '原表记录');"); }
    finally { fixture.close(); }

    await desktop.evaluate(({ dialog, BrowserWindow }, filePath) => {
      const original = dialog.showOpenDialog;
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        dialog.showOpenDialog = original;
        if (args[0] !== BrowserWindow.getAllWindows()[0] ||
            !(args.at(-1) as Electron.OpenDialogOptions).filters?.[0]?.extensions.includes('sqlite'))
          throw Error('只允许当前窗口选择本例 SQLite 文件');
        return { canceled: false, filePaths: [filePath] };
      }) as typeof original;
    }, file);
    const connectionId = await page.evaluate(async () => {
      const id = 'tab-cycle';
      const picked = await window.dbark.invoke('files.choose', { purpose: 'sqlite-database', sqliteConnectionId: id });
      if (!picked) throw Error('本例 SQLite 文件未获授权');
      const profile: CommandMap['connections.save']['input'] = { id, dialect: 'sqlite', name: '标签循环', group: '', color: '#123456',
        sqlite: { fileToken: picked.token, readOnly: true, busyTimeoutMs: 1000 } };
      return (await window.dbark.invoke('connections.save', profile)).id;
    });
    const source = { connectionId, database: 'main' };
    const a = { ...source, id: 'query-a', kind: 'query', title: '同名草稿', sql: 'SELECT 73;' } as const;
    const b = { ...source, id: 'query-b', kind: 'query', title: '同名草稿', sql: 'SELECT 24;' } as const;
    const table = { ...source, id: 'table', kind: 'table', title: '原表数据', table: 'subject' } as const;
    await installTabs([a]);
    await page.reload();
    await expectActive(a.id);
    await expectMenu(false);
    await editor().press(next);
    await expectActive(a.id);

    await installTabs([a, table, b]);
    await page.reload();
    await expectMenu(true);
    await expectActive(a.id);
    const beforeHistory = await history();

    // 在真实 Monaco 中编辑，切换后仍保留当前模型的文本和撤销栈。
    await editor().press(mac ? 'Meta+ArrowDown' : 'Control+End');
    const addition = ' -- 编辑保留';
    await page.keyboard.insertText(addition);
    await expect.poll(async () => (await settings()).tabs.find(tab => tab.id === a.id)?.sql).toBe(a.sql + addition);

    await editor().press(previous);
    await expectActive(b.id);
    await expect(page.locator('.query-tab:visible .view-lines')).toContainText('24');
    await editor().press(previous);
    await expectActive(table.id);
    const cell = page.locator('.workspace-tab:visible').getByRole('gridcell', { name: '原表记录', exact: true });
    await cell.click();
    await page.keyboard.press(next);
    await expectActive(b.id);
    await editor().press(next);
    await expectActive(a.id);
    await expect(page.locator('.query-tab:visible .view-lines')).toContainText('编辑保留');

    await editor().dispatchEvent('keydown', { key: mac ? '}' : 'Tab', metaKey: mac, ctrlKey: !mac, shiftKey: mac, isComposing: true });
    await expectActive(a.id);
    await editor().press('ControlOrMeta+Shift+a');
    const dialog = page.getByRole('dialog', { name: '查找已打开标签', exact: true });
    await expect(dialog).toBeVisible();
    await expectMenu(false);
    const search = dialog.getByRole('combobox', { name: '搜索已打开标签', exact: true });
    await expect(search).toBeFocused();
    await search.press(next);
    await expectActive(a.id);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expectMenu(true);

    // 重排后原生菜单和快捷键均以新顺序定位，不依赖同名标签标题。
    await page.locator('[data-workspace-tab-id="query-b"] .tab-select').press('ControlOrMeta+Shift+ArrowLeft');
    await expect.poll(async () => (await settings()).tabs.map(tab => tab.id)).toEqual([a.id, b.id, table.id]);
    await desktop.evaluate(({ BrowserWindow, Menu }) => {
      const [window, ...others] = BrowserWindow.getAllWindows();
      const item = Menu.getApplicationMenu()?.getMenuItemById('next-tab');
      if (!window || others.length || !item?.enabled) throw Error('原生标签命令当前不可用');
      item.click({}, window, {});
    });
    await expectActive(b.id);
    await editor().press(previous);
    await expectActive(a.id);
    const undo = () => editor().press(mac ? 'Meta+z' : 'Control+z');
    await undo();
    await expect.poll(async () => (await settings()).tabs.find(tab => tab.id === a.id)?.sql).toBe(a.sql + ' --');
    await undo();
    await expect.poll(async () => (await settings()).tabs.map(tab => ({ id: tab.id, sql: tab.sql })))
      .toEqual([{ id: a.id, sql: a.sql }, { id: b.id, sql: b.sql }, { id: table.id, sql: undefined }]);
    expect(await history()).toEqual(beforeHistory);
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  }
});
