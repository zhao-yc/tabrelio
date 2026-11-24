import mysql from 'mysql2/promise';
import type { NetworkConnectionProfile } from '../../src/shared/contracts';
import { mysqlDataTransferTitle } from '../../src/shared/mysqlDataTransfer';
import { mysqlDataTransferZh as transfer } from '../../src/renderer/locales/mysqlDataTransfer.zh-CN';
import { schemaCompareZh as structure } from '../../src/renderer/locales/schemaCompare.zh-CN';
import { uiCommandLabels } from '../../src/shared/uiCommands.zh-CN';
import { confirmOwnedDesktopExit, expect, page, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });
const dialect = process.env.DBARK_TRANSFER_DIALECT;
test.skip(!dialect, '需要两套独占回环数据库');

test('跨实例传输多表并对另一个目标表应用选中结构差异', async ({}, info) => {
  const database = process.env.DBARK_TRANSFER_DATABASE ?? '', password = process.env.DBARK_TRANSFER_PASSWORD ?? '';
  const sourcePort = Number(process.env.DBARK_TRANSFER_SOURCE_PORT), targetPort = Number(process.env.DBARK_TRANSFER_TARGET_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || process.env.DBARK_EXECUTABLE_PATH || process.env.DBARK_DEV_URL ||
      dialect !== 'mysql' && dialect !== 'mariadb' || !/^tabrelio_js_[a-f0-9]{12}$/.test(database) || !/^[a-f0-9]{64}$/.test(password) ||
      sourcePort === targetPort || [sourcePort, targetPort].some(port => !Number.isInteger(port) || port <= 1024 || port > 65535))
    throw Error('本例只允许两套独占测试实例');
  const profile = (name: string, port: number): NetworkConnectionProfile => ({
    id: '', dialect, name, group: '', color: '#123456', host: '127.0.0.1', port, user: database, database, password, rememberPassword: false,
  });
  const observer = await mysql.createConnection({ host: '127.0.0.1', port: targetPort, user: database, database, password,
    supportBigNumbers: true, bigNumberStrings: true });
  try {
    const ids = await page.evaluate(async profiles => {
      const ids: string[] = [];
      for (const profile of profiles) ids.push((await window.dbark.invoke('connections.save', profile)).id);
      return ids;
    }, [profile('传输源实例', sourcePort), profile('传输目标实例', targetPort)]);
    await page.reload();
    const toolbar = page.locator('.navigation-toolbar');
    const open = async (name: string) => (await navigationMenuItem(toolbar, { name, exact: true })).click();
    await open(mysqlDataTransferTitle);
    const dialog = page.getByRole('dialog', { name: mysqlDataTransferTitle, exact: true });
    await dialog.getByLabel('源端 连接', { exact: true }).selectOption(ids[0]);
    await dialog.getByLabel('目标端 连接', { exact: true }).selectOption(ids[1]);
    await dialog.getByRole('button', { name: transfer.load, exact: true }).click();
    for (const name of ['transfer_numbers', 'transfer_text'])
      await dialog.getByRole('checkbox', { name, exact: true }).check();
    const review = dialog.getByRole('button', { name: transfer.preview, exact: true });
    await review.click();
    const confirm = dialog.getByRole('textbox', { name: transfer.targetHint, exact: true });
    await expect(confirm).toBeVisible();
    expect((await observer.query("SHOW TABLES LIKE 'transfer_%'"))[0]).toEqual([]);
    await confirm.fill(database + '_wrong');
    await dialog.getByRole('checkbox', { name: transfer.acknowledge, exact: true }).check();
    const apply = dialog.getByRole('button', { name: transfer.apply, exact: true });
    await expect(apply).toBeDisabled();
    await confirm.fill(database);
    await apply.click();
    await expect(dialog.getByRole('status')).toContainText(transfer.completed);
    await expect(dialog.getByRole('status')).toContainText('已提交 2 行');
    const [numbers] = await observer.query('SELECT id, amount, HEX(payload) AS payload FROM transfer_numbers ORDER BY id');
    expect(numbers).toEqual([{ id: '0', amount: '9007199254740993.2500', payload: '00FF' }, { id: '2', amount: '-1.0100', payload: '' }]);
    const [strings] = await observer.query('SELECT id, label FROM transfer_text ORDER BY id');
    expect(strings).toEqual([{ id: '1', label: '中文🚢' }, { id: '2', label: null }]);
    await dialog.screenshot({ path: info.outputPath('多表数据传输.png') });
    await review.click();
    await expect(dialog.getByText(/目标库已有同名表或视图/)).toBeVisible();
    await expect(apply).toBeDisabled();
    for (const name of ['transfer_numbers', 'transfer_text'])
      await dialog.getByRole('checkbox', { name, exact: true }).uncheck();
    await dialog.getByRole('checkbox', { name: 'transfer_schema', exact: true }).check();
    await dialog.getByRole('combobox', { name: transfer.mode, exact: true }).selectOption('schema');
    await review.click();
    await confirm.fill(database);
    await dialog.getByRole('checkbox', { name: transfer.acknowledge, exact: true }).check();
    await apply.click();
    await expect(dialog.getByRole('status')).toContainText(transfer.completed);
    expect((await observer.query('SELECT id FROM transfer_schema'))[0]).toEqual([]);
    await dialog.getByRole('button', { name: transfer.close, exact: true }).click();

    await open(uiCommandLabels['schema-compare']);
    const comparison = page.getByRole('dialog', { name: structure.title, exact: true });
    for (const [i, side] of [structure.source, structure.target].entries()) {
      await comparison.getByLabel(side + ' ' + structure.connection, { exact: true }).selectOption(ids[i]);
      await comparison.getByLabel(side + ' ' + structure.database, { exact: true }).fill(database);
      await comparison.getByLabel(side + ' ' + structure.table, { exact: true }).fill('sync_subject');
    }
    const compare = comparison.getByRole('button', { name: structure.start, exact: true });
    const preview = comparison.getByRole('button', { name: structure.preview, exact: true });
    const confirmed = comparison.getByRole('textbox', { name: structure.syncTarget, exact: true });
    const applyStructure = comparison.getByRole('button', { name: structure.sync, exact: true });
    const choose = async () => {
      await compare.click();
      await comparison.getByRole('checkbox', { name: '选择 字段 label', exact: true }).check();
      await comparison.getByRole('checkbox', { name: '选择 主键 / 索引 ix_label', exact: true }).check();
      await preview.click();
      await confirmed.fill(database + '.sync_subject');
      await comparison.getByRole('checkbox', { name: structure.syncRisk, exact: true }).check();
    };
    await choose();
    expect((await observer.query("SHOW COLUMNS FROM sync_subject LIKE 'label'"))[0]).toEqual([]);
    await observer.query('ALTER TABLE sync_subject COMMENT = \'模拟外部变更\'');
    await applyStructure.click();
    await expect(comparison.getByText(/表定义已变化/)).toBeVisible();
    expect((await observer.query("SHOW COLUMNS FROM sync_subject LIKE 'label'"))[0]).toEqual([]);

    await observer.query("ALTER TABLE sync_subject COMMENT = ''");
    await choose();
    await applyStructure.click();
    await expect(comparison.getByText(structure.syncSuccess(2), { exact: true })).toBeVisible();
    expect((await observer.query('SELECT id, label FROM sync_subject'))[0]).toEqual([{ id: '1', label: 'default' }]);
    expect((await observer.query("SHOW INDEX FROM sync_subject WHERE Key_name = 'ix_label'"))[0]).toHaveLength(1);
    expect(pageErrors).toEqual([]);
    await comparison.screenshot({ path: info.outputPath('结构同步回执.png') });
    await confirmOwnedDesktopExit(info);
  } catch (error) {
    retainOwnedDesktopResources(info);
    throw error;
  } finally { await observer.end(); }
});
