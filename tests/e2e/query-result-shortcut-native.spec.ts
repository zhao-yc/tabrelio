import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { confirmOwnedDesktopExit, dataDir, desktop, expect, page, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';
import { zh } from '../../src/renderer/locales/zh-CN';
import { queryLayoutZh } from '../../src/renderer/locales/queryLayout.zh-CN';
import { queryFailureSourceZh } from '../../src/renderer/locales/queryFailureSource.zh-CN';
import type { NetworkConnectionProfile, PostgresConnectionProfile } from '../../src/shared/contracts';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });

test('原生查询运行、停止与结果数字切换各自遵循焦点和原任务', async ({}, info) => {
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
    // 仅测试通过 Monaco 的公开 getter 核对定位后的选区。
    if (!sqlite && !postgres) await page.addInitScript(() => {
      self.MonacoEnvironment = { ...self.MonacoEnvironment, globalAPI: true };
    });
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
    const mac = process.platform === 'darwin', modifier = mac ? 'Meta' : 'Control';
    const runKey = modifier + '+r', currentKey = modifier + '+Shift+r', stopKey = mac ? 'Meta+.' : 'Control+t';
    await expect(editor).toBeVisible();
    await editor.press(runKey);
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

    // 两区往返保留当前结果和活动格，菜单通过原生命令走相同入口。
    await cell(3).click();
    await page.keyboard.press('F6');
    await expect(editor).toBeFocused();
    await page.keyboard.press('F6');
    await expect(cell(3)).toBeFocused();
    await expect.poll(() => desktop.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()?.getMenuItemById('focus-query-pane')?.enabled)).toBe(true);
    await desktop.evaluate(({ Menu, BrowserWindow }) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById('focus-query-pane');
      const windows = BrowserWindow.getAllWindows();
      if (!item?.enabled || windows.length !== 1) throw Error('本例的查询窗格菜单不可用');
      item.click(item, windows[0], {} as Electron.KeyboardEvent);
    });
    await expect(editor).toBeFocused();
    await current(3);

    const layout = query.getByRole('combobox', { name: queryLayoutZh.placement, exact: true });
    await expect(query).toHaveAttribute('data-result-layout', 'below');
    if (postgres) await layout.selectOption('results');
    else {
      await result.getByRole('button', { name: queryLayoutZh.placement, exact: true }).click();
      await page.getByRole('menu', { name: queryLayoutZh.placement, exact: true })
        .getByRole('menuitem', { name: queryLayoutZh.results, exact: true }).click();
    }
    await expect(query).toHaveAttribute('data-result-layout', 'results');
    await expect(editor).toBeHidden();
    await cell(3).click();
    await page.keyboard.press('F6');
    await expect(editor).toBeFocused();
    await expect(query).toHaveAttribute('data-result-layout', 'below');
    await current(3);
    expect(await history()).toEqual(beforeHistory);

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
    // 结果区和组合输入保留本地焦点，执行键不能送出 SQL。
    await body.press(runKey);
    await editor.dispatchEvent('keydown', { key: 'r', ctrlKey: !mac, metaKey: mac, isComposing: true });
    const replaceSql = async (sql: string) => {
      await editor.focus();
      await page.keyboard.press(modifier + '+a');
      await page.keyboard.insertText(sql);
    };
    const start = () => editor.press(mac ? 'Meta+ArrowUp' : 'Control+Home');
    const statements = ["SELECT '首句哨兵' AS marker;", "SELECT '仅当前语句' AS marker;", "SELECT '仅执行选区' AS marker;"];
    await replaceSql(statements.join('\n'));
    await start();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press(currentKey);
    await expect(body.getByRole('gridcell', { name: '仅当前语句', exact: true })).toBeVisible();
    await expect(body.getByRole('gridcell', { name: '首句哨兵', exact: true })).toHaveCount(0);
    await expect.poll(async () => (await history()).length).toBe(beforeHistory.length + 1);

    await start();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press(mac ? 'Meta+Shift+ArrowRight' : 'Shift+End');
    await page.keyboard.press('F6');
    await expect.poll(() => body.evaluate(node => node.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('F6');
    await expect(editor).toBeFocused();
    await page.keyboard.press(runKey);
    await expect(body.getByRole('gridcell', { name: '仅执行选区', exact: true })).toBeVisible();
    await expect.poll(async () => (await history()).length).toBe(beforeHistory.length + 2);
    const ran = (await history()).slice(0, 2).map(entry => entry.sql.trim().replace(/;$/, ''));
    expect(ran).toEqual([statements[2].slice(0, -1), statements[1].slice(0, -1)]);

    if (!sqlite && !postgres) {
      const locate = () => navigationMenuItem(result, { name: queryFailureSourceZh.locateResult, exact: true });
      const selection = () => query.locator('.query-layout-editor .monaco-editor').evaluate(element => {
        const api = (window as Window & { monaco?: typeof import('monaco-editor') }).monaco;
        const instance = api?.editor.getEditors().find(item => item.getContainerDomNode().contains(element));
        const model = instance?.getModel(), range = instance?.getSelection();
        if (!model || !range) throw Error('缺少原查询编辑器的选区');
        return { line: range.startLineNumber, text: model.getValueInRange(range) };
      });
      await (await locate()).click();
      await expect.poll(selection).toEqual({ line: 3, text: statements[2].slice(0, -1) });
      const duplicate = "SELECT '重复🧭' AS marker";
      const script = [duplicate, "SELECT '中间😀' AS marker", duplicate].join(';\r\n') + ';';
      await replaceSql(script);
      await start();
      await editor.press(runKey);
      await expect.poll(async () => (await history()).length).toBe(beforeHistory.length + 3);
      await expect(buttons).toHaveCount(3);
      const beforeLocate = await history();
      await buttons.nth(2).click();
      await result.getByRole('button', { name: queryLayoutZh.placement, exact: true }).click();
      await page.getByRole('menu', { name: queryLayoutZh.placement, exact: true })
        .getByRole('menuitem', { name: queryLayoutZh.results, exact: true }).click();
      await expect(editor).toBeHidden();
      await (await locate()).click();
      await expect(editor).toBeFocused();
      await expect(query).toHaveAttribute('data-result-layout', 'below');
      await expect.poll(selection).toEqual({ line: 3, text: duplicate });
      expect(await history()).toEqual(beforeLocate);
      await editor.press('ArrowRight');
      await page.keyboard.insertText(' ');
      await expect(await locate()).toBeDisabled();
      await page.keyboard.press('Escape');
    }

    const tasks = () => page.evaluate(() => window.dbark.invoke('tasks.list', {}));
    const known = new Set((await tasks()).map(task => task.id));
    const slow = sqlite
      ? 'WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1000000000) SELECT sum(x) FROM n;'
      : postgres ? 'SELECT pg_sleep(25);' : 'SELECT SLEEP(25);';
    await replaceSql(slow + "\nSELECT '停止后不得执行' AS marker;");
    await editor.press(runKey);
    await expect.poll(async () => (await tasks()).find(task => !known.has(task.id) && task.kind === 'query.execute')?.status).toBe('running');
    await body.press(stopKey);
    await expect.poll(async () => (await tasks()).find(task => !known.has(task.id) && task.kind === 'query.execute')?.status).toBe('cancelled');
    await expect(body.getByRole('gridcell', { name: '停止后不得执行', exact: true })).toHaveCount(0);
    if (sqlite) expect(await readFile(file)).toEqual(beforeFile);
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  }
});
