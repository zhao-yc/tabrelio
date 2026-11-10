import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { sqliteReferenceZh as text } from '../../src/renderer/locales/sqliteReference.zh-CN';
import { sqliteTableEditZh as editText } from '../../src/renderer/locales/sqliteTableEdit.zh-CN';
import { confirmOwnedDesktopExit, dataDir, desktop, expect, page, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });

test('SQLite 按命中格选择外键，复合键一次暂存和提交', async ({}, info) => {
  test.setTimeout(75_000);
  test.skip(process.env.DBARK_SQLITE_CELL_REFERENCE_NATIVE !== '1', '需要显式启用独占 SQLite 外键单元格专项');
  if (process.env.DBARK_DEV_URL || process.env.DBARK_EXECUTABLE_PATH || process.env.DBARK_INTEGRATION_ENABLED !== '0')
    throw Error('仅允许源码应用和本例独占 SQLite 文件');
  const file = join(await realpath(dataDir), 'cell-reference.sqlite');
  const fixture = new DatabaseSync(file);
  try {
    fixture.exec("CREATE TABLE paired(a TEXT,b INTEGER,label TEXT,PRIMARY KEY(a,b)); INSERT INTO paired VALUES('Alpha',1,'原配对'),('Beta',2,'目标配对');" +
      'CREATE TABLE alternative(id INTEGER PRIMARY KEY); INSERT INTO alternative VALUES(1),(2);' +
      'CREATE TABLE distant(id INTEGER PRIMARY KEY); INSERT INTO distant VALUES(9);' +
      'CREATE TABLE child(id INTEGER PRIMARY KEY,a TEXT,b INTEGER,other INTEGER,note TEXT,' +
      'FOREIGN KEY(A,b) REFERENCES paired(a,b),FOREIGN KEY(b) REFERENCES alternative(id),FOREIGN KEY(other) REFERENCES distant(id));' +
      "INSERT INTO child VALUES(1,'Alpha',1,9,'第一行'),(2,'Alpha',1,9,'第二行');");
  } finally { fixture.close(); }
  const disk = () => {
    const observer = new DatabaseSync(file, { readOnly: true });
    try { return observer.prepare('SELECT id,a,b,other,note FROM child ORDER BY id').all(); }
    finally { observer.close(); }
  };
  const baseline = disk();
  try {
    await desktop.evaluate(({ dialog, BrowserWindow }, file) => {
      const original = dialog.showOpenDialog;
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        dialog.showOpenDialog = original;
        if (args[0] !== BrowserWindow.getAllWindows()[0] || !(args.at(-1) as Electron.OpenDialogOptions).filters?.[0]?.extensions.includes('sqlite'))
          throw Error('越过本例文件授权范围');
        return { canceled: false, filePaths: [file] };
      }) as typeof original;
    }, file);
    await page.evaluate(async () => {
      const id = 'sqlite-cell-reference';
      const file = await window.dbark.invoke('files.choose', { purpose: 'sqlite-database', sqliteConnectionId: id });
      if (!file) throw Error('本例 SQLite 文件未授权');
      const connection = await window.dbark.invoke('connections.save', { id, dialect: 'sqlite', name: 'SQLite 外键专项', group: '', color: '#123456',
        sqlite: { fileToken: file.token, readOnly: false, busyTimeoutMs: 1000 } });
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'cell-reference', tabs: [
        { id: 'cell-reference', kind: 'table', title: 'child', database: 'main', table: 'child', connectionId: connection.id },
      ] });
    });
    await page.reload();
    const tab = page.locator('.sqlite-table-tab:visible'), grid = tab.getByRole('grid', { name: editText.grid, exact: true });
    const picker = page.getByRole('dialog', { name: text.choiceTitle, exact: true });
    const cell = async (field: string, row: number) => {
      const header = grid.getByRole('columnheader', { name: field, exact: true });
      await expect(header).toBeVisible();
      const column = await header.getAttribute('aria-colindex');
      return grid.locator(`[role="row"][aria-rowindex="${row + 1}"] [role="gridcell"][aria-colindex="${column}"]`);
    };
    const option = () => picker.getByRole('combobox', { name: text.constraint, exact: true }).locator('option');
    const catalog = async () => picker.getByRole('button', { name: text.catalog, exact: true }).click();
    const close = async () => {
      await picker.getByRole('button', { name: text.close, exact: true }).click();
      await expect(picker).toHaveCount(0);
    };

    await (await cell('note', 1)).click();
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(picker).toHaveCount(0);
    await (await cell('note', 1)).click({ button: 'right' });
    await expect(page.getByRole('menu')).toBeVisible();
    await expect(page.getByRole('menuitem', { name: text.choiceEntry, exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await (await cell('b', 1)).click();
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(picker.getByText(text.columnScope('b'), { exact: true })).toBeVisible();
    await expect(picker.getByRole('grid')).toHaveCount(0);
    await catalog();
    await expect(option()).toHaveCount(2);
    await expect(option().filter({ hasText: 'distant' })).toHaveCount(0);
    await close();

    await (await cell('a', 1)).click();
    await (await cell('a', 2)).click({ button: 'right' });
    await page.getByRole('menuitem', { name: text.choiceEntry, exact: true }).click();
    await expect(picker.getByText(text.columnScope('a'), { exact: true })).toBeVisible();
    await catalog();
    await expect(option()).toHaveCount(1);
    await expect(option()).toContainText('paired');
    await picker.getByRole('button', { name: text.candidates, exact: true }).click();
    await picker.getByRole('gridcell', { name: '目标配对', exact: true }).click();
    await page.screenshot({ path: info.outputPath('命中列外键候选.png') });
    await picker.getByRole('button', { name: text.stage, exact: true }).click();
    await expect(picker).toHaveCount(0);
    await expect(await cell('a', 1)).toContainText('Alpha');
    await expect(await cell('a', 2)).toContainText('Beta');
    await expect(await cell('b', 2)).toContainText('2');
    expect(disk()).toEqual(baseline);
    await tab.getByRole('button', { name: editText.undo, exact: true }).click();
    await expect(await cell('a', 2)).toContainText('Alpha');
    await expect(await cell('b', 2)).toContainText('1');
    await tab.getByRole('button', { name: editText.redo, exact: true }).click();
    await expect(await cell('a', 2)).toContainText('Beta');

    await (await cell('a', 1)).click();
    await (await navigationMenuItem(tab, { name: text.choiceEntry, exact: true })).click();
    await catalog();
    await expect(option()).toHaveCount(3);
    await close();
    await tab.getByRole('button', { name: editText.preview, exact: true }).click();
    const preview = page.getByRole('dialog', { name: editText.previewTitle, exact: true });
    await expect(preview).toBeVisible();
    expect(disk()).toEqual(baseline);
    await preview.getByRole('checkbox', { name: editText.confirmation, exact: true }).check();
    await preview.getByRole('button', { name: editText.submit, exact: true }).click();
    await expect(preview).toHaveCount(0);
    await expect.poll(disk).toEqual([baseline[0], { id: 2, a: 'Beta', b: 2, other: 9, note: '第二行' }]);
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  }
});
