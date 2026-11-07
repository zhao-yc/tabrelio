import { Client } from 'pg';
import { postgresExtensionManageZh as text } from '../../src/renderer/locales/postgresExtensionManage.zh-CN';
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

const connectionName = 'PostgreSQL 扩展管理测试';
async function saveConnection(config: ReturnType<typeof isolatedConnection>, name = connectionName) {
  return page.evaluate(async ({ host, port, user, database, password, name }) => (await window.dbark.invoke('connections.save', {
    id: '', name, group: '', color: '#123456', dialect: 'postgresql', host, port, user, database, password, rememberPassword: false,
  })).id, { ...config, name });
}

test('PostgreSQL 原生扩展安装、升级、迁移及 RESTRICT 卸载', async ({}, info) => {
  const config = isolatedConnection(), observer = new Client(config);
  const adminPassword = process.env.DBARK_PG_ROLES_ADMIN_PASSWORD ?? '';
  if (!/^[a-f0-9]{64}$/.test(adminPassword)) throw Error('需要隔离库管理夹具');
  const destination = '扩展."新区', qualified = postgresIdentifier(destination);
  const installed = async () => (await observer.query(`
    SELECT e.oid::text, e.extversion AS version, n.nspname::text AS schema
    FROM pg_catalog.pg_extension e JOIN pg_catalog.pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='hstore'
  `)).rows[0];
  await observer.connect();
  try {
    await observer.query('CREATE SCHEMA ' + qualified);
    const paths = (await observer.query(`
      SELECT p.source, p.target FROM pg_catalog.pg_extension_update_paths('hstore') p
      JOIN pg_catalog.pg_available_extensions a ON a.name='hstore' AND p.target=a.default_version
      JOIN pg_catalog.pg_available_extension_versions v ON v.name=a.name AND v.version=p.source
      WHERE p.path IS NOT NULL ORDER BY p.source COLLATE pg_catalog."C" LIMIT 1
    `)).rows;
    expect(paths).toHaveLength(1);
    const { source, target } = paths[0];

    const open = async (name: string) => {
      await page.reload();
      const connection = page.locator('.connection-node').filter({ has: page.locator('.connection-row').getByText(name, { exact: true }) });
      const database = connection.locator('.database-row').filter({ hasText: config.database });
      if (!await database.isVisible()) await connection.locator('.connection-row .tree-label').click();
      await clickSidebarAction(database, { name: text.title, exact: true });
    };
    await saveConnection(config);
    await open(connectionName);
    const dialog = page.getByRole('dialog', { name: text.title, exact: true });
    const button = (name: string) => dialog.getByRole('button', { name, exact: true });
    const row = dialog.getByRole('row').filter({ has: page.getByRole('button', { name: 'hstore', exact: true }) });
    const sql = dialog.getByLabel(text.sql, { exact: true });
    const preview = () => button(text.preview).click();
    const apply = () => button(text.apply).click();
    await dialog.getByLabel(text.search).fill('hstore');
    await expect(button('plpgsql')).toHaveCount(0);
    await button('hstore').click();
    await dialog.getByLabel(text.version).selectOption(source);
    await dialog.getByLabel(text.targetSchema).selectOption('public');
    await preview();
    await expect(sql).toContainText('CREATE EXTENSION "hstore" WITH SCHEMA "public"');
    expect(await installed()).toBeUndefined();
    await dialog.screenshot({ path: info.outputPath('PostgreSQL 扩展安装预览.png') });
    await apply();
    await expect(row.getByRole('cell', { name: source, exact: true })).toBeVisible();
    const original = await installed();
    expect(original).toMatchObject({ version: source, schema: 'public' });

    await expect(dialog.getByLabel(text.operation)).toHaveValue('update');
    await expect(dialog.getByText(text.updatePath, { exact: false })).toBeVisible();
    await dialog.getByLabel(text.version).selectOption(target);
    await preview();
    await expect(sql).toContainText('ALTER EXTENSION "hstore" UPDATE TO');
    await apply();
    await expect(row.getByRole('cell', { name: target, exact: true })).toHaveCount(2);
    expect(await installed()).toEqual({ ...original, version: target });

    const move = async () => {
      await dialog.getByLabel(text.operation).selectOption('move');
      await dialog.getByLabel(text.targetSchema).selectOption(destination);
      await preview();
      await expect(sql).toContainText('ALTER EXTENSION "hstore" SET SCHEMA ' + qualified);
      await apply();
    };
    await move();
    await expect(dialog.getByRole('alert')).toContainText('must be owner');
    expect(await installed()).toEqual({ ...original, version: target });
    await button(text.close).click();
    const adminName = 'PostgreSQL 扩展迁移测试';
    await saveConnection({ ...config, user: 'postgres', password: adminPassword }, adminName);
    await open(adminName);
    await dialog.getByLabel(text.search).fill('hstore');
    await button('hstore').click();
    await move();
    await expect(row.getByRole('cell', { name: destination, exact: true })).toBeVisible();
    expect(await installed()).toEqual({ ...original, version: target, schema: destination });
    expect((await observer.query(`SELECT ${qualified}.hstore('key', 'value')::text AS pair`)).rows).toEqual([{ pair: '"key"=>"value"' }]);
    await observer.query(`CREATE TABLE public.ext_fixture (value ${qualified}.hstore);
      INSERT INTO public.ext_fixture SELECT ${qualified}.hstore('id', '42')`);

    await dialog.getByLabel(text.operation).selectOption('drop');
    const confirmDrop = async () => {
      await preview();
      await expect(sql).toContainText('DROP EXTENSION "hstore" RESTRICT');
      await expect(button(text.apply)).toBeDisabled();
      await dialog.getByLabel(text.dropConfirm).fill('hstore');
    };
    await confirmDrop();
    await apply();
    await expect(dialog.getByRole('alert')).toContainText(/depend/i);
    expect(await installed()).toEqual({ ...original, version: target, schema: destination });
    expect((await observer.query('SELECT value::text FROM public.ext_fixture')).rows).toEqual([{ value: '"id"=>"42"' }]);
    await observer.query('DROP TABLE public.ext_fixture');
    await confirmDrop();
    await dialog.screenshot({ path: info.outputPath('PostgreSQL 扩展卸载预览.png') });
    await apply();
    await expect(row.getByRole('cell', { name: destination, exact: true })).toHaveCount(0);
    await expect(row.getByRole('cell', { name: target, exact: true })).toHaveCount(1);
    expect(await installed()).toBeUndefined();
    const native = desktop.process();
    await quitDesktop();
    expect(native.exitCode).toBe(0);
  } finally {
    await observer.end();
  }
});

