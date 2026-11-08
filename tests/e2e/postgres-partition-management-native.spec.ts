import { Client } from 'pg';
import type { PostgresPartitionManagePreview } from '../../src/shared/postgresPartitionManage';
import { postgresCreateTableZh } from '../../src/renderer/locales/postgresCreateTable.zh-CN';
import { postgresPartitionManageZh as text } from '../../src/renderer/locales/postgresPartitionManage.zh-CN';
import { postgresStructureZh as structure } from '../../src/renderer/locales/postgresStructure.zh-CN';
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

async function saveConnection(config: ReturnType<typeof isolatedConnection>) {
  return page.evaluate(async ({ host, port, user, database, password }) => (await window.dbark.invoke('connections.save', {
    id: '', name: 'PostgreSQL 子分区测试', group: '', color: '#123456', dialect: 'postgresql',
    host, port, user, database, password, rememberPassword: false,
  })).id, config);
}

test('PostgreSQL 界面新建、跨 Schema 挂接及分离子分区', async ({}, info) => {
  const config = isolatedConnection(), observer = new Client(config), table = '"public"."part_manage_root"';
  const child = '"子分区区"."待挂接 表"', added = '"public"."初始范围"';
  await observer.connect();
  try {
    await observer.query(`CREATE SCHEMA "子分区区"; CREATE TABLE ${table}(id int) PARTITION BY RANGE(id);
      CREATE TABLE ${child}(id int); INSERT INTO ${child} VALUES (12), (15)`);
    const fact = async (name: string) => (await observer.query(`
      SELECT c.oid::text, c.relispartition AS attached FROM pg_catalog.pg_class c WHERE c.oid=pg_catalog.to_regclass($1)
    `, [name])).rows[0];
    const original = await fact(child);
    const connectionId = await saveConnection(config);
    await page.evaluate(async ({ connectionId, database, table }) => {
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'pg-partition-manage-root', tabs: [
        { id: 'pg-partition-manage-root', title: '分区维护父表', kind: 'table', connectionId, database, table },
      ] });
    }, { connectionId, database: config.database, table });
    await page.reload();
    await page.locator('.postgres-table-tab:visible').getByRole('button', { name: structure.open, exact: true }).click();
    await page.getByRole('dialog', { name: structure.title, exact: true }).getByRole('button', { name: text.title, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: text.title, exact: true });
    const button = (name: string) => dialog.getByRole('button', { name, exact: true });
    const preview = () => button(text.preview).click(), apply = () => button(text.apply).click();
    const sql = dialog.getByLabel(text.sql, { exact: true });
    const choose = (action: PostgresPartitionManagePreview['action']) =>
      dialog.getByRole('combobox', { name: text.operation, exact: true }).selectOption(action);
    const fillBounds = async (from: string, to: string) => {
      await dialog.getByLabel('id' + postgresCreateTableZh.partition.from, { exact: true }).fill(from);
      await dialog.getByLabel('id' + postgresCreateTableZh.partition.to, { exact: true }).fill(to);
    };
    await expect(dialog.getByText(text.empty)).toBeVisible();
    await dialog.getByLabel(text.name, { exact: true }).fill('初始范围');
    await fillBounds('0', '10');
    await preview();
    await expect(sql).toContainText('CREATE TABLE ' + added + ' PARTITION OF ' + table);
    expect(await fact(added)).toBeUndefined();
    await apply();
    await expect(dialog.getByRole('rowheader', { name: added, exact: true })).toBeVisible();
    expect(await fact(added)).toMatchObject({ attached: true });
    await observer.query('INSERT INTO ' + table + ' VALUES (3)');

    await choose('attach');
    await dialog.getByLabel(text.schema, { exact: true }).fill('子分区区');
    await dialog.getByLabel(text.existing, { exact: true }).fill('待挂接 表');
    await fillBounds('10', '20');
    await preview();
    await expect(sql).toContainText('ATTACH PARTITION ' + child);
    await expect(sql).toContainText('LOCK TABLE ONLY ' + table + ', ONLY ' + child);
    expect(await fact(child)).toEqual(original);
    await dialog.screenshot({ path: info.outputPath('PostgreSQL 挂接子分区预览.png') });
    await apply();
    await expect(dialog.getByRole('rowheader', { name: child, exact: true })).toBeVisible();
    expect(await fact(child)).toEqual({ ...original, attached: true });
    expect((await observer.query('SELECT id FROM ' + table + ' ORDER BY id')).rows).toEqual([{ id: 3 }, { id: 12 }, { id: 15 }]);

    await choose('detach');
    await dialog.getByRole('combobox', { name: text.child, exact: true }).selectOption({ label: child });
    await preview();
    await expect(sql).toContainText('DETACH PARTITION ' + child);
    await dialog.screenshot({ path: info.outputPath('PostgreSQL 分离子分区预览.png') });
    await apply();
    await expect(dialog.getByRole('rowheader', { name: added, exact: true })).toBeVisible();
    await expect(dialog.getByRole('rowheader', { name: child, exact: true })).toHaveCount(0);
    expect(await fact(child)).toEqual(original);
    expect((await observer.query('SELECT id FROM ' + table)).rows).toEqual([{ id: 3 }]);
    expect((await observer.query('SELECT id FROM ' + child + ' ORDER BY id')).rows).toEqual([{ id: 12 }, { id: 15 }]);
    await button(text.back).click();
    await expect(page.getByRole('dialog', { name: structure.title, exact: true })).toBeVisible();
    const native = desktop.process();
    await quitDesktop();
    expect(native.exitCode).toBe(0);
    await observer.query(`DROP TABLE ${table}, ${child}; DROP SCHEMA "子分区区"`);
    expect(await fact(added)).toBeUndefined();
  } finally { await observer.end(); }
});

