import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test, expect, page, desktop, dataDir, pageErrors } from './desktop-fixture';
import { sidebarContextMenuZh as text } from '../../src/renderer/locales/sidebarContextMenu.zh-CN';
import { objectInformationZh } from '../../src/renderer/locales/objectInformation.zh-CN';
import { queryLayoutZh } from '../../src/renderer/locales/queryLayout.zh-CN';
import { objectIdentifierDragType } from '../../src/renderer/objectIdentifierInsertion';

test('对象名称复制、菜单插入和鼠标拖放均命中原目标', async ({}, info) => {
  const path = join(realpathSync(dataDir), '复制对象名称样本.sqlite');
  const sample = new DatabaseSync(path);
  try { sample.exec('CREATE TABLE "表.含""引号"(id INTEGER, "列.含""引号" TEXT); CREATE TABLE "另一张表"(id INTEGER);'); }
  finally { sample.close(); }
  const original = readFileSync(path);

  // 仅替换一次文件选择，连接和对象读取走生产 IPC。
  await desktop.evaluate(({ dialog, BrowserWindow }, file) => {
    const open = dialog.showOpenDialog;
    dialog.showOpenDialog = (async (...args: unknown[]) => {
      dialog.showOpenDialog = open;
      const windows = BrowserWindow.getAllWindows(), options = args.at(-1) as Electron.OpenDialogOptions;
      if (windows.length !== 1 || args[0] !== windows[0] || !options.filters?.[0]?.extensions.includes('sqlite')) {
        throw Error('只允许测试窗口选取本例的 SQLite 文件');
      }
      return { canceled: false, filePaths: [file] };
    }) as typeof open;
  }, path);
  await page.evaluate(async () => {
    const id = 'identifier-copy-sqlite';
    const file = await window.dbark.invoke('files.choose', { purpose: 'sqlite-database', sqliteConnectionId: id });
    if (!file) throw Error('未选中本例文件');
    await window.dbark.invoke('connections.save', {
      id, name: '对象复制样本', dialect: 'sqlite', group: '', color: '#51bda5',
      sqlite: { fileToken: file.token, readOnly: true, busyTimeoutMs: 1000 },
    });
    const settings = await window.dbark.invoke('settings.get', {});
    const base = { connectionId: id, database: 'main' };
    await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'objects', tabs: [
      { ...base, id: 'draft', kind: 'query', title: '保留的草稿', sql: 'SELECT * FROM placeholder' },
      { ...base, id: 'objects', kind: 'objects', title: '对象浏览', objectCategory: 'table' },
    ] });
  });
  // Monaco 全局 API 只观察真实模型、光标及撤销结果，编辑仍通过实际键盘和菜单。
  await page.addInitScript(() => { self.MonacoEnvironment = { ...self.MonacoEnvironment, globalAPI: true }; });
  await page.reload();
  const name = '表.含"引号';
  const browser = page.locator('.object-browser:visible');
  const browserRow = (target: string) => browser.locator('.object-list-row .tree-label')
    .filter({ has: page.getByText(target, { exact: true }) });
  const center = browserRow(name);
  await expect(center).toBeVisible();
  const sidebar = page.locator('.sidebar');
  await sidebar.locator('.connection-row .tree-label').filter({ hasText: '对象复制样本' }).click();
  await sidebar.locator('.database-row .tree-label').filter({ hasText: /^main$/ }).click();
  const tree = sidebar.locator('.object-row .tree-label').filter({ hasText: name });
  await expect(tree).toBeVisible();
  await expect(center).toBeVisible();

  // 保留生产复制事件与 DataTransfer，只把系统剪贴板替换为本窗口的内存记录。
  await page.evaluate(() => {
    const original = document.execCommand;
    document.execCommand = function(command, ...args) {
      if (command !== 'copy') return original.call(this, command, ...args);
      const data = new DataTransfer();
      document.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }));
      document.body.dataset.testClipboard = JSON.stringify(Object.fromEntries(data.types.map(type => [type, data.getData(type)])));
      return true;
    };
  });
  const menu = (target: string) => page.getByRole('menu', { name: text.title(target), exact: true });
  const clipboard = (value: string) => expect(page.locator('body')).toHaveAttribute('data-test-clipboard', JSON.stringify({ 'text/plain': value }));
  const state = () => page.evaluate(() => window.dbark.invoke('settings.get', {}));
  const before = await state();

  await tree.click({ button: 'right' });
  await expect(menu(name).getByRole('menuitem', { name: text.copyQualifiedName, exact: true })).toBeVisible();
  await expect(menu(name).getByRole('menuitem', { name: text.insertQualifiedName, exact: true })).toHaveCount(0);
  await menu(name).screenshot({ path: info.outputPath('object-identifier-copy.png') });
  await menu(name).getByRole('menuitem', { name: text.copyName, exact: true }).click();
  await clipboard(name);
  await expect(menu(name)).toBeHidden();
  await expect(tree).toBeFocused();

  const other = browserRow('另一张表');
  await other.focus();
  await page.keyboard.press('Shift+F10');
  await menu('另一张表').getByRole('menuitem', { name: text.copyQualifiedName, exact: true }).press('Enter');
  await clipboard('"main"."另一张表"');
  await center.click({ button: 'right' });
  await menu(name).getByRole('menuitem', { name: text.copyQualifiedName, exact: true }).click();
  await clipboard('"main"."表.含""引号"');
  await expect(center).toBeFocused();

  // 通过列表过滤移除原行，旧菜单不能将复制转交给仍可见的另一张表。
  await center.click({ button: 'right' });
  await expect(menu(name)).toBeVisible();
  await browser.locator('.object-browser-filter input').fill('另一张表');
  await expect(center).toHaveCount(0);
  await expect(menu(name)).toBeHidden();
  await expect(other).toBeVisible();
  await clipboard('"main"."表.含""引号"');

  const after = await state();
  expect(after.tabs).toEqual(before.tabs);
  expect(after.activeTabId).toBe(before.activeTabId);

  await page.locator('[data-workspace-tab-id="draft"]').click();
  const query = page.locator('.query-tab:visible'), box = query.locator('.monaco-editor').getByRole('textbox');
  const originalSql = 'SELECT * FROM placeholder', qualified = '"main"."表.含""引号"';
  const insertedSql = 'SELECT * FROM ' + qualified;
  const insert = () => menu(name).getByRole('menuitem', { name: text.insertQualifiedName, exact: true });
  const observe = () => page.evaluate(() => {
    const editors = (window as Window & { monaco?: typeof import('monaco-editor') }).monaco?.editor.getEditors()
      .filter(editor => editor.getContainerDomNode().closest('.query-tab') && editor.getContainerDomNode().getClientRects().length > 0);
    if (editors?.length !== 1) throw Error('找不到唯一的可见查询编辑器');
    const model = editors[0].getModel(), selection = editors[0].getSelection();
    if (!model || !selection) throw Error('查询编辑器缺少正文或选区');
    return { sql: model.getValue(), start: model.getOffsetAt(selection.getStartPosition()), end: model.getOffsetAt(selection.getEndPosition()) };
  });
  await expect(box).toBeVisible();
  await box.focus();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End');
  for (const _ of 'placeholder') await page.keyboard.press('Shift+ArrowLeft');
  await expect.poll(observe).toEqual({ sql: originalSql, start: 'SELECT * FROM '.length, end: originalSql.length });
  await tree.click({ button: 'right' });
  await expect(insert()).toBeVisible();
  await page.screenshot({ path: info.outputPath('object-identifier-insertion.png') });
  await insert().click();
  await expect(box).toBeFocused();
  await expect.poll(observe).toEqual({ sql: insertedSql, start: insertedSql.length, end: insertedSql.length });
  await page.keyboard.press('ControlOrMeta+Z');
  await expect.poll(async () => (await observe()).sql).toBe(originalSql);

  await tree.focus();
  await page.keyboard.press('Shift+F10');
  await expect(insert()).toBeVisible();
  await box.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(menu(name)).toBeHidden();
  const caret = await observe();
  expect(caret.sql).toBe(originalSql);
  expect(caret.start).toBe(caret.end);
  await tree.focus();
  await page.keyboard.press('Shift+F10');
  await insert().press('Enter');
  const atCaret = originalSql.slice(0, caret.start) + qualified + originalSql.slice(caret.start);
  await expect.poll(observe).toEqual({ sql: atCaret, start: caret.start + qualified.length, end: caret.start + qualified.length });
  await page.keyboard.press('ControlOrMeta+Z');
  await expect.poll(async () => (await observe()).sql).toBe(originalSql);

  // 真实拖放命中原选区之外的行尾，已有选中的占位文字必须保留。
  const joinSuffix = ' CROSS JOIN ', dragBaseSql = originalSql + joinSuffix;
  await box.focus();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End');
  await page.keyboard.insertText(joinSuffix);
  await expect.poll(async () => (await observe()).sql).toBe(dragBaseSql);
  for (const _ of joinSuffix) await page.keyboard.press('ArrowLeft');
  for (const _ of 'placeholder') await page.keyboard.press('Shift+ArrowLeft');
  await expect.poll(observe).toEqual({ sql: dragBaseSql, start: 'SELECT * FROM '.length, end: originalSql.length });
  const editor = query.locator('.monaco-editor');
  const endPoint = () => editor.evaluate(node => {
    const editor = (window as Window & { monaco?: typeof import('monaco-editor') }).monaco?.editor.getEditors()
      .find(instance => instance.getDomNode() === node);
    const end = editor?.getModel()?.getFullModelRange().getEndPosition();
    const visible = end && editor?.getScrolledVisiblePosition(end);
    if (!visible || !end) throw Error('查询行尾不可见');
    const rect = node.getBoundingClientRect(), x = visible.left + 2, y = visible.top + visible.height / 2;
    const hit = editor?.getTargetAtClientPoint(rect.left + x, rect.top + y)?.position;
    if (hit?.lineNumber !== end.lineNumber || hit.column !== end.column) throw Error('落点未命中查询行尾');
    return { x, y, clientX: rect.left + x, clientY: rect.top + y };
  });
  const dropPoint = await endPoint();
  await tree.dragTo(editor, { targetPosition: { x: dropPoint.x, y: dropPoint.y } });
  const droppedSql = dragBaseSql + qualified;
  await expect.poll(observe).toEqual({ sql: droppedSql, start: droppedSql.length, end: droppedSql.length });
  await expect(box).toBeFocused();
  await page.screenshot({ path: info.outputPath('object-identifier-drag.png') });
  await page.keyboard.press('ControlOrMeta+Z');
  await expect.poll(async () => (await observe()).sql).toBe(dragBaseSql);

  // 手动控制两次事件之间的目录变化，验证晚到的原标记与伪造标记都无法修改正文。
  const data = await page.evaluateHandle(() => new DataTransfer());
  try {
    await tree.dispatchEvent('dragstart', { dataTransfer: data });
    expect(await data.evaluate((transfer, type) => ({ types: [...transfer.types], token: transfer.getData(type) }), objectIdentifierDragType))
      .toEqual({ types: [objectIdentifierDragType], token: expect.stringMatching(/^[a-f\d-]{36}$/) });
    const filter = sidebar.locator('.search-box input');
    await filter.fill('另一张表');
    await expect(tree).toHaveCount(0);
    await editor.dispatchEvent('drop', { dataTransfer: data, clientX: dropPoint.clientX, clientY: dropPoint.clientY });
    expect((await observe()).sql).toBe(dragBaseSql);
    await filter.fill('');
    await expect(tree).toBeVisible();
    await data.evaluate((transfer, type) => transfer.setData(type, '伪造对象'), objectIdentifierDragType);
    await editor.dispatchEvent('drop', { dataTransfer: data, clientX: dropPoint.clientX, clientY: dropPoint.clientY });
    expect((await observe()).sql).toBe(dragBaseSql);
  } finally { await data.dispose(); }
  await box.focus();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End');
  for (const _ of joinSuffix) await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.press('Backspace');
  await expect.poll(async () => (await observe()).sql).toBe(originalSql);

  const t = objectInformationZh;
  const pane = page.getByRole('complementary', { name: t.title, exact: true });
  const identifiers = pane.getByRole('region', { name: t.identifiers, exact: true });
  await sidebar.locator('.database-row .tree-label').filter({ hasText: /^main$/ }).click({ button: 'right' });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: t.title, exact: true }).click();
  await pane.getByRole('button', { name: t.identifiers, exact: true }).click();
  const selectPlaceholder = async () => {
    await box.focus();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End');
    for (const _ of 'placeholder') await page.keyboard.press('Shift+ArrowLeft');
    await expect.poll(observe).toEqual({ sql: originalSql, start: 'SELECT * FROM '.length, end: originalSql.length });
  };
  await selectPlaceholder();
  await identifiers.getByText(name, { exact: true }).dblclick();
  await expect(box).toBeFocused();
  await expect.poll(observe).toEqual({ sql: insertedSql, start: insertedSql.length, end: insertedSql.length });
  await page.keyboard.press('ControlOrMeta+Z');
  await expect.poll(async () => (await observe()).sql).toBe(originalSql);

  await tree.click({ button: 'right' });
  await page.keyboard.press('Escape');
  const field = '列.含"引号', fieldSql = '"列.含""引号"';
  const fieldName = identifiers.getByText(field, { exact: true });
  const fieldButton = identifiers.getByRole('button', { name: t.insertIdentifier(field), exact: true });
  await expect(fieldButton).toBeVisible();
  await pane.getByRole('button', { name: t.expand, exact: true }).click();
  await expect(fieldButton).toHaveCount(0);
  await pane.getByRole('button', { name: t.restoreSize, exact: true }).click();
  await selectPlaceholder();
  await fieldButton.press('Enter');
  const fieldInserted = 'SELECT * FROM ' + fieldSql;
  await expect.poll(observe).toEqual({ sql: fieldInserted, start: fieldInserted.length, end: fieldInserted.length });
  await expect(box).toBeFocused();
  await page.screenshot({ path: info.outputPath('信息窗格字段插入.png') });
  await page.keyboard.press('ControlOrMeta+Z');
  await expect.poll(async () => (await observe()).sql).toBe(originalSql);

  await selectPlaceholder();
  const fieldDrop = await endPoint();
  await fieldName.dragTo(editor, { targetPosition: { x: fieldDrop.x, y: fieldDrop.y } });
  const fieldDropped = originalSql + fieldSql;
  await expect.poll(observe).toEqual({ sql: fieldDropped, start: fieldDropped.length, end: fieldDropped.length });
  await expect(box).toBeFocused();
  await page.screenshot({ path: info.outputPath('信息窗格字段拖放.png') });
  await page.keyboard.press('ControlOrMeta+Z');
  await expect.poll(async () => (await observe()).sql).toBe(originalSql);
  const pendingField = await page.evaluateHandle(() => new DataTransfer());
  try {
    await fieldName.dispatchEvent('dragstart', { dataTransfer: pendingField });
    expect(await pendingField.evaluate((transfer, type) => ({ types: [...transfer.types], token: transfer.getData(type) }), objectIdentifierDragType))
      .toEqual({ types: [objectIdentifierDragType], token: expect.stringMatching(/^[a-f\d-]{36}$/) });
    await identifiers.getByRole('searchbox', { name: t.searchFieldIdentifiers, exact: true }).fill('找不到的字段');
    await expect(fieldName).toHaveCount(0);
    await editor.dispatchEvent('drop', { dataTransfer: pendingField, clientX: fieldDrop.clientX, clientY: fieldDrop.clientY });
    expect((await observe()).sql).toBe(originalSql);
  } finally { await pendingField.dispose(); }
  await pane.getByRole('button', { name: t.close, exact: true }).click();

  await query.getByRole('button', { name: queryLayoutZh.placement, exact: true }).click();
  await page.getByRole('menu', { name: queryLayoutZh.placement, exact: true })
    .getByRole('menuitem', { name: queryLayoutZh.results, exact: true }).click();
  await expect(box).toBeHidden();
  await tree.click({ button: 'right' });
  await expect(menu(name).getByRole('menuitem', { name: text.copyQualifiedName, exact: true })).toBeVisible();
  await expect(insert()).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await state()).tabs.find(tab => tab.id === 'draft')?.sql).toBe(originalSql);
  expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
  expect(readFileSync(path)).toEqual(original);
  expect(pageErrors).toEqual([]);
});
