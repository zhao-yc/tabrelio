import { randomBytes } from 'node:crypto';
import { createConnection, type RowDataPacket } from 'mysql2/promise';
import { clickNativeFind, test, expect, page, pageErrors } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';
import { mysqlQueryBatchEditZh as text } from '../../src/renderer/locales/mysqlQueryBatchEdit.zh-CN';
import { mysqlQueryRecordEditZh as editText } from '../../src/renderer/locales/mysqlQueryRecordEdit.zh-CN';
import { postgresTableFindZh as find } from '../../src/renderer/locales/postgresTableFind.zh-CN';
import { postgresTableZh as tableText } from '../../src/renderer/locales/postgresTable.zh-CN';
import { queryResultSortZh } from '../../src/renderer/locales/queryResultSort.zh-CN';
import { queryResultFindZh as resultFind } from '../../src/renderer/locales/queryResultFind.zh-CN';
import { tableFindFilterZh } from '../../src/renderer/locales/tableFindFilter.zh-CN';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.skip(process.env.DBARK_MYSQL_QUERY_RELATION_NATIVE !== '1', '仅使用本轮隔离网络实库');
test.describe.configure({ timeout: 90_000 });

for (const dialect of ['mysql', 'mariadb'] as const) test(`${dialect} 查询文本替换按原字段去重并保护原行`, async ({}, info) => {
  const port = Number(process.env[dialect === 'mysql' ? 'TABRELIO_REL_MYSQL_PORT' : 'TABRELIO_REL_MARIA_PORT']);
  const password = process.env.TABRELIO_REL_ROOT ?? '', nonce = process.env.TABRELIO_REL_NONCE ?? '';
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^[a-f0-9]{64}$/.test(password) || !/^[a-f0-9]{12}$/.test(nonce) ||
      !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('需要本轮独占回环实库');
  const host = '127.0.0.1', database = 'replace_' + nonce, user = 'query_replacer';
  const userPassword = randomBytes(32).toString('hex');
  const observer = await createConnection({ host, port, user: 'root', password, supportBigNumbers: true, bigNumberStrings: true, connectTimeout: 2000 });
  try {
    for (const sql of [
      `CREATE DATABASE ${database}`,
      `CREATE TABLE ${database}.subject (id BIGINT PRIMARY KEY, note TEXT, tag VARCHAR(30), denied VARCHAR(30), guard VARCHAR(30), link_id INT,
        auto_text VARCHAR(80) GENERATED ALWAYS AS (CONCAT(note,'生成')) STORED) ENGINE=InnoDB`,
      `CREATE TABLE ${database}.linked (id INT PRIMARY KEY, note VARCHAR(30)) ENGINE=InnoDB`,
      `INSERT INTO ${database}.subject (id,note,tag,denied,guard,link_id) VALUES
        (9007199254740992,'旧甲-旧甲','旧甲','旧甲','原状态',1),(9007199254740993,'旧乙','保留','旧乙','原状态',2),
        (9007199254740994,'旧乙','旧乙','旧乙','范围外',1)`,
      `INSERT INTO ${database}.linked VALUES (1,'旧甲')`,
      `CREATE USER '${user}'@'%' IDENTIFIED BY '${userPassword}'`,
      `GRANT SELECT, UPDATE (note, tag) ON ${database}.subject TO '${user}'@'%'`,
      `GRANT SELECT, UPDATE (note) ON ${database}.linked TO '${user}'@'%'`,
    ]) await observer.query(sql);
    const projection = 'p.id AS 编号,p.note AS 正文,CONCAT(p.note,\'计算\') AS 计算,p.note AS 重复,p.tag,p.denied,p.auto_text';
    const condition = 'WHERE p.id < 9007199254740994 ORDER BY p.id DESC;';
    const single = `SELECT ${projection} FROM ${database}.subject p ${condition}`;
    const join = `SELECT ${projection},l.note AS 连接字段 FROM ${database}.subject p LEFT JOIN ${database}.linked l ON l.id=p.link_id ${condition}`;
    await page.evaluate(async ({ host, port, user, userPassword, database, dialect, single, join }) => {
      const connection = await window.dbark.invoke('connections.save', { id: '', host, port, user, password: userPassword, database, dialect,
        name: '查询文本替换专项', group: '', color: '#123456', rememberPassword: false });
      const settings = await window.dbark.invoke('settings.get', {});
      const tabs = [{ id: 'replace-single', title: '单表替换', sql: single }, { id: 'replace-join', title: '连接替换', sql: join }]
        .map(tab => ({ ...tab, kind: 'query' as const, connectionId: connection.id, database }));
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'replace-single', tabs });
    }, { host, port, user, userPassword, database, dialect, single, join });
    await page.reload();
    const query = page.locator('.query-tab:visible'), panel = query.getByRole('region', { name: find.title, exact: true });
    const review = panel.getByRole('region', { name: find.review, exact: true });
    const preview = page.getByRole('dialog', { name: text.replace, exact: true });
    const confirm = preview.getByRole('checkbox', { name: text.confirm, exact: true });
    const apply = preview.getByRole('button', { name: text.apply, exact: true });
    const execute = async () => {
      await query.locator('.query-execute-split > button.primary').click();
      await expect(query.getByText(editText.inlineHint, { exact: true })).toBeVisible();
    };
    const open = async (pattern: string, shortcut = false) => {
      if (shortcut) {
        await query.getByRole('gridcell', { name: '9007199254740993', exact: true }).click();
        await page.keyboard.press(process.platform === 'darwin' ? 'Alt+Meta+f' : 'Control+h');
      } else await (await navigationMenuItem(query, { name: text.replaceOpen, exact: true })).click();
      await expect(panel).toBeVisible();
      await panel.getByRole('checkbox', { name: find.regex, exact: true }).check();
      await panel.getByRole('checkbox', { name: find.captures, exact: true }).check();
      await panel.getByLabel(find.query, { exact: true }).fill(pattern);
      await panel.getByLabel(find.replacement, { exact: true }).fill('$2新');
    };
    const stage = () => review.getByRole('button', { name: tableText.stage, exact: true }).click();
    const read = async () => (await observer.query<RowDataPacket[]>(`SELECT id,note,tag,denied,guard,auto_text FROM ${database}.subject ORDER BY id`))[0];
    const linked = async () => (await observer.query<RowDataPacket[]>(`SELECT note FROM ${database}.linked`))[0];
    const original = await read();
    await execute();
    await query.getByRole('gridcell', { name: '9007199254740993', exact: true }).click();
    await clickNativeFind();
    const search = query.getByRole('textbox', { name: resultFind.input, exact: true });
    await expect(search).toBeFocused();
    await query.getByRole('combobox', { name: resultFind.columns, exact: true }).selectOption({ label: resultFind.columnOption('正文', 2) });
    await search.fill('旧乙');
    await expect(query.locator('.query-result-find-status').getByRole('status')).toHaveText(resultFind.count(1, -1));
    await query.getByRole('button', { name: resultFind.close, exact: true }).click();
    await open('(旧)([甲乙])', true);
    await panel.getByLabel(find.column, { exact: true }).selectOption({ label: '正文' });
    await panel.getByRole('button', { name: find.one, exact: true }).click();
    await expect(review).toContainText(find.reviewCount(1, 1));
    await expect(review).toContainText('乙新');
    await stage();
    await expect(preview.locator('tbody')).toContainText('乙新');
    await expect(apply).toBeDisabled();
    await preview.getByRole('button', { name: text.cancel, exact: true }).click();
    expect(await read()).toEqual(original);

    await page.locator('[data-workspace-tab-id="replace-join"]').getByRole('button', { name: '连接替换', exact: true }).click();
    await execute();
    const sort = query.getByRole('columnheader').filter({ hasText: /^编号/ });
    await sort.click();
    await expect(sort.getByLabel(queryResultSortZh.ascending)).toBeVisible();
    await open('(旧)([甲乙])');
    const column = panel.getByLabel(find.column, { exact: true });
    await column.selectOption({ label: '连接字段' });
    await expect(panel.getByRole('status')).toContainText('共 1 处');
    await expect(panel.getByRole('button', { name: find.all, exact: true })).toBeDisabled();
    await column.selectOption('');
    await panel.getByLabel(tableFindFilterZh.edge, { exact: true }).selectOption('end');
    const selectedOnly = panel.getByRole('checkbox', { name: find.checkedOnly, exact: true });
    const checkedRow = query.getByRole('gridcell', { name: '9007199254740993', exact: true }).locator('..').getByRole('checkbox');
    await checkedRow.check();
    await selectedOnly.check();
    await panel.getByRole('button', { name: find.all, exact: true }).click();
    await expect(review).toContainText(find.reviewCount(1, 1));
    await expect(review).toContainText('乙新');
    await expect(review).not.toContainText('甲新');
    await checkedRow.uncheck();
    await expect(review).toBeHidden();
    await expect(panel.getByRole('status')).toHaveText(find.checkedEmpty);
    await selectedOnly.uncheck();
    await panel.getByRole('button', { name: find.all, exact: true }).click();
    await expect(review).toContainText(find.reviewCount(3, 2));
    await expect(review).toContainText('旧甲-甲新');
    await stage();
    await expect(preview.locator('tbody tr td:nth-child(2)')).toHaveText(['note', 'tag', 'note']);
    expect(await read()).toEqual(original);
    await info.attach(`${dialect}查询结果文本替换`, { body: await page.screenshot(), contentType: 'image/png' });
    await confirm.check();
    await apply.click();
    await expect(preview).toBeHidden();
    const updated = [{ ...original[0], note: '旧甲-甲新', tag: '甲新', auto_text: '旧甲-甲新生成' },
      { ...original[1], note: '乙新', auto_text: '乙新生成' }, original[2]];
    expect(await read()).toEqual(updated);
    expect(await linked()).toEqual([{ note: '旧甲' }]);

    await execute();
    await open('新');
    await panel.getByRole('checkbox', { name: find.regex, exact: true }).uncheck();
    await panel.getByLabel(tableFindFilterZh.edge, { exact: true }).selectOption('end');
    await panel.getByLabel(find.replacement, { exact: true }).fill('改');
    await panel.getByRole('button', { name: find.all, exact: true }).click();
    await stage();
    await expect(preview.locator('tbody')).toContainText('乙改');
    await observer.query(`UPDATE ${database}.subject SET guard='外部变更' WHERE id=9007199254740993`);
    await confirm.check();
    await apply.click();
    await expect(preview.getByRole('alert')).toContainText('查询原记录或表结构已变化');
    expect(await read()).toEqual([updated[0], { ...updated[1], guard: '外部变更' }, updated[2]]);
    expect(await linked()).toEqual([{ note: '旧甲' }]);
    expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
});
