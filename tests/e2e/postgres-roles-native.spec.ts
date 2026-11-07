import { Client } from 'pg';
import { randomBytes } from 'node:crypto';
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

test('PostgreSQL 直接成员授权预览、受限撤销及目录回读', async ({}, info) => {
  const user = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '';
  const adminPassword = process.env.DBARK_PG_ROLES_ADMIN_PASSWORD ?? '', port = Number(process.env.DBARK_PGSEARCH_PORT);
  const token = /^tabrelio_pgsearch_([a-f0-9]{12})$/.exec(user)?.[1];
  if (!token || process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^[a-f0-9]{64}$/.test(password) ||
      !/^[a-f0-9]{64}$/.test(adminPassword) || !Number.isInteger(port) || port <= 1024 || port > 65535)
    throw Error('仅允许本轮独占回环 PostgreSQL');
  const prefix = 'tabrelio_roles_' + token + '_';
  const managed = prefix + 'managed', recipient = prefix + 'recipient', dependent = prefix + 'dependent';
  const endpoint = {host: '127.0.0.1', port, database: user};
  const observer = new Client({...endpoint, user, password, connectionTimeoutMillis: 3000});
  const member = new Client({...endpoint, user: recipient, password, connectionTimeoutMillis: 3000});
  await observer.connect();
  try {
    await member.connect();
    const native = desktop.process();
    const profiles = await page.evaluate(async ({endpoint, user, password, adminPassword}) => {
      const base = {id: '', dialect: 'postgresql' as const, group: '', color: '#123456', ...endpoint, rememberPassword: false};
      const normal = await window.dbark.invoke('connections.save', {...base, name: '授权普通账号', user, password});
      const superuser = await window.dbark.invoke('connections.save', {...base, name: '授权超级用户', user: 'postgres', password: adminPassword});
      return {normal: normal.id, superuser: superuser.id};
    }, {endpoint, user, password, adminPassword});
    await page.reload();
    await expect.poll(() => desktop.evaluate(({Menu}) => Menu.getApplicationMenu()?.getMenuItemById('postgres-roles')?.enabled)).toBe(true);
    await desktop.evaluate(({Menu, BrowserWindow}) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById('postgres-roles'), [owner, extra] = BrowserWindow.getAllWindows();
      if (!item?.enabled || !owner || extra) throw Error('原生工具菜单或窗口不匹配');
      item.click(item, owner, {} as Electron.KeyboardEvent);
    });
    const modal = page.getByRole('dialog', {name: t.title, exact: true}), edit = page.getByRole('dialog', {name: t.membership, exact: true});
    async function selectRole(name: string) {
      await modal.getByLabel(t.search, {exact: true}).fill(name);
      await modal.getByRole('button', {name: t.read, exact: true}).click();
      await modal.getByRole('region', {name: t.directory, exact: true}).getByRole('button', {name, exact: true}).click();
      await expect(modal.getByRole('heading', {name, exact: true})).toBeVisible();
    }
    async function grants(memberName = recipient) {
      return (await observer.query(`SELECT g.rolname::text AS grantor, m.admin_option AS admin, m.inherit_option AS inherit, m.set_option AS set
        FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.roleid
        JOIN pg_catalog.pg_roles a ON a.oid=m.member JOIN pg_catalog.pg_roles g ON g.oid=m.grantor
        WHERE r.rolname=$1 AND a.rolname=$2 ORDER BY g.rolname::text COLLATE "C"`, [managed, memberName])).rows;
    }
    const base = {grantor: 'postgres', admin: false, inherit: false, set: false};
    const ours = {grantor: user, admin: true, inherit: true, set: true};
    await modal.getByLabel(t.connection, {exact: true}).selectOption(profiles.normal);
    await selectRole(recipient);
    await modal.getByRole('button', {name: t.grant, exact: true}).click();
    await edit.getByLabel(t.targetRole, {exact: true}).fill(managed);
    await edit.getByRole('checkbox', {name: t.admin, exact: true}).check();
    await edit.getByRole('button', {name: t.preview, exact: true}).click();
    await expect(edit.getByLabel(t.sql)).toHaveText(`GRANT "${managed}" TO "${recipient}" WITH ADMIN true, INHERIT true, SET true GRANTED BY "${user}"`);
    expect(await grants()).toEqual([base]);
    const submit = edit.getByRole('button', {name: t.execute, exact: true});
    await expect(submit).toBeDisabled();
    await edit.getByRole('checkbox', {name: t.confirm, exact: true}).check();
    await submit.dblclick();
    await expect(edit.getByRole('status')).toContainText(t.result.committed);
    expect(await grants()).toEqual([base, ours]);
    await edit.getByRole('button', {name: zh.common.close, exact: true}).click();

    async function previewRevoke() {
      const edge = modal.getByRole('table', {name: t.granted, exact: true}).getByRole('row').filter({hasText: user});
      await edge.getByRole('button', {name: t.revoke + ' ' + managed, exact: true}).click();
      await edit.getByRole('button', {name: t.preview, exact: true}).click();
      await expect(edit.getByLabel(t.sql)).toHaveText(`REVOKE "${managed}" FROM "${recipient}" GRANTED BY "${user}" RESTRICT`);
      await edit.getByRole('checkbox', {name: t.confirm, exact: true}).check();
    }
    await member.query(`GRANT "${managed}" TO "${dependent}" WITH ADMIN FALSE, INHERIT TRUE, SET TRUE GRANTED BY "${recipient}"`);
    await previewRevoke();
    await submit.click();
    await expect(edit.getByRole('alert')).toContainText(t.result.rolledBack);
    expect(await grants()).toEqual([base, ours]);
    expect(await grants(dependent)).toEqual([{grantor: recipient, admin: false, inherit: true, set: true}]);
    await edit.getByRole('button', {name: zh.common.close, exact: true}).click();
    await member.query(`REVOKE "${managed}" FROM "${dependent}" GRANTED BY "${recipient}" RESTRICT`);
    await previewRevoke();
    await edit.screenshot({path: info.outputPath('PostgreSQL 成员撤销预览.png')});
    await submit.click();
    await expect(edit.getByRole('status')).toContainText(t.result.committed);
    expect(await grants()).toEqual([base]);
    await edit.getByRole('button', {name: zh.common.close, exact: true}).click();
    await expect(modal.getByRole('heading', {name: recipient, exact: true})).toBeVisible();
    await expect(modal.getByRole('table', {name: t.granted, exact: true}).getByRole('row').filter({hasText: user})).toHaveCount(0);

    const [memberIdentity, actorIdentity] = await Promise.all([recipient, user].map(name =>
      observer.query<{oid: string; name: string}>('SELECT oid::text,rolname::text AS name FROM pg_catalog.pg_roles WHERE rolname=$1', [name])
        .then(result => result.rows[0])));
    const input = {connectionId: profiles.normal, database: user, action: 'grant' as const, member: memberIdentity,
      roleName: managed, options: {admin: false, inherit: false, set: false}};
    await expect(page.evaluate(draft => window.dbark.invoke('postgres.roles.membership.preview', draft), {...input, member: actorIdentity}))
      .rejects.toThrow('不能修改登录角色');
    const preview = await page.evaluate(draft => window.dbark.invoke('postgres.roles.membership.preview', draft), input);
    await observer.query(`GRANT "${managed}" TO "${recipient}" WITH ADMIN FALSE, INHERIT TRUE, SET FALSE GRANTED BY "${user}"`);
    const apply = () => page.evaluate(input => window.dbark.invoke('postgres.roles.membership.apply', input),
      {connectionId: profiles.normal, database: user, token: preview.token, confirmed: true as const});
    await expect(apply()).resolves.toMatchObject({outcome: 'notSent', message: expect.stringContaining('已变化')});
    await expect(apply()).resolves.toMatchObject({outcome: 'notSent', message: expect.stringContaining('已失效')});
    expect(await grants()).toEqual([base, {grantor: user, admin: false, inherit: true, set: false}]);

    await modal.getByLabel(t.connection, {exact: true}).selectOption(profiles.superuser);
    await selectRole(dependent);
    await modal.getByRole('button', {name: t.grant, exact: true}).click();
    await edit.getByLabel(t.targetRole, {exact: true}).fill(managed);
    await edit.getByRole('button', {name: t.preview, exact: true}).click();
    await expect(edit.getByLabel(t.sql)).toContainText('GRANTED BY "postgres"');
    await edit.getByRole('checkbox', {name: t.confirm, exact: true}).check();
    await submit.click();
    await expect(edit.getByRole('status')).toContainText(t.result.committed);
    expect(await grants(dependent)).toEqual([{grantor: 'postgres', admin: false, inherit: true, set: true}]);
    await edit.getByRole('button', {name: zh.common.close, exact: true}).click();
    await expect(modal.getByRole('table', {name: t.granted, exact: true}).getByRole('button', {name: managed, exact: true})).toBeVisible();
    await modal.getByRole('button', {name: zh.common.close, exact: true}).click();
    await quitDesktop();
    expect(native.exitCode).toBe(0);
  } finally { await member.end(); await observer.end(); }
});

