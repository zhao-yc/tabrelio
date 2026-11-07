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

test('PostgreSQL 载入并替换触发器定义，保留禁用状态、注释和身份', async ({}, info) => {
  const config = isolatedConnection(), observer = new Client(config), table = '"public"."trigger_replace"';
  await observer.connect();
  try {
    await observer.query(`CREATE TABLE ${table}(id int PRIMARY KEY, amount int, tag text);
      INSERT INTO ${table} VALUES (1, 1, NULL);
      CREATE FUNCTION public.replace_before() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN NEW.tag := TG_ARGV[0]; RETURN NEW; END $$;
      CREATE FUNCTION public.replace_after() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN NEW.tag := '替换:' || TG_ARGV[0]; RETURN NEW; END $$`);
    const args = "旧参数'\\";
    const multiline = '第一行\n第二行';
    await observer.query(`CREATE TRIGGER "WHEN (" BEFORE UPDATE OF amount ON ${table} FOR EACH ROW
      WHEN (NEW.amount > 1 AND (NEW.tag IS NULL OR NEW.tag <> 'EXECUTE FUNCTION )'))
      EXECUTE FUNCTION public.replace_before('旧参数''\\', '', '${multiline}');
      ALTER TABLE ONLY ${table} DISABLE TRIGGER "WHEN (";
      COMMENT ON TRIGGER "WHEN (" ON ${table} IS '保留的注释'`);
    const connectionId = await saveConnection(config);
    const target = { connectionId, database: config.database, table };
    const read = () => page.evaluate(input => window.dbark.invoke('postgres.structure.read', input), target);
    const before = (await read()).triggers?.[0];
    expect(before).toMatchObject({ mode: 'D', comment: '保留的注释', functionName: 'replace_before', argumentCount: 3 });
    await page.evaluate(async ({ connectionId, database, table }) => {
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'pg-trigger-replace', tabs: [
        { id: 'pg-trigger-replace', title: '修改触发器测试', kind: 'table', connectionId, database, table },
      ] });
    }, target);
    await page.reload();
    await page.locator('.postgres-table-tab:visible').getByRole('button', { name: structure.open, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: structure.title, exact: true });
    await dialog.getByRole('button', { name: structure.sections.triggers, exact: true }).click();
    await dialog.getByRole('button', { name: triggers.title, exact: true }).click();
    const panel = dialog.getByRole('region', { name: triggers.title, exact: true });
    await panel.getByLabel(triggers.operation, { exact: true }).selectOption('replace');
    await expect(panel.getByLabel(triggers.existing, { exact: true })).toHaveValue('WHEN (');
    await expect(panel.getByLabel(triggers.arg(0), { exact: true })).toHaveValue(args);
    await expect(panel.getByLabel(triggers.arg(1), { exact: true })).toHaveValue('');
    await expect(panel.getByLabel(triggers.arg(2), { exact: true })).toHaveValue(multiline);
    await expect(panel.getByLabel(triggers.functionName, { exact: true })).toHaveValue('replace_before');
    await expect(panel.getByLabel(triggers.condition, { exact: true })).toHaveValue(/new\.amount.*EXECUTE FUNCTION/is);
    await expect(panel.getByLabel(triggers.updateOf, { exact: true })).toHaveValues(['amount']);
    await panel.getByLabel(triggers.functionName, { exact: true }).fill('replace_after');
    await panel.getByLabel(triggers.condition, { exact: true }).fill('NEW.amount >= 10');
    await panel.screenshot({ path: info.outputPath('PostgreSQL 载入触发器定义.png') });
    await panel.getByRole('button', { name: triggers.preview, exact: true }).click();
    await expect(panel.getByLabel(triggers.sql, { exact: true })).toContainText('CREATE OR REPLACE TRIGGER "WHEN ("');
    await expect(panel.getByLabel(triggers.sql, { exact: true })).toContainText('DISABLE TRIGGER "WHEN ("');
    expect((await read()).triggers?.[0]).toEqual(before);
    await panel.screenshot({ path: info.outputPath('PostgreSQL 替换触发器定义预览.png') });
    await panel.getByRole('button', { name: triggers.apply, exact: true }).click();
    await expect(panel).toHaveCount(0);
    const after = (await read()).triggers?.[0];
    expect(after).toMatchObject({ oid: before?.oid, mode: 'D', comment: before?.comment,
      functionName: 'replace_after', argsHex: before?.argsHex, updatePositions: before?.updatePositions });
    const update = async (amount: number) => (await observer.query(`UPDATE ${table} SET amount = $1 WHERE id = 1 RETURNING tag`, [amount])).rows[0].tag;
    expect(await update(11)).toBeNull();
    await observer.query(`ALTER TABLE ONLY ${table} ENABLE TRIGGER "WHEN ("`);
    expect(await update(5)).toBeNull();
    expect(await update(10)).toBe('替换:' + args);
    const native = desktop.process();
    await quitDesktop();
    expect(native.exitCode).toBe(0);
  } finally { await observer.end(); }
});

