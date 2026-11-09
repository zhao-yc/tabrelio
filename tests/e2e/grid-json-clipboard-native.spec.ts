import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { confirmOwnedDesktopExit, dataDir, desktop, expect, page, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';
import { gridJsonClipboardZh as text } from '../../src/renderer/locales/gridJsonClipboard.zh-CN';
import { gridCsvClipboardZh as csvText } from '../../src/renderer/locales/gridCsvClipboard.zh-CN';
import { deleteSqlCopyZh } from '../../src/renderer/locales/deleteSqlCopy.zh-CN';
import { gridQuickValueZh } from '../../src/renderer/locales/gridQuickValue.zh-CN';
import { gridHeaderMenuZh } from '../../src/renderer/locales/gridHeaderMenu.zh-CN';
import { cellClipboardType } from '../../src/renderer/gridClipboard';
import { sqliteCellClipboardType } from '../../src/renderer/sqliteTableClipboard';
import { postgresZh } from '../../src/renderer/locales/postgres.zh-CN';
import { resultSqlZh } from '../../src/shared/resultSql.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import { queryDuplicateZh } from '../../src/renderer/locales/queryDuplicate.zh-CN';
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
        await expect(action).toBeFocused();
        await page.keyboard.press('Enter');
      } else await action.click();
      const packet = await lastPacket();
      expect(packet['text/plain']).toBe(plain);
      expect(JSON.parse(packet[cellClipboardType])).toEqual({ version: 1, rows: [[typed]] });
      if (sqlite === undefined) expect(packet[sqliteCellClipboardType]).toBeUndefined();
      else expect(JSON.parse(packet[sqliteCellClipboardType])).toMatchObject({ version: 1, rows: [[sqlite]] });
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
      await expect(tableTab.getByRole('button', { name: deleteSqlCopyZh.action, exact: true })).toHaveCount(0);
      await tableCell.click();
      expect(await copy(tableTab)).toMatchObject([expectedA]);
      expect(await copyCsv(tableTab)).toBe('id,amount,label,payload,nullable\r\n1,9007199254740993,row A,base64:AP8=,\\N\r\n');
      await menuCopy(tableAmount, expectedA.amount, expectedA.amount);
      await tableBCheck.check();
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
    await rowA.locator('..').getByRole('checkbox').check();
    await rowB.locator('..').getByRole('checkbox').check();
    const aliases = grid.getByRole('columnheader', { name: /^alias\b/ });
    await expect(aliases).toHaveCount(2);
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
    await menuCopy(resultA.getByRole('gridcell', { name: expectedA.amount, exact: true }), expectedA.amount, expectedA.amount, undefined, true);
    await menuCopy(resultA.getByRole('gridcell', { name: 'NULL', exact: true }), null, 'NULL');
    await menuCopy(resultB.getByRole('gridcell').last(), '', '');
    await menuCopy(resultA.getByRole('gridcell', { name: /0x00ff|二进制|BLOB/i }), expectedA.payload, '0x00ff');
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
    expect(await tableSorts()).toEqual(tableSortsBeforeResult);
    expect(await history()).toEqual(historyBefore);
    if (baseline) expect(await readFile(filePath)).toEqual(baseline);
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  }
});
