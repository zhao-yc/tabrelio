import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { answerDialogs, confirmOwnedDesktopExit, dataDir, desktop, expect, page, pageErrors, restartOwnedDesktop, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';
import { sqliteTableBrowseZh as browse } from '../../src/renderer/locales/sqliteTableBrowse.zh-CN';
import { sqliteTableLayoutZh as layout } from '../../src/renderer/locales/sqliteTableLayout.zh-CN';
import { sqliteTablePresetsZh as preset } from '../../src/renderer/locales/sqliteTablePresets.zh-CN';
import { tableGridZh as grid } from '../../src/renderer/locales/tableGrid.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });

test('SQLite 方案在应用后恢复条件和布局，重开后仍使用独立默认布局', async ({}, info) => {
  test.skip(process.env.DBARK_SQLITE_PROFILE_LAYOUT_NATIVE !== '1', '需要显式启用 SQLite 表方案列布局专项');
  if (process.env.DBARK_DEV_URL || process.env.DBARK_EXECUTABLE_PATH || process.env.DBARK_INTEGRATION_ENABLED !== '0')
    throw Error('仅允许构建后的源码应用和本例独占 SQLite 文件');
  const table = 'profile_subject';
  const filePath = join(await realpath(dataDir), 'sqlite-profile-layout.sqlite');
  const fixture = new DatabaseSync(filePath);
  try {
    fixture.exec(`CREATE TABLE profile_subject (id INTEGER PRIMARY KEY, label TEXT, payload TEXT);
      INSERT INTO profile_subject VALUES (1, 'match A', 'extra A'), (2, 'outside', 'extra B'), (3, 'match C', 'extra C');`);
  } finally { fixture.close(); }
  const baseline = await readFile(filePath);
  try {
    await desktop.evaluate(({ dialog, BrowserWindow }, filePath) => {
      const original = dialog.showOpenDialog;
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        dialog.showOpenDialog = original;
        if (args[0] !== BrowserWindow.getAllWindows()[0] || !(args.at(-1) as Electron.OpenDialogOptions).filters?.[0]?.extensions.includes('sqlite'))
          throw Error('越过本例文件选择范围');
        return { canceled: false, filePaths: [filePath] };
      }) as typeof original;
    }, filePath);
    await page.evaluate(async table => {
      const id = 'sqlite-profile-layout';
      const picked = await window.dbark.invoke('files.choose', { purpose: 'sqlite-database', sqliteConnectionId: id });
      if (!picked) throw Error('本例 SQLite 文件未授权');
      const connection = await window.dbark.invoke('connections.save', { id, dialect: 'sqlite', name: 'SQLite',
        group: '', color: '#123456', sqlite: { fileToken: picked.token, readOnly: false, busyTimeoutMs: 1000 } });
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'profile-table',
        tabs: [{ id: 'profile-table', kind: 'table', title: table, connectionId: connection.id, database: 'main', table }] });
    }, table);
    await page.reload();

    const tab = () => page.locator('.sqlite-table-tab:visible');
    const header = (name: string) => tab().getByRole('columnheader').filter({ hasText: new RegExp('^' + name) });
    const labels = () => tab().getByRole('gridcell').filter({ hasText: /match [AC]|outside/ });
    const button = (name: string) => tab().getByRole('button', { name, exact: true });
    const panel = () => tab().getByRole('group', { name: preset.title, exact: true });
    const presetButton = (name: string) => panel().getByRole('button', { name, exact: true });
    const dialog = page.getByRole('dialog', { name: layout.title, exact: true });
    const layoutButton = (name: string) => dialog.getByRole('button', { name, exact: true });
    const payloadToggle = dialog.getByRole('checkbox', { name: grid.visible + ' payload', exact: true });
    const width = dialog.getByRole('spinbutton', { name: grid.width + ' label', exact: true });
    const open = async (name: string) => (await navigationMenuItem(tab(), { name, exact: true })).click();
    const saveDefault = async () => {
      await layoutButton(grid.save).click();
      await expect(dialog.getByText(grid.saved, { exact: true })).toBeVisible();
      await layoutButton(zh.common.close).click();
    };
    await expect(header('payload')).toBeVisible();
    await open(layout.entry);
    await payloadToggle.uncheck();
    await layoutButton(grid.up + ' label').click();
    await width.fill('310');
    await width.press('Tab');
    await saveDefault();
    await expect(header('payload')).toBeHidden();
    await expect(header('label')).toHaveCSS('width', '310px');

    await open(browse.conditions);
    await button(browse.addFilter).click();
    await tab().getByLabel(browse.filterColumn(1), { exact: true }).selectOption('label');
    await tab().getByLabel(browse.filterOperator(1), { exact: true }).selectOption('startsWith');
    await tab().getByLabel(browse.filterValue(1), { exact: true }).fill('match');
    await button(browse.addSort).click();
    await tab().getByLabel(browse.sortColumn(1), { exact: true }).selectOption('id');
    await tab().getByLabel(browse.sortDirection(1), { exact: true }).selectOption('desc');
    await button(preset.entry).click();
    const include = panel().getByRole('checkbox', { name: preset.includeLayout, exact: true });
    await expect(include).not.toBeChecked();
    await include.check();
    const name = '匹配记录与列布局';
    await panel().getByLabel(preset.name, { exact: true }).fill(name);
    await presetButton(preset.save).click();
    await expect(panel().getByText(preset.hasLayout, { exact: true })).toBeVisible();

    await open(layout.entry);
    await payloadToggle.check();
    await layoutButton(grid.down + ' label').click();
    await width.fill('230');
    await width.press('Tab');
    await saveDefault();
    await button(browse.clearFilterDraft).click();
    await button(browse.clearSortDraft).click();
    await button(browse.apply).click();
    await expect(labels()).toHaveText([/match A/, /outside/, /match C/]);
    await expect(header('payload')).toBeVisible();
    await expect(header('label')).toHaveCSS('width', '230px');

    await panel().getByLabel(preset.selection, { exact: true }).selectOption({ label: name });
    await presetButton(preset.load).click();
    await expect(tab().getByText(preset.layoutPending, { exact: true })).toBeVisible();
    await expect(labels()).toHaveText([/match A/, /outside/, /match C/]);
    await expect(header('payload')).toBeVisible();
    await button(browse.restoreAppliedDraft).click();
    await expect(tab().getByText(preset.layoutPending, { exact: true })).toBeHidden();
    await expect(header('label')).toHaveCSS('width', '230px');
    await presetButton(preset.load).click();
    await expect(tab().getByText(preset.layoutPending, { exact: true })).toBeVisible();

    // 用真实拖动制造尚未保存的宽度，分别观察取消与确认两个分支。
    const handle = header('label').locator('.rdg-resize-handle');
    const box = await handle.boundingBox();
    if (!box) throw Error('SQLite 列宽拖动控件不可见');
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 24, y, { steps: 3 });
    await page.mouse.up();
    await expect(header('label')).toHaveCSS('width', '254px');
    const applyReplacingLayout = async (answer: number) => {
      await answerDialogs([answer]);
      const [prompt] = await Promise.all([page.waitForEvent('dialog'), button(browse.apply).click()]);
      expect(prompt.type()).toBe('confirm');
      expect(prompt.message()).toBe(preset.confirmLayout);
    };
    await applyReplacingLayout(1);
    await expect(labels()).toHaveText([/match A/, /outside/, /match C/]);
    await expect(header('label')).toHaveCSS('width', '254px');
    await expect(tab().getByText(preset.layoutPending, { exact: true })).toBeVisible();
    await applyReplacingLayout(0);
    await expect(labels()).toHaveText([/match C/, /match A/]);
    await expect(header('payload')).toBeHidden();
    await expect(header('label')).toHaveCSS('width', '310px');
    await expect(header('label')).toHaveAttribute('aria-colindex', '3');
    await expect(header('id')).toHaveAttribute('aria-colindex', '4');
    await expect(tab().getByText(preset.layoutApplied, { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('SQLite表方案恢复列布局.png') });

    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
    await restartOwnedDesktop(info);
    await expect(labels()).toHaveText([/match A/, /outside/, /match C/]);
    await expect(header('payload')).toBeVisible();
    await expect(header('label')).toHaveCSS('width', '230px');
    await open(browse.conditions);
    await button(preset.entry).click();
    await panel().getByLabel(preset.selection, { exact: true }).selectOption({ label: name });
    await expect(panel().getByText(preset.hasLayout, { exact: true })).toBeVisible();
    expect(await readFile(filePath)).toEqual(baseline);
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  }
});
