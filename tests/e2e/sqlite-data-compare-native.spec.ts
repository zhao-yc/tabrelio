import { dataCompareMappingZh as mapping } from '../../src/renderer/locales/dataCompareMapping.zh-CN';
import { dataCompareBatchZh as batch } from '../../src/renderer/locales/dataCompareBatch.zh-CN';
import { dataCompareBatchProfilesZh as batchProfiles, dataCompareProfilesZh as profiles } from '../../src/renderer/locales/dataCompareProfiles.zh-CN';
import { mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { confirmOwnedDesktopExit, dataDir, expect, ownedDesktopResources, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';
import { sqliteZh } from '../../src/renderer/locales/sqlite.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import { sqliteDataCompareZh as text, sqliteDataSyncZh as sync } from '../../src/shared/sqliteDataCompare';

test.skip(process.env.DBARK_SQLITE_DATA_COMPARE_NATIVE !== '1', '须显式启用 SQLite 数据比较专项');
test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' });

test('在真实窗口比较同库及跨文件表，并按差异类型翻页、预览及同步所选行', async ({}, info) => {
  if (!['darwin', 'win32'].includes(process.platform) || info.config.workers !== 1 || info.retry ||
      process.env.DBARK_INTEGRATION_ENABLED !== '0' || ['DBARK_EXECUTABLE_PATH', 'DBARK_DEV_URL', 'DBARK_USER_DATA'].some(key => process.env[key]))
    throw Error('只允许隔离的源码 Electron SQLite 比较专项');
  const { page, application } = ownedDesktopResources(info);
  const own = () => { if (ownedDesktopResources(info).page !== page) throw Error('本例窗口归属已变化'); };
  const directory = join(dataDir, 'compare-fixture'), left = join(directory, '左侧.sqlite'), right = join(directory, '右侧.sqlite');
  await mkdir(directory);
  const create = 'CREATE TABLE ledger(id INTEGER PRIMARY KEY, value, note TEXT);';
  const insert = (text: string) => `WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<26) INSERT INTO ledger SELECT i,i,'${text}' FROM n;`;
  function seed(path: string, sql: string) {
    const db = new DatabaseSync(path);
    try { db.exec(sql); } finally { db.close(); }
  }
  seed(left, create + insert('来源') + "INSERT INTO ledger VALUES(9223372036854775807,X'00FF80',NULL),(101,NULL,'仅左'); CREATE TABLE mirror(id INTEGER PRIMARY KEY, value, note TEXT); INSERT INTO mirror SELECT * FROM ledger; CREATE TABLE without_key(id); CREATE TABLE mapped_source(code, raw, ignored); INSERT INTO mapped_source VALUES(9223372036854775807,X'00FF80','仅左字段');");
  seed(right, create + insert('目标') + "INSERT INTO ledger VALUES(9223372036854775807,X'00FF81',NULL),(102,NULL,'仅右'); CREATE TABLE without_key(id); CREATE TABLE renamed(id INTEGER PRIMARY KEY, value, note TEXT); CREATE TABLE mapped_target(identifier, payload); INSERT INTO mapped_target VALUES(9223372036854775807,X'00FF81');");
  try {
    // 仅代填系统文件选择，两条保存连接及比较操作经过真实 IPC 和 SQLite utility。
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
    const connect = async (name: string, path: string) => {
      await (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: zh.common.newConnection, exact: true }, own)).click();
      const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
      await form.getByLabel(zh.connections.text006, { exact: true }).fill(name);
      await expect(form.locator('select')).toHaveCount(1);
      await form.locator('select').selectOption('sqlite');
      await form.getByRole('button', { name: sqliteZh.choose, exact: true }).click();
      await expect(form.locator('input[readonly]')).toHaveValue(basename(path));
      if (path === right) await form.getByRole('checkbox', { name: sqliteZh.readOnly, exact: true }).uncheck();
      await form.getByRole('button', { name: zh.connections.text036, exact: true }).click();
      await expect(form).toBeHidden();
    };
    await connect('比较左库', left);
    await connect('比较右库', right);
    await (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: text.title, exact: true }, own)).click();
    const modal = page.getByRole('dialog', { name: text.title, exact: true });
    const choose = async (label: string, profile: string, table: string) => {
      await modal.getByLabel(label + text.connection, { exact: true }).selectOption({ label: profile });
      await modal.getByLabel(label + text.table, { exact: true }).selectOption({ label: table });
    };
    await choose(text.source, '比较左库', 'ledger');
    await choose(text.target, '比较左库', 'mirror');
    const run = modal.getByRole('button', { name: text.run, exact: true });
    await run.click();
    await expect(modal.getByText(text.singleSnapshot, { exact: true })).toBeVisible();
    await expect(modal.getByRole('status')).toContainText('相同 28');

    await choose(text.source, '比较左库', 'mapped_source');
    await choose(text.target, '比较右库', 'mapped_target');
    await modal.getByText(mapping.title, { exact: true }).click();
    const mapField = async (source: string, target: string, key: boolean) => {
      await modal.getByLabel(mapping.source, { exact: true }).selectOption(source);
      await modal.getByLabel(mapping.target, { exact: true }).selectOption(target);
      await modal.getByRole('button', { name: mapping.add, exact: true }).click();
      if (key) await modal.getByRole('checkbox', { name: mapping.key + ' ' + source, exact: true }).check();
    };
    await mapField('code', 'identifier', true);
    await mapField('raw', 'payload', false);
    await run.click();
    await expect(modal.getByRole('status')).toContainText('字段值不同 1');
    await expect(modal.getByRole('button', { name: sync.preview, exact: true })).toHaveCount(0);
    await modal.getByRole('button', { name: text.detail, exact: true }).click();
    const mappedDetails = modal.getByRole('table', { name: text.detail, exact: true });
    await expect(mappedDetails).toContainText('raw → payload');
    await expect(mappedDetails).toContainText('AP+A');
    await expect(mappedDetails).toContainText('AP+B');
    await page.screenshot({ path: info.outputPath('SQLite字段映射.png') });
    await modal.getByText(profiles.title, { exact: true }).click();
    await modal.getByLabel(profiles.name, { exact: true }).fill('异名字段');
    await modal.getByRole('button', { name: profiles.add, exact: true }).click();
    await expect(modal.getByText(profiles.saved, { exact: true })).toBeVisible();
    await modal.getByRole('button', { name: mapping.reset, exact: true }).click();
    await modal.getByRole('button', { name: profiles.apply, exact: true }).click();
    await expect(modal.getByText(profiles.applied, { exact: true })).toBeVisible();
    await expect(modal.getByRole('checkbox', { name: mapping.key + ' code', exact: true })).toBeChecked();
    await modal.getByRole('button', { name: profiles.swap, exact: true }).click();
    await run.click();
    await expect(modal.getByRole('status')).toContainText('字段值不同 1');
    await modal.getByRole('button', { name: text.detail, exact: true }).click();
    const swapped = mappedDetails.getByRole('row').filter({ hasText: 'payload → raw' });
    await expect(swapped.getByRole('cell').first()).toContainText('AP+B');
    await expect(swapped.getByRole('cell').last()).toContainText('AP+A');
    await modal.getByRole('button', { name: profiles.swap, exact: true }).click();
    await modal.getByText(profiles.title, { exact: true }).click();
    seed(right, 'INSERT INTO mapped_target SELECT * FROM mapped_target');
    await run.click();
    await expect(modal.getByRole('alert')).toContainText('重复主键');
    seed(right, 'DELETE FROM mapped_target WHERE rowid=2; INSERT INTO mapped_target VALUES(NULL,NULL)');
    await run.click();
    await expect(modal.getByRole('alert')).toContainText('NULL 主键');
    seed(right, 'DELETE FROM mapped_target WHERE identifier IS NULL');
    await choose(text.source, '比较左库', 'ledger');
    await choose(text.target, '比较右库', 'ledger');
    await modal.getByRole('button', { name: batch.open, exact: true }).click();
    const overview = page.getByRole('dialog', { name: batch.title, exact: true });
    const result = overview.getByRole('table', { name: batch.result, exact: true });
    const pairRow = (name: string) => result.getByRole('row').filter({ has: page.getByRole('cell', { name, exact: true }) });
    await overview.getByRole('button', { name: batch.match, exact: true }).click();
    await overview.getByLabel(batch.source, { exact: true }).selectOption('mirror');
    await overview.getByLabel(batch.target, { exact: true }).selectOption('renamed');
    await overview.getByRole('button', { name: batch.add, exact: true }).click();
    const profilePanel = overview.locator('details').filter({ hasText: batchProfiles.title });
    const applyBatch = profilePanel.getByRole('button', { name: batchProfiles.apply, exact: true });
    await overview.getByText(batchProfiles.title, { exact: true }).click();
    await profilePanel.getByLabel(batchProfiles.name, { exact: true }).fill('盘点');
    await profilePanel.getByRole('button', { name: batchProfiles.add, exact: true }).click();
    await expect(profilePanel.getByText(batchProfiles.saved, { exact: true })).toBeVisible();
    await overview.getByRole('button', { name: batch.run, exact: true }).click();
    await expect(pairRow('ledger')).toContainText('仅左侧 1 · 仅右侧 1 · 字段值不同 27');
    await expect(pairRow('without_key')).toContainText('显式主键');
    await expect(pairRow('mirror')).toContainText('仅左侧 28 · 仅右侧 0 · 字段值不同 0');
    await page.screenshot({ path: info.outputPath('SQLite多表比较.png') });
    await pairRow('ledger').getByRole('button', { name: batch.review, exact: true }).click();
    await expect(modal.getByLabel(text.source + text.table, { exact: true })).toHaveValue('ledger');
    await expect(modal.getByLabel(text.target + text.table, { exact: true })).toHaveValue('ledger');
    await expect(modal.getByRole('status')).toHaveCount(0);
    await run.click();
    await expect(modal.getByRole('status')).toContainText('字段值不同 27');
    await modal.getByRole('button', { name: text.close, exact: true }).click();
    await expect(pairRow('ledger')).toContainText(batch.pending);
    await expect(pairRow('mirror')).toContainText('仅左侧 28');
    await overview.getByRole('button', { name: profiles.swap, exact: true }).click();
    await expect(pairRow('mirror')).toContainText(batch.pending);
    await overview.getByRole('button', { name: batch.run, exact: true }).click();
    await expect(pairRow('mirror')).toContainText('仅左侧 0 · 仅右侧 28');
    await overview.getByText(batchProfiles.title, { exact: true }).click();
    await profilePanel.getByLabel(batchProfiles.select, { exact: true }).selectOption('盘点');
    seed(right, 'ALTER TABLE renamed RENAME TO moved');
    await applyBatch.click();
    await expect(profilePanel.getByRole('alert')).toContainText('表映射已失效');
    await expect(pairRow('mirror')).toContainText('仅左侧 0 · 仅右侧 28');
    seed(right, 'ALTER TABLE moved RENAME TO renamed');
    await overview.getByRole('button', { name: batch.return, exact: true }).click();
    await modal.getByRole('button', { name: text.close, exact: true }).click();
    await (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: text.title, exact: true }, own)).click();
    await modal.getByRole('button', { name: batch.open, exact: true }).click();
    await expect(overview.getByText(batch.chooseScope, { exact: true })).toBeVisible();
    await overview.getByText(batchProfiles.title, { exact: true }).click();
    await profilePanel.getByLabel(batchProfiles.select, { exact: true }).selectOption('盘点');
    await applyBatch.click();
    await expect(profilePanel.getByText(batchProfiles.applied, { exact: true })).toBeVisible();
    await expect(overview.getByText(batch.pending, { exact: true })).toHaveCount(3);
    await expect(pairRow('mirror').getByRole('cell').nth(0)).toHaveText('mirror');
    await expect(pairRow('mirror').getByRole('cell').nth(1)).toHaveText('renamed');
    await page.screenshot({ path: info.outputPath('SQLite多表方案.png') });
    await overview.getByRole('button', { name: batch.run, exact: true }).click();
    await expect(pairRow('mirror')).toContainText('仅左侧 28 · 仅右侧 0');
    await overview.getByRole('button', { name: batch.return, exact: true }).click();
    await choose(text.source, '比较左库', 'ledger');
    await choose(text.target, '比较右库', 'ledger');
    await run.click();
    await expect(modal.getByText(text.splitSnapshot, { exact: true })).toBeVisible();
    await expect(modal.getByRole('status')).toContainText('仅左侧 1 · 仅右侧 1 · 字段值不同 27');
    await modal.getByLabel(text.kind, { exact: true }).selectOption('different');
    await expect(modal.getByText('1 / 2', { exact: true })).toBeVisible();
    await modal.getByRole('button', { name: text.next, exact: true }).click();
    await expect(modal.getByText('2 / 2', { exact: true })).toBeVisible();
    const precise = modal.getByRole('row').filter({ hasText: 'INTEGER 9223372036854775807' });
    await precise.getByRole('button', { name: text.detail, exact: true }).click();
    const detail = modal.getByRole('table', { name: text.detail, exact: true });
    await expect(detail).toBeInViewport();
    await expect(detail).toContainText('BLOB Base64 AP+A');
    await expect(detail).toContainText('BLOB Base64 AP+B');
    await page.screenshot({ path: info.outputPath('SQLite数据比较.png') });

    await modal.getByLabel(text.filterColumn, { exact: true }).fill('id');
    await modal.getByLabel(text.filterType, { exact: true }).selectOption('integer');
    await modal.getByLabel(text.filterValue, { exact: true }).fill('9223372036854775807');
    await modal.getByText(profiles.title, { exact: true }).click();
    await modal.getByLabel(profiles.name, { exact: true }).fill('精确整数');
    await modal.getByRole('button', { name: profiles.add, exact: true }).click();
    await expect(modal.getByText(profiles.saved, { exact: true })).toBeVisible();
    await modal.getByRole('button', { name: text.close, exact: true }).click();
    await expect(modal).toBeHidden();
    await (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: text.title, exact: true }, own)).click();
    await modal.getByText(profiles.title, { exact: true }).click();
    await modal.getByLabel(profiles.select, { exact: true }).selectOption('精确整数');
    await modal.getByRole('button', { name: profiles.apply, exact: true }).click();
    await expect(modal.getByText(profiles.applied, { exact: true })).toBeVisible();
    await expect(modal.getByLabel(text.filterValue, { exact: true })).toHaveValue('9223372036854775807');
    await expect(modal.getByLabel(text.filterType, { exact: true })).toHaveValue('integer');
    await expect(modal.getByRole('status')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('SQLite比较方案.png') });
    const swap = modal.getByRole('button', { name: profiles.swap, exact: true });
    await run.click();
    await expect(modal.getByRole('status')).toContainText('字段值不同 1');
    await swap.click();
    await expect(modal.getByRole('status')).toHaveCount(0);
    await run.click();
    await modal.getByRole('button', { name: text.detail, exact: true }).click();
    const reversed = modal.getByRole('table', { name: text.detail, exact: true }).getByRole('row').filter({ hasText: 'BLOB' });
    await expect(reversed.getByRole('cell').first()).toHaveText('BLOB Base64 AP+B');
    await expect(reversed.getByRole('cell').last()).toHaveText('BLOB Base64 AP+A');
    await swap.click();
    await run.click();
    await expect(modal.getByRole('status')).toContainText('左侧行数 1 · 右侧行数 1 · 相同 0 · 仅左侧 0 · 仅右侧 0 · 字段值不同 1');
    for (const [path, expected] of [[left, '00FF80'], [right, '00FF81']]) {
      const db = new DatabaseSync(path, { readOnly: true });
      try { expect(db.prepare('SELECT hex(value) AS value FROM ledger WHERE id=9223372036854775807').get()?.value).toBe(expected); }
      finally { db.close(); }
    }
    await expect(modal.getByRole('button', { name: sync.preview, exact: true })).toHaveCount(0);
    await modal.getByLabel(text.filterColumn, { exact: true }).clear();
    await run.click();
    await expect(modal.getByRole('status')).toContainText('字段值不同 27');
    for (const type of ['source-only', 'target-only']) {
      await modal.getByLabel(text.kind, { exact: true }).selectOption(type);
      await modal.getByRole('checkbox').check();
    }
    await modal.getByLabel(text.kind, { exact: true }).selectOption('different');
    await modal.getByRole('button', { name: text.next, exact: true }).click();
    await precise.getByRole('checkbox').check();
    await modal.getByRole('button', { name: sync.preview, exact: true }).click();
    await expect(modal.getByText('插入 1 · 更新 1 · 删除 1', { exact: true })).toBeVisible();
    const review = modal.getByRole('group', { name: sync.preview, exact: true });
    await expect(review.getByRole('listitem')).toHaveText(['插入　INTEGER 101', '删除　INTEGER 102', '更新　INTEGER 9223372036854775807']);
    const apply = modal.getByRole('button', { name: sync.apply, exact: true });
    await modal.getByLabel(sync.confirm, { exact: true }).fill('main.mirror');
    await expect(apply).toBeDisabled();
    await modal.getByLabel(sync.confirm, { exact: true }).fill('main.ledger');
    await expect(apply).toBeEnabled();
    await modal.getByLabel(sync.confirm, { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('SQLite差异同步预览.png') });
    await apply.click();
    await expect(modal.getByRole('status').filter({ hasText: '已确认提交' })).toBeVisible();
    const targetDb = new DatabaseSync(right, { readOnly: true });
    try {
      expect(targetDb.prepare('SELECT note FROM ledger WHERE id=101').get()?.note).toBe('仅左');
      expect(targetDb.prepare('SELECT note FROM ledger WHERE id=102').get()).toBeUndefined();
      expect(targetDb.prepare('SELECT hex(value) AS value FROM ledger WHERE id=9223372036854775807').get()?.value).toBe('00FF80');
      expect(targetDb.prepare('SELECT note FROM ledger WHERE id=1').get()?.note).toBe('目标');
    } finally { targetDb.close(); }
    await run.click();
    await expect(modal.getByRole('status')).toContainText('相同 2 · 仅左侧 0 · 仅右侧 0 · 字段值不同 26');
    expect(pageErrors).toEqual([]);
    await modal.getByRole('button', { name: text.close, exact: true }).click();
    await confirmOwnedDesktopExit(info);
  } catch (error) {
    retainOwnedDesktopResources(info);
    throw error;
  }
});
