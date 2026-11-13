import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Locator } from '@playwright/test';
import type { NetworkConnectionProfile, PostgresConnectionProfile } from '../../src/shared/contracts';
import { binaryCellZh } from '../../src/renderer/locales/binaryCell.zh-CN';
import { gridCellValueZh as text } from '../../src/renderer/locales/gridCellValue.zh-CN';
import { historyPagesZh } from '../../src/renderer/locales/historyPages.zh-CN';
import { postgresZh } from '../../src/renderer/locales/postgres.zh-CN';
import { confirmOwnedDesktopExit, dataDir, desktop, expect, page, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { readGridMenuClipboard } from './grid-cell-range-clipboard';

const recordId = '9007199254740993';
const firstPart = 'A'.repeat(65535);
const lastPart = '\r\n🧪末段匹配';
const original = firstPart + lastPart;

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });

test('从表页和查询结果查看完整单元格，保留分段边界与原值', async ({}, info) => {
  const dialect = process.env.DBARK_GRID_CELL_VALUE_DIALECT;
  test.skip(!dialect, '需要显式启用隔离网格完整值专项');
  const local = dialect === 'sqlite', pg = dialect === 'postgresql';
  const database = local ? 'main' : process.env.DBARK_GRID_CELL_VALUE_DATABASE ?? '';
  const port = Number(process.env.DBARK_GRID_CELL_VALUE_PORT), password = process.env.DBARK_GRID_CELL_VALUE_PASSWORD ?? '';
  if (process.env.DBARK_DEV_URL || process.env.DBARK_EXECUTABLE_PATH ||
      (local ? process.env.DBARK_INTEGRATION_ENABLED !== '0' : process.env.DBARK_INTEGRATION_ENABLED !== '1' ||
        !['postgresql', 'mysql', 'mariadb'].includes(dialect!) || !/^tabrelio_cv_[a-f0-9]{12}$/.test(database) ||
        !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535))
    throw Error('只允许本例独占 SQLite 文件或回环实库');
  const file = join(dataDir, 'grid-cell-value.sqlite');
  if (local) {
    const fixture = new DatabaseSync(file);
    try {
      fixture.exec('CREATE TABLE value_subject(id INTEGER PRIMARY KEY, body TEXT, payload BLOB, empty_text TEXT, null_text TEXT)');
      fixture.prepare('INSERT INTO value_subject VALUES (?, ?, ?, ?, ?)').run(BigInt(recordId), original, Buffer.from([0, 255, 60, 62]), '', null);
    } finally { fixture.close(); }
  }
  const baseline = local ? await readFile(file) : undefined;
  const profile: NetworkConnectionProfile | PostgresConnectionProfile | undefined = local ? undefined : {
    id: '', dialect: dialect as NetworkConnectionProfile['dialect'] | PostgresConnectionProfile['dialect'],
    name: dialect!, group: '', color: '#123456', host: '127.0.0.1', port, database, user: database, password, rememberPassword: false,
  };
  try {
    if (local) await desktop.evaluate(({ dialog, BrowserWindow }, file) => {
      const original = dialog.showOpenDialog;
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        dialog.showOpenDialog = original;
        if (args[0] !== BrowserWindow.getAllWindows()[0] || !(args.at(-1) as Electron.OpenDialogOptions).filters?.[0]?.extensions.includes('sqlite'))
          throw Error('越过本例文件选择范围');
        return { canceled: false, filePaths: [file] };
      }) as typeof original;
    }, file);
    await page.evaluate(async ({ profile, database }) => {
      const id = 'sqlite-grid-cell-value';
      const picked = profile ? undefined : await window.dbark.invoke('files.choose', { purpose: 'sqlite-database', sqliteConnectionId: id });
      if (!profile && !picked) throw Error('本例 SQLite 文件未授权');
      const connection = await window.dbark.invoke('connections.save', profile ?? { id, dialect: 'sqlite', name: 'SQLite',
        group: '', color: '#123456', sqlite: { fileToken: picked!.token, readOnly: false, busyTimeoutMs: 1000 } });
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, pageSize: 100, activeTabId: 'value-table', tabs: [
        { id: 'value-table', kind: 'table', title: 'value_subject', connectionId: connection.id,
          database, table: profile?.dialect === 'postgresql' ? '"public"."value_subject"' : 'value_subject' },
        { id: 'value-query', kind: 'query', title: '完整值查询', connectionId: connection.id, database,
          sql: 'SELECT id AS repeated, body AS repeated, payload, empty_text, null_text FROM value_subject ORDER BY id' },
      ] });
    }, { profile, database });
    await page.reload();
    const tab = page.locator('.table-tab:visible, .postgres-table-tab:visible');
    const row = (grid: Locator) => grid.locator('[role="row"][aria-rowindex="2"]');
    const panel = (column: string) => page.getByRole('region', { name: text.title(column), exact: true });
    async function openFromMenu(target: Locator) {
      await target.click({ button: 'right' });
      await page.getByRole('menuitem', { name: text.open, exact: true }).click();
    }

    const id = tab.getByRole('gridcell', { name: local ? `INTEGER · ${recordId}` : recordId, exact: true });
    await openFromMenu(id);
    await expect(panel('id').locator('pre')).toHaveText(recordId);
    await panel('id').getByRole('button', { name: text.close }).click();
    await expect(id).toBeFocused();

    const showTab = (id: string, title: string) =>
      page.locator('[data-workspace-tab-id="' + id + '"]').getByRole('button', { name: title, exact: true }).click();
    await showTab('value-query', '完整值查询');
    const query = page.locator('.query-tab:visible, .postgres-query-tab:visible');
    await (pg ? query.getByRole('button', { name: postgresZh.execute, exact: true }) : query.locator('.query-execute-split > button.primary')).click();
    const grid = query.getByRole('grid');
    // 重复列名必须按物理列定位，两个原值的类型和内容均不同。
    const values = row(grid).locator('[role="gridcell"]:not([aria-colindex="1"])');
    const body = values.nth(1);
    await body.click();
    await page.keyboard.press('Alt+Enter');
    const preview = panel('repeated');
    const pre = preview.locator('pre');
    await expect(pre).toBeVisible();
    const first = await pre.textContent() ?? '';
    expect({ length: first.length, start: first.slice(0, 20), end: first.slice(-20) })
      .toEqual({ length: firstPart.length, start: firstPart.slice(0, 20), end: firstPart.slice(-20) });
    expect(first === firstPart).toBe(true);
    await preview.getByRole('textbox', { name: historyPagesZh.sqlFindTitle }).fill('末段匹配');
    await preview.getByRole('button', { name: historyPagesZh.sqlFindNext }).click();
    await expect(pre.locator('mark')).toHaveText('末段匹配');
    expect((await pre.textContent()) === lastPart).toBe(true);
    const copied = await readGridMenuClipboard(page, preview.getByRole('button', { name: text.copy }));
    expect(copied.text === original).toBe(true);
    expect([copied.typed, copied.sqlite]).toEqual(['', '']);
    await page.screenshot({ path: info.outputPath('单元格长文本分段查找.png') });
    await page.keyboard.press('Escape');
    await expect(preview).toHaveCount(0);
    await expect(body).toBeFocused();

    await openFromMenu(values.nth(0));
    await expect(pre).toHaveText(recordId);
    await openFromMenu(values.nth(2));
    const hex = panel('payload').getByRole('textbox', { name: binaryCellZh.hexLabel });
    await expect(hex).toHaveValue('00 ff 3c 3e');
    await expect(hex).not.toBeEditable();
    await openFromMenu(values.nth(3));
    await expect(panel('empty_text').getByRole('status')).toHaveText(text.emptyValue);
    await openFromMenu(values.nth(4));
    await expect(panel('null_text').getByRole('status')).toHaveText(text.nullValue);
    await showTab('value-table', 'value_subject');
    await showTab('value-query', '完整值查询');
    await expect(panel('null_text')).toHaveCount(0);

    if (baseline) expect(await readFile(file)).toEqual(baseline);
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  }
});
