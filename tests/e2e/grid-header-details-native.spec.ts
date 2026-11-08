import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Locator } from '@playwright/test';
import { answerDialogs, confirmOwnedDesktopExit, dataDir, desktop, expect, page, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';
import type { NetworkConnectionProfile, PostgresConnectionProfile } from '../../src/shared/contracts';
import { gridHeaderDetailsZh as text } from '../../src/renderer/locales/gridHeaderDetails.zh-CN';
import { sqliteTableBrowseZh as sqlite } from '../../src/renderer/locales/sqliteTableBrowse.zh-CN';
import { postgresTableZh as postgres } from '../../src/renderer/locales/postgresTable.zh-CN';
import { tableSortZh as sort } from '../../src/renderer/locales/tableSort.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import { sqliteTableEditZh as sqliteEdit } from '../../src/renderer/locales/sqliteTableEdit.zh-CN';
import { sqliteEditWorkspaceZh as sqliteWorkspace } from '../../src/renderer/locales/sqliteEditWorkspace.zh-CN';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });

const taskIds = () => page.evaluate(async () => (await window.dbark.invoke('tasks.list', {})).map(task => task.id).sort());
const applyKey = process.platform === 'darwin' ? 'Meta+r' : 'Control+r';
const rowLabels = (grid: Locator) => grid.getByRole('gridcell').filter({ hasText: /row [ABC]$/ });

/** 旁观正式分页回包，只记录筛选、排序和分页条件，不替换 Main 或驱动结果。 */
async function observeReads(command: 'sqlite.tablePage' | 'postgres.table.page' | 'table.page') {
  await desktop.evaluate(({ ipcMain }, command) => {
    type Request = { command: string; input: Record<string, unknown> };
    type Handler = (event: Electron.IpcMainInvokeEvent, request: Request) => Promise<{ ok: boolean }>;
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
    const original = handlers.get('dbark:request');
    if (!original) throw Error('缺少正式表页 IPC 入口');
    const reads: Record<string, unknown>[] = [];
    Object.assign(globalThis, { gridHeaderTestReads: reads });
    handlers.set('dbark:request', async (event, request) => {
      const reply = await original(event, request);
      if (request.command === command && reply.ok) {
        const { page, pageSize, offset, limit, filter, filters, filterMode, filterGroup, mode, sort } = request.input;
        reads.push({ page, pageSize, offset, limit, filter, filters, filterMode, filterGroup, mode, sort });
      }
      return reply;
    });
  }, command);
  return () => desktop.evaluate(() => (globalThis as typeof globalThis & { gridHeaderTestReads: Record<string, unknown>[] }).gridHeaderTestReads);
}

/** 从真实活动格发起读取，核对只成功重读一次及沿用应用前的分页条件。 */
async function refreshFromGrid(grid: Locator, reads: Awaited<ReturnType<typeof observeReads>>, key: string) {
  const before = await reads();
  expect(before.length).toBeGreaterThan(0);
  await rowLabels(grid).first().press(key);
  await expect.poll(async () => (await reads()).length).toBe(before.length + 1);
  expect((await reads()).at(-1)).toEqual(before.at(-1));
}