test('PostgreSQL 创建组角色和登录角色并通过新密码实际认证', async ({}, info) => {
  const user = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '';
  const adminPassword = process.env.DBARK_PG_ROLES_ADMIN_PASSWORD ?? '', port = Number(process.env.DBARK_PGSEARCH_PORT);
  const token = /^tabrelio_pgsearch_([a-f0-9]{12})$/.exec(user)?.[1];
  if (!token || process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^[a-f0-9]{64}$/.test(password) ||
      !/^[a-f0-9]{64}$/.test(adminPassword) || !Number.isInteger(port) || port <= 1024 || port > 65535)
    throw Error('仅允许本轮独占回环 PostgreSQL');
  const prefix = 'tabrelio_roles_' + token + '_';
  const creator = prefix + 'creator', group = prefix + 'team "组"', account = prefix + 'account', external = prefix + 'external';
  const secret = 'ＳＣＲＡＭ-' + randomBytes(18).toString('hex');
  const endpoint = {host: '127.0.0.1', port, database: user};
  const observer = new Client({...endpoint, user: 'postgres', password: adminPassword, connectionTimeoutMillis: 3000});
  await observer.connect();
  const tCreate = t.create;
  try {
    const native = desktop.process();
    const ids = await page.evaluate(async ({endpoint, user, creator, password, adminPassword}) => {
      const base = {id: '', dialect: 'postgresql' as const, group: '', color: '#123456', ...endpoint, rememberPassword: false};
      const denied = await window.dbark.invoke('connections.save', {...base, name: '普通账号', user, password});
      const allowed = await window.dbark.invoke('connections.save', {...base, name: '角色创建账号', user: creator, password});
      const admin = await window.dbark.invoke('connections.save', {...base, name: '角色核对管理员', user: 'postgres', password: adminPassword});
      return {denied: denied.id, allowed: allowed.id, admin: admin.id};
    }, {endpoint, user, creator, password, adminPassword});
    await page.reload();
    await expect.poll(() => desktop.evaluate(({Menu}) => Menu.getApplicationMenu()?.getMenuItemById('postgres-roles')?.enabled)).toBe(true);
    await desktop.evaluate(({Menu, BrowserWindow}) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById('postgres-roles'), [owner, extra] = BrowserWindow.getAllWindows();
      if (!item?.enabled || !owner || extra) throw Error('原生工具菜单或窗口不匹配');
      item.click(item, owner, {} as Electron.KeyboardEvent);
    });
    const modal = page.getByRole('dialog', {name: t.title, exact: true}), edit = page.getByRole('dialog', {name: tCreate.title, exact: true});
    await modal.getByRole('combobox', {name: t.connection, exact: true}).selectOption(ids.allowed);
    const readRole = async (name: string) => (await observer.query(`SELECT rolcanlogin AS login,rolinherit AS inherit,
      rolconnlimit AS lim,rolsuper AS super,rolreplication AS repl,rolbypassrls AS bypass,
      extract(epoch FROM rolvaliduntil)::text AS expiry,rolpassword IS NULL AS no_password,
      coalesce(rolpassword LIKE 'SCRAM-SHA-256$%',false) AS scram
      FROM pg_catalog.pg_authid WHERE rolname::text=$1`, [name])).rows[0];
    const open = async (name: string) => {
      await modal.getByRole('button', {name: tCreate.open, exact: true}).click();
      await edit.getByLabel(t.roleName, {exact: true}).fill(name);
    };
    const preview = () => edit.getByRole('button', {name: tCreate.preview, exact: true}).click();
    const apply = async () => {
      await edit.getByRole('checkbox', {name: tCreate.confirm, exact: true}).check();
      await edit.getByRole('button', {name: tCreate.apply, exact: true}).click();
      await expect(edit.getByRole('status')).toContainText(t.result.committed);
      await edit.getByRole('button', {name: zh.common.close, exact: true}).click();
    };
    const refreshed = (name: string) => expect(modal.getByRole('region', {name: t.directory, exact: true})
      .getByRole('button', {name, exact: true})).toBeVisible();

    await open(group); await preview();
    await expect(edit.getByLabel(tCreate.sql)).toContainText('CREATE ROLE "' + group.replaceAll('"', '""') + '"');
    await expect(edit.getByLabel(tCreate.sql)).toContainText('NOLOGIN');
    expect(await readRole(group)).toBeUndefined();
    await apply(); await refreshed(group);
    expect(await readRole(group)).toMatchObject({login: false, inherit: true, lim: -1, no_password: true});

    await open(account);
    await edit.getByRole('combobox', {name: tCreate.auth, exact: true}).selectOption('password');
    await edit.getByLabel(t.connectionLimit, {exact: true}).fill('3');
    await edit.getByLabel(tCreate.expiry, {exact: true}).fill('2098-06-07T08:09');
    await edit.getByRole('checkbox', {name: t.inherit, exact: true}).uncheck();
    await preview();
    await expect(edit.getByLabel(tCreate.sql)).toContainText('<客户端生成的 SCRAM 验证值>');
    expect(await readRole(account)).toBeUndefined();
    await edit.screenshot({path: info.outputPath('PostgreSQL 创建登录角色预览.png')});
    await edit.getByLabel(tCreate.secret, {exact: true}).fill(secret);
    await edit.getByLabel(tCreate.repeat, {exact: true}).fill('本例错误确认');
    await edit.getByRole('checkbox', {name: tCreate.confirm, exact: true}).check();
    await edit.getByRole('button', {name: tCreate.apply, exact: true}).click();
    await expect(edit.getByRole('alert')).toContainText(tCreate.passwordMismatch);
    expect(await readRole(account)).toBeUndefined();
    await edit.getByLabel(tCreate.repeat, {exact: true}).fill(secret);
    await apply(); await refreshed(account);
    expect(await readRole(account)).toMatchObject({login: true, inherit: false, lim: 3, no_password: false, scram: true,
      expiry: (Date.parse('2098-06-07T08:09:00Z') / 1000).toFixed(6)});
    const newClient = new Client({...endpoint, user: account, password: secret, connectionTimeoutMillis: 3000});
    try {
      await newClient.connect();
      expect((await newClient.query('SELECT current_user::text AS name')).rows[0].name).toBe(account);
    } finally { await newClient.end(); }

    const draft = {connectionId: ids.allowed, database: user, name: external, auth: 'external' as const,
      inherit: true, createDatabase: false, createRole: false, superuser: false, replication: false, bypassRls: false, connectionLimit: -1};
    const prepare = (value: typeof draft) => page.evaluate(input => window.dbark.invoke('postgres.roles.create.preview', input), value);
    const submit = (connectionId: string, token: string) => page.evaluate(input => window.dbark.invoke('postgres.roles.create.apply', input),
      {connectionId, database: user, token, confirmed: true as const});
    await expect(prepare({...draft, connectionId: ids.denied})).rejects.toThrow('CREATEROLE');
    await expect(prepare({...draft, replication: true})).rejects.toThrow('超级用户');
    const elevated = await prepare({...draft, connectionId: ids.admin, superuser: true, replication: true, bypassRls: true});
    await expect(submit(ids.admin, elevated.token)).resolves.toMatchObject({outcome: 'committed'});
    expect(await readRole(external)).toMatchObject({login: true, no_password: true, super: true, repl: true, bypass: true});

    const collision = prefix + 'collision', stale = await prepare({...draft, name: collision});
    await observer.query('CREATE ROLE "' + collision + '" NOLOGIN CONNECTION LIMIT 2');
    await expect(submit(ids.allowed, stale.token)).resolves.toMatchObject({outcome: 'notSent'});
    await expect(submit(ids.allowed, stale.token)).resolves.toMatchObject({outcome: 'notSent'});
    expect(await readRole(collision)).toMatchObject({login: false, lim: 2});
    const local = await page.evaluate(async () => ({history: await window.dbark.invoke('history.list', {}),
      tasks: await window.dbark.invoke('tasks.list', {}), settings: await window.dbark.invoke('settings.get', {})}));
    expect(local.history).toEqual([]);
    expect(JSON.stringify(local).includes(secret)).toBe(false);
    expect(JSON.stringify(local).includes('SCRAM-SHA-256$')).toBe(false);
    await modal.getByRole('button', {name: zh.common.close, exact: true}).click();
    await quitDesktop();
    expect(native.exitCode).toBe(0);
  } finally { await observer.end(); }
});

