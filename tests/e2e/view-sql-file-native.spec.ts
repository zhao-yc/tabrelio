import { readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Locator } from '@playwright/test';
import { confirmOwnedDesktopExit, dataDir, desktop, expect, page, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { clickSidebarAction } from './sidebar-menu';
import { postgresCreateViewZh as pg } from '../../src/renderer/locales/postgresCreateView.zh-CN';
import { postgresViewEditZh as edit } from '../../src/renderer/locales/postgresViewEdit.zh-CN';
import { postgresStructureZh as structure } from '../../src/renderer/locales/postgresStructure.zh-CN';
import { sqliteObjectsZh as sqlite } from '../../src/renderer/locales/sqliteObjects.zh-CN';
import { viewSqlFileZh as text } from '../../src/renderer/locales/viewSqlFile.zh-CN';
import type { PostgresConnectionProfile } from '../../src/shared/contracts';

const dialect = process.env.DBARK_VIEW_FILE_DIALECT;
test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });
test.skip(!dialect, '需显式启用视图 SQL 文件专项');

test('载入文件只改变视图草稿，预览后由明确确认创建或替换', async ({}, info) => {
  const local = dialect === 'sqlite', database = local ? 'main' : process.env.DBARK_VIEW_FILE_DATABASE ?? '';
  const password = process.env.DBARK_VIEW_FILE_PASSWORD ?? '', port = Number(process.env.DBARK_VIEW_FILE_PORT);
  if (process.env.DBARK_DEV_URL || process.env.DBARK_EXECUTABLE_PATH ||
      (local ? process.env.DBARK_INTEGRATION_ENABLED !== '0' :
        dialect !== 'postgresql' || process.env.DBARK_INTEGRATION_ENABLED !== '1' ||
        !/^tabrelio_js_[a-f0-9]{12}$/.test(database) || !/^[a-f0-9]{64}$/.test(password) ||
        !Number.isInteger(port) || port <= 1024 || port > 65535)) throw Error('只允许本例源码与隔离数据库');
  const root = await realpath(dataDir), sqliteFile = join(root, 'view-file.sqlite');
  const profile: PostgresConnectionProfile | undefined = local ? undefined : { id: '', dialect: 'postgresql', name: dialect!,
    group: '', color: '#123456', host: '127.0.0.1', port, database, user: database, password, rememberPassword: false };
  const name = 'view_file_subject', materializedName = 'view_file_materialized';
  const sqlFor = (marker: string) => local
    ? `CREATE VIEW main."${name}" AS SELECT '${marker}' AS marker;`
    : `SELECT '${marker}'::text AS marker;`;
  const first = sqlFor('文件原定义'), second = sqlFor('文件新定义');
  const valid = join(root, 'view-valid.sql'), changed = join(root, 'view-changed.sql'), invalid = join(root, 'view-invalid.sql');
  const batch = join(root, 'view-batch.sql');
  const invalidSql = local ? 'CREATE VIEW wrong_target AS SELECT 1;' : 'SELECT 1; DROP VIEW ignored;';
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(first, 'utf16le')]);

  /** 只替换本例窗口的一次原生选取，仍由 Main 执行原文件能力和真实编码读取。 */
  async function picker(filePath: string | null, extension: 'sqlite' | 'sql') {
    await desktop.evaluate(({ BrowserWindow, dialog }, choice) => {
      const original = dialog.showOpenDialog;
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        dialog.showOpenDialog = original;
        if (args[0] !== BrowserWindow.getAllWindows()[0] ||
            !(args.at(-1) as Electron.OpenDialogOptions).filters?.[0]?.extensions.includes(choice.extension))
          throw Error('只能使用本窗口本次文件选择');
        return choice.filePath ? { canceled: false, filePaths: [choice.filePath] } : { canceled: true, filePaths: [] };
      }) as typeof original;
    }, { filePath, extension });
  }
  async function load(scope: Locator, filePath: string | null, confirm?: boolean) {
    await picker(filePath, 'sql');
    const button = scope.getByRole('button', { name: text.open, exact: true });
    await button.click();
    await expect(button).toBeEnabled();
    if (confirm !== undefined) {
      await expect(scope.getByText(text.replace, { exact: true })).toBeVisible();
      await scope.getByRole('button', { name: confirm ? text.confirmReplace : text.keep, exact: true }).click();
    }
  }

  try {
    await writeFile(valid, utf16);
    await writeFile(changed, second);
    await writeFile(invalid, invalidSql);
    await writeFile(batch, first + '\nDROP VIEW ignored;');
    if (local) { new DatabaseSync(sqliteFile).close(); await picker(sqliteFile, 'sqlite'); }
    const connectionId = await page.evaluate(async profile => {
      const id = 'view-file-sqlite';
      const picked = profile ? undefined : await window.dbark.invoke('files.choose', { purpose: 'sqlite-database', sqliteConnectionId: id });
      if (!profile && !picked) throw Error('本例 SQLite 文件未授权');
      const saved = await window.dbark.invoke('connections.save', profile ?? { id, dialect: 'sqlite', name: 'sqlite',
        group: '', color: '#123456', sqlite: { fileToken: picked!.token, readOnly: false, busyTimeoutMs: 1000 } });
      return saved.id;
    }, profile);
    await page.reload();
    const node = page.locator('.connection-node').filter({ has: page.getByRole('button', { name: dialect!, exact: true }) });
    await node.getByRole('button', { name: dialect!, exact: true }).click();
    const db = node.locator('.database-row').filter({ has: page.getByRole('button', { name: database, exact: true }) });
    await db.locator('.tree-label').click();
    const catalog = () => page.evaluate(async target => (await window.dbark.invoke('metadata.objects', target))
      .filter(object => object.kind === 'view').map(object => object.name), { connectionId, database });
    const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
    const previousHistory = await history();
    const before = await catalog();

    if (local) {
      async function open(action: 'create' | 'replace') {
        if (action === 'create') await clickSidebarAction(db, { name: sqlite.createView + ' main', exact: true });
        else await clickSidebarAction(node.locator('.object-row').filter({ hasText: name }),
          { name: sqlite.editDefinition + ' ' + name, exact: true });
        const modal = page.getByRole('dialog', { name: sqlite.title(action, 'view'), exact: true });
        if (action === 'create') await modal.getByLabel(sqlite.name, { exact: true }).fill(name);
        await modal.getByRole('button', { name: sqlite.read, exact: true }).click();
        await expect(modal.getByText(action === 'create' ? sqlite.absent : sqlite.exists, { exact: true })).toBeVisible();
        return modal;
      }
      async function preview(modal: Locator, sql: string) {
        await modal.getByRole('button', { name: sqlite.preview, exact: true }).click();
        await expect(modal.getByLabel(sqlite.previewTitle)).toContainText(sql);
      }
      async function apply(modal: Locator, action: 'create' | 'replace') {
        const acknowledgements = modal.getByRole('region', { name: sqlite.acknowledgements }).getByRole('checkbox');
        for (const item of await acknowledgements.all()) await item.check();
        await modal.getByLabel(sqlite.confirmation, { exact: true }).fill('main.' + name);
        await modal.getByRole('button', { name: sqlite.apply[action], exact: true }).click();
        await expect(modal.getByText(sqlite.committed, { exact: true })).toBeVisible();
        await modal.getByRole('button', { name: sqlite.close, exact: true }).click();
      }
      function marker() {
        const db = new DatabaseSync(sqliteFile, { readOnly: true });
        try { return db.prepare('SELECT marker FROM main.' + name).get()?.marker; }
        finally { db.close(); }
      }
      const create = await open('create');
      await load(create, null);
      await expect(create.getByRole('button', { name: sqlite.preview, exact: true })).toBeDisabled();
      await load(create, invalid);
      await expect(create.getByText(text.sqliteTarget, { exact: true })).toBeVisible();
      await load(create, batch);
      await expect(create.getByText(text.sqliteTarget, { exact: true })).toBeVisible();
      await load(create, valid);
      await preview(create, first);
      expect(await catalog()).toEqual(before);
      await apply(create, 'create');
      expect(marker()).toBe('文件原定义');
      const replacement = await open('replace');
      await load(replacement, changed, false);
      // SQLite 目录去掉了 CREATE 头中的 main 限定和结束分号。
      await preview(replacement, first.replace('CREATE VIEW main.', 'CREATE VIEW ').replace(/;$/, ''));
      await load(replacement, changed, true);
      await preview(replacement, second);
      expect(marker()).toBe('文件原定义');
      await apply(replacement, 'replace');
      expect(marker()).toBe('文件新定义');
    } else {
      async function open(materialized = false) {
        const title = materialized ? pg.materializedTitle : pg.title;
        await clickSidebarAction(db, { name: title, exact: true });
        const modal = page.getByRole('dialog', { name: title, exact: true });
        await modal.getByLabel(pg.schema, { exact: true }).selectOption('public');
        await modal.getByLabel(materialized ? pg.materializedName : pg.name, { exact: true }).fill(materialized ? materializedName : name);
        return modal;
      }
      const modal = await open();
      const query = modal.getByRole('textbox', { name: pg.definition, exact: true });
      await load(modal, null);
      await expect(query).toHaveValue('');
      await load(modal, invalid);
      await expect(modal.getByText(/视图定义须为单条/)).toBeVisible();
      await expect(query).toHaveValue('');
      await load(modal, valid);
      await expect(query).toHaveValue(first);
      await modal.getByRole('button', { name: pg.preview, exact: true }).click();
      await expect(modal.locator('.pg-create-sql')).toContainText('文件原定义');
      expect(await catalog()).toEqual(before);
      await modal.getByRole('button', { name: pg.apply, exact: true }).click();
      await expect(modal).toBeHidden();

      const grid = page.locator('.postgres-table-tab:visible').getByRole('grid');
      await expect(grid.getByRole('gridcell', { name: '文件原定义', exact: true })).toBeVisible();
      await page.locator('.postgres-table-tab:visible').getByRole('button', { name: structure.open, exact: true }).click();
      const inspection = page.getByRole('dialog', { name: structure.title, exact: true });
      await inspection.getByRole('button', { name: structure.sections.definition, exact: true }).click();
      await inspection.getByRole('button', { name: edit.title, exact: true }).click();
      const panel = inspection.getByRole('region', { name: edit.title, exact: true });
      await load(panel, changed, false);
      await expect(panel.getByRole('textbox', { name: edit.definition, exact: true })).toHaveValue(/文件原定义/);
      await load(panel, changed, true);
      await panel.getByRole('button', { name: edit.preview, exact: true }).click();
      await expect(panel.locator('pre')).toContainText('文件新定义');
      await expect(grid.getByRole('gridcell', { name: '文件原定义', exact: true })).toBeVisible();
      await panel.getByRole('button', { name: edit.apply, exact: true }).click();
      await expect(panel).toBeHidden();
      await inspection.locator('.modal-footer').getByRole('button', { name: structure.close, exact: true }).click();
      await expect(grid.getByRole('gridcell', { name: '文件新定义', exact: true })).toBeVisible();

      const mat = await open(true);
      await load(mat, valid);
      await mat.getByLabel(pg.populate).uncheck();
      await mat.getByRole('button', { name: pg.preview, exact: true }).click();
      await expect(mat.locator('.pg-create-sql')).toContainText('WITH NO DATA');
      expect((await catalog()).some(item => item.includes(materializedName))).toBe(false);
      await mat.getByRole('button', { name: pg.materializedApply, exact: true }).click();
      await expect(mat).toBeHidden();
      await expect.poll(async () => (await catalog()).some(item => item.includes(materializedName))).toBe(true);
      const materialized = await page.evaluate(target => window.dbark.invoke('postgres.structure.read', target),
        { connectionId, database, table: '"public"."' + materializedName + '"' });
      expect(materialized).toMatchObject({ kind: 'm', materialized: { populated: false } });
    }
    expect(await history()).toEqual(previousHistory);
    expect(await readFile(valid)).toEqual(utf16);
    expect((await readFile(changed)).toString('utf8')).toBe(second);
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  }
});