/** 从真实数据格与列标题分别操作，并核对结果行而非只读排序图标。 */
async function sortFromGrid(grid: Locator, last: string): Promise<void> {
  const header = grid.getByRole('columnheader').filter({ hasText: /^label/ });
  const labels = rowLabels(grid);
  await labels.filter({ hasText: /row A$/ }).click({ timeout: 5000 });
  await page.keyboard.press('Meta+ArrowDown');
  await expect(labels.first()).toHaveText(new RegExp(last + '$'));
  await expect(header).toHaveAttribute('aria-sort', 'descending');
  await header.press('Meta+ArrowUp');
  await expect(labels.first()).toHaveText(/row A$/);
  await expect(header).toHaveAttribute('aria-sort', 'ascending');
}

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
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'subject', tabs: [
        ...['subject', 'subject_view'].map(table => ({ id: table, kind: 'table' as const, title: table, table, connectionId: connection.id, database: 'main' })),
        { id: 'header-query', kind: 'query', title: '结果排序', connectionId: connection.id, database: 'main', sql: 'SELECT label FROM subject ORDER BY id' },
      ] });
    });
    const reads = await observeReads('sqlite.tablePage');
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
    if (process.platform === 'darwin') await sortFromGrid(tab, 'row B');
    await (await navigationMenuItem(tab, { name: sqlite.conditions, exact: true })).click();
    await tab.getByRole('button', { name: sqlite.addFilter, exact: true }).click();
    await tab.getByLabel(sqlite.filterColumn(1), { exact: true }).selectOption('label');
    const filter = tab.getByLabel(sqlite.filterValue(1), { exact: true });
    await filter.fill('row B');
    await expect(rowLabels(tab)).toHaveCount(2);
    await filter.dispatchEvent('keydown', {
      key: 'r', isComposing: true, ctrlKey: process.platform !== 'darwin', metaKey: process.platform === 'darwin',
    });
    await expect(rowLabels(tab)).toHaveCount(2);
    await filter.press(applyKey);
    await expect(rowLabels(tab)).toHaveCount(1);
    await expect(rowLabels(tab).first()).toHaveText(/row B$/);
    await tab.getByRole('button', { name: sqlite.removeFilter(1), exact: true }).click();
    const direction = tab.getByLabel(sqlite.sortDirection(1), { exact: true });
    await direction.selectOption('desc');
    await expect(rowLabels(tab)).toHaveCount(1);
    await direction.press(applyKey);
    await expect(rowLabels(tab)).toHaveCount(2);
    await expect(rowLabels(tab).first()).toHaveText(/row B$/);
    // 未应用的筛选留在编辑区，网格刷新继续用已提交的条件。
    await tab.getByRole('button', { name: sqlite.addFilter, exact: true }).click();
    await tab.getByLabel(sqlite.filterColumn(1), { exact: true }).selectOption('label');
    await filter.fill('row A');
    await refreshFromGrid(tab, reads, 'F5');
    if (process.platform === 'darwin') await refreshFromGrid(tab, reads, 'Meta+r');
    await expect(filter).toHaveValue('row A');
    await expect(rowLabels(tab)).toHaveCount(2);
    await expect(rowLabels(tab).first()).toHaveText(/row B$/);

    const beforeDraft = await reads();
    await rowLabels(tab).first().dblclick();
    const editor = page.getByRole('dialog', { name: sqliteEdit.editCell, exact: true });
    await expect(editor).toBeVisible();
    const input = editor.getByLabel('SQLite 字段 label 值', { exact: true });
    await input.fill('只留在本地的值');
    await input.press('F5');
    await expect(input).toHaveValue('只留在本地的值');
    await editor.getByRole('button', { name: sqliteEdit.saveInput, exact: true }).click();
    const draft = tab.getByRole('gridcell').filter({ hasText: /只留在本地的值$/ });
    await expect(draft).toBeVisible();
    await answerDialogs([1]);
    const [confirmation] = await Promise.all([page.waitForEvent('dialog', { timeout: 5000 }), draft.press('F5')]);
    expect(confirmation.message()).toBe(sqliteWorkspace.confirmDiscard);
    await expect(draft).toBeVisible();
    expect(await reads()).toEqual(beforeDraft);
    await (await navigationMenuItem(tab, { name: sqliteEdit.undo, exact: true })).click();
    await expect(rowLabels(tab).first()).toHaveText(/row B$/);
    await page.locator('[data-workspace-tab-id="subject_view"] .tab-select').click();
    await expect(header('label')).toBeVisible();
    await toggle(text.showType);
    await expect(header('label').locator('.column-type')).toHaveText('VARCHAR(17)');
    await page.screenshot({ path: info.outputPath('SQLite表头类型.png') });
    if (process.platform === 'darwin') {
      await sortFromGrid(tab, 'row B');
      await page.locator('[data-workspace-tab-id="header-query"] .tab-select').click();
      const query = page.locator('.query-tab:visible'), result = query.locator('.result-body');
      await query.locator('.query-execute-split button.primary').click();
      await expect(result.getByRole('gridcell', { name: 'row A', exact: true })).toBeVisible();
      const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
      await expect.poll(async () => (await history()).length).toBeGreaterThan(0);
      const prior = await history();
      await sortFromGrid(result, 'row B');
      expect(await history()).toEqual(prior);
    }
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
    const reads = await observeReads(dialect === 'postgresql' ? 'postgres.table.page' : 'table.page');
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
    if (process.platform === 'darwin') await sortFromGrid(tab, 'row C');

    await (await navigationMenuItem(tab, { name: sort.entry, exact: true })).click();
    const sortPanel = tab.getByRole('region', { name: sort.title, exact: true });
    const direction = sortPanel.getByLabel(sort.direction(1), { exact: true });
    if (process.platform !== 'darwin') {
      await sortPanel.getByRole('button', { name: sort.add, exact: true }).click();
      await sortPanel.getByLabel(sort.field(1), { exact: true }).selectOption('label');
    }
    await direction.selectOption('DESC');
    await direction.press(applyKey);
    await expect(sortPanel).toBeHidden();
    await expect(rowLabels(tab).first()).toHaveText(/row C$/);

    if (dialect === 'postgresql') {
      await tab.getByLabel(postgres.filterColumn, { exact: true }).selectOption('label');
      const quick = tab.getByLabel(postgres.filterText, { exact: true });
      await quick.fill('row B');
      await quick.press(applyKey);
      await expect(rowLabels(tab)).toHaveCount(1);
      await expect(rowLabels(tab).first()).toHaveText(/row B$/);
      await tab.getByRole('button', { name: postgres.clearFilter, exact: true }).click();
      await expect(rowLabels(tab)).toHaveCount(3);
      await tab.getByRole('button', { name: postgres.advancedFilter, exact: true }).click();
    } else {
      await (await navigationMenuItem(tab, { name: zh.table.text006, exact: true })).click();
    }
    const form = tab.locator('.filter-rule-form'), field = form.getByLabel(zh.table.text009, { exact: true });
    const value = form.getByLabel(zh.table.text011, { exact: true });
    if (dialect === 'postgresql') {
      await field.selectOption('scope');
      await value.fill('B');
      await form.getByRole('button', { name: zh.table.text013, exact: true }).click();
    }
    await field.selectOption('label');
    await value.fill('row C');
    await expect(rowLabels(tab)).toHaveCount(3);
    await value.press(applyKey);
    await expect(rowLabels(tab)).toHaveCount(1);
    await expect(rowLabels(tab).first()).toHaveText(/row C$/);
    await refreshFromGrid(tab, reads, 'F5');
    if (process.platform === 'darwin') await refreshFromGrid(tab, reads, 'Meta+r');
    await expect(rowLabels(tab)).toHaveCount(1);
    await expect(rowLabels(tab).first()).toHaveText(/row C$/);
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  }
});
