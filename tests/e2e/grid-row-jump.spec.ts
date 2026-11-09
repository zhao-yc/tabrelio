import { createRequire } from 'node:module';
import { join } from 'node:path';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { gridRangeFillZh as rangeFill } from '../../src/renderer/locales/gridRangeFill.zh-CN';
import { DatabaseSync } from 'node:sqlite';
import type { Locator } from '@playwright/test';
import { LocalStore } from '../../src/main/storage';
import { gridRowJumpZh as text } from '../../src/renderer/locales/gridRowJump.zh-CN';
import { gridRowSelectionZh as selectionText } from '../../src/renderer/locales/gridRowSelection.zh-CN';
import { gridColumnWidthBatchZh as batchText } from '../../src/renderer/locales/gridColumnWidthBatch.zh-CN';
import { gridRowHeightZh as heightText } from '../../src/renderer/locales/gridRowHeight.zh-CN';
import { sqliteTableLayoutZh as layoutText } from '../../src/renderer/locales/sqliteTableLayout.zh-CN';
import { tableGridZh } from '../../src/renderer/locales/tableGrid.zh-CN';
import { tableHeaderCopyZh } from '../../src/renderer/locales/tableHeaderCopy.zh-CN';
import { queryResultCopyZh } from '../../src/renderer/locales/queryResultCopy.zh-CN';
import { queryResultFindZh as resultFind } from '../../src/renderer/locales/queryResultFind.zh-CN';
import { statementNavigationZh as navigationText } from '../../src/renderer/locales/statementNavigation.zh-CN';
import { queryDuplicateZh } from '../../src/renderer/locales/queryDuplicate.zh-CN';
import { navigationZh } from '../../src/renderer/locales/navigation.zh-CN';
import { savedQueryOrganizationZh as groupText } from '../../src/renderer/locales/savedQueryOrganization.zh-CN';
import { sqliteTableFindZh as sqliteFind } from '../../src/renderer/locales/sqliteTableFind.zh-CN';
import { sqliteTableBrowseZh as browseText } from '../../src/renderer/locales/sqliteTableBrowse.zh-CN';
import { tableCheckedExportZh as collectText } from '../../src/renderer/locales/tableCheckedExport.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import { navigationMenuItem } from './navigation-menu';
import { gridCellCenter, pasteGridRangeClipboard, readGridMenuClipboard, readGridRangeClipboard } from './grid-cell-range-clipboard';
import { gridRangeCopyZh as rangeCopy } from '../../src/renderer/locales/gridRangeCopy.zh-CN';
import { gridRangeExportZh as rangeExport } from '../../src/renderer/locales/gridRangeExport.zh-CN';
import { resultSqlZh as sqlText } from '../../src/shared/resultSql.zh-CN';
import { gridQuickValueZh as cellCopy } from '../../src/renderer/locales/gridQuickValue.zh-CN';
import { gridRangePasteZh as selectionPaste } from '../../src/renderer/locales/gridRangePaste.zh-CN';
import { sqliteTableRangePasteZh as sqlitePaste } from '../../src/renderer/locales/sqliteTableRangePaste.zh-CN';
import { dataDir, desktop, expect, launchDesktop, page, pageErrors, quitDesktop, test } from './desktop-fixture';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

/** 使用独立应用配置和合成 SQLite 数据，查询与浏览均走正式引擎。 */
async function seed(sql = 'SELECT id, name FROM subject ORDER BY id DESC;', fixtureSql = '') {
  await quitDesktop();
  const id = 'row-jump-offline', databasePath = join(dataDir, 'grid-row-jump.sqlite');
  const database = new DatabaseSync(databasePath);
  try {
    database.exec(`CREATE TABLE subject(id INTEGER PRIMARY KEY, name TEXT);
      WITH RECURSIVE seq(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM seq WHERE i<180)
      INSERT INTO subject SELECT i, '记录 ' || i FROM seq;
      CREATE VIEW subject_view AS SELECT id,name FROM subject ORDER BY id;`);
    if (fixtureSql) database.exec(fixtureSql);
  } finally { database.close(); }
  const require = createRequire(join(process.cwd(), 'package.json'));
  const store = await LocalStore.open(join(dataDir, 'dbark.sqlite'), require.resolve('sql.js/dist/sql-wasm.wasm'), { available: () => false, encrypt: value => value, decrypt: value => value });
  try {
    store.saveConnection({ id, dialect: 'sqlite', name: '行号定位测试', group: '', color: '#123456', sqlite: { filePath: realpathSync(databasePath), readOnly: false, busyTimeoutMs: 1000 } });
    store.saveSettings({ ...store.settings(), pageSize: 100, activeTabId: 'q-jump', tabs: [
      { id: 'q-jump', kind: 'query', title: '查询定位', connectionId: id, sql },
      { id: 't-jump', kind: 'table', title: '表格定位', connectionId: id, database: 'main', table: 'subject' },
      { id: 'v-jump', kind: 'table', title: '视图定位', connectionId: id, database: 'main', table: 'subject_view' },
    ] });
  } finally { store.close(); }
  await launchDesktop();
}

/** 在虚拟行尚未渲染时输入行号，并确认焦点落到真实数据格。 */
async function jump(pane: Locator, row: string, expected: string, open: () => Promise<void>) {
  await expect(pane.getByRole('gridcell', { name: expected, exact: true })).toHaveCount(0);
  await open();
  const input = pane.getByRole('textbox', { name: text.row, exact: true });
  await expect(input).toBeFocused();
  await input.fill('0');
  await expect(pane.getByRole('button', { name: text.go, exact: true })).toBeDisabled();
  await input.fill(row);
  await input.press('Enter');
  await expect(input).toHaveCount(0);
  await expect(pane.getByRole('gridcell', { name: expected, exact: true })).toBeFocused();
}

/** 从 Electron 正式菜单触发当前文档命令，保留窗口现有焦点。 */
async function nativeGoto() {
  await expect.poll(() => desktop.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('sql-goto-line')?.enabled)).toBe(true);
  await desktop.evaluate(({ Menu, BrowserWindow }) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById('sql-goto-line'), windows = BrowserWindow.getAllWindows();
    if (!item?.enabled || windows.length !== 1) throw Error('跳转菜单不可用');
    item.click(item, windows[0], {} as Electron.KeyboardEvent);
  });
}

test('查询结果和 SQLite 可编辑表、只读视图可全选和定位未渲染行且无额外数据任务', async () => {
  await seed();
  const query = page.locator('.query-tab:visible'), table = page.locator('.sqlite-table-tab:visible');
  const tasks = () => page.evaluate(() => window.dbark.invoke('tasks.list', {}));
  const selectAllKey = process.platform === 'darwin' ? 'Meta+Shift+Space' : 'Control+Shift+Space';
  await query.locator('.query-execute-split > button.primary').click();
  await expect(query.getByRole('gridcell', { name: '180', exact: true })).toBeVisible();
  const open = query.getByRole('button', { name: text.open, exact: true });
  await expect(open).toBeEnabled();
  const before = await tasks();
  const firstResult = query.getByRole('gridcell', { name: '180', exact: true });
  await firstResult.click();
  await page.keyboard.press(selectAllKey);
  await expect(firstResult).toBeFocused();
  await expect(firstResult.locator('..').getByRole('checkbox')).toBeChecked();
  await jump(query, '120', '61', () => page.keyboard.press('Control+g'));
  await expect(query.getByRole('gridcell', { name: '61', exact: true }).locator('..').getByRole('checkbox')).toBeChecked();
  await query.getByRole('button', { name: selectionText.clear, exact: true }).click();
  expect(await tasks()).toEqual(before);
  await open.click();
  await query.getByRole('textbox', { name: text.row, exact: true }).press('Escape');
  await expect(open).toBeFocused();
  await query.locator('.monaco-editor').getByRole('textbox').focus();
  await nativeGoto();
  const editorGoto = page.locator('.quick-input-widget:visible input');
  await expect(editorGoto).toBeFocused();
  await expect(query.getByRole('textbox', { name: text.row, exact: true })).toHaveCount(0);
  await editorGoto.press('Escape');

  for (const [tab, title, readOnly] of [['t-jump', '表格定位', 'false'], ['v-jump', '视图定位', 'true']] as const) {
    await page.locator(`[data-workspace-tab-id="${tab}"]`).getByRole('button', { name: title, exact: true }).click();
    await expect(table).toHaveAttribute('data-readonly', readOnly);
    const value = (row: string) => readOnly === 'false' ? 'INTEGER · ' + row : row;
    await expect(table.getByRole('gridcell', { name: value('1'), exact: true })).toBeVisible();
    await expect(table.getByRole('button', { name: text.open, exact: true })).toBeEnabled();
    const originalTasks = await tasks();
    await table.getByRole('gridcell', { name: value('1'), exact: true }).click();
    if (readOnly === 'true') {
      await table.getByRole('button', { name: selectionText.all, exact: true }).click();
      await table.getByRole('gridcell', { name: value('1'), exact: true }).focus();
    } else {
      await page.keyboard.press(selectAllKey);
    }
    await jump(table, '80', value('80'), readOnly === 'false' ? nativeGoto : () => page.keyboard.press('Control+g'));
    const row = table.getByRole('gridcell', { name: value('80'), exact: true }).locator('..').getByRole('checkbox');
    const clear = table.getByRole('button', { name: selectionText.clear, exact: true });
    await expect(row).toBeChecked();
    await clear.click();
    await expect(row).not.toBeChecked();
    await expect(clear).toBeDisabled();
    if (readOnly === 'true') {
      await table.getByRole('button', { name: selectionText.invert, exact: true }).click();
      await expect(row).toBeChecked();
      await clear.click();
      await expect(row).not.toBeChecked();
      await expect(clear).toBeDisabled();
    }
    expect(await tasks()).toEqual(originalTasks);
  }
  expect(pageErrors).toEqual([]);
});

