import { readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { navigationMenuItem } from './navigation-menu';
import type { NetworkConnectionProfile, PostgresConnectionProfile } from '../../src/shared/contracts';
import { confirmOwnedDesktopExit, dataDir, desktop, expect, page, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { gridCellFileZh as text } from '../../src/renderer/locales/gridCellFile.zh-CN';
import { binaryCellFileText, textCellFileTitle } from '../../src/shared/binaryCellFiles';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });

async function mockSaveDialog(title: string, name: string, target?: string): Promise<void> {
  await desktop.evaluate(({ dialog, BrowserWindow }, expected) => {
    const original = dialog.showSaveDialog;
    dialog.showSaveDialog = (async (...args: unknown[]) => {
      dialog.showSaveDialog = original;
      const options = args.at(-1) as Electron.SaveDialogOptions;
      if (args[0] !== BrowserWindow.getAllWindows()[0] || options.title !== expected.title || options.defaultPath !== expected.name)
        throw Error('另存对话框目标或文件名不匹配');
      return expected.target ? { canceled: false, filePath: expected.target } : { canceled: true };
    }) as typeof original;
  }, { title, name, target });
}

test('从 SQLite 表格、只读视图及查询结果另存活动格原值', async ({}, info) => {
  test.skip(process.env.DBARK_GRID_CELL_FILE_NATIVE !== '1', '需要显式启用单元格另存专项');
  if (process.env.DBARK_DEV_URL || process.env.DBARK_EXECUTABLE_PATH || process.env.DBARK_INTEGRATION_ENABLED !== '0')
    throw Error('仅允许源码应用和本例专用临时文件');
  const root = await realpath(dataDir);
  const database = join(root, 'grid-cell-file.sqlite');
  const textPath = join(root, '文本.txt'), imagePath = join(root, '原图.png'), emptyPath = join(root, '空.txt'), numericPath = join(root, '数字.txt');
  const value = '汉字\0\r\n🚢';
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD8sAAAAASUVORK5CYII=', 'base64');
  const fixture = new DatabaseSync(database);
  try {
    fixture.exec('CREATE TABLE cells(id INTEGER PRIMARY KEY, memo TEXT, image BLOB, empty TEXT, nil TEXT); CREATE VIEW cells_view AS SELECT * FROM cells;');
    fixture.prepare('INSERT INTO cells VALUES(?,?,?,?,?)').run(9007199254740993n, value, png, '', null);
  } finally { fixture.close(); }
  const baseline = await readFile(database);
  await writeFile(textPath, '已存在文件');
  try {
    await desktop.evaluate(({ dialog, BrowserWindow }, database) => {
      const original = dialog.showOpenDialog;
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        dialog.showOpenDialog = original;
        if (args[0] !== BrowserWindow.getAllWindows()[0] || !(args.at(-1) as Electron.OpenDialogOptions).filters?.[0]?.extensions.includes('sqlite'))
          throw Error('越过本例文件选择范围');
        return { canceled: false, filePaths: [database] };
      }) as typeof original;
    }, database);
    await page.evaluate(async () => {
      const id = 'sqlite-grid-cell-file';
      const picked = await window.dbark.invoke('files.choose', { purpose: 'sqlite-database', sqliteConnectionId: id });
      if (!picked) throw Error('本例 SQLite 文件未授权');
      const connection = await window.dbark.invoke('connections.save', { id, dialect: 'sqlite', name: 'SQLite',
        group: '', color: '#123456', sqlite: { fileToken: picked.token, readOnly: false, busyTimeoutMs: 1000 } });
      const settings = await window.dbark.invoke('settings.get', {});
      const target = { connectionId: connection.id, database: 'main' };
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'file-table', tabs: [
        { id: 'file-table', kind: 'table', title: 'cells', table: 'cells', ...target },
        { id: 'file-view', kind: 'table', title: 'cells_view', table: 'cells_view', ...target },
        { id: 'file-query', kind: 'query', title: '文件验收查询', sql: 'SELECT id FROM cells', ...target },
      ] });
    });
    await page.reload();
    const selectTab = (id: string) => page.locator('[data-workspace-tab-id="' + id + '"] .tab-select').click();
    const save = page.getByRole('button', { name: text.action, exact: true });
    const editable = page.locator('.sqlite-table-tab:visible');
    const rows = (scope = editable) => scope.getByRole('row', { name: /9007199254740993/ });
    const openSave = async (title: string, name: string, target?: string) => {
      await mockSaveDialog(title, name, target);
      await save.click();
    };
    const cell = (column: number) => rows().locator(`[role="gridcell"][aria-colindex="${column}"]`);
    await cell(4).click();
    await openSave(textCellFileTitle, 'cell.txt', textPath);
    await expect.poll(() => readFile(textPath)).toEqual(Buffer.from(value));
    await openSave(textCellFileTitle, 'cell.txt', database);
    await expect(page.getByText('导出目标属于已保存的SQLite数据库或日志文件，请选择其他文件', { exact: true })).toBeVisible();
    expect(await readFile(database)).toEqual(baseline);
    await cell(5).click();
    await openSave(binaryCellFileText.saveTitle, 'cell.png', imagePath);
    await expect.poll(() => readFile(imagePath).catch(() => undefined)).toEqual(png);
    await cell(7).click();
    await save.click();
    await expect(page.getByText(text.noValue, { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('单元格另存.png') });

    await selectTab('file-view');
    await cell(5).click();
    await openSave(textCellFileTitle, 'cell.txt', emptyPath);
    await expect.poll(() => readFile(emptyPath).catch(() => undefined)).toEqual(Buffer.alloc(0));
    await selectTab('file-query');
    const query = page.locator('.query-tab:visible');
    await query.locator('.query-execute-split button.primary').click();
    await rows(query).getByRole('gridcell', { name: '9007199254740993', exact: true }).click();
    await openSave(textCellFileTitle, 'cell.txt');
    await openSave(textCellFileTitle, 'cell.txt', numericPath);
    await expect.poll(() => readFile(numericPath, 'utf8').catch(() => undefined)).toBe('9007199254740993');
    expect(await readFile(database)).toEqual(baseline);
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  }
});

