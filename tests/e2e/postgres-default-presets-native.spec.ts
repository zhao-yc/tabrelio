import { Client } from 'pg';
import { postgresColumnEditZh as edit } from '../../src/renderer/locales/postgresColumnEdit.zh-CN';
import { postgresCreateTableZh as create } from '../../src/renderer/locales/postgresCreateTable.zh-CN';
import { postgresStructureZh as structure } from '../../src/renderer/locales/postgresStructure.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import { test, expect, desktop, page, quitDesktop } from './desktop-fixture';
import { clickSidebarAction } from './sidebar-menu';

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

const connectionName = 'PostgreSQL 默认值测试';
async function saveConnection(config: ReturnType<typeof isolatedConnection>) {
  return page.evaluate(async ({ host, port, user, database, password, name }) => (await window.dbark.invoke('connections.save', {
    id: '', name, group: '', color: '#123456', dialect: 'postgresql', host, port, user, database, password, rememberPassword: false,
  })).id, { ...config, name: connectionName });
}

test('PostgreSQL 默认值经建表、新增字段、修改和清除后实际生效', async ({}, info) => {
  const config = isolatedConnection(), observer = new Client(config), table = '"public"."默认值测试表"';
  await observer.connect();
  try {
    await saveConnection(config);
    await page.reload();
    await page.locator('.connection-row').filter({ hasText: connectionName }).locator('.tree-label').click();
    await clickSidebarAction(page.locator('.database-row').filter({ hasText: config.database }), { name: zh.sidebar.text017, exact: true });
    const dialog = page.getByRole('dialog', { name: create.title, exact: true });
    await dialog.getByLabel(create.schema, { exact: true }).selectOption('public');
    await dialog.getByLabel(create.table, { exact: true }).fill('默认值测试表');
    const first = dialog.getByRole('group', { name: create.field(1), exact: true });
    await first.getByLabel(create.name, { exact: true }).fill('id');
    const firstType = first.getByLabel(create.type, { exact: true }), firstDefault = first.getByLabel(create.default, { exact: true });
    await firstType.selectOption('uuid');
    await firstDefault.selectOption('randomUuid');
    await firstType.selectOption('date');
    await expect(firstDefault).toHaveValue('none');
    await expect(firstDefault.getByRole('option', { name: create.presets.randomUuid, exact: true })).toHaveCount(0);
    await firstType.selectOption('uuid');
    await firstDefault.selectOption('randomUuid');
    await first.getByRole('checkbox', { name: create.primary, exact: true }).check();
    await dialog.getByRole('button', { name: create.add, exact: true }).click();
    const second = dialog.getByRole('group', { name: create.field(2), exact: true });
    await second.getByLabel(create.name, { exact: true }).fill('created_on');
    await second.getByLabel(create.type, { exact: true }).selectOption('date');
    await second.getByLabel(create.default, { exact: true }).selectOption('currentDate');
    await dialog.screenshot({ path: info.outputPath('PostgreSQL 建表默认值.png') });
    await dialog.getByRole('button', { name: create.preview, exact: true }).click();
    await expect(dialog.locator('.pg-create-sql')).toContainText('DEFAULT pg_catalog.gen_random_uuid()');
    expect((await observer.query('SELECT to_regclass($1) AS rel', [table])).rows[0].rel).toBeNull();
    await dialog.getByRole('button', { name: create.apply, exact: true }).click();
    await expect(dialog).toBeHidden();
    const old = (await observer.query(`INSERT INTO ${table} DEFAULT VALUES
      RETURNING id::text, pg_catalog.uuid_extract_version(id) AS version, created_on = CURRENT_DATE AS today`)).rows[0];
    expect(old).toMatchObject({ version: 4, today: true });
    await observer.query(`ALTER TABLE ${table} ADD COLUMN stamped timestamp(3) without time zone`);

    await page.locator('.postgres-table-tab:visible').getByRole('button', { name: structure.open, exact: true }).click();
    const details = page.getByRole('dialog', { name: structure.title, exact: true });
    const open = () => details.getByRole('button', { name: edit.open, exact: true }).click();
    const panel = details.getByRole('region', { name: edit.title, exact: true });
    const action = panel.getByLabel(edit.operation, { exact: true }), field = panel.getByLabel(edit.from, { exact: true });
    const defaultMode = panel.getByLabel(create.default, { exact: true });
    const button = (name: string) => panel.getByRole('button', { name, exact: true });
    const stage = () => button(edit.stage).click();
    await open();
    await panel.getByLabel(edit.name, { exact: true }).fill('added_on');
    await panel.getByLabel(edit.type, { exact: true }).selectOption('timestamptz');
    await defaultMode.selectOption('currentTimestamp');
    await stage();
    await action.selectOption('default');
    await field.selectOption('id');
    await expect(panel.locator('code')).toContainText('gen_random_uuid()');
    await expect(button(edit.stage)).toBeDisabled();
    await defaultMode.selectOption('timeOrderedUuid');
    await panel.screenshot({ path: info.outputPath('PostgreSQL 修改 UUID 默认值.png') });
    await stage();
    await field.selectOption('stamped');
    await defaultMode.selectOption('currentTimestamp');
    await stage();
    await field.selectOption('created_on');
    await defaultMode.selectOption('none');
    await stage();
    await button(edit.preview).click();
    const sql = panel.getByLabel(edit.previewTitle, { exact: true });
    await expect(sql).toContainText('SET DEFAULT pg_catalog.uuidv7()');
    await expect(sql).toContainText('ALTER COLUMN "created_on" DROP DEFAULT');
    expect((await observer.query(`SELECT pg_catalog.uuid_extract_version(id) AS version FROM ${table}`)).rows)
      .toEqual([{ version: 4 }]);
    await button(edit.apply).click();
    await expect(panel).toHaveCount(0);
    expect((await observer.query(`INSERT INTO ${table} DEFAULT VALUES RETURNING
      pg_catalog.uuid_extract_version(id) AS version, added_on = CURRENT_TIMESTAMP AS added,
      stamped = CURRENT_TIMESTAMP::timestamp(3) AS stamped, created_on IS NULL AS cleared`)).rows)
      .toEqual([{ version: 7, added: true, stamped: true, cleared: true }]);
    expect((await observer.query(`SELECT created_on IS NOT NULL AS kept, stamped IS NULL AS unmodified FROM ${table} WHERE id = $1`, [old.id])).rows)
      .toEqual([{ kept: true, unmodified: true }]);
    const native = desktop.process();
    await quitDesktop();
    expect(native.exitCode).toBe(0);
  } finally { await observer.end(); }
});

