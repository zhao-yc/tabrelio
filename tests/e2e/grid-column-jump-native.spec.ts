import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { confirmOwnedDesktopExit, dataDir, desktop, expect, page, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';
import { gridColumnJumpZh as text } from '../../src/renderer/locales/gridColumnJump.zh-CN';
import { queryResultColumnsZh as layoutText } from '../../src/renderer/locales/queryResultColumns.zh-CN';
import { postgresZh } from '../../src/renderer/locales/postgres.zh-CN';
import type { NetworkConnectionProfile, PostgresConnectionProfile } from '../../src/shared/contracts';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });

test('宽表按列名或序号定位未渲染的单元格与空结果表头', async ({}, info) => {
  const dialect = process.env.DBARK_COLUMN_JUMP_DIALECT;
  test.skip(!dialect, '需要显式启用列定位专项');
  const local = dialect === 'sqlite';
  const database = local ? 'main' : process.env.DBARK_COLUMN_JUMP_DATABASE ?? '';
  const port = Number(process.env.DBARK_COLUMN_JUMP_PORT);
  const password = process.env.DBARK_COLUMN_JUMP_PASSWORD ?? '';
  if (process.env.DBARK_DEV_URL || process.env.DBARK_EXECUTABLE_PATH ||
      (local ? process.env.DBARK_INTEGRATION_ENABLED !== '0' :
        process.env.DBARK_INTEGRATION_ENABLED !== '1' || !['postgresql', 'mysql', 'mariadb'].includes(dialect!) ||
        !/^tabrelio_cj_[a-f0-9]{12}$/.test(database) || !/^[a-f0-9]{64}$/.test(password) ||
        !Number.isInteger(port) || port <= 1024 || port > 65535)) throw Error('仅允许本例 SQLite 文件或独占回环实库');
  const table = 'jump_subject', filePath = join(await realpath(dataDir), 'column-jump.sqlite');
  if (local) {
    const fixture = new DatabaseSync(filePath);
    try {
      const wide = Array.from({ length: 20 }, (_, index) => 'col_' + (index + 1) + ' TEXT').join(',');
      fixture.exec('CREATE TABLE jump_subject (id INTEGER PRIMARY KEY, label TEXT,' + wide +
        ', tail_one TEXT, tail_two TEXT); INSERT INTO jump_subject(id,label,tail_one,tail_two) VALUES' +
        " (1,'row A','tail-one-A','tail-two-A'),(2,'row B','tail-one-B','tail-two-B');" +
        'CREATE VIEW jump_view AS SELECT * FROM jump_subject;');
    } finally { fixture.close(); }
  }
  const baseline = local ? await readFile(filePath) : undefined;
  const profile: NetworkConnectionProfile | PostgresConnectionProfile | undefined = local ? undefined : {
    id: '', dialect: dialect as (NetworkConnectionProfile | PostgresConnectionProfile)['dialect'], name: dialect!, group: '', color: '#123456',
    host: '127.0.0.1', port, database, user: database, password, rememberPassword: false,
  };
  const fields = ['id', 'label', ...Array.from({ length: 20 }, (_, index) => 'col_' + (index + 1)),
    'tail_one AS repeated', 'tail_two AS repeated'].join(', ');
  const sql = 'SELECT ' + fields + ' FROM jump_subject ORDER BY id';
  const empty = 'SELECT ' + fields + ' FROM jump_subject WHERE 1 = 0';
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
    await page.evaluate(async ({ profile, table, sql, empty, database }) => {
      const id = 'jump-sqlite';
      const picked = profile ? undefined : await window.dbark.invoke('files.choose', { purpose: 'sqlite-database', sqliteConnectionId: id });
      if (!profile && !picked) throw Error('本例 SQLite 文件未授权');
      const connection = await window.dbark.invoke('connections.save', profile ?? { id, dialect: 'sqlite', name: 'SQLite', group: '', color: '#123456',
        sqlite: { fileToken: picked!.token, readOnly: false, busyTimeoutMs: 1000 } });
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'jump-table', tabs: [
        { id: 'jump-table', kind: 'table', title: table, connectionId: connection.id, database,
          table: profile?.dialect === 'postgresql' ? '"public"."' + table + '"' : table },
        ...(profile ? [] : [{ id: 'jump-view', kind: 'table' as const, title: 'jump_view', connectionId: connection.id, database, table: 'jump_view' }]),
        { id: 'jump-query', kind: 'query', title: '宽查询结果', connectionId: connection.id, database, sql },
        { id: 'jump-empty', kind: 'query', title: '空结果定位', connectionId: connection.id, database, sql: empty },
      ] });
    }, { profile, table, sql, empty, database });
    await page.reload();
    const open = (id: string) => page.locator('[data-workspace-tab-id="' + id + '"] .tab-select').click();
    const tableTab = page.locator('.table-tab:visible, .postgres-table-tab:visible');
    const query = page.locator('.query-tab:visible');
    const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
    const choose = async (scope: typeof query, search: string) => {
      const button = scope.getByRole('button', { name: text.open, exact: true });
      await button.click();
      const input = scope.getByRole('textbox', { name: text.search, exact: true });
      await expect(input).toBeFocused();
      await input.fill(search);
      return input;
    };
    for (const tab of local ? ['jump-table', 'jump-view'] : ['jump-table']) {
      if (tab === 'jump-view') await open(tab);
      const label = tableTab.getByRole('gridcell').filter({ hasText: /^(TEXT · )?row B$/ });
      await expect(label).toBeVisible();
      const row = label.locator('..');
      const selected = row.getByRole('checkbox');
      await selected.check();
      await label.click();
      const target = tableTab.getByRole('gridcell').filter({ hasText: /^(TEXT · )?tail-two-B$/ });
      await expect(target).toHaveCount(0);
      const input = await choose(tableTab, 'TAIL_TWO');
      await input.press('Enter');
      await expect(target).toBeFocused();
      await expect(target.locator('..').getByRole('checkbox')).toBeChecked();
      // 同坐标再次定位也应把焦点从搜索框送回原格。
      await (await choose(tableTab, '#24')).press('Enter');
      await expect(target).toBeFocused();
    }
    await open('jump-query');
    const execute = async () => {
      await expect(query.locator('.monaco-editor').getByRole('textbox')).toBeVisible();
      if (dialect === 'postgresql') await query.getByRole('button', { name: postgresZh.execute, exact: true }).click();
      else await query.locator('.query-execute-split button.primary').click();
    };
    await execute();
    const rowB = query.getByRole('gridcell', { name: 'row B', exact: true });
    await rowB.click();
    await expect.poll(async () => (await history()).map(entry => entry.success)).toEqual([true]);
    const before = await history();
    const input = await choose(query, 'repeated');
    const go = query.getByRole('button', { name: text.go, exact: true });
    await expect(go).toBeDisabled();
    const matches = query.getByRole('combobox', { name: text.matches, exact: true });
    await expect(matches.getByRole('option')).toHaveText([text.choose, text.option(23, 'repeated'), text.option(24, 'repeated')]);
    await matches.selectOption({ label: text.option(24, 'repeated') });
    await go.click();
    await expect(input).toHaveCount(0);
    await expect(query.getByRole('gridcell', { name: 'tail-two-B', exact: true })).toBeFocused();
    await page.screenshot({ path: info.outputPath('跳到可见列.png') });
    await (await navigationMenuItem(query, { name: layoutText.open, exact: true })).click();
    const layout = page.getByRole('dialog', { name: layoutText.title, exact: true });
    await layout.getByRole('checkbox', { name: layoutText.visible(22), exact: true }).uncheck();
    await layout.getByRole('button', { name: layoutText.apply, exact: true }).click();
    await expect(layout).toBeHidden();
    const noMatch = await choose(query, 'col_20');
    await expect(matches).toBeDisabled();
    await expect(go).toBeDisabled();
    await noMatch.press('Escape');
    await expect(query.getByRole('button', { name: text.open, exact: true })).toBeFocused();
    expect(await history()).toEqual(before);

    await open('jump-empty');
    await execute();
    await expect.poll(async () => (await history()).map(entry => entry.success)).toEqual([true, true]);
    await (await choose(query, '#24')).press('Enter');
    await expect(query.getByRole('columnheader').filter({ hasText: /^repeated/i }).last()).toBeFocused();
    await expect(query.getByRole('gridcell')).toHaveCount(0);
    if (baseline) expect(await readFile(filePath)).toEqual(baseline);
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  }
});