test('PostgreSQL 挂接检查原行边界，同名替换后拒绝应用', async () => {
  const config = isolatedConnection(), observer = new Client(config);
  await observer.connect();
  try {
    const target = { connectionId: await saveConnection(config), database: config.database, table: '"public"."part_guard_root"' };
    await observer.query(`CREATE TABLE public.part_guard_root(id int) PARTITION BY RANGE(id);
      CREATE TABLE public.part_guard_child(id int); INSERT INTO public.part_guard_child VALUES (99)`);
    const facts = () => page.evaluate(input => window.dbark.invoke('postgres.partitionManage.read', input), target);
    const preview = async () => page.evaluate(input => window.dbark.invoke('postgres.partitionManage.preview', input), {
      ...target, stamp: (await facts()).stamp, action: 'attach' as const, schema: 'public', existingName: 'part_guard_child',
      bound: { kind: 'range' as const, from: [{ kind: 'value' as const, value: '10' }], to: [{ kind: 'value' as const, value: '20' }] },
    });
    const apply = (token: string) => page.evaluate(input => window.dbark.invoke('postgres.partitionManage.apply', input),
      { connectionId: target.connectionId, database: target.database, token, confirmed: true as const });
    expect(await apply((await preview()).token)).toMatchObject({ outcome: 'rolledBack', message: expect.stringMatching(/violated|constraint/i) });
    expect((await facts()).children).toEqual([]);
    expect((await observer.query('SELECT id FROM public.part_guard_child')).rows).toEqual([{ id: 99 }]);
    await observer.query('UPDATE public.part_guard_child SET id=11');
    const { token } = await preview();
    await observer.query(`ALTER TABLE public.part_guard_child RENAME TO part_guard_original;
      CREATE TABLE public.part_guard_child(id int); INSERT INTO public.part_guard_child VALUES (12)`);
    expect(await apply(token)).toMatchObject({ outcome: 'notSent' });
    await expect(apply(token)).rejects.toThrow('预览已失效');
    expect((await facts()).children).toEqual([]);
    expect((await observer.query('SELECT id FROM public.part_guard_child')).rows).toEqual([{ id: 12 }]);
    expect((await observer.query('SELECT id FROM public.part_guard_original')).rows).toEqual([{ id: 11 }]);
    const native = desktop.process();
    await quitDesktop();
    expect(native.exitCode).toBe(0);
    await observer.query('DROP TABLE public.part_guard_root, public.part_guard_child, public.part_guard_original');
  } finally { await observer.end(); }
});
