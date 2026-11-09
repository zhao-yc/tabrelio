import { randomBytes, randomUUID } from 'node:crypto';
import { createConnection, type RowDataPacket } from 'mysql2/promise';
import { test, expect, page, pageErrors } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';
import { pasteGridRangeClipboard } from './grid-cell-range-clipboard';
import { mysqlQueryRecordEditZh as text } from '../../src/renderer/locales/mysqlQueryRecordEdit.zh-CN';
import { mysqlQueryBatchEditZh as batchText } from '../../src/renderer/locales/mysqlQueryBatchEdit.zh-CN';
import { recordViewZh } from '../../src/renderer/locales/recordViews.zh-CN';
import { queryResultSortZh } from '../../src/renderer/locales/queryResultSort.zh-CN';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.skip(process.env.DBARK_MYSQL_QUERY_RELATION_NATIVE !== '1', '仅使用本轮隔离网络实库');
test.describe.configure({ timeout: 90_000 });

for (const dialect of ['mysql', 'mariadb'] as const) test(`${dialect} INNER 和 LEFT JOIN 只编辑唯一的主表原行`, async ({}, info) => {
  const port = Number(process.env[dialect === 'mysql' ? 'TABRELIO_REL_MYSQL_PORT' : 'TABRELIO_REL_MARIA_PORT']);
  const password = process.env.TABRELIO_REL_ROOT ?? '', nonce = process.env.TABRELIO_REL_NONCE ?? '';
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^[a-f0-9]{64}$/.test(password) || !/^[a-f0-9]{12}$/.test(nonce) ||
      !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('需要本轮独占回环实库');
  const database = 'join_' + nonce, other = database + '_aux', host = '127.0.0.1', user = 'query_joiner';
  const userPassword = randomBytes(32).toString('hex');
  const observer = await createConnection({ host, port, user: 'root', password, supportBigNumbers: true, bigNumberStrings: true, connectTimeout: 2000 });
  try {
    for (const sql of [
      `CREATE DATABASE ${database}`, `CREATE DATABASE ${other}`,
      `CREATE TABLE ${database}.subject (tenant VARCHAR(10), id BIGINT, link_id INT, note VARCHAR(30), guard VARCHAR(30),
        PRIMARY KEY(tenant,id)) ENGINE=InnoDB`,
      `CREATE TABLE ${other}.linked (id INT PRIMARY KEY, owner_id INT, note VARCHAR(30)) ENGINE=InnoDB`,
      `INSERT INTO ${database}.subject VALUES ('A',9007199254740992,1,'主表甲','未投影甲'),('A',9007199254740993,2,'主表乙','未投影乙')`,
      `INSERT INTO ${other}.linked VALUES (1,1,'连接甲'),(3,1,'连接丙')`,
      `CREATE USER '${user}'@'%' IDENTIFIED BY '${userPassword}'`,
      `GRANT SELECT, UPDATE (note) ON ${database}.subject TO '${user}'@'%'`,
      `GRANT SELECT, UPDATE (note) ON ${other}.linked TO '${user}'@'%'`,
    ]) await observer.query(sql);
    const select = `SELECT l.note AS 同名, s.tenant AS 区, s.id AS 编号, s.note AS 同名 FROM ${database}.subject s`;
    const leftSql = select + ` LEFT JOIN ${other}.linked l ON (l.id=s.link_id) ORDER BY s.id DESC;`;
    const innerSql = select + ` INNER JOIN ${other}.linked l ON l.id=s.link_id;`;
    const duplicateSql = select + ` JOIN ${other}.linked l ON l.owner_id=s.link_id;`;
    const connectionId = await page.evaluate(async ({ host, port, user, userPassword, database, dialect, leftSql, innerSql, duplicateSql }) => {
      const connection = await window.dbark.invoke('connections.save', { id: '', host, port, user, password: userPassword, database, dialect,
        name: '连接查询专项', group: '', color: '#123456', rememberPassword: false });
      const settings = await window.dbark.invoke('settings.get', {});
      const tabs = [{ id: 'mysql-left', title: '左连接', sql: leftSql }, { id: 'mysql-inner', title: '内连接', sql: innerSql },
        { id: 'mysql-duplicate', title: '主键重复', sql: duplicateSql }]
        .map(tab => ({ ...tab, kind: 'query' as const, connectionId: connection.id, database }));
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'mysql-left', tabs });
      return connection.id;
    }, { host, port, user, userPassword, database, dialect, leftSql, innerSql, duplicateSql });
    await page.reload();
    const query = page.locator('.query-tab:visible'), grid = query.locator('.query-result-grid').getByRole('grid');
    const cell = (name: string) => grid.getByRole('gridcell', { name, exact: true });
    const edit = page.getByRole('dialog', { name: text.editJoin, exact: true });
    const inline = page.getByRole('region', { name: text.inlineLabel('同名'), exact: true });
    const preview = page.getByRole('dialog', { name: text.preview, exact: true });
    const batch = page.getByRole('dialog', { name: batchText.paste, exact: true });
    let completed = 0;
    const execute = async () => {
      await query.locator('.query-execute-split > button.primary').click();
      await expect.poll(() => page.evaluate(async () => (await window.dbark.invoke('tasks.list', {}))
        .filter(task => task.kind === 'query.execute' && task.status === 'completed').length)).toBe(++completed);
    };
    const open = async (value: string) => {
      await cell(value).click();
      const entry = await navigationMenuItem(query, { name: text.editJoin, exact: true });
      try { await expect(entry).toBeVisible(); }
      catch (failure) {
        await info.attach('JOIN 查询编辑诊断', { body: JSON.stringify(await query.getByRole('alert').allTextContents()), contentType: 'application/json' });
        throw failure;
      }
      await entry.click();
    };
    const read = async () => (await observer.query<RowDataPacket[]>(`SELECT id,note,guard FROM ${database}.subject ORDER BY id`))[0];
    const links = async () => (await observer.query<RowDataPacket[]>(`SELECT id,note FROM ${other}.linked ORDER BY id`))[0];

    await execute();
    try { await expect(query.getByText(text.inlineHint, { exact: true })).toBeVisible(); }
    catch (failure) {
      const reader = await createConnection({ host, port, user, password: userPassword, database });
      try {
        const [, fields] = await reader.query(leftSql);
        const original = fields.map(({ table, orgTable, schema, orgName, flags }) => ({ table, orgTable, schema, orgName, flags }));
        const observed = await page.evaluate(async ({ connectionId, database, sql, taskId }) => {
          const { sessionId } = await window.dbark.invoke('sessions.open', { connectionId, database });
          try {
            const output = await window.dbark.invoke('query.execute', { sessionId, sql, taskId, maxRows: 10 });
            return { join: output.mysqlQueryJoinColumns, relation: output.mysqlQueryRelation, origins: output.mysqlResultOrigins };
          } finally { await window.dbark.invoke('sessions.close', { sessionId }); }
        }, { connectionId, database, sql: leftSql, taskId: randomUUID() });
        await info.attach('JOIN 查询编辑诊断', { body: JSON.stringify({ original, observed }), contentType: 'application/json' });
      } finally { await reader.end(); }
      throw failure;
    }
    const initial = await read(), initialLinks = await links();
    const sort = grid.getByRole('columnheader').filter({ hasText: /^编号/ });
    await sort.click();
    await expect(sort.getByLabel(queryResultSortZh.ascending)).toBeVisible();
    await cell('连接甲').click();
    await cell('连接甲').press('F2');
    await expect(inline).toHaveCount(0);
    await pasteGridRangeClipboard(page, '不得改连接表');
    await expect(query.getByRole('alert')).toContainText(text.joinReadOnly);
    await open('主表乙');
    await expect(edit.getByLabel('note · ' + recordViewZh.value, { exact: true })).toHaveValue('主表乙');
    await info.attach(`${dialect}连接查询编辑主表`, { body: await page.screenshot(), contentType: 'image/png' });
    await edit.getByRole('button', { name: text.back, exact: true }).click();
    await cell('主表甲').click();
    await page.keyboard.press('Shift+ArrowDown');
    await pasteGridRangeClipboard(page, '主表甲新值\n主表乙新值');
    await expect(batch.getByRole('table')).toContainText('主表乙新值');
    await batch.getByRole('checkbox', { name: batchText.confirm, exact: true }).check();
    await batch.getByRole('button', { name: batchText.apply, exact: true }).click();
    await expect(batch).toBeHidden();
    const updated = [{ ...initial[0], note: '主表甲新值' }, { ...initial[1], note: '主表乙新值' }];
    expect(await read()).toEqual(updated);
    expect(await links()).toEqual(initialLinks);

    await page.locator('[data-workspace-tab-id="mysql-duplicate"]').getByRole('button', { name: '主键重复', exact: true }).click();
    await execute();
    await expect(cell('主表甲新值')).toHaveCount(2);
    await expect(await navigationMenuItem(query, { name: text.editJoin, exact: true })).toHaveCount(0);

    const direct = await page.evaluate(async ({ connectionId, database, sql, executionId, taskId }) => {
      const { sessionId } = await window.dbark.invoke('sessions.open', { connectionId, database });
      try {
        const outcome = await window.dbark.invoke('query.execute', { sessionId, sql, taskId: executionId, maxRows: 10 });
        let blocked = '';
        try { await window.dbark.invoke('mysql.queryRecordEdit', { connectionId, sessionId, executionId, taskId, rowIndex: 0, columnIndex: 0 }); }
        catch (reason) { blocked = String(reason); }
        return { columns: outcome.mysqlQueryJoinColumns, blocked };
      } finally { await window.dbark.invoke('sessions.close', { sessionId }); }
    }, { connectionId, database, sql: leftSql, executionId: randomUUID(), taskId: randomUUID() });
    expect(direct.columns).toEqual([1, 2, 3]);
    expect(direct.blocked).toContain('没有可编辑的主表来源');
    await page.locator('[data-workspace-tab-id="mysql-inner"]').getByRole('button', { name: '内连接', exact: true }).click();
    await execute();
    await expect(query.getByText(text.inlineHint, { exact: true })).toBeVisible();
    await cell('主表甲新值').click();
    await cell('主表甲新值').press('F2');
    const field = inline.getByLabel('note · ' + recordViewZh.value, { exact: true });
    await field.fill('不得覆盖外部变更');
    await field.press('Enter');
    await expect(preview.locator('pre')).toContainText('9007199254740992');
    await observer.query(`UPDATE ${database}.subject SET guard='外部变更' WHERE id=9007199254740992`);
    await preview.getByRole('checkbox', { name: text.confirm, exact: true }).check();
    await preview.getByRole('button', { name: text.apply, exact: true }).click();
    await expect(preview.getByRole('alert')).toContainText('查询原记录或表结构已变化');
    expect(await read()).toEqual([{ ...updated[0], guard: '外部变更' }, updated[1]]);
    expect(await links()).toEqual(initialLinks);
    expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
});
