import { mkdir, readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { confirmOwnedDesktopExit, desktop, expect, page, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { executeSql, writeSql } from './live-helpers';
import { navigationMenuItem } from './navigation-menu';
import { parameterZh as parameter } from '../../src/renderer/locales/queryParameters.zh-CN';
import { queryStreamZh as stream } from '../../src/renderer/locales/queryStreamExport.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import type { NetworkConnectionProfile } from '../../src/shared/contracts';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });
test.skip(!process.env.DBARK_MYSQL_NAMED_DIALECT, '仅在独立的 MySQL 或 MariaDB 源码窗口运行');

test('Navicat 命名参数的查询与完整导出，以及 MariaDB 方括号标识符', async ({}, info) => {
  const dialect = process.env.DBARK_MYSQL_NAMED_DIALECT, database = process.env.DBARK_MYSQL_NAMED_DATABASE ?? '';
  const password = process.env.DBARK_MYSQL_NAMED_PASSWORD ?? '', port = Number(process.env.DBARK_MYSQL_NAMED_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || process.env.DBARK_EXECUTABLE_PATH || process.env.DBARK_DEV_URL ||
      dialect !== 'mysql' && dialect !== 'mariadb' || !/^tabrelio_js_[a-f0-9]{12}$/.test(database) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535)
    throw Error('只允许本例源码与隔离回环数据库');
  const profile: NetworkConnectionProfile = { id: '', name: '命名参数验收', dialect, group: '', color: '#123456',
    host: '127.0.0.1', port, user: database, database, password, rememberPassword: false };
  const sql = "SELECT [$payload] AS bound, :payload AS repeated, '[$payload]' AS quoted, CAST([$amount] AS DECIMAL(65,0)) AS exact_value;";
  const raw = "命名参数原值🚢'; SELECT 999; -- text";
  const exact = '9007199254740993', output = info.outputPath('命名参数完整导出.json');
  try {
    await page.evaluate(async ({ profile, sql }) => {
      const connection = await window.dbark.invoke('connections.save', profile);
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'named', tabs: [
        { id: 'named', title: '命名参数验收', kind: 'query', connectionId: connection.id, database: profile.database, sql },
      ] });
    }, { profile, sql });
    await page.reload();
    const tab = page.locator('.query-tab:visible'), result = tab.locator('.result-body');
    const form = page.getByRole('dialog', { name: parameter.title, exact: true });
    const input = (name: string) => form.getByRole('textbox', { name: parameter.value + ' ' + name, exact: true });
    const tasks = () => page.evaluate(() => window.dbark.invoke('tasks.list', {}));
    const open = async () => (await navigationMenuItem(tab, { name: parameter.open, exact: true })).click();
    const fill = async () => {
      await expect(form.locator('.parameter-row')).toHaveCount(2);
      await input('payload').fill(raw);
      await form.getByRole('combobox', { name: parameter.type + ' amount', exact: true }).selectOption('integer');
      await input('amount').fill(exact);
    };
    const execute = () => form.getByRole('button', { name: parameter.execute, exact: true }).click();
    await open(); await fill(); expect(await tasks()).toEqual([]);
    await execute();
    await expect(result.getByRole('gridcell', { name: raw, exact: true })).toHaveCount(2);
    await expect(result.getByRole('gridcell', { name: exact, exact: true })).toBeVisible();
    await expect(result.getByRole('gridcell', { name: '[$payload]', exact: true })).toBeVisible();
    await result.screenshot({ path: info.outputPath('命名参数查询.png') });

    await mkdir(info.outputDir, { recursive: true });
    await desktop.evaluate(({ dialog, BrowserWindow }, path) => {
      const save = dialog.showSaveDialog;
      dialog.showSaveDialog = (async (...args: unknown[]) => {
        dialog.showSaveDialog = save;
        if (args[0] !== BrowserWindow.getAllWindows()[0] || !(args.at(-1) as Electron.SaveDialogOptions).filters?.some(filter => filter.extensions.includes('json')))
          throw Error('只允许本例 JSON 保存位置');
        return { canceled: false, filePath: path };
      }) as typeof save;
    }, output);
    await (await navigationMenuItem(tab, { name: stream.open, exact: true })).click();
    const modal = page.getByRole('dialog', { name: stream.title, exact: true });
    const exportButton = (name: string) => modal.getByRole('button', { name, exact: true });
    await modal.getByRole('combobox', { name: stream.format, exact: true }).selectOption('json');
    const before = await tasks();
    await exportButton(stream.parameters).click();
    await fill();
    await form.getByRole('button', { name: stream.applyParameters, exact: true }).click();
    await expect(form).toBeHidden();
    expect(await tasks()).toEqual(before);
    await modal.locator('.file-picker').click();
    await expect(modal.locator('.file-picker')).toContainText(basename(output));
    await modal.getByRole('checkbox', { name: stream.acknowledge, exact: true }).check();
    await exportButton(stream.execute).click();
    await expect(modal.getByText(stream.completed, { exact: true })).toBeVisible();
    const report = JSON.parse(await readFile(output, 'utf8'));
    expect(report.results).toHaveLength(1);
    expect(report.results[0].rows).toEqual([{ bound: raw, repeated: raw, quoted: '[$payload]', exact_value: exact }]);
    await modal.screenshot({ path: info.outputPath('命名参数完整导出.png') });
    await exportButton(zh.common.close).click();

    if (dialect === 'mariadb') {
      await executeSql("SET SESSION sql_mode='MSSQL';");
      await writeSql("SELECT [$payload] AS stored, :payload AS supplied FROM (SELECT '服务器列值' AS `$payload`) AS fixture;");
      await open();
      await expect(form.locator('.parameter-row')).toHaveCount(1);
      await input('payload').fill(raw);
      await execute();
      await expect(result.getByRole('gridcell', { name: '服务器列值', exact: true })).toBeVisible();
      await expect(result.getByRole('gridcell', { name: raw, exact: true })).toBeVisible();
      await result.screenshot({ path: info.outputPath('MariaDB MSSQL 方括号标识符.png') });
      await executeSql("SET SESSION sql_mode='';");
      await writeSql('SELECT [$payload] AS value_after_mode;');
      await open();
      await input('payload').fill(raw);
      await execute();
      await expect(result.getByRole('gridcell', { name: raw, exact: true })).toBeVisible();
    }
    const persisted = await page.evaluate(async () => ({
      history: await window.dbark.invoke('history.list', {}), tasks: await window.dbark.invoke('tasks.list', {}),
      settings: await window.dbark.invoke('settings.get', {}),
    }));
    expect(persisted.history.some(entry => entry.sql === sql && entry.success)).toBe(true);
    expect(JSON.stringify(persisted)).not.toContain(raw);
    expect(JSON.stringify(persisted).toLowerCase()).not.toContain(Buffer.from(raw).toString('hex'));
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  }
});
