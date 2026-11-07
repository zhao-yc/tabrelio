import { Client } from 'pg';
import type { PostgresColumnChange } from '../../src/shared/postgresColumnEdit';
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

const connectionName = 'PostgreSQL 生成列测试';
async function saveConnection(config: ReturnType<typeof isolatedConnection>) {
  return page.evaluate(async ({ host, port, user, database, password, name }) => (await window.dbark.invoke('connections.save', {
    id: '', name, group: '', color: '#123456', dialect: 'postgresql', host, port, user, database, password, rememberPassword: false,
  })).id, { ...config, name: connectionName });
}

test('PostgreSQL 生成列界面建表、新增、改表达式和转普通列', async ({}, info) => {
  const config = isolatedConnection(), observer = new Client(config), table = '"public"."生成列测试表"';
  await observer.connect();
  try {
    await saveConnection(config);
    await page.reload();
    await page.locator('.connection-row').filter({ hasText: connectionName }).locator('.tree-label').click();
    await clickSidebarAction(page.locator('.database-row').filter({ hasText: config.database }), { name: zh.sidebar.text017, exact: true });
    const dialog = page.getByRole('dialog', { name: create.title, exact: true });
    await dialog.getByLabel(create.schema, { exact: true }).selectOption('public');
    await dialog.getByLabel(create.table, { exact: true }).fill('生成列测试表');
    const addField = async (index: number, name: string, type: string) => {
      if (index > 1) await dialog.getByRole('button', { name: create.add, exact: true }).click();
      const field = dialog.getByRole('group', { name: create.field(index), exact: true });
      await field.getByLabel(create.name, { exact: true }).fill(name);
      await field.getByLabel(create.type, { exact: true }).selectOption(type);
      return field;
    };
    const id = await addField(1, 'id', 'integer');
    await id.getByRole('checkbox', { name: create.primary, exact: true }).check();
    await addField(2, '数量', 'integer');
    await addField(3, '单价', 'numeric');
    const total = await addField(4, '金额', 'numeric');
    await total.getByLabel(create.default, { exact: true }).selectOption('literal');
    await total.getByLabel(create.value, { exact: true }).fill('0');
    await total.getByLabel(create.generation, { exact: true }).selectOption('stored');
    await expect(total.getByLabel(create.default, { exact: true })).toHaveCount(0);
    await total.getByLabel(create.generationExpression, { exact: true }).fill('"数量" * "单价" -- 计算金额');
    await dialog.getByRole('button', { name: create.preview, exact: true }).click();
    await expect(dialog.locator('.pg-create-sql')).toContainText(') STORED');
    expect((await observer.query('SELECT to_regclass($1) AS rel', [table])).rows[0].rel).toBeNull();
    await dialog.screenshot({ path: info.outputPath('PostgreSQL 生成列建表预览.png') });
    await dialog.getByRole('button', { name: create.apply, exact: true }).click();
    await expect(dialog).toBeHidden();
    expect((await observer.query(`INSERT INTO ${table}(id,"数量","单价") VALUES (1,3,2.50) RETURNING "金额"::text`)).rows)
      .toEqual([{ 金额: '7.50' }]);

    await page.locator('.postgres-table-tab:visible').getByRole('button', { name: structure.open, exact: true }).click();
    const details = page.getByRole('dialog', { name: structure.title, exact: true });
    const open = () => details.getByRole('button', { name: edit.open, exact: true }).click();
    const panel = details.getByRole('region', { name: edit.title, exact: true });
    const action = panel.getByLabel(edit.operation, { exact: true }), field = panel.getByLabel(edit.from, { exact: true });
    const expression = panel.getByLabel(create.generationExpression, { exact: true });
    const generationAction = panel.getByLabel(edit.generationAction, { exact: true });
    const button = (name: string) => panel.getByRole('button', { name, exact: true });
    const sql = panel.getByLabel(edit.previewTitle, { exact: true });
    const apply = async () => {
      await button(edit.apply).click();
      await expect(panel).toHaveCount(0);
    };
    const data = async () => (await observer.query(`SELECT "金额"::text AS total, "规格" AS label FROM ${table} WHERE id = 1`)).rows;
    await open();
    await panel.getByLabel(edit.name, { exact: true }).fill('规格');
    await panel.getByLabel(edit.type, { exact: true }).selectOption('text');
    await panel.getByLabel(create.generation, { exact: true }).selectOption('virtual');
    await expression.fill("'x' || \"数量\"::text");
    await button(edit.stage).click();
    await action.selectOption('generation');
    await field.selectOption('金额');
    await expect(expression).toHaveValue(/"数量".*"单价"/);
    await expression.fill('"数量" * "单价" + 1');
    await button(edit.stage).click();
    await button(edit.preview).click();
    await expect(sql).toContainText(') VIRTUAL');
    await expect(sql).toContainText('SET EXPRESSION AS');
    await panel.screenshot({ path: info.outputPath('PostgreSQL 生成列编辑预览.png') });
    await apply();
    expect(await data()).toEqual([{ total: '8.50', label: 'x3' }]);
    await expect(observer.query(`UPDATE ${table} SET "规格" = '直接写入'`)).rejects.toMatchObject({ code: '428C9' });

    await open();
    await action.selectOption('generation');
    await field.selectOption('规格');
    await expect(generationAction.getByRole('option', { name: edit.removeGeneration })).toHaveCount(0);
    await expression.fill("'规格' || \"数量\"::text");
    await button(edit.stage).click();
    await button(edit.preview).click();
    await apply();
    expect(await data()).toEqual([{ total: '8.50', label: '规格3' }]);
    await open();
    await action.selectOption('generation');
    await field.selectOption('金额');
    await generationAction.selectOption('remove');
    await button(edit.stage).click();
    await button(edit.preview).click();
    await expect(sql).toContainText('DROP EXPRESSION');
    await apply();
    await observer.query(`UPDATE ${table} SET "数量" = 4 WHERE id = 1`);
    expect(await data()).toEqual([{ total: '8.50', label: '规格4' }]);
    await observer.query(`UPDATE ${table} SET "金额" = 20 WHERE id = 1`);
    expect(await data()).toEqual([{ total: '20', label: '规格4' }]);
    const native = desktop.process();
    await quitDesktop();
    expect(native.exitCode).toBe(0);
  } finally { await observer.end(); }
});

