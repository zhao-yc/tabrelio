import { randomBytes } from 'node:crypto';
import { createConnection } from 'mysql2/promise';
import { test, expect, page, pageErrors } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';
import { mysqlResultOriginsZh as text } from '../../src/renderer/locales/mysqlResultOrigins.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.skip(process.env.DBARK_MYSQL_QUERY_RELATION_NATIVE !== '1', '仅使用本轮隔离网络实库');

for (const dialect of ['mysql', 'mariadb'] as const) test(`${dialect} 结果列来源按原位置核对跨库对象`, async ({}, info) => {
  const port = Number(process.env[dialect === 'mysql' ? 'TABRELIO_REL_MYSQL_PORT' : 'TABRELIO_REL_MARIA_PORT']);
  const password = process.env.TABRELIO_REL_ROOT ?? '', nonce = process.env.TABRELIO_REL_NONCE ?? '';
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^[a-f0-9]{64}$/.test(password) || !/^[a-f0-9]{12}$/.test(nonce) ||
      !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('需要本轮独占回环实库');
  const database = 'orig_' + nonce, other = database + '_other', host = '127.0.0.1', user = 'orig_reader';
  const readerPassword = randomBytes(32).toString('hex');
  const observer = await createConnection({ host, port, user: 'root', password, connectTimeout: 2000 });
  try {
    for (const sql of [
      `CREATE DATABASE ${database}`, `CREATE DATABASE ${other}`,
      `CREATE TABLE ${database}.source (id INT PRIMARY KEY, tag VARCHAR(40))`,
      `CREATE TABLE ${other}.source (id INT PRIMARY KEY, tag VARCHAR(40), scope_hint VARCHAR(40))`,
      `INSERT INTO ${database}.source VALUES (1,'本库原值')`, `INSERT INTO ${other}.source VALUES (1,'跨库原值','跨库表读回')`,
      `CREATE USER '${user}'@'%' IDENTIFIED BY '${readerPassword}'`,
      `GRANT SELECT, CREATE TEMPORARY TABLES ON ${database}.* TO '${user}'@'%'`,
      `GRANT SELECT ON ${other}.* TO '${user}'@'%'`,
    ]) await observer.query(sql);
    const sql = `SELECT a.id AS 同名, b.id AS 同名, b.tag AS 标签, a.id+1 AS 计算
      FROM ${database}.source a JOIN ${other}.source b ON a.id=b.id; SELECT tag AS 下一集 FROM ${database}.source;`;
    const temporary = `CREATE TEMPORARY TABLE ${database}.source (id INT); SELECT id AS 临时列 FROM ${database}.source;`;
    await page.evaluate(async ({ host, port, user, readerPassword, database, dialect, sql, temporary }) => {
      const connection = await window.dbark.invoke('connections.save', { id: '', host, port, user, password: readerPassword, database, dialect,
        name: '列来源专项', group: '', color: '#123456', rememberPassword: false });
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'orig-query', tabs: [
        { id: 'orig-query', kind: 'query', title: '跨库来源查询', connectionId: connection.id, database, sql },
        { id: 'temp-query', kind: 'query', title: '临时来源查询', connectionId: connection.id, database, sql: temporary },
      ] });
    }, { host, port, user, readerPassword, database, dialect, sql, temporary });
    await page.reload();
    const query = page.locator('.query-tab:visible'), execute = () => query.locator('.query-execute-split > button.primary').click();
    const dialog = page.getByRole('dialog', { name: text.title, exact: true });
    const originRows = dialog.locator('tbody tr'), sets = query.locator('.query-result-tabs button');
    const open = async () => (await navigationMenuItem(query, { name: text.open, exact: true })).click();
    const close = () => dialog.getByRole('button', { name: zh.common.close, exact: true }).click();
    await execute();
    await expect(sets).toHaveCount(2);
    await open();
    await expect(originRows.nth(0).getByRole('cell')).toHaveText(['1', database, 'source', 'id', text.openObject]);
    await expect(originRows.nth(1).getByRole('cell')).toHaveText(['2', other, 'source', 'id', text.openObject]);
    await expect(originRows.nth(0).getByRole('rowheader')).toHaveText('同名');
    await expect(originRows.nth(1).getByRole('rowheader')).toHaveText('同名');
    await expect(originRows.nth(3).getByRole('cell')).toHaveText(['4', '—', '—', '—', '']);
    await info.attach(`${dialect}查询结果列来源`, { body: await page.screenshot(), contentType: 'image/png' });
    await close();
    await sets.nth(1).click();
    await open();
    await expect(originRows.nth(0).getByRole('rowheader')).toHaveText('下一集');
    await expect(originRows.nth(0).getByRole('cell')).toHaveText(['1', database, 'source', 'tag', text.unverified]);
    await close();
    await sets.nth(0).click();
    await open();
    await observer.query(`ALTER TABLE ${other}.source DROP COLUMN tag`);
    await dialog.getByRole('button', { name: text.openLabel('source', 3), exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('来源对象或字段已变化');
    await dialog.getByRole('button', { name: text.openLabel('source', 2), exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(() => page.evaluate(async () => (await window.dbark.invoke('settings.get', {})).tabs
      .filter(tab => tab.kind === 'table').map(tab => ({ database: tab.database, table: tab.table })))).toEqual([{ database: other, table: 'source' }]);
    await expect(page.locator('.table-tab:visible').getByRole('grid')).toContainText('跨库表读回');
    await page.locator('[data-workspace-tab-id="temp-query"]').getByRole('button', { name: '临时来源查询', exact: true }).click();
    await execute();
    await expect(sets).toHaveCount(2);
    await sets.nth(1).click();
    await open();
    await expect(originRows.nth(0).getByRole('rowheader')).toHaveText('临时列');
    await expect(originRows.nth(0).getByRole('cell')).toHaveText(['1', database, 'source', 'id', text.temporary]);
    const tasks = await page.evaluate(() => window.dbark.invoke('tasks.list', {}));
    expect(tasks.filter(task => task.kind === 'query.execute')).toHaveLength(2);
    expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
});