test('PostgreSQL 普通登录角色轮换密码并更新原连接配置', async ({}, info) => {
  const database = process.env.DBARK_PGSEARCH_USER ?? '', adminPassword = process.env.DBARK_PG_ROLES_ADMIN_PASSWORD ?? '';
  const oldPassword = process.env.DBARK_PG_ROLES_ROTATION_OLD ?? '', newPassword = process.env.DBARK_PG_ROLES_ROTATION_NEW ?? '';
  const port = Number(process.env.DBARK_PGSEARCH_PORT), token = /^tabrelio_pgsearch_([a-f0-9]{12})$/.exec(database)?.[1];
  if (!token || process.env.DBARK_INTEGRATION_ENABLED !== '1' || ![adminPassword, oldPassword, newPassword].every(value => /^[a-f0-9]{64}$/.test(value)) ||
      !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮独占回环 PostgreSQL');
  const user = 'tabrelio_roles_' + token + '_rotate';
  const endpoint = {host: '127.0.0.1', port, database};
  const admin = new Client({...endpoint, user: 'postgres', password: adminPassword, connectionTimeoutMillis: 3000});
  const login = async (password: string) => {
    const connection = new Client({...endpoint, user, password, connectionTimeoutMillis: 3000});
    try { await connection.connect(); return (await connection.query('SELECT current_user::text')).rows[0].current_user; }
    finally { await connection.end(); }
  };
  await admin.connect();
  try {
    await admin.query(`CREATE ROLE ${user} LOGIN NOSUPERUSER NOCREATEROLE CONNECTION LIMIT 4 PASSWORD '${oldPassword}' VALID UNTIL '2098-08-08T08:08:08Z'`);
    const attributes = () => admin.query('SELECT oid::text,rolsuper,rolcreaterole,rolconnlimit,rolvaliduntil::text FROM pg_catalog.pg_roles WHERE rolname=$1', [user]);
    const before = (await attributes()).rows[0];
    expect(before).toMatchObject({rolsuper: false, rolcreaterole: false, rolconnlimit: 4});
    const connection = await page.evaluate(async ({endpoint, user, oldPassword}) => window.dbark.invoke('connections.save', {
      ...endpoint, id: '', name: '轮换密码验收连接', dialect: 'postgresql', group: '', color: '#123456', user,
      password: oldPassword, rememberPassword: false,
    }), {endpoint, user, oldPassword});
    await page.reload();
    await expect.poll(() => desktop.evaluate(({Menu}) => Menu.getApplicationMenu()?.getMenuItemById('postgres-roles')?.enabled)).toBe(true);
    await desktop.evaluate(({Menu, BrowserWindow}) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById('postgres-roles'), [owner, extra] = BrowserWindow.getAllWindows();
      if (!item?.enabled || !owner || extra) throw Error('原生工具菜单或窗口不匹配');
      item.click(item, owner, {} as Electron.KeyboardEvent);
    });
    const modal = page.getByRole('dialog', {name: t.title, exact: true});
    await modal.getByLabel(t.search, {exact: true}).fill(database);
    await modal.getByRole('button', {name: t.read, exact: true}).click();
    const directory = modal.getByRole('region', {name: t.directory, exact: true});
    await directory.getByRole('button', {name: database, exact: true}).click();
    await expect(modal.getByRole('heading', {name: database, exact: true})).toBeVisible();
    await expect(modal.getByRole('button', {name: t.password.open, exact: true})).toHaveCount(0);
    await expect(page.evaluate(async ({connectionId, database, user}) => window.dbark.invoke('postgres.roles.password.preview', {
      connectionId, database, role: {oid: '10', name: user},
    }), {connectionId: connection.id, database, user})).rejects.toThrow('角色已变化');
    const previewForRole = () => page.evaluate(async ({connectionId, database, user, oid}) =>
      window.dbark.invoke('postgres.roles.password.preview', {connectionId, database, role: {oid, name: user}}),
      {connectionId: connection.id, database, user, oid: before.oid});
    const stale = await previewForRole();
    const wrongOperation = await page.evaluate(async ({connectionId, database, token, newPassword}) =>
      window.dbark.invoke('postgres.roles.create.apply', {connectionId, database, token, confirmed: true, password: newPassword}),
      {connectionId: connection.id, database, token: stale.token, newPassword});
    expect(wrongOperation.outcome).toBe('notSent');
    await admin.query(`ALTER ROLE ${user} VALID UNTIL '2099-01-01T00:00:00Z'`);
    const staleOutcome = await page.evaluate(async ({connectionId, database, token, newPassword}) =>
      window.dbark.invoke('postgres.roles.password.apply', {connectionId, database, token, confirmed: true, password: newPassword}),
      {connectionId: connection.id, database, token: stale.token, newPassword});
    expect(staleOutcome.outcome).toBe('notSent');
    expect(staleOutcome.message).toContain('已变化');
    await expect(login(oldPassword)).resolves.toBe(user);
    await admin.query(`ALTER ROLE ${user} VALID UNTIL '2098-08-08T08:08:08Z'`);

    await modal.getByRole('button', {name: t.current, exact: true}).click();
    await modal.getByRole('button', {name: t.password.open, exact: true}).click();
    const rotation = page.getByRole('dialog', {name: t.password.title, exact: true});
    await expect(rotation.getByLabel(t.password.secret, {exact: true})).toHaveCount(0);
    await rotation.getByRole('button', {name: t.password.preview, exact: true}).click();
    const sql = rotation.getByLabel(t.password.sql, {exact: true});
    await expect(sql).toHaveText('ALTER ROLE CURRENT_USER PASSWORD <客户端生成的 SCRAM 验证值>');
    await rotation.screenshot({path: info.outputPath('PostgreSQL 登录密码轮换预览.png')});
    await expect(login(oldPassword)).resolves.toBe(user);
    await rotation.getByLabel(t.password.secret, {exact: true}).fill(newPassword);
    const repeat = rotation.getByLabel(t.create.repeat, {exact: true});
    await repeat.fill(oldPassword);
    await rotation.getByLabel(t.password.confirm, {exact: true}).check();
    const apply = rotation.getByRole('button', {name: t.password.apply, exact: true});
    await apply.click();
    await expect(rotation.getByText(t.create.passwordMismatch, {exact: true})).toBeVisible();
    await expect(login(oldPassword)).resolves.toBe(user);
    await repeat.fill(newPassword);
    await apply.click();
    await expect(rotation.getByText(t.password.committed, {exact: true})).toBeVisible();
    await expect(login(oldPassword)).rejects.toMatchObject({code: '28P01'});
    await expect(login(newPassword)).resolves.toBe(user);
    expect((await attributes()).rows).toEqual([before]);
    expect((await admin.query('SELECT rolpassword LIKE $1 AS scram FROM pg_catalog.pg_authid WHERE rolname=$2',
      ['SCRAM-SHA-256$%', user])).rows).toEqual([{scram: true}]);

    await rotation.getByRole('button', {name: t.password.editConnection, exact: true}).click();
    const editor = page.getByRole('dialog', {name: zh.connections.text003, exact: true});
    await expect(editor.getByLabel(zh.connections.text006, {exact: true})).toHaveValue('轮换密码验收连接');
    const passwordField = editor.getByLabel(zh.connections.text011, {exact: true});
    await expect(passwordField).toHaveValue('');
    await passwordField.fill(newPassword);
    await editor.getByRole('button', {name: zh.connections.text034, exact: true}).click();
    await expect(editor.getByText(/连接成功 · PostgreSQL/)).toBeVisible();
    await editor.getByRole('button', {name: zh.connections.text036, exact: true}).click();
    await expect(editor).toHaveCount(0);
    const saved = await page.evaluate(async () => JSON.stringify({
      profiles: await window.dbark.invoke('connections.list', {}), history: await window.dbark.invoke('history.list', {}),
      tasks: await window.dbark.invoke('tasks.list', {}),
    }));
    expect([oldPassword, newPassword, 'SCRAM-SHA-256$'].every(value => !saved.includes(value))).toBe(true);
    await quitDesktop();
  } finally { await admin.end(); }
});

