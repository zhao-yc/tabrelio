import { readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Locator } from '@playwright/test';
import { confirmOwnedDesktopExit, dataDir, desktop, expect, page, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { clickSidebarAction } from './sidebar-menu';
import { sqliteObjectsZh as objects } from '../../src/renderer/locales/sqliteObjects.zh-CN';
import { viewQueryInspectZh as inspect } from '../../src/renderer/locales/viewQueryInspect.zh-CN';
import { viewSqlFileZh as fileText } from '../../src/renderer/locales/viewSqlFile.zh-CN';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });
test.skip(process.env.DBARK_SQLITE_VIEW_INSPECT_NATIVE !== '1', '需显式启用 SQLite 视图预览专项');

test('SQLite CREATE VIEW 草稿预览样本和原生计划，只在原确认流程写入', async ({}, info) => {
  if (process.env.DBARK_INTEGRATION_ENABLED !== '0' || process.env.DBARK_DEV_URL || process.env.DBARK_EXECUTABLE_PATH)
    throw Error('只允许本例源码和临时 SQLite 文件');
  const root = await realpath(dataDir), database = join(root, 'sample.sqlite'), source = join(root, 'view.sql');
  const view = '带"引号视图', quoted = '"带""引号视图"';
  const first = `CREATE VIEW main.${quoted} ("展示编号", [展示标记]) AS
WITH original AS (SELECT id, marker FROM main.sample_source)
SELECT id, marker FROM original ORDER BY id; -- 文件尾`;
  const next = `CREATE VIEW main.${quoted} ("展示编号", [展示标记]) AS
SELECT id, '替换样本' AS marker FROM main.sample_source WHERE id = 9007199254740993;`;

  async function choose(path: string, extension: 'sqlite' | 'sql') {
    await desktop.evaluate(({ dialog, BrowserWindow }, file) => {
      const original = dialog.showOpenDialog;
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        dialog.showOpenDialog = original;
        if (args[0] !== BrowserWindow.getAllWindows()[0] ||
            !(args.at(-1) as Electron.OpenDialogOptions).filters?.[0]?.extensions.includes(file.extension))
          throw Error('只允许本例准确原生文件选择');
        return { canceled: false, filePaths: [file.path] };
      }) as typeof original;
    }, { path, extension });
  }
  async function load(modal: Locator, replace = false) {
    await choose(source, 'sql');
    await modal.getByRole('button', { name: fileText.open, exact: true }).click();
    if (replace) await modal.getByRole('button', { name: fileText.confirmReplace, exact: true }).click();
  }
  async function change(modal: Locator, sql: string) {
    const editor = modal.locator('.monaco-editor').getByRole('textbox');
    await editor.focus();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText(sql);
    await expect(modal.locator('.monaco-editor .view-lines')).toContainText(sql.split('\n').at(-1)!);
  }
  function readView() {
    const db = new DatabaseSync(database, { readOnly: true });
    try {
      const statement = db.prepare('SELECT * FROM main.' + quoted + ' ORDER BY "展示编号" LIMIT 1');
      statement.setReadBigInts(true);
      return statement.get();
    } finally { db.close(); }
  }

  try {
    const fixture = new DatabaseSync(database);
    try {
      fixture.exec(`CREATE TABLE sample_source (id INTEGER PRIMARY KEY, marker TEXT);
        WITH RECURSIVE ids(i) AS (VALUES(0) UNION ALL SELECT i+1 FROM ids WHERE i<104)
        INSERT INTO sample_source SELECT 9007199254740993+i, CASE WHEN i=0 THEN '原样本' ELSE '其余' END FROM ids;`);
    } finally { fixture.close(); }
    const before = await readFile(database);
    await writeFile(source, first);
    await choose(database, 'sqlite');
    const connectionId = await page.evaluate(async () => {
      const id = 'sqlite-view-sample';
      const picked = await window.dbark.invoke('files.choose', { purpose: 'sqlite-database', sqliteConnectionId: id });
      if (!picked) throw Error('本例 SQLite 文件未获授权');
      const profile = await window.dbark.invoke('connections.save', { id, dialect: 'sqlite', name: '视图样本',
        group: '', color: '#123456', sqlite: { fileToken: picked.token, readOnly: false, busyTimeoutMs: 1000 } });
      return profile.id;
    });
    await page.reload();
    const node = page.locator('.connection-node').filter({ has: page.getByRole('button', { name: '视图样本', exact: true }) });
    await node.getByRole('button', { name: '视图样本', exact: true }).click();
    const main = node.locator('.database-row').filter({ has: page.getByRole('button', { name: 'main', exact: true }) });
    await main.locator('.tree-label').click();
    await expect(node.locator('.object-row').filter({ hasText: 'sample_source' })).toBeVisible();
    const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
    const beforeHistory = await history();
    const catalog = () => page.evaluate(connectionId => window.dbark.invoke('metadata.objects', { connectionId, database: 'main' }), connectionId);
    const region = (modal: Locator) => modal.getByRole('region', { name: inspect.region, exact: true });
    const action = (modal: Locator, label: string) => region(modal).getByRole('button', { name: label, exact: true }).click();
    async function open(kind: 'create' | 'replace') {
      if (kind === 'create') await clickSidebarAction(main, { name: objects.createView + ' main', exact: true });
      else await clickSidebarAction(node.locator('.object-row').filter({ hasText: view }), { name: objects.editDefinition + ' ' + view, exact: true });
      const modal = page.getByRole('dialog', { name: objects.title(kind, 'view'), exact: true });
      if (kind === 'create') await modal.getByLabel(objects.name, { exact: true }).fill(view);
      await modal.getByRole('button', { name: objects.read, exact: true }).click();
      await expect(modal.getByText(kind === 'create' ? objects.absent : objects.exists, { exact: true })).toBeVisible();
      return modal;
    }
    async function apply(modal: Locator, kind: 'create' | 'replace') {
      await modal.getByRole('button', { name: objects.preview, exact: true }).click();
      await expect(modal.getByLabel(objects.previewTitle)).toContainText(quoted);
      for (const item of await modal.getByRole('region', { name: objects.acknowledgements }).getByRole('checkbox').all()) await item.check();
      await modal.getByLabel(objects.confirmation, { exact: true }).fill('main.' + view);
      await modal.getByRole('button', { name: objects.apply[kind], exact: true }).click();
      await expect(modal.getByText(objects.committed, { exact: true })).toBeVisible();
      await modal.getByRole('button', { name: objects.close, exact: true }).click();
    }

    const create = await open('create');
    await expect(region(create).getByRole('button', { name: inspect.rows, exact: true })).toBeDisabled();
    await load(create);
    await action(create, inspect.rows);
    await expect(region(create).getByText(inspect.truncated(100), { exact: true })).toBeVisible();
    await expect(region(create).getByRole('columnheader', { name: '展示编号 INTEGER', exact: true })).toBeVisible();
    await expect(region(create).getByRole('gridcell', { name: '9007199254740993', exact: true })).toBeVisible();
    await expect(region(create).getByRole('gridcell', { name: '原样本', exact: true })).toBeVisible();
    await action(create, inspect.explain);
    await expect(region(create).getByRole('tree')).toContainText('sample_source');
    expect((await catalog()).some(item => item.name === view)).toBe(false);
    expect(await readFile(database)).toEqual(before);

    await change(create, `CREATE VIEW main.${quoted} AS SELECT 1; DELETE FROM sample_source;`);
    await action(create, inspect.rows);
    await expect(region(create).getByRole('alert')).toContainText('只接受一条');
    expect(await readFile(database)).toEqual(before);
    await load(create, true);
    await apply(create, 'create');
    expect(readView()).toMatchObject({ 展示编号: 9007199254740993n, 展示标记: '原样本' });

    await writeFile(source, next);
    const replacement = await open('replace');
    await load(replacement, true);
    await action(replacement, inspect.rows);
    await expect(region(replacement).getByRole('gridcell', { name: '替换样本', exact: true })).toBeVisible();
    expect(readView()).toMatchObject({ 展示标记: '原样本' });
    await apply(replacement, 'replace');
    expect(readView()).toMatchObject({ 展示编号: 9007199254740993n, 展示标记: '替换样本' });
    expect(await history()).toEqual(beforeHistory);
    expect((await readFile(source)).toString()).toBe(next);
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  }
});
