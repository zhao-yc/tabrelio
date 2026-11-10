import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { confirmOwnedDesktopExit, dataDir, desktop, expect, page, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { queryResultNavigatorZh as text } from '../../src/renderer/locales/queryResultNavigator.zh-CN';
import { queryDuplicateZh as duplicateText } from '../../src/renderer/locales/queryDuplicate.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });
test.skip(process.env.DBARK_QUERY_RESULT_NAVIGATOR_TEST !== '1', '仅在隔离的 SQLite 源码验收运行');

test('多结果查询按名称、字段及序号切换，保持原执行和编辑器正文', async ({}, info) => {
  if (process.env.DBARK_INTEGRATION_ENABLED !== '0' || process.env.DBARK_DEV_URL || process.env.DBARK_EXECUTABLE_PATH)
    throw Error('结果集导航验收只使用本例临时 SQLite 文件');
  try {
    const database = join(realpathSync(dataDir), 'result-navigator.sqlite');
    const fixture = new DatabaseSync(database);
    fixture.exec('CREATE TABLE fixture (id INTEGER PRIMARY KEY)');
    fixture.close();
    const sql = Array.from({ length: 44 }, (_, index) => {
      const number = index + 1;
      const title = number === 2 || number === 42 ? '-- NAME: 月度汇总\n' : '';
      const column = number === 44 ? 'UniqueOutput' : 'sample';
      return `${title}SELECT ${number} AS ${column};`;
    }).join('\n');
    // 只替换文件选择器。连接、执行、缓存及结果切换仍使用正式应用。
    await desktop.evaluate(({ dialog }, file) => {
      const original = dialog.showOpenDialog;
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        dialog.showOpenDialog = original;
        if (!(args.at(-1) as Electron.OpenDialogOptions).filters?.[0]?.extensions.includes('sqlite'))
          throw Error('本例仅允许选择指定 SQLite 文件');
        return { canceled: false, filePaths: [file] };
      }) as typeof original;
    }, database);
    await page.evaluate(async sql => {
      const id = 'result-navigator';
      const file = await window.dbark.invoke('files.choose', { purpose: 'sqlite-database', sqliteConnectionId: id });
      if (!file) throw Error('SQLite 文件选择未完成');
      await window.dbark.invoke('connections.save', { id, name: '结果导航样本', dialect: 'sqlite', group: '', color: '#51bda5',
        sqlite: { fileToken: file.token, readOnly: true, busyTimeoutMs: 1000 } });
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: id, tabs: [
        { id, kind: 'query', title: '多结果查询', connectionId: id, database: 'main', sql },
      ] });
    }, sql);
    await page.reload();
    const tab = page.locator('.query-tab:visible'), trigger = tab.getByRole('button', { name: text.open, exact: true });
    await tab.locator('.query-execute-split').getByRole('button', { name: new RegExp(zh.query.text010) }).first().click();
    await expect(trigger).toBeEnabled();
    const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
    const tasks = () => page.evaluate(() => window.dbark.invoke('tasks.list', {}));
    const originalHistory = await history(), originalTasks = await tasks();
    expect(originalHistory).toHaveLength(1);
    const dialog = page.getByRole('dialog', { name: text.open, exact: true });
    const search = dialog.getByRole('combobox', { name: text.input, exact: true });
    const grid = tab.getByRole('grid');
    await trigger.click();
    await expect(search).toBeFocused();
    await expect(dialog.getByRole('option')).toHaveCount(40);
    await dialog.getByRole('button', { name: text.next, exact: true }).click();
    await expect(dialog.getByRole('option')).toHaveCount(4);
    await search.fill('月度汇总');
    await expect(dialog.getByRole('option')).toHaveCount(2);
    await search.press('ArrowDown');
    await expect(dialog.getByRole('option', { selected: true })).toContainText('结果 42');
    await dialog.screenshot({ path: info.outputPath('查找结果集.png') });
    await search.press('Enter');
    await expect(dialog).toHaveCount(0);
    await expect(grid.getByRole('gridcell', { name: '42', exact: true })).toBeVisible();

    await trigger.click();
    await search.fill('uniqueoutput');
    await expect(dialog.getByRole('option')).toHaveCount(1);
    await dialog.getByRole('option').click();
    await expect(grid.getByRole('gridcell', { name: '44', exact: true })).toBeVisible();
    await trigger.click();
    await search.fill('#2');
    await expect(dialog.getByRole('option')).toHaveCount(1);
    await search.press('Escape');
    await expect(trigger).toBeFocused();
    await expect(grid.getByRole('gridcell', { name: '44', exact: true })).toBeVisible();
    await trigger.click();
    await search.fill('不存在的列');
    await expect(dialog.getByText(text.empty, { exact: true })).toBeVisible();
    await search.press('Enter');
    await expect(dialog).toBeVisible();
    await search.fill('#2');
    await search.press('Enter');
    await expect(grid.getByRole('gridcell', { name: '2', exact: true })).toBeVisible();
    expect(await history()).toEqual(originalHistory);
    expect(await tasks()).toEqual(originalTasks);
    const settings = () => page.evaluate(() => window.dbark.invoke('settings.get', {}));
    expect((await settings()).tabs.map(tab => tab.sql)).toEqual([sql]);

    const openStatement = tab.getByRole('button', { name: duplicateText.resultStatement, exact: true });
    const target = page.getByRole('dialog', { name: duplicateText.targetAction, exact: true });
    await openStatement.click();
    await expect(target.getByRole('button', { name: duplicateText.targetOpen, exact: true })).toBeDisabled();
    await target.getByRole('button', { name: zh.common.cancel, exact: true }).click();
    expect((await settings()).tabs).toHaveLength(1);
    await expect(grid.getByRole('gridcell', { name: '2', exact: true })).toBeVisible();
    await openStatement.click();
    await target.getByLabel(duplicateText.targetConnection, { exact: true }).selectOption('result-navigator');
    await expect(target.getByLabel(duplicateText.targetDatabase, { exact: true })).toHaveValue('main');
    await target.screenshot({ path: info.outputPath('结果语句选择目标.png') });
    await target.getByRole('button', { name: duplicateText.targetOpen, exact: true }).click();
    await expect(target).toHaveCount(0);
    await expect.poll(async () => (await settings()).tabs.map(tab => tab.sql)).toEqual([sql, 'SELECT 2 AS sample;']);
    await expect(tab.getByRole('grid')).toHaveCount(0);
    await page.locator('.tab-strip').getByRole('button', { name: '多结果查询', exact: true }).click();
    await expect(grid.getByRole('gridcell', { name: '2', exact: true })).toBeVisible();
    await expect(openStatement).toBeEnabled();
    await tab.locator('.monaco-editor').getByRole('textbox').focus();
    await page.keyboard.insertText(' ');
    await expect(openStatement).toBeDisabled();
    expect(await history()).toEqual(originalHistory);
    expect(await tasks()).toEqual(originalTasks);
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  }
});
