import { Client } from 'pg';
import type { PostgresDatabaseManageInput } from '../../src/shared/postgresDatabaseManage';
import { postgresDatabaseManageZh as databaseText } from '../../src/renderer/locales/postgresDatabaseManage.zh-CN';
import { postgresIdentifier } from '../../src/shared/postgresSql';
import { clickSidebarAction } from './sidebar-menu';
import { test, expect, desktop, page, quitDesktop } from './desktop-fixture';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.skip(process.env.DBARK_POSTGRES_WORKSPACE_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
test.setTimeout(60_000);

function isolatedConnection() {
  const user = process.env.DBARK_POSTGRES_TEST_USER ?? '', database = process.env.DBARK_POSTGRES_TEST_DATABASE ?? '';
  const password = process.env.DBARK_POSTGRES_TEST_PASSWORD ?? '', port = Number(process.env.DBARK_POSTGRES_TEST_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pg_[a-f0-9]{12}$/.test(user) || database !== user ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('需要本轮独占回环库');
  return { host: '127.0.0.1', port, user, database, password, connectionTimeoutMillis: 3000 };
}

const connectionName = 'PostgreSQL 数据库管理测试';
async function saveConnection(config: ReturnType<typeof isolatedConnection>) {
  return page.evaluate(async ({ host, port, user, database, password, name }) => (await window.dbark.invoke('connections.save', {
    id: '', name, group: '', color: '#123456', dialect: 'postgresql', host, port, user, database, password, rememberPassword: false,
  })).id, { ...config, name: connectionName });
}

test('PostgreSQL 原生数据库管理创建、注释、连接设置、所有者及改名', async ({}, info) => {
  const config = isolatedConnection(), adminPassword = process.env.DBARK_PG_ROLES_ADMIN_PASSWORD ?? '';
  if (!/^[a-f0-9]{64}$/.test(adminPassword)) throw Error('需要隔离库管理夹具');
  const admin = new Client({ ...config, user: 'postgres', password: adminPassword });
  const source = '管理"原库_' + config.user.slice(-12), destination = '管理.新库_' + config.user.slice(-12);
  const data = async (name: string) => (await admin.query(`
    SELECT d.oid::text, r.rolname AS owner, d.datallowconn AS allow, d.datconnlimit AS limit,
      pg_catalog.shobj_description(d.oid, 'pg_database') AS comment
    FROM pg_catalog.pg_database d JOIN pg_catalog.pg_roles r ON r.oid=d.datdba WHERE d.datname::text=$1`, [name])).rows[0];
  await admin.connect();
  try {
    await admin.query('ALTER ROLE ' + postgresIdentifier(config.user) + ' CREATEDB');
    await saveConnection(config);
    await page.reload();
    const row = page.locator('.connection-row').filter({ hasText: connectionName });
    await clickSidebarAction(row, { name: databaseText.title, exact: true });
    const dialog = page.getByRole('dialog', { name: databaseText.title, exact: true });
    const button = (name: string) => dialog.getByRole('button', { name, exact: true });
    const sql = dialog.getByLabel(databaseText.sql, { exact: true });
    const choose = (action: PostgresDatabaseManageInput['action']) => dialog.getByLabel(databaseText.operation, { exact: true }).selectOption(action);
    const select = (name: string) => dialog.getByLabel(databaseText.source, { exact: true }).selectOption(name);
    const sourceRow = dialog.getByRole('row').filter({ has: page.getByRole('rowheader', { name: source, exact: true }) });
    const preview = () => button(databaseText.preview).click();
    const apply = () => button(databaseText.apply).click();
    await expect(dialog.getByRole('rowheader', { name: config.database, exact: true })).toBeVisible();
    await dialog.getByLabel(databaseText.name, { exact: true }).fill(source);
    await dialog.getByLabel(databaseText.template, { exact: true }).selectOption('template0');
    await dialog.getByLabel(databaseText.limit, { exact: true }).fill('12');
    await preview();
    await expect(sql).toContainText('CREATE DATABASE ' + postgresIdentifier(source) + ' WITH TEMPLATE "template0" CONNECTION LIMIT 12');
    expect(await data(source)).toBeUndefined();
    await dialog.screenshot({ path: info.outputPath('PostgreSQL 建库预览.png') });
    await apply();
    await expect(dialog.getByRole('rowheader', { name: source, exact: true })).toBeVisible();
    const original = await data(source);
    expect(original).toMatchObject({ owner: config.user, allow: true, limit: 12 });
    const comment = "注释'\\\n第二行";
    await choose('comment');
    await select(source);
    await dialog.getByLabel(databaseText.comment, { exact: true }).fill(comment);
    await preview();
    await expect(sql).toContainText('COMMENT ON DATABASE');
    await apply();
    await expect(dialog.getByRole('table')).toContainText('第二行');
    expect((await data(source)).comment).toBe(comment);

    await choose('settings');
    await select(source);
    await dialog.getByRole('checkbox', { name: databaseText.allow, exact: true }).uncheck();
    await dialog.getByLabel(databaseText.limit, { exact: true }).fill('7');
    await preview();
    await expect(sql).toContainText('ALLOW_CONNECTIONS false CONNECTION LIMIT 7');
    await apply();
    await expect(sourceRow.getByRole('cell', { name: '7', exact: true })).toBeVisible();
    await expect(sourceRow.getByRole('cell', { name: databaseText.no, exact: true })).toBeVisible();
    expect(await data(source)).toMatchObject({ allow: false, limit: 7 });
    const disabled = new Client({ ...config, database: source });
    try { await expect(disabled.connect()).rejects.toThrow(/not currently accepting connections/i); }
    finally { await disabled.end(); }
    await choose('settings');
    await select(source);
    await dialog.getByRole('checkbox', { name: databaseText.allow, exact: true }).check();
    await preview();
    await expect(sql).toContainText('ALLOW_CONNECTIONS true');
    await apply();
    await expect(sourceRow.getByRole('cell', { name: databaseText.yes, exact: true })).toBeVisible();

    const role = config.user + '_limited';
    await choose('owner');
    await select(source);
    await dialog.getByLabel(databaseText.newOwner, { exact: true }).fill(role);
    await preview();
    await expect(sql).toContainText('OWNER TO ' + postgresIdentifier(role));
    await apply();
    await expect(dialog.getByRole('table')).toContainText(role);
    expect((await data(source)).owner).toBe(role);

    const child = new Client({ ...config, database: source });
    await child.connect();
    try { await child.query('CREATE TABLE public.marker(id int); INSERT INTO public.marker VALUES (42)'); }
    finally { await child.end(); }
    await choose('rename');
    await select(source);
    await dialog.getByLabel(databaseText.name, { exact: true }).fill(destination);
    await preview();
    await expect(sql).toContainText('ALTER DATABASE ' + postgresIdentifier(source) + ' RENAME TO ' + postgresIdentifier(destination));
    await dialog.screenshot({ path: info.outputPath('PostgreSQL 数据库改名预览.png') });
    await apply();
    await expect(dialog.getByRole('rowheader', { name: destination, exact: true })).toBeVisible();
    expect(await data(source)).toBeUndefined();
    expect(await data(destination)).toEqual({ ...original, owner: role, comment, limit: 7 });
    const renamed = new Client({ ...config, database: destination });
    await renamed.connect();
    try { expect((await renamed.query('SELECT id FROM public.marker')).rows).toEqual([{ id: 42 }]); }
    finally { await renamed.end(); }
    const native = desktop.process();
    await quitDesktop();
    expect(native.exitCode).toBe(0);
  } finally {
    await admin.query('ALTER ROLE ' + postgresIdentifier(config.user) + ' NOCREATEDB');
    await admin.end();
  }
});

test('PostgreSQL 数据库管理拒绝无 CREATEDB 和同名替换，令牌一次消费', async () => {
  const config = isolatedConnection(), adminPassword = process.env.DBARK_PG_ROLES_ADMIN_PASSWORD ?? '';
  if (!/^[a-f0-9]{64}$/.test(adminPassword)) throw Error('需要隔离库管理夹具');
  const admin = new Client({ ...config, user: 'postgres', password: adminPassword });
  const source = 'db_race_' + config.user.slice(-12), moved = source + '_old';
  await admin.connect();
  try {
    const connectionId = await saveConnection(config), database = config.database;
    const target = { connectionId, database };
    const read = () => page.evaluate(input => window.dbark.invoke('postgres.databaseManage.read', input), target);
    const prepare = (draft: PostgresDatabaseManageInput) =>
      page.evaluate(input => window.dbark.invoke('postgres.databaseManage.preview', input), draft);
    expect((await read()).canCreate).toBe(false);
    await expect(prepare({ ...target, action: 'create', name: source, template: 'template0', connectionLimit: -1 })).rejects.toThrow('CREATEDB');
    await admin.query('ALTER ROLE ' + postgresIdentifier(config.user) + ' CREATEDB');
    const newOwner = config.user + '_limited';
    const create = await prepare({ ...target, action: 'create', name: source, template: 'template1', newOwner, connectionLimit: -1 });
    const commit = (token: string) => page.evaluate(input => window.dbark.invoke('postgres.databaseManage.apply', input),
      { ...target, token, confirmed: true as const });
    expect(await commit(create.token)).toMatchObject({ outcome: 'committed' });
    const before = (await read()).databases.find(item => item.name === source)!;
    expect(before).toMatchObject({ owner: newOwner, connectionLimit: -1 });
    const preview = await prepare({ ...target, action: 'rename', targetName: source, stamp: before.stamp, name: source + '_dest' });
    await admin.query('ALTER DATABASE ' + postgresIdentifier(source) + ' RENAME TO ' + postgresIdentifier(moved));
    await admin.query('CREATE DATABASE ' + postgresIdentifier(source) + ' WITH TEMPLATE template1 OWNER ' + postgresIdentifier(newOwner));
    const apply = () => commit(preview.token);
    expect(await apply()).toMatchObject({ outcome: 'notSent' });
    expect((await read()).databases.map(item => item.name)).toEqual(expect.arrayContaining([source, moved]));
    expect((await read()).databases.some(item => item.name === source + '_dest')).toBe(false);
    await expect(apply()).rejects.toThrow('预览已失效');
    const native = desktop.process();
    await quitDesktop();
    expect(native.exitCode).toBe(0);
  } finally {
    await admin.query('ALTER ROLE ' + postgresIdentifier(config.user) + ' NOCREATEDB');
    await admin.end();
  }
});
