import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { confirmOwnedDesktopExit, dataDir, desktop, expect, page, pageErrors, restartOwnedDesktop, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';
import { readGridRangeClipboard } from './grid-cell-range-clipboard';
import { tableHeaderCopyZh as text } from '../../src/renderer/locales/tableHeaderCopy.zh-CN';
import { gridRangeCopyZh as range } from '../../src/renderer/locales/gridRangeCopy.zh-CN';
import { gridHeaderMenuZh as headerText } from '../../src/renderer/locales/gridHeaderMenu.zh-CN';
import { queryResultColumnsZh as columnsText } from '../../src/renderer/locales/queryResultColumns.zh-CN';
import { gridRowHeightZh as rowHeightText } from '../../src/renderer/locales/gridRowHeight.zh-CN';
import { postgresZh } from '../../src/renderer/locales/postgres.zh-CN';
import { sqliteTableLayoutZh } from '../../src/renderer/locales/sqliteTableLayout.zh-CN';
import { postgresTableLayoutZh } from '../../src/renderer/locales/postgresTableLayout.zh-CN';
import { tableGridZh } from '../../src/renderer/locales/tableGrid.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import { copyInsertSqlZh } from '../../src/shared/copyInsertSql.zh-CN';
import { updateSqlCopyZh } from '../../src/renderer/locales/updateSqlCopy.zh-CN';
import type { NetworkConnectionProfile, PostgresConnectionProfile } from '../../src/shared/contracts';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });

