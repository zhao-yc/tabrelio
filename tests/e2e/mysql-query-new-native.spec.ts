import { randomBytes } from 'node:crypto';
import { createConnection, type RowDataPacket } from 'mysql2/promise';
import { test, expect, page, pageErrors } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';
import { mysqlQueryBatchEditZh as text } from '../../src/renderer/locales/mysqlQueryBatchEdit.zh-CN';
import { mysqlQueryRecordEditZh } from '../../src/renderer/locales/mysqlQueryRecordEdit.zh-CN';
import { recordViewZh } from '../../src/renderer/locales/recordViews.zh-CN';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.skip(process.env.DBARK_MYSQL_QUERY_RELATION_NATIVE !== '1', '仅使用本轮隔离网络实库');
test.describe.configure({ timeout: 90_000 });

for (const dialect of ['mysql', 'mariadb'] as const) test(`${dialect} 查询空结果、无键和缺少主键投影仍可新增`, async ({}, info) => {
  const port = Number(process.env[dialect === 'mysql' ? 'TABRELIO_REL_MYSQL_PORT' : 'TABRELIO_REL_MARIA_PORT']);
  const password = process.env.TABRELIO_REL_ROOT ?? '', nonce = process.env.TABRELIO_REL_NONCE ?? '';
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^[a-f0-9]{64}$/.test(password) || !/^[a-f0-9]{12}$/.test(nonce) ||
      !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('需要本轮独占回环实库');
  const database = 'new_' + nonce, host = '127.0.0.1', user = 'query_new';
  const userPassword = randomBytes(32).toString('hex');
  const observer = await createConnection({ host, port, user: 'root', password, supportBigNumbers: true, bigNumberStrings: true, connectTimeout: 2000 });
  try {
    for (const sql of [
      `CREATE DATABASE ${database}`,
      `CREATE TABLE ${database}.plain (code VARCHAR(40) NOT NULL, note VARCHAR(40) DEFAULT '默认说明') ENGINE=InnoDB`,
      `CREATE TABLE ${database}.keyed (id BIGINT AUTO_INCREMENT PRIMARY KEY, note VARCHAR(40) DEFAULT '键表默认') ENGINE=InnoDB`,
      `INSERT INTO ${database}.keyed (id,note) VALUES (9007199254740992,'键表原值')`,
      `CREATE TABLE ${database}.nontransactional (note VARCHAR(40)) ENGINE=MyISAM`,
      `CREATE USER '${user}'@'%' IDENTIFIED BY '${userPassword}'`,
      `GRANT SELECT, INSERT (code) ON ${database}.plain TO '${user}'@'%'`,
      `GRANT SELECT, INSERT ON ${database}.keyed TO '${user}'@'%'`,
      `GRANT SELECT, INSERT ON ${database}.nontransactional TO '${user}'@'%'`,
    ]) await observer.query(sql);
    await page.evaluate(async ({ host, port, user, userPassword, database, dialect }) => {
      const connection = await window.dbark.invoke('connections.save', { id: '', host, port, user, password: userPassword, database, dialect,
        name: '查询新增专项', group: '', color: '#123456', rememberPassword: false });
      const settings = await window.dbark.invoke('settings.get', {});
      const tabs = [
        { id: 'new-plain', title: '空结果无键', sql: `SELECT code AS 内容 FROM ${database}.plain;` },
        { id: 'new-keyed', title: '未投影主键', sql: `SELECT note AS 内容 FROM ${database}.keyed ORDER BY id;` },
        { id: 'new-nontransactional', title: '非事务来源', sql: `SELECT note AS 内容 FROM ${database}.nontransactional;` },
      ].map(tab => ({ ...tab, kind: 'query' as const, connectionId: connection.id, database }));
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'new-plain', tabs });
    }, { host, port, user, userPassword, database, dialect });
    await page.reload();
    const query = page.locator('.query-tab:visible'), draft = page.getByRole('dialog', { name: text.new, exact: true });
    const preview = page.getByRole('dialog', { name: text.newPreview, exact: true });
    const apply = preview.getByRole('button', { name: text.newApply, exact: true });
    let completed = 0;
    const execute = async () => {
      await query.locator('.query-execute-split > button.primary').click();
      await expect.poll(() => page.evaluate(async () => (await window.dbark.invoke('tasks.list', {}))
        .filter(task => task.kind === 'query.execute' && task.status === 'completed').length)).toBe(++completed);
    };
    const open = async () => {
      const entry = await navigationMenuItem(query, { name: text.new, exact: true });
      const menu = page.locator('.action-menu-panel');
      await expect(menu.getByRole('menuitem', { name: mysqlQueryRecordEditZh.edit, exact: true })).toHaveCount(0);
      await entry.click();
      await expect(draft).toBeVisible();
    };
    const plain = async () => (await observer.query<RowDataPacket[]>(`SELECT code,note FROM ${database}.plain ORDER BY code`))[0];
    const code = async (value: string) => {
      await expect(draft.getByRole('combobox', { name: text.newField }).locator('option')).toHaveText(['code']);
      await draft.getByRole('combobox', { name: recordViewZh.mode, exact: true }).selectOption('text');
      await draft.getByLabel('code · ' + recordViewZh.value, { exact: true }).fill(value);
    };
    const review = async () => {
      await draft.getByRole('button', { name: text.newPreview, exact: true }).click();
      try { await expect(preview.getByRole('table')).toBeVisible(); }
      catch (failure) {
        await info.attach('查询新增诊断', { body: JSON.stringify(await page.getByRole('alert').allTextContents()), contentType: 'application/json' });
        throw failure;
      }
      await expect(apply).toBeDisabled();
      await preview.getByText(text.sql, { exact: true }).click();
    };
    const submit = async () => {
      await preview.getByRole('checkbox', { name: text.newConfirm, exact: true }).check();
      await apply.click();
    };

    await execute();
    await open();
    await code('无键新增');
    await review();
    await expect(preview.locator('details pre')).toContainText('(`code`) VALUES (?)');
    expect(await plain()).toEqual([]);
    await info.attach(`${dialect}空结果新增记录预览`, { body: await page.screenshot(), contentType: 'image/png' });
    await submit();
    await expect(preview).toBeHidden();
    expect(await plain()).toEqual([{ code: '无键新增', note: '默认说明' }]);

    await execute();
    await open();
    await code('表变化后不得写入');
    await review();
    await observer.query(`ALTER TABLE ${database}.plain ADD COLUMN changed VARCHAR(10)`);
    await submit();
    await expect(preview.getByRole('alert')).toContainText('查询原表结构已变化');
    expect(await plain()).toEqual([{ code: '无键新增', note: '默认说明' }]);
    await preview.getByRole('button', { name: text.cancel, exact: true }).click();

    await page.locator('[data-workspace-tab-id="new-keyed"]').getByRole('button', { name: '未投影主键', exact: true }).click();
    await execute();
    await open();
    await expect(draft.getByRole('combobox', { name: text.newField }).locator('option')).toHaveText(['note']);
    await review();
    await expect(preview.locator('details pre')).toContainText('() VALUES ()');
    await submit();
    await expect(preview).toBeHidden();
    expect((await observer.query(`SELECT id,note FROM ${database}.keyed ORDER BY id`))[0]).toEqual([
      { id: '9007199254740992', note: '键表原值' }, { id: '9007199254740993', note: '键表默认' },
    ]);

    await page.locator('[data-workspace-tab-id="new-nontransactional"]').getByRole('button', { name: '非事务来源', exact: true }).click();
    await execute();
    await open();
    await expect(draft.getByRole('alert')).toContainText('新增记录需要可核验的 InnoDB 来源表');
    const { items } = await page.evaluate(() => window.dbark.invoke('table.applyReceipt.list', {}));
    expect(items.filter(item => item.outcome === 'committed' && item.committedReportedRows === 1)).toHaveLength(2);
    expect(items.find(item => item.outcome === 'not-sent')).toMatchObject({ evidence: { dmlMayHaveBeenSent: false } });
    expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
});
