import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { confirmOwnedDesktopExit, dataDir, desktop, expect, page, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';
import type { NetworkConnectionProfile, PostgresConnectionProfile } from '../../src/shared/contracts';
import { gridHeaderDetailsZh as text } from '../../src/renderer/locales/gridHeaderDetails.zh-CN';
import { sqliteTableBrowseZh as sqlite } from '../../src/renderer/locales/sqliteTableBrowse.zh-CN';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });

const taskIds = () => page.evaluate(async () => (await window.dbark.invoke('tasks.list', {})).map(task => task.id).sort());

test('SQLite 表和只读视图的声明类型可切换，排序仍使用原字段', async ({}, info) => {
  test.skip(process.env.DBARK_GRID_HEADER_SQLITE !== '1', '需要显式启用 SQLite 表头专项');
  if (process.env.DBARK_DEV_URL || process.env.DBARK_EXECUTABLE_PATH || process.env.DBARK_INTEGRATION_ENABLED !== '0')
    throw Error('仅允许源码应用和本例专用临时文件');
  const file = join(await realpath(dataDir), 'grid-header.sqlite');
  const fixture = new DatabaseSync(file);
  try {
    fixture.exec("CREATE TABLE subject (id INTEGER PRIMARY KEY, label VARCHAR(17), dynamic_value); INSERT INTO subject VALUES(1,'row A',2),(2,'row B','x'); CREATE VIEW subject_view AS SELECT * FROM subject;");
  } finally { fixture.close(); }
  const baseline = await readFile(file);
  try {
    await desktop.evaluate(({ dialog, BrowserWindow }, file) => {
      const original = dialog.showOpenDialog;
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        dialog.showOpenDialog = original;
        if (args[0] !== BrowserWindow.getAllWindows()[0] || !(args.at(-1) as Electron.OpenDialogOptions).filters?.[0]?.extensions.includes('sqlite'))
          throw Error('越过本例文件选择范围');
        return { canceled: false, filePaths: [file] };
      }) as typeof original;
    }, file);
    await page.evaluate(async () => {
      const id = 'grid-header-sqlite';
      const picked = await window.dbark.invoke('files.choose', { purpose: 'sqlite-database', sqliteConnectionId: id });
      if (!picked) throw Error('本例 SQLite 文件未授权');
      const connection = await window.dbark.invoke('connections.save', { id, dialect: 'sqlite', name: 'SQLite',
        group: '', color: '#123456', sqlite: { fileToken: picked.token, readOnly: false, busyTimeoutMs: 1000 } });
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'subject', tabs: ['subject', 'subject_view'].map(table =>
        ({ id: table, kind: 'table' as const, title: table, table, connectionId: connection.id, database: 'main' })) });
    });
    await page.reload();
    const tab = page.locator('.sqlite-table-tab:visible');
    const header = (name: string) => tab.getByRole('columnheader').filter({ has: page.locator('.grid-header-detail-name').filter({ hasText: new RegExp('^' + name + '$') }) });
    const toggle = async (name: string) => (await navigationMenuItem(tab, { name, exact: true })).click();
    await expect(header('label')).toBeVisible();
    const before = await taskIds();
    await expect(header('label').locator('.column-type')).toHaveCount(0);
    await toggle(text.showType);
    await expect(header('label').locator('.column-type')).toHaveText('VARCHAR(17)');
    await expect(header('dynamic_value').locator('.column-type')).toHaveText(sqlite.dynamic);
    expect(await taskIds()).toEqual(before);
    await header('label').click();
    await expect(header('label')).toHaveAttribute('aria-sort', 'ascending');
    await expect(header('label').locator('.rdg-header-sort-name + span svg')).toBeVisible();
    await toggle(text.hideType);
    await expect(header('label').locator('.column-type')).toHaveCount(0);
    await expect(header('label')).toHaveAttribute('aria-sort', 'ascending');
    await page.locator('[data-workspace-tab-id="subject_view"] .tab-select').click();
    await expect(header('label')).toBeVisible();
    await toggle(text.showType);
    await expect(header('label').locator('.column-type')).toHaveText('VARCHAR(17)');
    await page.screenshot({ path: info.outputPath('SQLite表头类型.png') });
    expect(await readFile(file)).toEqual(baseline);
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  }
});

test('网络数据库表头独立显示声明类型及字段注释', async ({}, info) => {
  const dialect = process.env.DBARK_GRID_HEADER_DIALECT;
  test.skip(!dialect, '需要显式启用独占网络实库表头专项');
  const database = process.env.DBARK_GRID_HEADER_DATABASE ?? '';
  const port = Number(process.env.DBARK_GRID_HEADER_PORT);
  const password = process.env.DBARK_GRID_HEADER_PASSWORD ?? '';
  if (process.env.DBARK_DEV_URL || process.env.DBARK_EXECUTABLE_PATH || process.env.DBARK_INTEGRATION_ENABLED !== '1' ||
      !['postgresql', 'mysql', 'mariadb'].includes(dialect!) || !/^tabrelio_hd_[a-f0-9]{12}$/.test(database) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535)
    throw Error('仅允许本例独占回环实库');
  const profile: NetworkConnectionProfile | PostgresConnectionProfile = {
    id: '', dialect: dialect as NetworkConnectionProfile['dialect'] | PostgresConnectionProfile['dialect'],
    name: dialect!, group: '', color: '#123456', host: '127.0.0.1', port, database, user: database, password, rememberPassword: false,
  };
  try {
    await page.evaluate(async profile => {
      const connection = await window.dbark.invoke('connections.save', profile);
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'header-table', tabs: [
        { id: 'header-table', kind: 'table', title: 'update_subject', connectionId: connection.id, database: profile.database,
          table: profile.dialect === 'postgresql' ? '"public"."update_subject"' : 'update_subject' },
      ] });
    }, profile);
    await page.reload();
    const tab = page.locator('.table-tab:visible, .postgres-table-tab:visible');
    const header = tab.getByRole('columnheader').filter({ has: page.locator('.grid-header-detail-name').filter({ hasText: /^label$/ }) });
    const toggle = async (name: string) => (await navigationMenuItem(tab, { name, exact: true })).click();
    await expect(header.locator('.column-type')).toHaveText('text');
    await expect(header.locator('.grid-header-comment')).toHaveCount(0);
    const before = await taskIds();
    await toggle(text.showComment);
    const expected = dialect === 'postgresql' ? '字段说明' + '注'.repeat(156) + '…' : '字段说明';
    await expect(header.locator('.grid-header-comment')).toHaveText(expected);
    await expect(header.locator('.grid-header-details')).toHaveAttribute('title', new RegExp(expected));
    await page.screenshot({ path: info.outputPath('类型和注释.png') });
    await toggle(text.hideType);
    await expect(header.locator('.column-type')).toHaveCount(0);
    await expect(header.locator('.grid-header-comment')).toHaveText(expected);
    await toggle(text.hideComment);
    await expect(header.locator('.grid-header-comment')).toHaveCount(0);
    await expect(header).toHaveText('label');
    expect(await taskIds()).toEqual(before);
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  }
});
