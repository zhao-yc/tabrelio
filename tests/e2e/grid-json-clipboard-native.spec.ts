import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { DatabaseSync } from 'node:sqlite';
import { confirmOwnedDesktopExit, dataDir, desktop, expect, page, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';
import { readQueryCsvZip } from '../helpers/queryCsvZip';
import { gridJsonClipboardZh as text } from '../../src/renderer/locales/gridJsonClipboard.zh-CN';
import { gridCsvClipboardZh as csvText } from '../../src/renderer/locales/gridCsvClipboard.zh-CN';
import { deleteSqlCopyZh } from '../../src/renderer/locales/deleteSqlCopy.zh-CN';
import { gridQuickValueZh } from '../../src/renderer/locales/gridQuickValue.zh-CN';
import { gridHeaderMenuZh } from '../../src/renderer/locales/gridHeaderMenu.zh-CN';
import { gridRangeCopyZh } from '../../src/renderer/locales/gridRangeCopy.zh-CN';
import { gridRangeExportZh } from '../../src/renderer/locales/gridRangeExport.zh-CN';
import { gridRangePngText } from '../../src/shared/gridRangePng';
import { sqliteTableFindZh } from '../../src/renderer/locales/sqliteTableFind.zh-CN';
import { queryResultFindZh } from '../../src/renderer/locales/queryResultFind.zh-CN';
import { cellClipboardType } from '../../src/renderer/gridClipboard';
import { sqliteCellClipboardType } from '../../src/renderer/sqliteTableClipboard';
import { postgresZh } from '../../src/renderer/locales/postgres.zh-CN';
import { resultSqlZh } from '../../src/shared/resultSql.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import { queryDuplicateZh } from '../../src/renderer/locales/queryDuplicate.zh-CN';
import { queryResultNavigatorZh } from '../../src/renderer/locales/queryResultNavigator.zh-CN';
import { uiCommandLabels } from '../../src/shared/uiCommands.zh-CN';
import { explainZh } from '../../src/renderer/locales/explain.zh-CN';
import { queryAnalyzeZh as analyzeText } from '../../src/renderer/locales/queryAnalyze.zh-CN';
import { queryStreamZh } from '../../src/renderer/locales/queryStreamExport.zh-CN';
import { postgresQueryExportZh } from '../../src/renderer/locales/postgresQueryExport.zh-CN';
import { sqliteQueryExportZh } from '../../src/renderer/locales/sqliteQueryExport.zh-CN';
import { parseTabularText } from '../../src/renderer/gridClipboard';
import type { NetworkConnectionProfile, PostgresConnectionProfile } from '../../src/shared/contracts';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });

