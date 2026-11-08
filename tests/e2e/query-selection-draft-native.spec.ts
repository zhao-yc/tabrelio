import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { confirmOwnedDesktopExit, dataDir, desktop, expect, page, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';
import { queryDuplicateZh as text } from '../../src/renderer/locales/queryDuplicate.zh-CN';
import type { NetworkConnectionProfile } from '../../src/shared/contracts';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });

test('四种数据库从单一选区打开独立查询，保留原正文、选区和上下文', async ({}, info) => {
  test.skip(process.env.DBARK_QUERY_SELECTION_DRAFT_NATIVE !== '1', '需要显式启用离线查询选区专项');
  if (process.env.DBARK_INTEGRATION_ENABLED !== '0' || process.env.DBARK_EXECUTABLE_PATH || process.env.DBARK_DEV_URL)
    throw Error('只允许离线源码验收');
  const databaseFile = join(realpathSync(dataDir), 'selection-source.sqlite');
  const fixture = new DatabaseSync(databaseFile);
  try { fixture.exec('CREATE TABLE selection_source (id INTEGER PRIMARY KEY)'); }
  finally { fixture.close(); }
  const prefix = "SELECT '原查询前段';\n", fragment = "  SELECT '🚢 选中正文',\n  9007199254740993;", suffix = "\nSELECT '原查询后段';";
  const sql = prefix + fragment + suffix;
  try {
    await desktop.evaluate(({ dialog, BrowserWindow }, filePath) => {
      const original = dialog.showOpenDialog;
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        dialog.showOpenDialog = original;
        if (args[0] !== BrowserWindow.getAllWindows()[0] || !(args.at(-1) as Electron.OpenDialogOptions).filters?.[0]?.extensions.includes('sqlite'))
          throw Error('只允许本窗口选择本例 SQLite 文件');
        return { canceled: false, filePaths: [filePath] };
      }) as typeof original;
    }, databaseFile);
    await page.addInitScript(() => { self.MonacoEnvironment = { ...self.MonacoEnvironment, globalAPI: true }; });
    await page.evaluate(async sql => {
      const sqliteId = 'selection-sqlite';
      const file = await window.dbark.invoke('files.choose', { purpose: 'sqlite-database', sqliteConnectionId: sqliteId });
      if (!file) throw Error('本例文件未获授权');
      const sqlite = await window.dbark.invoke('connections.save', { id: sqliteId, dialect: 'sqlite', name: 'sqlite', group: '', color: '#123456',
        sqlite: { fileToken: file.token, readOnly: true, busyTimeoutMs: 1000 } });
      const tabs: import('../../src/shared/contracts').AppSettings['tabs'] = [];
      for (const dialect of ['mysql', 'mariadb', 'postgresql'] as const) {
        const database = dialect + '_offline';
        const profile = await window.dbark.invoke('connections.save', { id: '', dialect, name: dialect, group: '', color: '#123456',
          host: '127.0.0.1', port: 1, user: 'offline', database });
        tabs.push({ id: dialect, kind: 'query', title: dialect, connectionId: profile.id, database, sql });
      }
      tabs.push({ id: 'sqlite', kind: 'query', title: 'sqlite', connectionId: sqlite.id, database: 'main', sql });
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'mysql', tabs });
    }, sql);
    await page.reload();
    const query = page.locator('.query-tab:visible'), editor = query.locator('.monaco-editor');
    const box = editor.getByRole('textbox');
    const settings = () => page.evaluate(() => window.dbark.invoke('settings.get', {}));
    const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
    const tasks = () => page.evaluate(() => window.dbark.invoke('tasks.list', {}));
    const open = (id: string) => page.locator('[data-workspace-tab-id="' + id + '"] .tab-select').click();
    const action = () => navigationMenuItem(query, { name: text.selection, exact: true });
    const dismissMenu = async () => {
      const trigger = query.locator('.action-menu-trigger[aria-expanded="true"]');
      if (await trigger.count()) await trigger.click();
      await expect(page.locator('.action-menu-panel:visible')).toHaveCount(0);
    };
    const beforeHistory = await history(), beforeTasks = await tasks();
    /** 只用模型布置待验范围，打开动作来自实际菜单或按钮。 */
    const inspect = (select?: 'fragment' | 'blank' | 'multiple') => editor.evaluate((element, mode) => {
      const api = (window as Window & { monaco?: typeof import('monaco-editor') }).monaco;
      const instance = api?.editor.getEditors().find(editor => editor.getContainerDomNode().contains(element));
      const model = instance?.getModel();
      if (!instance || !model) throw Error('缺少活动 SQL 模型');
      if (mode === 'fragment') instance.setSelection({ startLineNumber: 2, startColumn: 1, endLineNumber: 3, endColumn: model.getLineMaxColumn(3) });
      if (mode === 'blank') instance.setSelection({ startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 3 });
      if (mode === 'multiple') instance.setSelections([
        { selectionStartLineNumber: 2, selectionStartColumn: 1, positionLineNumber: 2, positionColumn: 8 },
        { selectionStartLineNumber: 3, selectionStartColumn: 1, positionLineNumber: 3, positionColumn: 8 },
      ]);
      const selection = instance.getSelection();
      return { id: model.id, sql: model.getValue(), selected: selection && model.getValueInRange(selection), eol: model.getEOL() };
    }, select);

    for (const dialect of ['mysql', 'mariadb', 'postgresql', 'sqlite'] as const) {
      await open(dialect);
      await expect(box).toBeVisible();
      const before = await settings(), parent = before.tabs.find(tab => tab.id === dialect)!;
      await expect(await action()).toBeDisabled();
      await dismissMenu();
      if (dialect === 'mysql') {
        await inspect('multiple');
        await expect(await action()).toBeDisabled();
        await dismissMenu();
        await inspect('blank');
        await (await action()).click();
        await expect(query.getByText(text.selectionRequired, { exact: true })).toBeVisible();
        expect((await settings()).tabs).toEqual(before.tabs);
      }
      const original = await inspect('fragment');
      const expected = fragment.replaceAll('\n', original.eol);
      expect(original.selected).toBe(expected);
      if (dialect === 'postgresql' || dialect === 'sqlite') {
        await box.focus();
        await page.keyboard.press('Shift+F10');
        await page.locator('.monaco-menu-container:visible').getByRole('menuitem', { name: text.selection, exact: true }).click({ delay: 120 });
      } else {
        await (await action()).click();
      }
      await expect.poll(async () => {
        const current = await settings();
        return { title: current.tabs.find(tab => tab.id === current.activeTabId)?.title, errors: await query.locator('.error-box').allTextContents() };
      }).toEqual({ title: parent.title + text.selectionSuffix, errors: [] });
      const current = await settings(), draft = current.tabs.find(tab => tab.id === current.activeTabId)!;
      expect(draft.id).not.toBe(parent.id);
      expect(draft).toMatchObject({ kind: 'query', sql: expected, connectionId: parent.connectionId, database: parent.database,
        databaseContext: { state: 'known', database: parent.database } });
      expect(draft.fileSourceBinding).toBeUndefined();
      expect(draft.sourceBinding).toBeUndefined();
      expect(current.tabs.find(tab => tab.id === parent.id)).toEqual(parent);
      await expect(box).toBeEditable();
      expect((await inspect()).sql).toBe(expected);
      if (dialect === 'postgresql') await page.screenshot({ path: info.outputPath('从选区打开新查询.png') });
      await open(parent.id);
      await expect.poll(inspect).toEqual(original);
    }
    expect(await history()).toEqual(beforeHistory);
    expect(await tasks()).toEqual(beforeTasks);
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  }
});

