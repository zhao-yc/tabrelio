import { createRequire } from 'node:module';
import { join } from 'node:path';
import { realpathSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { LocalStore } from '../../src/main/storage';
import { queryResultColumnsZh as text } from '../../src/renderer/locales/queryResultColumns.zh-CN';
import { gridColumnWidthBatchZh as batchText } from '../../src/renderer/locales/gridColumnWidthBatch.zh-CN';
import { gridRowHeightZh as heightText } from '../../src/renderer/locales/gridRowHeight.zh-CN';
import { gridHeaderMenuZh } from '../../src/renderer/locales/gridHeaderMenu.zh-CN';
import { dataDir, expect, launchDesktop, page, pageErrors, quitDesktop, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

test('SQLite 查询结果拖动和精确输入共享列宽，恢复默认后再次执行仍用默认值', async () => {
  const id = 'offline-result-widths';
  const sql = "WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<61) " +
    "SELECT '短文本' AS 重复列, CASE WHEN n=61 THEN '这是一段较长的内容，用于测量同名列不同的显示宽度，最后一行在屏幕之外' ELSE '短文本' END AS 重复列 FROM seq";
  // 只为独立临时配置建立一个本地只读连接，查询仍经过正式 SQLite 引擎。
  await quitDesktop();
  const databasePath = join(dataDir, 'result-widths.sqlite');
  new DatabaseSync(databasePath).close();
  const require = createRequire(join(process.cwd(), 'package.json'));
  const store = await LocalStore.open(join(dataDir, 'dbark.sqlite'), require.resolve('sql.js/dist/sql-wasm.wasm'), { available: () => false, encrypt: value => value, decrypt: value => value });
  try {
    store.saveConnection({ id, dialect: 'sqlite', name: '列宽离线测试', group: '', color: '#123456', sqlite: { filePath: realpathSync(databasePath), readOnly: true, busyTimeoutMs: 1000 } });
    store.saveSettings({ ...store.settings(), activeTabId: id, tabs: [{ id, kind: 'query', title: '列宽离线查询', connectionId: id, sql }] });
  } finally { store.close(); }
  await launchDesktop();

  const query = page.locator('.query-tab:visible');
  const headers = query.getByRole('columnheader').filter({ hasText: '重复列' });
  const modal = page.getByRole('dialog', { name: text.title, exact: true });
  const apply = modal.getByRole('button', { name: text.apply, exact: true });
  const first = modal.getByRole('textbox', { name: text.width(1), exact: true });
  const second = modal.getByRole('textbox', { name: text.width(2), exact: true });
  const width = (index: number) => headers.nth(index).evaluate(header => Math.round(header.getBoundingClientRect().width));
  const open = async () => (await navigationMenuItem(query, { name: text.open, exact: true })).click();
  const execute = async () => query.locator('.query-execute-split > button.primary').click();
  const dataRow = query.locator('.results-grid .rdg-row').first();
  const rowHeight = () => dataRow.evaluate(element => Math.round(element.getBoundingClientRect().height));
  await execute();
  await expect(headers).toHaveCount(2);
  await expect.poll(() => width(0)).toBe(170);
  await expect.poll(rowHeight).toBe(32);
  await open();
  await first.fill('280');
  await second.fill('63');
  await expect(apply).toBeDisabled();
  await second.fill('210');
  await apply.click();
  await expect.poll(() => width(0)).toBe(280);
  await expect.poll(() => width(1)).toBe(210);

  const handle = await headers.nth(0).locator('.rdg-resize-handle').boundingBox();
  if (!handle) throw Error('缺少首列原生拖动手柄');
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  try { await page.mouse.move(handle.x + handle.width / 2 + 60, handle.y + handle.height / 2, { steps: 5 }); }
  finally { await page.mouse.up(); }
  await expect.poll(() => width(0)).toBe(340);
  await open();
  await expect(first).toHaveValue('340');
  await expect(second).toHaveValue('210');
  await modal.getByRole('button', { name: batchText.fitColumn(1), exact: true }).click();
  const singleWidth = Number(await first.inputValue());
  expect(singleWidth).toBeGreaterThanOrEqual(64);
  expect(singleWidth).toBeLessThan(340);
  await expect(second).toHaveValue('210');
  await expect.poll(() => width(0)).toBe(340);
  await test.info().attach('查询结果同名列单列适宽草稿', { body: await page.screenshot(), contentType: 'image/png' });
  await modal.getByRole('button', { name: batchText.fit, exact: true }).click();
  const fitted = [Number(await first.inputValue()), Number(await second.inputValue())];
  expect(fitted[0]).toBe(singleWidth);
  expect(fitted[0]).toBeGreaterThanOrEqual(64);
  expect(fitted[1]).toBeGreaterThan(fitted[0]);
  expect(fitted[1]).toBeLessThanOrEqual(640);
  await modal.getByRole('combobox', { name: heightText.label, exact: true }).selectOption('56');
  await apply.click();
  await expect.poll(() => width(0)).toBe(fitted[0]);
  await expect.poll(() => width(1)).toBe(fitted[1]);
  await expect.poll(rowHeight).toBe(56);
  await expect(dataRow.locator('.grid-row-preview').first()).toHaveCSS('white-space', 'pre-wrap');
  await open();
  const batch = modal.getByRole('textbox', { name: batchText.width, exact: true });
  const batchApply = modal.getByRole('button', { name: batchText.apply, exact: true });
  await batch.fill('2001');
  await expect(batchApply).toBeDisabled();
  await batch.fill('240');
  await batchApply.click();
  await expect(first).toHaveValue('240');
  await expect(second).toHaveValue('240');
  await second.fill('210');
  const visibleSecond = modal.getByRole('checkbox', { name: text.visible(2), exact: true });
  await visibleSecond.uncheck();
  await batch.fill('290');
  await batchApply.click();
  await expect(first).toHaveValue('290');
  await expect(second).toHaveValue('210');
  await visibleSecond.check();
  await apply.click();
  await expect.poll(() => width(0)).toBe(290);
  await expect.poll(() => width(1)).toBe(210);

  await open();
  await first.fill('250');
  await second.fill('1400');
  await apply.click();
  await expect.poll(() => width(1)).toBe(1400);
  const grid = query.getByRole('grid');
  const menu = page.getByRole('menu', { name: gridHeaderMenuZh.menu, exact: true });
  const openHeaderMenu = async () => {
    const header = headers.first();
    await header.scrollIntoViewIfNeeded();
    // 菜单会响应滚动关闭，先等定位带来的滚动事件派发完。
    await header.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await header.click({ button: 'right' });
  };
  await openHeaderMenu();
  await menu.getByRole('menuitem', { name: gridHeaderMenuZh.freeze, exact: true }).click();
  await expect(headers.first()).toHaveClass(/rdg-cell-frozen-start/);
  const frozenLeft = () => headers.first().evaluate(element => element.getBoundingClientRect().left);
  const initialLeft = await frozenLeft();
  await grid.evaluate(element => { element.scrollLeft = 350; });
  await expect.poll(() => grid.evaluate(element => element.scrollLeft)).toBeGreaterThan(100);
  await expect.poll(async () => Math.abs(await frozenLeft() - initialLeft)).toBeLessThan(2);
  await test.info().attach('表头冻结后横向滚动', { body: await page.screenshot(), contentType: 'image/png' });
  await openHeaderMenu();
  await menu.getByRole('menuitem', { name: gridHeaderMenuZh.unfreeze, exact: true }).click();
  await expect(headers.first()).not.toHaveClass(/rdg-cell-frozen-start/);
  await grid.evaluate(element => { element.scrollLeft = 0; });

  await open();
  await modal.getByRole('button', { name: text.resetWidths, exact: true }).click();
  await apply.click();
  await expect.poll(() => width(0)).toBe(170);
  await expect.poll(() => width(1)).toBe(170);

  // 最长文本在最后一行，双击仍按当前结果采样，并且只改变第二个同名列。
  await expect(query.getByRole('gridcell').filter({ hasText: '最后一行在屏幕之外' })).toHaveCount(0);
  await headers.nth(1).locator('.rdg-resize-handle').dblclick();
  await expect.poll(() => width(1)).toBe(fitted[1]);
  await expect.poll(() => width(0)).toBe(170);
  await test.info().attach('双击分隔线按未渲染行适宽', { body: await page.screenshot(), contentType: 'image/png' });

  await open();
  await first.fill('290');
  await apply.click();
  await expect.poll(() => width(0)).toBe(290);
  await execute();
  await expect.poll(() => width(0)).toBe(170);
  await expect.poll(rowHeight).toBe(32);
  const history = await page.evaluate(() => window.dbark.invoke('history.list', {}));
  expect(history.map(entry => entry.sql)).toEqual([sql, sql]);
  expect(pageErrors).toEqual([]);
});
