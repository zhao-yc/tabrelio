import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dataDir, desktop, expect, page, pageErrors, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';
import { queryResultSnapshotViewerZh as text } from '../../src/renderer/locales/queryResultSnapshotViewer.zh-CN';
import { queryResultFindZh as find } from '../../src/renderer/locales/queryResultFind.zh-CN';
import { queryResultSortZh as sort } from '../../src/renderer/locales/queryResultSort.zh-CN';
import { queryResultFilterZh as filter } from '../../src/renderer/locales/queryResultFilter.zh-CN';
import { queryResultComparisonZh as comparisonText } from '../../src/renderer/locales/queryResultComparison.zh-CN';
import { gridRangeExportZh as rangeText } from '../../src/renderer/locales/gridRangeExport.zh-CN';
import { queryResultHistoryZh as historyText } from '../../src/renderer/locales/queryResultHistory.zh-CN';
import { queryResultSnapshotFileMessages as filesText } from '../../src/main/queryResultSnapshotFiles';
import { uiCommandLabels } from '../../src/shared/uiCommands.zh-CN';
import { formatText, zh } from '../../src/renderer/locales/zh-CN';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.skip(process.env.DBARK_SNAPSHOT_EXPORT_NATIVE !== '1', '仅在独立离线文件验收运行');