test('PostgreSQL 普通表直接授权、仅撤销转授及列权限影响', async ({}, info) => {
  const database = process.env.DBARK_PGSEARCH_USER ?? '', ownerPassword = process.env.DBARK_PGSEARCH_PASSWORD ?? '';
  const adminPassword = process.env.DBARK_PG_ROLES_ADMIN_PASSWORD ?? '';
  const port = Number(process.env.DBARK_PGSEARCH_PORT), token = /^tabrelio_pgsearch_([a-f0-9]{12})$/.exec(database)?.[1];
  if (!token || process.env.DBARK_INTEGRATION_ENABLED !== '1' || ![adminPassword, ownerPassword].every(value => /^[a-f0-9]{64}$/.test(value)) ||
      !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮独占回环 PostgreSQL');
  const prefix = 'tabrelio_roles_' + token + '_', recipient = prefix + 'recipient', dependent = prefix + 'dependent';
  const schema = 'QA Privileges', relation = 'Sales"ACL', qualified = '"QA Privileges"."Sales""ACL"';
  const endpoint = {host: '127.0.0.1', port, database, connectionTimeoutMillis: 3000};
  const admin = new Client({...endpoint, user: 'postgres', password: adminPassword});
  const owner = new Client({...endpoint, user: database, password: ownerPassword});
  const member = new Client({...endpoint, user: recipient, password: ownerPassword});
  await admin.connect();
  try {
    await owner.connect();
    await member.connect();
    await owner.query(`CREATE SCHEMA "QA Privileges"; CREATE TABLE ${qualified}(id int, body text);
      INSERT INTO ${qualified} VALUES (1,'qa'); CREATE VIEW "QA Privileges".report AS SELECT id FROM ${qualified};
      CREATE TABLE "QA Privileges".partitioned(id int) PARTITION BY RANGE(id);
      GRANT USAGE ON SCHEMA "QA Privileges" TO ${recipient},${dependent}`);
    const role = (await admin.query('SELECT oid::text,rolname::text AS name FROM pg_catalog.pg_roles WHERE rolname=$1', [recipient])).rows[0];
    const object = async (name: string) => ({schema, name, oid: (await admin.query(`SELECT c.oid::text FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname=$2`, [schema, name])).rows[0].oid});
    const original = await object(relation);
    const direct = async () => (await admin.query(`SELECT NULL::text AS column, acl.privilege_type,acl.is_grantable FROM pg_catalog.pg_class c
      CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) acl WHERE c.oid=$1 AND acl.grantee=$2 AND acl.grantor=c.relowner
      UNION ALL SELECT a.attname::text, acl.privilege_type,acl.is_grantable FROM pg_catalog.pg_attribute a
      JOIN pg_catalog.pg_class c ON c.oid=a.attrelid CROSS JOIN LATERAL pg_catalog.aclexplode(a.attacl) acl
      WHERE c.oid=$1 AND acl.grantee=$2 AND acl.grantor=c.relowner ORDER BY 1 NULLS FIRST, 2`, [original.oid, role.oid])).rows;
    const grant = (column: string | null, privilege_type: string, is_grantable: boolean) => ({column, privilege_type, is_grantable});
    const profiles = await page.evaluate(async ({database, port, ownerPassword, adminPassword, recipient}) => {
      const base = {id: '', name: '表权限所有者', dialect: 'postgresql' as const, group: '', color: '#123456', host: '127.0.0.1', port,
        database, rememberPassword: false};
      const add = (name: string, user: string, password: string) => window.dbark.invoke('connections.save', {...base, name, user, password});
      return {owner: (await add(base.name, database, ownerPassword)).id, admin: (await add('表权限管理员', 'postgres', adminPassword)).id,
        member: (await add('表权限受权者', recipient, ownerPassword)).id};
    }, {database, port, ownerPassword, adminPassword, recipient});
    await page.reload();
    await expect.poll(() => desktop.evaluate(({Menu}) => Menu.getApplicationMenu()?.getMenuItemById('postgres-roles')?.enabled)).toBe(true);
    await desktop.evaluate(({Menu, BrowserWindow}) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById('postgres-roles'), [owner, extra] = BrowserWindow.getAllWindows();
      if (!item?.enabled || !owner || extra) throw Error('原生工具菜单或窗口不匹配');
      item.click(item, owner, {} as Electron.KeyboardEvent);
    });
    const modal = page.getByRole('dialog', {name: t.title, exact: true});
    await modal.getByLabel(t.connection, {exact: true}).selectOption(profiles.owner);
    await modal.getByLabel(t.search, {exact: true}).fill(recipient);
    await modal.getByRole('button', {name: t.read, exact: true}).click();
    await modal.getByRole('region', {name: t.directory, exact: true}).getByRole('button', {name: recipient, exact: true}).click();
    await modal.getByLabel(t.schema, {exact: true}).fill(schema);
    await modal.getByLabel(t.relation, {exact: true}).fill(relation);
    await modal.getByRole('button', {name: t.probe, exact: true}).click();
    const locale = t.tablePrivileges;
    const edit = modal.getByRole('button', {name: locale.open, exact: true});
    const dialog = page.getByRole('dialog', {name: locale.title, exact: true});
    const prepare = async (action: string, privileges: string[]) => {
      await edit.click();
      await dialog.getByLabel(locale.action, {exact: true}).selectOption(action);
      for (const name of privileges) await dialog.getByRole('checkbox', {name, exact: true}).check();
      await dialog.getByRole('button', {name: locale.preview, exact: true}).click();
      const sql = dialog.getByLabel(locale.sql, {exact: true});
      await expect(sql).toBeVisible();
      return sql;
    };
    const apply = async (outcome: 'committed' | 'rolledBack') => {
      await dialog.getByRole('checkbox', {name: locale.confirm, exact: true}).check();
      await dialog.getByRole('button', {name: locale.apply, exact: true}).click();
      await expect(dialog.getByRole(outcome === 'committed' ? 'status' : 'alert').filter({hasText: t.result[outcome]})).toBeVisible();
      await dialog.getByRole('button', {name: zh.common.close, exact: true}).click();
    };

    await expect(await prepare('grantOption', ['INSERT', 'SELECT'])).toHaveText(
      `GRANT SELECT, INSERT ON TABLE ${qualified} TO "${recipient}" WITH GRANT OPTION`);
    expect(await direct()).toEqual([]);
    await expect(member.query(`SELECT id FROM ${qualified}`)).rejects.toMatchObject({code: '42501'});
    await apply('committed');
    expect(await direct()).toEqual([grant(null, 'INSERT', true), grant(null, 'SELECT', true)]);
    expect((await member.query(`SELECT id FROM ${qualified}`)).rows).toEqual([{id: 1}]);

    await member.query(`GRANT SELECT ON ${qualified} TO ${dependent}`);
    await prepare('revoke', ['SELECT', 'INSERT']);
    await apply('rolledBack');
    expect(await direct()).toEqual([grant(null, 'INSERT', true), grant(null, 'SELECT', true)]);
    await member.query(`REVOKE SELECT ON ${qualified} FROM ${dependent}`);
    await owner.query(`GRANT SELECT(body) ON ${qualified} TO ${recipient} WITH GRANT OPTION; GRANT SELECT ON ${qualified} TO PUBLIC`);
    await expect(await prepare('revokeOption', ['SELECT'])).toHaveText(`REVOKE GRANT OPTION FOR SELECT ON TABLE ${qualified} FROM "${recipient}" RESTRICT`);
    await expect(dialog.getByRole('region', {name: locale.affected}).getByText('body · SELECT')).toBeVisible();
    await apply('committed');
    expect(await direct()).toEqual([grant(null, 'INSERT', true), grant(null, 'SELECT', false), grant('body', 'SELECT', false)]);
    await prepare('revoke', ['SELECT']);
    await expect(dialog.getByRole('region', {name: locale.affected}).getByText('body · SELECT')).toBeVisible();
    await dialog.screenshot({path: info.outputPath('PostgreSQL 表权限撤销预览.png')});
    await apply('committed');
    expect(await direct()).toEqual([grant(null, 'INSERT', true)]);
    expect((await member.query(`SELECT id FROM ${qualified}`)).rows).toEqual([{id: 1}]);

    const prepareDirect = (connectionId: string, table: typeof original) => page.evaluate(async draft =>
      window.dbark.invoke('postgres.roles.tablePrivileges.preview', draft),
      {connectionId, database, table, role, action: 'grant' as const, privileges: ['SELECT' as const]});
    const applyDirect = (connectionId: string, token: string) => page.evaluate(async input =>
      window.dbark.invoke('postgres.roles.tablePrivileges.apply', input), {connectionId, database, token, confirmed: true as const});
    await expect(prepareDirect(profiles.member, original)).rejects.toThrow('只有对象所有者或超级用户');
    const view = await object('report');
    const viewPreview = await prepareDirect(profiles.admin, view);
    expect(viewPreview).toMatchObject({actor: 'postgres', grantor: database});
    expect((await applyDirect(profiles.admin, viewPreview.token)).outcome).toBe('committed');
    expect((await member.query('SELECT id FROM "QA Privileges".report')).rows).toEqual([{id: 1}]);

    const partitioned = await object('partitioned');
    const plan = await prepareDirect(profiles.owner, partitioned);
    await owner.query('ALTER TABLE "QA Privileges".partitioned RENAME TO old_partitioned; CREATE TABLE "QA Privileges".partitioned(id int) PARTITION BY RANGE(id)');
    expect((await applyDirect(profiles.owner, plan.token)).outcome).toBe('notSent');
    await expect(member.query('SELECT id FROM "QA Privileges".partitioned')).rejects.toMatchObject({code: '42501'});
    await expect(member.query('SELECT id FROM "QA Privileges".old_partitioned')).rejects.toMatchObject({code: '42501'});
    const replacement = await prepareDirect(profiles.owner, await object('partitioned'));
    expect((await applyDirect(profiles.owner, replacement.token)).outcome).toBe('committed');
    expect((await member.query('SELECT id FROM "QA Privileges".partitioned')).rows).toEqual([]);
    expect((await applyDirect(profiles.owner, replacement.token)).outcome).toBe('notSent');
    await quitDesktop();
  } finally { await Promise.all([member.end(), owner.end(), admin.end()]); }
});

