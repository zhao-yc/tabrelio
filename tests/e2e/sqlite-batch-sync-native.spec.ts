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
import { dataCompareMappingZh as mapping } from '../../src/renderer/locales/dataCompareMapping.zh-CN';

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
  edit(left, `CREATE TABLE mapped_left(code TEXT, seq INTEGER, raw BLOB);
    INSERT INTO mapped_left VALUES('Key',9223372036854775807,X'00FF80'),('new',2,X'00FF83');`);
  edit(right, `CREATE TABLE mapped_right(identifier TEXT COLLATE NOCASE, serial INTEGER, payload BLOB,
    local_note TEXT NOT NULL DEFAULT '目标默认', derived INTEGER AS(length(payload)));
    INSERT INTO mapped_right(identifier,serial,payload,local_note) VALUES
      ('Key',9223372036854775807,X'00FF81','右侧保留'),('key',9223372036854775807,X'00FF82','仅右');`);
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

    edit(left, "UPDATE alpha SET value='再次更新' WHERE id=1");
    const readMapped = () => {
      const db = new DatabaseSync(right, { readOnly: true });
      try { return db.prepare('SELECT identifier, CAST(serial AS TEXT) AS serial, hex(payload) AS payload, local_note, derived FROM mapped_right ORDER BY identifier COLLATE BINARY').all(); }
      finally { db.close(); }
    };
    const originalMapped = readMapped(), originalAlpha = values(right)[0];
    await overview.getByRole('row').filter({ hasText: 'beta' }).getByRole('button', { name: batch.remove, exact: true }).click();
    await overview.getByLabel(batch.source, { exact: true }).selectOption('mapped_left');
    await overview.getByLabel(batch.target, { exact: true }).selectOption('mapped_right');
    await overview.getByRole('button', { name: batch.add, exact: true }).click();
    await overview.getByRole('row').filter({ hasText: 'mapped_left' }).getByRole('button', { name: batch.editFields, exact: true }).click();
    const editor = overview.getByRole('region', { name: batch.fieldEditor('mapped_left', 'mapped_right'), exact: true });
    for (const [source, target, key] of [['code', 'identifier', true], ['seq', 'serial', true], ['raw', 'payload', false]] as const) {
      await editor.getByLabel(mapping.source, { exact: true }).selectOption(source);
      await editor.getByLabel(mapping.target, { exact: true }).selectOption(target);
      await editor.getByRole('button', { name: mapping.add, exact: true }).click();
      if (key) await editor.getByRole('checkbox', { name: mapping.key + ' ' + source, exact: true }).check();
    }
    await overview.getByRole('button', { name: batch.finishFields, exact: true }).click();
    const deleteRows = overview.getByRole('checkbox', { name: sync.delete, exact: true });
    await deleteRows.uncheck();
    await preview.click();
    await expect(review).toContainText('插入 1 · 更新 2 · 删除 0');
    await expect(review).toContainText('INTEGER 9223372036854775807');
    // 自定义键没有数据库唯一索引时，事务内仍须拒绝预览后的重复键。
    edit(right, "INSERT INTO mapped_right(identifier,serial,payload,local_note) VALUES('Key',9223372036854775807,X'FF','并发重复')");
    const duplicate = readMapped();
    await confirm();
    await expect(overview.getByRole('alert')).toContainText('main.mapped_right');
    expect(values(right)[0]).toEqual(originalAlpha);
    expect(readMapped()).toEqual(duplicate);
    edit(right, "DELETE FROM mapped_right WHERE local_note='并发重复'");
    expect(readMapped()).toEqual(originalMapped);

    await deleteRows.check();
    await preview.click();
    await expect(review).toContainText('插入 1 · 更新 2 · 删除 1');
    await confirmation.fill('main.alpha 等 2 张表');
    await page.screenshot({ path: info.outputPath('SQLite自定义字段多表同步.png') });
    await apply.click();
    await expect(overview.getByRole('status')).toContainText(batchSync.confirmed);
    expect(readMapped()).toEqual([
      { identifier: 'Key', serial: '9223372036854775807', payload: '00FF80', local_note: '右侧保留', derived: 3 },
      { identifier: 'new', serial: '2', payload: '00FF83', local_note: '目标默认', derived: 3 },
    ]);
    expect(values(right)[0]).toEqual(values(left)[0]);
    const sourceDb = new DatabaseSync(left, { readOnly: true });
    try { expect(sourceDb.prepare('SELECT code,hex(raw) AS raw FROM mapped_left ORDER BY code').all())
      .toEqual([{ code: 'Key', raw: '00FF80' }, { code: 'new', raw: '00FF83' }]); }
    finally { sourceDb.close(); }
    await preview.click();
    await expect(overview.getByRole('status')).toHaveText(batchSync.noChanges);
    edit(left, "UPDATE alpha SET value='跳过此表' WHERE id=1; UPDATE mapped_left SET raw=X'99' WHERE code='Key'; UPDATE mapped_left SET raw=X'88' WHERE code='new'");
    edit(right, "INSERT INTO mapped_right(identifier,serial,payload) VALUES('retained',3,X'66')");
    const alphaBeforeSelection = values(right)[0];
    await preview.click();
    await expect(review).toContainText('插入 0 · 更新 3 · 删除 1');
    await confirmation.fill('main.alpha 等 2 张表');
    await expect(apply).toBeEnabled();
    const reviewSelected = review.getByRole('button', { name: batchSync.reviewSelection, exact: true });
    const summary = review.getByRole('table', { name: batchSync.reviewSummary, exact: true });
    await reviewSelected.click();
    await expect(summary.getByRole('row', { name: 'main.alpha 0 1 0', exact: true })).toBeVisible();
    await expect(summary.getByRole('row', { name: 'main.mapped_right 0 2 1', exact: true })).toBeVisible();
    await reviewSelected.click();
    await review.getByRole('button', { name: batchSync.clearAll, exact: true }).click();
    await expect(review).toContainText(batchSync.noneSelected);
    await expect(confirmation).toBeDisabled();
    await expect(apply).toBeDisabled();
    await review.getByRole('button', { name: batchSync.selectAll, exact: true }).click();
    await expect(confirmation).toHaveValue('');
    await review.getByRole('button', { name: batchSync.clearTable + ' main.alpha', exact: true }).click();
    await review.getByRole('listitem').filter({ hasText: 'TEXT "Key"' }).getByRole('checkbox').uncheck();
    await review.getByRole('listitem').filter({ hasText: 'TEXT "retained"' }).getByRole('checkbox').uncheck();
    const chosen = review.getByRole('listitem').filter({ hasText: 'TEXT "new"' });
    await expect(chosen.getByRole('checkbox')).toBeChecked();
    await chosen.getByText(batchSync.details, { exact: true }).click();
    const inspected = review.getByRole('group', { name: batchSync.detailHeading, exact: true }).getByRole('row').filter({ hasText: 'raw → payload' });
    await expect(inspected).toContainText('BLOB Base64 iA==');
    await expect(inspected).toContainText('BLOB Base64 AP+D');
    await expect(review).toContainText('插入 0 · 更新 1 · 删除 0');
    await confirmation.fill('main.alpha 等 2 张表');
    await expect(apply).toBeDisabled();
    await confirmation.fill('main.mapped_right');
    await expect(apply).toBeEnabled();
    await expect(inspected).toBeInViewport();
    await page.screenshot({ path: info.outputPath('SQLite多表同步逐行选择.png') });
    await apply.click();
    await expect(overview.getByRole('status')).toContainText(batchSync.confirmed);
    expect(values(right)[0]).toEqual(alphaBeforeSelection);
    expect(readMapped().map(row => row.payload)).toEqual(['00FF80', '88', '66']);

    edit(left, `WITH RECURSIVE n(i) AS (VALUES(1000) UNION ALL SELECT i+1 FROM n WHERE i<1123)
      INSERT INTO alpha SELECT i, '分页候选' FROM n;
      INSERT INTO mapped_left(code,seq,raw) VALUES('page-extra',4,X'44')`);
    await overview.getByRole('checkbox', { name: sync.update, exact: true }).uncheck();
    await deleteRows.uncheck();
    await preview.click();
    const next = review.getByRole('button', { name: batchSync.nextPage, exact: true });
    const previous = review.getByRole('button', { name: batchSync.previousPage, exact: true });
    await expect(review).toContainText(batchSync.selectionCount(0, 125));
    await expect(review.getByRole('button', { name: batchSync.selectAll, exact: true })).toBeDisabled();
    await expect(review.getByRole('listitem')).toHaveCount(25);
    for (let number = 1; number <= 5; number++) {
      await review.getByRole('button', { name: batchSync.selectPage, exact: true }).click();
      if (number < 5) await next.click();
    }
    await expect(review).toContainText(batchSync.selectionCount(125, 125));
    await expect(review.getByRole('alert')).toContainText('100 条');
    await expect(apply).toBeDisabled();
    await reviewSelected.click();
    await expect(reviewSelected).toHaveAttribute('aria-pressed', 'true');
    await expect(summary.getByRole('row', { name: 'main.alpha 124 0 0', exact: true })).toBeVisible();
    await expect(summary.getByRole('row', { name: 'main.mapped_right 1 0 0', exact: true })).toBeVisible();
    await expect(review.getByRole('listitem')).toHaveCount(25);
    await review.getByRole('combobox', { name: batchSync.jumpPage, exact: true }).selectOption('4');
    await expect(review.getByRole('listitem').filter({ hasText: 'TEXT "page-extra"' })).toBeVisible();
    await expect(apply).toBeDisabled();
    await reviewSelected.click();
    await review.getByRole('button', { name: batchSync.clearAll, exact: true }).click();
    await expect(reviewSelected).toBeDisabled();
    const jump = review.getByRole('combobox', { name: batchSync.jumpPage, exact: true });
    await jump.selectOption('4');
    const last = review.getByRole('listitem').filter({ hasText: 'TEXT "page-extra"' }).getByRole('checkbox');
    await last.check();
    await previous.click();
    await jump.selectOption('0');
    await review.getByRole('listitem').filter({ hasText: 'INTEGER 1000' }).getByRole('checkbox').check();
    await jump.selectOption('4');
    await expect(review).toContainText(batchSync.selectionCount(2, 125));
    await expect(review.locator('[aria-live="polite"]')).toHaveText(batchSync.page(5, 5));
    await expect(last).toBeChecked();
    await confirmation.fill('main.alpha 等 2 张表');
    await review.getByLabel(batchSync.filterTable, { exact: true }).selectOption('mapped_right');
    await review.getByLabel(batchSync.filterAction, { exact: true }).selectOption('delete');
    await expect(review).toContainText(batchSync.noMatches);
    await expect(review).toContainText(batchSync.hiddenSelected(2));
    await expect(confirmation).toHaveValue('main.alpha 等 2 张表');
    await review.getByLabel(batchSync.filterAction, { exact: true }).selectOption('insert');
    await review.getByLabel(batchSync.filterKey, { exact: true }).fill('PAGE-EXTRA');
    await expect(review.getByRole('listitem')).toHaveCount(1);
    await expect(review).toContainText(batchSync.hiddenSelected(1));
    await review.getByRole('button', { name: batchSync.clearTableMatches + ' main.mapped_right', exact: true }).click();
    await expect(confirmation).toHaveValue('');
    await expect(review).toContainText(batchSync.selectionCount(1, 125));
    await review.getByRole('button', { name: batchSync.selectMatches, exact: true }).click();
    await confirmation.fill('main.alpha 等 2 张表');
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
    await page.screenshot({ path: info.outputPath('SQLite多表同步预览筛选.png') });
    await reviewSelected.click();
    await expect(review.getByRole('listitem')).toHaveCount(2);
    await expect(review.getByRole('checkbox')).toHaveCount(0);
    await expect(summary.getByRole('row', { name: 'main.alpha 1 0 0', exact: true })).toBeVisible();
    const selectedFromHiddenTable = review.getByRole('listitem').filter({ hasText: 'INTEGER 1000' });
    await selectedFromHiddenTable.getByRole('button').click();
    await expect(review.getByRole('group', { name: batchSync.detailHeading, exact: true })).toContainText('分页候选');
    await expect(confirmation).toHaveValue('main.alpha 等 2 张表');
    await reviewSelected.click();
    await expect(review.getByLabel(batchSync.filterKey, { exact: true })).toHaveValue('PAGE-EXTRA');
    await expect(review).toContainText(batchSync.hiddenSelected(1));
    await reviewSelected.click();
    await reviewSelected.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('SQLite多表同步核对已选差异.png') });
    await expect(apply).toBeEnabled();
    await apply.click();
    await expect(overview.getByRole('status')).toContainText(batchSync.confirmed);
    expect(values(right)[0].filter(row => Number(row.id) >= 1000)).toEqual([{ id: 1000, value: '分页候选' }]);
    expect(readMapped().find(row => row.identifier === 'page-extra')).toEqual(
      { identifier: 'page-extra', serial: '4', payload: '44', local_note: '目标默认', derived: 1 });
    expect(pageErrors).toEqual([]);
    await overview.getByRole('button', { name: batch.return, exact: true }).click();
    await modal.getByRole('button', { name: text.close, exact: true }).click();
    await confirmOwnedDesktopExit(info);
  } catch (error) {
    retainOwnedDesktopResources(info);
    throw error;
  }
});
