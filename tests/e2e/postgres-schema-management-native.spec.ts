import { Client } from 'pg';
import type { PostgresSchemaPreviewInput } from '../../src/shared/postgresSchemaManage';
import { postgresSchemaManageZh as schema } from '../../src/renderer/locales/postgresSchemaManage.zh-CN';
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

const connectionName = 'PostgreSQL Schema 管理测试';
async function saveConnection(config: ReturnType<typeof isolatedConnection>) {
  return page.evaluate(async ({ host, port, user, database, password, name }) => (await window.dbark.invoke('connections.save', {
    id: '', name, group: '', color: '#123456', dialect: 'postgresql', host, port, user, database, password, rememberPassword: false,
  })).id, { ...config, name: connectionName });
}

test('PostgreSQL Schema 目录创建、注释、改名、转移所有者和受限删除', async ({}, info) => {
  const config = isolatedConnection(), observer = new Client(config);
  const source = '业务"原区', destination = '业务.新区', oldName = postgresIdentifier(source), newName = postgresIdentifier(destination);
  const readFacts = async (name: string) => (await observer.query(`
    SELECT n.oid::text, r.rolname AS owner, pg_catalog.obj_description(n.oid, 'pg_namespace') AS comment
    FROM pg_catalog.pg_namespace n JOIN pg_catalog.pg_roles r ON r.oid=n.nspowner WHERE n.nspname::text=$1`, [name])).rows[0];
  await observer.connect();
  try {
    await saveConnection(config);
    await page.reload();
    await page.locator('.connection-row').filter({ hasText: connectionName }).locator('.tree-label').click();
    const databaseRow = page.locator('.database-row').filter({ hasText: config.database });
    const open = () => clickSidebarAction(databaseRow, { name: schema.title, exact: true });
    const dialog = page.getByRole('dialog', { name: schema.title, exact: true });
    const button = (name: string) => dialog.getByRole('button', { name, exact: true });
    const sql = dialog.getByLabel(schema.sql, { exact: true });
    const choose = (action: PostgresSchemaPreviewInput['action']) => dialog.getByLabel(schema.operation, { exact: true }).selectOption(action);
    const select = (value: string) => dialog.getByLabel(schema.source, { exact: true }).selectOption(value);
    const preview = () => button(schema.preview).click();
    const apply = () => button(schema.apply).click();
    await open();
    await expect(dialog.getByRole('rowheader', { name: 'public', exact: true })).toBeVisible();
    await expect(dialog.getByRole('rowheader', { name: 'pg_catalog', exact: true })).toHaveCount(0);
    await dialog.getByLabel(schema.name, { exact: true }).fill(source);
    const initialComment = "初始'注释\\\n第二行";
    await dialog.getByLabel(schema.comment, { exact: true }).fill(initialComment);
    await preview();
    await expect(sql).toContainText('CREATE SCHEMA ' + oldName);
    expect(await readFacts(source)).toBeUndefined();
    await dialog.screenshot({ path: info.outputPath('PostgreSQL 新建 Schema 预览.png') });
    await apply();
    await expect(dialog.getByRole('rowheader', { name: source, exact: true })).toBeVisible();
    const original = await readFacts(source);
    expect(original).toMatchObject({ owner: config.user, comment: initialComment });
    await choose('comment');
    await select(source);
    await expect(dialog.getByLabel(schema.comment, { exact: true })).toHaveValue(initialComment);
    await dialog.getByLabel(schema.comment, { exact: true }).fill('保留注释');
    await preview();
    await apply();
    await expect(dialog.getByRole('table')).toContainText('保留注释');

    await observer.query(`CREATE TABLE ${oldName}."测试表"(id int PRIMARY KEY); INSERT INTO ${oldName}."测试表" VALUES (42)`);
    await button(schema.close).click();
    await databaseRow.locator('.tree-label').click();
    await page.locator('.object-row').filter({ hasText: oldName + '."测试表"' }).locator('.tree-label').click();
    await expect(page.locator('.postgres-table-tab:visible').getByRole('grid')).toContainText('42');
    const renamePreview = async () => {
      await choose('rename');
      await select(source);
      await dialog.getByLabel(schema.name, { exact: true }).fill(destination);
      await preview();
      await expect(sql).toContainText('ALTER SCHEMA ' + oldName + ' RENAME TO ' + newName);
    };
    await open();
    await renamePreview();
    await apply();
    await expect(dialog.getByRole('alert')).toContainText(schema.renameTabs);
    expect((await readFacts(source)).oid).toBe(original.oid);
    await button(schema.back).click();
    await choose('comment');
    await button(schema.close).click();
    await page.locator('.tab-strip .tab-close').click();
    await open();
    await renamePreview();
    await apply();
    await expect(dialog.getByRole('rowheader', { name: destination, exact: true })).toBeVisible();
    expect(await readFacts(source)).toBeUndefined();
    expect(await readFacts(destination)).toEqual({ ...original, comment: '保留注释' });
    expect((await observer.query(`SELECT id FROM ${newName}."测试表"`)).rows).toEqual([{ id: 42 }]);

    const role = config.user + '_limited';
    await choose('owner');
    await select(destination);
    await dialog.getByLabel(schema.newOwner, { exact: true }).fill(role);
    await preview();
    await expect(sql).toContainText('ALTER SCHEMA ' + newName + ' OWNER TO ' + postgresIdentifier(role));
    await apply();
    await expect(dialog.getByRole('row').filter({ has: page.getByRole('rowheader', { name: destination, exact: true }) })).toContainText(role);
    expect(await readFacts(destination)).toEqual({ ...original, owner: role, comment: '保留注释' });
    const drop = async () => {
      await choose('drop');
      await select(destination);
      await preview();
      await expect(sql).toContainText('DROP SCHEMA ' + newName + ' RESTRICT');
      await expect(button(schema.apply)).toBeDisabled();
      await dialog.getByLabel(schema.dropConfirm, { exact: true }).fill(destination);
      await button(schema.apply).click();
    };
    await drop();
    await expect(dialog.getByRole('alert')).toBeVisible();
    expect((await readFacts(destination)).oid).toBe(original.oid);
    await observer.query(`DROP TABLE ${newName}."测试表"`);
    await choose('drop');
    await select(destination);
    await preview();
    await dialog.getByLabel(schema.dropConfirm, { exact: true }).fill(destination);
    await dialog.screenshot({ path: info.outputPath('PostgreSQL 删除 Schema 预览.png') });
    await apply();
    await expect(dialog.getByRole('rowheader', { name: destination, exact: true })).toHaveCount(0);
    expect(await readFacts(destination)).toBeUndefined();
    const native = desktop.process();
    await quitDesktop();
    expect(native.exitCode).toBe(0);
  } finally { await observer.end(); }
});

