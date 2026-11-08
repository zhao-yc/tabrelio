import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Locator } from '@playwright/test';
import { confirmOwnedDesktopExit, dataDir, desktop, expect, page, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { clickSidebarAction } from './sidebar-menu';
import { objectQueryZh } from '../../src/renderer/locales/objectQuery.zh-CN';
import type { NetworkConnectionProfile, PostgresConnectionProfile } from '../../src/shared/contracts';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });

test('从对象树、对象列表和数据页生成未执行的独立查询', async ({}, info) => {
  const dialect = process.env.DBARK_OBJECT_QUERY_DIALECT;
  test.skip(!dialect, '需显式启用对象查询专项');
  const sqlite = dialect === 'sqlite', postgres = dialect === 'postgresql';
  const database = sqlite ? 'main' : process.env.DBARK_OBJECT_QUERY_DATABASE ?? '';
  const password = process.env.DBARK_OBJECT_QUERY_PASSWORD ?? '';
  const port = Number(process.env.DBARK_OBJECT_QUERY_PORT);
  if (process.env.DBARK_DEV_URL || process.env.DBARK_EXECUTABLE_PATH ||
      (sqlite ? process.env.DBARK_INTEGRATION_ENABLED !== '0' :
        process.env.DBARK_INTEGRATION_ENABLED !== '1' || !['postgresql', 'mysql', 'mariadb'].includes(dialect!) ||
        !/^tabrelio_js_[a-f0-9]{12}$/.test(database) || !/^[a-f0-9]{64}$/.test(password) ||
        !Number.isInteger(port) || port <= 1024 || port > 65535)) throw Error('只允许本例源码与隔离数据库');

  const profile: NetworkConnectionProfile | PostgresConnectionProfile | undefined = sqlite ? undefined : {
    id: '', dialect: dialect as (NetworkConnectionProfile | PostgresConnectionProfile)['dialect'], name: dialect!, group: '',
    color: '#123456', host: '127.0.0.1', port, database, user: database, password, rememberPassword: false,
  };
  const file = join(await realpath(dataDir), 'object-query.sqlite');
  const table = postgres ? '"alt.scope"."odd"" table"' : sqlite ? 'odd." table' : 'odd` table';
  const view = postgres ? '"alt.scope"."odd"" view"' : sqlite ? 'odd." view' : 'odd` view';
  const target = (name: string) => postgres ? name : sqlite
    ? '"main"."' + name.replaceAll('"', '""') + '"' : '`' + database + '`.`' + name.replaceAll('`', '``') + '`';
  const sourceSql = "SELECT '原标签草稿';";
  const mac = process.platform === 'darwin';
  const shortcut = mac ? 'Meta+Shift+y' : 'Control+q';

  try {
    if (sqlite) {
      const fixture = new DatabaseSync(file);
      try {
        fixture.exec(`CREATE TABLE ${target(table)} (id INTEGER PRIMARY KEY, marker TEXT);
          INSERT INTO ${target(table)} VALUES (731, 'table-marker');
          CREATE VIEW ${target(view)} AS SELECT id, 'view-marker' AS marker FROM ${target(table)};`);
      } finally { fixture.close(); }
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
    }
    const beforeFile = sqlite ? await readFile(file) : undefined;
    const connectionId = await page.evaluate(async ({ profile, database, sourceSql }) => {
      const id = 'object-query-sqlite';
      const picked = profile ? undefined : await window.dbark.invoke('files.choose', { purpose: 'sqlite-database', sqliteConnectionId: id });
      if (!profile && !picked) throw Error('缺少本例 SQLite 文件授权');
      const saved = await window.dbark.invoke('connections.save', profile ?? {
        id, dialect: 'sqlite', name: 'sqlite', group: '', color: '#123456',
        sqlite: { fileToken: picked!.token, readOnly: true, busyTimeoutMs: 1000 },
      });
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'original', tabs: [
        { id: 'original', title: '原标签草稿', kind: 'query', connectionId: saved.id, database, sql: sourceSql },
        { id: 'objects', title: '本库对象列表', kind: 'objects', connectionId: saved.id, database, objectCategory: 'view' },
      ] });
      return saved.id;
    }, { profile, database, sourceSql });
    await page.reload();

    const query = page.locator('.query-tab:visible');
    const editor = query.locator('.query-layout-editor .monaco-editor').getByRole('textbox');
    const settings = () => page.evaluate(() => window.dbark.invoke('settings.get', {}));
    const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
    const tabButton = (title: string) => page.locator('.workspace-tab-button .tab-select').filter({ hasText: title });
    const row = (kind: 'table' | 'view', name: string, parent: Locator) =>
      parent.locator('[data-sidebar-node=' + JSON.stringify(JSON.stringify([connectionId, database, kind, name])) + ']');
    const connection = page.locator('.connection-node').filter({ has: page.getByRole('button', { name: dialect!, exact: true }) });
    const previousHistory = await history();

    async function expectDraft(name: string, action: () => Promise<unknown>) {
      const before = await settings();
      const beforeHistory = await history();
      await action();
      const sql = 'SELECT * FROM ' + target(name) + ' LIMIT ' + (postgres ? 1000 : 100) + ';';
      await expect.poll(async () => {
        const after = await settings();
        const active = after.tabs.find(tab => tab.id === after.activeTabId);
        return { count: after.tabs.length, sql: active?.sql, database: active?.database,
          context: active?.databaseContext, connectionId: active?.connectionId, title: active?.title };
      }).toEqual({ count: before.tabs.length + 1, sql, database, context: { state: 'known', database }, connectionId, title: name });
      await expect(editor).toBeVisible();
      expect((await settings()).tabs.find(tab => tab.id === 'original')?.sql).toBe(sourceSql);
      expect(await history()).toEqual(beforeHistory);
    }

    await expect(editor).toBeVisible();
    await editor.press(shortcut);
    expect((await settings()).tabs).toHaveLength(2);
    await connection.getByRole('button', { name: dialect!, exact: true }).click();
    await connection.getByRole('button', { name: database, exact: true }).click();
    const tableRow = row('table', table, connection);
    const viewRow = row('view', view, connection);
    const menuOptions = (name: string) => ({ name: objectQueryZh.entry + ' ' + name, exact: true });
    await expectDraft(table, () => clickSidebarAction(tableRow, menuOptions(table)));
    await expectDraft(view, () => viewRow.locator('.tree-label').press(shortcut));

    await tabButton('本库对象列表').click();
    const objects = page.locator('.object-browser:visible');
    await expectDraft(view, () => clickSidebarAction(row('view', view, objects), menuOptions(view)));
    const run = () => editor.press(mac ? 'Meta+r' : 'Control+r');
    await run();
    await expect(query.getByRole('gridcell', { name: 'view-marker', exact: true })).toBeVisible();
    await expect.poll(async () => (await history()).length).toBe(previousHistory.length + 1);

    // 用原数据页的网格按键，保留浏览标签和原查询草稿。
    if (sqlite) await tableRow.locator('.tree-label').dblclick();
    else await tableRow.locator('.tree-label').click();
    const tablePage = page.locator('.workspace-tab:visible').filter({ has: page.getByRole('gridcell', { name: 'table-marker', exact: true }) });
    const cell = tablePage.getByRole('gridcell', { name: 'table-marker', exact: true });
    await expect(cell).toBeVisible();
    await cell.click();
    await expectDraft(table, () => page.keyboard.press(shortcut));
    expect((await history()).length).toBe(previousHistory.length + 1);

    await run();
    await expect(query.getByRole('gridcell', { name: 'table-marker', exact: true })).toBeVisible();
    await expect.poll(async () => (await history()).length).toBe(previousHistory.length + 2);
    if (sqlite) expect(await readFile(file)).toEqual(beforeFile);
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  }
});
