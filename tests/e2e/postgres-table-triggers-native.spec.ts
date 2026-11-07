import { Client } from 'pg';
import type { PostgresTriggerChange } from '../../src/shared/postgresTrigger';
import { postgresTableTriggerZh as triggers } from '../../src/renderer/locales/postgresTableTrigger.zh-CN';
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

const connectionName = 'PostgreSQL 表触发器测试';
async function saveConnection(config: ReturnType<typeof isolatedConnection>) {
  return page.evaluate(async ({ host, port, user, database, password, name }) => (await window.dbark.invoke('connections.save', {
    id: '', name, group: '', color: '#123456', dialect: 'postgresql', host, port, user, database, password, rememberPassword: false,
  })).id, { ...config, name: connectionName });
}

test('PostgreSQL 触发器目录与界面创建、切换模式、重命名和受限删除', async ({}, info) => {
  const config = isolatedConnection(), observer = new Client(config), table = '"public"."触发器 ""原表"""';
  const adminPassword = process.env.DBARK_PG_ROLES_ADMIN_PASSWORD ?? '';
  if (!/^[a-f0-9]{64}$/.test(adminPassword)) throw Error('需要隔离库管理夹具');
  const admin = new Client({ ...config, user: 'postgres', password: adminPassword });
  await Promise.all([observer.connect(), admin.connect()]);
  try {
    await observer.query(`CREATE TABLE public.trigger_parent(id int PRIMARY KEY);
      INSERT INTO public.trigger_parent VALUES (1);
      CREATE TABLE ${table}(id int PRIMARY KEY, parent int REFERENCES public.trigger_parent(id), amount int, tag text);
      INSERT INTO ${table} VALUES (1, 1, 1, NULL);
      CREATE FUNCTION public."标记""函数"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN NEW.tag := TG_ARGV[0]; RETURN NEW; END $$`);
    const connectionId = await saveConnection(config);
    await page.evaluate(async ({ connectionId, database, table }) => {
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'pg-trigger-target', tabs: [
        { id: 'pg-trigger-target', title: '触发器测试', kind: 'table', connectionId, database, table },
      ] });
    }, { connectionId, database: config.database, table });
    await page.reload();
    await page.locator('.postgres-table-tab:visible').getByRole('button', { name: structure.open, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: structure.title, exact: true });
    await dialog.getByRole('button', { name: structure.sections.triggers, exact: true }).click();
    await expect(dialog.getByRole('table')).toContainText(triggers.internal);
    const open = () => dialog.getByRole('button', { name: triggers.title, exact: true }).click();
    const panel = dialog.getByRole('region', { name: triggers.title, exact: true });
    const action = panel.getByLabel(triggers.operation, { exact: true });
    const button = (name: string) => panel.getByRole('button', { name, exact: true });
    const sql = panel.getByLabel(triggers.sql, { exact: true });
    const status = () => dialog.getByRole('row').filter({ has: page.getByRole('rowheader', { name: '记录更新', exact: true }) });
    const apply = async () => { await button(triggers.apply).click(); await expect(panel).toHaveCount(0); };
    const originalTriggers = async () => (await observer.query(`SELECT oid::text, tgname AS name, tgenabled AS mode
      FROM pg_catalog.pg_trigger WHERE tgrelid = $1::regclass AND NOT tgisinternal`, [table])).rows;
    await open();
    await expect(action.locator('option[value=drop]')).toHaveJSProperty('disabled', true);
    await panel.getByLabel(triggers.name, { exact: true }).fill('记录更新');
    await panel.getByLabel(triggers.functionName, { exact: true }).fill('标记"函数');
    await panel.getByRole('checkbox', { name: 'INSERT', exact: true }).uncheck();
    await panel.getByRole('checkbox', { name: 'UPDATE', exact: true }).check();
    await panel.getByLabel(triggers.updateOf, { exact: true }).selectOption('amount');
    await panel.getByLabel(triggers.condition, { exact: true }).fill('NEW.amount > 0 -- 只记录正值');
    await button(triggers.addArg).click();
    const marker = "已标记'\\; --";
    await panel.getByLabel(triggers.arg(0), { exact: true }).fill(marker);
    await button(triggers.preview).click();
    await expect(sql).toContainText('BEFORE UPDATE OF "amount"');
    await expect(sql).toContainText('EXECUTE FUNCTION "public"."标记""函数"');
    expect(await originalTriggers()).toEqual([]);
    await panel.screenshot({ path: info.outputPath('PostgreSQL 创建触发器预览.png') });
    await apply();
    await expect(status()).toContainText(triggers.modes.O);
    const [original] = await originalTriggers();
    const update = async (client: Client, assignment: string) => (await client.query(`UPDATE ${table} SET ${assignment} WHERE id = 1 RETURNING tag`)).rows[0].tag;
    expect(await update(observer, 'amount = 0')).toBeNull();
    expect(await update(observer, 'amount = 2')).toBe(marker);
    expect(await update(observer, 'tag = NULL')).toBeNull();

    async function mode(value: 'D' | 'R' | 'A' | 'O') {
      await open();
      await action.selectOption('mode');
      await panel.getByLabel(triggers.mode, { exact: true }).selectOption(value);
      await button(triggers.preview).click();
      await apply();
      await expect(status()).toContainText(triggers.modes[value]);
      expect(await originalTriggers()).toEqual([{ ...original, mode: value }]);
    }
    await mode('D');
    expect(await update(observer, 'amount = 3')).toBeNull();
    await mode('R');
    expect(await update(observer, 'amount = 4')).toBeNull();
    await admin.query("SET session_replication_role = 'replica'");
    expect(await update(admin, 'amount = 5')).toBe(marker);
    await mode('A');
    await update(admin, 'tag = NULL');
    expect(await update(observer, 'amount = 6')).toBe(marker);
    await mode('O');
    await update(admin, 'tag = NULL');
    expect(await update(admin, 'amount = 7')).toBeNull();
    await admin.query('RESET session_replication_role');

    await open();
    await action.selectOption('rename');
    await panel.getByLabel(triggers.name, { exact: true }).fill('新"名');
    await button(triggers.preview).click();
    await apply();
    expect(await originalTriggers()).toEqual([{ ...original, name: '新"名' }]);
    await open();
    await action.selectOption('drop');
    await button(triggers.preview).click();
    await expect(sql).toContainText('DROP TRIGGER "新""名" ON ' + table + ' RESTRICT');
    await expect(button(triggers.apply)).toBeDisabled();
    await panel.getByRole('checkbox', { name: triggers.confirmDrop, exact: true }).check();
    await panel.screenshot({ path: info.outputPath('PostgreSQL 删除触发器预览.png') });
    await apply();
    expect(await originalTriggers()).toEqual([]);
    expect(await update(observer, 'amount = 8')).toBeNull();
    await expect(dialog.getByRole('table')).toContainText(triggers.internal);
    const native = desktop.process();
    await quitDesktop();
    expect(native.exitCode).toBe(0);
  } finally { await Promise.all([admin.end(), observer.end()]); }
});

