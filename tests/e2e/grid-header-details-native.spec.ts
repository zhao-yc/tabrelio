import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Locator } from '@playwright/test';
import { answerDialogs, confirmOwnedDesktopExit, dataDir, desktop, expect, page, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';
import type { NetworkConnectionProfile, PostgresConnectionProfile } from '../../src/shared/contracts';
import { gridHeaderDetailsZh as text } from '../../src/renderer/locales/gridHeaderDetails.zh-CN';
import { gridHeaderMenuZh as headerMenuText } from '../../src/renderer/locales/gridHeaderMenu.zh-CN';
import { readGridRangeClipboard } from './grid-cell-range-clipboard';
import { sqliteTableBrowseZh as sqlite } from '../../src/renderer/locales/sqliteTableBrowse.zh-CN';
import { postgresTableZh as postgres } from '../../src/renderer/locales/postgresTable.zh-CN';
import { tableSortZh as sort } from '../../src/renderer/locales/tableSort.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import { recordViewZh as recordForm } from '../../src/renderer/locales/recordViews.zh-CN';
import { postgresRecordViewZh as pgForm } from '../../src/renderer/locales/postgresRecordView.zh-CN';
import { recordNavigatorZh as recordNav } from '../../src/renderer/locales/recordNavigator.zh-CN';
import { tableReadHistoryZh as readHistory } from '../../src/renderer/locales/tableReadHistory.zh-CN';
import { tableColumnChooserZh as chooserText } from '../../src/renderer/locales/tableColumnChooser.zh-CN';
import { tableFilterEnabledZh } from '../../src/renderer/locales/tableFilterEnabled.zh-CN';
import { sqliteTableEditZh as sqliteEdit } from '../../src/renderer/locales/sqliteTableEdit.zh-CN';
import { sqliteEditWorkspaceZh as sqliteWorkspace } from '../../src/renderer/locales/sqliteEditWorkspace.zh-CN';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });

const taskIds = () => page.evaluate(async () => (await window.dbark.invoke('tasks.list', {})).map(task => task.id).sort());
const applyKey = process.platform === 'darwin' ? 'Meta+r' : 'Control+r';
const rowLabels = (grid: Locator) => grid.getByRole('gridcell').filter({ hasText: /row [ABC]$/ });

/** 历史只读本标签已收到的模板，打开面板不发分页请求。 */
async function verifyReadHistory(scope: Locator, reads: Awaited<ReturnType<typeof observeReads>>, table: string, filter: string, counted = false) {
  const before = await reads();
  await (await navigationMenuItem(scope, { name: readHistory.title, exact: true })).click();
  const history = scope.getByRole('region', { name: readHistory.title, exact: true });
  await expect(history).toBeVisible();
  await expect(page.getByRole('dialog', { name: readHistory.title, exact: true })).toHaveCount(0);
  const grid = scope.getByRole('grid');
  await expect(grid).toBeVisible();
  const [gridBox, historyBox] = await Promise.all([grid.boundingBox(), history.boundingBox()]);
  expect(gridBox).not.toBeNull();
  expect(historyBox).not.toBeNull();
  expect(historyBox!.y).toBeGreaterThanOrEqual(gridBox!.y + gridBox!.height - 1);
  const latest = history.locator('details').first().locator('pre');
  await expect(latest).toHaveCount(counted ? 2 : 1);
  if (counted) await expect(latest.first()).toContainText(/count\(\*\)/i);
  const select = latest.last();
  await expect(select).toContainText(table);
  await expect(select).toContainText(/WHERE.+(\?|\$[0-9]+)/);
  await expect(select).toContainText('LIMIT');
  await expect(history).not.toContainText(filter);
  await expect(history).not.toContainText(Buffer.from(filter).toString('hex'));
  expect(await reads()).toEqual(before);
  return history;
}

async function toggleFromHeader(header: Locator, name: string, keyboard = false): Promise<void> {
  await headerAction(header, name, keyboard);
  await expect(header).toBeFocused();
}

/** 排序重建数据页，筛选会转移焦点，两者共用菜单操作而不假定后续焦点。 */
async function headerAction(header: Locator, name: string, keyboard = false): Promise<void> {
  if (keyboard) await header.press('Shift+F10');
  else await header.click({ button: 'right' });
  const menu = page.getByRole('menu', { name: headerMenuText.menu, exact: true });
  const action = menu.getByRole('menuitem', { name, exact: true });
  await expect(action).toBeVisible();
  if (keyboard) await action.press('Enter');
  else await action.click();
  await expect(menu).toBeHidden();
}