test('PostgreSQL 扩展卸载保护显式依赖，拒绝同名替换和错误确认', async () => {
  const config = isolatedConnection(), observer = new Client(config);
  await observer.connect();
  try {
    const target = { connectionId: await saveConnection(config), database: config.database };
    const catalog = () => page.evaluate(input => window.dbark.invoke('postgres.extensionManage.read', input), target);
    const system = (await catalog()).extensions.find(item => item.name === 'plpgsql')!;
    expect(system.installed).toMatchObject({ manageable: false });
    await expect(page.evaluate(input => window.dbark.invoke('postgres.extensionManage.preview', input),
      { ...target, name: system.name, stamp: system.stamp, action: 'drop' as const })).rejects.toThrow('原扩展');
    await observer.query(`CREATE EXTENSION pgcrypto WITH SCHEMA public;
      CREATE FUNCTION public.ext_dependency() RETURNS int LANGUAGE sql AS 'SELECT 1';
      ALTER FUNCTION public.ext_dependency() DEPENDS ON EXTENSION pgcrypto`);
    const entry = (await catalog()).extensions.find(item => item.name === 'pgcrypto')!;
    const prepare = () => page.evaluate(input => window.dbark.invoke('postgres.extensionManage.preview', input),
      { ...target, name: entry.name, stamp: entry.stamp, action: 'drop' as const });
    await expect(prepare()).rejects.toThrow('存在显式依赖扩展的对象');
    expect((await observer.query('SELECT public.ext_dependency() AS value')).rows).toEqual([{ value: 1 }]);
    await observer.query('DROP FUNCTION public.ext_dependency()');
    const preview = await prepare();
    const apply = (dropName: string) => page.evaluate(input => window.dbark.invoke('postgres.extensionManage.apply', input),
      { ...target, token: preview.token, confirmed: true as const, dropName });
    await expect(apply('hstore')).rejects.toThrow('逐字输入');
    await observer.query('DROP EXTENSION pgcrypto RESTRICT; CREATE EXTENSION pgcrypto WITH SCHEMA public');
    expect(await apply('pgcrypto')).toMatchObject({ outcome: 'notSent' });
    expect((await catalog()).extensions.find(item => item.name === 'pgcrypto')?.installed).toBeTruthy();
    await expect(apply('pgcrypto')).rejects.toThrow('预览已失效');
    await observer.query('DROP EXTENSION pgcrypto RESTRICT');
    const native = desktop.process();
    await quitDesktop();
    expect(native.exitCode).toBe(0);
  } finally {
    await observer.end();
  }
});
