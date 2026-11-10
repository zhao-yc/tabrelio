import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Locator } from '@playwright/test';
import type { NetworkConnectionProfile, PostgresConnectionProfile } from '../../src/shared/contracts';
import { binaryCellZh as text } from '../../src/renderer/locales/binaryCell.zh-CN';
import { postgresZh } from '../../src/renderer/locales/postgres.zh-CN';
import { gridHeaderMenuZh } from '../../src/renderer/locales/gridHeaderMenu.zh-CN';
import { confirmOwnedDesktopExit, dataDir, desktop, expect, page, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { readGridMenuClipboard } from './grid-cell-range-clipboard';
import { navigationMenuItem } from './navigation-menu';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAEElEQVR4nGMQyjoERAwoFABKNwd13jVnlQAAAABJRU5ErkJggg==';
const table = 'grid_image_subject';
const imageName = { name: text.gridImage, exact: true };
const toggleName = { name: text.gridImages, exact: true };

test('网格缩略图显示真实像素，关闭恢复字节文本并保留原始复制值', async ({}, info) => {
  const dialect = process.env.DBARK_GRID_IMAGES_DIALECT;
  test.skip(!dialect, '需要显式启用网格图片专项');
  const local = dialect === 'sqlite', database = local ? 'main' : process.env.DBARK_GRID_IMAGES_DATABASE ?? '';
  const port = Number(process.env.DBARK_GRID_IMAGES_PORT), password = process.env.DBARK_GRID_IMAGES_PASSWORD ?? '';
  if (process.env.DBARK_DEV_URL || process.env.DBARK_EXECUTABLE_PATH || (local ? process.env.DBARK_INTEGRATION_ENABLED !== '0' :
    process.env.DBARK_INTEGRATION_ENABLED !== '1' || !['postgresql', 'mysql', 'mariadb'].includes(dialect!) ||
    !/^tabrelio_cn_[a-f0-9]{12}$/.test(database) || !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535)) {
    throw Error('仅允许本例 SQLite 文件或独占回环实库');
  }
  const file = join(await realpath(dataDir), 'grid-images.sqlite');
  if (local) {
    const fixture = new DatabaseSync(file);
    try {
      fixture.exec('CREATE TABLE grid_image_subject(id INTEGER PRIMARY KEY, picture BLOB, other BLOB); CREATE VIEW grid_image_view AS SELECT * FROM grid_image_subject;');
      const insert = fixture.prepare('INSERT INTO grid_image_subject VALUES(?, ?, ?)');
      insert.run(1, Buffer.from(png, 'base64'), Buffer.from('<svg onload="window.__gridImageExecuted=true"/>'));
      insert.run(2, Buffer.from(png, 'base64').subarray(0, 24), Buffer.alloc(0));
    } finally { fixture.close(); }
  }
  const baseline = local ? await readFile(file) : undefined;
  const profile: NetworkConnectionProfile | PostgresConnectionProfile | undefined = local ? undefined : {
    id: '', dialect: dialect as (NetworkConnectionProfile | PostgresConnectionProfile)['dialect'], name: dialect!, group: '', color: '#123456',
    host: '127.0.0.1', port, database, user: database, password, rememberPassword: false,
  };
  try {
    if (local) await desktop.evaluate(({ dialog, BrowserWindow }, file) => {
      const original = dialog.showOpenDialog;
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        dialog.showOpenDialog = original;
        if (args[0] !== BrowserWindow.getAllWindows()[0] || !(args.at(-1) as Electron.OpenDialogOptions).filters?.[0]?.extensions.includes('sqlite')) throw Error('越过本例文件授权范围');
        return { canceled: false, filePaths: [file] };
      }) as typeof original;
    }, file);
    await page.evaluate(async ({ profile, database, table }) => {
      const id = 'grid-images-sqlite';
      const picked = profile ? undefined : await window.dbark.invoke('files.choose', { purpose: 'sqlite-database', sqliteConnectionId: id });
      if (!profile && !picked) throw Error('本例 SQLite 文件未授权');
      const connection = await window.dbark.invoke('connections.save', profile ?? {
        id, dialect: 'sqlite', name: 'SQLite', group: '', color: '#123456', sqlite: { fileToken: picked!.token, readOnly: false, busyTimeoutMs: 1000 },
      });
      const settings = await window.dbark.invoke('settings.get', {});
      const binding = { connectionId: connection.id, database };
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'image-table', tabs: [
        { ...binding, id: 'image-table', kind: 'table', title: table, table: profile?.dialect === 'postgresql' ? '"public"."' + table + '"' : table },
        ...(profile ? [] : [{ ...binding, id: 'image-view', kind: 'table' as const, title: 'grid_image_view', table: 'grid_image_view' }]),
        { ...binding, id: 'image-query', kind: 'query', title: '图片网格结果', sql: 'SELECT id, picture, other FROM ' + table + ' ORDER BY id' },
      ] });
    }, { profile, database, table });
    await page.reload();
    const tab = page.locator('.table-tab:visible, .postgres-table-tab:visible');
    const open = (id: string) => page.locator('[data-workspace-tab-id="' + id + '"] .tab-select').click();
    const imageHeader = (scope: Locator) => scope.getByRole('columnheader').filter({ hasText: /^picture/i });
    const validCell = async (scope: Locator) => {
      const header = imageHeader(scope);
      await expect(header).toBeVisible();
      const index = await header.getAttribute('aria-colindex');
      return scope.locator('[role="row"][aria-rowindex="2"]').getByRole('gridcell').and(scope.locator('[aria-colindex="' + index + '"]'));
    };
    const assertPicture = async (scope: Locator) => {
      const cell = await validCell(scope), image = cell.getByRole('img', imageName);
      await expect(image).toBeVisible();
      await expect(scope.getByRole('img', imageName)).toHaveCount(1);
      expect(await image.evaluate((node: HTMLCanvasElement) => {
        const { width, height } = node.getBoundingClientRect();
        return { visible: width > 0 && height > 0, pixel: [...node.getContext('2d')!.getImageData(36, 24, 1, 1).data] };
      })).toEqual({ visible: true, pixel: [18, 106, 194, 255] });
    };
    const toggle = async (scope: Locator) => (await navigationMenuItem(scope, toggleName)).click();
    const cell = await validCell(tab);
    await expect(cell).toContainText('89504e47', { ignoreCase: true });
    const original = await cell.textContent();
    await expect(tab.getByRole('img', imageName)).toHaveCount(0);
    await toggle(tab);
    await assertPicture(tab);
    await imageHeader(tab).click({ button: 'right' });
    const copy = await readGridMenuClipboard(page, page.getByRole('menuitem', { name: gridHeaderMenuZh.copyColumnData, exact: true }));
    const expectedHex = Buffer.from(png, 'base64').toString('hex');
    expect(copy.text.toLowerCase()).toContain(expectedHex);
    await page.screenshot({ path: info.outputPath('表数据缩略图.png') });
    await toggle(tab);
    await expect(cell.getByRole('img', imageName)).toHaveCount(0);
    await expect(cell).toHaveText(original!);

    if (local) {
      await open('image-view');
      await expect(imageHeader(tab)).toBeVisible();
      await toggle(tab);
      await assertPicture(tab);
      await page.screenshot({ path: info.outputPath('SQLite只读视图缩略图.png') });
    }

    await open('image-query');
    const query = page.locator('.query-tab:visible');
    if (dialect === 'postgresql') await query.getByRole('button', { name: postgresZh.execute, exact: true }).click();
    else await query.locator('.query-execute-split button.primary').click();
    await expect(imageHeader(query)).toBeVisible();
    await expect(query.getByRole('img', imageName)).toHaveCount(0);
    const queryToggle = query.getByRole('button', toggleName);
    await queryToggle.click();
    await expect(queryToggle).toHaveAttribute('aria-pressed', 'true');
    await assertPicture(query);
    await page.screenshot({ path: info.outputPath('查询结果缩略图.png') });
    await queryToggle.click();
    await expect(query.getByRole('img', imageName)).toHaveCount(0);
    expect(await page.evaluate(() => Object.hasOwn(window, '__gridImageExecuted'))).toBe(false);
    if (baseline) expect(await readFile(file)).toEqual(baseline);
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  }
});
