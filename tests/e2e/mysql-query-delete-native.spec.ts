import { randomBytes } from 'node:crypto';
import { createConnection, type RowDataPacket } from 'mysql2/promise';
import { test, expect, page, pageErrors } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';
import { mysqlQueryBatchEditZh as text } from '../../src/renderer/locales/mysqlQueryBatchEdit.zh-CN';
import { queryResultSortZh } from '../../src/renderer/locales/queryResultSort.zh-CN';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.skip(process.env.DBARK_MYSQL_QUERY_RELATION_NATIVE !== '1', '仅使用本轮隔离网络实库');
test.describe.configure({ timeout: 90_000 });

for (const dialect of ['mysql', 'mariadb'] as const) for (const joined of [false, true]) test(`${dialect} 按完整复合主键删除勾选${joined ? ' JOIN 主表' : '查询'}记录`, async ({}, info) => {
  const port = Number(process.env[dialect === 'mysql' ? 'TABRELIO_REL_MYSQL_PORT' : 'TABRELIO_REL_MARIA_PORT']);
  const password = process.env.TABRELIO_REL_ROOT ?? '', nonce = process.env.TABRELIO_REL_NONCE ?? '';
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^[a-f0-9]{64}$/.test(password) || !/^[a-f0-9]{12}$/.test(nonce) ||
      !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('需要本轮独占回环实库');
  const database = (joined ? 'join_delete_' : 'delete_') + nonce, table = database + '.subject',
    host = '127.0.0.1', user = joined ? 'query_join_deleter' : 'query_deleter';
  const linked = database + '.linked', audit = database + '.deleted';
  const userPassword = randomBytes(32).toString('hex');
  const observer = await createConnection({ host, port, user: 'root', password, supportBigNumbers: true, bigNumberStrings: true, connectTimeout: 2000 });
  try {
    for (const sql of [
      `CREATE DATABASE ${database}`,
      `CREATE TABLE ${table} (tenant VARCHAR(10), id BIGINT, note VARCHAR(30), guard VARCHAR(30), PRIMARY KEY(tenant,id)) ENGINE=InnoDB`,
      `CREATE TABLE ${database}.detail (id INT PRIMARY KEY, tenant VARCHAR(10), subject_id BIGINT,
        CONSTRAINT protect_subject FOREIGN KEY (tenant,subject_id) REFERENCES ${table}(tenant,id)) ENGINE=InnoDB`,
      `INSERT INTO ${table} VALUES ('A',9007199254740992,'勾选甲','未投影甲'),('A',9007199254740993,'保留乙','未投影乙'),
        ('A',9007199254740994,'勾选丙','未投影丙'),('A',9007199254740995,'自由丁','未投影丁'),('A',9007199254740996,'约束戊','未投影戊')`,
      `INSERT INTO ${database}.detail VALUES (1,'A',9007199254740996)`,
      `CREATE USER '${user}'@'%' IDENTIFIED BY '${userPassword}'`,
      `GRANT SELECT, DELETE ON ${table} TO '${user}'@'%'`,
    ]) await observer.query(sql);
    const inner = joined && dialect === 'mariadb';
    if (joined) for (const sql of [
      `CREATE TABLE ${linked} (id BIGINT PRIMARY KEY, note VARCHAR(30)) ENGINE=InnoDB`,
      `INSERT INTO ${linked} VALUES (9007199254740992,'连接甲'),(9007199254740994,'连接丙'),(9007199254740996,'连接戊')`,
      `CREATE TABLE ${audit} (id BIGINT PRIMARY KEY) ENGINE=InnoDB`,
      `CREATE TRIGGER ${database}.log_delete AFTER DELETE ON ${table} FOR EACH ROW INSERT INTO ${audit} VALUES (OLD.id)`,
      `GRANT SELECT ON ${linked} TO '${user}'@'%'`,
    ]) await observer.query(sql);
    if (inner) await observer.query(`INSERT INTO ${linked} VALUES (9007199254740993,'连接乙'),(9007199254740995,'连接丁')`);
    const projection = 's.tenant AS 区, s.id AS 编号, s.note AS 内容' + (joined ? ', l.note AS 连接内容' : '');
    const join = joined ? ` ${inner ? 'INNER' : 'LEFT'} JOIN ${linked} l ON l.id=s.id` : '';
    const sql = `SELECT ${projection} FROM ${table} s${join} ORDER BY s.id DESC;`;
    await page.evaluate(async ({ host, port, user, userPassword, database, dialect, sql }) => {
      const connection = await window.dbark.invoke('connections.save', { id: '', host, port, user, password: userPassword, database, dialect,
        name: '查询删除专项', group: '', color: '#123456', rememberPassword: false });
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'query-delete',
        tabs: [{ id: 'query-delete', kind: 'query', title: '删除勾选原行', connectionId: connection.id, database, sql }] });
    }, { host, port, user, userPassword, database, dialect, sql });
    await page.reload();
    const query = page.locator('.query-tab:visible'), grid = query.locator('.query-result-grid').getByRole('grid');
    const preview = page.getByRole('dialog', { name: text.delete, exact: true });
    const action = () => navigationMenuItem(query, { name: joined ? text.deleteCheckedJoin : text.deleteChecked, exact: true });
    const apply = preview.getByRole('button', { name: text.deleteApply, exact: true });
    const cancel = preview.getByRole('button', { name: text.cancel, exact: true });
    const row = (name: string) => grid.getByRole('gridcell', { name, exact: true }).locator('..');
    const sort = grid.getByRole('columnheader').filter({ hasText: /^编号/ });
    let completed = 0;
    const execute = async (visible: string) => {
      await query.locator('.query-execute-split > button.primary').click();
      await expect.poll(() => page.evaluate(async () => (await window.dbark.invoke('tasks.list', {}))
        .filter(task => task.kind === 'query.execute' && task.status === 'completed').length)).toBe(++completed);
      await expect(row(visible)).toBeVisible();
      if (!await sort.getByLabel(queryResultSortZh.ascending).isVisible()) await sort.click();
      await expect(sort.getByLabel(queryResultSortZh.ascending)).toBeVisible();
    };
    const open = async (...names: string[]) => {
      for (const name of names) await row(name).getByRole('checkbox').check();
      await (await action()).click();
    };
    const review = async (positionsAndKeys: string[]) => {
      try { await expect(preview.locator('tbody td')).toHaveText(positionsAndKeys); }
      catch (failure) {
        const alerts = await page.getByRole('alert').allTextContents();
        await info.attach('删除预览诊断', { body: JSON.stringify({ alerts, dialog: await preview.allTextContents() }), contentType: 'application/json' });
        throw failure;
      }
      await expect(apply).toBeDisabled();
      await preview.getByText(text.sql, { exact: true }).click();
      const plan = await preview.locator('details pre').textContent();
      expect(plan?.match(/DELETE FROM /g)).toHaveLength(positionsAndKeys.length / 3);
      if (joined) {
        expect(plan).toContain('DELETE FROM `' + database + '`.`subject`');
        expect(plan).not.toContain('`linked`');
      }
    };
    const submit = async () => {
      await preview.getByRole('checkbox', { name: text.deleteConfirm, exact: true }).check();
      await apply.click();
    };
    const read = async () => (await observer.query<RowDataPacket[]>(`SELECT tenant,id,note,guard FROM ${table} ORDER BY id`))[0];
    const joinedRows = async () => (await observer.query<RowDataPacket[]>(`SELECT id,note FROM ${linked} ORDER BY id`))[0];
    const auditRows = async () => (await observer.query<RowDataPacket[]>(`SELECT id FROM ${audit} ORDER BY id`))[0];

    await execute('勾选甲');
    await expect(await action()).toBeDisabled();
    await page.keyboard.press('Escape');
    const initial = await read();
    const initialLinks = joined ? await joinedRows() : undefined;
    // 按相反顺序勾选，中间相邻的大整数记录必须保留。
    await open('勾选丙', '勾选甲');
    await review(['1', 'A', '9007199254740992', '3', 'A', '9007199254740994']);
    expect(await read()).toEqual(initial);
    await info.attach(`${dialect}勾选删除${joined ? '连接查询主表' : '查询'}记录`, { body: await page.screenshot(), contentType: 'image/png' });
    await cancel.click();
    await expect(preview).toBeHidden();
    expect(await read()).toEqual(initial);
    await open('勾选甲', '勾选丙');
    await review(['1', 'A', '9007199254740992', '3', 'A', '9007199254740994']);
    await submit();
    await expect(preview).toBeHidden();
    const remaining = [initial[1], initial[3], initial[4]];
    expect(await read()).toEqual(remaining);
    const committedAudit = [{ id: '9007199254740992' }, { id: '9007199254740994' }];
    if (joined) expect(await auditRows()).toEqual(committedAudit);

    await execute('自由丁');
    await open('自由丁', '约束戊');
    await review(['2', 'A', '9007199254740995', '3', 'A', '9007199254740996']);
    await submit();
    await expect(preview.getByRole('alert')).toContainText('已确认目标表事务回滚');
    expect(await read()).toEqual(remaining);
    if (joined) expect(await auditRows()).toEqual(committedAudit);
    await cancel.click();

    await open('自由丁', '约束戊');
    await review(['2', 'A', '9007199254740995', '3', 'A', '9007199254740996']);
    await observer.query(`UPDATE ${table} SET guard='外部变更' WHERE id=9007199254740996`);
    await submit();
    await expect(preview.getByRole('alert')).toContainText('查询原记录或表结构已变化');
    expect(await read()).toEqual([remaining[0], remaining[1], { ...remaining[2], guard: '外部变更' }]);
    if (joined) {
      expect(await joinedRows()).toEqual(initialLinks);
      expect(await auditRows()).toEqual(committedAudit);
    }
    await cancel.click();

    await execute('自由丁');
    await open('自由丁');
    await review(['2', 'A', '9007199254740995']);
    await observer.query(`REVOKE DELETE ON ${table} FROM '${user}'@'%'`);
    await submit();
    await expect(preview.getByRole('alert')).toContainText('当前账号没有查询原表的删除权限');
    await cancel.click();
    await open('自由丁');
    await expect(preview.getByRole('alert')).toContainText('当前账号没有查询原表的删除权限');
    await expect(apply).toHaveCount(0);
    expect(await read()).toEqual([remaining[0], remaining[1], { ...remaining[2], guard: '外部变更' }]);
    const { items } = await page.evaluate(() => window.dbark.invoke('table.applyReceipt.list', {}));
    expect(items).toHaveLength(4);
    expect(items.find(item => item.outcome === 'committed')).toMatchObject({ intent: { delete: 2, statementCount: 2 }, committedReportedRows: 2 });
    expect(items.find(item => item.outcome === 'rolled-back')).toMatchObject({ evidence: { dmlAcknowledged: 1, rollbackAcknowledged: true } });
    const notSent = items.filter(item => item.outcome === 'not-sent');
    expect(notSent).toHaveLength(2);
    expect(notSent.every(item => !item.evidence.dmlMayHaveBeenSent && item.evidence.rollbackAcknowledged)).toBe(true);
    expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
});