/** 同时核对虚拟网格的实际行高、字号及原列宽。 */
async function verifyGridZoom(scope: Locator, header: Locator): Promise<void> {
  const grid = scope.getByRole('grid');
  const row = grid.getByRole('row').nth(1);
  const height = () => row.evaluate(element => element.getBoundingClientRect().height);
  const width = () => header.evaluate(element => element.getBoundingClientRect().width);
  const initialHeight = await height(), initialWidth = await width();
  await expect(grid).toHaveCSS('font-size', '11px');
  await toggleFromHeader(header, headerMenuText.zoomOut(90), true);
  await expect.poll(height).toBe(Math.round(initialHeight * 0.9));
  await toggleFromHeader(header, headerMenuText.zoomReset);
  await toggleFromHeader(header, headerMenuText.zoomIn(110));
  await toggleFromHeader(header, headerMenuText.zoomIn(125));
  await expect(grid).toHaveCSS('font-size', '13.75px');
  await expect.poll(height).toBe(Math.round(initialHeight * 1.25));
  expect(await width()).toBe(initialWidth);
}

/** 走真实侧栏入口，核对列标题、原行勾选和数据库读取次数。 */
async function verifyColumnChooser(scope: Locator, reads: Awaited<ReturnType<typeof observeReads>>, screenshot?: string) {
  const grid = scope.getByRole('grid');
  const checked = grid.getByRole('row').nth(1).getByRole('checkbox');
  await checked.check();
  const before = await reads();
  await (await navigationMenuItem(scope, { name: chooserText.title, exact: true })).click();
  const chooser = scope.getByRole('region', { name: chooserText.title, exact: true });
  await expect(chooser).toBeVisible();
  const [paneBox, gridBox] = await Promise.all([chooser.boundingBox(), grid.boundingBox()]);
  expect(paneBox).not.toBeNull();
  expect(gridBox).not.toBeNull();
  expect(gridBox!.x).toBeGreaterThanOrEqual(paneBox!.x + paneBox!.width - 1);
  const filter = chooser.getByRole('searchbox', { name: chooserText.search });
  const label = chooser.getByRole('checkbox', { name: 'label', exact: true });
  const labelHeader = grid.getByRole('columnheader').filter({ hasText: /^label/ });
  const columns = chooser.getByRole('checkbox');
  const total = await columns.count();
  expect(total).toBeGreaterThan(1);
  await filter.fill('LABEL');
  await expect(columns).toHaveCount(1);
  await label.uncheck();
  await expect(labelHeader).toHaveCount(0);
  if (screenshot) await page.screenshot({ path: screenshot });
  await label.check();
  await expect(labelHeader).toBeVisible();
  await filter.fill('');
  for (let index = 0; index < total; index++) {
    const option = columns.nth(index);
    if (await option.evaluate(input => input.closest('label')?.title) !== 'label') await option.uncheck();
  }
  await expect(label).toBeDisabled();
  await expect(checked).toBeChecked();
  await chooser.getByRole('button', { name: chooserText.showAll, exact: true }).click();
  await expect(chooser.getByText(chooserText.count(total, total), { exact: true })).toBeVisible();
  await expect(labelHeader).toBeVisible();
  await filter.press('Escape');
  await expect(chooser).toBeHidden();
  expect(await reads()).toEqual(before);
  await checked.uncheck();
}

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

