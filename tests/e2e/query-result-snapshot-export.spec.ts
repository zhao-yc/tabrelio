import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dataDir, desktop, expect, page, pageErrors, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';
import { queryResultSnapshotViewerZh as text } from '../../src/renderer/locales/queryResultSnapshotViewer.zh-CN';
import { queryResultFindZh as find } from '../../src/renderer/locales/queryResultFind.zh-CN';
import { queryResultSortZh as sort } from '../../src/renderer/locales/queryResultSort.zh-CN';
import { queryResultSnapshotFileMessages as filesText } from '../../src/main/queryResultSnapshotFiles';
import { uiCommandLabels } from '../../src/shared/uiCommands.zh-CN';
import { formatText, zh } from '../../src/renderer/locales/zh-CN';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.skip(process.env.DBARK_SNAPSHOT_EXPORT_NATIVE !== '1', '仅在独立离线文件验收运行');

test('零连接工作台对快照排序并按显示和勾选范围导出真实文件', async ({}, info) => {
  expect(process.env.DBARK_INTEGRATION_ENABLED).toBe('0');
  const source = join(dataDir, '离线源.dbark-result.json');
  const csv = join(dataDir, '匹配行.csv'), json = join(dataDir, '勾选行.json');
  const wire = JSON.stringify({
    kind: 'dbark.query-result-snapshot', version: 1, result: {
      columns: [{ key: 'label', name: '内容', type: 'TEXT' }, { key: 'amount', name: '金额', type: 'DECIMAL' }, { key: 'payload', name: '字节', type: 'BLOB' }],
      rows: [
        { label: '匹配甲', amount: '9007199254740993.0002', payload: null },
        { label: '勾选行', amount: '9007199254740993', payload: { type: 'binary', base64: 'AP8=' } },
        { label: '匹配乙', amount: '9007199254740993.0001', payload: null },
        { label: '匹配丙', amount: '9007199254740993.0002', payload: null },
        { label: '范围外', amount: '0', payload: null },
      ],
      truncated: true, elapsedMs: { type: 'number', text: '1' }, statement: 'SELECT secret_sql_marker;',
    },
  });
  await writeFile(source, wire, { flag: 'wx' });

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
      if (parent !== window || options.title !== paths.openTitle || state.dialogs.length) reject('showOpenDialog');
      state.dialogs.push('open');
      return { canceled: false, filePaths: [paths.source] };
    }) as typeof dialog.showOpenDialog;
    dialog.showSaveDialog = (async (parent: Electron.BrowserWindow, options: Electron.SaveDialogOptions) => {
      const format = state.dialogs.length === 1 ? 'csv' : 'json';
      if (parent !== window || options.title !== '导出文件' || state.dialogs.length > 2 || !options.defaultPath?.endsWith('.' + format)) reject('showSaveDialog');
      state.dialogs.push(format);
      return { canceled: false, filePath: paths[format] };
    }) as typeof dialog.showSaveDialog;
    const fork = utilityProcess.fork.bind(utilityProcess);
    utilityProcess.fork = ((path: string, args: string[], options: Electron.ForkOptions) => {
      if (!path.endsWith('worker.cjs') || options.serviceName !== 'DBArk 数据库引擎') reject('utilityProcess.fork');
      const child = fork(path, args, options);
      const post = child.postMessage.bind(child);
      child.postMessage = ((message: { command: string; input: { connectionId?: string; sessionId?: string; filePath?: string } }) => {
        if (message.command !== '__shutdown' && (message.command !== 'files.exportResult' || message.input.connectionId ||
            message.input.sessionId || ![paths.csv, paths.json].includes(message.input.filePath ?? ''))) reject(message.command);
        state.engine.push(message.command);
        post(message);
      }) as typeof child.postMessage;
      return child;
    }) as typeof utilityProcess.fork;
    return state;
  }, { source, csv, json, openTitle: filesText.choose });

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
    await expect(checked).toBeDisabled();
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

    const save = async (title: string, format: 'csv' | 'json', rows: number) => {
      const dialog = page.getByRole('dialog', { name: title, exact: true });
      await expect(dialog).toBeVisible();
      await expect(viewer).toBeHidden();
      const selector = dialog.getByLabel(zh.resultExport.format, { exact: true });
      await expect(selector.locator('option[value="sql"]')).toHaveCount(0);
      await selector.selectOption(format);
      await dialog.getByRole('button', { name: new RegExp(zh.resultExport.chooseFile) }).click();
      await expect(dialog.getByText(format === 'csv' ? '匹配行.csv' : '勾选行.json', { exact: true })).toBeVisible();
      if (format === 'csv') await info.attach('离线快照导出预览', { body: await page.screenshot(), contentType: 'image/png' });
      await dialog.getByRole('button', { name: zh.resultExport.start, exact: true }).click();
      await expect(dialog.getByText(formatText(zh.resultExport.completed, rows), { exact: true })).toBeVisible();
      await dialog.getByRole('button', { name: zh.common.done, exact: true }).click();
      await expect(viewer).toBeVisible();
    };
    await shown.click();
    await save(text.exportShown, 'csv', 3);
    await expect(shown).toBeFocused();
    expect((await readFile(csv, 'utf8')).replace(/^\uFEFF/, '')).toBe(
      '内容,金额,字节\r\n匹配丙,9007199254740993.0002,\\N\r\n匹配甲,9007199254740993.0002,\\N\r\n匹配乙,9007199254740993.0001,\\N\r\n');
    await expect(matched).toBeVisible();
    await viewer.getByRole('button', { name: find.clearMatchView, exact: true }).click();
    await expect(labels).toHaveText(['匹配丙', '匹配甲', '匹配乙', '勾选行', '范围外']);
    const rowCheck = viewer.getByRole('row').filter({ hasText: '勾选行' }).getByRole('checkbox');
    await rowCheck.check();
    await checked.click();
    await save(text.exportChecked, 'json', 1);
    await expect(checked).toBeFocused();
    await expect(rowCheck).toBeChecked();
    expect(JSON.parse(await readFile(json, 'utf8'))).toEqual([{ 内容: '勾选行', 金额: '9007199254740993', 字节: { type: 'binary', base64: 'AP8=' } }]);
    await viewer.getByRole('button', { name: sort.clear, exact: true }).click();
    await expect(labels).toHaveText(['匹配甲', '勾选行', '匹配乙', '匹配丙', '范围外']);
    await expect(checked).toBeDisabled();
    expect(await readFile(source, 'utf8')).toBe(wire);
    expect(await settings()).toEqual(baseline);
    expect(await page.evaluate(() => window.dbark.invoke('connections.list', {}))).toEqual([]);
    expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
    expect(pageErrors).toEqual([]);
    const audit = await observer.jsonValue();
    expect(audit.denied).toEqual([]);
    expect(audit.dialogs).toEqual(['open', 'csv', 'json']);
    expect(audit.engine).toEqual(['files.exportResult', 'files.exportResult']);
    expect(audit.requests.filter(command => command === 'files.exportResult')).toHaveLength(2);
  } finally {
    await observer.dispose();
  }
});
