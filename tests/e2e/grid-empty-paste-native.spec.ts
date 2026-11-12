import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { confirmOwnedDesktopExit, dataDir, desktop, expect, page, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';
import type { NetworkConnectionProfile, PostgresConnectionProfile } from '../../src/shared/contracts';
import { cellClipboardType, encodeClipboard } from '../../src/renderer/gridClipboard';
import { encodeSqliteClipboard, sqliteCellClipboardType } from '../../src/renderer/sqliteTableClipboard';
import { gridRangePasteZh } from '../../src/renderer/locales/gridRangePaste.zh-CN';
import { pasteInsertZh } from '../../src/renderer/locales/pasteInsert.zh-CN';
import { postgresGridPasteZh } from '../../src/renderer/locales/postgresGridPaste.zh-CN';
import { postgresTableZh } from '../../src/renderer/locales/postgresTable.zh-CN';
import { sqliteTableClipboardZh } from '../../src/renderer/locales/sqliteTableClipboard.zh-CN';
import { sqliteTableEditZh } from '../../src/renderer/locales/sqliteTableEdit.zh-CN';
import { draftHistoryZh } from '../../src/renderer/locales/draftHistory.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });

test('空表从网格粘贴保留来源类型并集中提交', async ({}, info) => {
  const dialect = process.env.DBARK_GRID_EMPTY_PASTE_DIALECT;
  test.skip(!dialect, '需要显式启用空网格粘贴的隔离实库');
  const local = dialect === 'sqlite', pg = dialect === 'postgresql';
  const database = local ? 'main' : process.env.DBARK_GRID_EMPTY_PASTE_DATABASE ?? '';
  const port = Number(process.env.DBARK_GRID_EMPTY_PASTE_PORT), password = process.env.DBARK_GRID_EMPTY_PASTE_PASSWORD ?? '';
  if (process.env.DBARK_DEV_URL || process.env.DBARK_EXECUTABLE_PATH ||
      (local ? process.env.DBARK_INTEGRATION_ENABLED !== '0' : process.env.DBARK_INTEGRATION_ENABLED !== '1' ||
        !['postgresql', 'mysql', 'mariadb'].includes(dialect!) || !/^tabrelio_ep_[a-f0-9]{12}$/.test(database) ||
        !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535))
    throw Error('只允许本例独占 SQLite 文件或回环实库');
  const file = join(dataDir, 'grid-empty-paste.sqlite');
  if (local) {
    const fixture = new DatabaseSync(file);
    try {
      fixture.exec(`CREATE TABLE empty_subject(id INTEGER PRIMARY KEY, label TEXT, untouched TEXT NOT NULL DEFAULT 'fallback');
        CREATE VIEW empty_subject_view AS SELECT DISTINCT id, label, untouched FROM empty_subject WHERE 1=0`);
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
      const id = 'sqlite-grid-empty-paste';
      const picked = profile ? undefined : await window.dbark.invoke('files.choose', { purpose: 'sqlite-database', sqliteConnectionId: id });
      if (!profile && !picked) throw Error('本例 SQLite 文件未授权');
      const connection = await window.dbark.invoke('connections.save', profile ?? { id, dialect: 'sqlite', name: 'SQLite',
        group: '', color: '#123456', sqlite: { fileToken: picked!.token, readOnly: false, busyTimeoutMs: 1000 } });
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'empty_subject_view', tabs:
        ['empty_subject', 'empty_subject_view'].map(table => ({ id: table, kind: 'table' as const, title: table,
          connectionId: connection.id, database, table: profile?.dialect === 'postgresql' ? '"public"."' + table + '"' : table })) });
    }, { profile, database });
    await page.reload();

    const tab = page.locator('.table-tab:visible, .postgres-table-tab:visible');
    const grid = tab.getByRole('grid');
    const target = grid.getByRole('group', { name: gridRangePasteZh.emptyGrid, exact: true });
    await expect(grid.getByText(zh.common.noMatchingData, { exact: true })).toBeVisible();
    await expect(target).toHaveCount(0);
    await page.locator('[data-workspace-tab-id="empty_subject"]').getByRole('button', { name: 'empty_subject', exact: true }).click();
    await expect(target).toBeVisible();

    const firstId = '9007199254740993', secondId = '9007199254740994', literal = '空表粘贴\t原文\n第二行';
    const sqlitePacket = local ? encodeSqliteClipboard([
      [{ kind: 'integer', value: firstId }, { kind: 'null' }],
      [{ kind: 'integer', value: secondId }, { kind: 'text', value: literal }],
    ]) : undefined;
    const content = sqlitePacket ?? encodeClipboard([[firstId, null], [secondId, literal]]);
    const jobs = () => page.evaluate(async () => (await window.dbark.invoke('tasks.list', {})).map(task => task.id).sort());
    const before = await jobs();
    const dialog = page.getByRole('dialog', {
      name: local ? sqliteTableClipboardZh.title : pg ? postgresGridPasteZh.append : pasteInsertZh.action, exact: true,
    });
    const source = dialog.getByRole('textbox', {
      name: local ? sqliteTableClipboardZh.source : pg ? postgresGridPasteZh.source : pasteInsertZh.input, exact: true,
    });
    const paste = () => target.evaluate((element, { plain, typed, mime }) => {
      const data = new DataTransfer();
      data.setData('text/plain', plain);
      data.setData(mime, typed);
      return element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
    }, { plain: content.text, typed: sqlitePacket?.sqlite ?? content.typed,
      mime: local ? sqliteCellClipboardType : cellClipboardType });

    await target.blur();
    expect(await paste()).toBe(true);
    await expect(dialog).toBeHidden();
    await target.click();
    await expect(target).toBeFocused();
    await page.screenshot({ path: info.outputPath('空网格粘贴焦点.png') });
    expect(await paste()).toBe(false);
    await expect(source).toHaveValue(content.text);
    await page.screenshot({ path: info.outputPath('空网格新增输入.png') });
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(target).toBeFocused();
    expect(await jobs()).toEqual(before);

    expect(await paste()).toBe(false);
    await expect(source).toHaveValue(content.text);
    if (!pg) {
      await dialog.getByRole('button', { name: local ? sqliteTableClipboardZh.preview : pasteInsertZh.preview, exact: true }).click();
      await expect(dialog.getByText(firstId, { exact: false }).last()).toBeVisible();
    }
    await dialog.getByRole('button', { name: local ? sqliteTableClipboardZh.stage : pg ? postgresTableZh.stage : pasteInsertZh.stage, exact: true }).click();
    await expect(dialog).toBeHidden();
    const staged = pg ? tab.getByRole('button', { name: postgresTableZh.editInsertDraft, exact: true }) :
      grid.locator('.row-inserted');
    await expect(staged).toHaveCount(2);
    const clickAction = async (name: string) => (await navigationMenuItem(tab, { name, exact: true })).click();
    await clickAction(local ? sqliteTableEditZh.undo : draftHistoryZh.undo);
    await expect(staged).toHaveCount(0);
    await clickAction(local ? sqliteTableEditZh.redo : draftHistoryZh.redo);
    await expect(staged).toHaveCount(2);
    expect(await jobs()).toEqual(before);
    if (baseline) expect(await readFile(file)).toEqual(baseline);

    await clickAction(local ? sqliteTableEditZh.preview : pg ? postgresTableZh.preview : zh.table.text019);
    const review = page.getByRole('dialog', { name: local ? sqliteTableEditZh.previewTitle : pg ? postgresTableZh.preview : zh.table.text031, exact: true });
    await expect(review).toContainText(/INSERT\s+INTO/iu);
    if (local) await review.getByRole('checkbox', { name: sqliteTableEditZh.confirmation, exact: true }).check();
    await review.getByRole('button', { name: local ? sqliteTableEditZh.submit : pg ? postgresTableZh.apply : zh.common.confirmApply, exact: true }).click();
    await expect(review).toBeHidden();
    await expect(target).toBeHidden();
    await expect(grid.getByRole('gridcell', { name: local ? 'INTEGER · ' + firstId : firstId, exact: true })).toBeVisible();
    if (local) {
      const check = new DatabaseSync(file, { readOnly: true });
      try {
        const rows = check.prepare('SELECT CAST(id AS TEXT) AS id,label,untouched FROM empty_subject ORDER BY id').all();
        expect(rows.map(row => [row.id, row.label, row.untouched])).toEqual([[firstId, null, 'fallback'], [secondId, literal, 'fallback']]);
      } finally { check.close(); }
    }
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  }
});