/** 组词与连按先走真实输入事件，只有独立 Enter 才产生一次分页。 */
async function applyFilterWithEnter(input: Locator, reads: Awaited<ReturnType<typeof observeReads>>) {
  const before = await reads();
  await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true });
  await input.dispatchEvent('keydown', { key: 'Enter', keyCode: 229, bubbles: true, cancelable: true });
  await input.dispatchEvent('keydown', { key: 'Enter', repeat: true, bubbles: true, cancelable: true });
  expect(await reads()).toEqual(before);
  await input.press('Enter');
  await expect.poll(async () => (await reads()).length).toBe(before.length + 1);
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
    fixture.exec("CREATE TABLE subject (id INTEGER PRIMARY KEY, label VARCHAR(17), dynamic_value); INSERT INTO subject VALUES(1,'row A',2),(2,'row B','x'); CREATE VIEW subject_view AS SELECT * FROM subject;" +
      "CREATE TABLE physical (rowid TEXT, label TEXT); INSERT INTO physical(_rowid_,rowid,label) VALUES (9223372036854775807,'声明列','物理行');");
  } finally { fixture.close(); }
  const baseline = await readFile(file);
  try {
    await desktop.evaluate(({ dialog, BrowserWindow }, file) => {
      const original = dialog.showOpenDialog;
      let picks = 0;
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        if (args[0] !== BrowserWindow.getAllWindows()[0] || !(args.at(-1) as Electron.OpenDialogOptions).filters?.[0]?.extensions.includes('sqlite'))
          throw Error('越过本例文件选择范围');
        if (++picks === 2) dialog.showOpenDialog = original;
        return { canceled: false, filePaths: [file] };
      }) as typeof original;
    }, file);
    await page.evaluate(async () => {
      const id = 'grid-header-sqlite';
      const picked = await window.dbark.invoke('files.choose', { purpose: 'sqlite-database', sqliteConnectionId: id });
      if (!picked) throw Error('本例 SQLite 文件未授权');
      const connection = await window.dbark.invoke('connections.save', { id, dialect: 'sqlite', name: 'SQLite',
        group: '', color: '#123456', sqlite: { fileToken: picked.token, readOnly: false, busyTimeoutMs: 1000 } });
      const readOnlyId = 'grid-header-sqlite-readonly';
      const readOnlyPick = await window.dbark.invoke('files.choose', { purpose: 'sqlite-database', sqliteConnectionId: readOnlyId });
      if (!readOnlyPick) throw Error('本例 SQLite 只读连接未授权');
      const readOnly = await window.dbark.invoke('connections.save', { id: readOnlyId, dialect: 'sqlite', name: 'SQLite 只读',
        group: '', color: '#123456', sqlite: { fileToken: readOnlyPick.token, readOnly: true, busyTimeoutMs: 1000 } });
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'subject', tabs: [
        ...['subject', 'subject_view', 'physical'].map(table => ({ id: table, kind: 'table' as const, title: table, table, connectionId: connection.id, database: 'main' })),
        { id: 'physical-readonly', kind: 'table', title: '只读物理表', table: 'physical', connectionId: readOnly.id, database: 'main' },
        { id: 'header-query', kind: 'query', title: '结果排序', connectionId: connection.id, database: 'main', sql: 'SELECT label FROM subject ORDER BY id' },
      ] });
    });
    const reads = await observeReads('sqlite.tablePage');
    await page.reload();
    const tab = page.locator('.sqlite-table-tab:visible');
    const header = (name: string) => tab.getByRole('columnheader').filter({ has: page.locator('.grid-header-detail-name').filter({ hasText: new RegExp('^' + name + '$') }) });
    const toggle = async (name: string) => (await navigationMenuItem(tab, { name, exact: true })).click();
    await expect(header('label')).toBeVisible();
    await verifyColumnChooser(tab, reads, info.outputPath('SQLite列显隐侧栏.png'));
    const before = await taskIds();
    const readsBeforeDisplay = await reads();
    await verifyGridZoom(tab, header('label'));
    await expect(header('label').locator('.column-type')).toHaveCount(0);
    await toggleFromHeader(header('label'), text.showType);
    await expect(header('label').locator('.column-type')).toHaveText('VARCHAR(17)');
    await expect(header('dynamic_value').locator('.column-type')).toHaveText(sqlite.dynamic);
    expect(await taskIds()).toEqual(before);
    expect(await reads()).toEqual(readsBeforeDisplay);
    await header('label').click();
    await expect(header('label')).toHaveAttribute('aria-sort', 'ascending');
    await expect(header('label').locator('.rdg-header-sort-name + span svg')).toBeVisible();
    await toggle(text.hideType);
    await expect(header('label').locator('.column-type')).toHaveCount(0);
    await expect(header('label')).toHaveAttribute('aria-sort', 'ascending');
    if (process.platform === 'darwin') await sortFromGrid(tab, 'row B');
    const beforeHeaderFilter = await reads();
    await headerAction(header('label'), headerMenuText.filterColumn, true);
    await expect(tab.getByLabel(sqlite.filterColumn(1), { exact: true })).toHaveValue('label');
    const filter = tab.getByLabel(sqlite.filterValue(1), { exact: true });
    await expect(filter).toBeFocused();
    await filter.fill('row B');
    await headerAction(header('id'), headerMenuText.filterColumn);
    await expect(tab.getByLabel(sqlite.filterColumn(2), { exact: true })).toHaveValue('id');
    await expect(tab.getByLabel(sqlite.filterValue(2), { exact: true })).toBeFocused();
    await expect(filter).toHaveValue('row B');
    await tab.getByRole('button', { name: sqlite.removeFilter(2), exact: true }).click();
    expect(await reads()).toEqual(beforeHeaderFilter);
    await expect(rowLabels(tab)).toHaveCount(2);
    await filter.dispatchEvent('keydown', {
      key: 'r', isComposing: true, ctrlKey: process.platform !== 'darwin', metaKey: process.platform === 'darwin',
    });
    await expect(rowLabels(tab)).toHaveCount(2);
    await applyFilterWithEnter(filter, reads);
    await expect(rowLabels(tab)).toHaveCount(1);
    await expect(rowLabels(tab).first()).toHaveText(/row B$/);
    const historyPane = await verifyReadHistory(tab, reads, 'subject', 'row B');
    await historyPane.getByRole('button', { name: readHistory.close, exact: true }).click();
    const beforeLast = (await reads()).length;
    await tab.getByRole('button', { name: sqlite.last, exact: true }).click();
    await expect.poll(async () => (await reads()).length).toBe(beforeLast + 1);
    const countedHistoryPane = await verifyReadHistory(tab, reads, 'subject', 'row B', true);
    const entries = countedHistoryPane.locator('details');
    const retained = entries.first();
    // 显式选中带计数的条目后，从仍可操作的网格刷新，新条目不能挤掉当前展开项。
    await entries.nth(1).locator('summary').press('Enter');
    await retained.locator('summary').press('Enter');
    const entryCount = await entries.count();
    await rowLabels(tab).first().click();
    await refreshFromGrid(tab, reads, 'F5');
    await expect(entries).toHaveCount(entryCount + 1);
    await expect(entries.nth(1).locator('pre').first()).toContainText(/count\(\*\)/i);
    await expect(entries.first().locator('pre')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('SQLite表页底部SQL历史.png') });
    await countedHistoryPane.getByRole('button', { name: readHistory.close, exact: true }).press('Escape');
    await expect(countedHistoryPane).toBeHidden();
    await rowLabels(tab).first().dblclick();
    const clearDraftEditor = page.getByRole('dialog', { name: sqliteEdit.editCell, exact: true });
    await clearDraftEditor.getByLabel('SQLite 字段 label 值', { exact: true }).fill('清除筛选前保留的草稿');
    await clearDraftEditor.getByRole('button', { name: sqliteEdit.saveInput, exact: true }).click();
    const clearDraft = tab.getByRole('gridcell').filter({ hasText: /清除筛选前保留的草稿$/ });
    await expect(clearDraft).toBeVisible();
    const beforeDeclinedClear = await reads();
    await answerDialogs([1]);
    const [applyConfirmation] = await Promise.all([page.waitForEvent('dialog', { timeout: 5000 }), filter.press('Enter')]);
    expect(applyConfirmation.message()).toBe(sqliteWorkspace.confirmDiscard);
    await expect(clearDraft).toBeVisible();
    expect(await reads()).toEqual(beforeDeclinedClear);
    const clear = await navigationMenuItem(tab, { name: tableFilterEnabledZh.clear, exact: true });
    await answerDialogs([1]);
    const [clearConfirmation] = await Promise.all([page.waitForEvent('dialog', { timeout: 5000 }), clear.click()]);
    expect(clearConfirmation.message()).toBe(sqliteWorkspace.confirmDiscard);
    await expect(clearDraft).toBeVisible();
    expect(await reads()).toEqual(beforeDeclinedClear);
    await (await navigationMenuItem(tab, { name: sqliteEdit.undo, exact: true })).click();
    const direction = tab.getByLabel(sqlite.sortDirection(1), { exact: true });
    await direction.selectOption('desc');
    await expect(rowLabels(tab)).toHaveCount(1);
    const beforeSort = (await reads()).length;
    await direction.press(applyKey);
    await expect.poll(async () => (await reads()).length).toBe(beforeSort + 1);
    const beforeClear = await reads();
    await direction.selectOption('asc');
    await (await navigationMenuItem(tab, { name: tableFilterEnabledZh.clear, exact: true })).click();
    await expect(rowLabels(tab)).toHaveCount(2);
    await expect(rowLabels(tab).first()).toHaveText(/row B$/);
    expect(await reads()).toHaveLength(beforeClear.length + 1);
    expect((await reads()).at(-1)).toEqual({ ...beforeClear.at(-1), filters: [], offset: 0 });
    await expect(direction).toHaveValue('asc');
    await direction.selectOption('desc');
    // 未应用的筛选留在编辑区，网格刷新继续用已提交的条件。
    await tab.getByRole('button', { name: sqlite.addFilter, exact: true }).click();
    await tab.getByLabel(sqlite.filterColumn(1), { exact: true }).selectOption('label');
    await filter.fill('row A');
    await refreshFromGrid(tab, reads, 'F5');
    await expect(tab.getByRole('grid')).toHaveCSS('font-size', '13.75px');
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
    await (await navigationMenuItem(tab, { name: chooserText.title, exact: true })).click();
    const columnChooser = tab.getByRole('region', { name: chooserText.title, exact: true });
    const dynamicColumn = columnChooser.getByRole('checkbox', { name: 'dynamic_value', exact: true });
    await dynamicColumn.uncheck();
    await expect(draft).toBeVisible();
    await dynamicColumn.check();
    await columnChooser.getByRole('button', { name: chooserText.close, exact: true }).click();
    await toggleFromHeader(header('label'), headerMenuText.zoomReset);
    await expect(draft).toBeVisible();
    await answerDialogs([1]);
    const [confirmation] = await Promise.all([page.waitForEvent('dialog', { timeout: 5000 }), draft.press('F5')]);
    expect(confirmation.message()).toBe(sqliteWorkspace.confirmDiscard);
    await expect(draft).toBeVisible();
    expect(await reads()).toEqual(beforeDraft);
    await answerDialogs([1]);
    const [cancelSort] = await Promise.all([page.waitForEvent('dialog', { timeout: 5000 }),
      headerAction(header('label'), headerMenuText.clearAllSort)]);
    expect(cancelSort.message()).toBe(sqliteWorkspace.confirmDiscard);
    await expect(draft).toBeVisible();
    expect(await reads()).toEqual(beforeDraft);
    await (await navigationMenuItem(tab, { name: sqliteEdit.undo, exact: true })).click();
    await expect(rowLabels(tab).first()).toHaveText(/row B$/);
    await headerAction(header('id'), headerMenuText.desc);
    await expect.poll(async () => (await reads()).at(-1)?.sort).toHaveLength(2);
    await headerAction(header('id'), headerMenuText.hideColumn);
    await expect(header('id')).toHaveCount(0);
    const beforeClearSort = await reads();
    await headerAction(header('label'), headerMenuText.clearAllSort, true);
    await expect(rowLabels(tab).first()).toHaveText(/row A$/);
    expect(await reads()).toEqual([...beforeClearSort, { ...beforeClearSort.at(-1), offset: 0, sort: [] }]);
    await expect(filter).toHaveValue('row A');
    await (await navigationMenuItem(tab, { name: readHistory.title, exact: true })).click();
    await page.locator('[data-workspace-tab-id="subject_view"] .tab-select').click();
    await expect(header('label')).toBeVisible();
    const visibleHistory = tab.getByRole('region', { name: readHistory.title, exact: true });
    await expect(visibleHistory).toHaveCount(0);
    const viewReads = await reads();
    await expect(tab.getByRole('grid')).toHaveCSS('font-size', '11px');
    await toggleFromHeader(header('label'), text.showType, true);
    await expect(header('label').locator('.column-type')).toHaveText('VARCHAR(17)');
    await header('label').press('Shift+F10');
    const viewMenu = page.getByRole('menu', { name: headerMenuText.menu, exact: true });
    await expect(viewMenu.getByRole('menuitem', { name: text.hideType, exact: true })).toBeVisible();
    await expect(viewMenu.getByRole('menuitem', { name: text.showComment, exact: true })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('SQLite表头类型.png') });
    await page.keyboard.press('Escape');
    expect(await reads()).toEqual(viewReads);
    await tab.getByRole('gridcell').filter({ hasText: 'row A' }).click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: sqlite.showRowId, exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await verifyColumnChooser(tab, reads);
    const beforeViewFilter = await reads();
    await headerAction(header('label'), headerMenuText.filterColumn);
    await expect(tab.getByLabel(sqlite.filterColumn(1), { exact: true })).toHaveValue('label');
    await expect(tab.getByLabel(sqlite.filterValue(1), { exact: true })).toBeFocused();
    expect(await reads()).toEqual(beforeViewFilter);
    await (await navigationMenuItem(tab, { name: sqlite.conditions, exact: true })).click();
    await (await navigationMenuItem(tab, { name: readHistory.title, exact: true })).click();
    await expect(visibleHistory.locator('pre')).toContainText('"subject_view"');
    await page.locator('[data-workspace-tab-id="subject"] .tab-select').click();
    await expect(visibleHistory.locator('pre')).toContainText('"subject"');
    await visibleHistory.getByRole('button', { name: readHistory.close, exact: true }).click();
    await page.locator('[data-workspace-tab-id="subject_view"] .tab-select').click();
    await expect(visibleHistory.locator('pre')).toContainText('"subject_view"');
    await visibleHistory.getByRole('button', { name: readHistory.close, exact: true }).click();
    if (process.platform === 'darwin') {
      await sortFromGrid(tab, 'row B');
      await page.locator('[data-workspace-tab-id="header-query"] .tab-select').click();
      const query = page.locator('.query-tab:visible'), result = query.locator('.result-body');
      await query.locator('.query-execute-split button.primary').click();
      await expect(result.getByRole('gridcell', { name: 'row A', exact: true })).toBeVisible();
      const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
      await expect.poll(async () => (await history()).length).toBeGreaterThan(0);
      const prior = await history();
      const editor = query.locator('.monaco-editor .view-line').first();
      const editorSize = await editor.evaluate(element => getComputedStyle(element).fontSize);
      await verifyGridZoom(result, result.getByRole('columnheader').filter({ hasText: /^label/ }));
      await expect(editor).toHaveCSS('font-size', editorSize);
      await sortFromGrid(result, 'row B');
      const label = result.getByRole('columnheader').filter({ hasText: /^label/ });
      await headerAction(label, headerMenuText.desc);
      await expect(rowLabels(result).first()).toHaveText(/row B$/);
      await headerAction(label, headerMenuText.clearAllSort);
      await expect(rowLabels(result).first()).toHaveText(/row A$/);
      await label.press('Shift+F10');
      await expect(page.getByRole('menuitem', { name: headerMenuText.clearAllSort, exact: true })).toHaveCount(0);
      await page.keyboard.press('Escape');
      expect(await history()).toEqual(prior);
    }
    await page.locator('[data-workspace-tab-id="physical"] .tab-select').click();
    const physical = tab.getByRole('gridcell').filter({ hasText: /物理行$/ });
    await expect(physical).toBeVisible();
    const beforeRowId = await reads();
    const checked = tab.getByRole('grid').getByRole('row').nth(1).getByRole('checkbox');
    await checked.check();
    await physical.click({ button: 'right' });
    await page.getByRole('menuitem', { name: sqlite.showRowId, exact: true }).click();
    const rowIdHeader = tab.getByRole('columnheader', { name: sqlite.rowId, exact: true });
    await expect(rowIdHeader).toBeVisible();
    await expect(tab.getByRole('columnheader').last()).toHaveText(sqlite.rowId);
    const rowId = tab.getByRole('gridcell', { name: '9223372036854775807', exact: true });
    await rowId.click();
    expect(await readGridRangeClipboard(page)).toEqual({ text: '9223372036854775807', sqlite: '', typed: '' });
    await expect(tab.getByRole('gridcell').filter({ hasText: /声明列$/ })).toBeVisible();
    await expect(checked).toBeChecked();
    await page.screenshot({ path: info.outputPath('SQLite真实ROWID.png') });
    await toggle(sqlite.hideRowId);
    await expect(rowIdHeader).toHaveCount(0);
    await expect(checked).toBeChecked();
    expect(await reads()).toEqual(beforeRowId);
    await page.locator('[data-workspace-tab-id="physical-readonly"] .tab-select').click();
    await expect(physical).toBeVisible();
    const readOnlyBefore = await reads();
    await toggle(sqlite.showRowId);
    await expect(rowIdHeader).toBeVisible();
    await rowId.click();
    expect(await readGridRangeClipboard(page)).toEqual({ text: '9223372036854775807', sqlite: '', typed: '' });
    expect(await reads()).toEqual(readOnlyBefore);
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
    await verifyColumnChooser(tab, reads);
    const before = await taskIds();
    const readsBeforeDisplay = await reads();
    const checked = tab.getByRole('grid').getByRole('row').nth(1).getByRole('checkbox');
    await checked.check();
    await verifyGridZoom(tab, header);
    await toggleFromHeader(header, text.showComment);
    const expected = dialect === 'postgresql' ? '字段说明' + '注'.repeat(156) + '…' : '字段说明';
    await expect(header.locator('.grid-header-comment')).toHaveText(expected);
    await expect(header.locator('.grid-header-details')).toHaveAttribute('title', new RegExp(expected));
    await header.press('Shift+F10');
    const headerMenu = page.getByRole('menu', { name: headerMenuText.menu, exact: true });
    await expect(headerMenu.getByRole('menuitem', { name: text.hideComment, exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('类型和注释.png') });
    await page.keyboard.press('Escape');
    await toggleFromHeader(header, text.hideType, true);
    await expect(header.locator('.column-type')).toHaveCount(0);
    await expect(header.locator('.grid-header-comment')).toHaveText(expected);
    await toggle(text.hideComment);
    await expect(header.locator('.grid-header-comment')).toHaveCount(0);
    await expect(header).toHaveText('label');
    await expect(checked).toBeChecked();
    await checked.uncheck();
    expect(await taskIds()).toEqual(before);
    expect(await reads()).toEqual(readsBeforeDisplay);
    if (process.platform === 'darwin') await sortFromGrid(tab, 'row C');
    await expect(tab.getByRole('grid')).toHaveCSS('font-size', '13.75px');

    const beforeRecordNav = await reads();
    const lastRecordLabel = (await rowLabels(tab).nth(2).textContent())?.trim();
    expect(lastRecordLabel).toMatch(/^row [ABC]$/);
    const postgresForm = dialect === 'postgresql';
    const recordToggle = postgresForm ? tab.getByRole('button', { name: pgForm.view, exact: true })
      : await navigationMenuItem(tab, { name: recordForm.title, exact: true });
    await recordToggle.click();
    const record = tab.locator(postgresForm ? '.pg-record-view' : '.record-form-panel');
    await record.getByRole('button', { name: recordNav.title, exact: true }).click();
    const recordList = record.getByRole('region', { name: recordNav.title, exact: true });
    await recordList.getByText(recordNav.columns, { exact: true }).click();
    await recordList.getByLabel(recordNav.column(0), { exact: true }).selectOption({ label: 'label' });
    const targetRecord = recordList.getByRole('button', { name: /^第 3 条/ });
    await expect(targetRecord).toContainText(lastRecordLabel!);
    await targetRecord.click();
    await expect(targetRecord).toHaveAttribute('aria-current', 'true');
    await expect(record.getByText(postgresForm ? pgForm.position(2, 0, 3) : '本页第 3 / 3 条', { exact: true })).toBeVisible();
    if (postgresForm) {
      const [listBox, formBox] = await Promise.all([recordList.boundingBox(), record.locator('.pg-record-content').boundingBox()]);
      expect(listBox && formBox && listBox.x + listBox.width < formBox.x).toBe(true);
      await expect(record.locator('.pg-record-content')).toBeInViewport();
    }
    await page.screenshot({ path: info.outputPath('本页记录导航.png') });
    expect(await reads()).toEqual(beforeRecordNav);
    await (postgresForm ? tab.getByRole('button', { name: pgForm.grid, exact: true })
      : record.getByRole('button', { name: recordForm.close, exact: true })).click();

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
      await applyFilterWithEnter(quick, reads);
      await expect(rowLabels(tab)).toHaveCount(1);
      await expect(rowLabels(tab).first()).toHaveText(/row B$/);
      await quick.fill('');
      await applyFilterWithEnter(quick, reads);
      await expect(rowLabels(tab)).toHaveCount(3);
      await expect(tab.getByRole('button', { name: postgres.clearFilter, exact: true })).toBeDisabled();
    }
    const form = tab.locator('.filter-rule-form'), field = form.getByLabel(zh.table.text009, { exact: true });
    const value = form.getByLabel(zh.table.text011, { exact: true });
    // PostgreSQL 的已排序列会在字段名后显示优先级和方向。
    const headerFor = (name: string) => tab.getByRole('columnheader').filter({
      has: page.locator('.grid-header-detail-name').filter({ hasText: new RegExp('^' + name + '(?:\\s*\\d+\\s*[↑↓])?$') }),
    });
    const beforeHeaderFilter = await reads();
    if (dialect === 'postgresql') {
      await headerAction(headerFor('scope'), headerMenuText.filterColumn);
      await expect(field).toHaveValue('scope');
      await expect(value).toBeFocused();
      await value.fill('B');
      await form.getByRole('button', { name: zh.table.text013, exact: true }).click();
    }
    await headerAction(headerFor('label'), headerMenuText.filterColumn, true);
    await expect(field).toHaveValue('label');
    await expect(value).toBeFocused();
    await value.fill('row C');
    await headerAction(headerFor('id'), headerMenuText.filterColumn);
    await expect(field).toHaveValue('label');
    await expect(value).toHaveValue('row C');
    await expect(tab.getByText(headerMenuText.filterDraftPending, { exact: true })).toBeVisible();
    expect(await reads()).toEqual(beforeHeaderFilter);
    await expect(rowLabels(tab)).toHaveCount(3);
    if (dialect === 'postgresql') {
      const beforeDraft = await reads();
      await value.press('Enter');
      await expect(value).toHaveValue('');
      expect(await reads()).toEqual(beforeDraft);
      await value.press(applyKey);
    } else await applyFilterWithEnter(value, reads);
    await expect(rowLabels(tab)).toHaveCount(1);
    await expect(rowLabels(tab).first()).toHaveText(/row C$/);
    await refreshFromGrid(tab, reads, 'F5');
    if (process.platform === 'darwin') await refreshFromGrid(tab, reads, 'Meta+r');
    await expect(rowLabels(tab)).toHaveCount(1);
    await expect(rowLabels(tab).first()).toHaveText(/row C$/);
    const beforeLast = (await reads()).length;
    await tab.getByRole('button', { name: dialect === 'postgresql' ? postgres.lastPage : zh.table.lastPage, exact: true }).click();
    await expect.poll(async () => (await reads()).length).toBe(beforeLast + 1);
    const historyPane = await verifyReadHistory(tab, reads, 'update_subject', 'row C', true);
    await page.screenshot({ path: info.outputPath('表页读取SQL.png') });
    await historyPane.getByRole('button', { name: readHistory.close, exact: true }).click();
    await headerAction(headerFor('scope'), headerMenuText.desc);
    await expect.poll(async () => (await reads()).at(-1)?.sort).toHaveLength(2);
    await headerAction(headerFor('scope'), headerMenuText.hideColumn);
    await expect(headerFor('scope')).toHaveCount(0);
    const beforeClearSort = await reads();
    await headerAction(headerFor('id'), headerMenuText.clearAllSort, true);
    await expect.poll(async () => (await reads()).length).toBe(beforeClearSort.length + 1);
    expect((await reads()).at(-1)).toEqual({ ...beforeClearSort.at(-1), sort: [] });
    await expect(rowLabels(tab)).toHaveCount(1);
    await expect(rowLabels(tab).first()).toHaveText(/row C$/);
    await headerAction(headerFor('label'), headerMenuText.desc);
    await expect.poll(async () => (await reads()).at(-1)?.sort).toHaveLength(1);
    const beforeClear = await reads();
    await (await navigationMenuItem(tab, { name: tableFilterEnabledZh.clear, exact: true })).click();
    await expect(rowLabels(tab)).toHaveCount(3);
    await expect(rowLabels(tab).first()).toHaveText(/row C$/);
    expect(await reads()).toHaveLength(beforeClear.length + 1);
    const previous = beforeClear.at(-1)!;
    expect((await reads()).at(-1)).toEqual(dialect === 'postgresql' ?
      { ...previous, filter: undefined, offset: 0 } : { ...previous, filters: [], filterGroup: undefined, page: 1 });
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  }
});
