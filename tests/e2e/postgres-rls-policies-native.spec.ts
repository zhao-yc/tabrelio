import { Client } from 'pg';
import type { PostgresPolicyChange } from '../../src/shared/postgresPolicy';
import { postgresTablePolicyZh as policy } from '../../src/renderer/locales/postgresTablePolicy.zh-CN';
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

const connectionName = 'PostgreSQL 行级安全测试';
async function saveConnection(config: ReturnType<typeof isolatedConnection>) {
  return page.evaluate(async ({ host, port, user, database, password, name }) => (await window.dbark.invoke('connections.save', {
    id: '', name, group: '', color: '#123456', dialect: 'postgresql', host, port, user, database, password, rememberPassword: false,
  })).id, { ...config, name: connectionName });
}

test('PostgreSQL 原生行级安全界面创建、原位修改、强制和删除策略', async ({}, info) => {
  const config = isolatedConnection(), table = '"public"."行级安全 ""表"""', actor = config.user + '_limited';
  const observer = new Client(config), reader = new Client(config);
  await Promise.all([observer.connect(), reader.connect()]);
  try {
    await observer.query(`CREATE TABLE ${table}(id int PRIMARY KEY, tenant text);
      GRANT SELECT, INSERT, UPDATE, DELETE ON ${table} TO "${actor}"`);
    await observer.query(`INSERT INTO ${table} VALUES (1, $1), (2, '其他租户')`, [actor]);
    await reader.query(`SET ROLE "${actor}"`);
    const ids = async (client: Client) => (await client.query(`SELECT id FROM ${table} ORDER BY id`)).rows.map(row => row.id);
    const connectionId = await saveConnection(config);
    const target = { connectionId, database: config.database, table };
    const read = () => page.evaluate(input => window.dbark.invoke('postgres.structure.read', input), target);
    await page.evaluate(async ({ connectionId, database, table }) => {
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'pg-rls', tabs: [
        { id: 'pg-rls', title: '行级安全测试', kind: 'table', connectionId, database, table },
      ] });
    }, target);
    await page.reload();
    await page.locator('.postgres-table-tab:visible').getByRole('button', { name: structure.open, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: structure.title, exact: true });
    await dialog.getByRole('button', { name: structure.sections.policies, exact: true }).click();
    await expect(dialog.getByText(policy.disabled, { exact: true })).toBeVisible();
    const open = () => dialog.getByRole('button', { name: policy.title, exact: true }).click();
    const panel = dialog.getByRole('region', { name: policy.title, exact: true });
    const button = (name: string) => panel.getByRole('button', { name, exact: true });
    const choose = (kind: PostgresPolicyChange['kind']) => panel.getByLabel(policy.operation, { exact: true }).selectOption(kind);
    const sql = panel.getByLabel(policy.sql, { exact: true });
    const preview = () => button(policy.preview).click();
    const confirm = async (name: string) => {
      await expect(button(policy.apply)).toBeDisabled();
      await panel.getByRole('checkbox', { name, exact: true }).check();
    };
    const apply = async () => { await button(policy.apply).click(); await expect(panel).toHaveCount(0); };
    await open();
    await panel.getByLabel(policy.name, { exact: true }).fill('读自己的行');
    await panel.getByLabel(policy.command, { exact: true }).selectOption('SELECT');
    await panel.getByLabel(policy.role(0), { exact: true }).fill(actor);
    await panel.getByLabel(policy.using, { exact: true }).fill('tenant = CURRENT_USER -- 当前角色');
    await preview();
    await expect(sql).toContainText('FOR SELECT TO "' + actor + '"');
    expect((await read()).policies).toEqual([]);
    await panel.screenshot({ path: info.outputPath('PostgreSQL 创建行级安全策略.png') });
    await apply();
    await expect(dialog.getByRole('table')).toContainText('读自己的行');
    const original = (await read()).policies?.[0];
    expect(await ids(reader)).toEqual([1, 2]);

    await open();
    await choose('state');
    await panel.getByRole('checkbox', { name: policy.enabled, exact: true }).check();
    await preview();
    await expect(sql).toContainText('ENABLE ROW LEVEL SECURITY');
    await confirm(policy.confirmState);
    await apply();
    expect(await ids(reader)).toEqual([1]);
    expect(await ids(observer)).toEqual([1, 2]);

    await open();
    await choose('edit');
    await expect(panel.getByLabel(policy.using, { exact: true })).toHaveValue(/tenant.*CURRENT_USER/i);
    await panel.getByLabel(policy.using, { exact: true }).fill('tenant = CURRENT_USER AND id > 1');
    await preview();
    await expect(sql).toContainText('ALTER POLICY');
    await apply();
    expect((await read()).policies?.[0].oid).toBe(original?.oid);
    expect(await ids(reader)).toEqual([]);

    await open();
    await choose('rename');
    await panel.getByLabel(policy.name, { exact: true }).fill('已限制');
    await preview();
    await apply();
    expect((await read()).policies?.[0]).toMatchObject({ name: '已限制', oid: original?.oid });

    await open();
    await choose('state');
    await panel.getByRole('checkbox', { name: policy.forced, exact: true }).check();
    await preview();
    await confirm(policy.confirmState);
    await panel.screenshot({ path: info.outputPath('PostgreSQL 强制行级安全预览.png') });
    await apply();
    expect(await ids(observer)).toEqual([]);

    await open();
    await choose('drop');
    await preview();
    await expect(sql).toContainText('DROP POLICY "已限制" ON ' + table + ' RESTRICT');
    await confirm(policy.confirmDrop);
    await apply();
    expect((await read()).policies).toEqual([]);
    expect(await ids(reader)).toEqual([]);
    await open();
    await choose('state');
    await panel.getByRole('checkbox', { name: policy.enabled, exact: true }).uncheck();
    await panel.getByRole('checkbox', { name: policy.forced, exact: true }).uncheck();
    await preview();
    await confirm(policy.confirmState);
    await apply();
    expect(await ids(reader)).toEqual([1, 2]);
    const native = desktop.process();
    await quitDesktop();
    expect(native.exitCode).toBe(0);
  } finally { await Promise.all([observer.end(), reader.end()]); }
});

