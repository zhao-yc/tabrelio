import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { confirmOwnedDesktopExit, dataDir, desktop, expect, page, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';
import { tableHeaderCopyZh as text } from '../../src/renderer/locales/tableHeaderCopy.zh-CN';
import { queryResultColumnsZh as columnsText } from '../../src/renderer/locales/queryResultColumns.zh-CN';
import { postgresZh } from '../../src/renderer/locales/postgres.zh-CN';
import type { NetworkConnectionProfile, PostgresConnectionProfile } from '../../src/shared/contracts';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });

test('无需选行即可复制表格和空查询结果的可见列名', async ({}, info) => {
  const dialect = process.env.DBARK_COLUMN_NAMES_DIALECT;
  test.skip(!dialect, '需要显式启用仅复制列名专项');
  const local = dialect === 'sqlite';
  const database = local ? 'main' : process.env.DBARK_COLUMN_NAMES_DATABASE ?? '';
  const port = Number(process.env.DBARK_COLUMN_NAMES_PORT);
  const password = process.env.DBARK_COLUMN_NAMES_PASSWORD ?? '';
  if (process.env.DBARK_DEV_URL || process.env.DBARK_EXECUTABLE_PATH ||
      (local ? process.env.DBARK_INTEGRATION_ENABLED !== '0' :
        process.env.DBARK_INTEGRATION_ENABLED !== '1' || !['postgresql', 'mysql', 'mariadb'].includes(dialect!) ||
        !/^tabrelio_cn_[a-f0-9]{12}$/.test(database) || !/^[a-f0-9]{64}$/.test(password) ||
        !Number.isInteger(port) || port <= 1024 || port > 65535)) throw Error('仅允许本例 SQLite 文件或独占回环实库');
  const table = 'header_subject', filePath = join(await realpath(dataDir), 'column-names.sqlite');
  if (local) {
    const fixture = new DatabaseSync(filePath);
    try {
      fixture.exec("CREATE TABLE header_subject (id INTEGER PRIMARY KEY, amount INTEGER, label TEXT, payload BLOB, nullable TEXT);" +
        "INSERT INTO header_subject VALUES (1,9007199254740993,'row A',X'00ff',NULL),(2,9007199254740994,'row B',X'','');" +
        'CREATE VIEW header_view AS SELECT * FROM header_subject;');
    } finally { fixture.close(); }
  }
  const baseline = local ? await readFile(filePath) : undefined;
  const profile: NetworkConnectionProfile | PostgresConnectionProfile | undefined = local ? undefined : {
    id: '', dialect: dialect as (NetworkConnectionProfile | PostgresConnectionProfile)['dialect'], name: dialect!, group: '', color: '#123456',
    host: '127.0.0.1', port, database, user: database, password, rememberPassword: false,
  };
  const sql = 'SELECT id AS duplicate, label AS duplicate, amount AS third, nullable AS hidden FROM header_subject WHERE 1 = 0';
  try {
    if (local) await desktop.evaluate(({ dialog, BrowserWindow }, filePath) => {
      const open = dialog.showOpenDialog;
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        dialog.showOpenDialog = open;
        if (args[0] !== BrowserWindow.getAllWindows()[0] || !(args.at(-1) as Electron.OpenDialogOptions).filters?.[0]?.extensions.includes('sqlite'))
          throw Error('越过本例文件选择范围');
        return { canceled: false, filePaths: [filePath] };
      }) as typeof open;
    }, filePath);
    await page.evaluate(async ({ profile, table, sql, database }) => {
      const id = 'header-sqlite';
      const picked = profile ? undefined : await window.dbark.invoke('files.choose', { purpose: 'sqlite-database', sqliteConnectionId: id });
      if (!profile && !picked) throw Error('本例 SQLite 文件未授权');
      const connection = await window.dbark.invoke('connections.save', profile ?? { id, dialect: 'sqlite', name: 'SQLite', group: '', color: '#123456',
        sqlite: { fileToken: picked!.token, readOnly: false, busyTimeoutMs: 1000 } });
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'header-table', tabs: [
        { id: 'header-table', kind: 'table', title: table, connectionId: connection.id, database,
          table: profile?.dialect === 'postgresql' ? '"public"."' + table + '"' : table },
        ...(profile ? [] : [{ id: 'header-view', kind: 'table' as const, title: 'header_view', connectionId: connection.id, database, table: 'header_view' }]),
        { id: 'header-query', kind: 'query', title: '查询结果列名', connectionId: connection.id, database, sql },
      ] });
    }, { profile, table, sql, database });
    await page.reload();
    await page.evaluate(() => {
      const packets: { text: string; formats: string[] }[] = [];
      // 只收集当前渲染器发出的真实 copy 事件，隔离系统剪贴板。
      Object.defineProperty(document, 'execCommand', { configurable: true, value(command: string) {
        if (command !== 'copy') throw Error('仅允许本例复制动作');
        const data = new DataTransfer();
        document.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }));
        packets.push({ text: data.getData('text/plain'), formats: [...data.types] });
        return true;
      } });
      Object.assign(globalThis, { columnNamesPackets: packets });
    });
    const packets = () => page.evaluate(() => (globalThis as typeof globalThis & {
      columnNamesPackets: { text: string; formats: string[] }[];
    }).columnNamesPackets);
    const copy = async (scope: ReturnType<typeof page.locator>, count: number) => {
      await (await navigationMenuItem(scope, { name: text.names, exact: true })).click();
      const data = await packets();
      expect(data).toHaveLength(count);
      expect(data.at(-1)?.formats).toEqual(['text/plain']);
      return data.at(-1)!.text;
    };
    const open = (id: string) => page.locator('[data-workspace-tab-id="' + id + '"] .tab-select').click();
    const tableTab = page.locator('.table-tab:visible, .postgres-table-tab:visible');
    const header = tableTab.getByRole('columnheader').filter({ hasText: /^amount/i });
    const tableNames = 'id\tamount\tlabel\tpayload\tnullable';
    await expect(header).toBeVisible();
    expect(await copy(tableTab, 1)).toBe(tableNames);
    let count = 1;
    if (local) {
      await open('header-view');
      await expect(header).toBeVisible();
      expect(await copy(tableTab, ++count)).toBe(tableNames);
    }
    await open('header-query');
    const query = page.locator('.query-tab:visible');
    await expect(query.locator('.monaco-editor').getByRole('textbox')).toBeVisible();
    if (dialect === 'postgresql') await query.getByRole('button', { name: postgresZh.execute, exact: true }).click();
    else await query.locator('.query-execute-split button.primary').click();
    const grid = query.locator('.query-result-grid').getByRole('grid');
    const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
    await expect(grid.getByRole('columnheader').filter({ hasText: /^duplicate/i })).toHaveCount(2);
    await expect(grid.getByRole('gridcell')).toHaveCount(0);
    await expect.poll(async () => (await history()).map(entry => entry.success)).toEqual([true]);
    const historyBefore = await history();
    expect(await copy(query, ++count)).toBe('duplicate\tduplicate\tthird\thidden');
    await (await navigationMenuItem(query, { name: columnsText.open, exact: true })).click();
    const layout = page.getByRole('dialog', { name: columnsText.title, exact: true });
    await layout.getByRole('checkbox', { name: columnsText.visible(4), exact: true }).uncheck();
    for (let index = 0; index < 2; index++)
      await layout.getByRole('button', { name: columnsText.up(3), exact: true }).click();
    await layout.getByRole('button', { name: columnsText.apply, exact: true }).click();
    await expect(layout).toBeHidden();
    expect(await copy(query, ++count)).toBe('third\tduplicate\tduplicate');
    await page.screenshot({ path: info.outputPath('仅复制列名.png') });
    expect(await history()).toEqual(historyBefore);
    if (baseline) expect(await readFile(filePath)).toEqual(baseline);
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  }
});
