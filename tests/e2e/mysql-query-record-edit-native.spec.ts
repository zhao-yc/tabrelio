import { randomBytes } from 'node:crypto';
import { createConnection } from 'mysql2/promise';
import { test, expect, page, pageErrors } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';
import { mysqlQueryRecordEditZh as text } from '../../src/renderer/locales/mysqlQueryRecordEdit.zh-CN';
import { queryResultSortZh } from '../../src/renderer/locales/queryResultSort.zh-CN';
import { recordViewZh } from '../../src/renderer/locales/recordViews.zh-CN';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.skip(process.env.DBARK_MYSQL_QUERY_RELATION_NATIVE !== '1', '仅使用本轮隔离网络实库');

for (const dialect of ['mysql', 'mariadb'] as const) test(`${dialect} 查询原行按权限预览提交并拒绝并发修改`, async ({}, info) => {
  const port = Number(process.env[dialect === 'mysql' ? 'TABRELIO_REL_MYSQL_PORT' : 'TABRELIO_REL_MARIA_PORT']);
  const password = process.env.TABRELIO_REL_ROOT ?? '', nonce = process.env.TABRELIO_REL_NONCE ?? '';
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^[a-f0-9]{64}$/.test(password) || !/^[a-f0-9]{12}$/.test(nonce) ||
      !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('需要本轮独占回环实库');
  const database = 'edit_' + nonce, table = database + '.subject', host = '127.0.0.1', user = 'edit_writer';
  const writerPassword = randomBytes(32).toString('hex');
  const observer = await createConnection({ host, port, user: 'root', password, supportBigNumbers: true, bigNumberStrings: true, connectTimeout: 2000 });
  try {
    for (const sql of [
      `CREATE DATABASE ${database}`,
      `CREATE TABLE ${table} (tenant VARCHAR(10), id BIGINT, note VARCHAR(30), guard VARCHAR(30), PRIMARY KEY(tenant,id)) ENGINE=InnoDB`,
      `INSERT INTO ${table} VALUES ('A',9007199254740993,'所选记录','隐藏原值'),('A',9007199254740992,'相邻主键','隐藏邻值')`,
      `CREATE USER '${user}'@'%' IDENTIFIED BY '${writerPassword}'`,
      `GRANT SELECT, UPDATE (note) ON ${table} TO '${user}'@'%'`,
    ]) await observer.query(sql);
    const sql = `SELECT s.tenant AS 区, s.id AS 编号, s.note AS 内容 FROM ${table} s ORDER BY s.id DESC;`;
    await page.evaluate(async ({ host, port, user, writerPassword, database, dialect, sql }) => {
      const connection = await window.dbark.invoke('connections.save', { id: '', host, port, user, password: writerPassword, database, dialect,
        name: '查询编辑专项', group: '', color: '#123456', rememberPassword: false });
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'edit-query',
        tabs: [{ id: 'edit-query', kind: 'query', title: '原行编辑查询', connectionId: connection.id, database, sql }] });
    }, { host, port, user, writerPassword, database, dialect, sql });
    await page.reload();
    const query = page.locator('.query-tab:visible'), grid = query.locator('.query-result-grid').getByRole('grid');
    const execute = () => query.locator('.query-execute-split > button.primary').click();
    const sort = grid.getByRole('columnheader').filter({ hasText: /^编号/ });
    const open = async (name: string) => {
      await grid.getByRole('gridcell', { name, exact: true }).click();
      await (await navigationMenuItem(query, { name: text.edit, exact: true })).click();
    };
    const edit = page.getByRole('dialog', { name: text.edit, exact: true });
    const preview = page.getByRole('dialog', { name: text.preview, exact: true });
    const apply = preview.getByRole('button', { name: text.apply, exact: true });
    const field = edit.getByLabel('note · ' + recordViewZh.value, { exact: true });
    const stage = async (note: string) => {
      await field.fill(note);
      await edit.getByRole('button', { name: text.preview, exact: true }).click();
      await expect(preview.locator('pre')).toContainText(`UPDATE \`${database}\`.\`subject\``);
      await expect(preview.locator('pre')).toContainText('9007199254740993');
      await expect(preview.locator('pre')).toContainText(note);
      await expect(apply).toBeDisabled();
    };
    const submit = async () => {
      await preview.getByRole('checkbox', { name: text.confirm, exact: true }).check();
      await apply.click();
    };
    const read = async () => (await observer.query(`SELECT id,note,guard FROM ${table} ORDER BY id`))[0];
    const expected = (note: string, guard: string) => [
      { id: '9007199254740992', note: '相邻主键', guard: '隐藏邻值' },
      { id: '9007199254740993', note, guard },
    ];

    await execute();
    await expect(grid.getByRole('gridcell', { name: '所选记录', exact: true })).toBeVisible();
    await sort.click();
    await expect(sort.getByLabel(queryResultSortZh.ascending)).toBeVisible();
    await expect(grid.getByRole('gridcell').filter({ hasText: /所选记录|相邻主键/ })).toHaveText(['相邻主键', '所选记录']);
    await open('所选记录');
    await expect(field).toHaveValue('所选记录');
    const guard = edit.getByRole('region', { name: 'guard', exact: true });
    await expect(guard).toContainText('隐藏原值');
    await expect(guard).toContainText(text.readOnly);
    await info.attach(`${dialect}查询原记录编辑`, { body: await page.screenshot(), contentType: 'image/png' });
    await stage('已确认更新');
    expect(await read()).toEqual(expected('所选记录', '隐藏原值'));
    await submit();
    await expect(preview).toBeHidden();
    expect(await read()).toEqual(expected('已确认更新', '隐藏原值'));

    await execute();
    await open('已确认更新');
    await stage('不得覆盖并发修改');
    // 变更未投影列，只有整行快照重验才能拒绝已预览的更新。
    await observer.query(`UPDATE ${table} SET guard='外部变更' WHERE tenant='A' AND id=9007199254740993`);
    await submit();
    await expect(preview.getByRole('alert')).toContainText('查询原记录或表结构已变化');
    await expect(apply).toBeDisabled();
    expect(await read()).toEqual(expected('已确认更新', '外部变更'));
    const tasks = await page.evaluate(() => window.dbark.invoke('tasks.list', {}));
    expect(tasks.filter(task => task.kind === 'query.execute')).toHaveLength(2);
    expect(tasks.filter(task => task.kind === 'table.apply')).toHaveLength(2);
    const { items } = await page.evaluate(() => window.dbark.invoke('table.applyReceipt.list', {}));
    expect(items).toHaveLength(2);
    expect(items.find(item => item.outcome === 'committed')).toMatchObject({
      committedReportedRows: 1, intent: { insert: 0, update: 1, delete: 0, statementCount: 1 },
    });
    expect(items.find(item => item.outcome === 'not-sent')).toMatchObject({
      committedReportedRows: 0, evidence: { dmlMayHaveBeenSent: false, commitMayHaveBeenSent: false, rollbackAcknowledged: true },
    });
    expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
});
