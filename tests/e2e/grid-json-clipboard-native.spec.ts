import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { confirmOwnedDesktopExit, dataDir, desktop, expect, page, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';
import { gridJsonClipboardZh as text } from '../../src/renderer/locales/gridJsonClipboard.zh-CN';
import { postgresZh } from '../../src/renderer/locales/postgres.zh-CN';
import type { NetworkConnectionProfile, PostgresConnectionProfile } from '../../src/shared/contracts';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });

test('表格和查询结果按显示顺序复制 JSON，保留精确值', async ({}, info) => {
  const dialect = process.env.DBARK_GRID_JSON_DIALECT;
  test.skip(!dialect, '需要显式启用记录 JSON 复制专项');
  const local = dialect === 'sqlite';
  const database = local ? 'main' : process.env.DBARK_GRID_JSON_DATABASE ?? '';
  const port = Number(process.env.DBARK_GRID_JSON_PORT);
  const password = process.env.DBARK_GRID_JSON_PASSWORD ?? '';
  if (process.env.DBARK_DEV_URL || process.env.DBARK_EXECUTABLE_PATH ||
      (local ? process.env.DBARK_INTEGRATION_ENABLED !== '0' :
        process.env.DBARK_INTEGRATION_ENABLED !== '1' || !['postgresql', 'mysql', 'mariadb'].includes(dialect!) ||
        !/^tabrelio_js_[a-f0-9]{12}$/.test(database) || !/^[a-f0-9]{64}$/.test(password) ||
        !Number.isInteger(port) || port <= 1024 || port > 65535)) throw Error('仅允许本例 SQLite 文件或独占回环实库');
  const table = 'json_subject', filePath = join(await realpath(dataDir), 'grid-json.sqlite');
  if (local) {
    const fixture = new DatabaseSync(filePath);
    try {
      fixture.exec("CREATE TABLE json_subject (id INTEGER PRIMARY KEY, amount INTEGER, label TEXT, payload BLOB, nullable TEXT);" +
        "INSERT INTO json_subject VALUES (1,9007199254740993,'row A',X'00ff',NULL),(2,9007199254740994,'row B',X'','');" +
        'CREATE VIEW json_view AS SELECT * FROM json_subject;');
    } finally { fixture.close(); }
  }
  const baseline = local ? await readFile(filePath) : undefined;
  const profile: NetworkConnectionProfile | PostgresConnectionProfile | undefined = local ? undefined : {
    id: '', dialect: dialect as (NetworkConnectionProfile | PostgresConnectionProfile)['dialect'], name: dialect!, group: '', color: '#123456',
    host: '127.0.0.1', port, database, user: database, password, rememberPassword: false,
  };
  const sql = 'SELECT amount AS alias, label AS alias, payload, nullable FROM json_subject ORDER BY id DESC';
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
      const id = 'json-sqlite';
      const picked = profile ? undefined : await window.dbark.invoke('files.choose', { purpose: 'sqlite-database', sqliteConnectionId: id });
      if (!profile && !picked) throw Error('本例 SQLite 文件未授权');
      const connection = await window.dbark.invoke('connections.save', profile ?? { id, dialect: 'sqlite', name: 'SQLite', group: '', color: '#123456',
        sqlite: { fileToken: picked!.token, readOnly: false, busyTimeoutMs: 1000 } });
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'json-table', tabs: [
        { id: 'json-table', kind: 'table', title: table, connectionId: connection.id, database,
          table: profile?.dialect === 'postgresql' ? '"public"."' + table + '"' : table },
        ...(profile ? [] : [{ id: 'json-view', kind: 'table' as const, title: 'json_view', connectionId: connection.id, database, table: 'json_view' }]),
        { id: 'json-query', kind: 'query', title: '查询结果 JSON', connectionId: connection.id, database, sql },
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
      Object.assign(globalThis, { gridJsonPackets: packets });
    });
    const packets = () => page.evaluate(() => (globalThis as typeof globalThis & {
      gridJsonPackets: { text: string; formats: string[] }[];
    }).gridJsonPackets);
    const copy = async (scope: ReturnType<typeof page.locator>, count: number) => {
      await (await navigationMenuItem(scope, { name: text.action, exact: true })).click();
      const data = await packets();
      expect(data).toHaveLength(count);
      expect(data.at(-1)?.formats).toEqual(['text/plain']);
      return JSON.parse(data.at(-1)!.text);
    };
    const open = (id: string) => page.locator('[data-workspace-tab-id="' + id + '"] .tab-select').click();
    const tableTab = page.locator('.table-tab:visible, .postgres-table-tab:visible');
    const tableCell = tableTab.getByRole('gridcell').filter({ hasText: /^(TEXT · )?row A$/ });
    const expectedA = { amount: '9007199254740993', label: 'row A', payload: { type: 'binary', base64: 'AP8=' }, nullable: null };
    await expect(tableCell).toBeVisible();
    await tableCell.click();
    expect(await copy(tableTab, 1)).toMatchObject([expectedA]);
    let count = 1;
    if (local) {
      await open('json-view');
      await expect(tableCell).toBeVisible();
      await tableCell.click();
      expect(await copy(tableTab, ++count)).toMatchObject([expectedA]);
    }
    await open('json-query');
    const query = page.locator('.query-tab:visible');
    await expect(query.locator('.monaco-editor').getByRole('textbox')).toBeVisible();
    if (dialect === 'postgresql') await query.getByRole('button', { name: postgresZh.execute, exact: true }).click();
    else await query.locator('.query-execute-split button.primary').click();
    const grid = query.locator('.query-result-grid').getByRole('grid');
    const rowA = grid.getByRole('gridcell', { name: 'row A', exact: true });
    const rowB = grid.getByRole('gridcell', { name: 'row B', exact: true });
    const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
    await expect(rowA).toBeVisible();
    await expect.poll(async () => (await history()).map(entry => entry.success)).toEqual([true]);
    const historyBefore = await history();
    await rowA.locator('..').getByRole('checkbox').check();
    await rowB.locator('..').getByRole('checkbox').check();
    await page.screenshot({ path: info.outputPath('复制记录为JSON.png') });
    expect(await copy(query, ++count)).toEqual([
      { alias: '9007199254740994', 'alias [2]': 'row B', payload: { type: 'binary', base64: '' }, nullable: '' },
      { alias: '9007199254740993', 'alias [2]': 'row A', payload: { type: 'binary', base64: 'AP8=' }, nullable: null },
    ]);
    expect(await history()).toEqual(historyBefore);
    if (baseline) expect(await readFile(filePath)).toEqual(baseline);
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  }
});
