import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { NetworkConnectionProfile, PostgresConnectionProfile } from '../../src/shared/contracts';
import { tableElementsZh as text } from '../../src/renderer/locales/tableElements.zh-CN';
import { tablePresetsZh } from '../../src/renderer/locales/tablePresets.zh-CN';
import { sidebarContextMenuZh } from '../../src/renderer/locales/sidebarContextMenu.zh-CN';
import { confirmOwnedDesktopExit, dataDir, desktop, expect, page, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { clickSidebarAction } from './sidebar-menu';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });

test('在原生对象树查看字段、索引和复合外键', async ({}, info) => {
  const dialect = process.env.DBARK_TREE_ELEMENTS_DIALECT;
  test.skip(!dialect, '需显式启用表结构子节点专项');
  const sqlite = dialect === 'sqlite', postgres = dialect === 'postgresql';
  const database = sqlite ? 'main' : process.env.DBARK_TREE_ELEMENTS_DATABASE ?? '';
  const password = process.env.DBARK_TREE_ELEMENTS_PASSWORD ?? '', port = Number(process.env.DBARK_TREE_ELEMENTS_PORT);
  if (process.env.DBARK_EXECUTABLE_PATH || process.env.DBARK_DEV_URL || (sqlite ? process.env.DBARK_INTEGRATION_ENABLED !== '0' :
    process.env.DBARK_INTEGRATION_ENABLED !== '1' || !['mysql', 'mariadb', 'postgresql'].includes(dialect!) ||
    !/^tabrelio_te_[a-f0-9]{12}$/.test(database) || !/^[a-f0-9]{64}$/.test(password) ||
    !Number.isInteger(port) || port <= 1024 || port > 65535)) throw Error('只允许本例源码与独占数据库');
  const profile: NetworkConnectionProfile | PostgresConnectionProfile | undefined = sqlite ? undefined : {
    id: '', dialect: dialect as NetworkConnectionProfile['dialect'] | 'postgresql', name: dialect!, group: '', color: '#123456',
    host: '127.0.0.1', port, database, user: database, password, rememberPassword: false,
  };
  const file = join(await realpath(dataDir), '侧栏表结构.sqlite');
  try {
    if (sqlite) {
      const db = new DatabaseSync(file);
      try {
        db.exec(`CREATE TABLE parent_catalog(scope_id INTEGER, id INTEGER, PRIMARY KEY(scope_id,id));
          INSERT INTO parent_catalog VALUES (7,1);
          CREATE TABLE a_small(id INTEGER PRIMARY KEY, scope_id INTEGER, parent_id INTEGER, marker TEXT,
            derived INTEGER GENERATED ALWAYS AS (id+scope_id) STORED,
            FOREIGN KEY(scope_id,parent_id) REFERENCES parent_catalog);
          INSERT INTO a_small(id,scope_id,parent_id,marker) VALUES (1,7,1,'catalog-marker');
          CREATE INDEX idx_parent_pair ON a_small(scope_id,parent_id) WHERE parent_id>0;
          CREATE VIEW visible_view AS SELECT id FROM a_small;`);
      } finally { db.close(); }
      await desktop.evaluate(({ BrowserWindow, dialog }, path) => {
        const original = dialog.showOpenDialog;
        dialog.showOpenDialog = (async (...args: unknown[]) => {
          dialog.showOpenDialog = original;
          if (args[0] !== BrowserWindow.getAllWindows()[0] ||
              !(args.at(-1) as Electron.OpenDialogOptions).filters?.[0]?.extensions.includes('sqlite')) {
            throw Error('只允许当前窗口选择本例 SQLite 文件');
          }
          return { canceled: false, filePaths: [path] };
        }) as typeof original;
      }, file);
    }
    const before = sqlite ? await readFile(file) : undefined;
    const connectionId = await page.evaluate(async ({ profile, database, dialect }) => {
      const id = 'table-elements-sqlite';
      const picked = profile ? undefined : await window.dbark.invoke('files.choose', { purpose: 'sqlite-database', sqliteConnectionId: id });
      if (!profile && !picked) throw Error('缺少本例 SQLite 文件授权');
      const saved = await window.dbark.invoke('connections.save', profile ?? { id, dialect: 'sqlite', name: dialect!, group: '',
        color: '#123456', sqlite: { fileToken: picked!.token, readOnly: true, busyTimeoutMs: 1000 } });
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, sidebarWidth: 300, activeTabId: 'original', tabs: [
        { id: 'original', title: '原查询草稿', kind: 'query', connectionId: saved.id, database, sql: 'SELECT 123;' },
      ] });
      return saved.id;
    }, { profile, database, dialect });
    await page.reload();
    const settings = () => page.evaluate(() => window.dbark.invoke('settings.get', {}));
    const originalTabs = (await settings()).tabs;

    const tree = page.locator('.sidebar');
    const key = (values: (string | null)[]) => '[data-sidebar-node=' + JSON.stringify(JSON.stringify(values)) + ']';
    await tree.locator(key([connectionId, null, 'connection', null])).locator('.tree-label').click();
    const databaseRow = tree.locator(key([connectionId, database, 'database', null]));
    await databaseRow.locator('.tree-label').click();
    const name = postgres ? '"public"."a_small"' : 'a_small';
    const row = tree.locator(key([connectionId, database, 'table', name]));
    const view = tree.locator(key([connectionId, database, 'view', postgres ? '"public"."visible_view"' : 'visible_view']));
    await expect(view).toBeVisible();
    await expect(view.locator('.table-elements-toggle')).toHaveCount(0);
    const branch = tree.getByRole('group', { name: text.branch(name), exact: true });
    const expand = row.getByRole('button', { name: text.expand(name), exact: true });
    const collapse = row.getByRole('button', { name: text.collapse(name), exact: true });
    await expect(branch).toHaveCount(0);
    await expand.press('Enter');
    const fields = branch.getByRole('group', { name: text.columns, exact: true });
    await expect(fields.getByRole('listitem')).toHaveCount(5);
    await expect(fields.getByRole('listitem').filter({ hasText: /^id/ }).locator('svg')).toHaveAttribute('aria-label', text.primary);
    await expect(fields.getByRole('listitem').filter({ hasText: 'derived' })).toContainText(text.generated);

    await branch.getByRole('button', { name: new RegExp('^' + text.indexes) }).press('Space');
    const index = branch.getByRole('group', { name: text.indexes, exact: true }).getByRole('listitem').filter({ hasText: 'idx_parent_pair' });
    await expect(index).toBeVisible();
    if (sqlite) await expect(index).toContainText(text.partial);
    await branch.getByRole('button', { name: new RegExp('^' + text.foreignKeys) }).click();
    const foreign = branch.getByRole('group', { name: text.foreignKeys, exact: true }).locator('details');
    await expect(foreign).toHaveCount(1);
    await expect(foreign.locator('summary')).toHaveText(sqlite ? text.ordinal(0) : 'fk_parent_pair');
    await foreign.locator('summary').press('Enter');
    await expect(foreign.getByText(/parent_catalog/)).toBeVisible();
    await expect(foreign.getByText('scope_id → ' + (sqlite ? text.implicitPrimary : 'scope_id'), { exact: true })).toBeVisible();
    await expect(foreign.getByText('parent_id → ' + (sqlite ? text.implicitPrimary : 'id'), { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('对象树结构子节点.png') });
    expect((await settings()).tabs).toEqual(originalTabs);

    const splitter = await page.locator('.vertical-resize').boundingBox();
    if (!splitter) throw Error('侧栏宽度手柄不可用');
    const y = splitter.y + splitter.height / 2;
    await page.mouse.move(splitter.x + splitter.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(splitter.x - 140, y);
    await page.mouse.up();
    await expect.poll(() => tree.evaluate(node => node.clientWidth)).toBe(180);
    expect(await tree.locator('.tree-scroll').evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
    await expect(foreign.getByText(/parent_catalog/)).toBeVisible();
    await page.screenshot({ path: info.outputPath('最窄侧栏结构.png') });

    const presets = row.getByRole('button', { name: tablePresetsZh.treeExpand(name), exact: true });
    await presets.click();
    const presetBranch = tree.getByRole('group', { name: tablePresetsZh.treeExpand(name), exact: true });
    await expect(presetBranch.getByText(tablePresetsZh.treeEmpty, { exact: true })).toBeVisible();
    await expect(branch).toBeVisible();
    await collapse.press('Space');
    await expect(branch).toHaveCount(0);
    await expect(presetBranch).toBeVisible();
    await expand.click();
    await expect(fields.getByText('derived', { exact: true })).toBeVisible();

    await clickSidebarAction(row, { name: sidebarContextMenuZh.refreshObject(name), exact: true });
    await expect(branch).toHaveCount(0);
    await expand.click();
    await expect(fields.getByText('derived', { exact: true })).toBeVisible();
    const rowLabel = row.locator('.tree-label');
    if (sqlite) await rowLabel.dblclick(); else await rowLabel.click();
    await expect(page.getByRole('gridcell', { name: 'catalog-marker', exact: true }).first()).toBeVisible();
    expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
    expect(pageErrors).toEqual([]);
    if (before) expect(await readFile(file)).toEqual(before);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  }
});
