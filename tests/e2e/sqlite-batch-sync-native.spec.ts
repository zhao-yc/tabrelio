import { mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { confirmOwnedDesktopExit, dataDir, expect, ownedDesktopResources, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';
import { sqliteZh } from '../../src/renderer/locales/sqlite.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import { dataCompareBatchZh as batch } from '../../src/renderer/locales/dataCompareBatch.zh-CN';
import { sqliteBatchSyncZh as batchSync } from '../../src/renderer/locales/sqliteBatchSync.zh-CN';
import { sqliteDataCompareZh as text, sqliteDataSyncZh as sync } from '../../src/shared/sqliteDataCompare';

test.skip(process.env.DBARK_SQLITE_BATCH_SYNC_NATIVE !== '1', '须显式启用 SQLite 多表同步专项');
test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' });

test('SQLite 同文件多表事务原子提交、冲突回滚与精确回执', async ({}, info) => {
  if (!['darwin', 'win32'].includes(process.platform) || info.config.workers !== 1 || info.retry ||
      process.env.DBARK_INTEGRATION_ENABLED !== '0' || ['DBARK_EXECUTABLE_PATH', 'DBARK_DEV_URL', 'DBARK_USER_DATA'].some(key => process.env[key]))
    throw Error('只允许隔离的源码 Electron SQLite 多表同步专项');
  const { page, application } = ownedDesktopResources(info);
  const own = () => { if (ownedDesktopResources(info).page !== page) throw Error('本例窗口归属已变化'); };
  const directory = join(dataDir, 'batch-sync-fixture'), left = join(directory, '来源.sqlite'), right = join(directory, '目标.sqlite');
  await mkdir(directory);
  const create = 'CREATE TABLE alpha(id INTEGER PRIMARY KEY, value TEXT); CREATE TABLE beta(id INTEGER PRIMARY KEY, value BLOB);';
  function edit(path: string, sql: string) {
    const db = new DatabaseSync(path);
    try { db.exec(sql); } finally { db.close(); }
  }
  function values(path: string) {
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      return [db.prepare('SELECT id, value FROM alpha ORDER BY id').all(),
        db.prepare('SELECT CAST(id AS TEXT) AS id, hex(value) AS value FROM beta ORDER BY id').all()];
    } finally { db.close(); }
  }
  edit(left, create + "INSERT INTO alpha VALUES(1,'来源'),(2,'新增'); INSERT INTO beta VALUES(9223372036854775807,X'00FF80');");
  edit(right, create + "INSERT INTO alpha VALUES(1,'目标'),(3,'多余'); INSERT INTO beta VALUES(9223372036854775807,X'00FF81');");
  const original = values(right), wanted = values(left);
  try {
    await application.evaluate(({ dialog }, files) => {
      const original = dialog.showOpenDialog, paths = [files.left, files.right];
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        const options = args.at(-1) as Electron.OpenDialogOptions;
        if (options.title !== '选择SQLite数据库文件' || !paths.length) throw Error('非本例 SQLite 文件选择');
        const path = paths.shift()!;
        if (!paths.length) dialog.showOpenDialog = original;
        return { canceled: false, filePaths: [path] };
      }) as typeof original;
    }, { left, right });
    for (const [name, path] of [['批次来源', left], ['批次目标', right]]) {
      await (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: zh.common.newConnection, exact: true }, own)).click();
      const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
      await form.getByLabel(zh.connections.text006, { exact: true }).fill(name);
      await form.locator('select').selectOption('sqlite');
      await form.getByRole('button', { name: sqliteZh.choose, exact: true }).click();
      await expect(form.locator('input[readonly]')).toHaveValue(basename(path));
      if (path === right) await form.getByRole('checkbox', { name: sqliteZh.readOnly, exact: true }).uncheck();
      await form.getByRole('button', { name: zh.connections.text036, exact: true }).click();
      await expect(form).toBeHidden();
    }
    await (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: text.title, exact: true }, own)).click();
    const modal = page.getByRole('dialog', { name: text.title, exact: true });
    await modal.getByLabel(text.source + text.connection, { exact: true }).selectOption({ label: '批次来源' });
    await modal.getByLabel(text.target + text.connection, { exact: true }).selectOption({ label: '批次目标' });
    await modal.getByRole('button', { name: batch.open, exact: true }).click();
    const overview = page.getByRole('dialog', { name: batch.title, exact: true });
    await overview.getByRole('button', { name: batch.match, exact: true }).click();
    const preview = overview.getByRole('button', { name: batchSync.preview, exact: true });
    const apply = overview.getByRole('button', { name: batchSync.apply, exact: true });
    const review = overview.getByRole('group', { name: batchSync.previewTitle, exact: true });
    const confirmation = overview.getByLabel(sync.confirm, { exact: true });
    const confirm = async () => {
      await confirmation.fill('main.alpha 等 2 张表');
      await apply.click();
    };
    await expect(overview.getByRole('checkbox', { name: sync.delete, exact: true })).not.toBeChecked();
    await preview.click();
    await expect(review).toContainText('插入 1 · 更新 2 · 删除 0');
    await expect(review).toContainText('main.alpha');
    await expect(review).toContainText('main.beta');
    await expect(review.getByRole('listitem')).toContainText(['更新　INTEGER 1', '插入　INTEGER 2', '更新　INTEGER 9223372036854775807']);
    expect(values(right)).toEqual(original);
    await confirmation.fill('main.alpha');
    await expect(apply).toBeDisabled();

    // 第二张表在预览后发生并发写入。第一张表即使已执行多行，也必须整批回滚。
    edit(right, "UPDATE beta SET value=X'00FF82'");
    const concurrent = values(right);
    await confirm();
    await expect(overview.getByRole('alert')).toContainText('已确认整批回滚');
    await expect(overview.getByRole('alert')).toContainText('main.beta');
    expect(values(right)).toEqual(concurrent);
    expect(concurrent[0]).toEqual(original[0]);

    // 右侧任一表有触发器时，写事务在首条 DML 前中止。
    edit(right, 'CREATE TRIGGER guarded AFTER UPDATE ON beta BEGIN SELECT 1; END;');
    await preview.click();
    await expect(review).toContainText('更新 2');
    await confirm();
    await expect(overview.getByRole('alert')).toContainText('有触发器');
    expect(values(right)).toEqual(concurrent);
    edit(right, 'DROP TRIGGER guarded');

    await overview.getByRole('checkbox', { name: sync.delete, exact: true }).check();
    await preview.click();
    await expect(review).toContainText('插入 1 · 更新 2 · 删除 1');
    await confirmation.fill('main.alpha 等 2 张表');
    await expect(apply).toBeEnabled();
    await page.screenshot({ path: info.outputPath('SQLite多表事务同步.png') });
    await apply.click();
    await expect(overview.getByRole('status')).toContainText(batchSync.confirmed);
    expect(values(right)).toEqual(wanted);
    expect(values(left)).toEqual(wanted);

    const facts = (await page.evaluate(() => window.dbark.invoke('tasks.list', {})))
      .flatMap(task => task.sqliteWrite?.batchTables ? [task.sqliteWrite] : []);
    expect(facts).toHaveLength(3);
    expect(facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ batchTables: ['alpha', 'beta'], phase: 'rolled-back', appliedRows: 2, commitAcknowledged: false }),
      expect.objectContaining({ batchTables: ['alpha', 'beta'], phase: 'rolled-back', appliedRows: 0, commitAcknowledged: false }),
      expect.objectContaining({ batchTables: ['alpha', 'beta'], phase: 'committed', appliedRows: 4, commitAcknowledged: true }),
    ]));
    await preview.click();
    await expect(overview.getByRole('status')).toHaveText(batchSync.noChanges);
    expect(pageErrors).toEqual([]);
    await overview.getByRole('button', { name: batch.return, exact: true }).click();
    await modal.getByRole('button', { name: text.close, exact: true }).click();
    await confirmOwnedDesktopExit(info);
  } catch (error) {
    retainOwnedDesktopResources(info);
    throw error;
  }
});
