import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { confirmOwnedDesktopExit, dataDir, desktop, expect, page, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';
import { queryResultKeywordZh as text } from '../../src/renderer/locales/queryResultKeyword.zh-CN';
import { queryResultSortZh as sortText } from '../../src/renderer/locales/queryResultSort.zh-CN';
import { postgresZh } from '../../src/renderer/locales/postgres.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import type { NetworkConnectionProfile } from '../../src/shared/contracts';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });

test('查询结果按关键字筛选、保持排序并导出显示行', async ({}, info) => {
  const dialect = process.env.DBARK_QUERY_KEYWORD_DIALECT;
  test.skip(!dialect, '需要显式启用关键字筛选专项');
  const local = dialect === 'sqlite';
  const database = local ? 'main' : process.env.DBARK_QUERY_KEYWORD_DATABASE ?? '';
  const port = Number(process.env.DBARK_QUERY_KEYWORD_PORT);
  const password = process.env.DBARK_QUERY_KEYWORD_PASSWORD ?? '';
  if (process.env.DBARK_DEV_URL || process.env.DBARK_EXECUTABLE_PATH ||
      (local ? process.env.DBARK_INTEGRATION_ENABLED !== '0' :
        process.env.DBARK_INTEGRATION_ENABLED !== '1' || !['postgresql', 'mysql', 'mariadb'].includes(dialect!) ||
        !/^tabrelio_kw_[a-f0-9]{12}$/.test(database) || !/^[a-f0-9]{64}$/.test(password) ||
        !Number.isInteger(port) || port <= 1024 || port > 65535)) throw Error('仅允许本例 SQLite 文件或独占回环实库');
  const directory = await realpath(dataDir);
  const sqliteFile = join(directory, 'keyword.sqlite'), output = join(directory, 'filtered.json');
  if (local) new DatabaseSync(sqliteFile).close();
  const profile: NetworkConnectionProfile | undefined = local ? undefined : {
    id: '', dialect: dialect as NetworkConnectionProfile['dialect'], name: dialect!, group: '', color: '#123456',
    host: '127.0.0.1', port, database, user: database, password, rememberPassword: false,
  };
  const sql = "SELECT 1 AS id, 'target A' AS label UNION ALL SELECT 2, 'other' UNION ALL SELECT 3, 'Target C' ORDER BY id";
  try {
    // 只接管本例隔离文件选择，SQL 执行、文件授权及导出仍经过真实客户端。
    await desktop.evaluate(({ dialog, BrowserWindow }, paths) => {
      const open = dialog.showOpenDialog, save = dialog.showSaveDialog;
      if (paths.local) dialog.showOpenDialog = (async (...args: unknown[]) => {
        dialog.showOpenDialog = open;
        if (args[0] !== BrowserWindow.getAllWindows()[0] || !(args.at(-1) as Electron.OpenDialogOptions).filters?.[0]?.extensions.includes('sqlite'))
          throw Error('越过本例数据库选择范围');
        return { canceled: false, filePaths: [paths.sqliteFile] };
      }) as typeof open;
      dialog.showSaveDialog = (async (...args: unknown[]) => {
        dialog.showSaveDialog = save;
        if (args[0] !== BrowserWindow.getAllWindows()[0] || !(args.at(-1) as Electron.SaveDialogOptions).filters?.[0]?.extensions.includes('json'))
          throw Error('越过本例导出范围');
        return { canceled: false, filePath: paths.output };
      }) as typeof save;
    }, { local, sqliteFile, output });
    await page.evaluate(async ({ profile, sql, database }) => {
      const id = 'keyword-sqlite';
      const picked = profile ? undefined : await window.dbark.invoke('files.choose', { purpose: 'sqlite-database', sqliteConnectionId: id });
      if (!profile && !picked) throw Error('本例 SQLite 文件未授权');
      const connection = await window.dbark.invoke('connections.save', profile ?? { id, dialect: 'sqlite', name: 'SQLite', group: '', color: '#123456',
        sqlite: { fileToken: picked!.token, readOnly: true, busyTimeoutMs: 1000 } });
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'keyword', tabs: [
        { id: 'keyword', kind: 'query', title: '结果关键字', connectionId: connection.id, database, sql },
      ] });
    }, { profile, sql, database });
    await page.reload();
    const query = page.locator('.query-tab:visible');
    const editor = query.locator('.monaco-editor').getByRole('textbox');
    await expect(editor).toBeVisible();
    const execute = () => dialect === 'postgresql'
      ? query.getByRole('button', { name: postgresZh.execute, exact: true }).click()
      : query.locator('.query-execute-split button.primary').click();
    const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
    const grid = query.locator('.query-result-grid').getByRole('grid');
    const cells = grid.getByRole('gridcell').filter({ hasText: /^(target A|other|Target C)$/ });
    const search = query.getByRole('search', { name: text.input }), input = search.getByRole('searchbox', { name: text.input });
    await execute();
    await expect(cells).toHaveText(['target A', 'other', 'Target C']);
    await expect.poll(async () => (await history()).map(entry => entry.success)).toEqual([true]);
    const baseline = await history();
    const header = grid.getByRole('columnheader').filter({ hasText: /^id/i });
    await header.click();
    await expect(header.getByLabel(sortText.ascending)).toBeVisible();
    await header.click();
    await expect(header.getByLabel(sortText.descending)).toBeVisible();
    await input.fill('tArGeT');
    await input.press('Enter');
    await expect(search.getByRole('status')).toHaveText(text.counts(2, 3));
    await expect(cells).toHaveText(['Target C', 'target A']);
    await page.screenshot({ path: info.outputPath('查询结果关键字.png') });
    await header.click();
    await expect(cells).toHaveText(['target A', 'Target C']);
    await header.click();
    await expect(header.getByLabel(sortText.ascending)).toBeVisible();
    await header.click();
    await expect(cells).toHaveText(['Target C', 'target A']);

    await (await navigationMenuItem(query, { name: zh.resultExport.title, exact: true })).click();
    const dialog = page.getByRole('dialog', { name: zh.resultExport.title, exact: true });
    await dialog.getByLabel(zh.resultExport.format).selectOption('json');
    await dialog.getByRole('button', { name: new RegExp(zh.resultExport.chooseFile) }).click();
    await dialog.getByRole('button', { name: zh.resultExport.start, exact: true }).click();
    await expect(dialog.getByText(zh.resultExport.completed.replace('{0}', '2'))).toBeVisible();
    const exported = JSON.parse(await readFile(output, 'utf8')) as { label: string }[];
    expect(exported.map(row => row.label)).toEqual(['Target C', 'target A']);
    await dialog.getByRole('button', { name: zh.common.done, exact: true }).click();

    await input.fill('absent');
    await search.getByRole('button', { name: text.apply, exact: true }).click();
    await expect(search.getByRole('status')).toHaveText(text.counts(0, 3));
    await expect(cells).toHaveCount(0);
    await search.getByRole('button', { name: text.clear, exact: true }).click();
    await expect(cells).toHaveText(['Target C', 'other', 'target A']);
    expect(await history()).toEqual(baseline);
    await input.fill('target');
    await input.press('Enter');
    await expect(search.getByRole('status')).toHaveText(text.counts(2, 3));
    await execute();
    await expect(input).toHaveValue('');
    await expect(cells).toHaveText(['target A', 'other', 'Target C']);
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  }
});