test('表格和查询结果复制 JSON 与右键命中的单元格，保留精确值', async ({}, info) => {
  const dialect = process.env.DBARK_GRID_JSON_DIALECT;
  test.skip(!dialect, '需要显式启用记录 JSON 复制专项');
  const local = dialect === 'sqlite';
  const database = local ? 'main' : process.env.DBARK_GRID_JSON_DATABASE ?? '';
  const port = Number(process.env.DBARK_GRID_JSON_PORT);
  const password = process.env.DBARK_GRID_JSON_PASSWORD ?? '';
  if (process.env.DBARK_DEV_URL || process.env.DBARK_EXECUTABLE_PATH ||
      (local ? process.env.DBARK_INTEGRATION_ENABLED !== '0' :
        process.env.DBARK_INTEGRATION_ENABLED !== '1' || !['postgresql', 'mysql', 'mariadb'].includes(dialect!) ||
        !/^tabrelio_js_[a-f0-9]{12}$/.test(database) || !/^[a-f0-9]{64}$/.test(password) ||
        !Number.isInteger(port) || port <= 1024 || port > 65535)) throw Error('仅允许本例 SQLite 文件或独占回环实库');
  const table = 'json_subject', filePath = join(await realpath(dataDir), 'grid-json.sqlite');
  if (local) {
    const fixture = new DatabaseSync(filePath);
    try {
      fixture.exec("CREATE TABLE json_subject (id INTEGER PRIMARY KEY, amount INTEGER, label TEXT, payload BLOB, nullable TEXT);" +
        "INSERT INTO json_subject VALUES (1,9007199254740993,'row A',X'00ff',NULL),(2,9007199254740994,'row B',X'','');" +
        'CREATE VIEW json_view AS SELECT * FROM json_subject;');
    } finally { fixture.close(); }
  }
  const baseline = local ? await readFile(filePath) : undefined;
  const profile: NetworkConnectionProfile | PostgresConnectionProfile | undefined = local ? undefined : {
    id: '', dialect: dialect as (NetworkConnectionProfile | PostgresConnectionProfile)['dialect'], name: dialect!, group: '', color: '#123456',
    host: '127.0.0.1', port, database, user: database, password, rememberPassword: false,
  };
  const sql = 'SELECT amount AS alias, label AS alias, payload, nullable FROM json_subject ORDER BY id DESC';
  try {
    if (local) await desktop.evaluate(({ dialog, BrowserWindow }, filePath) => {
      const open = dialog.showOpenDialog;
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        dialog.showOpenDialog = open;
        if (args[0] !== BrowserWindow.getAllWindows()[0] || !(args.at(-1) as Electron.OpenDialogOptions).filters?.[0]?.extensions.includes('sqlite'))
          throw Error('越过本例文件选择范围');
        return { canceled: false, filePaths: [filePath] };
      }) as typeof open;
    }, filePath);
    const targetProfile = await page.evaluate(async ({ profile, table, sql, database }) => {
      const id = 'json-sqlite';
      const picked = profile ? undefined : await window.dbark.invoke('files.choose', { purpose: 'sqlite-database', sqliteConnectionId: id });
      if (!profile && !picked) throw Error('本例 SQLite 文件未授权');
      const connection = await window.dbark.invoke('connections.save', profile ?? { id, dialect: 'sqlite', name: 'SQLite', group: '', color: '#123456',
        sqlite: { fileToken: picked!.token, readOnly: false, busyTimeoutMs: 1000 } });
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'json-table', tabs: [
        { id: 'json-table', kind: 'table', title: table, connectionId: connection.id, database,
          table: profile?.dialect === 'postgresql' ? '"public"."' + table + '"' : table },
        ...(profile ? [] : [{ id: 'json-view', kind: 'table' as const, title: 'json_view', connectionId: connection.id, database, table: 'json_view' }]),
        { id: 'json-query', kind: 'query', title: '查询结果 JSON', connectionId: connection.id, database, sql },
      ] });
      // 第二个独立配置只指向本例授权的隔离端点。
      return profile ? window.dbark.invoke('connections.save', { ...profile, name: '独立副本目标' }) : undefined;
    }, { profile, table, sql, database });
    await page.addInitScript(() => { self.MonacoEnvironment = { ...self.MonacoEnvironment, globalAPI: true }; });
    await page.reload();
    await page.evaluate(() => {
      const packets: Record<string, string>[] = [];
      // 在测试渲染器捕获复制事件的数据，隔离系统剪贴板。
      Object.defineProperty(document, 'execCommand', { configurable: true, value(command: string) {
        if (command !== 'copy') throw Error('仅允许本例复制动作');
        const data = new DataTransfer();
        document.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }));
        packets.push(Object.fromEntries(data.types.map(type => [type, data.getData(type)])));
        return true;
      } });
      Object.assign(globalThis, { gridJsonPackets: packets });
    });
    const packets = () => page.evaluate(() => (globalThis as typeof globalThis & {
      gridJsonPackets: Record<string, string>[];
    }).gridJsonPackets);
    let count = 0;
    const lastPacket = async () => {
      const data = await packets();
      expect(data).toHaveLength(++count);
      return data.at(-1)!;
    };
    const copy = async (scope: ReturnType<typeof page.locator>) => {
      await (await navigationMenuItem(scope, { name: text.action, exact: true })).click();
      const packet = await lastPacket();
      expect(Object.keys(packet)).toEqual(['text/plain']);
      return JSON.parse(packet['text/plain']);
    };
    const copyCsv = async (scope: ReturnType<typeof page.locator>) => {
      await (await navigationMenuItem(scope, { name: csvText.action, exact: true })).click();
      const packet = await lastPacket();
      expect(Object.keys(packet)).toEqual(['text/plain']);
      return packet['text/plain'];
    };
    const menuCopy = async (cell: ReturnType<typeof page.locator>, typed: unknown, plain: string, sqlite?: unknown, keyboard = false) => {
      // 菜单会在网格滚动时关闭。先让测试滚动目标格并等浏览器派发该次滚动，再打开菜单。
      await cell.scrollIntoViewIfNeeded();
      await cell.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      if (keyboard) {
        await cell.click();
        await page.keyboard.press('Shift+F10');
      } else await cell.click({ button: 'right' });
      const action = page.getByRole('menuitem', { name: gridQuickValueZh.copyCell, exact: true });
      await expect(action).toBeVisible();
      if (count === 2) await page.screenshot({ path: info.outputPath('复制当前单元格.png') });
      if (keyboard) {
        const menu = action.locator('..');
        await expect(menu.locator('[role="menuitem"]:focus')).toHaveCount(1);
        const enabled = await menu.locator('[role="menuitem"]:not(:disabled)').count();
        for (let step = 1; step < enabled && !await action.evaluate(node => node === node.ownerDocument.activeElement); step++) {
          await page.keyboard.press('ArrowDown');
        }
        await expect(action).toBeFocused();
        await page.keyboard.press('Enter');
      } else await action.click();
      const packet = await lastPacket();
      expect(packet['text/plain']).toBe(plain);
      expect(JSON.parse(packet[cellClipboardType])).toEqual({ version: 1, rows: [[typed]] });
      if (sqlite === undefined) expect(packet[sqliteCellClipboardType]).toBeUndefined();
      else expect(JSON.parse(packet[sqliteCellClipboardType])).toMatchObject({ version: 1, rows: [[sqlite]] });
    };
    /** 在原数据格菜单中复制整行，继续隔离系统剪贴板。 */
    const copyHitRow = async (cell: ReturnType<typeof page.locator>, headers: boolean) => {
      await cell.scrollIntoViewIfNeeded();
      await cell.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await cell.click({ button: 'right' });
      await page.getByRole('menuitem', { name: headers ? gridRangeCopyZh.copyRowWithHeaders : gridRangeCopyZh.copyRow, exact: true }).click();
      return lastPacket();
    };
    const open = (id: string) => page.locator('[data-workspace-tab-id="' + id + '"] .tab-select').click();
    const headerMenu = page.getByRole('menu', { name: gridHeaderMenuZh.menu, exact: true });
    const chooseHeaderAction = async (header: ReturnType<typeof page.locator>, action: string, keyboard = false, capture = false) => {
      await header.scrollIntoViewIfNeeded();
      await header.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      if (keyboard) { await header.focus(); await page.keyboard.press('Shift+F10'); }
      else await header.click({ button: 'right' });
      await expect(headerMenu).toBeVisible();
      if (capture) await page.screenshot({ path: info.outputPath('列标题排序.png') });
      const choice = headerMenu.getByRole('menuitem', { name: action, exact: true });
      if (keyboard) await choice.press('Enter');
      else await choice.click();
      await expect(headerMenu).toBeHidden();
    };
    const labelOrder = (scope: ReturnType<typeof page.locator>) => scope.getByRole('gridcell').filter({ hasText: /^(TEXT · )?row [AB]$/ });
    const expectLabels = async (scope: ReturnType<typeof page.locator>, first: 'A' | 'B') => {
      await expect(labelOrder(scope)).toHaveText([new RegExp('row ' + first + '$'), new RegExp('row ' + (first === 'A' ? 'B' : 'A') + '$')]);
    };
    const tableTab = page.locator('.table-tab:visible, .postgres-table-tab:visible');
    const tableCell = tableTab.getByRole('gridcell').filter({ hasText: /^(TEXT · )?row A$/ });
    const expectedA = { amount: '9007199254740993', label: 'row A', payload: { type: 'binary', base64: 'AP8=' }, nullable: null };
    await expect(tableCell).toBeVisible();
    await tableCell.click();
    expect(await copy(tableTab)).toMatchObject([expectedA]);
    expect(await copyCsv(tableTab)).toBe('id,amount,label,payload,nullable\r\n1,9007199254740993,row A,base64:AP8=,\\N\r\n');
    const tableB = tableTab.getByRole('row', { name: /row B/ });
    const tableBCheck = tableB.getByRole('checkbox');
    await tableBCheck.check();
    const tableAmount = tableTab.getByRole('gridcell').filter({ hasText: /^(INTEGER · )?9007199254740993$/ });
    await menuCopy(tableAmount, expectedA.amount, expectedA.amount, local ? { kind: 'integer', value: expectedA.amount } : undefined);
    await expect(tableBCheck).toBeChecked();
    const copiedTableRow = await copyHitRow(tableAmount, true);
    expect(copiedTableRow['text/plain']).toBe('id\tamount\tlabel\tpayload\tnullable\n1\t9007199254740993\trow A\t0x00ff\tNULL');
    const copiedTableValues = JSON.parse(copiedTableRow[cellClipboardType]).rows;
    expect(copiedTableValues).toHaveLength(1);
    expect(String(copiedTableValues[0][0])).toBe('1');
    expect(copiedTableValues[0].slice(1)).toEqual([expectedA.amount, expectedA.label, expectedA.payload, null]);
    await expect(tableBCheck).toBeChecked();
    const txt = join(dataDir, '表页选区.txt');
    await desktop.evaluate(({ dialog, BrowserWindow }, input) => {
      const original = dialog.showSaveDialog;
      dialog.showSaveDialog = (async (parent: Electron.BaseWindow, options: Electron.SaveDialogOptions) => {
        dialog.showSaveDialog = original;
        if (parent !== BrowserWindow.getAllWindows()[0] || options.defaultPath !== input.name ||
            options.filters?.[0]?.extensions.join() !== 'txt') throw Error('越过本例 TXT 保存范围');
        return { canceled: false, filePath: input.txt };
      }) as typeof original;
    }, { txt, name: gridRangeExportZh.txtFilename });
    await tableAmount.click();
    await page.keyboard.press('Shift+ArrowDown');
    for (let index = 0; index < 3; index++) await page.keyboard.press('Shift+ArrowRight');
    await tableAmount.click({ button: 'right' });
    await page.getByRole('menuitem', { name: gridRangeExportZh.txt, exact: true }).click();
    await expect(page.getByText(gridRangeExportZh.txtSaved('表页选区.txt', 2), { exact: true })).toBeVisible();
    expect((await readFile(txt, 'utf8')).replace(/^\uFEFF/, '')).toBe(
      'amount\tlabel\tpayload\tnullable\r\n9007199254740993\trow A\tbase64:AP8=\t\\N\r\n9007199254740994\trow B\tbase64:\t""\r\n');
    const png = join(dataDir, '表页选区.png');
    await desktop.evaluate(({ dialog, BrowserWindow }, input) => {
      const original = dialog.showSaveDialog;
      dialog.showSaveDialog = (async (parent: Electron.BaseWindow, options: Electron.SaveDialogOptions) => {
        dialog.showSaveDialog = original;
        if (parent !== BrowserWindow.getAllWindows()[0] || options.defaultPath !== input.name ||
            options.filters?.[0]?.extensions.join() !== 'png') throw Error('越过本例 PNG 保存范围');
        return { canceled: false, filePath: input.png };
      }) as typeof original;
    }, { png, name: gridRangePngText.name });
    await tableAmount.click({ button: 'right' });
    await page.getByRole('menuitem', { name: gridRangeExportZh.quickPng, exact: true }).click();
    await expect(page.getByText(gridRangeExportZh.pngSaved('表页选区.png'), { exact: true })).toBeVisible();
    expect(await desktop.evaluate(({ nativeImage }, path) => nativeImage.createFromPath(path).getSize(), png))
      .toEqual({ width: 1602, height: 170 });
    await tableAmount.click();
    await expect(tableBCheck).toBeChecked();
    if (local) {
      await (await navigationMenuItem(tableTab, { name: deleteSqlCopyZh.action, exact: true })).click();
      expect(await lastPacket()).toEqual({ 'text/plain': 'DELETE FROM "main"."json_subject"\nWHERE ("id" COLLATE BINARY = 2);' });
      await expect(tableBCheck).toBeChecked();
      expect(await readFile(filePath)).toEqual(baseline);
    }
    const fitAmount = async () => {
      const amountHeader = tableTab.getByRole('columnheader', { name: /^amount\b/ });
      const labelHeader = tableTab.getByRole('columnheader', { name: /^label\b/ });
      const headerWidth = (header: typeof amountHeader) => header.evaluate(element => Math.round(element.getBoundingClientRect().width));
      const before = await headerWidth(amountHeader), labelWidth = await headerWidth(labelHeader);
      await amountHeader.locator('.rdg-resize-handle').dblclick();
      await expect.poll(() => headerWidth(amountHeader)).not.toBe(before);
      const fitted = await headerWidth(amountHeader);
      expect(fitted).toBeGreaterThanOrEqual(64);
      expect(fitted).toBeLessThanOrEqual(640);
      expect(await headerWidth(labelHeader)).toBe(labelWidth);
    };
    await fitAmount();
    await expect(tableBCheck).toBeChecked();
    await page.screenshot({ path: info.outputPath('表头双击适宽.png') });
    // 观察正式分页回包，避免排序优先级不改变显示顺序时误把旧页当成验收结果。
    await desktop.evaluate(({ ipcMain }) => {
      const port = ipcMain as unknown as { _invokeHandlers: Map<string, (event: unknown, value: { command: string; input: { sort?: unknown } }) => Promise<{ ok: boolean }>> };
      const handle = port._invokeHandlers.get('dbark:request');
      if (!handle) throw Error('缺少正式分页入口');
      const completedSorts: unknown[] = [], layoutSaves: string[] = [];
      Object.assign(globalThis, { completedSorts, layoutSaves });
      port._invokeHandlers.set('dbark:request', async (event, value) => {
        if (['table.preferences.save', 'postgres.table.layout.save', 'sqlite.tableLayout.save'].includes(value.command)) layoutSaves.push(value.command);
        const reply = await handle(event, value);
        if (reply.ok && ['table.page', 'postgres.table.page', 'sqlite.tablePage'].includes(value.command))
          completedSorts.push(value.input.sort ?? []);
        return reply;
      });
    });
    const tableSorts = () => desktop.evaluate(() => (globalThis as typeof globalThis & { completedSorts: unknown[] }).completedSorts);
    const layoutSaves = () => desktop.evaluate(() => (globalThis as typeof globalThis & { layoutSaves: string[] }).layoutSaves);
    const sortTable = async (header: ReturnType<typeof page.locator>, action: string, rules: [string, 'ASC' | 'DESC'][], keyboard = false, capture = false) => {
      const count = (await tableSorts()).length;
      await chooseHeaderAction(header, action, keyboard, capture);
      await expect.poll(async () => (await tableSorts()).slice(count)).toEqual([
        rules.map(([column, direction]) => ({ column, direction: local ? direction.toLowerCase() : direction })),
      ]);
    };
    const amountHeader = tableTab.getByRole('columnheader', { name: /^amount\b/ });
    const labelHeader = tableTab.getByRole('columnheader', { name: /^label\b/ });
    /** 同一文本在新列重新查找，保持所选记录，并确认没有读表、执行或复制动作。 */
    async function checkColumnFind(screenshot = false) {
      const before = await packets();
      const panel = tableTab.getByRole('region', { name: sqliteTableFindZh.title, exact: true });
      const input = panel.getByRole('textbox', { name: sqliteTableFindZh.query, exact: true });
      const column = panel.getByRole('combobox', { name: sqliteTableFindZh.column, exact: true });
      await chooseHeaderAction(labelHeader, gridHeaderMenuZh.findColumn);
      await expect(input).toBeFocused();
      await expect(column.locator('option:checked')).toHaveText('label');
      await input.fill('row A');
      await expect(panel.getByRole('status')).toHaveText(sqliteTableFindZh.count(1, 1, -1));
      await panel.getByRole('button', { name: sqliteTableFindZh.next, exact: true }).click();
      await expect(panel.getByRole('status')).toContainText(sqliteTableFindZh.count(1, 1, 0));
      if (screenshot) await panel.screenshot({ path: info.outputPath('grid-header-find-column.png') });
      await chooseHeaderAction(amountHeader, gridHeaderMenuZh.findColumn, true);
      await expect(input).toBeFocused();
      await expect(input).toHaveValue('row A');
      await expect(column.locator('option:checked')).toHaveText('amount');
      await expect(panel.getByRole('status')).toContainText(sqliteTableFindZh.count(0, 0, -1));
      await expect(tableBCheck).toBeChecked();
      await panel.getByRole('button', { name: sqliteTableFindZh.close, exact: true }).click();
      await expect(panel).toBeHidden();
      expect(await packets()).toEqual(before);
    }
    const quoteName = (name: string) => local || dialect === 'postgresql' ? '"' + name + '"' : '`' + name + '`';
    await chooseHeaderAction(amountHeader, gridHeaderMenuZh.copyName);
    expect(await lastPacket()).toEqual({ 'text/plain': 'amount' });
    await chooseHeaderAction(labelHeader, gridHeaderMenuZh.copyQuotedName, true);
    expect(await lastPacket()).toEqual({ 'text/plain': quoteName('label') });
    await expect(tableBCheck).toBeChecked();
    if (local) await checkColumnFind(true);
    const frozen = /rdg-cell-frozen-start/;
    const checkTableFreeze = async (capture = false) => {
      const previous = await tableSorts();
      await chooseHeaderAction(amountHeader, gridHeaderMenuZh.freeze);
      await expect(amountHeader).toHaveClass(frozen);
      await expect(tableTab.getByRole('columnheader', { name: /^id\b/ })).toHaveClass(frozen);
      await expect(labelHeader).not.toHaveClass(frozen);
      await expect(tableBCheck).toBeChecked();
      if (capture) await page.screenshot({ path: info.outputPath('表头冻结.png') });
      await chooseHeaderAction(labelHeader, gridHeaderMenuZh.unfreeze, true);
      await expect(amountHeader).not.toHaveClass(frozen);
      await expect(tableBCheck).toBeChecked();
      expect(await tableSorts()).toEqual(previous);
      expect(await layoutSaves()).toEqual([]);
    };
    await checkTableFreeze(true);
    await sortTable(amountHeader, gridHeaderMenuZh.desc, [['amount', 'DESC']], false, true);
    await expectLabels(tableTab, 'B');
    await sortTable(labelHeader, gridHeaderMenuZh.asc, [['amount', 'DESC'], ['label', 'ASC']]);
    await expectLabels(tableTab, 'B');
    await sortTable(amountHeader, gridHeaderMenuZh.clear, [['label', 'ASC']]);
    await expectLabels(tableTab, 'A');
    if (local) {
      await open('json-view');
      await expect(tableCell).toBeVisible();
      await chooseHeaderAction(amountHeader, gridHeaderMenuZh.copyQuotedName);
      expect(await lastPacket()).toEqual({ 'text/plain': '"amount"' });
      await expect(tableTab.getByRole('button', { name: deleteSqlCopyZh.action, exact: true })).toHaveCount(0);
      await tableCell.click();
      expect(await copy(tableTab)).toMatchObject([expectedA]);
      expect(await copyCsv(tableTab)).toBe('id,amount,label,payload,nullable\r\n1,9007199254740993,row A,base64:AP8=,\\N\r\n');
      await menuCopy(tableAmount, expectedA.amount, expectedA.amount, { kind: 'integer', value: expectedA.amount });
      await tableBCheck.check();
      await checkColumnFind();
      await fitAmount();
      await expect(tableBCheck).toBeChecked();
      await checkTableFreeze();
      await sortTable(amountHeader, gridHeaderMenuZh.desc, [['amount', 'DESC']], true);
      await expectLabels(tableTab, 'B');
    }
    await open('json-query');
    const query = page.locator('.query-tab:visible');
    await expect(query.locator('.monaco-editor').getByRole('textbox')).toBeVisible();
    if (dialect === 'postgresql') await query.getByRole('button', { name: postgresZh.execute, exact: true }).click();
    else await query.locator('.query-execute-split button.primary').click();
    const grid = query.locator('.query-result-grid').getByRole('grid');
    const rowA = grid.getByRole('gridcell', { name: 'row A', exact: true });
    const rowB = grid.getByRole('gridcell', { name: 'row B', exact: true });
    await expect(query.getByRole('button', { name: deleteSqlCopyZh.action, exact: true })).toHaveCount(0);
    const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
    await expect(rowA).toBeVisible();
    await expect.poll(async () => (await history()).map(entry => entry.success)).toEqual([true]);
    const historyBefore = await history();
    await (await navigationMenuItem(query, {name: zh.query.resultSql, exact: true})).click();
    const resultSource = page.getByRole('dialog', {name: zh.query.resultSqlTitle, exact: true});
    await resultSource.getByRole('button', {name: queryResultNavigatorZh.copyOriginal, exact: true}).click();
    await expect(resultSource.getByText(queryResultNavigatorZh.originalCopied, {exact: true})).toBeVisible();
    expect(await lastPacket()).toEqual({'text/plain': sql});
    const resultFile = join(dataDir, '结果来源原语句.sql');
    await desktop.evaluate(({dialog, BrowserWindow}, filePath) => {
      const original = dialog.showSaveDialog;
      dialog.showSaveDialog = (async (owner: Electron.BaseWindow, options: Electron.SaveDialogOptions) => {
        dialog.showSaveDialog = original;
        if (owner !== BrowserWindow.getAllWindows()[0] || !options.filters?.[0]?.extensions.includes('sql'))
          throw Error('仅允许保存本例原语句 SQL 文件');
        return {canceled: false, filePath};
      }) as typeof original;
    }, resultFile);
    await resultSource.getByRole('button', {name: queryResultNavigatorZh.saveOriginal, exact: true}).click();
    await expect.poll(() => readFile(resultFile, 'utf8').catch(() => undefined)).toBe(sql);
    await resultSource.getByRole('button', {name: zh.common.close, exact: true}).click();
    expect(await history()).toEqual(historyBefore);
    await rowA.locator('..').getByRole('checkbox').check();
    await rowB.locator('..').getByRole('checkbox').check();
    const aliases = grid.getByRole('columnheader', { name: /^alias\b/ });
    await expect(aliases).toHaveCount(2);
    await aliases.nth(1).click({ button: 'right' });
    await expect(headerMenu).toBeVisible();
    await headerMenu.screenshot({ path: info.outputPath('grid-column-name-copy.png') });
    await headerMenu.getByRole('menuitem', { name: gridHeaderMenuZh.copyName, exact: true }).click();
    expect(await lastPacket()).toEqual({ 'text/plain': 'alias' });
    await chooseHeaderAction(aliases.nth(0), gridHeaderMenuZh.copyQuotedName, true);
    expect(await lastPacket()).toEqual({ 'text/plain': quoteName('alias') });
    const resultFind = query.locator('.query-result-find-region');
    const searchResult = resultFind.getByRole('textbox', { name: queryResultFindZh.input, exact: true });
    const resultColumn = resultFind.getByRole('combobox', { name: queryResultFindZh.columns, exact: true });
    const findStatus = resultFind.getByRole('status');
    async function checkAliasFind() {
      await chooseHeaderAction(aliases.nth(1), gridHeaderMenuZh.findColumn);
      await expect(searchResult).toBeFocused();
      await expect(resultColumn.locator('option:checked')).toHaveText(queryResultFindZh.columnOption('alias', 2));
      await searchResult.fill('row A');
      await expect(findStatus).toHaveText(queryResultFindZh.count(1, -1));
      await chooseHeaderAction(aliases.nth(0), gridHeaderMenuZh.findColumn, true);
      await expect(searchResult).toHaveValue('row A');
      await expect(resultColumn.locator('option:checked')).toHaveText(queryResultFindZh.columnOption('alias', 1));
      await expect(findStatus).toHaveText(queryResultFindZh.noMatch);
      await searchResult.press('Escape');
      await expect(searchResult).toBeHidden();
    }
    await checkAliasFind();
    const aliasWidth = (index: number) => aliases.nth(index).evaluate(element => Math.round(element.getBoundingClientRect().width));
    const amountWidth = await aliasWidth(0), labelWidth = await aliasWidth(1);
    await aliases.nth(0).locator('.rdg-resize-handle').dblclick();
    await expect.poll(() => aliasWidth(0)).not.toBe(amountWidth);
    expect(await aliasWidth(1)).toBe(labelWidth);
    await page.screenshot({ path: info.outputPath('复制记录为JSON.png') });
    expect(await copy(query)).toEqual([
      { alias: '9007199254740994', 'alias [2]': 'row B', payload: { type: 'binary', base64: '' }, nullable: '' },
      { alias: '9007199254740993', 'alias [2]': 'row A', payload: { type: 'binary', base64: 'AP8=' }, nullable: null },
    ]);
    expect(await copyCsv(query)).toBe('alias,alias [2],payload,nullable\r\n' +
      '9007199254740994,row B,base64:,""\r\n9007199254740993,row A,base64:AP8=,\\N\r\n');
    const resultA = rowA.locator('..'), resultB = rowB.locator('..');
    await menuCopy(resultA.getByRole('gridcell', { name: expectedA.amount, exact: true }), expectedA.amount, expectedA.amount,
      local ? { kind: 'integer', value: expectedA.amount } : undefined, true);
    await menuCopy(resultA.getByRole('gridcell', { name: 'NULL', exact: true }), null, 'NULL', local ? { kind: 'null' } : undefined);
    await menuCopy(resultB.getByRole('gridcell').last(), '', '', local ? { kind: 'text', value: '' } : undefined);
    await menuCopy(resultA.getByRole('gridcell', { name: /0x00ff|二进制|BLOB/i }), expectedA.payload, '0x00ff',
      local ? { kind: 'blob', value: '00ff' } : undefined);
    const copiedA = await copyHitRow(rowA, true);
    expect(copiedA['text/plain']).toBe('alias\talias\tpayload\tnullable\n9007199254740993\trow A\t0x00ff\tNULL');
    expect(JSON.parse(copiedA[cellClipboardType])).toEqual({ version: 1, rows: [[expectedA.amount, expectedA.label, expectedA.payload, null]] });
    if (local) expect(JSON.parse(copiedA[sqliteCellClipboardType])).toMatchObject({ version: 1, rows: [[
      { kind: 'integer', value: expectedA.amount }, { kind: 'text', value: 'row A' }, { kind: 'blob', value: '00ff' }, { kind: 'null' },
    ]] });
    const copiedB = await copyHitRow(rowB, false);
    expect(copiedB['text/plain']).toBe('9007199254740994\trow B\t0x\t');
    expect(JSON.parse(copiedB[cellClipboardType])).toEqual({ version: 1, rows: [['9007199254740994', 'row B', { type: 'binary', base64: '' }, '']] });
    await expect(resultA.getByRole('checkbox')).toBeChecked();
    await expect(resultB.getByRole('checkbox')).toBeChecked();
    await chooseHeaderAction(aliases.nth(1), gridHeaderMenuZh.freeze);
    await expect(aliases.nth(0)).toHaveClass(frozen);
    await expect(aliases.nth(1)).toHaveClass(frozen);
    await expect(resultA.getByRole('checkbox')).toBeChecked();
    await expect(resultB.getByRole('checkbox')).toBeChecked();
    await chooseHeaderAction(aliases.nth(0), gridHeaderMenuZh.unfreeze);
    await expect(aliases.nth(0)).not.toHaveClass(frozen);
    await expect(aliases.nth(1)).not.toHaveClass(frozen);
    await expect(resultA.getByRole('checkbox')).toBeChecked();
    await expect(resultB.getByRole('checkbox')).toBeChecked();
    // 两个同名标题命中不同字段，加入和清除只修改相应排序规则。
    const tableSortsBeforeResult = await tableSorts();
    await chooseHeaderAction(aliases.nth(0), gridHeaderMenuZh.asc, true);
    await expectLabels(grid, 'A');
    await chooseHeaderAction(aliases.nth(1), gridHeaderMenuZh.desc);
    await expectLabels(grid, 'A');
    await chooseHeaderAction(aliases.nth(0), gridHeaderMenuZh.clear);
    await expectLabels(grid, 'B');
    const copyInsert = async (selected: boolean) => {
      const title = selected ? zh.resultExport.selectedTitle : zh.resultExport.title;
      await (await navigationMenuItem(query, { name: title, exact: true })).click();
      const dialog = page.getByRole('dialog', { name: title, exact: true });
      await dialog.getByLabel(zh.resultExport.format, { exact: true }).selectOption('sql');
      await dialog.getByLabel(local ? resultSqlZh.sqliteDatabase : dialect === 'postgresql' ? resultSqlZh.postgresDatabase : resultSqlZh.database, { exact: true }).fill('target_db');
      const target = dialog.getByLabel(resultSqlZh.table, { exact: true });
      await target.fill('before');
      for (const [index, name] of ['amount', 'label', 'payload', 'nullable'].entries())
        await dialog.getByLabel(resultSqlZh.column(index + 1), { exact: true }).fill(name);
      const preview = dialog.getByLabel(resultSqlZh.clipboardPreview, { exact: true });
      const prepare = dialog.getByRole('button', { name: resultSqlZh.clipboardPreview, exact: true });
      const copy = dialog.getByRole('button', { name: resultSqlZh.clipboardCopy, exact: true });
      await prepare.click();
      await expect(preview).toContainText('before');
      await target.fill('target_table');
      await expect(copy).toHaveCount(0);
      await expect(preview).toHaveCount(0);
      await prepare.click();
      await expect(preview).toContainText('target_table');
      await expect(dialog.getByRole('button', { name: zh.resultExport.chooseFile, exact: false })).toBeDisabled();
      expect(await packets()).toHaveLength(count);
      const sql = await preview.textContent();
      if (!selected) {
        await preview.scrollIntoViewIfNeeded();
        await page.screenshot({ path: info.outputPath('复制结果为 INSERT SQL.png') });
      }
      await copy.click();
      expect(await lastPacket()).toEqual({ 'text/plain': sql });
      await dialog.getByRole('button', { name: zh.common.close, exact: true }).click();
      await expect(dialog).toBeHidden();
      return sql!.split('\n').filter(line => line.startsWith('INSERT INTO '));
    };
    const allSql = await copyInsert(false);
    const amountLiteral = (value: string) => local || dialect === 'postgresql' ? value : Buffer.from(value).toString('hex');
    expect(allSql).toHaveLength(2);
    expect(allSql[0]).toContain(amountLiteral('9007199254740994'));
    expect(allSql[1]).toContain(amountLiteral('9007199254740993'));
    expect(allSql[1]).toContain('00ff');
    expect(allSql[1]).toContain('NULL');
    await resultA.getByRole('checkbox').check();
    expect(await copyInsert(true)).toEqual([allSql[1]]);
    if (local) {
      const replay = new DatabaseSync(':memory:');
      try {
        replay.exec("ATTACH ':memory:' AS target_db; CREATE TABLE target_db.target_table(amount INTEGER, label TEXT, payload BLOB, nullable TEXT) STRICT;");
        replay.exec(allSql.join('\n'));
        const rows = replay.prepare('SELECT amount, label, hex(payload) AS hex, nullable FROM target_db.target_table ORDER BY rowid');
        rows.setReadBigInts(true);
        expect(rows.all()).toEqual([
          { amount: 9007199254740994n, label: 'row B', hex: '', nullable: '' },
          { amount: 9007199254740993n, label: 'row A', hex: '00FF', nullable: null },
        ]);
      } finally { replay.close(); }
    }
    if (targetProfile) {
      await (await navigationMenuItem(query, { name: queryDuplicateZh.targetAction, exact: true })).click();
      const chooser = page.getByRole('dialog', { name: queryDuplicateZh.targetAction, exact: true });
      await chooser.getByLabel(queryDuplicateZh.targetConnection, { exact: true }).selectOption(targetProfile.id);
      await expect(chooser.locator('datalist option')).toHaveCount(0);
      await chooser.getByRole('button', { name: queryDuplicateZh.targetRead, exact: true }).click();
      await expect.poll(() => chooser.locator('datalist option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value))).toContain(database);
      await chooser.getByRole('button', { name: queryDuplicateZh.targetOpen, exact: true }).click();
      await expect(chooser).toBeHidden();
      await expect.poll(() => page.evaluate(async () => {
        const state = await window.dbark.invoke('settings.get', {});
        return state.tabs.find(tab => tab.id === state.activeTabId);
      })).toMatchObject({ connectionId: targetProfile.id, sql, databaseContext: { state: 'known', database } });
      await open('json-query');
      await expect(rowA).toBeVisible();
    }
    if (local) {
      await (await navigationMenuItem(query, { name: zh.query.pinResult, exact: true })).click();
      await expect(query.locator('.pinned-result.selected')).toHaveCount(1);
      await checkAliasFind();
    }
    expect(await tableSorts()).toEqual(tableSortsBeforeResult);
    expect(await history()).toEqual(historyBefore);
    // 前后故意放置不可执行的相邻语句，光标端只选中一个字符。计划必须分析中间整句。
    const custom = dialect === 'mysql' || dialect === 'mariadb';
    const statement = 'SELECT * FROM json_subject WHERE id = 1';
    const script = ['SELECT * FROM missing_plan_previous;', ...(custom ? ['DELIMITER $$'] : []),
      statement + (custom ? '$$' : ';'), ...(custom ? ['DELIMITER ;'] : []),
      'SELECT * FROM missing_plan_next;'].join('\n');
    const editor = query.locator('.monaco-editor').getByRole('textbox');
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    const write = async (sql: string) => {
      await editor.focus();
      await page.keyboard.press(modifier + '+A');
      await page.keyboard.press('Backspace');
      await page.keyboard.insertText(sql);
      await expect.poll(() => page.evaluate(async () => {
        const state = await window.dbark.invoke('settings.get', {});
        return state.tabs.find(item => item.id === state.activeTabId)?.sql?.replaceAll('\r\n', '\n');
      })).toBe(sql);
    };
    await write(script);
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home');
    await page.keyboard.press('ArrowDown');
    if (custom) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Shift+ArrowRight');
    const command = 'explain-current';
    await expect.poll(() => desktop.evaluate(({ Menu }, id) => {
      const menu = Menu.getApplicationMenu();
      return menu?.getMenuItemById(id)?.enabled === true && menu.getMenuItemById('execute-selection')?.enabled === true;
    }, command)).toBe(true);
    await desktop.evaluate(({ Menu, BrowserWindow }, { id, label }) => {
      const entry = Menu.getApplicationMenu()?.getMenuItemById(id);
      const [window, extra] = BrowserWindow.getAllWindows();
      if (!entry?.enabled || entry.label !== label || !window || extra) throw Error('当前语句计划菜单不可用');
      entry.click(entry, window, {} as Electron.KeyboardEvent);
    }, { id: command, label: uiCommandLabels[command] });
    await expect(query.getByRole('treeitem').filter({ hasText: 'json_subject' }).first()).toBeVisible();
    await expect(query.locator('.error-box')).toHaveCount(0);
    const planCopy = async () => {
      await (await navigationMenuItem(query, { name: explainZh.copyOutput, exact: true })).click();
      const output = await lastPacket();
      expect(Object.keys(output)).toEqual(['text/plain']);
      return output['text/plain'];
    };
    if (local) {
      const [headers, ...rows] = parseTabularText(await planCopy());
      expect(headers).toEqual(['id', 'parent', 'notused', 'detail']);
      expect(rows.some(row => row[3]?.includes('json_subject'))).toBe(true);
    } else {
      await (await navigationMenuItem(query, { name: explainZh.raw, exact: true })).click();
      const originalOutput = await query.getByLabel(explainZh.raw, { exact: true }).textContent();
      expect(originalOutput).toContain('json_subject');
      expect(await planCopy()).toBe(originalOutput);
    }
    const locate = query.getByRole('button', { name: '定位计划原语句', exact: true });
    const selection = () => editor.evaluate(element => {
      const api = (window as Window & { monaco?: typeof import('monaco-editor') }).monaco;
      const instance = api?.editor.getEditors().find(item => item.getContainerDomNode().contains(element));
      const model = instance?.getModel(), range = instance?.getSelection();
      if (!model || !range) throw Error('无法核对计划定位后的原编辑器和选区');
      return { sql: model.getValue(), selected: model.getValueInRange(range), start: model.getOffsetAt(range.getStartPosition()) };
    });
    const locateAndCheck = async () => {
      await expect(locate).toBeEnabled();
      await locate.click();
      const located = await selection();
      expect(located.sql.replaceAll('\r\n', '\n')).toBe(script);
      expect(located.selected).toBe(statement);
      expect(located.start).toBe(located.sql.indexOf(statement));
    };
    if (!local) await locateAndCheck();
    const textPlan = async () => {
      await (await navigationMenuItem(query, { name: '获取文本计划', exact: true })).click();
      await expect(query.getByRole('grid')).toContainText('json_subject');
      await expect(query.locator('.error-box')).toHaveCount(0);
    };
    if (custom) {
      await textPlan();
      const [headers, ...rows] = parseTabularText(await planCopy());
      expect(headers).toContain('table');
      expect(rows.some(row => row[headers.indexOf('table')] === 'json_subject')).toBe(true);
      await locateAndCheck();
    }
    if (!local) {
      await write('SELECT * FROM missing_changed_draft;');
      await expect(locate).toBeDisabled();
      if (custom) await textPlan();
      await write(script);
      await expect(locate).toBeDisabled();
    }
    expect(await history()).toEqual(historyBefore);
    if (!local) {
      // 主键等值查询可能在计划中提前取行。范围查询保留一个可按表名查找的访问节点。
      const actualStatement = 'SELECT * FROM json_subject WHERE id >= 1';
      const actualSql = [actualStatement + ';', ...(custom ? ['DELIMITER $$'] : []),
        actualStatement + (custom ? '$$' : ';'), ...(custom ? ['DELIMITER ;'] : []), 'SELECT * FROM missing_actual_next;'].join('\n');
      await write(actualSql);
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home');
      await page.keyboard.press('ArrowDown');
      if (custom) await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Shift+ArrowRight');
      const currentAnalyze = 'analyze-current';
      await expect.poll(() => desktop.evaluate(({ Menu }, id) => Menu.getApplicationMenu()?.getMenuItemById(id)?.enabled === true, currentAnalyze)).toBe(true);
      await desktop.evaluate(({ Menu, BrowserWindow }, { id, label }) => {
        const item = Menu.getApplicationMenu()?.getMenuItemById(id), [window, extra] = BrowserWindow.getAllWindows();
        if (!item?.enabled || item.label !== label || !window || extra) throw Error('当前语句实际分析菜单不可用');
        item.click(item, window, {} as Electron.KeyboardEvent);
      }, { id: currentAnalyze, label: uiCommandLabels[currentAnalyze] });
      const confirm = page.getByRole('dialog', { name: analyzeText.title, exact: true });
      const frozenSource = () => confirm.getByLabel(analyzeText.sql, { exact: true }).evaluate(element => {
        const api = (window as Window & { monaco?: typeof import('monaco-editor') }).monaco;
        return api?.editor.getEditors().find(item => element.contains(item.getContainerDomNode()))?.getModel()?.getValue().trim();
      });
      await expect.poll(frozenSource).toBe(actualStatement);
      await confirm.getByRole('button', { name: analyzeText.cancel, exact: true }).click();
      await expect(confirm).toBeHidden();
      expect(await history()).toEqual(historyBefore);
      await (await navigationMenuItem(query, { name: uiCommandLabels[currentAnalyze], exact: true })).click();
      await expect.poll(frozenSource).toBe(actualStatement);
      await confirm.getByRole('checkbox', { name: analyzeText.acknowledge, exact: true }).check();
      await confirm.getByRole('button', { name: analyzeText.confirm, exact: true }).click();
      const actualPlan = query.getByRole('region', { name: analyzeText.view, exact: true });
      await expect(actualPlan.getByRole('treeitem').first()).toBeVisible();
      const historyAfterAnalysis = await history();
      expect(historyAfterAnalysis).toHaveLength(historyBefore.length + 1);
      const recorded = historyAfterAnalysis.find(entry => !historyBefore.some(previous => previous.id === entry.id));
      expect(recorded?.sql).toContain(actualStatement);
      expect(recorded?.sql).not.toMatch(/DELIMITER|missing_actual_next/);
      await actualPlan.getByRole('button', { name: analyzeText.collapse, exact: true }).click();
      await actualPlan.getByRole('button', { name: analyzeText.raw, exact: true }).click();
      await expect(actualPlan.getByLabel(analyzeText.raw, { exact: true })).toContainText('json_subject');
      const planSearch = actualPlan.getByRole('textbox', { name: explainZh.find, exact: true });
      await planSearch.fill('JSON_SUBJECT');
      await expect(actualPlan.getByLabel(explainZh.findCount, { exact: true })).toHaveText(/^0 \/ [1-9]\d* 个匹配节点$/);
      await planSearch.press('Enter');
      await expect(actualPlan.getByRole('treeitem', { selected: true })).toContainText('json_subject');
      await expect(actualPlan.getByRole('treeitem', { selected: true })).toHaveAttribute('data-plan-match', 'true');
      await expect(planSearch).toBeFocused();
      const nodeData = actualPlan.getByRole('region', { name: analyzeText.details, exact: true });
      const rawNode = nodeData.getByLabel(analyzeText.nodeData, { exact: true });
      await expect(rawNode).toHaveCount(0);
      await nodeData.getByText(analyzeText.nodeData, { exact: true }).click();
      await expect(rawNode).toContainText('json_subject');
      const nodeText = (await rawNode.textContent())!;
      if (dialect === 'mysql') expect(nodeText.trim()).toMatch(/^-> /);
      else expect(JSON.parse(nodeText)).toHaveProperty(dialect === 'mariadb' ? 'table_name' : 'Relation Name', 'json_subject');
      await actualPlan.getByRole('button', { name: analyzeText.rowComparison, exact: true }).click();
      const comparison = actualPlan.getByRole('table', { name: analyzeText.rowComparison, exact: true });
      const compared = comparison.getByRole('row').filter({ hasText: 'json_subject' }).first();
      await expect(compared.getByRole('cell').nth(1)).toHaveText(/^2(?:\.0+)?$/);
      await compared.getByRole('button').click();
      await expect(actualPlan.getByRole('treeitem', { selected: true })).toBeFocused();
      await expect(locate).toBeEnabled();
      await locate.click();
      const located = await selection();
      expect(located.sql.replaceAll('\r\n', '\n')).toBe(actualSql);
      expect(located.selected).toBe(actualStatement);
      expect(located.start).toBe(located.sql.lastIndexOf(actualStatement));
      await write('SELECT 2;');
      await expect(locate).toBeDisabled();
      await write(actualSql);
      await expect(locate).toBeDisabled();
      expect(await history()).toEqual(historyAfterAnalysis);
    }
    const firstStep = "SELECT '步进第一句' AS step_result";
    const failedStep = 'SELECT * FROM tabrelio_step_missing';
    const lastStep = "SELECT '步进最后一句' AS step_result";
    const stepScript = [...(custom ? ['DELIMITER $$'] : []), firstStep + (custom ? '$$' : ';'),
      ...(custom ? ['DELIMITER ;'] : []), failedStep + ';', lastStep + ';'].join('\n');
    await write(stepScript);
    const place = (statement: string, delta = 0) => editor.evaluate((element, {statement, delta}) => {
      const api = (window as Window & {monaco?: typeof import('monaco-editor')}).monaco;
      const instance = api?.editor.getEditors().find(item => item.getContainerDomNode().contains(element));
      const model = instance?.getModel();
      if (!model) throw Error('缺少查询编辑器');
      const offset = model.getValue().indexOf(statement) + delta;
      instance!.setPosition(model.getPositionAt(offset));
      return offset;
    }, {statement, delta});
    async function step() {
      const id = 'execute-current-next';
      await expect.poll(() => desktop.evaluate(({Menu}, id) => Menu.getApplicationMenu()?.getMenuItemById(id)?.enabled === true, id)).toBe(true);
      await desktop.evaluate(({Menu, BrowserWindow}, {id, label}) => {
        const item = Menu.getApplicationMenu()?.getMenuItemById(id);
        const [owner, extra] = BrowserWindow.getAllWindows();
        if (!item?.enabled || item.label !== label || !owner || extra) throw Error('逐句执行原生菜单不可用');
        item.click(item, owner, {} as Electron.KeyboardEvent);
      }, {id, label: uiCommandLabels[id]});
    }
    const stepsBefore = await history();
    await place(firstStep, 8);
    await step();
    await expect(query.getByRole('grid')).toContainText('步进第一句');
    await expect.poll(async () => (await selection()).start).toBe((await selection()).sql.indexOf(failedStep));
    const afterFirst = (await history()).filter(entry => !stepsBefore.some(before => before.id === entry.id));
    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0].sql.trim().replace(/;$/, '')).toBe(firstStep);
    await step();
    await expect(query.locator('.error-box')).toBeVisible();
    await expect.poll(async () => (await selection()).start).toBe((await selection()).sql.indexOf(failedStep));
    const endOffset = await place(lastStep, 9);
    await step();
    await expect(query.getByRole('grid')).toContainText('步进最后一句');
    await expect.poll(async () => (await selection()).start).toBe(endOffset);
    expect((await selection()).sql.replaceAll('\r\n', '\n')).toBe(stepScript);

    const namedQuery = '-- NAME: Summary/Today\nSELECT amount FROM json_subject WHERE id = 1;';
    const workbookSql = [namedQuery, '/* NAME: SUMMARY?TODAY */',
      'SELECT amount FROM json_subject WHERE id = 0;', 'SELECT label FROM json_subject WHERE id = 2;'].join('\n');
    const fullExport = local ? sqliteQueryExportZh : postgresQueryExportZh;
    async function saveQueryFile(format: 'xlsx' | 'json' | 'csv-zip', expectedRows = 2) {
      const extension = format === 'csv-zip' ? 'zip' : format;
      const filePath = join(dataDir, '命名查询结果.' + extension);
      await desktop.evaluate(({ dialog, BrowserWindow }, input) => {
        const original = dialog.showSaveDialog;
        dialog.showSaveDialog = (async (parent: Electron.BaseWindow, options: Electron.SaveDialogOptions) => {
          dialog.showSaveDialog = original;
          if (parent !== BrowserWindow.getAllWindows()[0] || !options.filters?.[0]?.extensions.includes(input.extension))
            throw Error('越过本例查询导出保存范围');
          return { canceled: false, filePath: input.filePath };
        }) as typeof original;
      }, { filePath, extension });
      await (await navigationMenuItem(query, { name: custom ? queryStreamZh.open : fullExport.open, exact: true })).click();
      const dialog = page.getByRole('dialog', { name: custom ? queryStreamZh.title : fullExport.title, exact: true });
      await dialog.getByLabel(custom ? queryStreamZh.format : zh.resultExport.format, { exact: true }).selectOption(format);
      if (custom) {
        const picker = dialog.locator('.file-picker');
        await picker.click();
        await expect(picker).toContainText('命名查询结果.' + extension);
        await dialog.getByRole('checkbox', { name: queryStreamZh.acknowledge, exact: true }).check();
        await dialog.getByRole('button', { name: queryStreamZh.execute, exact: true }).click();
        await expect(dialog.getByText(queryStreamZh.completed, { exact: true })).toBeVisible();
        await expect(dialog.getByRole('region', { name: queryStreamZh.summary, exact: true })).toContainText('Summary/Today');
      } else {
        await dialog.getByRole('button', { name: zh.resultExport.chooseFile, exact: true }).click();
        await dialog.getByRole('button', { name: fullExport.start, exact: true }).click();
        await expect(dialog.getByRole('status')).toHaveText(fullExport.done(expectedRows));
      }
      await dialog.getByRole('button', { name: zh.common.close, exact: true }).click();
      return filePath;
    }
    await write(workbookSql);
    const book = await new ExcelJS.Workbook().xlsx.readFile(await saveQueryFile('xlsx'));
    expect(book.worksheets.map(sheet => [sheet.name, sheet.rowCount])).toEqual([['Summary_Today', 2], ['SUMMARY_TODAY (2)', 1], ['结果 3', 2]]);
    expect(book.worksheets[0].getCell('A2').text).toBe(expectedA.amount);
    expect(book.worksheets[1].getCell('A1').text).toBe('amount');
    expect(book.worksheets[2].getCell('A2').text).toBe('row B');
    if (!local) {
      if (!custom) await write(namedQuery);
      const result = JSON.parse(await readFile(await saveQueryFile('json', custom ? 2 : 1), 'utf8'));
      expect(result).toMatchObject({ format: 'DBArk-query-results', version: 1 });
      expect(result.results.map((entry: { label?: string }) => entry.label)).toEqual(custom
        ? ['Summary/Today', 'SUMMARY?TODAY', undefined] : ['Summary/Today']);
      expect(result.results[0].rows).toEqual([{ amount: expectedA.amount }]);
      if (custom) {
        const files = await readQueryCsvZip(await saveQueryFile('csv-zip'));
        expect([...files.keys()]).toEqual(['results/rows-001.csv', 'results/rows-002.csv', 'results/rows-003.csv', 'manifest.json']);
        const manifest = JSON.parse(files.get('manifest.json')!.toString('utf8'));
        expect(manifest.results.map((entry: { label?: string; rowsWritten: number }) => [entry.label, entry.rowsWritten]))
          .toEqual([['Summary/Today', 1], ['SUMMARY?TODAY', 0], [undefined, 1]]);
        expect(files.get('results/rows-001.csv')!.toString('utf8')).toBe('amount\r\n' + expectedA.amount + '\r\n');
      }
    }
    if (baseline) expect(await readFile(filePath)).toEqual(baseline);
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  }
});