test('PostgreSQL 数据库和 Schema 直接授权控制新登录与对象访问', async ({}, info) => {
  const owner = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '';
  const adminPassword = process.env.DBARK_PG_ROLES_ADMIN_PASSWORD ?? '';
  const port = Number(process.env.DBARK_PGSEARCH_PORT), token = /^tabrelio_pgsearch_([a-f0-9]{12})$/.exec(owner)?.[1];
  if (!token || process.env.DBARK_INTEGRATION_ENABLED !== '1' || ![password, adminPassword].every(value => /^[a-f0-9]{64}$/.test(value)) ||
      !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮独占回环 PostgreSQL');
  const prefix = 'tabrelio_roles_' + token + '_', recipient = prefix + 'recipient', dependent = prefix + 'dependent';
  const database = 'ACL ' + token, db = '"' + database + '"', schema = 'Scope "QA"', ns = '"Scope ""QA"""';
  const endpoint = {host: '127.0.0.1', port, connectionTimeoutMillis: 3000};
  const admin = new Client({...endpoint, database: owner, user: 'postgres', password: adminPassword});
  const directOwner = new Client({...endpoint, database, user: owner, password});
  const member = new Client({...endpoint, database, user: recipient, password});
  const fresh = async () => {
    const client = new Client({...endpoint, database, user: recipient, password});
    try {await client.connect(); return (await client.query('SELECT current_user::text')).rows[0].current_user;}
    finally {await client.end();}
  };
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${db} OWNER ${owner}`);
    await admin.query(`REVOKE CONNECT ON DATABASE ${db} FROM PUBLIC`);
    await directOwner.connect();
    await directOwner.query(`CREATE SCHEMA ${ns}; CREATE TABLE ${ns}.data(id int); INSERT INTO ${ns}.data VALUES (7);
      GRANT SELECT ON ${ns}.data TO ${recipient}; CREATE SCHEMA stale`);
    await expect(fresh()).rejects.toMatchObject({code: '42501'});
    const role = (await admin.query('SELECT oid::text,rolname::text AS name FROM pg_catalog.pg_roles WHERE rolname=$1', [recipient])).rows[0];
    const databaseOid = (await admin.query('SELECT oid::text FROM pg_catalog.pg_database WHERE datname=$1', [database])).rows[0].oid;
    const schemaOid = async (name: string) => (await directOwner.query('SELECT oid::text FROM pg_catalog.pg_namespace WHERE nspname=$1', [name])).rows[0].oid;
    const acl = async (kind: 'database' | 'schema', object: string) => {
      const source = kind === 'database' ? 'pg_database c CROSS JOIN LATERAL pg_catalog.aclexplode(c.datacl) acl'
        : 'pg_namespace c CROSS JOIN LATERAL pg_catalog.aclexplode(c.nspacl) acl';
      return (await directOwner.query(`SELECT acl.privilege_type,acl.is_grantable,pg_catalog.pg_get_userbyid(acl.grantor)::text AS grantor
        FROM pg_catalog.${source} WHERE c.oid=$1 AND acl.grantee=$2 ORDER BY 1`, [object, role.oid])).rows;
    };
    const edge = (privilege_type: string, is_grantable: boolean, grantor = owner) => ({privilege_type, is_grantable, grantor});
    const profiles = await page.evaluate(async ({port, database, owner, password, recipient}) => {
      const base = {id: '', dialect: 'postgresql' as const, group: '', color: '#123456', host: '127.0.0.1', port,
        database, rememberPassword: false, password};
      const add = (name: string, user: string) => window.dbark.invoke('connections.save', {...base, name, user});
      return {owner: (await add('数据库权限所有者', owner)).id, member: (await add('数据库权限受权者', recipient)).id};
    }, {port, database, owner, password, recipient});
    await page.reload();
    await expect.poll(() => desktop.evaluate(({Menu}) => Menu.getApplicationMenu()?.getMenuItemById('postgres-roles')?.enabled)).toBe(true);
    await desktop.evaluate(({Menu, BrowserWindow}) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById('postgres-roles'), [owner, extra] = BrowserWindow.getAllWindows();
      if (!item?.enabled || !owner || extra) throw Error('原生工具菜单或窗口不匹配');
      item.click(item, owner, {} as Electron.KeyboardEvent);
    });
    const modal = page.getByRole('dialog', {name: t.title, exact: true});
    await modal.getByLabel(t.connection, {exact: true}).selectOption(profiles.owner);
    await modal.getByLabel(t.search, {exact: true}).fill(recipient);
    await modal.getByRole('button', {name: t.read, exact: true}).click();
    await modal.getByRole('region', {name: t.directory, exact: true}).getByRole('button', {name: recipient, exact: true}).click();
    const common = t.tablePrivileges, dbText = common.database, schemaText = common.schema;
    const prepare = async (kind: 'database' | 'schema', action: string, privileges: string[]) => {
      const copy = common[kind];
      await modal.getByRole('button', {name: copy.open, exact: true}).click();
      const dialog = page.getByRole('dialog', {name: copy.title, exact: true});
      await dialog.getByLabel(common.action, {exact: true}).selectOption(action);
      for (const name of privileges) await dialog.getByRole('checkbox', {name, exact: true}).check();
      await dialog.getByRole('button', {name: copy.preview, exact: true}).click();
      await expect(dialog.getByLabel(copy.sql, {exact: true})).toBeVisible();
      return dialog;
    };
    const apply = async (kind: 'database' | 'schema', dialog: Awaited<ReturnType<typeof prepare>>, outcome: 'committed' | 'rolledBack' = 'committed') => {
      await dialog.getByRole('checkbox', {name: common[kind].confirm, exact: true}).check();
      await dialog.getByRole('button', {name: common[kind].apply, exact: true}).click();
      await expect(dialog.getByRole(outcome === 'committed' ? 'status' : 'alert').filter({hasText: t.result[outcome]})).toBeVisible();
      await dialog.getByRole('button', {name: zh.common.close, exact: true}).click();
    };
    let dialog = await prepare('database', 'grantOption', ['CONNECT', 'TEMPORARY']);
    await expect(dialog.getByLabel(dbText.sql, {exact: true})).toHaveText(`GRANT CONNECT, TEMPORARY ON DATABASE ${db} TO "${recipient}" WITH GRANT OPTION`);
    expect(await acl('database', databaseOid)).toEqual([]);
    await expect(fresh()).rejects.toMatchObject({code: '42501'});
    await apply('database', dialog);
    await expect(fresh()).resolves.toBe(recipient);
    expect(await acl('database', databaseOid)).toEqual([edge('CONNECT', true), edge('TEMPORARY', true)]);
    await member.connect();
    await expect(member.query(`SELECT id FROM ${ns}.data`)).rejects.toMatchObject({code: '42501'});

    await modal.getByLabel(t.schema, {exact: true}).fill(schema);
    await modal.getByRole('button', {name: t.probe, exact: true}).click();
    dialog = await prepare('schema', 'grantOption', ['USAGE', 'CREATE']);
    await expect(dialog.getByLabel(schemaText.sql, {exact: true})).toHaveText(`GRANT USAGE, CREATE ON SCHEMA ${ns} TO "${recipient}" WITH GRANT OPTION`);
    await dialog.screenshot({path: info.outputPath('PostgreSQL Schema 权限预览.png')});
    await apply('schema', dialog);
    const scopeOid = await schemaOid(schema);
    expect(await acl('schema', scopeOid)).toEqual([edge('CREATE', true), edge('USAGE', true)]);
    expect((await member.query(`SELECT id FROM ${ns}.data`)).rows).toEqual([{id: 7}]);
    await member.query(`GRANT USAGE ON SCHEMA ${ns} TO ${dependent}`);
    await apply('schema', await prepare('schema', 'revoke', ['CREATE', 'USAGE']), 'rolledBack');
    expect(await acl('schema', scopeOid)).toEqual([edge('CREATE', true), edge('USAGE', true)]);
    await member.query(`REVOKE USAGE ON SCHEMA ${ns} FROM ${dependent}`);
    await apply('schema', await prepare('schema', 'revokeOption', ['USAGE']));
    expect(await acl('schema', scopeOid)).toEqual([edge('CREATE', true), edge('USAGE', false)]);
    await apply('schema', await prepare('schema', 'revoke', ['USAGE']));
    expect(await acl('schema', scopeOid)).toEqual([edge('CREATE', true)]);
    await expect(member.query(`SELECT id FROM ${ns}.data`)).rejects.toMatchObject({code: '42501'});

    const prepareDirect = (connectionId: string, oid: string, name: string, privilege: 'USAGE' | 'CREATE') => page.evaluate(async draft =>
      window.dbark.invoke('postgres.roles.scopedPrivileges.preview', draft),
      {connectionId, database, role, object: {kind: 'schema' as const, oid, name}, action: 'grant' as const, privileges: [privilege]});
    const confirmDirect = (token: string, table = false) => page.evaluate(async ({token, table, connectionId, database}) =>
      window.dbark.invoke(table ? 'postgres.roles.tablePrivileges.apply' : 'postgres.roles.scopedPrivileges.apply',
        {connectionId, database, token, confirmed: true}), {token, table, connectionId: profiles.owner, database});
    const publicOid = await schemaOid('public');
    await expect(prepareDirect(profiles.member, publicOid, 'public', 'CREATE')).rejects.toThrow('只有对象所有者或超级用户');
    const publicPreview = await prepareDirect(profiles.owner, publicOid, 'public', 'CREATE');
    expect(publicPreview.grantor).toBe('pg_database_owner');
    expect((await confirmDirect(publicPreview.token, true)).outcome).toBe('notSent');
    expect((await confirmDirect(publicPreview.token)).outcome).toBe('committed');
    expect(await acl('schema', publicOid)).toEqual([edge('CREATE', false, 'pg_database_owner')]);
    await member.query('CREATE TABLE public.acl_qa(id int); DROP TABLE public.acl_qa');

    const staleOid = await schemaOid('stale');
    const stale = await prepareDirect(profiles.owner, staleOid, 'stale', 'USAGE');
    await directOwner.query('ALTER SCHEMA stale RENAME TO old_stale; CREATE SCHEMA stale');
    expect((await confirmDirect(stale.token)).outcome).toBe('notSent');
    expect(await acl('schema', staleOid)).toEqual([]);
    expect(await acl('schema', await schemaOid('stale'))).toEqual([]);

    await apply('database', await prepare('database', 'revoke', ['CONNECT']));
    expect(await acl('database', databaseOid)).toEqual([edge('TEMPORARY', true)]);
    expect((await member.query('SELECT 1 AS ready')).rows).toEqual([{ready: 1}]);
    await expect(fresh()).rejects.toMatchObject({code: '42501'});
    const effective = modal.getByRole('table', {name: t.databasePrivileges, exact: true});
    await expect(effective.getByRole('row', {name: /CONNECT/}).getByRole('cell')).toHaveText([t.no, t.no]);
    await expect.poll(() => page.evaluate(async () => (await window.dbark.invoke('tasks.list', {}))
      .filter(item => item.status === 'running').length)).toBe(0);
    await modal.getByRole('button', {name: zh.common.close, exact: true}).click();
    const native = desktop.process();
    await quitDesktop();
    expect(native.exitCode).toBe(0);
  } finally {await Promise.all([member.end(), directOwner.end(), admin.end()]);}
});
