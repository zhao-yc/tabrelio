import { randomBytes, randomUUID } from 'node:crypto';
import { createConnection, type RowDataPacket } from 'mysql2/promise';
import { test, expect, page, pageErrors } from './desktop-fixture';
import { pasteGridRangeClipboard } from './grid-cell-range-clipboard';
import { mysqlQueryRecordEditZh as text } from '../../src/renderer/locales/mysqlQueryRecordEdit.zh-CN';
import { recordViewZh } from '../../src/renderer/locales/recordViews.zh-CN';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.skip(process.env.DBARK_MYSQL_QUERY_RELATION_NATIVE !== '1', '仅使用本轮隔离网络实库');
test.describe.configure({ timeout: 90_000 });

for (const dialect of ['mysql', 'mariadb'] as const) test(`${dialect} 计算列只读且不影响已核验的原行编辑`, async ({}, info) => {
  const port = Number(process.env[dialect === 'mysql' ? 'TABRELIO_REL_MYSQL_PORT' : 'TABRELIO_REL_MARIA_PORT']);
  const password = process.env.TABRELIO_REL_ROOT ?? '', nonce = process.env.TABRELIO_REL_NONCE ?? '';
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^[a-f0-9]{64}$/.test(password) || !/^[a-f0-9]{12}$/.test(nonce) ||
      !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('需要本轮独占回环实库');
  const database = 'computed_' + nonce, host = '127.0.0.1', user = 'query_computed';
  const userPassword = randomBytes(32).toString('hex');
  const observer = await createConnection({ host, port, user: 'root', password, supportBigNumbers: true, bigNumberStrings: true, connectTimeout: 2000 });
  try {
    for (const sql of [
      `CREATE DATABASE ${database}`,
      `CREATE TABLE ${database}.subject (id BIGINT PRIMARY KEY, note VARCHAR(30), qty BIGINT, guard VARCHAR(30), link_id INT) ENGINE=InnoDB`,
      `CREATE TABLE ${database}.linked (id INT PRIMARY KEY, note VARCHAR(30)) ENGINE=InnoDB`,
      `INSERT INTO ${database}.subject VALUES (9007199254740992,'主表甲',3,'未投影甲',1),(9007199254740993,'主表乙',4,'未投影乙',2)`,
      `INSERT INTO ${database}.linked VALUES (1,'连接甲')`,
      `CREATE USER '${user}'@'%' IDENTIFIED BY '${userPassword}'`,
      `GRANT SELECT, UPDATE (note) ON ${database}.subject TO '${user}'@'%'`,
      `GRANT SELECT ON ${database}.linked TO '${user}'@'%'`,
    ]) await observer.query(sql);
    const singleSql = `SELECT (p.id) AS 计算编号,p.*,CONCAT(p.note,'-计算') AS note,CAST(p.qty AS DECIMAL(20,2)) AS 转换
      FROM ${database}.subject p ORDER BY p.id DESC;`;
    const joinSql = `SELECT CONCAT(p.note,'-连接计算') AS 同名,l.note AS 同名,p.id AS 编号,p.note AS 同名
      FROM ${database}.subject p LEFT JOIN ${database}.linked l ON l.id=p.link_id ORDER BY p.id DESC;`;
    const connectionId = await page.evaluate(async ({ host, port, user, userPassword, database, dialect, singleSql, joinSql }) => {
      const connection = await window.dbark.invoke('connections.save', { id: '', host, port, user, password: userPassword, database, dialect,
        name: '计算列专项', group: '', color: '#123456', rememberPassword: false });
      const settings = await window.dbark.invoke('settings.get', {});
      const tabs = [{ id: 'computed-single', title: '单表计算列', sql: singleSql }, { id: 'computed-join', title: '连接计算列', sql: joinSql }]
        .map(tab => ({ ...tab, kind: 'query' as const, connectionId: connection.id, database }));
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'computed-single', tabs });
      return connection.id;
    }, { host, port, user, userPassword, database, dialect, singleSql, joinSql });
    await page.reload();
    const query = page.locator('.query-tab:visible'), grid = query.locator('.query-result-grid').getByRole('grid');
    const cell = (name: string) => grid.getByRole('gridcell', { name, exact: true });
    const inline = (name: string) => page.getByRole('region', { name: text.inlineLabel(name), exact: true });
    const preview = page.getByRole('dialog', { name: text.preview, exact: true });
    const read = async () => (await observer.query<RowDataPacket[]>(`SELECT id,note,guard FROM ${database}.subject ORDER BY id`))[0];
    const edit = async (value: string, displayName: string, nextValue: string) => {
      await cell(value).click();
      await cell(value).press('F2');
      const field = inline(displayName).getByLabel('note · ' + recordViewZh.value, { exact: true });
      await field.fill(nextValue);
      await field.press('Enter');
      await expect(preview.locator('pre')).toContainText('9007199254740992');
    };
    const apply = async () => {
      await preview.getByRole('checkbox', { name: text.confirm, exact: true }).check();
      await preview.getByRole('button', { name: text.apply, exact: true }).click();
    };

    const original = await read();
    await query.locator('.query-execute-split > button.primary').click();
    await expect(query.getByText(text.inlineHint, { exact: true })).toBeVisible();
    await cell('主表甲-计算').click();
    await cell('主表甲-计算').press('F2');
    await expect(inline('note')).toHaveCount(0);
    await pasteGridRangeClipboard(page, '不得写入计算列');
    await expect(query.getByRole('alert')).toContainText(text.computedReadOnly);
    await edit('主表甲', 'note', '原字段已修改');
    await info.attach(`${dialect}含计算列查询编辑`, { body: await page.screenshot(), contentType: 'image/png' });
    await apply();
    await expect(preview).toBeHidden();
    const updated = [{ ...original[0], note: '原字段已修改' }, original[1]];
    expect(await read()).toEqual(updated);

    const direct = await page.evaluate(async ({ connectionId, database, singleSql, executionId, taskId, noKeyId }) => {
      const { sessionId } = await window.dbark.invoke('sessions.open', { connectionId, database });
      try {
        const outcome = await window.dbark.invoke('query.execute', { sessionId, sql: singleSql, taskId: executionId, maxRows: 10 });
        let blocked = '';
        try { await window.dbark.invoke('mysql.queryRecordEdit', { connectionId, sessionId, executionId, taskId, rowIndex: 0, columnIndex: 0 }); }
        catch (reason) { blocked = String(reason); }
        const noKey = await window.dbark.invoke('query.execute', { sessionId,
          sql: `SELECT (p.id) AS 计算键,p.note FROM ${database}.subject p`, taskId: noKeyId, maxRows: 10 });
        return { columns: outcome.mysqlQueryComputedColumns, blocked, keyRelation: noKey.mysqlQueryRelation };
      } finally { await window.dbark.invoke('sessions.close', { sessionId }); }
    }, { connectionId, database, singleSql, executionId: randomUUID(), taskId: randomUUID(), noKeyId: randomUUID() });
    expect(direct.columns).toEqual([0, 6, 7]);
    expect(direct.blocked).toContain('没有可编辑的主表来源');
    expect(direct.keyRelation).toBeUndefined();

    await page.locator('[data-workspace-tab-id="computed-join"]').getByRole('button', { name: '连接计算列', exact: true }).click();
    const executeJoin = async (value: string) => {
      await query.locator('.query-execute-split > button.primary').click();
      await expect(cell(value + '-连接计算')).toBeVisible();
      await expect(query.getByText(text.inlineHint, { exact: true })).toBeVisible();
    };
    await executeJoin('原字段已修改');
    await edit('原字段已修改', '同名', '连接查询已修改');
    await apply();
    await expect(preview).toBeHidden();
    const joined = [{ ...updated[0], note: '连接查询已修改' }, updated[1]];
    expect(await read()).toEqual(joined);
    await executeJoin('连接查询已修改');
    await edit('连接查询已修改', '同名', '不得覆盖外部变更');
    await observer.query(`UPDATE ${database}.subject SET guard='外部变更' WHERE id=9007199254740992`);
    await apply();
    await expect(preview.getByRole('alert')).toContainText('查询原记录或表结构已变化');
    expect(await read()).toEqual([{ ...joined[0], guard: '外部变更' }, joined[1]]);
    expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
});