test('PostgreSQL 默认值权限变更在写入前阻止，目录表达式不符时回滚', async () => {
  const config = isolatedConnection();
  const adminPassword = process.env.DBARK_PG_ROLES_ADMIN_PASSWORD ?? '';
  if (!/^[a-f0-9]{64}$/.test(adminPassword)) throw Error('需要隔离库管理夹具');
  const observer = new Client(config), admin = new Client({ ...config, user: 'postgres', password: adminPassword });
  await Promise.all([observer.connect(), admin.connect()]);
  try {
    const table = '"public"."default_race"', connectionId = await saveConnection(config);
    const target = { connectionId, database: config.database, table };
    await observer.query(`CREATE TABLE ${table}(id uuid DEFAULT pg_catalog.gen_random_uuid(), day date)`);
    const read = () => page.evaluate(input => window.dbark.invoke('postgres.structure.read', input), target);
    const prepare = async () => page.evaluate(input => window.dbark.invoke('postgres.columnEdit.preview', input), {
      ...target, editStamp: (await read()).editStamp!,
      changes: [{ kind: 'defaultPreset' as const, from: 'id', preset: 'timeOrderedUuid' as const }],
    });
    const apply = (token: string) => page.evaluate(input => window.dbark.invoke('postgres.columnEdit.apply', input), { ...target, token });
    const allowed = await prepare();
    await admin.query('REVOKE EXECUTE ON FUNCTION pg_catalog.uuidv7(interval) FROM PUBLIC');
    try {
      expect(await apply(allowed.token)).toMatchObject({ outcome: 'notSent', message: expect.stringContaining('执行权限') });
      await expect(prepare()).rejects.toThrow('执行权限');
    } finally { await admin.query('GRANT EXECUTE ON FUNCTION pg_catalog.uuidv7(interval) TO PUBLIC'); }

    await admin.query(`CREATE FUNCTION public.replace_default_for_test() RETURNS event_trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF current_query() = 'ALTER TABLE ONLY "public"."default_race" ALTER COLUMN "id" SET DEFAULT pg_catalog.uuidv7()'
          AND pg_catalog.current_setting('tabrelio.replacing_default', true) IS DISTINCT FROM '1' THEN
          PERFORM pg_catalog.set_config('tabrelio.replacing_default', '1', true);
          ALTER TABLE ONLY public.default_race ALTER COLUMN id SET DEFAULT pg_catalog.gen_random_uuid();
        END IF;
      END; $$;
      CREATE EVENT TRIGGER replace_default_for_test ON ddl_command_end WHEN TAG IN ('ALTER TABLE')
        EXECUTE FUNCTION public.replace_default_for_test()`);
    try {
      expect(await apply((await prepare()).token)).toMatchObject({ outcome: 'rolledBack', message: expect.stringContaining('与预览不一致') });
      expect((await observer.query(`INSERT INTO ${table} DEFAULT VALUES RETURNING pg_catalog.uuid_extract_version(id) AS version`)).rows)
        .toEqual([{ version: 4 }]);
    } finally { await admin.query('DROP EVENT TRIGGER replace_default_for_test; DROP FUNCTION public.replace_default_for_test()'); }
    const native = desktop.process();
    await quitDesktop();
    expect(native.exitCode).toBe(0);
  } finally { await Promise.all([admin.end(), observer.end()]); }
});
