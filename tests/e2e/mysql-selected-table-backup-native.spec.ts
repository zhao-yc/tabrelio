import { isAbsolute } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import mysql from 'mysql2/promise';
import { mysqlDatabaseBackupZh as backup } from '../../src/renderer/locales/mysqlDatabaseBackup.zh-CN';
import { mysqlSqlFileZh as restore } from '../../src/renderer/locales/mysqlSqlFile.zh-CN';
import { sqlFileImportZh as receipt } from '../../src/renderer/locales/sqlFileImport.zh-CN';
import { confirmOwnedDesktopExit, expect, ownedDesktopResources, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';

test.skip(process.env.DBARK_MYSQL_BACKUP_NATIVE !== '1', '只运行隔离 MySQL 和 MariaDB 原生备份');
test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' });
test.describe.configure({ timeout: 120000, retries: 0 });

for (const dialect of ['mysql', 'mariadb'] as const) test(dialect + ' 选表 SQL 的三种内容可恢复到指定库', async ({}, info) => {
  const user = process.env.DBARK_BACKUP_AUDIT_USER ?? '', password = process.env.DBARK_BACKUP_AUDIT_PASSWORD ?? '';
  const port = Number(process.env[dialect === 'mysql' ? 'DBARK_BACKUP_AUDIT_MYSQL_PORT' : 'DBARK_BACKUP_AUDIT_MARIA_PORT']);
  const tool = process.env[dialect === 'mysql' ? 'DBARK_MYSQL_DUMP_TOOL' : 'DBARK_MARIA_DUMP_TOOL'] ?? '';
  if (!['darwin', 'win32'].includes(process.platform) || info.config.workers !== 1 || info.retry ||
    process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_aud_[a-f0-9]{12}$/.test(user) || !/^[a-f0-9]{64}$/.test(password) ||
    !Number.isInteger(port) || port <= 1024 || port > 65535 || !isAbsolute(tool) ||
    ['DBARK_EXECUTABLE_PATH', 'DBARK_DEV_URL', 'DBARK_USER_DATA'].some(key => process.env[key]))
    throw Error('只允许隔离回环实库及源码 Electron');

  const config = { host: '127.0.0.1', port, user, password };
  const database = user + '_scope_source', full = user + '_scope_full', split = user + '_scope_split';
  const [first, second, extra] = ['--账目', '无主键`表', '未选表'];
  const control = await mysql.createConnection(config);
  const { page, application } = ownedDesktopResources(info);
  const all = info.outputPath(dialect + '-指定表完整.sql'), schema = info.outputPath(dialect + '-指定表结构.sql');
  const data = info.outputPath(dialect + '-指定表数据.sql'), sentinel = info.outputPath(dialect + '-原文件.sql');
  let desktopClosed = false;
  try {
    for (const db of [database, full, split]) await control.query('CREATE DATABASE ?? CHARACTER SET utf8mb4', [db]);
    await control.query('USE ??', [database]);
    await control.query('CREATE TABLE ?? (id BIGINT UNSIGNED PRIMARY KEY, note VARCHAR(32), raw BLOB) ENGINE=InnoDB', [first]);
    await control.query('CREATE TABLE ?? (label VARCHAR(32)) ENGINE=InnoDB', [second]);
    await control.query('CREATE TABLE ?? (id INT) ENGINE=InnoDB', [extra]);
    await control.query('CREATE TABLE old_engine(id INT) ENGINE=MyISAM');
    await control.query('CREATE VIEW untouched AS SELECT label FROM ??', [second]);
    await control.query("INSERT INTO ?? VALUES (18446744073709551615, '备份🧪', X'00FF0A')", [first]);
    await control.query("INSERT INTO ?? VALUES (NULL), ('原值')", [second]);
    await control.query('CREATE TRIGGER selected_trigger BEFORE INSERT ON ?? FOR EACH ROW SET @tabrelio_backup_seen=NEW.note', [first]);
    await writeFile(sentinel, '原始备份\n');

    await application.evaluate(({ dialog }, input) => {
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        const title = (args.at(-1) as Electron.OpenDialogOptions).title;
        if (title === input.toolTitle) return { canceled: false, filePaths: [input.tool] };
        if (title === input.restoreTitle && input.restoreFiles.length)
          return { canceled: false, filePaths: [input.restoreFiles.shift()!] };
        throw Error('出现非本例的打开文件对话框');
      }) as typeof dialog.showOpenDialog;
      dialog.showSaveDialog = (async (...args: unknown[]) => {
        const title = (args.at(-1) as Electron.SaveDialogOptions).title;
        if (title === input.title && input.paths.length) return { canceled: false, filePath: input.paths.shift()! };
        throw Error('出现非本例的保存文件对话框');
      }) as typeof dialog.showSaveDialog;
    }, { title: backup.title, toolTitle: backup.tool, restoreTitle: restore.title, tool,
      paths: [all, schema, data, sentinel], restoreFiles: [all, schema, data] });
    const connectionId = await page.evaluate(async profile => (await window.dbark.invoke('connections.save', profile)).id, {
      ...config, database, id: '', name: dialect + ' 指定表备份', group: '', color: '#123456', dialect, rememberPassword: false,
    });
    await page.reload();
    const menu = async (name: string) => (await navigationMenuItem(page.locator('.navigation-toolbar'), { name, exact: true })).click();
    await menu(backup.title);
    const modal = page.getByRole('dialog', { name: backup.title, exact: true });
    const button = (name: string) => modal.getByRole('button', { name, exact: true });
    await modal.getByLabel(backup.database, { exact: true }).selectOption(database);
    await modal.getByLabel(backup.selection, { exact: true }).selectOption('tables');
    const filter = modal.getByLabel(backup.tableSearch, { exact: true });
    await expect(modal.getByRole('checkbox', { name: 'old_engine', exact: true })).toHaveCount(0);
    await expect(modal.getByRole('checkbox', { name: 'untouched', exact: true })).toHaveCount(0);
    await modal.getByRole('checkbox', { name: first, exact: true }).check();
    await filter.fill(second);
    await expect(modal.getByRole('checkbox', { name: first, exact: true })).toHaveCount(0);
    await modal.getByRole('checkbox', { name: second, exact: true }).check();
    await expect(modal.getByText(backup.tableCount(2), { exact: true })).toBeVisible();
    await filter.clear();
    await button(backup.tool).click();
    for (const [content, path] of [['all', all], ['schema', schema], ['data', data]] as const) {
      await modal.getByLabel(backup.content, { exact: true }).selectOption(content);
      await button(backup.choose).click();
      await modal.getByRole('checkbox', { name: backup.confirm, exact: true }).check();
      await button(backup.start).click();
      await expect(modal.getByRole('status')).toContainText('已保存指定表 SQL', { timeout: 20000 });
      const script = await readFile(path, 'utf8');
      expect(script).not.toMatch(/\b(?:CREATE DATABASE|USE `|DROP TABLE|DROP TRIGGER)\b|未选表|old_engine|untouched/u);
      expect(script.includes('CREATE TABLE')).toBe(content !== 'data');
      expect(script.includes('INSERT INTO')).toBe(content !== 'schema');
      expect(script.includes('TRIGGER')).toBe(content !== 'data');
      if (content === 'all') await modal.screenshot({ path: info.outputPath(dialect + ' 指定表备份.png') });
    }
    await button(backup.close).click();

    for (const [db, file] of [[full, all], [split, schema], [split, data]] as const) {
      await menu(restore.title);
      const dialog = page.getByRole('dialog', { name: restore.title, exact: true });
      await dialog.getByLabel(restore.database, { exact: true }).selectOption(db);
      await dialog.getByRole('button', { name: restore.choose, exact: true }).click();
      await expect(dialog).toContainText(file.split(/[/\\]/).at(-1)!);
      await dialog.getByRole('checkbox', { name: restore.trust, exact: true }).check();
      await dialog.getByRole('button', { name: restore.run, exact: true }).click();
      await expect(dialog.getByRole('status', { name: receipt.title })).toContainText(receipt.completed, { timeout: 20000 });
      if (file === data) await dialog.screenshot({ path: info.outputPath(dialect + ' 指定表恢复.png') });
      await dialog.getByRole('button', { name: restore.close, exact: true }).click();
    }
    for (const db of [full, split]) {
      const [rows] = await control.query('SELECT CAST(id AS CHAR) AS id,note,HEX(raw) AS raw FROM ??.??', [db, first]);
      expect(rows).toEqual([{ id: '18446744073709551615', note: '备份🧪', raw: '00FF0A' }]);
      const [notes] = await control.query('SELECT label FROM ??.?? ORDER BY label', [db, second]);
      expect(notes).toEqual([{ label: null }, { label: '原值' }]);
      const [relations] = await control.query('SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE BINARY TABLE_SCHEMA=BINARY ? ORDER BY BINARY TABLE_NAME', [db]);
      expect(relations).toEqual([{ name: first }, { name: second }]);
      const [triggers] = await control.query('SELECT TRIGGER_NAME AS name FROM information_schema.TRIGGERS WHERE BINARY TRIGGER_SCHEMA=BINARY ?', [db]);
      expect(triggers).toEqual([{ name: 'selected_trigger' }]);
      await control.beginTransaction();
      try {
        await control.query("INSERT INTO ??.?? VALUES (1, '触发器验收', NULL)", [db, first]);
        expect((await control.query('SELECT @tabrelio_backup_seen AS note'))[0]).toEqual([{ note: '触发器验收' }]);
      } finally { await control.rollback(); }
    }

    const selectedTool = await page.evaluate(() => window.dbark.invoke('mysql.backup.chooseTool', {}));
    const choice = { connectionId, database, toolToken: selectedTool!.token, tableScope: { tables: [first], content: 'all' as const } };
    const picked = await page.evaluate(input => window.dbark.invoke('mysql.backup.chooseFile', input), choice);
    const run = (content: 'all' | 'data', taskId: string) => page.evaluate(input => window.dbark.invoke('mysql.backup.database', input), {
      ...choice, tableScope: { ...choice.tableScope, content }, taskId, fileToken: picked!.token, acknowledgeSnapshot: true as const,
    });
    await expect(run('data', dialect + '-scope-mismatch')).rejects.toThrow('请重新选择');
    await control.query('RENAME TABLE ?? TO ??', [first, '改名后']);
    await expect(run('all', dialect + '-missing-table')).rejects.toThrow('所选 InnoDB 表已变化');
    expect(await readFile(sentinel, 'utf8')).toBe('原始备份\n');
    const nativeProcess = application.process();
    await confirmOwnedDesktopExit(info);
    desktopClosed = true;
    expect(nativeProcess.exitCode).toBe(0);
  } finally {
    if (!desktopClosed) retainOwnedDesktopResources(info);
    await control.end();
  }
});
