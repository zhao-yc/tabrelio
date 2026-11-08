import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { confirmOwnedDesktopExit, dataDir, desktop, expect, page, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';
import { postgresZh } from '../../src/renderer/locales/postgres.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import type { NetworkConnectionProfile, PostgresConnectionProfile } from '../../src/shared/contracts';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });

test('原生查询结果数字切换保留焦点和快照，且不重新执行 SQL', async ({}, info) => {
  const dialect = process.env.DBARK_RESULT_SHORTCUT_DIALECT;
  test.skip(!dialect, '需显式启用结果集快捷键专项');
  const sqlite = dialect === 'sqlite', postgres = dialect === 'postgresql';
  const database = sqlite ? 'main' : process.env.DBARK_RESULT_SHORTCUT_DATABASE ?? '';
  const port = Number(process.env.DBARK_RESULT_SHORTCUT_PORT);
  const password = process.env.DBARK_RESULT_SHORTCUT_PASSWORD ?? '';
  if (process.env.DBARK_DEV_URL || process.env.DBARK_EXECUTABLE_PATH ||
      (sqlite ? process.env.DBARK_INTEGRATION_ENABLED !== '0' :
        process.env.DBARK_INTEGRATION_ENABLED !== '1' || !['postgresql', 'mysql', 'mariadb'].includes(dialect!) ||
        !/^tabrelio_js_[a-f0-9]{12}$/.test(database) || !/^[a-f0-9]{64}$/.test(password) ||
        !Number.isInteger(port) || port <= 1024 || port > 65535)) throw Error('只允许本例的源码和隔离数据库');
  const file = join(await realpath(dataDir), 'result-shortcut.sqlite');
  const profile: NetworkConnectionProfile | PostgresConnectionProfile | undefined = sqlite ? undefined : {
    id: '', dialect: dialect as (NetworkConnectionProfile | PostgresConnectionProfile)['dialect'], name: dialect!, group: '', color: '#123456',
    host: '127.0.0.1', port, database, user: database, password, rememberPassword: false,
  };

  try {
    if (sqlite) {
      const db = new DatabaseSync(file);
      try { db.exec('CREATE TABLE fixture (id INTEGER PRIMARY KEY)'); }
      finally { db.close(); }
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
    const sql = Array.from({ length: 10 }, (_, index) => `SELECT '结果数据-${index + 1}' AS marker;`).join('\n');
    await page.evaluate(async ({ profile, database, sql }) => {
      const id = 'result-shortcut-sqlite';
      const picked = profile ? undefined : await window.dbark.invoke('files.choose', { purpose: 'sqlite-database', sqliteConnectionId: id });
      if (!profile && !picked) throw Error('本例文件未获得授权');
      const connection = await window.dbark.invoke('connections.save', profile ?? { id, dialect: 'sqlite', name: 'SQLite',
        group: '', color: '#123456', sqlite: { fileToken: picked!.token, readOnly: true, busyTimeoutMs: 1000 } });
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'result-shortcut', tabs: [
        { id: 'result-shortcut', kind: 'query', title: '结果集快捷键', connectionId: connection.id, database, sql },
      ] });
    }, { profile, database, sql });
    await page.reload();

    const query = page.locator('.query-tab:visible');
    const editor = query.locator('.query-layout-editor .monaco-editor').getByRole('textbox');
    const result = query.locator('.query-layout-results');
    const body = result.getByRole('region', { name: zh.query.text016, exact: true });
    const cell = (ordinal: number) => body.getByRole('gridcell', { name: `结果数据-${ordinal}`, exact: true });
    const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
    const select = result.getByRole('combobox', { name: 'PostgreSQL结果集', exact: true });
    const buttons = result.locator('.query-result-tabs > button');
    const current = async (ordinal: number) => {
      await expect(cell(ordinal)).toBeVisible();
      if (postgres) await expect(select).toHaveValue(String(ordinal - 1));
      else await expect(buttons.nth(ordinal - 1)).toHaveAttribute('aria-pressed', 'true');
    };
    await expect(editor).toBeVisible();
    await (postgres ? query.getByRole('button', { name: postgresZh.execute, exact: true }) :
      query.locator('.query-execute-split button.primary')).click();
    await current(1);
    await expect.poll(async () => (await history()).length).toBeGreaterThan(0);
    const beforeHistory = await history();

    // 编辑器与网格都走真实键盘事件，0 对应第十组。
    await editor.focus();
    await page.keyboard.press('Alt+2');
    await current(process.platform === 'darwin' ? 1 : 2);
    await cell(process.platform === 'darwin' ? 1 : 2).click();
    await page.keyboard.press('Alt+0');
    await current(10);
    await expect(body).toBeFocused();
    await page.keyboard.press('Alt+3');
    await current(3);

    if (postgres) await select.selectOption('1');
    else await buttons.nth(1).click();
    await current(2);
    await (postgres ? result.getByRole('button', { name: zh.query.pinResult, exact: true }) :
      await navigationMenuItem(result, { name: zh.query.pinResult, exact: true })).click();
    const pins = result.getByRole('group', { name: zh.query.pinSection, exact: true });
    await expect(pins.getByRole('button', { pressed: true })).toHaveCount(1);
    await cell(2).click();
    await page.keyboard.press('Alt+1');
    await current(1);
    await expect(pins.getByRole('button', { name: zh.query.currentResults, exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(await history()).toEqual(beforeHistory);
    if (sqlite) expect(await readFile(file)).toEqual(beforeFile);
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  }
});
