import { readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import mysql, { type RowDataPacket } from 'mysql2/promise';
import type { Locator } from '@playwright/test';
import { confirmOwnedDesktopExit, dataDir, desktop, expect, page, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { clickSidebarAction } from './sidebar-menu';
import { viewSqlFileZh as text } from '../../src/renderer/locales/viewSqlFile.zh-CN';
import { formatText, zh } from '../../src/renderer/locales/zh-CN';
import type { NetworkConnectionProfile } from '../../src/shared/contracts';

const dialect = process.env.DBARK_MYSQL_VIEW_FILE_DIALECT;
test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });
test.skip(!dialect, '需显式启用 MySQL 或 MariaDB 视图文件专项');

test('载入 SELECT 后创建视图或替换原查询，保留已有视图属性', async ({}, info) => {
  const database = process.env.DBARK_MYSQL_VIEW_FILE_DATABASE ?? '', password = process.env.DBARK_MYSQL_VIEW_FILE_PASSWORD ?? '';
  const port = Number(process.env.DBARK_MYSQL_VIEW_FILE_PORT);
  if (process.env.DBARK_DEV_URL || process.env.DBARK_EXECUTABLE_PATH || process.env.DBARK_INTEGRATION_ENABLED !== '1' ||
      (dialect !== 'mysql' && dialect !== 'mariadb') || !/^tabrelio_js_[a-f0-9]{12}$/.test(database) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535)
    throw Error('只允许本例源码和隔离回环数据库');
  const root = await realpath(dataDir), valid = join(root, 'view-definition.sql'), invalid = join(root, 'view-batch.sql');
  const old = '旧` 视图', fresh = '新` 视图', renamed = '新` 视图改名';
  const quote = (value: string) => '`' + value.replaceAll('`', '``') + '`';
  const target = (name: string) => quote(database) + '.' + quote(name);
  const profile: NetworkConnectionProfile = { id: '', dialect, name: dialect, group: '', color: '#123456',
    host: '127.0.0.1', port, database, user: database, password, rememberPassword: false };
  const query = 'SELECT id, marker FROM ' + target('view_source') + ' WHERE id = 2 -- 文件尾注释';
  const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(query + '\n;', 'utf16le')]);
  const observer = await mysql.createConnection({ host: profile.host, port, database, user: database, password });

  const row = (name: string) => page.locator('.object-row').filter({ hasText: name });
  const showCreate = async (name: string) => {
    const [rows] = await observer.query<RowDataPacket[]>('SHOW CREATE VIEW ' + target(name));
    return rows[0]['Create View'] as string;
  };
  const values = async (name: string) => {
    const [rows] = await observer.query<RowDataPacket[]>('SELECT id, marker FROM ' + target(name));
    return rows.map(({ id, marker }) => [id, marker]);
  };
  async function load(modal: Locator, filePath: string, replace?: boolean) {
    await desktop.evaluate(({ dialog, BrowserWindow }, filePath) => {
      const original = dialog.showOpenDialog;
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        dialog.showOpenDialog = original;
        if (args[0] !== BrowserWindow.getAllWindows()[0] ||
            !(args.at(-1) as Electron.OpenDialogOptions).filters?.[0]?.extensions.includes('sql')) throw Error('只允许本例一次 SQL 文件选择');
        return { canceled: false, filePaths: [filePath] };
      }) as typeof original;
    }, filePath);
    const button = modal.getByRole('button', { name: text.open, exact: true });
    await button.click();
    await expect(button).toBeEnabled();
    if (replace !== undefined) await modal.getByRole('button', { name: replace ? text.confirmReplace : text.keep, exact: true }).click();
  }
  async function apply(modal: Locator, collision = false) {
    // 只应答这一次旧 DDL 确认，连接、任务和写入仍走真实应用。
    await page.evaluate(expected => {
      const original = window.confirm;
      window.confirm = message => {
        window.confirm = original;
        if (message !== expected) throw Error('只允许本例原结构确认');
        return true;
      };
    }, zh.schema.text054);
    await modal.getByRole('button', { name: zh.common.executeSql, exact: true }).click();
    if (collision) await expect(modal.getByRole('alert')).toContainText(/already exists/i);
    else await expect(modal).toBeHidden();
  }

  try {
    await writeFile(valid, bytes);
    await writeFile(invalid, 'SELECT 1; DROP VIEW ' + target(old) + ';');
    await observer.query('CREATE ALGORITHM=MERGE SQL SECURITY INVOKER VIEW ' + target(old) +
      ' AS SELECT id, marker FROM ' + target('view_source') + ' WHERE id=1 WITH LOCAL CHECK OPTION');
    const original = await showCreate(old);
    const attributes = 'ALGORITHM=MERGE DEFINER=' + quote(database) + '@`%` SQL SECURITY INVOKER';
    expect(original).toContain(attributes);
    expect(original).toMatch(/WITH LOCAL CHECK OPTION/i);
    expect(await values(old)).toEqual([[1, '原值']]);
    const connectionId = await page.evaluate(async profile => (await window.dbark.invoke('connections.save', profile)).id, profile);
    await page.reload();
    const node = page.locator('.connection-node').filter({ has: page.getByRole('button', { name: dialect, exact: true }) });
    const db = node.locator('.database-row').filter({ has: page.getByRole('button', { name: database, exact: true }) });
    async function expandDatabase() {
      const connection = node.getByRole('button', { name: dialect, exact: true });
      const database = db.locator('.tree-label');
      if (await connection.getAttribute('aria-expanded') !== 'true') await connection.click();
      if (await database.getAttribute('aria-expanded') !== 'true') await database.click();
    }
    await expandDatabase();

    const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
    const beforeHistory = await history();
    const catalog = () => page.evaluate(target => window.dbark.invoke('metadata.objects', target), { connectionId, database });
    const editor = (modal: Locator) => modal.locator('.monaco-editor .view-lines');

    await clickSidebarAction(db, { name: zh.sidebar.text019, exact: true });
    const create = page.getByRole('dialog', { name: zh.schema.text058, exact: true });
    await expect(create.getByRole('button', { name: text.open, exact: true })).toBeDisabled();
    const viewName = create.getByLabel(zh.schema.text059, { exact: true });
    await viewName.fill(fresh);
    await load(create, invalid);
    await expect(create.getByText(/SQL 文件须包含一条/)).toBeVisible();
    await load(create, valid, true);
    await expect(editor(create)).toContainText('文件尾注释');
    await viewName.fill(old);
    await apply(create, true);
    expect(await showCreate(old)).toBe(original);
    await viewName.fill(renamed);
    await expect(editor(create)).toContainText('CREATE VIEW ' + target(renamed));
    await expect(editor(create)).toContainText('文件尾注释');
    expect((await catalog()).some(item => item.name === fresh || item.name === renamed)).toBe(false);
    await apply(create);
    expect(await values(renamed)).toEqual([[2, '新值']]);

    await expandDatabase();
    await clickSidebarAction(row(old), { name: formatText(zh.sidebar.text022, old), exact: true });
    const edit = page.getByRole('dialog', { name: formatText(zh.schema.text057, '视图', old), exact: true });
    await expect(editor(edit)).toContainText(attributes);
    await load(edit, valid, false);
    await expect(editor(edit)).not.toContainText('文件尾注释');
    await load(edit, valid, true);
    await expect(editor(edit)).toContainText(attributes);
    await expect(editor(edit)).toContainText('文件尾注释');
    await expect(editor(edit)).toContainText(/WITH\s+LOCAL\s+CHECK\s+OPTION/i);
    expect(await showCreate(old)).toBe(original);
    await apply(edit);
    const updated = await showCreate(old);
    expect(updated).toContain(attributes);
    expect(updated).toMatch(/WITH LOCAL CHECK OPTION/i);
    expect(await values(old)).toEqual([[2, '新值']]);
    expect(await history()).toEqual(beforeHistory);
    expect(await readFile(valid)).toEqual(bytes);
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  } finally {
    await observer.end();
  }
});