test('PostgreSQL 分区表策略、写入检查、重建回滚及锁后原身份', async () => {
  const config = isolatedConnection(), observer = new Client(config), holder = new Client(config);
  await Promise.all([observer.connect(), holder.connect()]);
  try {
    const table = '"public"."rls_root"', child = '"public"."rls_child"', role = config.user + '_limited';
    const connectionId = await saveConnection(config);
    const target = { connectionId, database: config.database, table };
    await observer.query(`CREATE TABLE ${table}(id int, tenant text) PARTITION BY RANGE(id);
      CREATE TABLE ${child} PARTITION OF ${table} FOR VALUES FROM (0) TO (10);
      GRANT SELECT, INSERT ON ${table}, ${child} TO "${role}";
      INSERT INTO ${table} VALUES (1, '其他租户');
      CREATE POLICY readable ON ${table} FOR SELECT USING (true);
      COMMENT ON POLICY readable ON ${table} IS '必须保留注释'`);
    const read = (relation = table) => page.evaluate(input => window.dbark.invoke('postgres.structure.read', input), { ...target, table: relation });
    const prepare = async (change: PostgresPolicyChange) => page.evaluate(input => window.dbark.invoke('postgres.tableManage.preview', input),
      { ...target, stamp: (await read()).policyStamp!, action: 'policy' as const, change });
    const apply = (token: string) => page.evaluate(input => window.dbark.invoke('postgres.tableManage.apply', input),
      { connectionId, database: config.database, token, confirmed: true as const });
    const before = (await read()).policies?.[0];
    const edit = { kind: 'edit', from: 'readable', command: 'INSERT', permissive: true, roles: [role], using: null,
      check: 'tenant = CURRENT_USER' } satisfies PostgresPolicyChange;
    const broken = await prepare({ ...edit, check: 'missing_column > 0' });
    expect(broken.statements.some(sql => sql.startsWith('DROP POLICY'))).toBe(true);
    expect(await apply(broken.token)).toMatchObject({ outcome: 'rolledBack' });
    expect((await read()).policies?.[0]).toEqual(before);
    const valid = await prepare(edit);
    expect(await apply(valid.token)).toMatchObject({ outcome: 'committed' });
    expect((await read()).policies?.[0]).toMatchObject({ command: 'INSERT', comment: before?.comment, using: null });
    expect((await read()).policies?.[0].oid).not.toBe(before?.oid);
    const enable = await prepare({ kind: 'state', enabled: true, forced: false });
    expect(await apply(enable.token)).toMatchObject({ outcome: 'committed' });
    expect((await read(child)).rowSecurity).toBe(false);
    await holder.query(`SET ROLE "${role}"`);
    expect((await holder.query(`SELECT id FROM ${table}`)).rows).toEqual([]);
    expect((await holder.query(`SELECT id FROM ${child}`)).rows).toEqual([{ id: 1 }]);
    await holder.query(`INSERT INTO ${table} VALUES (2, CURRENT_USER)`);
    await expect(holder.query(`INSERT INTO ${table} VALUES (3, '错误租户')`)).rejects.toMatchObject({ code: '42501' });
    await holder.query('RESET ROLE');
    expect((await observer.query(`SELECT id FROM ${table} ORDER BY id`)).rows).toEqual([{ id: 1 }, { id: 2 }]);

    const pendingPreview = await prepare({ kind: 'state', enabled: false, forced: false });
    await holder.query(`BEGIN; LOCK TABLE ONLY ${table} IN ACCESS EXCLUSIVE MODE`);
    const pending = apply(pendingPreview.token);
    void pending.catch(() => undefined);
    try {
      await expect.poll(async () => (await observer.query(`SELECT EXISTS(SELECT FROM pg_catalog.pg_stat_activity
        WHERE wait_event_type = 'Lock' AND query = $1) AS waiting`, ['LOCK TABLE ONLY ' + table + ' IN ACCESS EXCLUSIVE MODE'])).rows[0].waiting,
      { timeout: 3500 }).toBe(true);
      await holder.query(`ALTER POLICY readable ON ${table} RENAME TO other; COMMIT`);
    } finally { await holder.query('ROLLBACK'); }
    expect(await pending).toMatchObject({ outcome: 'notSent', message: expect.stringContaining('策略已变化') });
    expect((await read()).rowSecurity).toBe(true);
    expect((await read()).policies?.[0].name).toBe('other');
    const native = desktop.process();
    await quitDesktop();
    expect(native.exitCode).toBe(0);
  } finally { await Promise.all([observer.end(), holder.end()]); }
});