test('从网络数据库表格另存文本及原始 BLOB 字节', async ({}, info) => {
  const dialect = process.env.DBARK_GRID_CELL_FILE_DIALECT;
  test.skip(!dialect, '需要显式启用独占网络数据库另存专项');
  const database = process.env.DBARK_GRID_CELL_FILE_DATABASE ?? '';
  const port = Number(process.env.DBARK_GRID_CELL_FILE_PORT);
  const password = process.env.DBARK_GRID_CELL_FILE_PASSWORD ?? '';
  if (process.env.DBARK_DEV_URL || process.env.DBARK_EXECUTABLE_PATH || process.env.DBARK_INTEGRATION_ENABLED !== '1' ||
      !['postgresql', 'mysql', 'mariadb'].includes(dialect!) || !/^tabrelio_cf_[a-f0-9]{12}$/.test(database) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535)
    throw Error('仅允许本例独占回环实库');
  const profile: NetworkConnectionProfile | PostgresConnectionProfile = {
    id: '', dialect: dialect as NetworkConnectionProfile['dialect'] | PostgresConnectionProfile['dialect'],
    name: dialect!, group: '', color: '#123456', host: '127.0.0.1', port, database, user: database, password, rememberPassword: false,
  };
  try {
    await page.evaluate(async profile => {
      const connection = await window.dbark.invoke('connections.save', profile);
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'file-table', tabs: [
        { id: 'file-table', kind: 'table', title: 'update_subject', connectionId: connection.id, database: profile.database,
          table: profile.dialect === 'postgresql' ? '"public"."update_subject"' : 'update_subject' },
      ] });
    }, profile);
    await page.reload();
    const root = await realpath(dataDir);
    const tab = page.locator('.table-tab:visible, .postgres-table-tab:visible');
    const save = async (title: string, name: string, path: string) => {
      await mockSaveDialog(title, name, path);
      await (await navigationMenuItem(tab, { name: text.action, exact: true })).click();
    };
    const label = tab.getByRole('gridcell', { name: 'row A', exact: true });
    const labelPath = join(root, '网络文本.txt');
    await label.click();
    await save(textCellFileTitle, 'cell.txt', labelPath);
    await expect.poll(() => readFile(labelPath, 'utf8').catch(() => undefined)).toBe('row A');

    const header = tab.getByRole('columnheader').filter({ hasText: /^payload/ });
    const column = await header.getAttribute('aria-colindex');
    expect(column).toMatch(/^\d+$/);
    const binary = label.locator('..').locator(`[role="gridcell"][aria-colindex="${column}"]`);
    const bytesPath = join(root, '网络二进制.bin');
    await binary.click();
    await save(binaryCellFileText.saveTitle, 'cell.bin', bytesPath);
    await expect.poll(() => readFile(bytesPath).catch(() => undefined)).toEqual(Buffer.from([0, 255]));
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  }
});