test('MySQL 和 MariaDB 默认库已切换时，选区草稿沿用实际会话数据库', async ({}, info) => {
  test.skip(process.env.DBARK_QUERY_SELECTION_DRAFT_LIVE !== '1', '需要本轮回环隔离库');
  const dialect = process.env.DBARK_CHECKED_RECORD_EDIT_DIALECT, database = process.env.DBARK_CHECKED_RECORD_EDIT_DATABASE ?? '';
  const user = process.env.DBARK_CHECKED_RECORD_EDIT_USER, password = process.env.DBARK_CHECKED_RECORD_EDIT_PASSWORD ?? '';
  const port = Number(process.env.DBARK_CHECKED_RECORD_EDIT_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_cmp_[a-f0-9]{12}$/.test(database) ||
      user !== database || !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535 ||
      (dialect !== 'mysql' && dialect !== 'mariadb')) throw Error('需要本轮独占回环库');
  const target = database + '_selected', use = 'USE `' + target + '`', fragment = "SELECT '只带入选中内容';";
  const source = "SELECT '前段';\n" + fragment + "\nSELECT '后段';";
  try {
    await page.addInitScript(() => { self.MonacoEnvironment = { ...self.MonacoEnvironment, globalAPI: true }; });
    const input: NetworkConnectionProfile = { id: '', name: dialect + ' 选区会话', dialect, group: '', color: '#123456',
      host: '127.0.0.1', port, database, user, password, rememberPassword: false };
    await page.evaluate(async ({ input, use }) => {
      const profile = await window.dbark.invoke('connections.save', input);
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'live-selection', tabs: [
        { id: 'live-selection', title: '实库选区', kind: 'query', connectionId: profile.id, database: input.database, sql: use },
      ] });
    }, { input, use });
    await page.reload();
    const query = page.locator('.query-tab:visible'), editor = query.locator('.monaco-editor');
    const box = editor.getByRole('textbox');
    await expect(box).toBeVisible();
    const settings = () => page.evaluate(() => window.dbark.invoke('settings.get', {}));
    const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
    await query.locator('.query-execute-split button.primary').click();
    await expect.poll(async () => (await history()).map(entry => [entry.sql, entry.success])).toEqual([[use, true]]);
    await expect.poll(async () => (await settings()).tabs[0]?.databaseContext).toEqual({ state: 'known', database: target });
    const before = await history();
    await expect(box).toBeEditable();
    await box.focus();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.insertText(source);
    await expect.poll(async () => (await settings()).tabs[0].sql?.replaceAll('\r\n', '\n')).toBe(source);
    await editor.evaluate(element => {
      const api = (window as Window & { monaco?: typeof import('monaco-editor') }).monaco;
      const instance = api?.editor.getEditors().find(editor => editor.getContainerDomNode().contains(element));
      const model = instance?.getModel();
      if (!instance || !model) throw Error('缺少原查询模型');
      instance.setSelection({ startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: model.getLineMaxColumn(2) });
    });
    const parent = (await settings()).tabs[0];
    await (await navigationMenuItem(query, { name: text.selection, exact: true })).click();
    await expect.poll(async () => (await settings()).tabs.length).toBe(2);
    const current = await settings(), draft = current.tabs.find(tab => tab.id === current.activeTabId)!;
    expect(draft.id).not.toBe(parent.id);
    expect(draft).toMatchObject({ kind: 'query', sql: fragment, connectionId: parent.connectionId, database: target,
      databaseContext: { state: 'known', database: target } });
    expect(current.tabs.find(tab => tab.id === parent.id)).toEqual(parent);
    await expect(box).toBeEditable();
    expect(await history()).toEqual(before);
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  }
});
