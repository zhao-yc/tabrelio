import { Client } from 'pg';
import { test, expect, page, pageErrors } from './desktop-fixture';
import { postgresResultOriginsZh as text } from '../../src/renderer/locales/postgresResultOrigins.zh-CN';
import { postgresZh } from '../../src/renderer/locales/postgres.zh-CN';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.skip(process.env.DBARK_POSTGRES_RESULT_ORIGINS_NATIVE !== '1', '需要本轮隔离 PostgreSQL');

test('PostgreSQL 查询列来源按位置解析并打开正确的模式对象', async ({}, info) => {
  const database = process.env.DBARK_POSTGRES_TEST_DATABASE ?? '', user = process.env.DBARK_POSTGRES_TEST_USER;
  const password = process.env.DBARK_POSTGRES_TEST_PASSWORD ?? '', port = Number(process.env.DBARK_POSTGRES_TEST_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pg_[a-f0-9]{12}$/.test(database) || user !== database ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535)
    throw Error('需要本轮独占回环库');
  const observer = new Client({ host: '127.0.0.1', database, user, password, port, connectionTimeoutMillis: 3000 });
  try {
    await observer.connect();
    await observer.query(`CREATE SCHEMA "来源区"; CREATE TABLE "来源区"."原表"(id integer PRIMARY KEY, note text);
      INSERT INTO "来源区"."原表" VALUES (1, '原值'); CREATE TABLE public."原表"(other text)`);
    const connectionId = await page.evaluate(async profile => (await window.dbark.invoke('connections.save', profile)).id, {
      id: '', name: '来源列专项', dialect: 'postgresql' as const, group: '', color: '#123456', host: '127.0.0.1',
      port, user, database, password, rememberPassword: false,
    });
    await page.evaluate(async ({ connectionId, database }) => {
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'pg-origins',
        tabs: [{ id: 'pg-origins', title: '来源查询', kind: 'query', connectionId, database,
          sql: 'SELECT id AS 同名, note AS 同名, id + 1 AS 表达式 FROM "来源区"."原表" WHERE false' }] });
    }, { connectionId, database });
    await page.reload();
    const query = page.locator('.postgres-query:visible');
    await query.getByRole('button', { name: postgresZh.begin, exact: true }).click();
    await expect(query.getByRole('button', { name: postgresZh.rollback, exact: true })).toBeEnabled();
    await query.getByRole('button', { name: postgresZh.execute, exact: true }).click();
    const executions = () => page.evaluate(async () => (await window.dbark.invoke('tasks.list', {}))
      .filter(task => task.kind === 'query.execute'));
    await expect.poll(async () => (await executions()).map(task => task.status)).toEqual(['completed', 'completed']);
    const before = await executions();
    await query.getByRole('button', { name: text.open, exact: true }).click();
    const modal = page.getByRole('dialog', { name: text.title, exact: true });
    const rows = modal.locator('tbody tr');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0).getByRole('cell')).toHaveText(['1', '来源区', '原表', 'id', text.openRelation]);
    await expect(rows.nth(1).getByRole('cell')).toHaveText(['2', '来源区', '原表', 'note', text.openRelation]);
    await expect(rows.nth(2).getByRole('cell')).toHaveText(['3', '—', '—', '—', '']);
    await info.attach('PostgreSQL查询结果列来源', { body: await page.screenshot(), contentType: 'image/png' });
    await modal.getByRole('button', { name: text.openLabel('原表', 2), exact: true }).click();
    await expect(page.getByRole('gridcell', { name: '原值', exact: true })).toBeVisible();
    await page.locator('[data-workspace-tab-id="pg-origins"]').getByRole('button', { name: '来源查询', exact: true }).click();
    const rollback = query.getByRole('button', { name: postgresZh.rollback, exact: true });
    await expect(rollback).toBeEnabled();
    expect(await executions()).toEqual(before);
    await rollback.click();
    await expect(rollback).toBeDisabled();
    expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
});
