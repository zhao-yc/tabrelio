import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { confirmOwnedDesktopExit, dataDir, desktop, expect, page, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';
import { gridColumnJumpZh as text } from '../../src/renderer/locales/gridColumnJump.zh-CN';
import { queryResultColumnsZh as layoutText } from '../../src/renderer/locales/queryResultColumns.zh-CN';
import { postgresZh } from '../../src/renderer/locales/postgres.zh-CN';
import { gridHeaderMenuZh as headerText } from '../../src/renderer/locales/gridHeaderMenu.zh-CN';
import { gridRowHeightZh as rowHeightText } from '../../src/renderer/locales/gridRowHeight.zh-CN';
import { queryResultPresetsZh as presetsText } from '../../src/renderer/locales/queryResultPresets.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import type { NetworkConnectionProfile, PostgresConnectionProfile } from '../../src/shared/contracts';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });

test('宽表可跳到可见边缘并扩选，按列定位或独立冻结字段', async ({}, info) => {
  const dialect = process.env.DBARK_COLUMN_JUMP_DIALECT;
  test.skip(!dialect, '需要显式启用列定位专项');
  const local = dialect === 'sqlite';
  const database = local ? 'main' : process.env.DBARK_COLUMN_JUMP_DATABASE ?? '';
  const port = Number(process.env.DBARK_COLUMN_JUMP_PORT);
  const password = process.env.DBARK_COLUMN_JUMP_PASSWORD ?? '';
  if (process.env.DBARK_DEV_URL || process.env.DBARK_EXECUTABLE_PATH ||
      (local ? process.env.DBARK_INTEGRATION_ENABLED !== '0' :
        process.env.DBARK_INTEGRATION_ENABLED !== '1' || !['postgresql', 'mysql', 'mariadb'].includes(dialect!) ||
        !/^tabrelio_cj_[a-f0-9]{12}$/.test(database) || !/^[a-f0-9]{64}$/.test(password) ||
        !Number.isInteger(port) || port <= 1024 || port > 65535)) throw Error('仅允许本例 SQLite 文件或独占回环实库');
  const table = 'jump_subject', filePath = join(await realpath(dataDir), 'column-jump.sqlite');
  if (local) {
    const fixture = new DatabaseSync(filePath);
    try {
      const wide = Array.from({ length: 20 }, (_, index) => 'col_' + (index + 1) + ' TEXT').join(',');
      fixture.exec('CREATE TABLE jump_subject (id INTEGER PRIMARY KEY, label TEXT,' + wide +
        ', tail_one TEXT, tail_two TEXT); INSERT INTO jump_subject(id,label,tail_one,tail_two) VALUES' +
        " (1,'row A','tail-one-A','tail-two-A'),(2,'row B','tail-one-B','tail-two-B');" +
        'CREATE VIEW jump_view AS SELECT * FROM jump_subject;');
    } finally { fixture.close(); }
  }
  const baseline = local ? await readFile(filePath) : undefined;
  const profile: NetworkConnectionProfile | PostgresConnectionProfile | undefined = local ? undefined : {
    id: '', dialect: dialect as (NetworkConnectionProfile | PostgresConnectionProfile)['dialect'], name: dialect!, group: '', color: '#123456',
    host: '127.0.0.1', port, database, user: database, password, rememberPassword: false,
  };
  const fields = ['id', 'label', ...Array.from({ length: 20 }, (_, index) => 'col_' + (index + 1)),
    'tail_one AS repeated', 'tail_two AS repeated'].join(', ');
  const sql = 'SELECT ' + fields + ' FROM jump_subject ORDER BY id';
  const empty = 'SELECT ' + fields + ' FROM jump_subject WHERE 1 = 0';
  try {
    await info.attach('本例原 Main 进程', { body: String(await desktop.evaluate(() => process.pid)), contentType: 'text/plain' });
    if (local) await desktop.evaluate(({ dialog, BrowserWindow }, filePath) => {
      const open = dialog.showOpenDialog;
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        dialog.showOpenDialog = open;
        if (args[0] !== BrowserWindow.getAllWindows()[0] || !(args.at(-1) as Electron.OpenDialogOptions).filters?.[0]?.extensions.includes('sqlite'))
          throw Error('越过本例文件选择范围');
        return { canceled: false, filePaths: [filePath] };
      }) as typeof open;
    }, filePath);
    await page.evaluate(async ({ profile, table, sql, empty, database }) => {
      const id = 'jump-sqlite';
      const picked = profile ? undefined : await window.dbark.invoke('files.choose', { purpose: 'sqlite-database', sqliteConnectionId: id });
      if (!profile && !picked) throw Error('本例 SQLite 文件未授权');
      const connection = await window.dbark.invoke('connections.save', profile ?? { id, dialect: 'sqlite', name: 'SQLite', group: '', color: '#123456',
        sqlite: { fileToken: picked!.token, readOnly: false, busyTimeoutMs: 1000 } });
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'jump-table', tabs: [
        { id: 'jump-table', kind: 'table', title: table, connectionId: connection.id, database,
          table: profile?.dialect === 'postgresql' ? '"public"."' + table + '"' : table },
        ...(profile ? [] : [{ id: 'jump-view', kind: 'table' as const, title: 'jump_view', connectionId: connection.id, database, table: 'jump_view' }]),
        { id: 'jump-query', kind: 'query', title: '宽查询结果', connectionId: connection.id, database, sql },
        { id: 'jump-empty', kind: 'query', title: '空结果定位', connectionId: connection.id, database, sql: empty },
      ] });
    }, { profile, table, sql, empty, database });
    await page.reload();
    const open = (id: string) => page.locator('[data-workspace-tab-id="' + id + '"] .tab-select').click();
    const tableTab = page.locator('.table-tab:visible, .postgres-table-tab:visible');
    const query = page.locator('.query-tab:visible');
    const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
    const header = (scope: typeof query, index: number) => scope.locator('[role="columnheader"][aria-colindex="' + index + '"]');
    const menuAction = (name: string) => page.getByRole('menuitem', { name, exact: true });
    const openHeader = async (scope: typeof query, cell: typeof query) => {
      const index = Number(await cell.getAttribute('aria-colindex'));
      await header(scope, index).click({ button: 'right' });
    };
    const assertFrozen = async (scope: typeof query, start: number, count: number) => {
      const grid = scope.getByRole('grid');
      await grid.evaluate(element => { element.scrollLeft = 0; });
      const left: number[] = [];
      for (let i = 0; i < count; i++) {
        await expect(header(scope, start + i)).toHaveClass(/rdg-cell-frozen-start/);
        left.push((await header(scope, start + i).boundingBox())!.x);
      }
      await expect(header(scope, start + count)).not.toHaveClass(/rdg-cell-frozen-start/);
      await grid.evaluate(element => { element.scrollLeft = 520; });
      await expect.poll(() => grid.evaluate(element => element.scrollLeft)).toBeGreaterThan(400);
      for (let i = 0; i < count; i++)
        await expect.poll(async () => Math.abs((await header(scope, start + i).boundingBox())!.x - left[i])).toBeLessThan(2);
    };
    const choose = async (scope: typeof query, search: string) => {
      const button = scope.getByRole('button', { name: text.open, exact: true });
      await button.click();
      const input = scope.getByRole('textbox', { name: text.search, exact: true });
      await expect(input).toBeFocused();
      await input.fill(search);
      return input;
    };
    /** 起点与末列分开定位，验证横向虚拟列和纵向焦点都使用数据格坐标。 */
    async function checkGridEdges(scope: typeof query, label: typeof query, tail: typeof query, firstTail: typeof query) {
      const focused = scope.locator('[role="gridcell"]:focus');
      const firstColumn = Number(await label.getAttribute('aria-colindex')) - 1;
      const row = await label.locator('..').getAttribute('aria-rowindex');
      await label.click();
      await page.keyboard.press('ControlOrMeta+ArrowLeft');
      await expect(focused).toHaveAttribute('aria-colindex', String(firstColumn));
      await expect(focused.locator('..')).toHaveAttribute('aria-rowindex', row!);
      await page.keyboard.press('ControlOrMeta+ArrowRight');
      await expect(tail).toBeFocused();
      await page.keyboard.press('ControlOrMeta+Home');
      await expect(firstTail).toBeFocused();
      await page.keyboard.press('ControlOrMeta+PageDown');
      await expect(tail).toBeFocused();
      await page.keyboard.press('ControlOrMeta+Shift+PageUp');
      await expect(firstTail).toBeFocused();
      await expect(firstTail).toHaveClass(/\bgrid-cell-in-range\b/);
      await expect(tail).toHaveClass(/\bgrid-cell-in-range\b/);
      await page.keyboard.press('ControlOrMeta+Shift+ArrowLeft');
      await expect(focused).toHaveAttribute('aria-colindex', String(firstColumn));
      await expect(focused).toHaveClass(/\bgrid-cell-in-range\b/);
      // 到达同一首列时，普通跳转也应收起原矩形。
      await page.keyboard.press('ControlOrMeta+ArrowLeft');
      await expect(focused).not.toHaveClass(/\bgrid-cell-in-range\b/);
      await page.keyboard.press('ControlOrMeta+ArrowRight');
      await expect(firstTail).toBeFocused();
      await expect(firstTail).not.toHaveClass(/\bgrid-cell-in-range\b/);
      await page.keyboard.press('ControlOrMeta+End');
      await expect(tail).toBeFocused();
      await page.keyboard.press('Control+ArrowUp');
      await expect(firstTail).toBeFocused();
      await page.keyboard.press('Control+ArrowDown');
      await expect(tail).toBeFocused();
    }
    for (const tab of local ? ['jump-table', 'jump-view'] : ['jump-table']) {
      if (tab === 'jump-view') await open(tab);
      const label = tableTab.getByRole('gridcell').filter({ hasText: /^(TEXT · )?row B$/ });
      await expect(label).toBeVisible();
      const first = Number(await label.getAttribute('aria-colindex')) - 1;
      const row = label.locator('..');
      const selected = row.getByRole('checkbox');
      await selected.check();
      await label.click();
      const target = tableTab.getByRole('gridcell').filter({ hasText: /^(TEXT · )?tail-two-B$/ });
      await expect(target).toHaveCount(0);
      const input = await choose(tableTab, 'TAIL_TWO');
      await input.press('Enter');
      await expect(target).toBeFocused();
      await expect(target.locator('..').getByRole('checkbox')).toBeChecked();
      // 同坐标再次定位也应把焦点从搜索框送回原格。
      await (await choose(tableTab, '#24')).press('Enter');
      await expect(target).toBeFocused();
      await page.keyboard.press('ControlOrMeta+ArrowLeft');
      const tailA = tableTab.getByRole('gridcell').filter({ hasText: /^(TEXT · )?tail-two-A$/ });
      await checkGridEdges(tableTab, label, target, tailA);
      await expect(target.locator('..').getByRole('checkbox')).toBeChecked();
      // 冻结远端列后，当前勾选和两条原数据应仍属于同一行。
      await openHeader(tableTab, target);
      await menuAction(headerText.freezeColumn).click();
      await expect(header(tableTab, first)).toContainText('tail_two');
      await expect(target).toHaveAttribute('aria-colindex', String(first));
      await expect(target.locator('..').getByRole('checkbox')).toBeChecked();
      await assertFrozen(tableTab, first, 1);
      await header(tableTab, first).click({ button: 'right' });
      await expect(menuAction(headerText.freezeColumn)).toBeDisabled();
      await menuAction(headerText.unfreeze).click();
      await expect(header(tableTab, first)).not.toHaveClass(/rdg-cell-frozen-start/);
    }
    await open('jump-query');
    const execute = async () => {
      await expect(query.locator('.monaco-editor').getByRole('textbox')).toBeVisible();
      if (dialect === 'postgresql') await query.getByRole('button', { name: postgresZh.execute, exact: true }).click();
      else await query.locator('.query-execute-split button.primary').click();
    };
    await execute();
    const rowB = query.getByRole('gridcell', { name: 'row B', exact: true });
    await rowB.click();
    await expect.poll(async () => (await history()).map(entry => entry.success)).toEqual([true]);
    const before = await history();
    const input = await choose(query, 'repeated');
    const go = query.getByRole('button', { name: text.go, exact: true });
    await expect(go).toBeDisabled();
    const matches = query.getByRole('combobox', { name: text.matches, exact: true });
    await expect(matches.getByRole('option')).toHaveText([text.choose, text.option(23, 'repeated'), text.option(24, 'repeated')]);
    await matches.selectOption({ label: text.option(24, 'repeated') });
    await go.click();
    await expect(input).toHaveCount(0);
    await expect(query.getByRole('gridcell', { name: 'tail-two-B', exact: true })).toBeFocused();
    await page.screenshot({ path: info.outputPath('跳到可见列.png') });
    await page.keyboard.press('ControlOrMeta+ArrowLeft');
    const tailB = query.getByRole('gridcell', { name: 'tail-two-B', exact: true });
    const tailA = query.getByRole('gridcell', { name: 'tail-two-A', exact: true });
    await checkGridEdges(query, rowB, tailB, tailA);
    await page.keyboard.press('ControlOrMeta+Shift+Home');
    await expect(tailA).toBeFocused();
    await page.screenshot({ path: info.outputPath('网格边缘扩选.png') });
    await page.keyboard.press('Escape');
    await (await navigationMenuItem(query, { name: layoutText.open, exact: true })).click();
    const layout = page.getByRole('dialog', { name: layoutText.title, exact: true });
    await layout.getByRole('checkbox', { name: layoutText.visible(22), exact: true }).uncheck();
    await layout.getByRole('checkbox', { name: layoutText.visible(24), exact: true }).uncheck();
    await layout.getByRole('button', { name: layoutText.apply, exact: true }).click();
    await expect(layout).toBeHidden();
    const noMatch = await choose(query, 'col_20');
    await expect(matches).toBeDisabled();
    await expect(go).toBeDisabled();
    await noMatch.press('Escape');
    await expect(query.getByRole('button', { name: text.open, exact: true })).toBeFocused();
    await (await choose(query, 'label')).press('Enter');
    await rowB.click();
    await page.keyboard.press('ControlOrMeta+ArrowRight');
    await expect(query.getByRole('gridcell', { name: 'tail-one-B', exact: true })).toBeFocused();
    // 恢复隐藏列，再从两个同名标题中冻结第二个，依原列键核对而非比较别名。
    await openHeader(query, query.getByRole('gridcell', { name: 'tail-one-B', exact: true }));
    await menuAction(headerText.showAllColumns).click();
    await (await choose(query, '#24')).press('Enter');
    await expect(tailB).toHaveAttribute('aria-colindex', '25');
    await openHeader(query, tailB);
    await menuAction(headerText.freezeColumn).click();
    await expect(tailB).toHaveAttribute('aria-colindex', '2');
    await assertFrozen(query, 2, 1);
    await (await choose(query, '#24')).press('Enter');
    const other = query.getByRole('gridcell', { name: 'tail-one-B', exact: true });
    await expect(other).toHaveAttribute('aria-colindex', '25');
    await openHeader(query, other);
    await menuAction(headerText.freezeColumn).click();
    await expect(other).toHaveAttribute('aria-colindex', '3');
    await expect(tailB).toHaveAttribute('aria-colindex', '2');
    await assertFrozen(query, 2, 2);
    await page.screenshot({ path: info.outputPath('独立冻结同名结果列.png') });
    expect(await history()).toEqual(before);

    // 完整方案从实际列布局保存，随后在同一 SQL 新执行的默认布局上恢复。
    await (await navigationMenuItem(query, { name: layoutText.open, exact: true })).click();
    await layout.getByRole('checkbox', { name: layoutText.visible(3), exact: true }).uncheck();
    await layout.getByRole('textbox', { name: layoutText.width(24), exact: true }).fill('238');
    await layout.getByRole('combobox', { name: rowHeightText.label, exact: true }).selectOption('56');
    await layout.getByRole('button', { name: layoutText.apply, exact: true }).click();
    await query.getByRole('grid').evaluate(element => { element.scrollLeft = 0; });
    await header(query, 4).click({ button: 'right' });
    await menuAction(headerText.desc).click();
    const firstRow = query.locator('[role="row"][aria-rowindex="2"]');
    await expect(firstRow.getByRole('gridcell', { name: 'tail-two-B', exact: true })).toBeVisible();
    const presets = page.getByRole('dialog', { name: presetsText.title, exact: true });
    await (await navigationMenuItem(query, { name: presetsText.open, exact: true })).click();
    await presets.getByRole('textbox', { name: presetsText.name, exact: true }).fill('宽查询固定布局');
    await presets.getByRole('button', { name: presetsText.create, exact: true }).click();
    const preview = presets.getByRole('region', { name: presetsText.preview, exact: true });
    await preview.getByText(presetsText.layout, { exact: true }).click();
    await expect(preview.getByText(presetsText.layoutColumn(24, 'repeated', 238), { exact: true })).toBeVisible();
    await expect(preview.getByText(presetsText.layoutRowHeight(56), { exact: true })).toBeVisible();
    await presets.getByRole('button', { name: zh.common.close, exact: true }).click();
    await execute();
    await expect.poll(async () => (await history()).map(entry => entry.success)).toEqual([true, true]);
    await expect(header(query, 2)).toContainText('id');
    await expect(firstRow.getByRole('gridcell', { name: 'row A', exact: true })).toBeVisible();
    const afterExecute = await history();
    await (await navigationMenuItem(query, { name: presetsText.open, exact: true })).click();
    await presets.getByRole('combobox', { name: presetsText.choose, exact: true }).selectOption({ label: '宽查询固定布局' });
    await presets.getByRole('button', { name: presetsText.apply, exact: true }).click();
    await expect(presets).toBeHidden();
    await expect(firstRow.getByRole('gridcell', { name: 'tail-two-B', exact: true })).toHaveAttribute('aria-colindex', '2');
    await expect(firstRow.getByRole('gridcell', { name: 'tail-one-B', exact: true })).toHaveAttribute('aria-colindex', '3');
    await expect(header(query, 4)).toHaveAttribute('aria-sort', 'descending');
    await expect(header(query, 6)).toContainText('col_2');
    await expect.poll(async () => (await header(query, 2).boundingBox())?.width).toBe(238);
    await expect.poll(async () => (await firstRow.boundingBox())?.height).toBe(56);
    await assertFrozen(query, 2, 2);
    expect(await history()).toEqual(afterExecute);
    await page.screenshot({ path: info.outputPath('整理方案恢复宽表布局.png') });

    await open('jump-empty');
    await execute();
    await expect.poll(async () => (await history()).map(entry => entry.success)).toEqual([true, true, true]);
    await (await choose(query, '#24')).press('Enter');
    await expect(query.getByRole('columnheader').filter({ hasText: /^repeated/i }).last()).toBeFocused();
    await expect(query.getByRole('gridcell')).toHaveCount(0);
    if (baseline) expect(await readFile(filePath)).toEqual(baseline);
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  }
});