test('PostgreSQL 过渡表别名支持创建、替换及无效替换回滚', async () => {
  const config = isolatedConnection(), observer = new Client(config), table = '"public"."trigger_transition"';
  await observer.connect();
  try {
    await observer.query(`CREATE TABLE ${table}(id int PRIMARY KEY, amount int);
      CREATE TABLE public.transition_log(old_amount int, new_amount int);
      CREATE FUNCTION public.transition_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN INSERT INTO public.transition_log SELECT o.amount, n.amount FROM old_rows o JOIN new_rows n USING (id); RETURN NULL; END $$;
      INSERT INTO ${table} VALUES (1, 5)`);
    const connectionId = await saveConnection(config), database = config.database;
    const target = { connectionId, database, table };
    const read = () => page.evaluate(input => window.dbark.invoke('postgres.structure.read', input), target);
    const prepare = async (change: PostgresTriggerChange) => page.evaluate(input => window.dbark.invoke('postgres.tableManage.preview', input),
      { ...target, stamp: (await read()).editStamp!, action: 'trigger' as const, change });
    const apply = (token: string) => page.evaluate(input => window.dbark.invoke('postgres.tableManage.apply', input),
      { connectionId, database, token, confirmed: true as const });
    const create = { kind: 'create', name: 'transition_example', timing: 'AFTER', level: 'STATEMENT', events: ['UPDATE'], args: [],
      functionSchema: 'public', functionName: 'transition_trigger', updateOf: [], oldTable: 'old_rows', newTable: 'new_rows' } satisfies PostgresTriggerChange;
    const preview = await prepare(create);
    expect(preview.statements.join('\n')).toContain('REFERENCING OLD TABLE AS "old_rows" NEW TABLE AS "new_rows"');
    expect(await apply(preview.token)).toMatchObject({ outcome: 'committed' });
    await observer.query(`UPDATE ${table} SET amount = 6`);
    expect((await observer.query('SELECT * FROM public.transition_log')).rows).toEqual([{ old_amount: 5, new_amount: 6 }]);
    const prior = (await read()).triggers?.[0];
    const { kind: _kind, name, ...definition } = create;
    const replace = { ...definition, kind: 'replace', from: name } as const;
    const broken = await prepare({ ...replace, condition: 'NEW.nonexistent > 0' });
    expect(await apply(broken.token)).toMatchObject({ outcome: 'rolledBack' });
    expect((await read()).triggers?.[0]).toEqual(prior);
    const valid = await prepare({ ...replace, args: ['更换'] });
    expect(await apply(valid.token)).toMatchObject({ outcome: 'committed' });
    expect((await read()).triggers?.[0]).toMatchObject({
      oid: prior?.oid, argumentCount: 1, oldTable: 'old_rows', newTable: 'new_rows',
    });
    await observer.query(`UPDATE ${table} SET amount = 7`);
    expect((await observer.query('SELECT * FROM public.transition_log ORDER BY old_amount')).rows)
      .toEqual([{ old_amount: 5, new_amount: 6 }, { old_amount: 6, new_amount: 7 }]);
    const native = desktop.process();
    await quitDesktop();
    expect(native.exitCode).toBe(0);
  } finally { await observer.end(); }
});