test('PostgreSQL 生成列表达式语法预览不写库，非法语义使整批回滚', async () => {
  const config = isolatedConnection(), observer = new Client(config);
  await observer.connect();
  try {
    const table = '"public"."generation_rollback"', connectionId = await saveConnection(config);
    const target = { connectionId, database: config.database, table };
    await observer.query(`CREATE TABLE ${table}(base double precision, derived double precision GENERATED ALWAYS AS (base * 2) STORED);
      INSERT INTO ${table}(base) VALUES (3)`);
    const read = () => page.evaluate(input => window.dbark.invoke('postgres.structure.read', input), target);
    const prepare = async (changes: PostgresColumnChange[]) => page.evaluate(input => window.dbark.invoke('postgres.columnEdit.preview', input), {
      ...target, editStamp: (await read()).editStamp!, changes,
    });
    const apply = (token: string) => page.evaluate(input => window.dbark.invoke('postgres.columnEdit.apply', input), { ...target, token });
    await expect(prepare([{ kind: 'generation', from: 'derived', expression: 'base *' }])).rejects.toThrow();
    const preview = await prepare([{ kind: 'rename', from: 'base', name: 'renamed' },
      { kind: 'generation', from: 'derived', expression: 'renamed + pg_catalog.random()' }]);
    expect((await read()).columns.map(column => column.name)).toEqual(['base', 'derived']);
    expect(await apply(preview.token)).toMatchObject({ outcome: 'rolledBack' });
    expect((await observer.query(`SELECT * FROM ${table}`)).rows).toEqual([{ base: 3, derived: 6 }]);
    const native = desktop.process();
    await quitDesktop();
    expect(native.exitCode).toBe(0);
  } finally { await observer.end(); }
});
