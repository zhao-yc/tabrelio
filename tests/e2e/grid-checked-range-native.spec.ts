import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { answerDialogs, confirmOwnedDesktopExit, dataDir, desktop, expect, page, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { readGridRangeClipboard } from './grid-cell-range-clipboard';
import { navigationMenuItem } from './navigation-menu';
import type { NetworkConnectionProfile, PostgresConnectionProfile } from '../../src/shared/contracts';
import { parseTabularText } from '../../src/renderer/gridClipboard';
import { draftHistoryZh } from '../../src/renderer/locales/draftHistory.zh-CN';
import { gridRowSelectionZh } from '../../src/renderer/locales/gridRowSelection.zh-CN';
import { postgresTableZh } from '../../src/renderer/locales/postgresTable.zh-CN';
import { sqliteTableBrowseZh } from '../../src/renderer/locales/sqliteTableBrowse.zh-CN';
import { sqliteTableEditZh } from '../../src/renderer/locales/sqliteTableEdit.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });

test('网格连续勾选跨视口，翻页和清空撤销旧起点', async ({}, info) => {
  const dialect = process.env.DBARK_GRID_CHECKED_RANGE_DIALECT;
  test.skip(!dialect, '需要显式启用隔离网格范围勾选专项');
  const local = dialect === 'sqlite', pg = dialect === 'postgresql';
  const database = local ? 'main' : process.env.DBARK_GRID_CHECKED_RANGE_DATABASE ?? '';
  const port = Number(process.env.DBARK_GRID_CHECKED_RANGE_PORT), password = process.env.DBARK_GRID_CHECKED_RANGE_PASSWORD ?? '';
  if (process.env.DBARK_DEV_URL || process.env.DBARK_EXECUTABLE_PATH ||
      (local ? process.env.DBARK_INTEGRATION_ENABLED !== '0' : process.env.DBARK_INTEGRATION_ENABLED !== '1' ||
        !['postgresql', 'mysql', 'mariadb'].includes(dialect!) || !/^tabrelio_cr_[a-f0-9]{12}$/.test(database) ||
        !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535))
    throw Error('只允许本例独占 SQLite 文件或回环实库');
  const file = join(dataDir, 'grid-checked-range.sqlite');
  if (local) {
    const fixture = new DatabaseSync(file);
    try {
      fixture.exec(`CREATE TABLE checked_subject(id INTEGER PRIMARY KEY, marker TEXT);
        WITH RECURSIVE sequence(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM sequence WHERE i<150)
        INSERT INTO checked_subject SELECT i,'marker-'||i FROM sequence`);
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
      const id = 'sqlite-grid-checked-range';
      const picked = profile ? undefined : await window.dbark.invoke('files.choose', { purpose: 'sqlite-database', sqliteConnectionId: id });
      if (!profile && !picked) throw Error('本例 SQLite 文件未授权');
      const connection = await window.dbark.invoke('connections.save', profile ?? { id, dialect: 'sqlite', name: 'SQLite',
        group: '', color: '#123456', sqlite: { fileToken: picked!.token, readOnly: false, busyTimeoutMs: 1000 } });
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, pageSize: 100, activeTabId: 'checked-table', tabs: [
        { id: 'checked-table', kind: 'table', title: 'checked_subject', connectionId: connection.id,
          database, table: profile?.dialect === 'postgresql' ? '"public"."checked_subject"' : 'checked_subject' },
        ...(!profile ? [{ id: 'checked-query', kind: 'query' as const, title: '范围勾选查询', connectionId: connection.id,
          database, sql: 'SELECT id, marker FROM checked_subject WHERE id <= 10 ORDER BY id DESC' }] : []),
      ] });
    }, { profile, database });
    await page.reload();
    const tab = page.locator('.table-tab:visible, .postgres-table-tab:visible');
    const grid = tab.getByRole('grid');
    const cell = (id: number) => grid.getByRole('gridcell', { name: local ? `INTEGER · ${id}` : String(id), exact: true });
    const checkbox = (id: number) => cell(id).locator('..').getByRole('checkbox');
    const first = cell(1);
    await expect(first).toBeVisible();
    const primary = process.platform === 'darwin' ? 'Meta' : 'Control';
    await first.click({ modifiers: [primary] });
    await expect(checkbox(1)).toBeChecked();
    await cell(3).click({ modifiers: [primary] });
    await expect(checkbox(3)).toBeChecked();
    await expect(checkbox(2)).not.toBeChecked();
    await first.click({ modifiers: [primary] });
    await expect(checkbox(1)).not.toBeChecked();
    await expect(checkbox(3)).toBeChecked();
    const clickAction = async (name: string) => (await navigationMenuItem(tab, { name, exact: true })).click();
    await clickAction(gridRowSelectionZh.clear);

    await checkbox(1).click();
    await expect(checkbox(100)).toHaveCount(0);
    await grid.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await checkbox(100).click({ modifiers: ['Shift'] });
    async function copiedIds(id: number) {
      await cell(id).click();
      return parseTabularText((await readGridRangeClipboard(page)).text).map(row => Number(row[0]));
    }
    expect(await copiedIds(100)).toEqual(Array.from({ length: 100 }, (_, index) => index + 1));
    await page.screenshot({ path: info.outputPath('跨视口连续勾选.png') });
    await checkbox(95).click({ modifiers: ['Shift'] });
    expect(await copiedIds(100)).toEqual([96, 97, 98, 99, 100]);
    await clickAction(gridRowSelectionZh.clear);
    await checkbox(100).click({ modifiers: ['Shift'] });
    expect(await copiedIds(100)).toEqual([100]);
    await clickAction(gridRowSelectionZh.clear);

    await grid.evaluate(element => { element.scrollTop = 0; });
    await cell(2).click();
    const remove = () => page.keyboard.press(process.platform === 'darwin' ? 'Meta+Backspace' : 'Control+Delete');
    if (local) {
      await answerDialogs([0]);
      const [prompt] = await Promise.all([page.waitForEvent('dialog'), remove()]);
      expect(prompt.message()).toBe(sqliteTableEditZh.confirmDelete);
    } else await remove();
    await expect(checkbox(2)).toBeDisabled();
    await checkbox(1).click();
    await checkbox(3).click({ modifiers: ['Shift'] });
    await expect(checkbox(2)).not.toBeChecked();
    expect(await copiedIds(3)).toEqual([1, 3]);
    await clickAction(local ? sqliteTableEditZh.undo : draftHistoryZh.undo);
    await checkbox(2).click();
    await clickAction(local ? sqliteTableBrowseZh.next : pg ? postgresTableZh.next : zh.common.pageNext);
    await expect(cell(101)).toBeVisible();
    await checkbox(105).click({ modifiers: ['Shift'] });
    expect(await copiedIds(105)).toEqual([105]);

    if (local) {
      await page.locator('[data-workspace-tab-id="checked-query"]').getByRole('button', { name: '范围勾选查询', exact: true }).click();
      const query = page.locator('.query-tab:visible');
      await query.locator('.query-execute-split > button.primary').click();
      const result = query.getByRole('grid');
      const resultCell = (id: number) => result.getByRole('gridcell', { name: String(id), exact: true });
      const resultCheckbox = (id: number) => resultCell(id).locator('..').getByRole('checkbox');
      await resultCheckbox(9).click();
      await resultCheckbox(6).click({ modifiers: ['Shift'] });
      await resultCell(6).click();
      expect(parseTabularText((await readGridRangeClipboard(page)).text).map(row => Number(row[0]))).toEqual([9, 8, 7, 6]);

      await result.getByRole('columnheader', { name: /^id/ }).click();
      await expect(result.locator('[role="row"][aria-rowindex="2"]').getByRole('gridcell', { name: '1', exact: true })).toBeVisible();
      await resultCheckbox(8).click({ modifiers: ['Shift'] });
      await expect(resultCheckbox(3)).not.toBeChecked();
      await expect(resultCheckbox(8)).toBeChecked();
      await resultCell(8).click({ modifiers: [primary] });
      await expect(resultCheckbox(8)).not.toBeChecked();
      await page.screenshot({ path: info.outputPath('查询结果重排后勾选.png') });
    }

    if (baseline) expect(await readFile(file)).toEqual(baseline);
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  }
});
