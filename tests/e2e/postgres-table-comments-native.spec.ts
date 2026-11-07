import { Client } from 'pg';
import { postgresDdlLiteral } from '../../src/shared/postgresCreateTable';
import { postgresStructureZh as structure } from '../../src/renderer/locales/postgresStructure.zh-CN';
import { postgresTableCommentsZh as comments } from '../../src/renderer/locales/postgresTableComments.zh-CN';
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
    id: '', name: 'PostgreSQL 注释测试 ' + user, group: '', color: '#123456', dialect: 'postgresql',
    host, port, user, database, password, rememberPassword: false,
  })).id, config);
}

test('PostgreSQL 表和字段注释加载原文并整批保存多行文字', async ({}, info) => {
  const config = isolatedConnection(), observer = new Client(config);
  const target = '"public"."注释 ""表"""', field = '"注释 ""列"""';
  const tableText = "说明第一行\n反斜杠\\与单引号'，保留 emoji 🐘";
  const columnText = "字段内容'; DROP TABLE public.ignored; --\n只作文字";
  await observer.connect();
  try {
    await observer.query(`CREATE TABLE ${target}(id integer PRIMARY KEY,${field} text, removed text, kept text);
      COMMENT ON TABLE ${target} IS '表原注释';
      COMMENT ON COLUMN ${target}.${field} IS '字段原注释';
      COMMENT ON COLUMN ${target}.removed IS '待移除注释';
      COMMENT ON COLUMN ${target}.kept IS '另一个字段保留';
      INSERT INTO ${target} VALUES (1,'原始记录','保留值','保留值')`);
    const facts = async () => (await observer.query(`SELECT c.oid::text AS oid,pg_catalog.obj_description(c.oid,'pg_class') AS table_comment,
      pg_catalog.col_description(c.oid,2) AS note,pg_catalog.col_description(c.oid,3) AS removed,
      pg_catalog.col_description(c.oid,4) AS kept FROM pg_catalog.pg_class c WHERE c.oid=$1::regclass`, [target])).rows[0];
    const original = await facts();
    const connectionId = await saveConnection(config);
    await page.evaluate(async ({ connectionId, database, table }) => {
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'pg-comment-target', tabs: [
        { id: 'pg-comment-target', title: '原表记录', kind: 'table', connectionId, database, table },
      ] });
    }, { connectionId, database: config.database, table: target });
    await page.reload();
    const tab = page.locator('.postgres-table-tab:visible'), dialog = page.getByRole('dialog', { name: structure.title, exact: true });
    await expect(tab.getByRole('grid')).toContainText('原始记录');
    await tab.getByRole('button', { name: structure.open, exact: true }).click();
    await dialog.getByRole('button', { name: comments.title, exact: true }).click();
    const panel = dialog.getByRole('region', { name: comments.title, exact: true });
    const picker = panel.getByRole('combobox', { name: comments.target, exact: true });
    const textarea = panel.getByRole('textbox', { name: comments.value, exact: true });
    const button = (name: string) => panel.getByRole('button', { name, exact: true });
    await expect(textarea).toHaveValue('表原注释');
    await expect(button(comments.preview)).toBeDisabled();
    await textarea.fill(tableText);
    await picker.selectOption({ label: comments.column('注释 "列"') });
    await expect(textarea).toHaveValue('字段原注释');
    await textarea.fill(columnText);
    await picker.selectOption({ label: comments.column('kept') });
    await textarea.fill('取消这项改动');
    await button(comments.restore).click();
    await expect(textarea).toHaveValue('另一个字段保留');
    await picker.selectOption({ label: comments.column('removed') });
    await expect(textarea).toHaveValue('待移除注释');
    await textarea.fill('');
    await picker.selectOption('0');
    await expect(textarea).toHaveValue(tableText);
    await expect(panel.getByRole('status')).toHaveText(comments.changed(3));
    await button(comments.preview).click();
    const sql = panel.getByLabel(comments.sql, { exact: true });
    await expect(sql).toHaveText([
      'LOCK TABLE ONLY ' + target + ' IN SHARE UPDATE EXCLUSIVE MODE',
      'COMMENT ON TABLE ' + target + ' IS ' + postgresDdlLiteral(tableText),
      'COMMENT ON COLUMN ' + target + '.' + field + ' IS ' + postgresDdlLiteral(columnText),
      'COMMENT ON COLUMN ' + target + '."removed" IS NULL',
    ].join(';\n') + ';');
    expect(await facts()).toEqual(original);
    await panel.screenshot({ path: info.outputPath('PostgreSQL 表与字段注释预览.png') });
    await button(comments.apply).click();
    await expect(panel).toHaveCount(0);
    await expect(dialog.getByText(tableText)).toBeVisible();
    expect(await facts()).toEqual({ oid: original.oid, table_comment: tableText, note: columnText, removed: null, kept: '另一个字段保留' });
    expect((await observer.query('SELECT id,' + field + ' AS value FROM ' + target)).rows).toEqual([{ id: 1, value: '原始记录' }]);
    await dialog.getByRole('button', { name: structure.close, exact: true }).click();
    await expect(page.locator('[data-workspace-tab-id="pg-comment-target"]')).toBeVisible();
    const native = desktop.process();
    await quitDesktop();
    expect(native.exitCode).toBe(0);
  } finally { await observer.end(); }
});