test('查询结果按列查找可区分同名列，切换范围立即清除旧定位', async () => {
  await seed("SELECT id, name AS 同名, CASE WHEN id = 1 THEN '记录 对照' ELSE '无' END AS 同名 FROM subject ORDER BY id DESC;");
  const query = page.locator('.query-tab:visible');
  await query.locator('.query-execute-split > button.primary').click();
  const first = query.getByRole('gridcell', { name: '记录 180', exact: true });
  const firstRow = first.locator('..').getByRole('checkbox');
  await firstRow.check();
  const tasks = () => page.evaluate(() => window.dbark.invoke('tasks.list', {}));
  const before = await tasks();
  await query.getByRole('button', { name: resultFind.open, exact: true }).click();
  const input = query.getByRole('textbox', { name: resultFind.input, exact: true });
  const columns = query.getByRole('combobox', { name: resultFind.columns, exact: true });
  const status = query.locator('.query-result-find-status').getByRole('status');
  await input.fill('记录');
  await expect(status).toHaveText(resultFind.count(181, -1));
  await query.getByRole('checkbox', { name: resultFind.highlightAll, exact: true }).check();
  await expect(first).toHaveClass(/query-result-find-match/);
  await columns.selectOption({ label: resultFind.columnOption('同名', 3) });
  await expect(input).toHaveValue('记录');
  await expect(status).toHaveText(resultFind.count(1, -1));
  await expect(first).not.toHaveClass(/query-result-find-match/);
  await input.press('Enter');
  const last = query.getByRole('gridcell', { name: '记录 对照', exact: true });
  await expect(last).toBeInViewport();
  await expect(last).toHaveClass(/query-result-find-hit/);
  await expect(query.getByText(resultFind.location(179, 2), { exact: true })).toBeVisible();

  await columns.selectOption({ label: resultFind.columnOption('同名', 2) });
  await expect(status).toHaveText(resultFind.count(180, -1));
  await expect(last).not.toHaveClass(/query-result-find-match|query-result-find-hit/);
  await input.press('Enter');
  await expect(first).toBeInViewport();
  await expect(first).toHaveClass(/query-result-find-hit/);
  await expect(firstRow).toBeChecked();
  await columns.selectOption({ label: resultFind.allColumns });
  await expect(status).toHaveText(resultFind.count(181, -1));
  await expect(first).toHaveClass(/query-result-find-match/);
  await expect(first).not.toHaveClass(/query-result-find-hit/);
  expect(await tasks()).toEqual(before);
  expect(pageErrors).toEqual([]);
});

test('查找可标记全部命中并跨屏循环定位，保留勾选且不执行数据任务', async () => {
  await seed();
  const tasks = () => page.evaluate(() => window.dbark.invoke('tasks.list', {}));
  const query = page.locator('.query-tab:visible');
  await query.locator('.query-execute-split > button.primary').click();
  const firstResult = query.getByRole('gridcell', { name: '记录 180', exact: true });
  const resultCheck = firstResult.locator('..').getByRole('checkbox');
  await resultCheck.check();
  const beforeQuery = await tasks();
  await query.getByRole('button', { name: resultFind.open, exact: true }).click();
  const input = query.getByRole('textbox', { name: resultFind.input, exact: true });
  const resultStatus = query.locator('.query-result-find-status').getByRole('status');
  await input.fill('记录');
  await expect(resultStatus).toHaveText(resultFind.count(180, -1));
  await expect(firstResult).not.toHaveClass(/query-result-find-match/);
  const highlight = query.getByRole('checkbox', { name: resultFind.highlightAll, exact: true });
  await highlight.check();
  await expect(firstResult).toHaveClass(/query-result-find-match/);
  await input.press('Shift+F3');
  await expect(input).toBeFocused();
  await expect(resultStatus).toHaveText(resultFind.count(180, 179));
  const lastResult = query.getByRole('gridcell', { name: '记录 1', exact: true });
  await expect(lastResult).toBeInViewport();
  await expect(lastResult).toHaveClass(/query-result-find-hit/);
  await expect(query.getByRole('gridcell', { name: '记录 2', exact: true })).toHaveClass(/query-result-find-match/);
  await lastResult.click();
  await page.keyboard.press('F3');
  await expect(resultStatus).toHaveText(resultFind.count(180, 0));
  // 虚拟网格会保留一个屏外的活动格，实际可见性以视口为准。
  await expect(lastResult).not.toBeInViewport();
  await expect(query.getByRole('grid')).toBeFocused();
  await page.keyboard.press('F3');
  await expect(resultStatus).toHaveText(resultFind.count(180, 1));
  const secondResult = query.getByRole('gridcell', { name: '记录 179', exact: true });
  await expect(secondResult).toHaveClass(/query-result-find-hit/);
  await highlight.uncheck();
  await expect(firstResult).not.toHaveClass(/query-result-find-match/);
  await expect(secondResult).toHaveClass(/query-result-find-hit/);
  await highlight.check();
  await input.fill('无此结果');
  await expect(resultStatus).toHaveText(resultFind.noMatch);
  await expect(query.locator('.query-result-find-match, .query-result-find-hit')).toHaveCount(0);
  await expect(resultCheck).toBeChecked();
  expect(await tasks()).toEqual(beforeQuery);

  await page.locator('[data-workspace-tab-id="t-jump"]').getByRole('button', { name: '表格定位', exact: true }).click();
  const table = page.locator('.sqlite-table-tab:visible');
  const first = table.getByRole('gridcell', { name: 'TEXT · 记录 1', exact: true });
  await expect(first).toBeVisible();
  const beforeTable = await tasks();
  await first.click();
  await page.keyboard.press('Control+f');
  const findPanel = table.getByRole('region', { name: sqliteFind.title, exact: true });
  const tableInput = findPanel.getByRole('textbox', { name: sqliteFind.query, exact: true });
  const tableStatus = findPanel.getByRole('status');
  await tableInput.fill('记录');
  await expect(tableStatus).toHaveText(sqliteFind.count(100, 100, -1));
  const tableHighlight = findPanel.getByRole('checkbox', { name: resultFind.highlightAll, exact: true });
  await expect(first).not.toHaveClass(/query-result-find-match/);
  await tableHighlight.check();
  await expect(first).toHaveClass(/query-result-find-match/);
  await tableInput.press('F3');
  await expect(tableInput).toBeFocused();
  await expect(tableStatus).toHaveText(sqliteFind.count(100, 100, 0));
  await first.click();
  await page.keyboard.press('Shift+F3');
  await expect(tableStatus).toHaveText(sqliteFind.count(100, 100, 99));
  const last = table.getByRole('gridcell', { name: 'TEXT · 记录 100', exact: true });
  await expect(last).toBeFocused();
  await expect(last.locator('.sqlite-find-hit')).toBeVisible();
  await expect(table.getByRole('gridcell', { name: 'TEXT · 记录 99', exact: true })).toHaveClass(/query-result-find-match/);
  await page.keyboard.press('F3');
  await expect(first).toBeFocused();
  await tableHighlight.uncheck();
  await expect(table.locator('.query-result-find-match')).toHaveCount(0);
  await expect(first.locator('.sqlite-find-hit')).toBeVisible();
  await tableHighlight.check();
  await findPanel.getByRole('button', { name: sqliteFind.close, exact: true }).click();
  await expect(table.locator('.query-result-find-match, .sqlite-find-hit')).toHaveCount(0);
  expect(await tasks()).toEqual(beforeTable);
  expect(pageErrors).toEqual([]);
});

