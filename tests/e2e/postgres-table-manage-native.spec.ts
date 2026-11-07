import { Client } from 'pg';
import { postgresIdentifier } from '../../src/shared/postgresSql';
import { postgresColumnEditZh as edit } from '../../src/renderer/locales/postgresColumnEdit.zh-CN';
import { postgresStructureZh as structure } from '../../src/renderer/locales/postgresStructure.zh-CN';
import { postgresTableZh as table } from '../../src/renderer/locales/postgresTable.zh-CN';
import { postgresTableManageZh as manage } from '../../src/renderer/locales/postgresTableManage.zh-CN';
import { postgresViewManageZh as viewManage } from '../../src/renderer/locales/postgresViewManage.zh-CN';
import { test, expect, desktop, page, quitDesktop } from './desktop-fixture';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.skip(process.env.DBARK_POSTGRES_WORKSPACE_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
test.setTimeout(60_000);

function fixture() {
  const user = process.env.DBARK_POSTGRES_TEST_USER ?? '', database = process.env.DBARK_POSTGRES_TEST_DATABASE ?? '';
  const password = process.env.DBARK_POSTGRES_TEST_PASSWORD ?? '', port = Number(process.env.DBARK_POSTGRES_TEST_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pg_[a-f0-9]{12}$/.test(user) || database !== user ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('需要本轮独占回环库');
  return { host: '127.0.0.1', port, user, database, password, connectionTimeoutMillis: 3000 };
}

async function saveConnection(connection: ReturnType<typeof fixture>) {
  return page.evaluate(async ({ host, port, user, database, password }) => (await window.dbark.invoke('connections.save', {
    id: '', name: 'PostgreSQL 表管理 ' + user, group: '', color: '#123456', dialect: 'postgresql',
    host, port, user, database, password, rememberPassword: false,
  })).id, connection);
}

test('PostgreSQL 管理表保护草稿，改名保留身份并按依赖限制删除', async ({}, info) => {
  const config = fixture(), observer = new Client(config);
  const original = '"public"."表 原"', newName = '表 "新"', renamed = '"public".' + postgresIdentifier(newName);
  const dependent = '"public"."表 依赖"';
  await observer.connect();
  try {
    await observer.query(`CREATE TABLE ${original}(id integer PRIMARY KEY, note text);
      INSERT INTO ${original} VALUES (1,'原数据');
      CREATE TABLE public.occupied(id integer);
      CREATE SCHEMA another; CREATE TABLE another.${postgresIdentifier(newName)}(id integer);
      CREATE VIEW ${dependent} AS SELECT note FROM ${original};`);
    const oid = async (relation: string) => (await observer.query('SELECT pg_catalog.to_regclass($1)::oid::text AS oid', [relation])).rows[0].oid;
    const originalOid = await oid(original);
    const connectionId = await saveConnection(config);
    await page.evaluate(async ({ connectionId, database, original, dependent }) => {
      const workbench = await window.dbark.invoke('workbench.get', {});
      await window.dbark.invoke('workbench.save', { ...workbench, document: { ...workbench.document, favorites: [
        { id: 'pg-table-favorite', label: '我的原表收藏', groupId: null, target: { kind: 'table', connectionId, database, name: original } },
      ] } });
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'pg-managed-table', tabs: [
        { id: 'pg-managed-table', title: '管理原表', kind: 'table', connectionId, database, table: original },
        { id: 'pg-dependent-view', title: '依赖视图', kind: 'table', connectionId, database, table: dependent },
      ] });
    }, { connectionId, database: config.database, original, dependent });
    await page.reload();
    const tab = page.locator('.postgres-table-tab:visible'), grid = tab.getByRole('grid');
    const button = (name: string) => tab.getByRole('button', { name, exact: true });
    const dialog = page.getByRole('dialog', { name: structure.title, exact: true });
    const section = dialog.getByRole('region', { name: manage.title, exact: true });
    const action = (name: string) => section.getByRole('button', { name, exact: true });
    const open = async () => {
      await button(structure.open).click();
      await dialog.getByRole('button', { name: manage.title, exact: true }).click();
    };
    const draftName = section.getByLabel(manage.name, { exact: true });
    await grid.getByRole('gridcell', { name: '原数据', exact: true }).click();
    await button(table.edit).click();
    const record = page.getByRole('dialog', { name: table.edit, exact: true });
    await record.getByLabel('note ' + table.valueMode, { exact: true }).selectOption('text');
    await record.getByLabel('note ' + table.value, { exact: true }).fill('保留的草稿');
    await record.getByRole('button', { name: table.stage, exact: true }).click();
    await open();
    await draftName.fill(newName);
    await action(manage.preview).click();
    await expect(section.getByText(edit.dirty, { exact: true })).toBeVisible();
    await action(manage.close).click();
    await dialog.getByRole('button', { name: structure.close, exact: true }).click();
    await expect(tab.getByLabel(table.draft, { exact: true })).toContainText('保留的草稿');
    await button(table.discard).click();
    await open();
    await draftName.fill('occupied');
    await action(manage.preview).click();
    await expect(section.getByText('目标 schema 已存在同名关系', { exact: true })).toBeVisible();
    await draftName.fill(newName);
    await action(manage.preview).click();
    await expect(section.getByLabel(manage.sql)).toHaveText('ALTER TABLE ' + original + ' RENAME TO ' + postgresIdentifier(newName) + ';');
    expect(await oid(original)).toBe(originalOid);
    expect(await oid(renamed)).toBeNull();
    await section.screenshot({ path: info.outputPath('PostgreSQL 表重命名预览.png') });
    await action(manage.confirmRename).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('[data-workspace-tab-id="pg-managed-table"]')).toHaveCount(0);
    await expect(page.locator('[data-active-workspace-tab="true"] .tab-select')).toHaveText(renamed);
    await expect(grid.getByRole('gridcell', { name: '原数据', exact: true })).toBeVisible();
    expect(await oid(renamed)).toBe(originalOid);
    expect(await oid(original)).toBeNull();
    expect((await observer.query('SELECT note FROM ' + dependent)).rows).toEqual([{ note: '原数据' }]);
    await expect.poll(() => page.evaluate(async () => (await window.dbark.invoke('workbench.get', {})).document.favorites)).toMatchObject([
      { id: 'pg-table-favorite', label: '我的原表收藏', target: { kind: 'table', name: renamed } },
    ]);

    const previewDrop = async () => {
      await section.getByLabel(manage.operation, { exact: true }).selectOption('drop');
      await action(manage.preview).click();
      await expect(section.getByLabel(manage.sql)).toHaveText('DROP TABLE ' + renamed + ' RESTRICT;');
      await expect(action(manage.confirmDrop)).toBeDisabled();
      await section.getByLabel(manage.acknowledge, { exact: true }).fill(newName);
    };
    await open();
    await previewDrop();
    await section.screenshot({ path: info.outputPath('PostgreSQL 表受限删除预览.png') });
    await action(manage.confirmDrop).click();
    await expect(section.getByRole('alert')).toContainText(/depend|依赖/);
    expect(await oid(renamed)).toBe(originalOid);
    await action(manage.close).click();
    await dialog.getByRole('button', { name: structure.close, exact: true }).click();
    await page.locator('[data-workspace-tab-id="pg-dependent-view"] .tab-select').click();
    await button(structure.open).click();
    await dialog.getByRole('button', { name: viewManage.title, exact: true }).click();
    const view = dialog.getByRole('region', { name: viewManage.title, exact: true });
    await view.getByLabel(viewManage.operation, { exact: true }).selectOption('drop');
    await view.getByRole('button', { name: viewManage.preview, exact: true }).click();
    await view.getByRole('checkbox', { name: viewManage.acknowledge, exact: true }).check();
    await view.getByRole('button', { name: viewManage.confirmDrop, exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(await oid(dependent)).toBeNull();
    await page.locator('.tab-select').getByText(renamed, { exact: true }).click();
    await open();
    await previewDrop();
    await action(manage.confirmDrop).click();
    await expect(dialog).toHaveCount(0);
    expect(await oid(renamed)).toBeNull();
    expect(await oid('another.' + postgresIdentifier(newName))).not.toBeNull();
    await expect(page.locator('.tab-select').getByText(renamed, { exact: true })).toHaveCount(0);
    const native = desktop.process();
    await quitDesktop();
    expect(native.exitCode).toBe(0);
  } finally { await observer.end(); }
});

test('PostgreSQL 表管理在等锁时拒绝同名替换并遵守分区和 schema 所有权', async () => {
  const config = fixture(), holder = new Client(config), observer = new Client(config);
  const adminPassword = process.env.DBARK_PG_ROLES_ADMIN_PASSWORD ?? '';
  if (!/^[a-f0-9]{64}$/.test(adminPassword)) throw Error('需要隔离库管理夹具');
  const admin = new Client({ ...config, user: 'postgres', password: adminPassword });
  const schemaOwner = config.user + '_limited';
  await Promise.all([holder.connect(), observer.connect(), admin.connect()]);
  try {
    await holder.query(`CREATE TABLE public.race_table(id integer);
      INSERT INTO public.race_table VALUES(11);
      CREATE TABLE public.partition_root(id integer) PARTITION BY RANGE(id);
      CREATE TABLE public.partition_child PARTITION OF public.partition_root FOR VALUES FROM (0) TO (10)`);
    await admin.query(`CREATE SCHEMA manage_other AUTHORIZATION ${schemaOwner};
      CREATE TABLE manage_other.no_select(id integer); INSERT INTO manage_other.no_select VALUES (1)`);
    const originalId = (await observer.query("SELECT 'public.race_table'::regclass::oid::text AS oid")).rows[0].oid;
    const ownerProfile = await saveConnection(config), schemaProfile = await saveConnection({ ...config, user: schemaOwner });
    const target = (table: string, connectionId = ownerProfile) => ({ database: config.database, connectionId, table });
    const facts = (input: ReturnType<typeof target>) => page.evaluate(input => window.dbark.invoke('postgres.structure.read', input), input);
    const prepare = (input: ReturnType<typeof target>, stamp: string) => page.evaluate(
      draft => window.dbark.invoke('postgres.tableManage.preview', { ...draft, action: 'drop' }), { ...input, stamp });
    const apply = ({ connectionId, database }: ReturnType<typeof target>, token: string) => page.evaluate(
      input => window.dbark.invoke('postgres.tableManage.apply', { ...input, confirmed: true }), { connectionId, database, token });
    await holder.query('GRANT SELECT ON public.race_table TO ' + schemaOwner);
    expect((await facts(target('"public"."race_table"', schemaProfile))).tableManage).toBeUndefined();

    for (const table of ['"public"."partition_root"', '"public"."partition_child"']) {
      const input = target(table), capability = (await facts(input)).tableManage;
      expect(capability).toMatchObject({ rename: true, drop: false });
      await expect(prepare(input, capability!.stamp)).rejects.toThrow();
    }
    const partition = target('"public"."partition_root"');
    const renamedPartition = await page.evaluate(input => window.dbark.invoke('postgres.tableManage.preview', {
      ...input, action: 'rename', name: 'partition_renamed',
    }), { ...partition, stamp: (await facts(partition)).tableManage!.stamp });
    expect(await apply(partition, renamedPartition.token)).toMatchObject({ outcome: 'committed' });
    expect((await observer.query(`SELECT inhrelid::regclass::text AS child FROM pg_catalog.pg_inherits
      WHERE inhparent='public.partition_renamed'::regclass`)).rows).toEqual([{ child: 'partition_child' }]);

    const delegated = target('"manage_other"."no_select"', schemaProfile);
    const limited = new Client({ ...config, user: schemaOwner });
    await limited.connect();
    try { await expect(limited.query('SELECT * FROM manage_other.no_select')).rejects.toMatchObject({ code: '42501' }); }
    finally { await limited.end(); }
    const delegatedCapability = (await facts(delegated)).tableManage;
    expect(delegatedCapability).toMatchObject({ rename: false, drop: true });
    expect(await apply(delegated, (await prepare(delegated, delegatedCapability!.stamp)).token)).toMatchObject({ outcome: 'committed' });
    expect((await admin.query("SELECT to_regclass('manage_other.no_select') AS relation")).rows[0].relation).toBeNull();

    const input = target('"public"."race_table"');
    const plan = await prepare(input, (await facts(input)).tableManage!.stamp);
    await holder.query('BEGIN; LOCK TABLE public.race_table IN ACCESS EXCLUSIVE MODE');
    const applying = apply(input, plan.token);
    void applying.catch(() => undefined);
    try {
      await expect.poll(async () => (await observer.query(`SELECT EXISTS(SELECT FROM pg_catalog.pg_stat_activity
        WHERE wait_event_type='Lock' AND query LIKE $1) AS waiting`, ['SELECT 1 FROM ONLY "public"."race_table"%'])).rows[0].waiting,
      { timeout: 3500 }).toBe(true);
      await holder.query(`ALTER TABLE public.race_table RENAME TO race_original;
        CREATE TABLE public.race_table(id integer); INSERT INTO public.race_table VALUES (22); COMMIT`);
    } finally { await holder.query('ROLLBACK'); }
    expect(await applying).toMatchObject({ outcome: 'notSent', message: expect.stringContaining('原表') });
    await expect(apply(input, plan.token)).rejects.toThrow();
    expect((await observer.query("SELECT 'public.race_original'::regclass::oid::text AS oid")).rows[0].oid).toBe(originalId);
    expect((await observer.query('SELECT id FROM public.race_original UNION ALL SELECT id FROM public.race_table')).rows).toEqual([{ id: 11 }, { id: 22 }]);
    const native = desktop.process();
    await quitDesktop();
    expect(native.exitCode).toBe(0);
  } finally { await Promise.all([holder.end(), observer.end(), admin.end()]); }
});