test('PostgreSQL 注释锁后保护并发原文，失败整批回滚并保留分区注释', async () => {
  const config = isolatedConnection(), holder = new Client(config), observer = new Client(config);
  const adminPassword = process.env.DBARK_PG_ROLES_ADMIN_PASSWORD ?? '';
  if (!/^[a-f0-9]{64}$/.test(adminPassword)) throw Error('需要隔离库管理夹具');
  const admin = new Client({ ...config, user: 'postgres', password: adminPassword });
  await Promise.all([holder.connect(), observer.connect(), admin.connect()]);
  try {
    await holder.query(`CREATE TABLE public.comment_race(note text);
      COMMENT ON TABLE public.comment_race IS '表原文';
      COMMENT ON COLUMN public.comment_race.note IS '字段原文';
      GRANT SELECT ON public.comment_race TO ${config.user}_limited;
      CREATE TABLE public.comment_root(id int) PARTITION BY RANGE(id);
      CREATE TABLE public.comment_leaf PARTITION OF public.comment_root FOR VALUES FROM (0) TO (10);
      COMMENT ON TABLE public.comment_leaf IS '子表注释';
      COMMENT ON COLUMN public.comment_leaf.id IS '子表字段注释'`);
    const connectionId = await saveConnection(config), database = config.database;
    const limited = await saveConnection({ ...config, user: config.user + '_limited' });
    const target = '"public"."comment_race"';
    const read = (table: string, id = connectionId) => page.evaluate(input => window.dbark.invoke('postgres.structure.read', input),
      { connectionId: id, database, table });
    const prepare = async (table: string, name: string, value: string) => {
      const stamp = (await read(table)).commentStamp;
      if (!stamp) throw Error('缺少原表注释摘要');
      return page.evaluate(input => window.dbark.invoke('postgres.tableManage.preview', input), {
        connectionId, database, table, stamp, action: 'comment' as const, value, columns: [{ position: 1, name, value: '拟保存字段注释' }],
      });
    };
    const apply = (token: string) => page.evaluate(input => window.dbark.invoke('postgres.tableManage.apply', input),
      { connectionId, database, token, confirmed: true as const });
    expect((await read(target, limited)).commentStamp).toBeUndefined();
    const race = await prepare(target, 'note', '拟保存表注释');
    await holder.query("BEGIN; COMMENT ON COLUMN public.comment_race.note IS '另一个会话提交的注释'");
    const applying = apply(race.token);
    void applying.catch(() => undefined);
    try {
      await expect.poll(async () => (await observer.query(`SELECT EXISTS(SELECT FROM pg_catalog.pg_stat_activity
        WHERE wait_event_type='Lock' AND query LIKE $1) AS waiting`, ['LOCK TABLE ONLY "public"."comment_race"%'])).rows[0].waiting,
      { timeout: 3500 }).toBe(true);
      await holder.query('COMMIT');
    } finally { await holder.query('ROLLBACK'); }
    expect(await applying).toMatchObject({ outcome: 'notSent', message: expect.stringContaining('注释已变化') });
    expect((await read(target)).columns[0].comment).toBe('另一个会话提交的注释');

    await admin.query(`CREATE FUNCTION public.reject_column_comment() RETURNS event_trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF current_query() LIKE 'COMMENT ON COLUMN "public"."comment_race".%' THEN
          RAISE EXCEPTION '验收夹具拒绝第二条注释';
        END IF;
      END; $$;
      CREATE EVENT TRIGGER reject_column_comment ON ddl_command_start WHEN TAG IN ('COMMENT')
      EXECUTE FUNCTION public.reject_column_comment()`);
    const rollback = await prepare(target, 'note', '第一条应该回滚');
    expect(await apply(rollback.token)).toMatchObject({ outcome: 'rolledBack', message: expect.stringContaining('拒绝第二条注释') });
    expect(await read(target)).toMatchObject({ comment: '表原文', columns: [{ comment: '另一个会话提交的注释' }] });
    const root = '"public"."comment_root"';
    expect(await apply((await prepare(root, 'id', '分区父表注释')).token)).toMatchObject({ outcome: 'committed' });
    expect(await read(root)).toMatchObject({ comment: '分区父表注释', columns: [{ comment: '拟保存字段注释' }] });
    expect(await read('"public"."comment_leaf"')).toMatchObject({ comment: '子表注释', columns: [{ comment: '子表字段注释' }] });
    const native = desktop.process();
    await quitDesktop();
    expect(native.exitCode).toBe(0);
  } finally { await Promise.all([holder.end(), observer.end(), admin.end()]); }
});
