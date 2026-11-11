import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { navigationZh as text } from '../../src/renderer/locales/navigation.zh-CN';
import type { NetworkConnectionProfile, PostgresConnectionProfile } from '../../src/shared/contracts';
import { confirmOwnedDesktopExit, dataDir, desktop, expect, page, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });

test('在原生对象列表查看、配置并排序当前库的表详情', async ({}, info) => {
  const dialect = process.env.DBARK_OBJECT_DETAILS_DIALECT;
  test.skip(!dialect, '需显式启用对象详情专项');
  const sqlite = dialect === 'sqlite', postgres = dialect === 'postgresql';
  const database = sqlite ? 'main' : process.env.DBARK_OBJECT_DETAILS_DATABASE ?? '';
  const password = process.env.DBARK_OBJECT_DETAILS_PASSWORD ?? '', port = Number(process.env.DBARK_OBJECT_DETAILS_PORT);
  if (process.env.DBARK_EXECUTABLE_PATH || process.env.DBARK_DEV_URL || (sqlite ? process.env.DBARK_INTEGRATION_ENABLED !== '0' :
    process.env.DBARK_INTEGRATION_ENABLED !== '1' || !['mysql', 'mariadb', 'postgresql'].includes(dialect!) ||
    !/^tabrelio_od_[a-f0-9]{12}$/.test(database) || !/^[a-f0-9]{64}$/.test(password) ||
    !Number.isInteger(port) || port <= 1024 || port > 65535)) throw Error('只允许本例源码与独占数据库');
  const profile: NetworkConnectionProfile | PostgresConnectionProfile | undefined = sqlite ? undefined : {
    id: '', dialect: dialect as NetworkConnectionProfile['dialect'] | 'postgresql', name: dialect!, group: '', color: '#123456',
    host: '127.0.0.1', port, database, user: database, password, rememberPassword: false,
  };
  const file = join(await realpath(dataDir), '表详情.sqlite');
  try {
    if (sqlite) {
      const db = new DatabaseSync(file);
      try {
        db.exec(`CREATE TABLE a_small(id INTEGER PRIMARY KEY, marker TEXT);
          INSERT INTO a_small VALUES (1,'catalog-marker'),(2,'catalog-marker');
          CREATE INDEX full_index ON a_small(marker);
          CREATE TABLE z_large(id INTEGER PRIMARY KEY) STRICT, WITHOUT ROWID;
          INSERT INTO z_large VALUES (1),(2),(3),(4),(5),(6),(7),(8),(9),(10),(11),(12);
          CREATE TABLE m_unknown(id INTEGER PRIMARY KEY);
          INSERT INTO m_unknown VALUES (1),(2),(3);
          CREATE INDEX partial_index ON m_unknown(id) WHERE id=1;
          CREATE VIEW visible_view AS SELECT id FROM a_small;
          ANALYZE;
          DELETE FROM sqlite_stat1 WHERE tbl='m_unknown' AND idx IS NULL;`);
        expect(db.prepare('SELECT idx FROM sqlite_stat1 WHERE tbl=?').all('m_unknown')).toEqual([{ idx: 'partial_index' }]);
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
    const connectionId = await page.evaluate(async ({ profile, database }) => {
      const id = 'objects-details-sqlite';
      const picked = profile ? undefined : await window.dbark.invoke('files.choose', { purpose: 'sqlite-database', sqliteConnectionId: id });
      if (!profile && !picked) throw Error('缺少本例 SQLite 文件授权');
      const saved = await window.dbark.invoke('connections.save', profile ?? { id, dialect: 'sqlite', name: 'SQLite', group: '',
        color: '#123456', sqlite: { fileToken: picked!.token, readOnly: true, busyTimeoutMs: 1000 } });
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'objects', tabs: [
        { id: 'objects', title: '本库对象', kind: 'objects', connectionId: saved.id, database, objectCategory: 'table' },
      ] });
      return saved.id;
    }, { profile, database });
    await page.reload();

    const browser = page.locator('.object-browser:visible'), header = browser.locator('.object-browser-columns');
    const detailToggle = browser.getByRole('button', { name: text.tableDetails, exact: true });
    const row = (name: string, kind: 'table' | 'view' = 'table') => browser.locator('[data-sidebar-node=' +
      JSON.stringify(JSON.stringify([connectionId, database, kind, postgres ? '"public"."' + name + '"' : name])) + ']');
    const rows = browser.locator('.object-list-row');
    const sort = header.getByRole('button', { name: text.objectProperties.estimatedRows, exact: true });
    await expect(row('a_small')).toBeVisible();
    await expect(sort).toHaveCount(0);
    await detailToggle.click();
    await expect(row('a_small').getByText('≈ 2', { exact: true })).toBeVisible();
    await expect(row('z_large').getByText('≈ 12', { exact: true })).toBeVisible();
    if (sqlite || postgres) await expect(row('m_unknown').getByText('—', { exact: true })).toBeVisible();
    if (sqlite) await expect(row('z_large')).toContainText('WITHOUT ROWID · STRICT');
    if (postgres) {
      await expect(row('x_private')).toBeVisible();
      const privateDetails = await page.evaluate(async ({ connectionId, database }) =>
        (await window.dbark.invoke('metadata.objects', { connectionId, database, tableDetails: true }))
          .find(item => item.name === '"public"."x_private"')?.details, { connectionId, database });
      expect(privateDetails).toMatchObject({ schema: 'public', relation: 'ordinary' });
      expect(privateDetails?.dataBytes).toBeUndefined();
      expect(privateDetails?.estimatedRows).toBeUndefined();
    }
    await sort.click();
    await expect(rows.first()).toHaveAttribute('data-sidebar-node', (await row(sqlite || postgres ? 'a_small' : 'm_unknown').getAttribute('data-sidebar-node'))!);
    await sort.click();
    await expect(rows.first()).toContainText('z_large');
    await expect(rows.last()).toContainText(postgres ? 'x_private' : 'm_unknown');
    await expect(sort).toHaveAttribute('aria-description', text.sortDescending);
    await page.screenshot({ path: info.outputPath('按估算行数排序.png') });

    await browser.getByRole('button', { name: text.objectColumns, exact: true }).click();
    const columns = page.getByRole('dialog', { name: text.objectColumns, exact: true });
    await columns.getByRole('checkbox', { name: text.objectProperties.estimatedRows, exact: true }).uncheck();
    if (!sqlite) await columns.getByRole('checkbox', { name: text.objectProperties.comment, exact: true }).check();
    await columns.getByRole('button', { name: text.objectColumnsDone, exact: true }).click();
    await expect(sort).toHaveCount(0);
    if (!sqlite) await expect(row('a_small').getByText('目录备注', { exact: true })).toBeVisible();
    await expect(rows.first()).toContainText('a_small');
    await page.screenshot({ path: info.outputPath('自定义表详情列.png') });

    const category = browser.getByRole('combobox', { name: text.type, exact: true });
    await category.selectOption('view');
    await expect(row('visible_view', 'view')).toBeVisible();
    await expect(detailToggle).toHaveCount(0);
    await category.selectOption('table');
    await expect(detailToggle).toHaveAttribute('aria-pressed', 'true');
    await expect(row('a_small')).toBeVisible();
    await detailToggle.click();
    await row('a_small').locator('.tree-label').dblclick();
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