test('PostgreSQL 触发器锁后识别同名替换并拒绝错误函数', async () => {
  const config = isolatedConnection(), observer = new Client(config), holder = new Client(config);
  await Promise.all([observer.connect(), holder.connect()]);
  try {
    const table = '"public"."trigger_race"', connectionId = await saveConnection(config);
    const target = { connectionId, database: config.database, table };
    await observer.query(`CREATE TABLE ${table}(id int);
      CREATE FUNCTION public.noop_trigger() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NEW; END$$;
      CREATE FUNCTION public.not_a_trigger() RETURNS int LANGUAGE sql AS 'SELECT 1';
      CREATE TRIGGER same_name BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION public.noop_trigger()`);
    const read = () => page.evaluate(input => window.dbark.invoke('postgres.structure.read', input), target);
    const prepare = async (change: PostgresTriggerChange) => page.evaluate(input => window.dbark.invoke('postgres.tableManage.preview', input),
      { ...target, stamp: (await read()).editStamp!, action: 'trigger' as const, change });
    const apply = (token: string) => page.evaluate(input => window.dbark.invoke('postgres.tableManage.apply', input),
      { connectionId, database: config.database, token, confirmed: true as const });
    const invalid: PostgresTriggerChange = { kind: 'create', name: 'invalid', timing: 'BEFORE', events: ['INSERT'], level: 'ROW',
      updateOf: [], functionSchema: 'public', functionName: 'not_a_trigger', args: [] };
    await expect(prepare(invalid)).rejects.toThrow('未找到可执行');
    const badCondition = await prepare({ ...invalid, functionName: 'noop_trigger', condition: 'NEW.nonexistent > 0' });
    expect(await apply(badCondition.token)).toMatchObject({ outcome: 'rolledBack' });
    expect((await read()).triggers?.map(item => item.name)).toEqual(['same_name']);
    const preview = await prepare({ kind: 'mode', from: 'same_name', mode: 'D' });
    const first = (await read()).triggers?.[0].oid;
    expect(first).toBeDefined();
    await holder.query(`BEGIN; LOCK TABLE ONLY ${table} IN ACCESS EXCLUSIVE MODE`);
    const pending = apply(preview.token);
    void pending.catch(() => undefined);
    try {
      await expect.poll(async () => (await observer.query(`SELECT EXISTS(SELECT FROM pg_catalog.pg_stat_activity
        WHERE wait_event_type = 'Lock' AND query = $1) AS waiting`, ['LOCK TABLE ONLY ' + table + ' IN ACCESS EXCLUSIVE MODE'])).rows[0].waiting,
      { timeout: 3500 }).toBe(true);
      await holder.query(`DROP TRIGGER same_name ON ${table}; CREATE TRIGGER same_name BEFORE INSERT ON ${table}
        FOR EACH ROW EXECUTE FUNCTION public.noop_trigger(); COMMIT`);
    } finally { await holder.query('ROLLBACK'); }
    expect(await pending).toMatchObject({ outcome: 'notSent', message: expect.stringContaining('触发器已变化') });
    const current = (await read()).triggers?.[0];
    expect(current).toMatchObject({ name: 'same_name', mode: 'O' });
    expect(current?.oid).not.toBe(first);
    const native = desktop.process();
    await quitDesktop();
    expect(native.exitCode).toBe(0);
  } finally { await Promise.all([holder.end(), observer.end()]); }
});
