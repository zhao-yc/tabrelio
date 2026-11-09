import { randomBytes, randomUUID } from 'node:crypto';
import { createConnection, type RowDataPacket } from 'mysql2/promise';
import { test, expect, page, pageErrors } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';
import { mysqlQueryRowSqlZh as text } from '../../src/renderer/locales/mysqlQueryRowSql.zh-CN';
import { mysqlQueryRecordEditZh } from '../../src/renderer/locales/mysqlQueryRecordEdit.zh-CN';
import { queryResultSortZh } from '../../src/renderer/locales/queryResultSort.zh-CN';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.skip(process.env.DBARK_MYSQL_QUERY_RELATION_NATIVE !== '1', '仅使用本轮隔离网络实库');
test.describe.configure({ timeout: 90_000 });

for (const dialect of ['mysql', 'mariadb'] as const) test(`${dialect} 查询记录 SQL 可精确回放，生成和打开草稿不写入`, async ({}, info) => {
  const port = Number(process.env[dialect === 'mysql' ? 'TABRELIO_REL_MYSQL_PORT' : 'TABRELIO_REL_MARIA_PORT']);
  const password = process.env.TABRELIO_REL_ROOT ?? '', nonce = process.env.TABRELIO_REL_NONCE ?? '';
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^[a-f0-9]{64}$/.test(password) || !/^[a-f0-9]{12}$/.test(nonce) ||
      !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('需要本轮独占回环实库');
  const database = 'rowsql_' + nonce, host = '127.0.0.1', user = 'rowsql_reader';
  const userPassword = randomBytes(32).toString('hex'), target = '`' + database + '`.`data?set`';
  const observer = await createConnection({ host, port, user: 'root', password, supportBigNumbers: true, bigNumberStrings: true, connectTimeout: 2000 });
  try {
    for (const sql of [
      `CREATE DATABASE ${database}`,
      `CREATE TABLE ${target} (tenant VARCHAR(20), id BIGINT UNSIGNED, note VARCHAR(60), payload VARBINARY(8), flags BIT(64),
        auto_text VARCHAR(80) GENERATED ALWAYS AS (CONCAT(note,'生成')) STORED, PRIMARY KEY(tenant,id)) ENGINE=InnoDB`,
      `CREATE TABLE ${database}.linked (id BIGINT UNSIGNED PRIMARY KEY, note VARCHAR(30)) ENGINE=InnoDB`,
      `INSERT INTO ${database}.linked VALUES (9007199254740992,'连接列')`,
      `CREATE USER '${user}'@'%' IDENTIFIED BY '${userPassword}'`,
      `GRANT SELECT ON ${database}.* TO '${user}'@'%'`,
    ]) await observer.query(sql);
    const tenant = "区'\\甲";
    await observer.execute(`INSERT INTO ${target}(tenant,id,note,payload,flags) VALUES
      (?,9007199254740992,?,?,CAST(CAST('18446744073709551615' AS DECIMAL(20,0)) AS UNSIGNED)),
      (?,9007199254740993,?,?,1),(?,9007199254740994,?,?,2)`,
    [tenant, "原'\\;值", Buffer.from([0, 255]), tenant, '第二行', null, tenant, '范围外', Buffer.from([9])]);
    const sql = `SELECT p.id AS 编号,p.tenant AS 区,p.note AS 正文,p.note AS 重复,UPPER(p.note) AS 计算,p.payload,p.flags,p.auto_text,l.note AS 连接
      FROM ${target} p LEFT JOIN ${database}.linked l ON l.id=p.id WHERE p.id<9007199254740994 ORDER BY p.id DESC;`;
    const noKey = `SELECT note, CONCAT(UPPER(note),'计算') AS 计算 FROM ${target} WHERE id=9007199254740993;`;
    await page.evaluate(async ({ host, port, user, userPassword, database, dialect, sql, noKey }) => {
      const connection = await window.dbark.invoke('connections.save', { id: '', host, port, user, password: userPassword, database, dialect,
        name: '查询记录 SQL 专项', group: '', color: '#123456', rememberPassword: false });
      const settings = await window.dbark.invoke('settings.get', {});
      const tabs = [{ id: 'row-sql-join', title: '连接结果', sql }, { id: 'row-sql-nokey', title: '无键投影', sql: noKey }]
        .map(tab => ({ ...tab, kind: 'query' as const, connectionId: connection.id, database }));
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'row-sql-join', tabs });
    }, { host, port, user, userPassword, database, dialect, sql, noKey });
    await page.reload();
    const query = page.locator('.query-tab:visible'), dialog = page.getByRole('dialog', { name: text.title, exact: true });
    const cell = (value: string) => query.getByRole('gridcell', { name: value, exact: true });
    const execute = () => query.locator('.query-execute-split > button.primary').click();
    const open = async () => (await navigationMenuItem(query, { name: text.open, exact: true })).click();
    const kind = dialog.getByLabel(text.kind, { exact: true });
    const pre = dialog.locator('pre');
    const make = async (value: string, prefix: string) => {
      await kind.selectOption(value);
      await dialog.getByRole('button', { name: text.prepare, exact: true }).click();
      await expect(pre).toContainText(prefix);
      return (await pre.textContent())!;
    };
    const read = async () => (await observer.query<RowDataPacket[]>(`SELECT tenant,id,note,HEX(payload) AS payload,
      CAST(CAST(flags AS UNSIGNED) AS CHAR) AS flags,auto_text FROM ${target} ORDER BY id`))[0];
    const original = await read();
    await execute();
    await expect(query.getByText(mysqlQueryRecordEditZh.inlineHint, { exact: true })).toBeVisible();
    const sort = query.getByRole('columnheader').filter({ hasText: /^编号/ });
    await sort.click();
    await expect(sort.getByLabel(queryResultSortZh.ascending)).toBeVisible();
    for (const id of ['9007199254740993', '9007199254740992']) await cell(id).locator('..').getByRole('checkbox').check();
    await open();
    await expect(dialog).toContainText(text.scope(2));
    const select = await make('select', 'SELECT * FROM ' + target);
    const insert = await make('insert', 'INSERT INTO ' + target);
    const update = await make('update', 'UPDATE ' + target);
    const remove = await make('delete', 'DELETE FROM ' + target);
    expect(insert).toContain('(`tenant`, `id`, `note`, `payload`, `flags`)');
    expect(update).toContain("SET `note` = _utf8mb4");
    expect(update).not.toContain('SET `id`');
    expect([insert, update].join('\n')).not.toMatch(/连接|计算|重复|auto_text/);
    expect(await read()).toEqual(original);

    // 只截取本次复制事件，保留系统剪贴板原内容。
    const captured = await page.evaluateHandle(() => {
      const original = Object.getOwnPropertyDescriptor(document, 'execCommand');
      let text = '';
      Object.defineProperty(document, 'execCommand', { configurable: true, value: (command: string) => {
        if (command !== 'copy') return false;
        const clipboardData = new DataTransfer();
        document.dispatchEvent(new ClipboardEvent('copy', { clipboardData, bubbles: true, cancelable: true }));
        text = clipboardData.getData('text/plain');
        return true;
      } });
      return { text: () => text, restore: () => original ? Object.defineProperty(document, 'execCommand', original) : Reflect.deleteProperty(document, 'execCommand') };
    });
    try {
      await dialog.getByRole('button', { name: text.copy, exact: true }).click();
      expect(await captured.evaluate(value => value.text())).toBe(remove);
    } finally { await captured.evaluate(value => value.restore()); await captured.dispose(); }
    await info.attach(`${dialect}查询结果原表SQL`, { body: await page.screenshot(), contentType: 'image/png' });
    await dialog.getByRole('button', { name: text.draft, exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(() => page.evaluate(async () => (await window.dbark.invoke('settings.get', {})).tabs
      .filter(tab => tab.title.endsWith('DELETE 草稿')).map(tab => ({ sql: tab.sql, database: tab.database })))).toEqual([{ sql: remove, database }]);
    expect(await read()).toEqual(original);

    const replay = async (script: string) => {
      for (const statement of script.split('\n')) await observer.query(statement);
    };
    await observer.beginTransaction();
    try {
      await observer.query("SET SESSION sql_mode='NO_BACKSLASH_ESCAPES,ANSI_QUOTES,STRICT_TRANS_TABLES'");
      const selected: string[] = [];
      for (const statement of select.split('\n')) {
        const [rows] = await observer.query<RowDataPacket[]>(statement);
        expect(rows).toHaveLength(1);
        selected.push(rows[0].id);
      }
      expect(selected).toEqual(['9007199254740992', '9007199254740993']);
      await observer.query(`UPDATE ${target} SET note='待恢复' WHERE id<9007199254740994`);
      await replay(update);
      expect(await read()).toEqual(original);
      await replay(remove);
      expect(await read()).toEqual([original[2]]);
      await replay(insert);
      expect(await read()).toEqual(original);
    } finally { await observer.rollback(); }

    await page.locator('[data-workspace-tab-id="row-sql-nokey"]').getByRole('button', { name: '无键投影', exact: true }).click();
    await execute();
    await expect(query.locator('.tab-status').getByText(/ 毫秒$/)).toBeVisible();
    await cell('第二行').click();
    await open();
    await expect(kind.locator('option')).toHaveText([text.insert]);
    const partial = await make('insert', 'INSERT INTO ' + target);
    expect(partial).toContain('(`note`)');
    await dialog.getByRole('button', { name: text.close, exact: true }).click();
    const blocked = await page.evaluate(async ({ database, noKey, executionId, taskId }) => {
      const settings = await window.dbark.invoke('settings.get', {});
      const connectionId = settings.tabs.find(tab => tab.id === 'row-sql-nokey')!.connectionId;
      const { sessionId } = await window.dbark.invoke('sessions.open', { connectionId, database });
      try {
        await window.dbark.invoke('query.execute', { sessionId, sql: noKey, taskId: executionId, maxRows: 10 });
        await window.dbark.invoke('mysql.queryRowSql', { connectionId, sessionId, executionId, taskId, kind: 'select', rowIndices: [0] });
        return '';
      } catch (reason) { return String(reason); }
      finally { await window.dbark.invoke('sessions.close', { sessionId }); }
    }, { database, noKey, executionId: randomUUID(), taskId: randomUUID() });
    expect(blocked).toContain('需要直接返回完整且唯一的原表主键');
    expect(await read()).toEqual(original);
    expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
});
