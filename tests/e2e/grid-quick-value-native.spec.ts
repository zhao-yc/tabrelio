import { readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Locator } from '@playwright/test';
import { confirmOwnedDesktopExit, dataDir, desktop, expect, page, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';
import type { NetworkConnectionProfile, PostgresConnectionProfile } from '../../src/shared/contracts';
import { gridQuickValueZh as text } from '../../src/renderer/locales/gridQuickValue.zh-CN';
import { sqliteTableEditZh as sqliteText } from '../../src/renderer/locales/sqliteTableEdit.zh-CN';
import { draftHistoryZh } from '../../src/renderer/locales/draftHistory.zh-CN';
import { postgresTableZh } from '../../src/renderer/locales/postgresTable.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });

test('活动格快速赋值可撤销，UUID 经确认提交后读回', async ({}, info) => {
  const dialect = process.env.DBARK_GRID_QUICK_VALUE_DIALECT;
  test.skip(!dialect, '需要显式启用隔离单元格暂存专项');
  const local = dialect === 'sqlite', database = local ? 'main' : process.env.DBARK_GRID_QUICK_VALUE_DATABASE ?? '';
  const port = Number(process.env.DBARK_GRID_QUICK_VALUE_PORT), password = process.env.DBARK_GRID_QUICK_VALUE_PASSWORD ?? '';
  if (process.env.DBARK_DEV_URL || process.env.DBARK_EXECUTABLE_PATH ||
      (local ? process.env.DBARK_INTEGRATION_ENABLED !== '0' : process.env.DBARK_INTEGRATION_ENABLED !== '1' ||
        !['postgresql', 'mysql', 'mariadb'].includes(dialect!) || !/^tabrelio_qu_[a-f0-9]{12}$/.test(database) ||
        !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535))
    throw Error('仅允许本例独占 SQLite 文件或回环实库');
  const file = join(await realpath(dataDir), 'grid-quick-value.sqlite');
  if (local) {
    const fixture = new DatabaseSync(file);
    try {
      fixture.exec("CREATE TABLE update_subject(id INTEGER PRIMARY KEY, label TEXT, numeric_value INTEGER NOT NULL, uuid_value TEXT); INSERT INTO update_subject VALUES(1,'row A',17,NULL),(2,'row B',18,NULL);");
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
      const id = 'sqlite-grid-quick-value';
      const picked = profile ? undefined : await window.dbark.invoke('files.choose', { purpose: 'sqlite-database', sqliteConnectionId: id });
      if (!profile && !picked) throw Error('本例 SQLite 文件未授权');
      const connection = await window.dbark.invoke('connections.save', profile ?? { id, dialect: 'sqlite', name: 'SQLite',
        group: '', color: '#123456', sqlite: { fileToken: picked!.token, readOnly: false, busyTimeoutMs: 1000 } });
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'quick-value', tabs: [
        { id: 'quick-value', kind: 'table', title: 'update_subject', connectionId: connection.id, database,
          table: profile?.dialect === 'postgresql' ? '"public"."update_subject"' : 'update_subject' },
      ] });
    }, { profile, database });
    await page.reload();
    const tab = page.locator('.table-tab:visible, .postgres-table-tab:visible');
    const grid = tab.getByRole('grid');
    const label = grid.getByRole('gridcell').filter({ hasText: /^(TEXT · )?row A$/ });
    const other = grid.getByRole('gridcell').filter({ hasText: /^(TEXT · )?row B$/ });
    await expect(label).toBeVisible();
    const rowIndex = await label.locator('..').getAttribute('aria-rowindex');
    const columnIndex = await label.getAttribute('aria-colindex');
    const cell = grid.locator(`[role="row"][aria-rowindex="${rowIndex}"] > [role="gridcell"][aria-colindex="${columnIndex}"]`);
    const action = (name: string): Promise<Locator> => navigationMenuItem(tab, { name, exact: true });
    const clickAction = async (name: string) => (await action(name)).click();
    const undo = local ? sqliteText.undo : draftHistoryZh.undo;
    const jobs = () => page.evaluate(async () => (await window.dbark.invoke('tasks.list', {})).map(task => task.id).sort());
    const before = await jobs();
    await other.locator('..').getByRole('checkbox').check();
    if (local) {
      await grid.getByRole('gridcell').getByText('INTEGER · 17', { exact: true }).click();
      await expect(await action(text.null)).toBeDisabled();
      await expect(await action(text.empty)).toBeDisabled();
      await page.keyboard.press('Escape');
    }
    await cell.click();
    await clickAction(text.null);
    await expect(cell).toHaveText('NULL');
    await cell.click();
    await clickAction(text.empty);
    await expect(cell).toHaveText(local ? 'TEXT ·' : '');
    await expect(other).toBeVisible();
    await page.screenshot({ path: info.outputPath('活动格暂存空字符串.png') });

    // 重复同值应为无操作，随后一次撤销仍会还原 NULL。
    await cell.click();
    await clickAction(text.empty);
    await clickAction(undo);
    await expect(cell).toHaveText('NULL');
    await clickAction(undo);
    await expect(cell).toHaveText(local ? 'TEXT · row A' : 'row A');

    const namedCell = async (name: string) => {
      const index = await grid.getByRole('columnheader').filter({ hasText: new RegExp('^' + name) }).getAttribute('aria-colindex');
      if (!index) throw Error('验收列位置缺失');
      return grid.locator(`[role="row"][aria-rowindex="${rowIndex}"] > [role="gridcell"][aria-colindex="${index}"]`);
    };
    const restricted = await namedCell(local ? 'numeric_value' : 'scope');
    await restricted.click();
    await expect(await action(text.uuid)).toBeDisabled();
    await page.keyboard.press('Escape');
    const uuidCell = await namedCell('uuid_value');
    const uuidPattern = /[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}/;
    const generate = async () => {
      await uuidCell.click();
      await clickAction(text.uuid);
      await expect(uuidCell).toHaveText(uuidPattern);
      return (await uuidCell.textContent())!.match(uuidPattern)![0];
    };
    const first = await generate();
    await clickAction(undo);
    await expect(uuidCell).toHaveText('NULL');
    const second = await generate();
    expect(second).not.toBe(first);
    await expect(other).toBeVisible();
    expect(await jobs()).toEqual(before);
    if (baseline) expect(await readFile(file)).toEqual(baseline);
    await page.screenshot({ path: info.outputPath('活动格 UUID 草稿.png') });

    // 只允许向上面的专用 SQLite 文件或独占回环库执行真实确认提交。
    const pg = dialect === 'postgresql';
    await clickAction(local ? sqliteText.preview : pg ? postgresTableZh.preview : zh.table.text019);
    const review = page.getByRole('dialog', { name: local ? sqliteText.previewTitle : pg ? postgresTableZh.preview : zh.table.text031, exact: true });
    await expect(review).toBeVisible();
    if (local) await review.getByRole('checkbox', { name: sqliteText.confirmation, exact: true }).check();
    await review.getByRole('button', { name: local ? sqliteText.submit : pg ? postgresTableZh.apply : zh.common.confirmApply, exact: true }).click();
    await expect(review).toBeHidden();
    await expect(uuidCell).toHaveText(uuidPattern);
    expect((await uuidCell.textContent())!.match(uuidPattern)![0]).toBe(second);
    if (local) {
      const check = new DatabaseSync(file, { readOnly: true });
      try {
        const result = check.prepare('SELECT id,label,uuid_value,typeof(uuid_value) AS storage FROM update_subject ORDER BY id').all();
        expect(result.map(row => [row.id, row.label, row.uuid_value, row.storage])).toEqual([
          [1, 'row A', second, 'text'], [2, 'row B', null, 'null'],
        ]);
      } finally { check.close(); }
    } else await writeFile(info.outputPath('已提交UUID.txt'), second);
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  }
});
