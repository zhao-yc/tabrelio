import { writeFile } from 'node:fs/promises';
import { Client } from 'pg';
import { postgresSqlFileZh as text } from '../../src/renderer/locales/postgresSqlFile.zh-CN';
import { postgresIdentifier } from '../../src/shared/postgresSql';
import { confirmOwnedDesktopExit, expect, ownedDesktopResources, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';

test.skip(process.env.DBARK_POSTGRES_SQL_FILE_NATIVE !== '1', '只运行隔离的 PostgreSQL 恢复目标实证');
test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' });
test.describe.configure({ timeout: 120000, retries: 0 });

test('恢复目标预检只读，拒绝同名替换、只读库及抢先建库', async ({}, info) => {
  const user = process.env.DBARK_POSTGRES_TEST_USER ?? '', password = process.env.DBARK_POSTGRES_TEST_PASSWORD ?? '';
  const database = process.env.DBARK_POSTGRES_TEST_DATABASE, port = Number(process.env.DBARK_POSTGRES_TEST_PORT);
  if (!['darwin', 'win32'].includes(process.platform) || info.config.workers !== 1 || info.retry ||
    process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pg_[a-f0-9]{12}$/.test(user) || !/^[a-f0-9]{64}$/.test(password) ||
    database !== user || !Number.isInteger(port) || port < 1025 || port > 65535 ||
    ['DBARK_EXECUTABLE_PATH', 'DBARK_DEV_URL', 'DBARK_USER_DATA'].some(key => process.env[key]))
    throw Error('只允许隔离回环实库和源码 Electron');

  const config = { host: '127.0.0.1', port, user, password };
  const maintenance = new Client({ ...config, database });
  const existing = user + '_preflight', old = existing + '_old', readOnly = existing + '_ro', collision = existing + '_race';
  const original = new Client({ ...config, database: existing }), replacement = new Client({ ...config, database: existing });
  const collisionDb = new Client({ ...config, database: collision });
  const file = info.outputPath('恢复目标预检.sql');
  const { page, application } = ownedDesktopResources(info);
  let desktopClosed = false;
  try {
    await maintenance.connect();
    const create = (name: string) => maintenance.query('CREATE DATABASE ' + postgresIdentifier(name) + ' WITH TEMPLATE template0');
    await create(existing);
    await create(readOnly);
    await maintenance.query('ALTER DATABASE ' + postgresIdentifier(readOnly) + ' SET default_transaction_read_only = on');
    await original.connect();
    await original.query('CREATE TABLE public.original_marker (id int); INSERT INTO public.original_marker VALUES (9)');
    await original.end();
    await writeFile(file, 'CREATE TABLE public.write_guard (id int); INSERT INTO public.write_guard VALUES (42);');
    const databaseOid = async (name: string) => (await maintenance.query('SELECT oid::text FROM pg_database WHERE datname=$1', [name])).rows[0]?.oid;
    const originalOid = await databaseOid(existing);

    await application.evaluate(({ dialog }, input) => {
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        if ((args.at(-1) as Electron.OpenDialogOptions).title !== input.title) throw Error('非本例的文件选择');
        return { canceled: false, filePaths: [input.file] };
      }) as typeof dialog.showOpenDialog;
    }, { title: text.title, file });
    await page.evaluate(profile => window.dbark.invoke('connections.save', profile), {
      ...config, database, id: '', name: '恢复目标预检', group: '', color: '#123456', dialect: 'postgresql' as const, rememberPassword: false,
    });
    await page.reload();
    await (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: text.title, exact: true })).click();
    const modal = page.getByRole('dialog', { name: text.title, exact: true });
    const section = modal.getByRole('region', { name: text.targetCheck });
    const button = (name: string) => modal.getByRole('button', { name, exact: true });
    const choose = () => button(text.choose).click();
    const target = modal.getByLabel(text.database, { exact: true });

    await target.selectOption(readOnly);
    await expect(section).toContainText(text.targetIssues['read-only']);
    await choose();
    await expect(button(text.execute)).toBeDisabled();

    await target.selectOption(existing);
    await expect(section).toContainText(text.targetLabel(existing));
    await expect(section).toContainText('角色 ' + user);
    await section.getByText(text.targetRelations, { exact: true }).click();
    await expect(section.getByText('"public"."original_marker"', { exact: true })).toBeVisible();
    await modal.screenshot({ path: info.outputPath('PostgreSQL 恢复目标预检.png') });
    await choose();
    await expect(button(text.execute)).toBeEnabled();
    await maintenance.query('ALTER DATABASE ' + postgresIdentifier(existing) + ' RENAME TO ' + postgresIdentifier(old));
    await create(existing);
    expect(await databaseOid(existing)).not.toBe(originalOid);
    await replacement.connect();

    await button(text.execute).click();
    const status = modal.getByRole('status');
    await expect(status).toContainText(text.outcome['not-started']);
    await expect(status).toContainText(text.reason['target-changed']);
    expect((await replacement.query("SELECT to_regclass('public.write_guard') AS value")).rows).toEqual([{ value: null }]);
    await modal.screenshot({ path: info.outputPath('PostgreSQL 恢复目标拒绝同名替换.png') });
    const previous = new Client({ ...config, database: old });
    await previous.connect();
    try {
      expect((await previous.query("SELECT to_regclass('public.write_guard') AS value, (SELECT id FROM public.original_marker) AS id")).rows)
        .toEqual([{ value: null, id: 9 }]);
    } finally { await previous.end(); }

    await button(text.targetRefresh).click();
    await expect(section).toContainText(text.targetEmpty);
    await choose();
    await button(text.execute).click();
    await expect(status).toContainText(text.outcome.committed);
    expect((await replacement.query('SELECT id FROM public.write_guard')).rows).toEqual([{ id: 42 }]);

    await modal.getByRole('checkbox', { name: text.createMode, exact: true }).check();
    await modal.getByLabel(text.maintenance, { exact: true }).selectOption(database);
    await modal.getByLabel(text.newDatabase, { exact: true }).fill(collision);
    await choose();
    const start = button(text.createAndExecute);
    await expect(start).toBeEnabled();
    expect(await databaseOid(collision)).toBeUndefined();
    await create(collision);
    const raceOid = await databaseOid(collision);
    await start.click();
    await expect(status).toContainText(text.outcome['not-started']);
    await expect(status).toContainText(text.reason['database-exists']);
    expect(await databaseOid(collision)).toBe(raceOid);
    await collisionDb.connect();
    expect((await collisionDb.query("SELECT to_regclass('public.write_guard') AS value")).rows).toEqual([{ value: null }]);
    const nativeProcess = application.process();
    await confirmOwnedDesktopExit(info);
    desktopClosed = true;
    expect(nativeProcess.exitCode).toBe(0);
  } finally {
    if (!desktopClosed) retainOwnedDesktopResources(info);
    await Promise.allSettled([maintenance.end(), original.end(), replacement.end(), collisionDb.end()]);
  }
});
