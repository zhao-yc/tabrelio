import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import mysql from 'mysql2/promise';
import { parse } from 'csv-parse/sync';
import { queryInsertZh as insert } from '../../src/shared/queryInsertExport.zh-CN';
import { csvExportZh as csv } from '../../src/renderer/locales/csvExport.zh-CN';
import { fullQueryExportProfilesZh as profile } from '../../src/renderer/locales/fullQueryExportProfiles.zh-CN';
import { queryStreamZh as stream } from '../../src/renderer/locales/queryStreamExport.zh-CN';
import { confirmOwnedDesktopExit, expect, ownedDesktopResources, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';

test.skip(process.env.DBARK_MYSQL_QUERY_EXPORT_PROFILES_NATIVE !== '1', '只运行隔离 MySQL 和 MariaDB');
test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' });
test.describe.configure({ timeout: 90_000, retries: 0 });

for (const dialect of ['mysql', 'mariadb'] as const) test(dialect + ' 完整查询导出方案复用并保留新执行确认', async ({}, info) => {
  const user = process.env.DBARK_BACKUP_AUDIT_USER ?? '', password = process.env.DBARK_BACKUP_AUDIT_PASSWORD ?? '';
  const port = Number(process.env[dialect === 'mysql' ? 'DBARK_BACKUP_AUDIT_MYSQL_PORT' : 'DBARK_BACKUP_AUDIT_MARIA_PORT']);
  if (!['darwin', 'win32'].includes(process.platform) || info.config.workers !== 1 || info.retry ||
    process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_aud_[a-f0-9]{12}$/.test(user) || !/^[a-f0-9]{64}$/.test(password) ||
    !Number.isInteger(port) || port <= 1024 || port > 65535 ||
    ['DBARK_EXECUTABLE_PATH', 'DBARK_DEV_URL', 'DBARK_USER_DATA'].some(key => process.env[key]))
    throw Error('只允许隔离回环实库及源码 Electron');

  const config = { host: '127.0.0.1', port, user, password };
  const database = user + '_export_profile', id = 'query-export-profile';
  const source = "SELECT '首个结果' AS ignored;\nINSERT INTO export_guard VALUES (1);\n" +
    "SELECT CAST('18446744073709551615' AS UNSIGNED) AS id, '日报;原文' AS note;";
  const abandoned = info.outputPath('原选择.json'), output = info.outputPath('日报.csv');
  const observer = await mysql.createConnection(config);
  const { page, application } = ownedDesktopResources(info);
  let closed = false;
  try {
    await observer.query('CREATE DATABASE ?? CHARACTER SET utf8mb4', [database]);
    await observer.query('CREATE TABLE ??.export_guard(id INT PRIMARY KEY) ENGINE=InnoDB', [database]);
    await application.evaluate(({ dialog }, files) => {
      dialog.showSaveDialog = (async (...args: unknown[]) => {
        const options = args.at(-1) as Electron.SaveDialogOptions;
        const next = files.shift();
        if (!next || options.filters?.[0]?.extensions[0] !== next.extension) throw Error('非本例的文件选择');
        return { canceled: false, filePath: next.path };
      }) as typeof dialog.showSaveDialog;
    }, [{ path: abandoned, extension: 'json' }, { path: output, extension: 'csv' }]);
    await page.evaluate(async input => {
      const connection = await window.dbark.invoke('connections.save', {
        ...input.config, id: '', name: '本例导出方案', group: '', color: '#123456', dialect: input.dialect,
        database: input.database, rememberPassword: false,
      });
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: input.id, tabs: [{
        id: input.id, kind: 'query', title: '本例导出方案', connectionId: connection.id, database: input.database, sql: input.source,
      }] });
    }, { config, dialect, database, source, id });
    await page.reload();
    const modal = page.getByRole('dialog', { name: stream.title, exact: true });
    const button = (name: string) => modal.getByRole('button', { name, exact: true });
    const format = modal.getByRole('combobox', { name: stream.format, exact: true });
    const encoding = modal.getByRole('combobox', { name: stream.encoding, exact: true });
    const ordinal = modal.getByRole('textbox', { name: stream.ordinal, exact: true });
    const delimiter = modal.getByRole('combobox', { name: csv.label, exact: true });
    const acknowledgement = modal.getByRole('checkbox', { name: stream.acknowledge, exact: true });
    const open = async () => {
      const tab = page.locator('.query-tab:visible');
      await (await navigationMenuItem(tab, { name: stream.open, exact: true })).click();
      await expect(modal.getByLabel(stream.source)).toContainText('INSERT INTO export_guard');
    };
    const openProfiles = () => modal.getByText(profile.title, { exact: true }).click();
    const save = async (name: string) => {
      await modal.getByLabel(profile.name, { exact: true }).fill(name);
      await button(profile.add).click();
      await expect(modal.getByLabel(profile.select, { exact: true })).toHaveValue(name);
    };
    const apply = async (name: string) => {
      await modal.getByLabel(profile.select, { exact: true }).selectOption(name);
      await button(profile.apply).click();
      await expect(modal.getByText(profile.applied, { exact: true })).toBeVisible();
    };
    const verifyNoExecution = async () => {
      expect((await observer.query('SELECT id FROM ??.export_guard', [database]))[0]).toEqual([]);
      expect(await page.evaluate(async () => ({
        tasks: await window.dbark.invoke('tasks.list', {}), history: await window.dbark.invoke('history.list', {}),
      }))).toEqual({ tasks: [], history: [] });
    };

    await open(); await openProfiles();
    await format.selectOption('csv');
    await encoding.selectOption('utf16le');
    await delimiter.selectOption(';');
    await ordinal.fill('2');
    await save('日报第二组');
    await format.selectOption('sql');
    await modal.getByLabel(insert.database, { exact: true }).fill('回放库');
    await modal.getByLabel(insert.table, { exact: true }).fill('目标表');
    await modal.getByLabel(insert.columns, { exact: true }).fill('id\n附注');
    await save('回放映射');
    await verifyNoExecution();
    await button('关闭').click();

    await page.reload();
    await open(); await openProfiles();
    await apply('回放映射');
    await expect(format).toHaveValue('sql');
    await expect(encoding).toHaveValue('utf16le');
    await expect(modal.getByLabel(insert.database, { exact: true })).toHaveValue('回放库');
    await expect(modal.getByLabel(insert.table, { exact: true })).toHaveValue('目标表');
    await expect(modal.getByLabel(insert.columns, { exact: true })).toHaveValue('id\n附注');
    await format.selectOption('json');
    await modal.locator('.file-picker').click();
    await expect(modal.locator('.file-picker')).toContainText(basename(abandoned));
    await acknowledgement.check();
    await apply('日报第二组');
    await expect(format).toHaveValue('csv');
    await expect(encoding).toHaveValue('utf16le');
    await expect(delimiter).toHaveValue(';');
    await expect(ordinal).toHaveValue('2');
    await expect(acknowledgement).not.toBeChecked();
    await expect(button(stream.execute)).toBeDisabled();
    await expect(modal.locator('.file-picker')).toContainText(stream.choose);
    await verifyNoExecution();
    await modal.screenshot({ path: info.outputPath(dialect + ' 完整查询导出方案.png') });

    await modal.locator('.file-picker').click();
    await expect(modal.locator('.file-picker')).toContainText(basename(output));
    await acknowledgement.check();
    await button(stream.execute).click();
    await expect(modal.getByText(stream.completed, { exact: true })).toBeVisible({ timeout: 20_000 });
    expect(parse((await readFile(output)).toString('utf16le'), { delimiter: ';', bom: true })).toEqual([
      ['id', 'note'], ['18446744073709551615', '日报;原文'],
    ]);
    await expect(stat(abandoned)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await observer.query('SELECT id FROM ??.export_guard', [database]))[0]).toEqual([{ id: 1 }]);
    const process = application.process();
    await confirmOwnedDesktopExit(info);
    closed = true;
    expect(process.exitCode).toBe(0);
  } finally {
    if (!closed) retainOwnedDesktopResources(info);
    await observer.end();
  }
});