test('查询结果和 SQLite 表页可选择并复制矩形区域，保留勾选和原类型', async () => {
  await seed();
  const query = page.locator('.query-tab:visible');
  const tasks = () => page.evaluate(() => window.dbark.invoke('tasks.list', {}));
  const firstResult = query.getByRole('gridcell', { name: '180', exact: true });
  await query.locator('.query-execute-split > button.primary').click();
  const checked = firstResult.locator('..').getByRole('checkbox');
  await checked.check();
  const beforeQuery = await tasks();
  await firstResult.click();
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  await expect(query.getByRole('gridcell', { name: '记录 179', exact: true })).toBeFocused();
  await expect(query.locator('.grid-cell-in-range')).toHaveCount(4);
  let payload = await readGridRangeClipboard(page);
  expect(payload.text).toBe('180\t记录 180\n179\t记录 179');
  expect(JSON.parse(payload.typed).rows).toEqual([['180', '记录 180'], ['179', '记录 179']]);

  await page.keyboard.press('Escape');
  await expect(query.locator('.grid-cell-in-range')).toHaveCount(0);
  expect((await readGridRangeClipboard(page)).text).toBe('180\t记录 180');
  await firstResult.click();
  await query.getByRole('grid').evaluate(grid => { grid.scrollTop = grid.scrollHeight; });
  const last = query.getByRole('gridcell', { name: '记录 1', exact: true });
  await last.click({ modifiers: ['Shift'] });
  await expect(last).toBeFocused();
  payload = await readGridRangeClipboard(page);
  expect(JSON.parse(payload.typed).rows).toEqual(Array.from({ length: 180 }, (_, index) => [String(180 - index), '记录 ' + (180 - index)]));
  expect(await tasks()).toEqual(beforeQuery);

  await page.locator('[data-workspace-tab-id="t-jump"]').getByRole('button', { name: '表格定位', exact: true }).click();
  const table = page.locator('.sqlite-table-tab:visible');
  await table.getByRole('gridcell', { name: 'INTEGER · 1', exact: true }).click();
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  const destination = table.getByRole('gridcell', { name: 'TEXT · 记录 2', exact: true });
  await expect(destination).toBeFocused();
  await expect(table.locator('.grid-cell-in-range')).toHaveCount(4);
  payload = await readGridRangeClipboard(page);
  expect(payload.text).toBe('1\t记录 1\n2\t记录 2');
  expect(JSON.parse(payload.sqlite)).toMatchObject({ columns: ['id', 'name'], rows: [
    [{ kind: 'integer', value: '1' }, { kind: 'text', value: '记录 1' }],
    [{ kind: 'integer', value: '2' }, { kind: 'text', value: '记录 2' }],
  ] });
  await destination.click();
  await expect(table.locator('.grid-cell-in-range')).toHaveCount(0);
  expect((await readGridRangeClipboard(page)).text).toBe('记录 2');
  const start = await gridCellCenter(table.getByRole('gridcell', { name: 'INTEGER · 1', exact: true }));
  const end = await gridCellCenter(destination);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 });
  await expect(table.locator('.grid-cell-in-range')).toHaveCount(4);
  await page.mouse.up();
  await expect(destination).toBeFocused();
  expect((await readGridRangeClipboard(page)).sqlite).toBe(payload.sqlite);
  expect(pageErrors).toEqual([]);
});

