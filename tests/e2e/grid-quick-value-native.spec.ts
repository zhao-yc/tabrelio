import { readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Locator } from '@playwright/test';
import { confirmOwnedDesktopExit, dataDir, desktop, expect, page, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';
import { pasteGridRangeClipboard } from './grid-cell-range-clipboard';
import type { NetworkConnectionProfile, PostgresConnectionProfile } from '../../src/shared/contracts';
import { gridQuickValueZh as text } from '../../src/renderer/locales/gridQuickValue.zh-CN';
import { gridCellEditZh } from '../../src/renderer/locales/gridCellEdit.zh-CN';
import { gridRangeFillZh as rangeText } from '../../src/renderer/locales/gridRangeFill.zh-CN';
import { recordViewZh } from '../../src/renderer/locales/recordViews.zh-CN';
import { sqliteTableEditZh as sqliteText } from '../../src/renderer/locales/sqliteTableEdit.zh-CN';
import { draftHistoryZh } from '../../src/renderer/locales/draftHistory.zh-CN';
import { postgresTableZh } from '../../src/renderer/locales/postgresTable.zh-CN';
import { postgresZh } from '../../src/renderer/locales/postgres.zh-CN';
import { postgresResultOriginsZh } from '../../src/renderer/locales/postgresResultOrigins.zh-CN';
import { mysqlQueryBatchEditZh } from '../../src/renderer/locales/mysqlQueryBatchEdit.zh-CN';
import { tableCellFilterZh } from '../../src/renderer/locales/tableCellFilter.zh-CN';
import { sqliteTableCellFilterZh } from '../../src/renderer/locales/sqliteTableCellFilter.zh-CN';
import { sqliteTableBrowseZh } from '../../src/renderer/locales/sqliteTableBrowse.zh-CN';
import { sqliteTableRangePasteZh } from '../../src/renderer/locales/sqliteTableRangePaste.zh-CN';
import { gridRangePasteZh } from '../../src/renderer/locales/gridRangePaste.zh-CN';
import { encodeSqliteClipboard } from '../../src/renderer/sqliteTableClipboard';
import { zh } from '../../src/renderer/locales/zh-CN';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });

test('网格赋值和末页混合粘贴可撤销并集中提交', async ({}, info) => {
  const dialect = process.env.DBARK_GRID_QUICK_VALUE_DIALECT;
  test.skip(!dialect, '需要显式启用隔离单元格暂存专项');
  const local = dialect === 'sqlite', database = local ? 'main' : process.env.DBARK_GRID_QUICK_VALUE_DATABASE ?? '';
  const port = Number(process.env.DBARK_GRID_QUICK_VALUE_PORT), password = process.env.DBARK_GRID_QUICK_VALUE_PASSWORD ?? '';
  if (process.env.DBARK_DEV_URL || process.env.DBARK_EXECUTABLE_PATH ||
      (local ? process.env.DBARK_INTEGRATION_ENABLED !== '0' : process.env.DBARK_INTEGRATION_ENABLED !== '1' ||
        !['postgresql', 'mysql', 'mariadb'].includes(dialect!) || !/^tabrelio_qu_[a-f0-9]{12}$/.test(database) ||
        !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535))
    throw Error('仅允许本例独占 SQLite 文件或回环实库');
  const file = join(await realpath(dataDir), 'grid-quick-value.sqlite');
  if (local) {
    const fixture = new DatabaseSync(file);
    try {
      fixture.exec("CREATE TABLE update_subject(id INTEGER PRIMARY KEY, label TEXT, numeric_value INTEGER NOT NULL, uuid_value TEXT, derived INTEGER GENERATED ALWAYS AS (length(label)) STORED); INSERT INTO update_subject(id,label,numeric_value,uuid_value) VALUES(1,'row A',17,NULL),(2,'row B',18,NULL);");
    } finally { fixture.close(); }
  }
  const baseline = local ? await readFile(file) : undefined;
  const profile: NetworkConnectionProfile | PostgresConnectionProfile | undefined = local ? undefined : {
    id: '', dialect: dialect as NetworkConnectionProfile['dialect'] | PostgresConnectionProfile['dialect'],
    name: dialect!, group: '', color: '#123456', host: '127.0.0.1', port, database, user: database, password, rememberPassword: false,
  };
  try {
    if (local) await desktop.evaluate(({ dialog, BrowserWindow }, file) => {
      const original = dialog.showOpenDialog;
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        dialog.showOpenDialog = original;
        if (args[0] !== BrowserWindow.getAllWindows()[0] || !(args.at(-1) as Electron.OpenDialogOptions).filters?.[0]?.extensions.includes('sqlite'))
          throw Error('越过本例文件选择范围');
        return { canceled: false, filePaths: [file] };
      }) as typeof original;
    }, file);
    await page.evaluate(async ({ profile, database }) => {
      const id = 'sqlite-grid-quick-value';
      const picked = profile ? undefined : await window.dbark.invoke('files.choose', { purpose: 'sqlite-database', sqliteConnectionId: id });
      if (!profile && !picked) throw Error('本例 SQLite 文件未授权');
      const connection = await window.dbark.invoke('connections.save', profile ?? { id, dialect: 'sqlite', name: 'SQLite',
        group: '', color: '#123456', sqlite: { fileToken: picked!.token, readOnly: false, busyTimeoutMs: 1000 } });
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'quick-value', tabs: [
        { id: 'quick-value', kind: 'table', title: 'update_subject', connectionId: connection.id, database,
          table: profile?.dialect === 'postgresql' ? '"public"."update_subject"' : 'update_subject' },
        ...(profile ? [{
          id: 'quick-fill-query', kind: 'query' as const, title: '选区填充查询', connectionId: connection.id, database,
          sql: 'SELECT id, scope, label FROM ' + (profile.dialect === 'postgresql' ? 'public.update_subject' : 'update_subject') +
            " WHERE label <> 'child' ORDER BY id, scope;",
        }] : []),
      ] });
    }, { profile, database });
    await page.reload();
    const tab = page.locator('.table-tab:visible, .postgres-table-tab:visible');
    const grid = tab.getByRole('grid');
    const label = grid.getByRole('gridcell').filter({ hasText: /^(TEXT · )?row A$/ });
    const other = grid.getByRole('gridcell').filter({ hasText: /^(TEXT · )?row B$/ });
    await expect(label).toBeVisible();
    const rowIndex = await label.locator('..').getAttribute('aria-rowindex');
    const columnIndex = await label.getAttribute('aria-colindex');
    const cell = grid.locator(`[role="row"][aria-rowindex="${rowIndex}"] > [role="gridcell"][aria-colindex="${columnIndex}"]`);
    const action = (name: string): Promise<Locator> => navigationMenuItem(tab, { name, exact: true });
    const clickAction = async (name: string) => (await action(name)).click();
    const undo = local ? sqliteText.undo : draftHistoryZh.undo;
    const jobs = () => page.evaluate(async () => (await window.dbark.invoke('tasks.list', {})).map(task => task.id).sort());
    const menu = page.getByRole('menu', { name: /^(单元格操作|单元格筛选)$/ });
    const item = (name: string) => menu.getByRole('menuitem', { name, exact: true });
    if (dialect !== 'postgresql') {
      const beforeFilter = await jobs();
      await other.click();
      await cell.click({ button: 'right' });
      await page.screenshot({ path: info.outputPath('右键按原值筛选.png') });
      await item(local ? sqliteTableCellFilterZh.exclude : tableCellFilterZh.exclude).click();
      const input = tab.getByLabel(local ? sqliteTableBrowseZh.filterValue(1) : zh.table.text011, { exact: true });
      await expect(input).toHaveValue('row A');
      await expect(label).toBeVisible();
      expect(await jobs()).toEqual(beforeFilter);
      await clickAction(local ? sqliteTableBrowseZh.apply : zh.table.text013);
      await expect(label).toBeHidden();
      await expect(other).toBeVisible();
      if (local) {
        await clickAction(sqliteTableBrowseZh.clearFilterDraft);
        await clickAction(sqliteTableBrowseZh.apply);
      } else await clickAction(zh.table.filterRemoveCondition.replace('{0}', '1'));
      await expect(label).toBeVisible();
      await clickAction(local ? sqliteTableBrowseZh.conditions : zh.table.text006);
    }
    const before = await jobs();
    const pg = dialect === 'postgresql';
    const editInput = page.getByRole('textbox', {
      name: local ? sqliteText.value('label') : pg ? postgresTableZh.value : 'label · ' + recordViewZh.value, exact: true,
    });
    const stage = page.getByRole('button', {
      name: local ? sqliteText.saveInput : pg ? postgresTableZh.stage : recordViewZh.stageCell, exact: true,
    });
    const cancel = page.getByRole('button', {
      name: local ? sqliteText.cancelInput : pg ? postgresTableZh.cancel : recordViewZh.closeCell, exact: true,
    });
    // 右键命中的行与先前活动行不同，快捷键再次打开后须读取刚暂存的完整原文。
    await other.click();
    await cell.click({ button: 'right' });
    await item(gridCellEditZh.open).click();
    await expect(editInput).toHaveValue('row A');
    const multiline = 'row A\n暂存的第二行';
    await editInput.fill(multiline);
    await page.screenshot({ path: info.outputPath('从右键打开单元格编辑器.png') });
    await stage.click();
    await expect(editInput).toBeHidden();
    await cell.click();
    await expect(cell).toBeFocused();
    await page.keyboard.press('Alt+Enter');
    await expect(editInput).toHaveValue(multiline);
    await cancel.click();
    await clickAction(undo);
    await expect(cell).toHaveText(local ? 'TEXT · row A' : 'row A');
    await expect(other).toBeVisible();
    await cell.click();
    await page.keyboard.press('Shift+ArrowRight');
    await expect(cell).toHaveClass(/grid-cell-in-range/);
    await page.keyboard.press('Alt+Enter');
    await expect(editInput).toBeHidden();
    await expect(cell).toHaveClass(/grid-cell-in-range/);
    await other.click();
    expect(await jobs()).toEqual(before);

    const rangePanel = tab.getByRole('region', { name: rangeText.open, exact: true });
    const rangeValue = rangePanel.getByRole('textbox', { name: rangeText.value, exact: true });
    await cell.click();
    await page.keyboard.press('Shift+ArrowDown');
    await expect(other).toHaveClass(/grid-cell-in-range/);
    await page.keyboard.press('X');
    await expect(rangeValue).toBeFocused();
    await expect(rangeValue).toHaveValue('X');
    await page.keyboard.type('YZ');
    await expect(rangeValue).toHaveValue('XYZ');
    await page.keyboard.press('Escape');
    await expect(rangePanel).toBeHidden();
    await expect(other).toBeFocused();
    await expect(cell).toHaveText(local ? 'TEXT · row A' : 'row A');

    await page.keyboard.press('F2');
    await expect(rangeValue).toHaveValue('');
    await rangeValue.fill('统一草稿');
    await rangeValue.dispatchEvent('compositionstart', { data: '统一草稿' });
    await page.keyboard.press('Enter');
    await expect(rangePanel).toBeVisible();
    await expect(other).toHaveText(local ? 'TEXT · row B' : 'row B');
    await rangeValue.dispatchEvent('compositionend', { data: '统一草稿' });
    await rangeValue.fill('统一草稿');
    await page.screenshot({ path: info.outputPath('键盘打开选区填充.png') });
    await page.keyboard.press('Enter');
    await expect(rangePanel).toBeHidden();
    const filled = local ? 'TEXT · 统一草稿' : '统一草稿';
    await expect(cell).toHaveText(filled);
    await expect(grid.getByRole('gridcell', { name: filled, exact: true })).toHaveCount(2);
    await clickAction(undo);
    await expect(cell).toHaveText(local ? 'TEXT · row A' : 'row A');
    await expect(other).toBeVisible();
    await cell.click();
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('F2');
    await rangeValue.fill('含定位键的选区');
    await page.keyboard.press('Enter');
    await expect(rangePanel.getByRole('alert')).toBeVisible();
    await expect(rangeValue).toHaveValue('含定位键的选区');
    await expect(cell).toHaveText(local ? 'TEXT · row A' : 'row A');
    await page.keyboard.press('Escape');
    await expect(rangePanel).toBeHidden();
    expect(await jobs()).toEqual(before);

    await other.locator('..').getByRole('checkbox').check();
    if (local) {
      await grid.getByRole('gridcell').getByText('INTEGER · 17', { exact: true }).click();
      await expect(await action(text.null)).toBeDisabled();
      await expect(await action(text.empty)).toBeDisabled();
      await page.keyboard.press('Escape');
    }
    await other.click();
    await cell.click({ button: 'right' });
    await expect(menu).toBeVisible();
    if (dialect === 'postgresql') {
      await expect(menu.locator('button[role="menuitem"]:not(:disabled)').first()).toBeFocused();
      await item(tableCellFilterZh.equal).click();
      const advanced = tab.getByRole('region', { name: postgresTableZh.advancedFilter, exact: true });
      await expect(advanced.getByLabel(zh.table.text011, { exact: true })).toHaveValue('row A');
      await clickAction(postgresTableZh.advancedFilter);
      await cell.click({ button: 'right' });
    }
    await page.screenshot({ path: info.outputPath('单元格右键菜单.png') });
    await item(text.null).click();
    await expect(cell).toHaveText('NULL');
    await cell.click();
    await page.keyboard.press('Shift+F10');
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(cell).toBeFocused();
    await page.keyboard.press('Shift+F10');
    await item(text.empty).click();
    await expect(cell).toHaveText(local ? 'TEXT ·' : '');
    await expect(other).toBeVisible();
    await page.screenshot({ path: info.outputPath('活动格暂存空字符串.png') });

    // 重复同值应为无操作，随后一次撤销仍会还原 NULL。
    await cell.click();
    await clickAction(text.empty);
    await clickAction(undo);
    await expect(cell).toHaveText('NULL');
    await clickAction(undo);
    await expect(cell).toHaveText(local ? 'TEXT · row A' : 'row A');

    const namedCell = async (name: string) => {
      const index = await grid.getByRole('columnheader').filter({ hasText: new RegExp('^' + name) }).getAttribute('aria-colindex');
      if (!index) throw Error('验收列位置缺失');
      return grid.locator(`[role="row"][aria-rowindex="${rowIndex}"] > [role="gridcell"][aria-colindex="${index}"]`);
    };
    const generated = await namedCell('derived');
    await generated.click({ button: 'right' });
    await expect(menu).toBeVisible();
    await expect(item(gridCellEditZh.open)).toBeHidden();
    await page.keyboard.press('Escape');
    await generated.click();
    await page.keyboard.press('Alt+Enter');
    await expect(cancel).toBeHidden();
    const restricted = await namedCell(local ? 'numeric_value' : 'scope');
    await restricted.click();
    await expect(await action(text.uuid)).toBeDisabled();
    await page.keyboard.press('Escape');

    const tailLabel = local ? 'row B' : 'row C';
    const tailRow = grid.getByRole('gridcell', { name: local ? 'TEXT · row B' : 'row C', exact: true }).locator('..');
    const idColumn = await grid.getByRole('columnheader').filter({ hasText: /^id/ }).getAttribute('aria-colindex');
    await tailRow.locator(`[role="gridcell"][aria-colindex="${idColumn}"]`).click();
    const mixed = local ? encodeSqliteClipboard([
      [{ kind: 'integer', value: '2' }, { kind: 'text', value: '覆盖末行' }, { kind: 'integer', value: '18' }],
      [{ kind: 'integer', value: '3' }, { kind: 'text', value: '新增末行' }, { kind: 'integer', value: '19' }],
    ]) : '9007199254740994\tB\t覆盖末行\n9007199254740995\tD\t新增末行';
    await pasteGridRangeClipboard(page, mixed);
    if (local) {
      const range = page.getByRole('dialog', { name: sqliteTableRangePasteZh.title, exact: true });
      await range.getByRole('button', { name: sqliteTableRangePasteZh.preview, exact: true }).click();
      await expect(range.getByText(gridRangePasteZh.appendPreview(1), { exact: true })).toBeVisible();
      await page.screenshot({ path: info.outputPath('末页粘贴范围预览.png') });
      await range.getByRole('button', { name: sqliteTableRangePasteZh.stage, exact: true }).click();
      await expect(range).toBeHidden();
    } else await expect(tab.getByText(gridRangePasteZh.appended(1), { exact: !pg })).toBeVisible();
    const overwritten = grid.getByRole('gridcell', { name: local ? 'TEXT · 覆盖末行' : '覆盖末行', exact: true });
    const inserted = pg ? tab.getByRole('button', { name: postgresTableZh.editInsertDraft, exact: true }) :
      grid.getByRole('gridcell', { name: local ? 'TEXT · 新增末行' : '新增末行', exact: true });
    await expect(overwritten).toBeVisible();
    await expect(inserted).toBeVisible();
    await clickAction(undo);
    await expect(overwritten).toBeHidden();
    await expect(inserted).toBeHidden();
    await expect(grid.getByRole('gridcell', { name: local ? 'TEXT · ' + tailLabel : tailLabel, exact: true })).toBeVisible();
    await clickAction(local ? sqliteText.redo : draftHistoryZh.redo);
    await expect(overwritten).toBeVisible();
    await expect(inserted).toBeVisible();

    const uuidCell = await namedCell('uuid_value');
    const uuidPattern = /[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}/;
    const generate = async () => {
      await uuidCell.click();
      await clickAction(text.uuid);
      await expect(uuidCell).toHaveText(uuidPattern);
      return (await uuidCell.textContent())!.match(uuidPattern)![0];
    };
    const first = await generate();
    await clickAction(undo);
    await expect(uuidCell).toHaveText('NULL');
    const second = await generate();
    expect(second).not.toBe(first);
    if (!local) await expect(other).toBeVisible();
    expect(await jobs()).toEqual(before);
    if (baseline) expect(await readFile(file)).toEqual(baseline);
    await page.screenshot({ path: info.outputPath('活动格 UUID 草稿.png') });

    // 只允许向上面的专用 SQLite 文件或独占回环库执行真实确认提交。
    await clickAction(local ? sqliteText.preview : pg ? postgresTableZh.preview : zh.table.text019);
    const review = page.getByRole('dialog', { name: local ? sqliteText.previewTitle : pg ? postgresTableZh.preview : zh.table.text031, exact: true });
    await expect(review).toBeVisible();
    await expect(review).toContainText(/UPDATE\s/iu);
    if (!local && !pg) {
      // Monaco 只渲染当前视口，跳到文档末尾核对同批新增语句。
      const sql = review.locator('.monaco-editor').getByRole('textbox');
      await sql.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
    }
    await expect(review).toContainText(/INSERT\s+INTO/iu);
    await page.screenshot({ path: info.outputPath('覆盖和新增集中预览.png') });
    if (local) await review.getByRole('checkbox', { name: sqliteText.confirmation, exact: true }).check();
    await review.getByRole('button', { name: local ? sqliteText.submit : pg ? postgresTableZh.apply : zh.common.confirmApply, exact: true }).click();
    await expect(review).toBeHidden();
    await expect(uuidCell).toHaveText(uuidPattern);
    expect((await uuidCell.textContent())!.match(uuidPattern)![0]).toBe(second);
    if (local) {
      const check = new DatabaseSync(file, { readOnly: true });
      try {
        const result = check.prepare('SELECT id,label,uuid_value,typeof(uuid_value) AS storage FROM update_subject ORDER BY id').all();
        expect(result.map(row => [row.id, row.label, row.uuid_value, row.storage])).toEqual([
          [1, 'row A', second, 'text'], [2, '覆盖末行', null, 'null'], [3, '新增末行', null, 'null'],
        ]);
      } finally { check.close(); }
    } else {
      await writeFile(info.outputPath('已提交UUID.txt'), second);
      await page.locator('[data-workspace-tab-id="quick-fill-query"]').getByRole('button', { name: '选区填充查询', exact: true }).click();
      const query = page.locator('.query-tab:visible');
      const execute = pg ? query.getByRole('button', { name: postgresZh.execute, exact: true }) :
        query.locator('.query-execute-split > button.primary');
      await execute.click();
      const firstResult = query.getByRole('gridcell', { name: 'row A', exact: true });
      const secondResult = query.getByRole('gridcell', { name: 'row B', exact: true });
      await firstResult.click();
      await page.keyboard.press('Shift+ArrowDown');
      await expect(secondResult).toHaveClass(/grid-cell-in-range/);
      await page.keyboard.press('F2');
      const input = query.getByRole('region', { name: rangeText.open, exact: true })
        .getByRole('textbox', { name: rangeText.value, exact: true });
      await expect(input).toBeFocused();
      await input.fill('查询草稿');
      await input.press('Enter');
      const queryReview = page.getByRole('dialog', {
        name: pg ? postgresResultOriginsZh.fillTitle : mysqlQueryBatchEditZh.fill, exact: true,
      });
      await expect(queryReview.getByText('查询草稿', { exact: true })).toHaveCount(2);
      await page.screenshot({ path: info.outputPath('查询键盘填充预览.png') });
      await queryReview.getByRole('button', {
        name: pg ? postgresResultOriginsZh.editBack : mysqlQueryBatchEditZh.cancel, exact: true,
      }).click();
      await expect(queryReview).toBeHidden();
      await expect(firstResult).toBeVisible();
      await expect(secondResult).toBeVisible();
    }
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  }
});
