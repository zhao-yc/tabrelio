import mysql, { type RowDataPacket } from 'mysql2/promise';
import { confirmOwnedDesktopExit, expect, page, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { clickSidebarAction } from './sidebar-menu';
import { viewDependenciesZh as text } from '../../src/renderer/locales/viewDependencies.zh-CN';
import { formatText, zh } from '../../src/renderer/locales/zh-CN';
import type { NetworkConnectionProfile } from '../../src/shared/contracts';

const dialect = process.env.DBARK_MYSQL_VIEW_DEPENDENCIES_DIALECT;
test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });
test.skip(!dialect, '需显式启用 MySQL 或 MariaDB 视图依赖专项');

test('已保存视图显示可见的直接引用与被引用对象', async ({}, info) => {
  const database = process.env.DBARK_MYSQL_VIEW_DEPENDENCIES_DATABASE ?? '';
  const password = process.env.DBARK_MYSQL_VIEW_DEPENDENCIES_PASSWORD ?? '';
  const port = Number(process.env.DBARK_MYSQL_VIEW_DEPENDENCIES_PORT);
  if (process.env.DBARK_DEV_URL || process.env.DBARK_EXECUTABLE_PATH || process.env.DBARK_INTEGRATION_ENABLED !== '1' ||
      (dialect !== 'mysql' && dialect !== 'mariadb') || !/^tabrelio_js_[a-f0-9]{12}$/.test(database) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535)
    throw Error('只允许本例源码和隔离回环数据库');
  const linked = database + '_linked', name = '目标`视图', upstream = '数据`来源';
  const localView = '本库直接引用', crossView = '跨库直接引用', indirect = '间接引用';
  const quoted = (value: string) => '`' + value.replaceAll('`', '``') + '`';
  const target = (db: string, value: string) => quoted(db) + '.' + quoted(value);
  const profile: NetworkConnectionProfile = { id: '', dialect, name: dialect, group: '', color: '#123456',
    host: '127.0.0.1', port, database, user: database, password, rememberPassword: false };
  const observer = await mysql.createConnection({ host: profile.host, port, database, user: database, password });
  try {
    await observer.query('CREATE TABLE ' + target(linked, upstream) + ' (id INT PRIMARY KEY)');
    await observer.query('INSERT INTO ' + target(linked, upstream) + ' VALUES (41)');
    await observer.query('CREATE VIEW ' + target(database, name) + ' AS SELECT id FROM ' + target(linked, upstream));
    await observer.query('CREATE VIEW ' + target(database, localView) + ' AS SELECT id FROM ' + target(database, name));
    await observer.query('CREATE VIEW ' + target(linked, crossView) + ' AS SELECT id FROM ' + target(database, name));
    await observer.query('CREATE VIEW ' + target(database, indirect) + ' AS SELECT id FROM ' + target(database, localView));
    const original = async () => (await observer.query<RowDataPacket[]>('SHOW CREATE VIEW ' + target(database, name)))[0][0]['Create View'];
    const originalSql = await original();
    await page.evaluate(async profile => window.dbark.invoke('connections.save', profile), profile);
    await page.reload();
    const node = page.locator('.connection-node').filter({ has: page.getByRole('button', { name: dialect, exact: true }) });
    await node.getByRole('button', { name: dialect, exact: true }).click();
    const db = node.locator('.database-row').filter({ has: page.getByRole('button', { name: database, exact: true }) });
    await db.locator('.tree-label').click();
    const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
    const beforeHistory = await history();

    await clickSidebarAction(node.locator('.object-row').filter({ hasText: name }), { name: formatText(zh.sidebar.text022, name), exact: true });
    const dialog = page.getByRole('dialog', { name: formatText(zh.schema.text057, '视图', name), exact: true });
    const panel = dialog.getByRole('region', { name: text.title, exact: true });
    const editor = dialog.locator('.monaco-editor').getByRole('textbox');
    await expect(panel.getByRole('button', { name: text.read })).toBeEnabled();
    await editor.focus();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText('CREATE OR REPLACE VIEW ' + target(database, name) + ' AS SELECT 99 AS draft_marker;');
    await expect(dialog.locator('.monaco-editor .view-lines')).toContainText('draft_marker');
    await panel.getByRole('button', { name: text.read, exact: true }).click();
    await expect(panel.getByText(dialect === 'mysql' ? text.catalogue : text.definitions, { exact: true })).toBeVisible();
    const references = panel.getByRole('region', { name: text.referenced });
    await expect(references.locator('tbody tr')).toHaveCount(1);
    await expect(references.locator('tbody tr').first().getByRole('cell', { name: linked, exact: true })).toBeVisible();
    await expect(references.getByRole('cell', { name: upstream, exact: true })).toBeVisible();
    const dependants = panel.getByRole('region', { name: text.referencing });
    await expect(dependants.locator('tbody tr')).toHaveCount(2);
    await expect(dependants.getByRole('row').filter({ hasText: localView }).getByRole('cell', { name: database, exact: true })).toBeVisible();
    await expect(dependants.getByRole('row').filter({ hasText: crossView }).getByRole('cell', { name: linked, exact: true })).toBeVisible();
    await expect(dependants.getByText(indirect)).toHaveCount(0);
    const definition = panel.getByRole('region', { name: text.definitionTitle, exact: true });
    const ddl = definition.locator('.monaco-editor .view-lines');
    const close = definition.getByRole('button', { name: text.closeDefinition, exact: true });
    const openSource = references.getByRole('button', { name: text.openDefinition(linked, upstream), exact: true });
    const openConsumer = dependants.getByRole('button', { name: text.openDefinition(linked, crossView), exact: true });
    await openSource.click();
    await expect(definition.getByText(linked + ' / ' + upstream, { exact: true })).toBeVisible();
    await expect(ddl).toContainText('CREATE TABLE ' + quoted(upstream));
    await expect(ddl).toContainText('PRIMARY KEY');
    await close.click();
    await openConsumer.click();
    await expect(definition.getByText(linked + ' / ' + crossView, { exact: true })).toBeVisible();
    // 服务端可在跨库视图的定义里保留库名限定。
    await expect(ddl).toContainText(new RegExp('VIEW\\s+(?:' + quoted(linked) + '\\.)?' + quoted(crossView) + '\\s+AS\\b'));
    await close.click();
    await observer.query('DROP VIEW ' + target(linked, crossView));
    await observer.query('CREATE TABLE ' + target(linked, crossView) + ' (id INT)');
    await openConsumer.click();
    await expect(definition.getByText(text.kindChanged, { exact: true })).toBeVisible();
    await expect(ddl).toHaveCount(0);
    await close.click();
    await expect(dialog.locator('.monaco-editor .view-lines')).toContainText('draft_marker');
    expect(await original()).toBe(originalSql);
    expect(await history()).toEqual(beforeHistory);
    await dialog.getByRole('button', { name: zh.common.cancel, exact: true }).click();
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  } finally {
    await observer.end();
  }
});
