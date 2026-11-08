import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { promisify } from 'node:util';
import { Client } from 'pg';
import { postgresDatabaseBackupZh as text } from '../../src/renderer/locales/postgresDatabaseBackup.zh-CN';
import { postgresSqlFileZh as restore } from '../../src/renderer/locales/postgresSqlFile.zh-CN';
import { postgresIdentifier } from '../../src/shared/postgresSql';
import { navigationMenuItem } from './navigation-menu';
import { confirmOwnedDesktopExit, expect, ownedDesktopResources, retainOwnedDesktopResources, test } from './desktop-fixture';

test.skip(process.env.DBARK_POSTGRES_DATABASE_BACKUP_NATIVE !== '1', '只运行隔离 PostgreSQL 原生备份');
test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' });
test.describe.configure({ timeout: 120000, retries: 0 });

test('PostgreSQL 原生多 Schema 备份与恢复，文件绑定范围并拒绝同名替换', async ({}, info) => {
  const user = process.env.DBARK_POSTGRES_TEST_USER ?? '', password = process.env.DBARK_POSTGRES_TEST_PASSWORD ?? '';
  const database = process.env.DBARK_POSTGRES_TEST_DATABASE, target = process.env.DBARK_POSTGRES_COMPARE_TARGET;
  const port = Number(process.env.DBARK_POSTGRES_TEST_PORT);
  const tool = process.env.DBARK_POSTGRES_DUMP_TOOL ?? '', pgRestore = process.env.DBARK_POSTGRES_RESTORE_TOOL ?? '';
  if (!['darwin', 'win32'].includes(process.platform) || info.config.workers !== 1 || info.retry ||
    process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pg_[a-f0-9]{12}$/.test(user) || !/^[a-f0-9]{64}$/.test(password) ||
    database !== user || target !== user + '_target' || !Number.isInteger(port) || port < 1025 || port > 65535 ||
    !isAbsolute(tool) || !/[/\\]pg_dump(?:\.exe)?$/.test(tool) || !isAbsolute(pgRestore) || !/[/\\]pg_restore(?:\.exe)?$/.test(pgRestore) ||
    ['DBARK_EXECUTABLE_PATH', 'DBARK_DEV_URL', 'DBARK_USER_DATA'].some(key => process.env[key]))
    throw Error('只允许隔离回环 PostgreSQL 及选定的原生备份工具');

  const config = { host: '127.0.0.1', port, user, password }, { page, application } = ownedDesktopResources(info);
  const client = (db: string) => new Client({ ...config, database: db });
  const source = client(database), restored = client(target), archiveDb = user + '_scoped_archive', archiveTarget = client(archiveDb);
  const first = '范围.*', second = '另一"区', other = '范围.ab';
  const a = postgresIdentifier(first), b = postgresIdentifier(second), excluded = postgresIdentifier(other);
  const structure = info.outputPath('指定Schema仅结构.sql'), data = info.outputPath('指定Schema仅数据.sql');
  const archive = info.outputPath('指定Schema完整.dump'), sentinel = info.outputPath('保留原文件.sql');
  const sentinelBytes = '既有备份字节\n';
  let desktopClosed = false;
  try {
    await source.connect(); await restored.connect();
    await source.query('CREATE DATABASE ' + postgresIdentifier(archiveDb) + ' TEMPLATE template0');
    await archiveTarget.connect();
    await writeFile(sentinel, sentinelBytes);
    await source.query(`CREATE SCHEMA ${a}; CREATE SCHEMA ${b}; CREATE SCHEMA ${excluded};
      CREATE TABLE ${a}.payload(id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY, note text, raw bytea);
      INSERT INTO ${a}.payload(note,raw) VALUES ('合成数据',decode('00ff80','hex')), (NULL,NULL);
      CREATE VIEW ${b}.cross_view AS SELECT id,note FROM ${a}.payload;
      CREATE TABLE ${excluded}.unselected(id int); INSERT INTO ${excluded}.unselected VALUES (777)`);
    const facts = `SELECT id,note,encode(raw,'hex') AS raw FROM ${a}.payload ORDER BY id`;
    const expected = (await source.query(facts)).rows;
    await application.evaluate(({ dialog }, input) => {
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        const title = (args.at(-1) as Electron.OpenDialogOptions).title;
        if (title === input.toolTitle) return { canceled: false, filePaths: [input.tool] };
        if (title === input.restoreTitle && input.restore.length) return { canceled: false, filePaths: [input.restore.shift()!] };
        throw Error('出现非本例的文件选择');
      }) as typeof dialog.showOpenDialog;
      dialog.showSaveDialog = (async (...args: unknown[]) => {
        const title = (args.at(-1) as Electron.SaveDialogOptions).title;
        if (title === input.title && input.paths.length) return { canceled: false, filePath: input.paths.shift()! };
        throw Error('出现非本例的保存选择');
      }) as typeof dialog.showSaveDialog;
    }, { title: text.title, toolTitle: text.tool, restoreTitle: restore.title, tool, restore: [structure, data],
      paths: [structure, data, archive, sentinel] });
    const connectionName = '按 Schema 备份来源';
    const connectionId = await page.evaluate(async profile => (await window.dbark.invoke('connections.save', profile)).id, {
      ...config, database, id: '', name: connectionName, group: '', color: '#123456', dialect: 'postgresql' as const, rememberPassword: false,
    });
    await page.reload();
    const menu = async (name: string) => (await navigationMenuItem(page.locator('.navigation-toolbar'), { name, exact: true })).click();
    await menu(text.title);
    const modal = page.getByRole('dialog', { name: text.title, exact: true });
    const button = (name: string) => modal.getByRole('button', { name, exact: true });
    await modal.getByLabel(text.database, { exact: true }).selectOption(database);
    await modal.getByLabel(text.selection, { exact: true }).selectOption('schemas');
    await modal.getByRole('checkbox', { name: first, exact: true }).check();
    await modal.getByLabel(text.schemaSearch, { exact: true }).fill('另一');
    await expect(modal.getByRole('checkbox', { name: first, exact: true })).toHaveCount(0);
    await modal.getByRole('checkbox', { name: second, exact: true }).check();
    await expect(modal.getByText(text.selectedCount(2), { exact: true })).toBeVisible();
    await modal.getByLabel(text.schemaSearch, { exact: true }).clear();
    await modal.getByRole('checkbox', { name: text.portable, exact: true }).check();
    await button(text.tool).click();
    const backup = async (content: 'all' | 'schema' | 'data') => {
      await modal.getByLabel(text.content, { exact: true }).selectOption(content);
      await button(text.choose).click();
      await button(text.start).click();
      await expect(modal.getByRole('status')).toContainText('pg_dump 18.6', { timeout: 30000 });
    };
    await backup('schema');
    const schemaSql = await readFile(structure, 'utf8');
    expect(schemaSql).toContain('CREATE SCHEMA ' + a);
    expect(schemaSql).toContain('CREATE SCHEMA ' + b);
    expect(schemaSql).not.toMatch(/COPY |unselected/);
    await modal.screenshot({ path: info.outputPath('PostgreSQL 指定Schema备份.png') });
    await backup('data');
    const dataSql = await readFile(data, 'utf8');
    expect(dataSql).toContain('COPY ' + a + '.payload');
    expect(dataSql).not.toMatch(/CREATE SCHEMA|unselected/);
    await modal.getByLabel(text.format, { exact: true }).selectOption('custom');
    await backup('all');
    expect((await readFile(archive)).subarray(0, 5).toString('ascii')).toBe('PGDMP');
    await button(text.close).click();

    for (const input of [structure, data]) {
      await menu(restore.title);
      const restoreDialog = page.getByRole('dialog', { name: restore.title, exact: true });
      await restoreDialog.getByLabel(restore.database, { exact: true }).selectOption(target);
      await restoreDialog.getByRole('button', { name: restore.choose, exact: true }).click();
      await expect(restoreDialog).toContainText(input.split(/[/\\]/).at(-1)!);
      await restoreDialog.getByRole('button', { name: restore.execute, exact: true }).click();
      await expect(restoreDialog.getByRole('status')).toContainText(restore.outcome.committed, { timeout: 30000 });
      if (input === data) await restoreDialog.screenshot({ path: info.outputPath('PostgreSQL 指定Schema恢复.png') });
      await restoreDialog.getByRole('button', { name: restore.close, exact: true }).click();
    }
    expect((await restored.query(facts)).rows).toEqual(expected);
    expect((await restored.query(`SELECT count(*)::int AS n FROM ${b}.cross_view`)).rows).toEqual([{ n: 2 }]);
    const restoreProcess = promisify(execFile);
    await restoreProcess(pgRestore, ['--no-password', '--no-owner', '--no-privileges', '--exit-on-error', '--dbname=' + archiveDb, archive],
      { env: { PGHOST: config.host, PGPORT: String(port), PGUSER: user, PGPASSWORD: password, PGSSLMODE: 'disable' }, timeout: 30000 });
    expect((await archiveTarget.query(facts)).rows).toEqual(expected);
    for (const db of [restored, archiveTarget]) {
      expect((await db.query('SELECT pg_catalog.to_regnamespace($1)::text AS absent', [excluded])).rows).toEqual([{ absent: null }]);
    }

    const scope = { connectionId, database };
    const catalog = await page.evaluate(input => window.dbark.invoke('postgres.schemaManage.read', input), scope);
    const selected = catalog.schemas.find(item => item.name === first)!;
    const savedTool = await page.evaluate(() => window.dbark.invoke('postgres.backup.chooseDumpTool', {}));
    const choice = { ...scope, schemas: [{ name: selected.name, stamp: selected.stamp }], portable: true, format: 'sql' as const,
      content: 'schema' as const, toolToken: savedTool!.token };
    const picked = await page.evaluate(input => window.dbark.invoke('postgres.backup.chooseDatabaseFile', input), choice);
    const run = (content: 'schema' | 'data', taskId: string) => page.evaluate(input => window.dbark.invoke('postgres.backup.database', input),
      { ...choice, content, fileToken: picked!.token, taskId });
    await expect(run('data', 'scope-file-mismatch')).rejects.toThrow('请重新选择');
    await source.query(`ALTER SCHEMA ${a} RENAME TO storage_scope_original; CREATE SCHEMA ${a}`);
    await expect(run('schema', 'scope-schema-replaced')).rejects.toThrow('身份或访问权限已变化');
    expect(await readFile(sentinel, 'utf8')).toBe(sentinelBytes);
    const nativeProcess = application.process();
    await confirmOwnedDesktopExit(info);
    desktopClosed = true;
    expect(nativeProcess.exitCode).toBe(0);
  } finally {
    if (!desktopClosed) retainOwnedDesktopResources(info);
    await Promise.all([source.end(), restored.end(), archiveTarget.end()]);
  }
});