test('PostgreSQL Schema 写入锁后拒绝同名替换，令牌一次消费', async () => {
  const config = isolatedConnection(), holder = new Client(config), observer = new Client(config);
  await Promise.all([holder.connect(), observer.connect()]);
  try {
    const connectionId = await saveConnection(config), database = config.database;
    const target = { connectionId, database };
    await observer.query("CREATE SCHEMA schema_race; COMMENT ON SCHEMA schema_race IS '原注释'");
    const read = () => page.evaluate(input => window.dbark.invoke('postgres.schemaManage.read', input), target);
    const original = (await read()).schemas.find(item => item.name === 'schema_race')!;
    const preview = await page.evaluate(input => window.dbark.invoke('postgres.schemaManage.preview', input), {
      ...target, schema: original.name, stamp: original.stamp, action: 'drop' as const,
    });
    const apply = () => page.evaluate(input => window.dbark.invoke('postgres.schemaManage.apply', input), {
      ...target, token: preview.token, confirmed: true as const,
    });
    await holder.query("BEGIN; DROP SCHEMA schema_race RESTRICT; CREATE SCHEMA schema_race; COMMENT ON SCHEMA schema_race IS '新身份'");
    const pending = apply();
    void pending.catch(() => undefined);
    try {
      await expect.poll(async () => (await observer.query(`SELECT EXISTS(SELECT FROM pg_catalog.pg_stat_activity
        WHERE wait_event_type = 'Lock' AND query LIKE '%pg_get_object_address%') AS waiting`)).rows[0].waiting,
      { timeout: 3500 }).toBe(true);
      await holder.query('COMMIT');
    } finally { await holder.query('ROLLBACK'); }
    expect(await pending).toMatchObject({ outcome: 'notSent' });
    const current = (await read()).schemas.find(item => item.name === 'schema_race')!;
    expect(current.comment).toBe('新身份');
    expect(current.stamp).not.toBe(original.stamp);
    await expect(apply()).rejects.toThrow('预览已失效');
    const role = config.user + '_limited';
    const authorization = await page.evaluate(input => window.dbark.invoke('postgres.schemaManage.preview', input), {
      ...target, action: 'create' as const, name: 'schema_authorized', newOwner: role, comment: null,
    });
    expect(authorization.statements[0]).toContain('AUTHORIZATION ' + postgresIdentifier(role));
    expect(await page.evaluate(input => window.dbark.invoke('postgres.schemaManage.apply', input), {
      ...target, token: authorization.token, confirmed: true as const,
    })).toMatchObject({ outcome: 'committed' });
    expect((await read()).schemas.find(item => item.name === 'schema_authorized')?.owner).toBe(role);
    const native = desktop.process();
    await quitDesktop();
    expect(native.exitCode).toBe(0);
  } finally { await Promise.all([holder.end(), observer.end()]); }
});
