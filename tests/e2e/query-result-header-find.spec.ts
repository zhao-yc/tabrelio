import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, desktop, page, dataDir, pageErrors } from './desktop-fixture';
import { createQueryResultSnapshot, encodeQueryResultSnapshot } from '../../src/shared/queryResultSnapshot';
import { gridHeaderMenuZh as headerText } from '../../src/renderer/locales/gridHeaderMenu.zh-CN';
import { queryResultFindZh as findText } from '../../src/renderer/locales/queryResultFind.zh-CN';
import { queryResultSnapshotViewerZh as snapshotText } from '../../src/renderer/locales/queryResultSnapshotViewer.zh-CN';
import { queryResultColumnsZh as columnText } from '../../src/renderer/locales/queryResultColumns.zh-CN';
import { gridRowHeightZh as rowHeightText } from '../../src/renderer/locales/gridRowHeight.zh-CN';
import { navigationMenuItem } from './navigation-menu';
import { gridRangeCopyZh as rangeCopy } from '../../src/renderer/locales/gridRangeCopy.zh-CN';
import { readGridMenuClipboard } from './grid-cell-range-clipboard';
import { decodeClipboard } from '../../src/renderer/gridClipboard';

test('离线快照列标题查找按原列键定位重名列，重排后仍只查命中的列', async ({}, info) => {
  const name = '同名列离线样本.dbark-result.json', path = join(realpathSync(dataDir), name);
  const bytes = encodeQueryResultSnapshot(createQueryResultSnapshot({
    columns: [{ key: 'left', name: '重复列', type: 'TEXT' }, { key: 'right', name: '重复列', type: 'TEXT' },
      { key: 'empty', name: '', type: 'TEXT' }, { key: 'tab', name: '列\t名', type: 'TEXT' }],
    rows: [{ left: '左侧内容', right: '目标记录', empty: '首行空列名', tab: '首行末格' },
      { left: '其它左值', right: '其它右值', empty: '末行空列名', tab: '末行末格' }],
    truncated: false, elapsedMs: 0, statement: 'SELECT 1;',
  }));
  writeFileSync(path, bytes);
  // 仅固定本例文件选择路径，快照读取和解析仍经过生产入口。
  await desktop.evaluate(({ dialog, BrowserWindow }, file) => {
    const open = dialog.showOpenDialog;
    dialog.showOpenDialog = (async (...args: unknown[]) => {
      dialog.showOpenDialog = open;
      const windows = BrowserWindow.getAllWindows(), options = args.at(-1) as Electron.OpenDialogOptions;
      if (windows.length !== 1 || args[0] !== windows[0] || options.title !== '打开结果快照') throw Error('选择超出本例快照窗口');
      return { canceled: false, filePaths: [file] };
    }) as typeof open;
  }, path);
  await expect.poll(() => desktop.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('result-snapshot')?.enabled)).toBe(true);
  await desktop.evaluate(({ Menu, BrowserWindow }) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById('result-snapshot'), windows = BrowserWindow.getAllWindows();
    if (!item?.enabled || windows.length !== 1) throw Error('当前窗口缺少快照命令');
    item.click(item, windows[0], {} as Electron.KeyboardEvent);
  });
  const viewer = page.getByRole('dialog', { name: snapshotText.title, exact: true });
  await viewer.getByRole('button', { name: snapshotText.choose, exact: true }).click();
  await expect(viewer.getByText(snapshotText.opened(name), { exact: true })).toBeVisible();
  const grid = viewer.getByRole('grid'), headers = grid.getByRole('columnheader').filter({ hasText: /^重复列/ });
  const search = viewer.getByRole('textbox', { name: findText.input, exact: true });
  const field = viewer.getByRole('combobox', { name: findText.columns, exact: true });
  const status = viewer.locator('.query-result-find-status').getByRole('status');
  const selectedRow = grid.getByRole('row').filter({ hasText: '其它左值' }).getByRole('checkbox');
  async function findFrom(index: number, keyboard = false) {
    const header = headers.nth(index);
    await header.scrollIntoViewIfNeeded();
    if (keyboard) { await header.focus(); await page.keyboard.press('Shift+F10'); }
    else await header.click({ button: 'right' });
    await viewer.getByRole('menu', { name: headerText.menu, exact: true }).getByRole('menuitem', { name: headerText.findColumn, exact: true }).click();
    await expect(search).toBeFocused();
  }
  await expect(headers).toHaveCount(2);
  await selectedRow.check();
  await findFrom(0);
  await expect(field).toHaveValue('column:left');
  await search.fill('目标记录');
  await expect(status).toHaveText(findText.noMatch);
  await findFrom(1, true);
  await expect(field).toHaveValue('column:right');
  await expect(search).toHaveValue('目标记录');
  await expect(status).toHaveText(findText.count(1, -1));
  await search.press('Enter');
  await expect(grid.getByRole('gridcell', { name: '目标记录', exact: true })).toHaveClass(/query-result-find-hit/);
  await expect(selectedRow).toBeChecked();
  await search.press('Escape');
  await expect(viewer).toBeVisible();

  await (await navigationMenuItem(viewer, { name: columnText.open, exact: true })).click();
  const layout = page.getByRole('dialog', { name: columnText.title, exact: true });
  await layout.getByRole('button', { name: columnText.up(2), exact: true }).click();
  await layout.getByRole('button', { name: columnText.apply, exact: true }).click();
  await expect(layout).toBeHidden();
  await findFrom(0);
  await expect(field).toHaveValue('column:right');
  await expect(field.locator('option:checked')).toHaveText(findText.columnOption('重复列', 1));
  await search.fill('目标记录');
  await expect(status).toHaveText(findText.count(1, -1));
  await viewer.screenshot({ path: info.outputPath('query-result-header-find.png') });
  await selectedRow.check();
  await headers.nth(0).click({ button: 'right' });
  const fromHeader = await readGridMenuClipboard(page, viewer.getByRole('menuitem', { name: headerText.copyColumnDataWithName, exact: true }));
  expect(fromHeader.text).toBe('重复列\n其它右值');
  expect(decodeClipboard(fromHeader.typed, fromHeader.text)).toEqual([['其它右值']]);
  await selectedRow.press('Shift+F10');
  const fromRow = await readGridMenuClipboard(page, viewer.getByRole('menuitem', { name: headerText.copyRowData, exact: true }));
  expect(decodeClipboard(fromRow.typed, fromRow.text)).toEqual([['其它右值', '其它左值', '末行空列名', '末行末格']]);
  await expect(selectedRow).toBeChecked();
  const start = grid.getByRole('gridcell', { name: '末行末格', exact: true });
  const end = grid.getByRole('gridcell', { name: '目标记录', exact: true });
  await start.click();
  await end.click({ modifiers: ['Shift'] });
  await expect(selectedRow).toBeChecked();
  await start.click({ button: 'right' });
  const onlyNames = viewer.getByRole('menuitem', { name: rangeCopy.namesOnly, exact: true });
  await expect(onlyNames).toBeVisible();
  await viewer.screenshot({ path: info.outputPath('离线选区列名.png') });
  expect(await readGridMenuClipboard(page, onlyNames)).toEqual({ text: '重复列\t重复列\t\t"列\t名"', typed: '', sqlite: '' });
  await expect(end).toBeFocused();
  await expect(selectedRow).toBeChecked();
  const inRange = grid.locator('.grid-cell-in-range');
  await expect(inRange).toHaveCount(8);
  await page.keyboard.press('ControlOrMeta+a');
  await expect(inRange).toHaveCount(0);
  await search.focus();
  await page.keyboard.press('ControlOrMeta+a');
  expect(await search.evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd])).toEqual([0, 4]);
  await expect(inRange).toHaveCount(0);
  await start.click();
  await page.keyboard.press('ControlOrMeta+a');
  await expect(inRange).toHaveCount(8);
  await expect(start).toBeFocused();
  await expect(selectedRow).toBeChecked();
  await viewer.screenshot({ path: info.outputPath('离线全部可见单元格.png') });
  const otherWidth = (await headers.nth(1).boundingBox())?.width;
  await headers.nth(0).click({ button: 'right' });
  await viewer.getByRole('menuitem', { name: headerText.setWidth, exact: true }).click();
  const width = viewer.getByRole('dialog', { name: headerText.setWidth, exact: true });
  const widthField = width.getByRole('textbox', { name: headerText.width, exact: true });
  await expect(widthField).toBeFocused();
  await widthField.fill('281');
  await viewer.screenshot({ path: info.outputPath('离线列标题设置列宽.png') });
  await widthField.press('Enter');
  await expect(width).toBeHidden();
  await expect.poll(async () => (await headers.nth(0).boundingBox())?.width).toBe(281);
  expect((await headers.nth(1).boundingBox())?.width).toBe(otherWidth);
  await expect(selectedRow).toBeChecked();
  await (await navigationMenuItem(viewer, { name: columnText.open, exact: true })).click();
  const exact = layout.getByRole('textbox', { name: rowHeightText.exact, exact: true });
  await exact.fill('120');
  await layout.getByRole('button', { name: rowHeightText.apply, exact: true }).click();
  await layout.getByRole('button', { name: columnText.apply, exact: true }).click();
  await expect(layout).toBeHidden();
  await expect(grid).toHaveClass(/grid-row-height-120/);
  await expect.poll(async () => (await grid.getByRole('row').nth(1).boundingBox())?.height).toBe(120);
  await expect.poll(async () => (await headers.nth(0).boundingBox())?.width).toBe(281);
  await viewer.screenshot({ path: info.outputPath('离线自定义行高.png') });
  const firstRowHeader = grid.getByRole('row').nth(1).getByRole('checkbox');
  await firstRowHeader.check();
  await firstRowHeader.click({ button: 'right' });
  await viewer.getByRole('menuitem', { name: headerText.setHeight, exact: true }).click();
  const height = viewer.getByRole('dialog', { name: headerText.setHeight, exact: true });
  const heightInput = height.getByRole('textbox', { name: headerText.height, exact: true });
  await expect(heightInput).toHaveValue('120');
  await heightInput.fill('88');
  await viewer.screenshot({ path: info.outputPath('离线行标题设置行高.png') });
  await heightInput.press('Enter');
  await expect(height).toBeHidden();
  await expect.poll(async () => (await grid.getByRole('row').nth(1).boundingBox())?.height).toBe(88);
  await expect(firstRowHeader).toBeChecked();
  await expect.poll(async () => (await headers.nth(0).boundingBox())?.width).toBe(281);
  expect(readFileSync(path, 'utf8')).toBe(bytes);
  expect(await page.evaluate(() => window.dbark.invoke('connections.list', {}))).toEqual([]);
  expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
  expect(await page.evaluate(() => window.dbark.invoke('tasks.list', {}))).toEqual([]);
  expect(pageErrors).toEqual([]);
});
