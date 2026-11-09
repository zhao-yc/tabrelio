import { createRequire } from 'node:module';
import { join } from 'node:path';
import { readFileSync, realpathSync } from 'node:fs';
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
import { sqliteTableFindZh as sqliteFind } from '../../src/renderer/locales/sqliteTableFind.zh-CN';
import { sqliteTableBrowseZh as browseText } from '../../src/renderer/locales/sqliteTableBrowse.zh-CN';
import { tableCheckedExportZh as collectText } from '../../src/renderer/locales/tableCheckedExport.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import { navigationMenuItem } from './navigation-menu';
import { gridCellCenter, readGridRangeClipboard } from './grid-cell-range-clipboard';
import { dataDir, desktop, expect, launchDesktop, page, pageErrors, quitDesktop, test } from './desktop-fixture';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

/** 使用独立应用配置和合成 SQLite 数据，查询与浏览均走正式引擎。 */
async function seed(sql = 'SELECT id, name FROM subject ORDER BY id DESC;') {
  await quitDesktop();
  const id = 'row-jump-offline', databasePath = join(dataDir, 'grid-row-jump.sqlite');
  const database = new DatabaseSync(databasePath);
  try {
    database.exec(`CREATE TABLE subject(id INTEGER PRIMARY KEY, name TEXT);
      WITH RECURSIVE seq(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM seq WHERE i<180)
      INSERT INTO subject SELECT i, '记录 ' || i FROM seq;
      CREATE VIEW subject_view AS SELECT id,name FROM subject ORDER BY id;`);
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
