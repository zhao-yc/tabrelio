import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { confirmOwnedDesktopExit, dataDir, desktop, expect, page, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';
import { snippetTemplatesForDialect } from '../../src/renderer/snippetCompletion';
import { zh, formatText } from '../../src/renderer/locales/zh-CN';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });
test.skip(process.env.DBARK_SQLITE_SNIPPET_TEST !== '1', '仅在隔离的 SQLite 源码验收运行');

test('SQLite片段库和补全插入可逐项填写的模板，执行由用户明确触发', async ({}, info) => {
  if (process.env.DBARK_INTEGRATION_ENABLED !== '0' || process.env.DBARK_DEV_URL || process.env.DBARK_EXECUTABLE_PATH)
    throw Error('SQLite片段验收只使用本例临时文件');
  try {
    const file = join(realpathSync(dataDir), 'sqlite-snippet.sqlite');
    const database = new DatabaseSync(file); database.exec('CREATE TABLE fixture(id INTEGER PRIMARY KEY)'); database.close();
    // 仅适配一次本例SQLite文件选择，模板浏览、编辑和补全均执行正式代码。
    await desktop.evaluate(({ dialog }, file) => {
      const original = dialog.showOpenDialog;
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        dialog.showOpenDialog = original;
        if (!(args.at(-1) as Electron.OpenDialogOptions).filters?.[0]?.extensions.includes('sqlite'))
          throw Error('本例只允许SQLite文件选择');
        return { canceled: false, filePaths: [file] };
      }) as typeof original;
    }, file);
    await page.evaluate(async () => {
      const id = 'sqlite-snippet';
      const file = await window.dbark.invoke('files.choose', { purpose: 'sqlite-database', sqliteConnectionId: id });
      if (!file) throw Error('SQLite文件选择未完成');
      await window.dbark.invoke('connections.save', { id, name: 'SQLite片段样本', dialect: 'sqlite', group: '', color: '#51bda5',
        sqlite: { fileToken: file.token, readOnly: true, busyTimeoutMs: 1000 } });
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: id,
        tabs: [{ id, kind: 'query', title: 'SQLite片段', connectionId: id, database: 'main', sql: '' }] });
    });
    await page.reload();
    const tab = page.locator('.query-tab:visible'), input = tab.locator('.monaco-editor').getByRole('textbox');
    const dialog = page.getByRole('dialog', { name: zh.snippets.title, exact: true });
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    const templates = snippetTemplatesForDialect('sqlite');
    const sql = () => page.evaluate(async () => {
      const settings = await window.dbark.invoke('settings.get', {});
      return settings.tabs.find(tab => tab.id === settings.activeTabId)?.sql;
    });
    await expect(input).toBeVisible();
    await (await navigationMenuItem(tab, { name: zh.snippets.title, exact: true })).click();
    const plan = templates.find(item => item.id === 'builtin-explain')!;
    await dialog.getByRole('button', { name: formatText(zh.snippets.selectName, plan.name), exact: true }).click();
    await expect(dialog.locator('.monaco-editor .view-lines')).toContainText('EXPLAIN QUERY PLAN');
    await expect(dialog.getByRole('button', { name: zh.snippets.edit, exact: true })).toHaveCount(0);
    await dialog.screenshot({ path: info.outputPath('SQLite执行计划片段.png') });
    await dialog.getByRole('button', { name: zh.snippets.insert, exact: true }).click();
    await expect(dialog).toHaveCount(0); await expect.poll(sql).toBe(plan.sql);
    await input.focus(); await page.keyboard.press(`${modifier}+Z`); await expect.poll(sql).toBe('');

    const select = templates.find(item => item.id === 'builtin-select')!, prefix = '按条件';
    await page.keyboard.insertText(prefix); await expect.poll(sql).toBe(prefix);
    await page.keyboard.press('Control+Space');
    const widget = tab.locator('.suggest-widget.visible');
    const suggestion = widget.locator('.monaco-list-row .label-name').filter({ hasText: new RegExp(`^${select.name}$`) });
    await expect(suggestion).toHaveCount(1);
    await tab.screenshot({ path: info.outputPath('SQLite内置片段补全.png') });
    await suggestion.click();
    await expect.poll(sql).toBe(select.sql);
    await page.keyboard.press(`${modifier}+Z`); await expect.poll(sql).toBe(prefix);

    await page.keyboard.press(`${modifier}+A`);
    await page.keyboard.insertText('命名参数');
    await page.keyboard.press('Control+Space');
    await widget.locator('.monaco-list-row .label-name').getByText(zh.snippets.parameterName, {exact: true}).click();
    await expect.poll(sql).toBe('SELECT [$value] AS result;');
    await page.keyboard.insertText('needle');
    await page.keyboard.press('Tab');
    await page.keyboard.insertText('bound_value');
    await page.keyboard.press('Tab');
    await expect.poll(sql).toBe('SELECT [$needle] AS bound_value;');

    await input.focus();
    await page.keyboard.press(`${modifier}+A`);
    await (await navigationMenuItem(tab, {name: zh.snippets.title, exact: true})).click();
    await dialog.getByLabel(zh.snippets.groupFilter).selectOption(':' + zh.snippets.queryTemplateGroup);
    await dialog.getByRole('button', {name: formatText(zh.snippets.selectName, zh.snippets.resultTitleName), exact: true}).click();
    await expect(dialog.locator('.monaco-editor .view-lines')).toContainText('-- NAME:查询结果');
    await dialog.screenshot({path: info.outputPath('内置结果与参数片段.png')});
    await dialog.getByRole('button', {name: zh.snippets.insert, exact: true}).click();
    await expect(dialog).toHaveCount(0);
    await expect(input).toBeFocused();
    await page.keyboard.insertText('临时结果');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.insertText('样本结果');
    await page.keyboard.press('Tab');
    await page.keyboard.insertText('SELECT 41 AS answer;');
    await page.keyboard.press('Tab');
    await expect.poll(sql).toBe('-- NAME:样本结果\nSELECT 41 AS answer;');
    expect(await page.evaluate(async () => ({ tasks: await window.dbark.invoke('tasks.list', {}), history: await window.dbark.invoke('history.list', {}),
      snippets: await window.dbark.invoke('snippets.list', {}) }))).toEqual({ tasks: [], history: [], snippets: [] });
    await page.keyboard.press(`${modifier}+Enter`);
    await expect(tab.locator('.query-result-tabs').getByText('样本结果', {exact: true})).toBeVisible();
    await expect(tab.getByRole('gridcell').filter({hasText: /^41$/})).toBeVisible();
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) { retainOwnedDesktopResources(info); throw reason; }
});