test('无需选行即可复制表格和空查询结果的可见列名', async ({}, info) => {
  const dialect = process.env.DBARK_COLUMN_NAMES_DIALECT;
  test.skip(!dialect, '需要显式启用仅复制列名专项');
  const local = dialect === 'sqlite';
  const database = local ? 'main' : process.env.DBARK_COLUMN_NAMES_DATABASE ?? '';
  const port = Number(process.env.DBARK_COLUMN_NAMES_PORT);
  const password = process.env.DBARK_COLUMN_NAMES_PASSWORD ?? '';
  if (process.env.DBARK_DEV_URL || process.env.DBARK_EXECUTABLE_PATH ||
      (local ? process.env.DBARK_INTEGRATION_ENABLED !== '0' :
        process.env.DBARK_INTEGRATION_ENABLED !== '1' || !['postgresql', 'mysql', 'mariadb'].includes(dialect!) ||
        !/^tabrelio_cn_[a-f0-9]{12}$/.test(database) || !/^[a-f0-9]{64}$/.test(password) ||
        !Number.isInteger(port) || port <= 1024 || port > 65535)) throw Error('仅允许本例 SQLite 文件或独占回环实库');
  const table = 'header_subject', filePath = join(await realpath(dataDir), 'column-names.sqlite');
  if (local) {
    const fixture = new DatabaseSync(filePath);
    try {
      fixture.exec("CREATE TABLE header_subject (id INTEGER PRIMARY KEY, amount INTEGER, label TEXT, payload BLOB, nullable TEXT);" +
        "INSERT INTO header_subject VALUES (1,9007199254740993,'row A',X'00ff',NULL),(2,9007199254740994,'row B',X'','');" +
        'CREATE VIEW header_view AS SELECT * FROM header_subject;');
    } finally { fixture.close(); }
  }
  const baseline = local ? await readFile(filePath) : undefined;
  const profile: NetworkConnectionProfile | PostgresConnectionProfile | undefined = local ? undefined : {
    id: '', dialect: dialect as (NetworkConnectionProfile | PostgresConnectionProfile)['dialect'], name: dialect!, group: '', color: '#123456',
    host: '127.0.0.1', port, database, user: database, password, rememberPassword: false,
  };
  const projection = 'SELECT id AS duplicate, label AS duplicate, amount AS third, nullable AS hidden FROM header_subject';
  const sql = projection + ' WHERE 1 = 0';
  const populatedSql = projection + ' ORDER BY id';
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
    await page.evaluate(async ({ profile, table, sql, populatedSql, database }) => {
      const id = 'header-sqlite';
      const picked = profile ? undefined : await window.dbark.invoke('files.choose', { purpose: 'sqlite-database', sqliteConnectionId: id });
      if (!profile && !picked) throw Error('本例 SQLite 文件未授权');
      const connection = await window.dbark.invoke('connections.save', profile ?? { id, dialect: 'sqlite', name: 'SQLite', group: '', color: '#123456',
        sqlite: { fileToken: picked!.token, readOnly: false, busyTimeoutMs: 1000 } });
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'header-table', tabs: [
        { id: 'header-table', kind: 'table', title: table, connectionId: connection.id, database,
          table: profile?.dialect === 'postgresql' ? '"public"."' + table + '"' : table },
        ...(profile ? [] : [{ id: 'header-view', kind: 'table' as const, title: 'header_view', connectionId: connection.id, database, table: 'header_view' }]),
        { id: 'header-query', kind: 'query', title: '查询结果列名', connectionId: connection.id, database, sql },
        { id: 'range-query', kind: 'query', title: '查询选区列名', connectionId: connection.id, database, sql: populatedSql },
        ...(profile?.dialect === 'postgresql' ? [{ id: 'row-sql-query', kind: 'query' as const, title: '查询结果行标题', connectionId: connection.id,
          database, sql: 'SELECT id, amount, label, payload, nullable FROM public.header_subject ORDER BY id' }] : []),
      ] });
    }, { profile, table, sql, populatedSql, database });
    await page.reload();
    await page.evaluate(() => {
      const packets: { text: string; formats: string[] }[] = [];
      // 只收集当前渲染器发出的真实 copy 事件，隔离系统剪贴板。
      Object.defineProperty(document, 'execCommand', { configurable: true, value(command: string) {
        if (command !== 'copy') throw Error('仅允许本例复制动作');
        const data = new DataTransfer();
        document.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }));
        packets.push({ text: data.getData('text/plain'), formats: [...data.types] });
        return true;
      } });
      Object.assign(globalThis, { columnNamesPackets: packets });
    });
    const packets = () => page.evaluate(() => (globalThis as typeof globalThis & {
      columnNamesPackets: { text: string; formats: string[] }[];
    }).columnNamesPackets);
    const copy = async (scope: ReturnType<typeof page.locator>, count: number) => {
      await (await navigationMenuItem(scope, { name: text.names, exact: true })).click();
      const data = await packets();
      expect(data).toHaveLength(count);
      expect(data.at(-1)?.formats).toEqual(['text/plain']);
      return data.at(-1)!.text;
    };
    const open = (id: string) => page.locator('[data-workspace-tab-id="' + id + '"] .tab-select').click();
    const tableTab = page.locator('.table-tab:visible, .postgres-table-tab:visible');
    const header = tableTab.getByRole('columnheader').filter({ hasText: /^amount/i });
    const tableNames = 'id\tamount\tlabel\tpayload\tnullable';
    await expect(header).toBeVisible();
    expect(await copy(tableTab, 1)).toBe(tableNames);
    let count = 1;
    const indexedCell = (scope: ReturnType<typeof page.locator>, row: number, column: number) =>
      scope.locator(`[role="row"][aria-rowindex="${row}"] [role="gridcell"][aria-colindex="${column}"]`);
    const copyRange = async (start: ReturnType<typeof page.locator>, end: ReturnType<typeof page.locator>, expected: string, keyboard: boolean) => {
      await start.click();
      await end.click({ modifiers: ['Shift'] });
      if (keyboard) await page.keyboard.press('Shift+F10');
      else await start.click({ button: 'right' });
      const action = page.getByRole('menuitem', { name: range.namesOnly, exact: true });
      await expect(action).toBeVisible();
      if (keyboard) await action.press('Enter');
      else await action.click();
      expect(await packets()).toHaveLength(++count);
      expect((await packets()).at(-1)).toEqual({ text: expected, formats: ['text/plain'] });
      await expect(end).toBeFocused();
    };
    const amountIndex = Number(await header.getAttribute('aria-colindex'));
    expect(amountIndex).toBeGreaterThan(1);
    await copyRange(indexedCell(tableTab, 3, amountIndex + 1), indexedCell(tableTab, 2, amountIndex), 'amount\tlabel', false);
    const tableActive = indexedCell(tableTab, 2, amountIndex);
    await tableActive.press('ControlOrMeta+a');
    await expect(tableTab.locator('.grid-cell-in-range')).toHaveCount(10);
    await expect(tableActive).toBeFocused();
    await tableActive.press('ControlOrMeta+a');
    await expect(tableTab.locator('.grid-cell-in-range')).toHaveCount(0);
    const widthOf = async (column: ReturnType<typeof page.locator>) => (await column.boundingBox())?.width;
    const widthDialog = page.getByRole('dialog', { name: headerText.setWidth, exact: true });
    const widthField = widthDialog.getByRole('textbox', { name: headerText.width, exact: true });
    const applyWidth = widthDialog.getByRole('button', { name: headerText.applyWidth, exact: true });
    const openWidth = async (column: ReturnType<typeof page.locator>, keyboard = false) => {
      if (keyboard) await column.press('Shift+F10');
      else await column.click({ button: 'right' });
      await page.getByRole('menuitem', { name: headerText.setWidth, exact: true }).click();
      await expect(widthField).toBeFocused();
    };
    await openWidth(header);
    await widthField.fill('239');
    await widthField.press('Enter');
    await expect(widthDialog).toBeHidden();
    await expect.poll(() => widthOf(header)).toBe(239);
    const layoutEntry = local ? sqliteTableLayoutZh.entry : dialect === 'postgresql' ? postgresTableLayoutZh.entry : tableGridZh.preferences;
    const layoutTitle = local ? sqliteTableLayoutZh.title : dialect === 'postgresql' ? postgresTableLayoutZh.title : tableGridZh.preferences;
    const heightDialog = page.getByRole('dialog', { name: headerText.setHeight, exact: true });
    const heightInput = heightDialog.getByRole('textbox', { name: headerText.height, exact: true });
    const applyHeight = heightDialog.getByRole('button', { name: headerText.applyHeight, exact: true });
    const openHeight = async (rowHeader: ReturnType<typeof page.locator>, keyboard = false) => {
      if (keyboard) await rowHeader.press('Shift+F10');
      else await rowHeader.click({ button: 'right' });
      await page.getByRole('menu', { name: headerText.rowMenu, exact: true }).getByRole('menuitem', { name: headerText.setHeight, exact: true }).click();
      await expect(heightInput).toBeFocused();
    };
    const tableGrid = tableTab.getByRole('grid');
    const tableRow = tableGrid.getByRole('row').nth(1);
    const rowHeader = local ? indexedCell(tableGrid, 2, 2).getByRole('button') : tableRow.getByRole('checkbox');
    await openHeight(rowHeader);
    await expect(heightInput).toHaveValue('32');
    await heightInput.fill('67');
    await heightInput.press('Enter');
    await expect(heightDialog).toBeHidden();
    await expect(tableRow.getByRole('checkbox')).not.toBeChecked();
    await expect.poll(async () => (await tableRow.boundingBox())?.height).toBe(67);
    await (await navigationMenuItem(tableTab, { name: layoutEntry, exact: true })).click();
    const tableLayout = page.getByRole('dialog', { name: layoutTitle, exact: true });
    await expect(tableLayout.getByRole('textbox', { name: rowHeightText.exact, exact: true })).toHaveValue('67');
    await expect(tableLayout.getByText(tableGridZh.unsaved, { exact: true })).toBeVisible();
    await tableLayout.getByRole('button', { name: tableGridZh.save, exact: true }).click();
    await expect(tableLayout.getByText(tableGridZh.saved, { exact: true })).toBeVisible();
    await tableLayout.getByRole('button', { name: zh.common.close, exact: true }).last().click();
    await expect(tableLayout).toBeHidden();
    await expect.poll(async () => (await tableTab.getByRole('grid').getByRole('row').nth(1).boundingBox())?.height).toBe(67);
    const firstCheck = tableRow.getByRole('checkbox');
    const secondCheck = tableGrid.getByRole('row').nth(2).getByRole('checkbox');
    const secondHeader = local ? indexedCell(tableGrid, 3, 2).getByRole('button') : secondCheck;
    const rowMenu = page.getByRole('menu', { name: headerText.rowMenu, exact: true });
    const sqlAction = (name: string) => rowMenu.getByRole('menuitem', { name, exact: true });
    const copySql = async (name: string) => {
      await sqlAction(name).click();
      const data = await packets();
      expect(data, (await page.getByRole('alert').allTextContents()).join('\n')).toHaveLength(++count);
      expect(data.at(-1)?.formats).toEqual(['text/plain']);
      return data.at(-1)!.text;
    };
    await firstCheck.check();
    await secondHeader.click({ button: 'right' });
    const one = await copySql(copyInsertSqlZh.current);
    expect(one).toMatch(/^INSERT INTO /);
    expect(one).toContain('9007199254740994');
    expect(one).not.toContain('9007199254740993');
    await expect(firstCheck).toBeChecked();
    await expect(secondCheck).not.toBeChecked();
    await secondCheck.check();
    await secondHeader.press('Shift+F10');
    await expect(sqlAction(updateSqlCopyZh.selected)).toBeVisible();
    await page.screenshot({ path: info.outputPath('行标题复制SQL.png') });
    const two = await copySql(updateSqlCopyZh.selected);
    expect(two.match(/^UPDATE /gm)).toHaveLength(2);
    expect(two.match(/^WHERE /gm)).toHaveLength(2);
    expect(two).toContain('9007199254740993');
    expect(two).toContain('9007199254740994');
    await expect(firstCheck).toBeChecked();
    await expect(secondCheck).toBeChecked();
    await expect(secondHeader).toBeFocused();
    await firstCheck.uncheck();
    await secondCheck.uncheck();
    if (local) {
      await open('header-view');
      await expect(header).toBeVisible();
      expect(await copy(tableTab, ++count)).toBe(tableNames);
    }
    await open('header-query');
    const query = page.locator('.query-tab:visible');
    await expect(query.locator('.monaco-editor').getByRole('textbox')).toBeVisible();
    const execute = () => dialect === 'postgresql'
      ? query.getByRole('button', { name: postgresZh.execute, exact: true }).click()
      : query.locator('.query-execute-split button.primary').click();
    await execute();
    const grid = query.locator('.query-result-grid').getByRole('grid');
    const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
    await expect(grid.getByRole('columnheader').filter({ hasText: /^duplicate/i })).toHaveCount(2);
    await expect(grid.getByRole('gridcell')).toHaveCount(0);
    await expect.poll(async () => (await history()).map(entry => entry.success)).toEqual([true]);
    const historyBefore = await history();
    expect(await copy(query, ++count)).toBe('duplicate\tduplicate\tthird\thidden');
    const layout = page.getByRole('dialog', { name: columnsText.title, exact: true });
    const arrange = async () => {
      await (await navigationMenuItem(query, { name: columnsText.open, exact: true })).click();
      await layout.getByRole('checkbox', { name: columnsText.visible(4), exact: true }).uncheck();
      for (let index = 0; index < 2; index++)
        await layout.getByRole('button', { name: columnsText.up(3), exact: true }).click();
      await layout.getByRole('button', { name: columnsText.apply, exact: true }).click();
      await expect(layout).toBeHidden();
    };
    await arrange();
    expect(await copy(query, ++count)).toBe('third\tduplicate\tduplicate');
    await page.screenshot({ path: info.outputPath('仅复制列名.png') });
    expect(await history()).toEqual(historyBefore);
    await open('range-query');
    await execute();
    await expect(grid.getByRole('columnheader').filter({ hasText: /^duplicate/i })).toHaveCount(2);
    await arrange();
    const names = await grid.getByRole('columnheader').filter({ hasText: /^duplicate/i }).all();
    const first = Number(await names[0].getAttribute('aria-colindex'));
    const last = Number(await names[1].getAttribute('aria-colindex'));
    await copyRange(indexedCell(grid, 3, last), indexedCell(grid, 2, first), 'duplicate\tduplicate', true);
    await page.keyboard.press('Shift+F10');
    await expect(page.getByRole('menuitem', { name: range.namesOnly, exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('选区列名.png') });
    await page.keyboard.press('Escape');

    const checkedRow = grid.getByRole('row').nth(2).getByRole('checkbox');
    await checkedRow.check();
    const active = indexedCell(grid, 2, first);
    const inRange = grid.locator('.grid-cell-in-range');
    await active.click();
    await desktop.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      const modifiers: Electron.KeyboardInputEvent['modifiers'] = [process.platform === 'darwin' ? 'meta' : 'control'];
      // 通过宿主窗口输入，让快捷键经过 Electron 菜单和 Chromium 的真实事件路径。
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'A', modifiers });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'A', modifiers });
    });
    await expect(inRange).toHaveCount(6);
    await expect(active).toBeFocused();
    await expect(checkedRow).toBeChecked();
    expect((await readGridRangeClipboard(page)).text).toBe('9007199254740993\t1\trow A\n9007199254740994\t2\trow B');
    await page.screenshot({ path: info.outputPath('全部可见单元格.png') });
    await page.keyboard.press('ControlOrMeta+a');
    await expect(inRange).toHaveCount(0);
    await expect(checkedRow).toBeChecked();
    await expect(active).toBeFocused();
    await page.keyboard.press('Shift+F10');
    await page.getByRole('menuitem', { name: range.selectAll, exact: true }).click();
    await expect(inRange).toHaveCount(6);
    await expect(active).toBeFocused();
    const otherWidth = await widthOf(names[0]);
    const originalWidth = await widthOf(names[1]);
    const historyBeforeWidth = await history();
    await openWidth(names[1], true);
    await expect(widthField).toHaveValue(String(originalWidth));
    await widthField.fill('2001');
    await expect(applyWidth).toBeDisabled();
    await widthField.press('Escape');
    await expect(widthDialog).toBeHidden();
    await expect(names[1]).toBeFocused();
    expect(await widthOf(names[1])).toBe(originalWidth);
    await openWidth(names[1], true);
    await widthField.fill('287');
    await page.screenshot({ path: info.outputPath('列标题设置列宽.png') });
    await applyWidth.click();
    await expect(widthDialog).toBeHidden();
    await expect.poll(() => widthOf(names[1])).toBe(287);
    expect(await widthOf(names[0])).toBe(otherWidth);
    await expect(checkedRow).toBeChecked();
    expect(await history()).toEqual(historyBeforeWidth);
    await openHeight(checkedRow, true);
    for (const invalid of ['23', '121', '73.5']) {
      await heightInput.fill(invalid);
      await expect(applyHeight).toBeDisabled();
    }
    await heightInput.press('Escape');
    await expect(heightDialog).toBeHidden();
    await expect(checkedRow).toBeFocused();
    await expect(grid).toHaveClass(/grid-row-height-32/);
    await openHeight(checkedRow, true);
    await heightInput.fill('73');
    await page.screenshot({ path: info.outputPath('行标题设置行高.png') });
    await applyHeight.click();
    await expect(heightDialog).toBeHidden();
    await expect(grid).toHaveClass(/grid-row-height-73/);
    await expect.poll(async () => (await grid.getByRole('row').nth(1).boundingBox())?.height).toBe(73);
    await expect.poll(() => widthOf(names[1])).toBe(287);
    await expect(checkedRow).toBeChecked();
    await expect(checkedRow).toBeFocused();
    expect(await history()).toEqual(historyBeforeWidth);
    await page.screenshot({ path: info.outputPath('自定义行高应用.png') });
    if (dialect === 'postgresql') {
      await open('row-sql-query');
      await execute();
      const queryRow = grid.getByRole('row').nth(2).getByRole('checkbox');
      await expect(grid.getByRole('gridcell').filter({ hasText: '9007199254740994' })).toBeVisible();
      await queryRow.scrollIntoViewIfNeeded();
      await queryRow.focus();
      await expect(queryRow).toBeFocused();
      await page.keyboard.press('Shift+F10');
      const sql = await copySql(updateSqlCopyZh.current);
      expect(sql).toMatch(/^UPDATE /);
      expect(sql.match(/^WHERE /gm)).toHaveLength(1);
      expect(sql).toContain('9007199254740994');
      expect(sql).not.toContain('9007199254740993');
      await expect(queryRow).not.toBeChecked();
    }
    if (baseline) expect(await readFile(filePath)).toEqual(baseline);
    expect(pageErrors).toEqual([]);
    if (local) {
      await open('header-table');
      await expect(header).toBeVisible();
      await expect.poll(async () => (await page.evaluate(() => window.dbark.invoke('settings.get', {}))).activeTabId).toBe('header-table');
      await confirmOwnedDesktopExit(info);
      const restarted = await restartOwnedDesktop(info);
      const restored = restarted.page.locator('.sqlite-table-tab:visible').getByRole('grid');
      await expect(restored).toHaveClass(/grid-row-height-67/);
      await expect.poll(async () => (await restored.getByRole('row').nth(1).boundingBox())?.height).toBe(67);
      await expect.poll(async () => (await restored.getByRole('columnheader').filter({ hasText: /^amount/i }).boundingBox())?.width).toBe(239);
      await restarted.page.screenshot({ path: info.outputPath('SQLite重启恢复行高.png') });
      expect(await readFile(filePath)).toEqual(baseline);
      expect(pageErrors).toEqual([]);
    }
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  }
});