test('零连接工作台对快照排序并按显示、选区和勾选范围导出真实文件', async ({}, info) => {
  expect(process.env.DBARK_INTEGRATION_ENABLED).toBe('0');
  const source = join(dataDir, '离线源.dbark-result.json');
  const csv = join(dataDir, '匹配行.csv'), json = join(dataDir, '勾选行.json');
  const rectangle = join(dataDir, '选区.json');
  const right = join(dataDir, '对比输入.dbark-result.json'), report = join(dataDir, '对比报告.json');
  const wire = JSON.stringify({
    kind: 'dbark.query-result-snapshot', version: 1, result: {
      columns: [{ key: 'label', name: '内容', type: 'TEXT' }, { key: 'amount', name: '金额', type: 'DECIMAL' }, { key: 'payload', name: '字节', type: 'BLOB' }],
      rows: [
        { label: '匹配甲', amount: '9007199254740993.0002', payload: null },
        { label: '勾选行', amount: '9007199254740993', payload: { type: 'binary', base64: 'AP8=' } },
        { label: '匹配乙', amount: '9007199254740993.0001', payload: null },
        { label: '匹配丙', amount: '9007199254740993.0002', payload: null },
        { label: '范围外', amount: '9007199254740993.0003', payload: null },
      ],
      truncated: true, elapsedMs: { type: 'number', text: '1' }, statement: 'SELECT secret_sql_marker;',
    },
  });
  await writeFile(source, wire, { flag: 'wx' });
  const snapshot = JSON.parse(wire);
  const rightWire = JSON.stringify({ ...snapshot, result: { ...snapshot.result, rows: [
    { ...snapshot.result.rows[0], amount: '9007199254740993.0004', payload: { type: 'binary', base64: '' } },
    ...snapshot.result.rows.filter((_: unknown, index: number) => index !== 0 && index !== 2),
    ...Array.from({ length: 52 }, (_, index) => ({ label: '新增 ' + index, amount: '9007199254740993.0005', payload: null })),
  ] } });
  await writeFile(right, rightWire, { flag: 'wx' });

  // 只代答文件对话框。两层白名单允许真实文件 worker，拒绝任何数据库会话或其它引擎命令。
  const observer = await desktop.evaluateHandle(({ ipcMain, dialog, BrowserWindow, utilityProcess }, paths) => {
    const [window, extra] = BrowserWindow.getAllWindows(), contents = window?.webContents;
    const handlers = (ipcMain as any)._invokeHandlers, original = handlers.get('dbark:request');
    if (!contents || extra || typeof original !== 'function') throw Error('测试窗口归属无效');
    const frame = contents.mainFrame;
    const state = { dialogs: [] as string[], engine: [] as string[], requests: [] as string[], denied: [] as string[] };
    const reject = (command: string): never => { state.denied.push(command); throw Error('离线导出收到未授权请求 ' + command); };
    const allowed = new Set(['settings.get', 'settings.save', 'connections.list', 'tasks.list', 'history.list', 'app.info',
      'app.runtimeInfo', 'app.setDirty', 'app.menuState', 'workbench.get', 'workbench.save', 'workbench.protocolReady', 'workbench.protocolTake',
      'workbench.protocolFinish', 'resultSnapshotFiles.open', 'files.choose', 'files.exportResult']);
    handlers.set('dbark:request', (event: Electron.IpcMainInvokeEvent, payload: { command: string; input: any }) => {
      if (event.sender !== contents || event.senderFrame !== frame || !allowed.has(payload.command)) reject(payload.command);
      if (payload.command === 'files.choose' && (payload.input.purpose !== 'export' || !['csv', 'json'].includes(payload.input.format))) reject(payload.command);
      state.requests.push(payload.command);
      return original(event, payload);
    });
    dialog.showOpenDialog = (async (parent: Electron.BrowserWindow, options: Electron.OpenDialogOptions) => {
      const compare = state.dialogs.length === 4;
      if (parent !== window || options.title !== paths.openTitle || state.dialogs.length && !compare) reject('showOpenDialog');
      state.dialogs.push(compare ? 'compare' : 'open');
      return { canceled: false, filePaths: [compare ? paths.right : paths.source] };
    }) as typeof dialog.showOpenDialog;
    dialog.showSaveDialog = (async (parent: Electron.BrowserWindow, options: Electron.SaveDialogOptions) => {
      const slot = state.dialogs.length;
      const target = slot === 1 ? 'csv' : slot === 2 ? 'rectangle' : slot === 3 ? 'json' : 'report';
      const extension = target === 'csv' ? '.csv' : '.json';
      if (parent !== window || options.title !== '导出文件' || slot < 1 || slot > 5 ||
          (target === 'report' ? slot !== 5 || options.defaultPath !== paths.reportName : !options.defaultPath?.endsWith(extension))) reject('showSaveDialog');
      state.dialogs.push(target);
      return { canceled: false, filePath: paths[target] };
    }) as typeof dialog.showSaveDialog;
    const fork = utilityProcess.fork.bind(utilityProcess);
    utilityProcess.fork = ((path: string, args: string[], options: Electron.ForkOptions) => {
      if (!path.endsWith('worker.cjs') || options.serviceName !== 'DBArk 数据库引擎') reject('utilityProcess.fork');
      const child = fork(path, args, options);
      const post = child.postMessage.bind(child);
      child.postMessage = ((message: { command: string; input: { connectionId?: string; sessionId?: string; filePath?: string } }) => {
        if (message.command !== '__shutdown' && (message.command !== 'files.exportResult' || message.input.connectionId ||
            message.input.sessionId || ![paths.csv, paths.json, paths.rectangle, paths.report].includes(message.input.filePath ?? ''))) reject(message.command);
        state.engine.push(message.command);
        post(message);
      }) as typeof child.postMessage;
      return child;
    }) as typeof utilityProcess.fork;
    return state;
  }, { source, csv, json, rectangle, right, report, openTitle: filesText.choose, reportName: comparisonText.reportName });

  try {
    const settings = () => page.evaluate(() => window.dbark.invoke('settings.get', {}));
    const baseline = await settings();
    expect(baseline.tabs).toEqual([]);
    await (await navigationMenuItem(page, { name: uiCommandLabels['result-snapshot'], exact: true })).click();
    const viewer = page.getByRole('dialog', { name: text.title, exact: true });
    await viewer.getByRole('button', { name: text.choose, exact: true }).click();
    await expect(viewer.getByText(text.opened('离线源.dbark-result.json'), { exact: true })).toBeVisible();
    const shown = viewer.getByRole('button', { name: text.exportShown, exact: true });
    const checked = viewer.getByRole('button', { name: text.exportChecked, exact: true });
    const undo = viewer.getByRole('button', { name: historyText.undo, exact: true });
    const redo = viewer.getByRole('button', { name: historyText.redo, exact: true });
    await expect(checked).toBeDisabled();
    await expect(undo).toBeDisabled();
    await expect(redo).toBeDisabled();
    await viewer.getByRole('button', { name: find.open, exact: true }).click();
    await viewer.getByRole('textbox', { name: find.input, exact: true }).fill('匹配');
    await viewer.getByRole('button', { name: find.showMatchingRows, exact: true }).click();
    const matched = viewer.getByText(find.matchViewCount(3, 5), { exact: true });
    await expect(matched).toBeVisible();
    const labels = viewer.locator('.results-grid [role="gridcell"][aria-colindex="2"]');
    const amount = viewer.getByRole('columnheader').filter({ hasText: /^金额/ });
    await amount.click();
    await expect(labels).toHaveText(['匹配乙', '匹配甲', '匹配丙']);
    await expect(amount.getByLabel(sort.ascending)).toBeVisible();

    const openSort = viewer.getByRole('button', { name: sort.panelTitle, exact: true });
    const panel = page.getByRole('dialog', { name: sort.panelTitle, exact: true });
    await openSort.click();
    await panel.getByLabel(sort.panelDirection(1), { exact: true }).selectOption('DESC');
    await page.keyboard.press('Escape');
    await expect(openSort).toBeFocused();
    await expect(labels).toHaveText(['匹配乙', '匹配甲', '匹配丙']);
    await openSort.click();
    await panel.getByLabel(sort.panelDirection(1), { exact: true }).selectOption('DESC');
    await panel.getByLabel(sort.panelNulls(1), { exact: true }).selectOption('LAST');
    await panel.getByRole('button', { name: sort.panelAdd, exact: true }).click();
    await expect(panel.getByLabel(sort.panelField(2), { exact: true })).toHaveValue('label');
    await info.attach('离线快照多列排序', { body: await page.screenshot(), contentType: 'image/png' });
    await panel.getByRole('button', { name: sort.panelApply, exact: true }).click();
    await expect(labels).toHaveText(['匹配丙', '匹配甲', '匹配乙']);
    await expect(matched).toBeVisible();
    await expect(amount.getByLabel(sort.descending)).toBeVisible();

    const filterButton = viewer.getByRole('button', { name: filter.open, exact: true });
    const filterDialog = page.getByRole('dialog', { name: filter.title, exact: true });
    await filterButton.click();
    await filterDialog.getByRole('button', { name: filter.add, exact: true }).click();
    const condition = (index: number) => filterDialog.locator(`[aria-label="${filter.condition(index)}"]`);
    await condition(1).getByLabel(filter.column + ' 1', { exact: true }).selectOption('amount');
    await condition(1).getByLabel(filter.operator + ' 1', { exact: true }).selectOption('gte');
    const lower = condition(1).getByRole('textbox', { name: filter.input + ' 1', exact: true });
    await lower.fill('无效数字');
    await filterDialog.getByRole('button', { name: filter.apply, exact: true }).click();
    await expect(filterDialog.getByRole('alert')).toBeVisible();
    await expect(lower).toHaveValue('无效数字');
    await lower.fill('9007199254740993.0002');
    await filterDialog.getByRole('button', { name: filter.addGroup, exact: true }).click();
    await filterDialog.getByRole('button', { name: filter.addInGroup('1'), exact: true }).click();
    for (const [index, label] of [[2, '匹配甲'], [3, '匹配丙']] as const) {
      await condition(index).getByLabel(filter.operator + ' ' + index, { exact: true }).selectOption('eq');
      await condition(index).getByRole('textbox', { name: filter.input + ' ' + index, exact: true }).fill(label);
    }
    await filterDialog.getByRole('button', { name: filter.apply, exact: true }).click();
    await expect(filterButton).toBeFocused();
    await expect(labels).toHaveText(['匹配丙', '匹配甲']);
    const filtered = viewer.getByText(filter.counts(5, 2), { exact: true });
    await expect(filtered).toBeVisible();
    await expect(viewer.getByText(find.matchViewCount(2, 2), { exact: true })).toBeVisible();
    await info.attach('离线快照组合筛选', { body: await page.screenshot(), contentType: 'image/png' });
    await filterButton.click();
    await expect(lower).toHaveValue('9007199254740993.0002');
    await lower.fill('0');
    await lower.press('Escape');
    await expect(filterButton).toBeFocused();
    await expect(filtered).toBeVisible();

    // 已取消的草稿不入历史。撤销筛选和排序都沿用同一组查找命中的原行。
    const undoKeys = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
    const redoKeys = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';
    await labels.first().click();
    await page.keyboard.press(undoKeys);
    await expect(labels).toHaveText(['匹配丙', '匹配甲', '匹配乙']);
    await expect(matched).toBeVisible();
    await undo.click();
    await expect(labels).toHaveText(['匹配乙', '匹配甲', '匹配丙']);
    await expect(amount.getByLabel(sort.ascending)).toBeVisible();
    await expect(redo).toBeEnabled();
    await info.attach('离线快照撤销排序和筛选', { body: await page.screenshot(), contentType: 'image/png' });
    await redo.click();
    await expect(labels).toHaveText(['匹配丙', '匹配甲', '匹配乙']);
    await labels.first().click();
    await page.keyboard.press(redoKeys);
    await expect(labels).toHaveText(['匹配丙', '匹配甲']);
    await expect(filtered).toBeVisible();
    await expect(redo).toBeDisabled();

    const save = async (title: string, format: 'csv' | 'json', rows: number, filename: string) => {
      const dialog = page.getByRole('dialog', { name: title, exact: true });
      await expect(dialog).toBeVisible();
      await expect(viewer).toBeHidden();
      const selector = dialog.getByLabel(zh.resultExport.format, { exact: true });
      await expect(selector.locator('option[value="sql"]')).toHaveCount(0);
      await selector.selectOption(format);
      await dialog.getByRole('button', { name: new RegExp(zh.resultExport.chooseFile) }).click();
      await expect(dialog.getByText(filename, { exact: true })).toBeVisible();
      if (format === 'csv') await info.attach('离线快照导出预览', { body: await page.screenshot(), contentType: 'image/png' });
      await dialog.getByRole('button', { name: zh.resultExport.start, exact: true }).click();
      await expect(dialog.getByText(formatText(zh.resultExport.completed, rows), { exact: true })).toBeVisible();
      await dialog.getByRole('button', { name: zh.common.done, exact: true }).click();
      await expect(viewer).toBeVisible();
    };
    await shown.click();
    await save(text.exportShown, 'csv', 2, '匹配行.csv');
    await expect(shown).toBeFocused();
    expect((await readFile(csv, 'utf8')).replace(/^\uFEFF/, '')).toBe(
      '内容,金额,字节\r\n匹配丙,9007199254740993.0002,\\N\r\n匹配甲,9007199254740993.0002,\\N\r\n');
    await labels.first().click();
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+F10');
    await viewer.getByRole('menuitem', { name: rangeText.action, exact: true }).click();
    const rectangleDialog = page.getByRole('dialog', { name: rangeText.action, exact: true });
    await expect(rectangleDialog.getByText(rangeText.summary(2, 2), { exact: true })).toBeVisible();
    await expect(rectangleDialog.getByRole('columnheader').filter({ hasText: '字节' })).toHaveCount(0);
    await info.attach('离线快照矩形导出', { body: await page.screenshot(), contentType: 'image/png' });
    await save(rangeText.action, 'json', 2, '选区.json');
    await expect(labels.last().locator('..').locator('[role="gridcell"][aria-colindex="3"]')).toBeFocused();
    expect(JSON.parse(await readFile(rectangle, 'utf8'))).toEqual([
      { 内容: '匹配丙', 金额: '9007199254740993.0002' },
      { 内容: '匹配甲', 金额: '9007199254740993.0002' },
    ]);
    await expect(filtered).toBeVisible();
    await viewer.getByRole('button', { name: filter.clear, exact: true }).click();
    await expect(matched).toBeVisible();
    await expect(labels).toHaveText(['匹配丙', '匹配甲', '匹配乙']);
    await viewer.getByRole('button', { name: find.clearMatchView, exact: true }).click();
    await expect(labels).toHaveText(['范围外', '匹配丙', '匹配甲', '匹配乙', '勾选行']);
    const rowCheck = viewer.getByRole('row').filter({ hasText: '勾选行' }).getByRole('checkbox');
    await rowCheck.check();
    await checked.click();
    await save(text.exportChecked, 'json', 1, '勾选行.json');
    await expect(checked).toBeFocused();
    await expect(rowCheck).toBeChecked();
    expect(JSON.parse(await readFile(json, 'utf8'))).toEqual([{ 内容: '勾选行', 金额: '9007199254740993', 字节: { type: 'binary', base64: 'AP8=' } }]);
    await viewer.getByRole('button', { name: sort.clear, exact: true }).click();
    await expect(labels).toHaveText(['匹配甲', '勾选行', '匹配乙', '匹配丙', '范围外']);
    await expect(checked).toBeDisabled();
    await viewer.getByRole('button', { name: text.compare, exact: true }).click();
    const comparison = page.getByRole('dialog', { name: comparisonText.fileTitle, exact: true });
    await comparison.getByRole('checkbox', { name: comparisonText.key('label'), exact: true }).check();
    await comparison.getByRole('button', { name: comparisonText.start, exact: true }).click();
    await expect(comparison.getByLabel(comparisonText.added, { exact: true })).toHaveText('52');
    const range = comparison.getByLabel(comparisonText.filter, { exact: true });
    await range.selectOption('all');
    await range.selectOption('differences');
    await expect(comparison.getByRole('table', { name: comparisonText.rows, exact: true }).locator('tbody tr')).toHaveCount(50);
    await comparison.getByRole('button', { name: comparisonText.exportReport, exact: true }).click();
    const reportSaved = comparison.getByText(comparisonText.reportSaved(162), { exact: true });
    await expect(reportSaved).toBeVisible();
    const entries = JSON.parse(await readFile(report, 'utf8'));
    expect(entries).toHaveLength(162);
    expect(entries.some((row: { kind: string }) => row.kind === 'equal')).toBe(false);
    expect(entries).toContainEqual(expect.objectContaining({ kind: 'changed', columnKey: 'amount', leftRow: 1, rightRow: 1,
      leftValue: '9007199254740993.0002', rightValue: '9007199254740993.0004', changed: true, leftTruncated: true }));
    expect(entries).toContainEqual(expect.objectContaining({ kind: 'changed', columnKey: 'payload', leftValue: null, rightValue: { type: 'binary', base64: '' } }));
    expect(entries).toContainEqual(expect.objectContaining({ kind: 'removed', columnKey: 'label', matchKey: true, leftRow: 3, rightRow: null, rightValue: null }));
    expect(entries).toContainEqual(expect.objectContaining({ kind: 'added', columnKey: 'label', matchKey: true, leftRow: null, rightValue: '新增 51' }));
    await reportSaved.scrollIntoViewIfNeeded();
    await info.attach('离线快照差异报告', { body: await page.screenshot(), contentType: 'image/png' });
    await comparison.getByRole('button', { name: comparisonText.close, exact: true }).last().click();
    await expect(viewer).toBeVisible();
    expect(await readFile(right, 'utf8')).toBe(rightWire);
    expect(await readFile(source, 'utf8')).toBe(wire);
    expect(await settings()).toEqual(baseline);
    expect(await page.evaluate(() => window.dbark.invoke('connections.list', {}))).toEqual([]);
    expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
    expect(pageErrors).toEqual([]);
    const audit = await observer.jsonValue();
    expect(audit.denied).toEqual([]);
    expect(audit.dialogs).toEqual(['open', 'csv', 'rectangle', 'json', 'compare', 'report']);
    expect(audit.engine).toEqual(Array(4).fill('files.exportResult'));
    expect(audit.requests.filter(command => command === 'files.exportResult')).toHaveLength(4);
  } finally {
    await observer.dispose();
  }
});
