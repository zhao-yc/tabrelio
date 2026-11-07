import { Client } from 'pg';
import { postgresRolesZh as t } from '../../src/renderer/locales/postgresRoles.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import { test, expect, desktop, page, quitDesktop } from './desktop-fixture';

test.use({trace: 'off', video: 'off', screenshot: 'off'});
test.skip(process.env.DBARK_PG_ROLES_NATIVE !== '1', '需要独占 PostgreSQL 权限目录夹具');
test.setTimeout(75_000);

test('普通 PostgreSQL 登录角色可核对继承、授予选项、对象级和行级安全', async ({}, info) => {
  const user = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '';
  const port = Number(process.env.DBARK_PGSEARCH_PORT);
  const token = /^tabrelio_pgsearch_([a-f0-9]{12})$/.exec(user)?.[1];
  if (!token || process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^[a-f0-9]{64}$/.test(password) ||
      !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮独占回环 PostgreSQL');
  const prefix = 'tabrelio_roles_' + token + '_', group = prefix + 'group';
  const schema = 'QA Scope', relation = "Sales'Row";
  const observer = new Client({host: '127.0.0.1', port, user, database: user, password, connectionTimeoutMillis: 3000});
  await observer.connect();
  try {
    const native = desktop.process();
    const direct = await observer.query(`SELECT current_user::text,rolsuper,rolcreaterole,
      has_table_privilege(current_user,c.oid,'SELECT') AS inherited_select,
      has_column_privilege(current_user,c.oid,'amount','UPDATE') AS column_update,
      has_table_privilege(current_user,c.oid,'UPDATE') AS table_update
      FROM pg_catalog.pg_roles r CROSS JOIN pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE r.rolname=current_user AND n.nspname::text=$1 AND c.relname::text=$2`, [schema, relation]);
    expect(direct.rows).toEqual([{current_user: user, rolsuper: false, rolcreaterole: false, inherited_select: true, column_update: true, table_update: false}]);
    await expect(observer.query('SELECT count(*) FROM pg_catalog.pg_authid')).rejects.toMatchObject({code: '42501'});
    await page.evaluate(async profile => { await window.dbark.invoke('connections.save', profile); }, {
      id: '', name: '受限 PostgreSQL 角色目录', dialect: 'postgresql' as const, group: '', color: '#123456',
      host: '127.0.0.1', port, user, database: user, password, rememberPassword: false,
    });
    await page.reload();
    await expect.poll(() => desktop.evaluate(({Menu}) => Menu.getApplicationMenu()?.getMenuItemById('postgres-roles')?.enabled)).toBe(true);
    await desktop.evaluate(({Menu, BrowserWindow}) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById('postgres-roles'), [owner, extra] = BrowserWindow.getAllWindows();
      if (!item?.enabled || !owner || extra) throw Error('原生工具菜单或窗口不匹配');
      item.click(item, owner, {} as Electron.KeyboardEvent);
    });
    const modal = page.getByRole('dialog', {name: t.title, exact: true});
    const search = modal.getByLabel(t.search, {exact: true});
    const load = () => modal.getByRole('button', {name: t.read, exact: true}).click();
    await search.fill(prefix + 'page_');
    await load();
    const directory = modal.getByRole('region', {name: t.directory, exact: true});
    await expect(directory.getByRole('listitem')).toHaveCount(50);
    await expect(directory.getByRole('button', {name: prefix + 'page_00', exact: true})).toBeVisible();
    await directory.getByRole('button', {name: t.next, exact: true}).click();
    await expect(directory.getByRole('listitem')).toHaveCount(2);
    await expect(directory.getByRole('button', {name: prefix + 'page_51', exact: true})).toBeVisible();
    await directory.getByRole('button', {name: t.previous, exact: true}).click();
    await expect(directory.getByRole('listitem')).toHaveCount(50);

    await search.fill(prefix + '%');
    await load();
    await expect(directory.getByText(t.empty, {exact: true})).toBeVisible();
    await modal.getByRole('button', {name: t.current, exact: true}).click();
    const roles = modal.getByRole('table', {name: t.granted, exact: true});
    const edge = roles.getByRole('row', {name: new RegExp(group)});
    await expect(edge.getByRole('cell')).toHaveText(['postgres', t.no, t.yes, t.no]);
    const databasePrivileges = modal.getByRole('table', {name: t.databasePrivileges, exact: true});
    await expect(databasePrivileges.getByRole('row', {name: /CONNECT/}).getByRole('cell')).toHaveText([t.yes, t.yes]);
    await modal.getByLabel(t.schema, {exact: true}).fill(schema);
    await modal.getByLabel(t.relation, {exact: true}).fill(relation);
    await modal.getByRole('button', {name: t.probe, exact: true}).click();
    const privileges = modal.getByRole('table', {name: t.relationPrivileges + ' · ' + relation, exact: true});
    await expect(privileges.getByRole('row', {name: /SELECT/}).getByRole('cell')).toHaveText([t.yes, t.yes]);
    await expect(privileges.getByRole('row', {name: /UPDATE/}).getByRole('cell')).toHaveText([t.no, t.no]);
    await expect(modal.getByRole('table', {name: t.schemaPrivileges + ' · ' + schema, exact: true})
      .getByRole('row', {name: /USAGE/}).getByRole('cell')).toHaveText([t.yes, t.no]);
    const security = modal.getByText(t.rowSecurity + ' · ' + t.yes + ' ／ ' + t.forceRls + ' · ' + t.yes, {exact: true});
    await expect(security).toBeVisible();
    await security.scrollIntoViewIfNeeded();
    await modal.screenshot({path: info.outputPath('PostgreSQL 角色权限.png')});
    await roles.getByRole('button', {name: group, exact: true}).click();
    await expect(modal.getByRole('table', {name: t.members, exact: true}).getByRole('button', {name: user, exact: true})).toBeVisible();
    await modal.getByLabel(t.relation, {exact: true}).fill('不存在');
    await modal.getByRole('button', {name: t.probe, exact: true}).click();
    await expect(modal.getByText(t.missing, {exact: true})).toBeVisible();
    const saved = await page.evaluate(async () => ({
      history: await window.dbark.invoke('history.list', {}),
      tasks: (await window.dbark.invoke('tasks.list', {})).filter(item => item.kind === 'postgres.roles.read'),
    }));
    expect(saved.history).toEqual([]);
    expect(saved.tasks).toHaveLength(8);
    expect(saved.tasks.every(item => item.status === 'completed')).toBe(true);
    expect(JSON.stringify(saved.tasks)).not.toContain(group);
    expect(JSON.stringify(saved.tasks)).not.toContain(relation);
    await modal.getByRole('button', {name: zh.common.close, exact: true}).click();
    await quitDesktop();
    expect(native.exitCode).toBe(0);
  } finally { await observer.end(); }
});