test('查询和 SQLite 可从选区内打开复制菜单，表头只进入文本并恢复端点焦点', async () => {
  await seed();
  const query = page.locator('.query-tab:visible');
  await query.locator('.query-execute-split > button.primary').click();
  const first = query.getByRole('gridcell', { name: '180', exact: true });
  const end = query.getByRole('gridcell', { name: '记录 179', exact: true });
  const menu = page.getByRole('menu');
  const copy = (label: string) => readGridMenuClipboard(page, menu.getByRole('menuitem', { name: label, exact: true }));
  await first.click();
  await end.click({ modifiers: ['Shift'] });
  await first.click({ button: 'right' });
  await expect(menu.getByRole('menuitem', { name: cellCopy.copyCell, exact: true })).toBeVisible();
  const queryCopy = await copy(rangeCopy.withHeaders);
  expect(queryCopy.text).toBe('id\tname\n180\t记录 180\n179\t记录 179');
  expect(JSON.parse(queryCopy.typed).rows).toEqual([['180', '记录 180'], ['179', '记录 179']]);
  await expect(end).toBeFocused();
  await first.click({ button: 'right' });
  await expect(menu).toBeVisible();
  await query.getByRole('grid').evaluate(grid => { grid.scrollTop += 96; });
  await expect(menu).toHaveCount(0);
  await query.getByRole('grid').evaluate(grid => { grid.scrollTop = 0; });
  await query.getByRole('gridcell', { name: '178', exact: true }).click({ button: 'right' });
  await expect(menu.getByRole('menuitem', { name: rangeCopy.copy, exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.locator('[data-workspace-tab-id="t-jump"]').getByRole('button', { name: '表格定位', exact: true }).click();
  const table = page.locator('.sqlite-table-tab:visible');
  const sqliteEnd = table.getByRole('gridcell', { name: 'TEXT · 记录 2', exact: true });
  await table.getByRole('gridcell', { name: 'INTEGER · 1', exact: true }).click();
  await sqliteEnd.click({ modifiers: ['Shift'] });
  await page.keyboard.press('Shift+F10');
  const withHeaders = await copy(rangeCopy.withHeaders);
  expect(withHeaders.text).toBe('id\tname\n1\t记录 1\n2\t记录 2');
  expect(JSON.parse(withHeaders.sqlite)).toMatchObject({ columns: ['id', 'name'], rows: [
    [{ kind: 'integer', value: '1' }, { kind: 'text', value: '记录 1' }],
    [{ kind: 'integer', value: '2' }, { kind: 'text', value: '记录 2' }],
  ] });
  await expect(sqliteEnd).toBeFocused();
  await page.keyboard.press('Shift+F10');
  const plain = await copy(rangeCopy.copy);
  expect(plain).toEqual({ ...withHeaders, text: '1\t记录 1\n2\t记录 2' });
  expect(pageErrors).toEqual([]);
});

test('语句目录分别打开查询按原序建立独立标签，超限整批拒绝', async () => {
  const statements = Array.from({ length: 21 }, (_, index) => `SELECT '语句 ${index}; 🚢';`);
  await seed(statements.join('\n'));
  const query = page.locator('.query-tab:visible');
  await (await navigationMenuItem(query, { name: navigationText.entry, exact: true })).click();
  const panel = query.getByRole('region', { name: navigationText.title, exact: true });
  const split = panel.getByRole('button', { name: navigationText.openSeparately, exact: true });
  const master = panel.getByRole('checkbox', { name: navigationText.checkMatches, exact: true });
  const settings = () => page.evaluate(() => window.dbark.invoke('settings.get', {}));
  await expect(panel.getByRole('status')).toHaveText(navigationText.total(21));
  await expect(split).toBeDisabled();
  const before = await settings();
  await master.check();
  await split.click();
  await expect(query.getByText(queryDuplicateZh.batchTooLarge(20), { exact: true })).toBeVisible();
  expect((await settings()).tabs).toEqual(before.tabs);
  await master.uncheck();
  await panel.getByRole('button', { name: navigationText.next, exact: true }).click();
  await panel.getByRole('button', { name: navigationText.next, exact: true }).click();
  await panel.getByRole('checkbox', { name: navigationText.check(20), exact: true }).check();
  await panel.getByRole('textbox', { name: navigationText.search, exact: true }).fill('语句 0;');
  await panel.getByRole('checkbox', { name: navigationText.check(0), exact: true }).check();
  await split.click();
  const titles = [1, 2].map(index => '查询定位' + queryDuplicateZh.splitSuffix(index));
  await expect(page.locator('[data-workspace-tab-id]').getByRole('button', { name: titles[0], exact: true })).toBeVisible();
  await expect.poll(async () => (await settings()).tabs.length).toBe(before.tabs.length + 2);
  const after = await settings(), drafts = after.tabs.slice(-2);
  expect(after.tabs.slice(0, -2)).toEqual(before.tabs);
  expect(after.activeTabId).toBe(drafts[0].id);
  expect(new Set(drafts.map(tab => tab.id)).size).toBe(2);
  for (const [index, body] of [statements[0], statements[20]].entries()) {
    expect(drafts[index]).toMatchObject({ kind: 'query', title: titles[index], connectionId: 'row-jump-offline', sql: body,
      databaseContext: { state: 'known', database: 'main' } });
    expect(drafts[index].sourceBinding).toBeUndefined();
    expect(drafts[index].fileSourceBinding).toBeUndefined();
  }
  expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
  expect(await page.evaluate(() => window.dbark.invoke('queries.list', {}))).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('语句目录跨页勾选全部搜索结果，只取消命中并按原序入库', async () => {
  const statements = Array.from({ length: 16 }, (_, index) =>
    `SELECT '${index === 1 || index === 13 ? '搜索之外' : '批量命中'} ${index}';`);
  await seed(statements.join('\n'));
  const query = page.locator('.query-tab:visible');
  await (await navigationMenuItem(query, { name: navigationText.entry, exact: true })).click();
  const panel = query.getByRole('region', { name: navigationText.title, exact: true });
  const search = panel.getByRole('textbox', { name: navigationText.search, exact: true });
  const master = panel.getByRole('checkbox', { name: navigationText.checkMatches, exact: true });
  const rowCheck = (index: number) => panel.getByRole('checkbox', { name: navigationText.check(index), exact: true });
  const checked = (count: number) => panel.getByText(navigationText.checked(count), { exact: true });
  const outside = panel.getByText(navigationText.checkedOutsideSearch(1), { exact: true });
  await expect(panel.getByRole('status')).toHaveText(navigationText.total(16));
  await rowCheck(1).check();
  await rowCheck(2).check();
  await search.fill('批量命中');
  await expect(panel.getByRole('status')).toHaveText(navigationText.total(14));
  await expect(outside).toBeVisible();
  await expect(master).toHaveAttribute('aria-checked', 'mixed');
  await expect(master).toHaveJSProperty('indeterminate', true);
  await master.press('Space');
  await expect(master).toBeChecked();
  await expect(checked(15)).toBeVisible();
  await panel.getByRole('button', { name: navigationText.next, exact: true }).click();
  await expect(rowCheck(15)).toBeChecked();
  await rowCheck(15).uncheck();
  await expect(master).toHaveAttribute('aria-checked', 'mixed');
  await master.check();
  await expect(rowCheck(15)).toBeChecked();

  const library = panel.getByRole('button', { name: navigationText.library, exact: true });
  const name = panel.getByRole('textbox', { name: navigationText.libraryName, exact: true });
  await library.click();
  await name.fill('过期选择');
  await master.uncheck();
  await expect(name).toHaveCount(0);
  await expect(checked(1)).toBeVisible();
  await expect(outside).toBeVisible();
  await expect(rowCheck(15)).not.toBeChecked();
  await search.fill('无匹配语句');
  await expect(master).toBeDisabled();
  await expect(checked(1)).toBeVisible();

  await search.fill('批量命中');
  await master.check();
  await library.click();
  await name.fill('跨页勾选');
  await panel.getByRole('button', { name: navigationText.librarySave, exact: true }).click();
  await expect(page.getByText(navigationText.librarySaved('跨页勾选'), { exact: true })).toBeVisible();
  const records = await page.evaluate(() => window.dbark.invoke('queries.list', {}));
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ name: '跨页勾选', connectionId: 'row-jump-offline' });
  expect(records[0].sql.replaceAll('\r\n', '\n')).toBe(statements.filter((_, index) => index !== 13).join('\n'));
  await panel.getByRole('button', { name: navigationText.refresh, exact: true }).click();
  await expect(panel.getByRole('status')).toHaveText(navigationText.total(16));
  await expect(checked(0)).toBeVisible();
  await expect(master).not.toBeChecked();
  expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('语句目录按原序保存三种编码，取消、失效和 SQLite 源文件目标均不写入', async () => {
  const first = "SELECT '语句甲;原文';", third = "SELECT '语句丙';";
  await seed(first + "\nSELECT '排除';\n" + third);
  const database = join(dataDir, 'grid-row-jump.sqlite'), before = readFileSync(database);
  const query = page.locator('.query-tab:visible');
  await (await navigationMenuItem(query, { name: navigationText.entry, exact: true })).click();
  const panel = query.getByRole('region', { name: navigationText.title, exact: true });
  const save = panel.getByRole('button', { name: navigationText.saveChecked, exact: true });
  const encoding = panel.getByRole('combobox', { name: navigationText.scriptEncoding, exact: true });
  await expect(panel.getByRole('status')).toHaveText(navigationText.total(3));
  await expect(save).toBeDisabled();
  await panel.getByRole('checkbox', { name: navigationText.check(2), exact: true }).check();
  await panel.getByRole('checkbox', { name: navigationText.check(0), exact: true }).check();
  const library = panel.getByRole('button', { name: navigationText.library, exact: true });
  const name = panel.getByRole('textbox', { name: navigationText.libraryName, exact: true });
  const saveQuery = panel.getByRole('button', { name: navigationText.librarySave, exact: true });
  const settingsBefore = await page.evaluate(() => window.dbark.invoke('settings.get', {}));
  await library.click();
  await expect(name).toBeFocused();
  await name.fill('  ');
  await expect(saveQuery).toBeDisabled();
  await panel.getByRole('button', { name: navigationText.libraryCancel, exact: true }).click();
  expect(await page.evaluate(() => window.dbark.invoke('queries.list', {}))).toEqual([]);
  await page.evaluate(async () => {
    const snapshot = await window.dbark.invoke('queries.organizationGet', {});
    await window.dbark.invoke('queries.organizationApply', { expectedRevision: snapshot.revision, operation: { kind: 'create', name: '语句片段', parentId: null } });
  });
  await library.click();
  await name.fill('  常用语句  ');
  await panel.getByRole('button', { name: groupText.chooseSaveGroup, exact: true }).click();
  await panel.getByRole('combobox', { name: groupText.saveGroup, exact: true }).selectOption({ label: '语句片段' });
  await name.press('Enter');
  await expect(page.getByText(navigationText.librarySaved('常用语句'), { exact: true })).toBeVisible();
  await expect(name).toHaveCount(0);
  const savedQueries = await page.evaluate(() => window.dbark.invoke('queries.list', {}));
  expect(savedQueries).toHaveLength(1);
  expect(savedQueries[0]).toMatchObject({ name: '常用语句', connectionId: 'row-jump-offline', databaseContext: { state: 'known', database: 'main' } });
  expect(savedQueries[0].sql.replaceAll('\r\n', '\n')).toBe(first + '\n' + third);
  expect(await page.evaluate(() => window.dbark.invoke('queries.organizationGet', {}))).toMatchObject({ groups: [{ name: '语句片段', count: 1 }], unfiledCount: 0 });
  expect(await page.evaluate(() => window.dbark.invoke('settings.get', {}))).toMatchObject({ tabs: settingsBefore.tabs, activeTabId: 'q-jump' });
  async function choose(path?: string, delayed = false) {
    // 只替换系统路径选择，保留文件令牌、编码及原子写入的正式 IPC。
    await desktop.evaluate(({ dialog, BrowserWindow }, input) => {
      const original = dialog.showSaveDialog;
      const scope = globalThis as typeof globalThis & { __releaseStatementSave?: () => void };
      dialog.showSaveDialog = (async (...args: unknown[]) => {
        dialog.showSaveDialog = original;
        const options = args.at(-1) as Electron.SaveDialogOptions;
        if (args[0] !== BrowserWindow.getAllWindows()[0] || options.defaultPath !== input.name ||
            !options.filters?.[0]?.extensions.includes('sql')) throw Error('只允许本例勾选语句保存');
        if (input.delayed) await new Promise<void>(resolve => { scope.__releaseStatementSave = resolve; });
        return input.path ? { canceled: false, filePath: input.path } : { canceled: true, filePath: '' };
      }) as typeof original;
    }, { path, delayed, name: navigationText.scriptFile });
  }
  const expected = first + '\n' + third;
  for (const kind of ['utf8', 'utf16le', 'gb18030'] as const) {
    const name = kind + '.sql', output = join(dataDir, name);
    await encoding.selectOption(kind);
    await choose(output);
    await save.click();
    await expect(page.getByText(navigationText.saved(name), { exact: true })).toBeVisible();
    const bytes = readFileSync(output);
    if (kind === 'utf16le') expect([...bytes.subarray(0, 2)]).toEqual([255, 254]);
    const decoded = new TextDecoder(kind === 'utf8' ? 'utf-8' : kind === 'utf16le' ? 'utf-16le' : 'gb18030', { fatal: true }).decode(bytes);
    expect(decoded.replaceAll('\r\n', '\n')).toBe(expected);
  }
  await choose();
  await save.click();
  await expect(save).toBeEnabled();

  await choose(database);
  await save.click();
  await expect(page.getByText('导出目标属于已保存的SQLite数据库或日志文件，请选择其他文件', { exact: true })).toBeVisible();
  expect(readFileSync(database)).toEqual(before);

  const stale = join(dataDir, '过期.sql');
  await choose(stale, true);
  await save.click();
  await expect.poll(() => desktop.evaluate(() => !!(globalThis as typeof globalThis & { __releaseStatementSave?: () => void }).__releaseStatementSave)).toBe(true);
  await expect(save).toBeDisabled();
  await panel.getByRole('button', { name: navigationText.refresh, exact: true }).click();
  await expect(panel.getByRole('status')).toHaveText(navigationText.total(3));
  await desktop.evaluate(() => {
    const scope = globalThis as typeof globalThis & { __releaseStatementSave?: () => void };
    scope.__releaseStatementSave?.();
    delete scope.__releaseStatementSave;
  });
  await expect(page.getByText(navigationText.reasons.stale, { exact: true })).toBeVisible();
  expect(existsSync(stale)).toBe(false);
  expect(readFileSync(database)).toEqual(before);
  await (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: navigationZh.savedQueries, exact: true })).click();
  const savedLibrary = page.getByRole('dialog', { name: zh.activity.text003, exact: true });
  await expect(savedLibrary.getByText('常用语句', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('矩形选区导出仅写所选列和行，SQLite 文件保持不变', async () => {
  await seed();
  const menu = page.getByRole('menuitem', { name: rangeExport.action, exact: true });
  const modal = page.getByRole('dialog', { name: rangeExport.action, exact: true });
  const tasks = () => page.evaluate(() => window.dbark.invoke('tasks.list', {}));
  const database = join(dataDir, 'grid-row-jump.sqlite'), before = readFileSync(database);
  async function exportJson(name: string) {
    await expect(modal.getByText(rangeExport.summary(2, 1), { exact: true })).toBeVisible();
    const format = modal.getByLabel(zh.resultExport.format, { exact: true });
    await expect(format.locator('option[value="sql"]')).toHaveText(sqlText.sqliteFormat);
    await format.selectOption('json');
    const output = join(dataDir, name);
    // 只固定本次保存位置，文件写入继续使用正式导出 IPC。
    await desktop.evaluate(({ dialog, BrowserWindow }, output) => {
      const original = dialog.showSaveDialog;
      dialog.showSaveDialog = (async (...args: unknown[]) => {
        dialog.showSaveDialog = original;
        if (args[0] !== BrowserWindow.getAllWindows()[0] || !(args.at(-1) as Electron.SaveDialogOptions).filters?.[0]?.extensions.includes('json'))
          throw Error('仅允许本例 JSON 保存选择');
        return { canceled: false, filePath: output };
      }) as typeof original;
    }, output);
    await modal.getByRole('button', { name: new RegExp(zh.resultExport.chooseFile) }).click();
    await modal.getByRole('button', { name: zh.resultExport.start, exact: true }).click();
    await modal.getByRole('button', { name: zh.common.done, exact: true }).click();
    return JSON.parse(readFileSync(output, 'utf8'));
  }

  const query = page.locator('.query-tab:visible');
  await query.locator('.query-execute-split > button.primary').click();
  const queryStart = query.getByRole('gridcell', { name: '记录 180', exact: true });
  await queryStart.click();
  await page.keyboard.press('Shift+ArrowDown');
  const beforeQuery = await tasks();
  await queryStart.click({ button: 'right' });
  await menu.click();
  await expect(modal).toBeVisible();
  expect(await tasks()).toEqual(beforeQuery);
  expect(await exportJson('矩形查询.json')).toEqual([{ name: '记录 180' }, { name: '记录 179' }]);

  await page.locator('[data-workspace-tab-id="t-jump"]').getByRole('button', { name: '表格定位', exact: true }).click();
  const table = page.locator('.sqlite-table-tab:visible');
  const tableStart = table.getByRole('gridcell', { name: 'TEXT · 记录 1', exact: true });
  await tableStart.click();
  await page.keyboard.press('Shift+ArrowDown');
  await table.getByRole('button', { name: rangeFill.open, exact: true }).click();
  const fill = table.getByRole('region', { name: rangeFill.open, exact: true });
  await fill.getByRole('textbox', { name: rangeFill.value, exact: true }).fill('待提交');
  await fill.getByRole('button', { name: rangeFill.stage, exact: true }).click();
  const draftStart = table.getByRole('gridcell', { name: 'TEXT · 待提交', exact: true }).first();
  await draftStart.click();
  await page.keyboard.press('Shift+ArrowDown');
  await draftStart.click({ button: 'right' });
  const draftJson = await readGridMenuClipboard(page, page.getByRole('menuitem', { name: rangeCopy.json, exact: true }));
  expect(JSON.parse(draftJson.text)).toEqual([{ name: '待提交' }, { name: '待提交' }]);
  expect(draftJson.typed).toBe('');
  expect(draftJson.sqlite).toBe('');
  await draftStart.click({ button: 'right' });
  await menu.click();
  await modal.getByLabel(zh.resultExport.format, { exact: true }).selectOption('sql');
  await modal.getByLabel(sqlText.sqliteDatabase, { exact: true }).fill('main');
  await modal.getByLabel(sqlText.table, { exact: true }).fill('copied');
  await modal.getByLabel(sqlText.column(1), { exact: true }).fill('name');
  await modal.getByRole('button', { name: sqlText.clipboardPreview, exact: true }).click();
  const script = modal.locator('pre').filter({ hasText: '待提交' });
  await expect(script).toBeVisible();
  const copied = await readGridMenuClipboard(page, modal.getByRole('button', { name: sqlText.clipboardCopy, exact: true }));
  expect(copied.text).toBe(await script.textContent());
  expect(copied.text.match(/VALUES \('待提交'\)/g)).toHaveLength(2);
  expect(await exportJson('矩形草稿.json')).toEqual([{ name: '待提交' }, { name: '待提交' }]);
  expect(readFileSync(database)).toEqual(before);
  expect(pageErrors).toEqual([]);
});

test('SQLite 矩形 INSERT 文件在独立数据库保留原生类型和精度', async () => {
  await seed(`SELECT '排除甲' AS hidden_first, 9223372036854775807 AS n, '000123' AS t,
    1.5 AS r, X'00FF' AS b, NULL AS z, '排除乙' AS hidden_last
    UNION ALL SELECT '排除丙', -9223372036854775808, '000456', 2.5, X'AB', NULL, '排除丁'
    UNION ALL SELECT '范围外', 3, '不要导出', 4.5, X'01', NULL, '范围外';`);
  const source = join(dataDir, 'grid-row-jump.sqlite'), before = readFileSync(source);
  const menu = page.getByRole('menuitem', { name: rangeExport.action, exact: true });
  const modal = page.getByRole('dialog', { name: rangeExport.action, exact: true });
  const query = page.locator('.query-tab:visible');
  await query.locator('.query-execute-split > button.primary').click();
  const first = query.getByRole('gridcell', { name: '9223372036854775807', exact: true });
  await first.click();
  for (let column = 0; column < 4; column++) await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  await first.click({ button: 'right' });
  const csv = await readGridMenuClipboard(page, page.getByRole('menuitem', { name: rangeCopy.csv, exact: true }));
  expect(csv).toEqual({
    text: 'n,t,r,b,z\r\n9223372036854775807,000123,1.5,base64:AP8=,\\N\r\n-9223372036854775808,000456,2.5,base64:qw==,\\N\r\n',
    typed: '', sqlite: '',
  });
  await page.keyboard.press('Shift+F10');
  const json = await readGridMenuClipboard(page, page.getByRole('menuitem', { name: rangeCopy.json, exact: true }));
  expect(JSON.parse(json.text)).toEqual([
    { n: '9223372036854775807', t: '000123', r: '1.5', b: { type: 'binary', base64: 'AP8=' }, z: null },
    { n: '-9223372036854775808', t: '000456', r: '2.5', b: { type: 'binary', base64: 'qw==' }, z: null },
  ]);
  expect(json.typed).toBe('');
  await first.click({ button: 'right' });
  await menu.click();
  await expect(modal.getByText(rangeExport.summary(2, 5), { exact: true })).toBeVisible();
  await modal.getByLabel(zh.resultExport.format, { exact: true }).selectOption('sql');
  await modal.getByLabel(sqlText.sqliteDatabase, { exact: true }).fill('main');
  await modal.getByLabel(sqlText.table, { exact: true }).fill('copied');
  for (const [index, name] of ['n', 't', 'r', 'b', 'z'].entries())
    await modal.getByLabel(sqlText.column(index + 1), { exact: true }).fill(name);
  await modal.getByRole('button', { name: sqlText.preview, exact: true }).click();
  await expect(modal.getByText(sqlText.previewScope(2, 2), { exact: true })).toBeVisible();
  const output = join(dataDir, '矩形.sql');
  // 仅替换一次系统保存位置，保留 Main 的预览、文件授权和原子写入。
  await desktop.evaluate(({ dialog, BrowserWindow }, output) => {
    const original = dialog.showSaveDialog;
    dialog.showSaveDialog = (async (...args: unknown[]) => {
      dialog.showSaveDialog = original;
      if (args[0] !== BrowserWindow.getAllWindows()[0] || !(args.at(-1) as Electron.SaveDialogOptions).filters?.[0]?.extensions.includes('sql'))
        throw Error('仅允许本例 SQL 保存选择');
      return { canceled: false, filePath: output };
    }) as typeof original;
  }, output);
  await modal.getByRole('button', { name: new RegExp(zh.resultExport.chooseFile) }).click();
  const start = modal.getByRole('button', { name: zh.resultExport.start, exact: true });
  await expect(start).toBeDisabled();
  await modal.getByLabel(sqlText.confirmation, { exact: true }).fill('main.copied');
  await modal.getByRole('checkbox', { name: sqlText.acknowledge, exact: true }).check();
  await start.click();
  await modal.getByRole('button', { name: zh.common.done, exact: true }).click();

  const replay = new DatabaseSync(':memory:');
  try {
    replay.exec('CREATE TABLE copied(n,t,r,b,z);');
    replay.exec(readFileSync(output, 'utf8'));
    const rows = replay.prepare(`SELECT typeof(n) AS nt, CAST(n AS TEXT) AS n, typeof(t) AS tt, t,
      typeof(r) AS rt, r, typeof(b) AS bt, hex(b) AS b, typeof(z) AS z FROM copied ORDER BY rowid;`).all();
    expect(rows).toEqual([
      { nt: 'integer', n: '9223372036854775807', tt: 'text', t: '000123', rt: 'real', r: 1.5, bt: 'blob', b: '00FF', z: 'null' },
      { nt: 'integer', n: '-9223372036854775808', tt: 'text', t: '000456', rt: 'real', r: 2.5, bt: 'blob', b: 'AB', z: 'null' },
    ]);
  } finally { replay.close(); }

  await page.locator('[data-workspace-tab-id="v-jump"]').getByRole('button', { name: '视图定位', exact: true }).click();
  const view = page.locator('.sqlite-table-tab:visible');
  const viewStart = view.getByRole('gridcell', { name: '记录 1', exact: true });
  await viewStart.click();
  await page.keyboard.press('Shift+ArrowDown');
  await viewStart.click({ button: 'right' });
  await menu.click();
  await expect(modal.getByLabel(zh.resultExport.format, { exact: true }).locator('option[value="sql"]')).toHaveText(sqlText.sqliteFormat);
  expect(readFileSync(source)).toEqual(before);
  expect(pageErrors).toEqual([]);
});

test('SQLite 矩形可填充同值并一次撤销，包含定位键时拒绝整块填充', async () => {
  await seed();
  await page.locator('[data-workspace-tab-id="t-jump"]').getByRole('button', { name: '表格定位', exact: true }).click();
  const table = page.locator('.sqlite-table-tab:visible');
  const first = table.getByRole('gridcell', { name: 'TEXT · 记录 1', exact: true });
  const second = table.getByRole('gridcell', { name: 'TEXT · 记录 2', exact: true });
  const form = table.getByRole('region', { name: rangeFill.open, exact: true });
  const database = join(dataDir, 'grid-row-jump.sqlite'), before = readFileSync(database);
  const stage = async () => {
    await table.getByRole('button', { name: rangeFill.open, exact: true }).click();
    await form.getByRole('textbox', { name: rangeFill.value, exact: true }).fill('统一草稿');
    await form.getByRole('button', { name: rangeFill.stage, exact: true }).click();
  };
  await table.getByRole('gridcell', { name: 'INTEGER · 1', exact: true }).click();
  await page.keyboard.press('Shift+ArrowRight');
  await stage();
  await expect(form.getByRole('alert')).toContainText(rangeFill.target);
  await expect(first).toBeVisible();
  await first.click();
  await page.keyboard.press('Shift+ArrowDown');
  await stage();
  await expect(table.getByRole('gridcell', { name: 'TEXT · 统一草稿', exact: true })).toHaveCount(2);
  await expect(table.getByRole('gridcell', { name: 'TEXT · 记录 3', exact: true })).toBeVisible();
  await table.getByRole('button', { name: '撤销 SQLite 草稿', exact: true }).click();
  await expect(first).toBeVisible();
  await expect(second).toBeVisible();
  expect(readFileSync(database)).toEqual(before);
  expect(pageErrors).toEqual([]);
});

test('SQLite 可用 Backspace 和菜单将选区设为 NULL，定位键使整块拒绝', async () => {
  await seed();
  const database = join(dataDir, 'grid-row-jump.sqlite'), before = readFileSync(database);
  await page.locator('[data-workspace-tab-id="t-jump"]').getByRole('button', { name: '表格定位', exact: true }).click();
  const table = page.locator('.sqlite-table-tab:visible');
  const id = table.getByRole('gridcell', { name: 'INTEGER · 1', exact: true });
  const first = table.getByRole('gridcell', { name: 'TEXT · 记录 1', exact: true });
  const second = table.getByRole('gridcell', { name: 'TEXT · 记录 2', exact: true });
  const undo = table.getByRole('button', { name: '撤销 SQLite 草稿', exact: true });
  await id.click();
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Delete');
  await expect(table.getByRole('alert')).toContainText(rangeFill.target);
  await expect(first).toBeVisible();
  await expect(second).toBeVisible();
  await expect(undo).toBeDisabled();

  const clear = page.getByRole('menuitem', { name: rangeFill.clear, exact: true });
  for (const command of ['key', 'menu']) {
    await first.click();
    await page.keyboard.press('Shift+ArrowDown');
    if (command === 'key') await page.keyboard.press('Backspace');
    else {
      await first.click({ button: 'right' });
      await clear.click();
    }
    await expect(first).toHaveCount(0);
    await expect(second).toHaveCount(0);
    await id.click();
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');
    const rows = JSON.parse((await readGridRangeClipboard(page)).sqlite).rows;
    expect(rows).toEqual([[{ kind: 'integer', value: '1' }, { kind: 'null' }], [{ kind: 'integer', value: '2' }, { kind: 'null' }]]);
    await undo.click();
    await expect(first).toBeVisible();
    await expect(second).toBeVisible();
  }

  await page.locator('[data-workspace-tab-id="v-jump"]').getByRole('button', { name: '视图定位', exact: true }).click();
  const viewStart = table.getByRole('gridcell', { name: '记录 1', exact: true });
  await viewStart.click();
  await page.keyboard.press('Shift+ArrowDown');
  await viewStart.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: rangeCopy.copy, exact: true })).toBeVisible();
  await expect(clear).toHaveCount(0);
  expect(readFileSync(database)).toEqual(before);
  expect(pageErrors).toEqual([]);
});

test('SQLite 横向填充逐行保留原值，亲和性不兼容时整块拒绝', async () => {
  await seed(undefined, 'ALTER TABLE subject ADD COLUMN mirror TEXT;' +
    'ALTER TABLE subject ADD COLUMN numeric_target INTEGER;' +
    "UPDATE subject SET name='000123', mirror='甲', numeric_target=1 WHERE id=1;" +
    "UPDATE subject SET name=NULL, mirror='乙', numeric_target=2 WHERE id=2;");
  const database = join(dataDir, 'grid-row-jump.sqlite'), before = readFileSync(database);
  await page.locator('[data-workspace-tab-id="t-jump"]').getByRole('button', { name: '表格定位', exact: true }).click();
  const table = page.locator('.sqlite-table-tab:visible');
  const first = table.getByRole('gridcell', { name: 'INTEGER · 1', exact: true }).first().locator('..');
  const header = table.getByRole('columnheader').filter({ has: page.locator('.grid-header-detail-name').filter({ hasText: /^name$/ }) });
  const column = await header.getAttribute('aria-colindex');
  expect(column).toMatch(/^\d+$/);
  const form = table.getByRole('region', { name: rangeFill.open, exact: true });
  const undo = table.getByRole('button', { name: '撤销 SQLite 草稿', exact: true });
  async function select(wide = false) {
    await first.locator('[role="gridcell"][aria-colindex="' + column + '"]').click();
    await page.keyboard.press('Shift+ArrowRight');
    if (wide) await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');
    await expect(table.locator('.grid-cell-in-range')).toHaveCount(wide ? 6 : 4);
    return JSON.parse((await readGridRangeClipboard(page)).sqlite).rows;
  }
  async function stage(direction: 'left' | 'right') {
    await table.getByRole('button', { name: rangeFill.open, exact: true }).click();
    await form.getByRole('combobox', { name: rangeFill.kind, exact: true }).selectOption(direction);
    await form.getByRole('button', { name: rangeFill.stage, exact: true }).click();
  }
  const original = await select();
  expect(original).toEqual([
    [{ kind: 'text', value: '000123' }, { kind: 'text', value: '甲' }],
    [{ kind: 'null' }, { kind: 'text', value: '乙' }],
  ]);
  for (const [direction, index] of [['right', 0], ['left', 1]] as const) {
    await stage(direction);
    expect(await select()).toEqual(original.map((row: unknown[]) => [row[index], row[index]]));
    await undo.click();
    expect(await select()).toEqual(original);
  }
  const wide = await select(true);
  await stage('right');
  await expect(form.getByRole('alert')).toContainText(rangeFill.incompatible('numeric_target'));
  await expect(undo).toBeDisabled();
  expect(await select(true)).toEqual(wide);
  expect(readFileSync(database)).toEqual(before);
  expect(pageErrors).toEqual([]);
});

test('SQLite 向下和向上填充保留整数、文本、字节与 NULL，可整步撤销', async () => {
  await seed(undefined, 'ALTER TABLE subject ADD COLUMN exact_value INTEGER;' +
    'ALTER TABLE subject ADD COLUMN payload BLOB;' +
    "UPDATE subject SET name='000123', exact_value=9223372036854775807, payload=X'00FF' WHERE id=1;" +
    "UPDATE subject SET name=NULL, exact_value=-9223372036854775808, payload=X'AB' WHERE id=3;");
  const database = join(dataDir, 'grid-row-jump.sqlite'), before = readFileSync(database);
  await page.locator('[data-workspace-tab-id="t-jump"]').getByRole('button', { name: '表格定位', exact: true }).click();
  const table = page.locator('.sqlite-table-tab:visible');
  const first = table.getByRole('gridcell', { name: 'INTEGER · 1', exact: true }).locator('..');
  const form = table.getByRole('region', { name: rangeFill.open, exact: true });
  const header = table.getByRole('columnheader').filter({
    has: page.locator('.grid-header-detail-name').filter({ hasText: /^name$/ }),
  });
  const column = await header.getAttribute('aria-colindex');
  expect(column).toMatch(/^\d+$/);
  async function select() {
    await first.locator('[role="gridcell"][aria-colindex="' + column + '"]').click();
    for (const key of ['Right', 'Right', 'Down', 'Down']) await page.keyboard.press('Shift+Arrow' + key);
    await expect(table.locator('.grid-cell-in-range')).toHaveCount(9);
  }
  const read = async () => JSON.parse((await readGridRangeClipboard(page)).sqlite).rows;
  await select();
  const original = await read();
  expect(original[0]).toEqual([{ kind: 'text', value: '000123' }, { kind: 'integer', value: '9223372036854775807' }, { kind: 'blob', value: '00ff' }]);
  expect(original[2]).toEqual([{ kind: 'null' }, { kind: 'integer', value: '-9223372036854775808' }, { kind: 'blob', value: 'ab' }]);
  for (const [direction, index] of [['down', 0], ['up', 2]] as const) {
    await table.getByRole('button', { name: rangeFill.open, exact: true }).click();
    await form.getByRole('combobox', { name: rangeFill.kind, exact: true }).selectOption(direction);
    await expect(form.getByRole('textbox', { name: rangeFill.value, exact: true })).toHaveCount(0);
    await form.getByRole('button', { name: rangeFill.stage, exact: true }).click();
    await select();
    expect(await read()).toEqual(Array(3).fill(original[index]));
    await table.getByRole('button', { name: '撤销 SQLite 草稿', exact: true }).click();
    await select();
    expect(await read()).toEqual(original);
  }
  expect(readFileSync(database)).toEqual(before);
  expect(pageErrors).toEqual([]);
});

test('SQLite 粘贴按矩形左上角预览并暂存，单值可铺满且尺寸不符时拒绝', async () => {
  await seed();
  await page.locator('[data-workspace-tab-id="t-jump"]').getByRole('button', { name: '表格定位', exact: true }).click();
  const table = page.locator('.sqlite-table-tab:visible');
  const first = table.getByRole('gridcell', { name: 'TEXT · 记录 1', exact: true });
  const second = table.getByRole('gridcell', { name: 'TEXT · 记录 2', exact: true });
  const database = join(dataDir, 'grid-row-jump.sqlite'), before = readFileSync(database);
  await first.click();
  await page.keyboard.press('Shift+ArrowDown');
  await expect(second).toBeFocused();
  await pasteGridRangeClipboard(page, '一\t二');
  const modal = page.getByRole('dialog', { name: sqlitePaste.title, exact: true });
  await expect(modal.getByText(selectionPaste.target(2, 1), { exact: true })).toBeVisible();
  await modal.getByRole('button', { name: sqlitePaste.preview, exact: true }).click();
  await expect(modal.getByRole('alert')).toContainText(selectionPaste.shape(2, 1));
  await modal.getByRole('textbox', { name: sqlitePaste.source, exact: true }).fill('铺满');
  await modal.getByRole('button', { name: sqlitePaste.preview, exact: true }).click();
  await expect(modal.getByText(sqlitePaste.changedCounts(2, 1, 2), { exact: true })).toBeVisible();
  await modal.getByRole('button', { name: sqlitePaste.stage, exact: true }).click();
  await expect(table.getByRole('gridcell', { name: 'TEXT · 铺满', exact: true })).toHaveCount(2);
  await expect(table.getByRole('gridcell', { name: 'TEXT · 记录 3', exact: true })).toBeVisible();
  await table.getByRole('button', { name: '撤销 SQLite 草稿', exact: true }).click();
  await expect(first).toBeVisible();
  await expect(second).toBeVisible();
  expect(readFileSync(database)).toEqual(before);
  expect(pageErrors).toEqual([]);
});

test('拖选靠近底边会继续滚动，松开后可复制滚过的完整矩形', async () => {
  await seed();
  const query = page.locator('.query-tab:visible'), grid = query.getByRole('grid');
  await query.locator('.query-execute-split > button.primary').click();
  const first = query.getByRole('gridcell', { name: '180', exact: true });
  await expect(first).toBeVisible();
  const start = await gridCellCenter(first);
  const { x } = await gridCellCenter(query.getByRole('gridcell', { name: '记录 180', exact: true }));
  const y = await grid.evaluate(element => element.getBoundingClientRect().top + element.clientTop + element.clientHeight - 5);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  try {
    await page.mouse.move(x, y, { steps: 10 });
    await expect.poll(() => grid.evaluate(element => element.scrollTop)).toBeGreaterThan(650);
  } finally { await page.mouse.up(); }
  const payload = await readGridRangeClipboard(page);
  const rows = JSON.parse(payload.typed).rows;
  expect(rows.length).toBeGreaterThan(20);
  expect(rows).toEqual(Array.from({ length: rows.length }, (_, index) => [String(180 - index), '记录 ' + (180 - index)]));
  const settled = await grid.evaluate(element => element.scrollTop);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(await grid.evaluate(element => element.scrollTop)).toBe(settled);
  expect(pageErrors).toEqual([]);
});

test('拖选靠近右边缘会横向滚动并复制屏外列', async () => {
  await seed('SELECT ' + Array.from({ length: 24 }, (_, index) => 'id AS col_' + index).join(', ') + ' FROM subject ORDER BY id DESC;');
  const query = page.locator('.query-tab:visible'), grid = query.getByRole('grid');
  await query.locator('.query-execute-split > button.primary').click();
  const first = grid.locator('[aria-rowindex="2"] [role="gridcell"][aria-colindex="2"]');
  await expect(first).toBeVisible();
  const start = await gridCellCenter(first);
  const x = await grid.evaluate(element => element.getBoundingClientRect().left + element.clientLeft + element.clientWidth - 5);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  try {
    await page.mouse.move(x, start.y, { steps: 10 });
    await expect.poll(() => grid.evaluate(element => element.scrollLeft)).toBeGreaterThan(400);
  } finally { await page.mouse.up(); }
  const rows = JSON.parse((await readGridRangeClipboard(page)).typed).rows;
  expect(rows).toHaveLength(1);
  expect(rows[0].length).toBeGreaterThan(6);
  expect(rows[0]).toEqual(Array(rows[0].length).fill('180'));
  expect(pageErrors).toEqual([]);
});

test('SQLite 统一可见列宽保留隐藏列与冻结，并通过原保存流程写入布局', async () => {
  await seed();
  await page.locator('[data-workspace-tab-id="v-jump"]').getByRole('button', { name: '视图定位', exact: true }).click();
  const table = page.locator('.sqlite-table-tab:visible');
  await expect(table.getByRole('gridcell', { name: '1', exact: true })).toBeVisible();
  await (await navigationMenuItem(table.locator('.toolbar'), { name: layoutText.entry, exact: true })).click();
  const modal = page.getByRole('dialog', { name: layoutText.title, exact: true });
  const idWidth = modal.getByRole('spinbutton', { name: tableGridZh.width + ' id', exact: true });
  const nameWidth = modal.getByRole('spinbutton', { name: tableGridZh.width + ' name', exact: true });
  await nameWidth.fill('210');
  await modal.getByRole('checkbox', { name: tableGridZh.visible + ' name', exact: true }).uncheck();
  await modal.getByRole('button', { name: tableGridZh.freezeThrough('id'), exact: true }).click();
  await modal.getByRole('combobox', { name: heightText.label, exact: true }).selectOption('24');
  await modal.getByRole('textbox', { name: batchText.width, exact: true }).fill('240');
  await modal.getByRole('button', { name: batchText.apply, exact: true }).click();
  await expect(idWidth).toHaveValue('240');
  await expect(nameWidth).toHaveValue('210');
  await modal.getByRole('button', { name: batchText.fit, exact: true }).click();
  const fitted = Number(await idWidth.inputValue());
  expect(fitted).toBeGreaterThanOrEqual(64);
  expect(fitted).toBeLessThan(240);
  await expect(nameWidth).toHaveValue('210');
  await modal.getByRole('button', { name: tableGridZh.save, exact: true }).click();
  await expect.poll(async () => (await page.evaluate(() => window.dbark.invoke('sqlite.tableLayout.get', { connectionId: 'row-jump-offline', database: 'main', table: 'subject_view' }))).preferences).toEqual({
    version: 1, frozenThrough: 'id', rowHeight: 24, columns: [
      { name: 'id', hidden: false, width: fitted },
      { name: 'name', hidden: true, width: 210 },
    ],
  });
  await expect.poll(() => table.locator('.results-grid .rdg-row').first().evaluate(element => Math.round(element.getBoundingClientRect().height))).toBe(24);
  expect(pageErrors).toEqual([]);
});

/** 保留真实按钮与复制事件，仅在独立窗口将系统写入换成内存 DataTransfer。 */
async function installClipboardPort() {
  await page.evaluate(() => {
    const previous = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const transfers: DataTransfer[] = [];
    Object.defineProperty(document, 'execCommand', { configurable: true, value(command: string) {
      if (command !== 'copy') throw Error('拒绝本例外的命令');
      const data = new DataTransfer();
      document.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: data }));
      transfers.push(data);
      return true;
    } });
    Object.assign(globalThis, { __headerCopyTest: { transfers, restore() {
      if (previous) Object.defineProperty(document, 'execCommand', previous);
      else Reflect.deleteProperty(document, 'execCommand');
      Reflect.deleteProperty(globalThis, '__headerCopyTest');
    } } });
  });
  return () => page.evaluate(() => (globalThis as typeof globalThis & { __headerCopyTest: { restore(): void } }).__headerCopyTest.restore());
}

test('查询结果可复制尚未渲染的列值，倒序勾选仍沿显示顺序且没有额外数据任务', async () => {
  await seed();
  const query = page.locator('.query-tab:visible');
  const copyColumn = query.getByRole('button', { name: queryResultCopyZh.column, exact: true });
  const cell = (value: number) => query.getByRole('gridcell', { name: String(value), exact: true });
  const tasks = () => page.evaluate(() => window.dbark.invoke('tasks.list', {}));
  await query.locator('.query-execute-split > button.primary').click();
  await expect(cell(180)).toBeVisible();
  await expect(cell(1)).toHaveCount(0);
  const before = await tasks();
  const restore = await installClipboardPort();
  try {
    await expect(copyColumn).toBeDisabled();
    await cell(180).click();
    await copyColumn.click();
    for (const id of [178, 180]) await cell(id).locator('..').getByRole('checkbox').check();
    await cell(180).click();
    await copyColumn.click();
    await query.getByRole('button', { name: selectionText.invert, exact: true }).click();
    await expect(cell(180).locator('..').getByRole('checkbox')).not.toBeChecked();
    await expect(cell(179).locator('..').getByRole('checkbox')).toBeChecked();
    await copyColumn.click();
    const clear = query.getByRole('button', { name: selectionText.clear, exact: true });
    await clear.click();
    await expect(clear).toBeDisabled();
    await expect(cell(179).locator('..').getByRole('checkbox')).not.toBeChecked();
    const result = await page.evaluate(() => (globalThis as typeof globalThis & { __headerCopyTest: { transfers: DataTransfer[] } }).__headerCopyTest.transfers.map(data => ({
      text: data.getData('text/plain'), rows: JSON.parse(data.getData('application/x-dbark-cells')).rows,
    })));
    const values = Array.from({ length: 180 }, (_, index) => String(180 - index));
    const inverted = values.filter(value => value !== '180' && value !== '178');
    expect(result).toEqual([
      { text: values.join('\n'), rows: values.map(value => [value]) },
      { text: '180\n178', rows: [['180'], ['178']] },
      { text: inverted.join('\n'), rows: inverted.map(value => [value]) },
    ]);
    expect(await tasks()).toEqual(before);
    expect(pageErrors).toEqual([]);
  } finally { await restore(); }
});

test('SQLite 可编辑网格支持含列名及当前列复制，内部 MIME 保持原数据行', async () => {
  await seed();
  await page.locator('[data-workspace-tab-id="t-jump"]').getByRole('button', { name: '表格定位', exact: true }).click();
  const pane = page.locator('.sqlite-table-tab:visible');
  const copy = pane.getByRole('button', { name: tableHeaderCopyZh.action, exact: true });
  const copyColumn = pane.getByRole('button', { name: tableHeaderCopyZh.column, exact: true });
  const idCell = (id: number) => pane.getByRole('gridcell', { name: `INTEGER · ${id}`, exact: true });
  await expect(pane).toHaveAttribute('data-readonly', 'false');
  await expect(idCell(1)).toBeVisible();
  const restore = await installClipboardPort();
  try {
    await expect(copyColumn).toBeDisabled();
    await idCell(1).click();
    await copy.click();
    await copyColumn.click();
    for (const id of [2, 1]) {
      await idCell(id).locator('..').getByRole('checkbox', { name: '勾选 SQLite 记录', exact: true }).check();
    }
    await copy.click();
    await idCell(1).click();
    await copyColumn.click();
    await expect(idCell(100)).toHaveCount(0);
    await pane.getByRole('button', { name: selectionText.invert, exact: true }).click();
    await expect(idCell(1).locator('..').getByRole('checkbox')).not.toBeChecked();
    await expect(idCell(3).locator('..').getByRole('checkbox')).toBeChecked();
    await copyColumn.click();
    const clear = pane.getByRole('button', { name: selectionText.clear, exact: true });
    await clear.click();
    await expect(clear).toBeDisabled();
    await expect(idCell(3).locator('..').getByRole('checkbox')).not.toBeChecked();
    const result = await page.evaluate(() => (globalThis as typeof globalThis & { __headerCopyTest: { transfers: DataTransfer[] } }).__headerCopyTest.transfers.map(data => ({
      text: data.getData('text/plain'), typed: JSON.parse(data.getData('application/x-dbark-cells')), sqlite: JSON.parse(data.getData('application/x-dbark-sqlite-cells')),
    })));
    expect(result).toHaveLength(5);
    expect(result[0]).toMatchObject({ text: 'id\n1', typed: { rows: [['1']] }, sqlite: { columns: ['id'], rows: [[{ kind: 'integer', value: '1' }]] } });
    expect(result[1]).toMatchObject({ text: Array.from({ length: 100 }, (_, index) => index + 1).join('\n'), sqlite: { columns: ['id'] } });
    expect(result[1].sqlite.rows).toEqual(Array.from({ length: 100 }, (_, index) => [{ kind: 'integer', value: String(index + 1) }]));
    expect(result[2]).toMatchObject({ text: 'id\tname\n1\t记录 1\n2\t记录 2', typed: { rows: [['1', '记录 1'], ['2', '记录 2']] }, sqlite: { columns: ['id', 'name'] } });
    expect(result[2].sqlite.rows).toHaveLength(2);
    expect(result[3]).toMatchObject({ text: '1\n2', typed: { rows: [['1'], ['2']] }, sqlite: { columns: ['id'], rows: [[{ kind: 'integer', value: '1' }], [{ kind: 'integer', value: '2' }]] } });
    const inverted = Array.from({ length: 98 }, (_, index) => String(index + 3));
    expect(result[4]).toMatchObject({ text: inverted.join('\n'), sqlite: { columns: ['id'], rows: inverted.map(value => [{ kind: 'integer', value }]) } });
    expect(pageErrors).toEqual([]);
  } finally {
    await restore();
  }
});

test('SQLite 跨页收集可替换单页并导出真实文件，刷新清除原收集', async ({}, info) => {
  await seed();
  const openTab = (id: string, name: string) => page.locator(`[data-workspace-tab-id="${id}"]`).getByRole('button', { name, exact: true }).click();
  const pane = page.locator('.sqlite-table-tab:visible'), group = pane.getByRole('group', { name: collectText.region, exact: true });
  const button = (name: string) => group.getByRole('button', { name, exact: true });
  const rowCheck = (name: string) => pane.getByRole('gridcell', { name, exact: true }).locator('..').getByRole('checkbox');
  const tasks = () => page.evaluate(() => window.dbark.invoke('tasks.list', {}));
  const dbPath = join(dataDir, 'grid-row-jump.sqlite'), before = readFileSync(dbPath);

  await openTab('t-jump', '表格定位');
  await rowCheck('INTEGER · 1').check();
  await button(collectText.collect).click();
  await expect(group.getByRole('status')).toHaveText(collectText.summary(1, 1));

  await openTab('v-jump', '视图定位');
  await expect(button(collectText.export)).toBeDisabled();
  await pane.getByRole('button', { name: selectionText.all, exact: true }).click();
  await expect(rowCheck('1')).toBeChecked();
  await pane.getByRole('button', { name: browseText.next, exact: true }).click();
  await expect(rowCheck('101')).not.toBeChecked();
  await rowCheck('101').check();
  await button(collectText.collect).click();
  await expect(group.getByRole('status')).toHaveText(collectText.summary(1, 1));
  await pane.getByRole('button', { name: browseText.first, exact: true }).click();
  await rowCheck('1').check();
  await button(collectText.collect).click();
  await expect(group.getByRole('status')).toHaveText(collectText.summary(2, 2));
  await rowCheck('1').uncheck();
  await rowCheck('2').check();
  await button(collectText.replace).click();
  await expect(group.getByRole('status')).toHaveText(collectText.summary(2, 2));
  await page.screenshot({ path: info.outputPath('SQLite跨页勾选导出.png') });

  const beforeDialog = await tasks();
  const output = join(dataDir, '跨页勾选.json');
  // 仅替换本例保存位置选择，原授权、后台写入和磁盘结果仍走正式路径。
  await desktop.evaluate(({ dialog, BrowserWindow }, output) => {
    const original = dialog.showSaveDialog;
    dialog.showSaveDialog = (async (...args: unknown[]) => {
      dialog.showSaveDialog = original;
      if (args[0] !== BrowserWindow.getAllWindows()[0] || !(args.at(-1) as Electron.SaveDialogOptions).filters?.[0]?.extensions.includes('json'))
        throw Error('仅允许本例 JSON 保存选择');
      return { canceled: false, filePath: output };
    }) as typeof original;
  }, output);
  await button(collectText.export).click();
  const modal = page.getByRole('dialog', { name: collectText.export, exact: true });
  await expect(modal.getByText(collectText.exportRows(2), { exact: true })).toBeVisible();
  await expect(modal.getByRole('gridcell', { name: '记录 1', exact: true })).toHaveCount(0);
  await expect(modal.getByRole('gridcell', { name: '记录 2', exact: true })).toBeVisible();
  await expect(modal.getByRole('gridcell', { name: '记录 101', exact: true })).toBeVisible();
  expect(await tasks()).toEqual(beforeDialog);
  await modal.getByLabel(zh.resultExport.format, { exact: true }).selectOption('json');
  await modal.getByRole('button', { name: new RegExp(zh.resultExport.chooseFile) }).click();
  await modal.getByRole('button', { name: zh.resultExport.start, exact: true }).click();
  await modal.getByRole('button', { name: zh.common.done, exact: true }).click();
  expect(JSON.parse(readFileSync(output, 'utf8'))).toEqual([{ id: '2', name: '记录 2' }, { id: '101', name: '记录 101' }]);
  expect(readFileSync(dbPath)).toEqual(before);

  await rowCheck('2').uncheck();
  await button(collectText.replace).click();
  await expect(group.getByRole('status')).toHaveText(collectText.summary(1, 1));
  await (await navigationMenuItem(pane.locator('.toolbar'), { name: browseText.refresh, exact: true })).click();
  await expect(rowCheck('1')).toBeVisible();
  await expect(button(collectText.export)).toBeDisabled();
  await expect(group.getByRole('status')).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});
