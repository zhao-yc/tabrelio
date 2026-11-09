import { randomBytes } from 'node:crypto';
import { createConnection } from 'mysql2/promise';
import { test, expect, page, pageErrors } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';
import { mysqlQueryRelationZh as text } from '../../src/renderer/locales/mysqlQueryRelation.zh-CN';
import { referenceZh } from '../../src/renderer/locales/references.zh-CN';
import { childReferencesZh } from '../../src/renderer/locales/childReferences.zh-CN';
import { queryResultSortZh } from '../../src/renderer/locales/queryResultSort.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.skip(process.env.DBARK_MYSQL_QUERY_RELATION_NATIVE !== '1', '仅使用本轮隔离网络实库');

for (const dialect of ['mysql', 'mariadb'] as const) test(`${dialect} 查询结果复合外键关联与只读回查`, async ({}, info) => {
  const port = Number(process.env[dialect === 'mysql' ? 'TABRELIO_REL_MYSQL_PORT' : 'TABRELIO_REL_MARIA_PORT']);
  const password = process.env.TABRELIO_REL_ROOT ?? '', nonce = process.env.TABRELIO_REL_NONCE ?? '';
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^[a-f0-9]{64}$/.test(password) || !/^[a-f0-9]{12}$/.test(nonce) ||
      !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('需要本轮独占回环实库');
  const database = 'rel_' + nonce, target = database + '_parent', host = '127.0.0.1', user = 'rel_reader';
  const readerPassword = randomBytes(32).toString('hex');
  const observer = await createConnection({ host, port, user: 'root', password, connectTimeout: 2000 });
  try {
    for (const sql of [
      `CREATE DATABASE ${database}`, `CREATE DATABASE ${target}`,
      `CREATE TABLE ${target}.parent (tenant VARCHAR(10), id BIGINT, note VARCHAR(30), PRIMARY KEY(tenant,id)) ENGINE=InnoDB`,
      `CREATE TABLE ${database}.subject (tenant VARCHAR(10), id BIGINT, parent_id BIGINT, note VARCHAR(30), PRIMARY KEY(tenant,id),
        CONSTRAINT subject_parent FOREIGN KEY(tenant,parent_id) REFERENCES ${target}.parent(tenant,id)) ENGINE=InnoDB`,
      `CREATE TABLE ${database}.detail (id INT PRIMARY KEY, tenant VARCHAR(10), subject_id BIGINT, note VARCHAR(30),
        CONSTRAINT detail_subject FOREIGN KEY(tenant,subject_id) REFERENCES ${database}.subject(tenant,id)) ENGINE=InnoDB`,
      `INSERT INTO ${target}.parent VALUES ('A',9007199254740993,'准确父甲'),('A',9007199254740992,'相邻父键干扰'),('B',9007199254740993,'父乙干扰')`,
      `INSERT INTO ${database}.subject VALUES ('A',9007199254740993,9007199254740993,'所选甲'),('A',9007199254740992,9007199254740992,'相邻主键干扰'),('B',9007199254740994,9007199254740993,'所选乙')`,
      `INSERT INTO ${database}.detail VALUES (1,'A',9007199254740993,'明细甲'),(2,'B',9007199254740994,'明细乙干扰')`,
      `CREATE USER '${user}'@'%' IDENTIFIED BY '${readerPassword}'`,
      `GRANT SELECT ON ${database}.* TO '${user}'@'%'`,
      `GRANT SELECT ON ${target}.* TO '${user}'@'%'`,
    ]) await observer.query(sql);
    const sql = `SELECT s.tenant AS 区, s.id AS 编号, s.note AS 名称 FROM ${database}.subject s ORDER BY s.id DESC;`;
    await page.evaluate(async ({ host, port, user, readerPassword, database, dialect, sql }) => {
      const connection = await window.dbark.invoke('connections.save', { id: '', host, port, user, password: readerPassword, database, dialect,
        name: '关联专项', group: '', color: '#123456', rememberPassword: false });
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'relation-query',
        tabs: [{ id: 'relation-query', kind: 'query', title: '关联查询', connectionId: connection.id, database, sql }] });
    }, { host, port, user, readerPassword, database, dialect, sql });
    await page.reload();
    const query = page.locator('.query-tab:visible'), grid = query.locator('.query-result-grid').getByRole('grid');
    const execute = () => query.locator('.query-execute-split > button.primary').click();
    const open = async (name: string) => {
      await grid.getByRole('gridcell', { name: '所选甲', exact: true }).click();
      await (await navigationMenuItem(query, { name, exact: true })).click();
    };
    const tasks = () => page.evaluate(() => window.dbark.invoke('tasks.list', {}));
    await execute();
    await expect(grid.getByRole('gridcell', { name: '所选甲', exact: true })).toBeVisible();
    await execute();
    const sort = grid.getByRole('columnheader').filter({ hasText: /^编号/ });
    await sort.click();
    await expect(sort.getByLabel(queryResultSortZh.ascending)).toBeVisible();
    await expect(grid.getByRole('gridcell').filter({ hasText: /所选甲|所选乙|相邻主键干扰/ }))
      .toHaveText(['相邻主键干扰', '所选甲', '所选乙']);
    await open(text.parent);
    const parent = page.getByRole('dialog', { name: referenceZh.browse, exact: true });
    await expect(parent.getByRole('grid')).toContainText('准确父甲');
    await expect(parent.getByRole('grid')).not.toContainText(/相邻父键干扰|父乙干扰/);
    await info.attach(`${dialect}查询结果外键关联`, { body: await page.screenshot(), contentType: 'image/png' });
    await parent.getByRole('button', { name: zh.common.close, exact: true }).click();
    await open(text.children);
    const children = page.getByRole('dialog', { name: childReferencesZh.title, exact: true });
    const relations = children.getByRole('combobox', { name: childReferencesZh.relations });
    try { await expect(relations).toContainText(`${database}.detail · detail_subject`); }
    catch (failure) {
      await info.attach('子记录目录诊断', { body: await children.innerText(), contentType: 'text/plain' });
      const reader = await createConnection({ host, port, user, password: readerPassword, database });
      try {
        const [parts] = await reader.execute('SELECT CONSTRAINT_NAME, POSITION_IN_UNIQUE_CONSTRAINT, REFERENCED_TABLE_SCHEMA, REFERENCED_TABLE_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=? AND TABLE_NAME=?', [database, 'detail']);
        const [rules] = await reader.execute('SELECT CONSTRAINT_NAME, UNIQUE_CONSTRAINT_SCHEMA, UNIQUE_CONSTRAINT_NAME, REFERENCED_TABLE_NAME, MATCH_OPTION FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=? AND TABLE_NAME=?', [database, 'detail']);
        await info.attach('只读账号目录诊断', { body: JSON.stringify({ parts, rules }), contentType: 'application/json' });
      } finally { await reader.end(); }
      throw failure;
    }
    await relations.selectOption({ label: `${database}.detail · detail_subject` });
    await expect(children.getByRole('grid')).toContainText('明细甲');
    await expect(children.getByRole('grid')).not.toContainText('明细乙干扰');
    await children.getByRole('button', { name: childReferencesZh.close, exact: true }).click();
    await expect(children).toBeHidden();
    await observer.query(`UPDATE ${database}.subject SET note='并发修改' WHERE tenant='A' AND id=9007199254740993`);
    await open(text.parent);
    await expect(page.getByRole('dialog', { name: text.parent, exact: true }).getByRole('alert')).toContainText('查询原记录无法核验');
    const recorded = await tasks();
    expect(recorded.filter(task => task.kind === 'query.execute')).toHaveLength(2);
    expect(recorded.filter(task => task.kind === 'table.apply')).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
});
