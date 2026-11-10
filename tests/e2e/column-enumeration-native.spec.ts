import type { NetworkConnectionProfile } from '../../src/shared/contracts';
import { columnEnumerationZh as text } from '../../src/renderer/locales/columnEnumeration.zh-CN';
import { recordViewZh as recordText } from '../../src/renderer/locales/recordViews.zh-CN';
import { formatText } from '../../src/renderer/locales/zh-CN';
import { confirmOwnedDesktopExit, expect, page, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });

const table = 'column_enumeration_subject';
test('在网格和记录表单选择 ENUM 与 SET，预览后按原标签提交', async ({}, info) => {
  const dialect = process.env.DBARK_ENUM_DIALECT;
  test.skip(!dialect, '需要显式启用独占枚举编辑实库');
  const database = process.env.DBARK_ENUM_DATABASE ?? '', password = process.env.DBARK_ENUM_PASSWORD ?? '';
  const port = Number(process.env.DBARK_ENUM_PORT);
  if (process.env.DBARK_DEV_URL || process.env.DBARK_EXECUTABLE_PATH || process.env.DBARK_INTEGRATION_ENABLED !== '1' ||
      !['mysql', 'mariadb'].includes(dialect!) || !/^tabrelio_cn_[a-f0-9]{12}$/.test(database) || !/^[a-f0-9]{64}$/.test(password) ||
      !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本例独占回环实库');
  const profile: NetworkConnectionProfile = {
    id: '', dialect: dialect as 'mysql' | 'mariadb', name: dialect!, group: '', color: '#123456',
    host: '127.0.0.1', port, database, user: database, password, rememberPassword: false,
  };
  try {
    const connectionId = await page.evaluate(async ({ profile, database, table }) => {
      const connection = await window.dbark.invoke('connections.save', profile);
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'enum-table',
        tabs: [{ id: 'enum-table', kind: 'table', title: table, connectionId: connection.id, database, table }] });
      return connection.id;
    }, { profile, database, table });
    await page.reload();
    const scope = page.locator('.table-tab:visible');
    const readServer = () => page.evaluate(async ({ connectionId, database, table }) => {
      const result = await window.dbark.invoke('table.page', { connectionId, database, table, page: 1, pageSize: 20, filters: [], sort: [] });
      return result.rows.map(row => [row.status, row.flags, row.locked_status]);
    }, { connectionId, database, table });
    const cell = async (key: string, row = 2) => {
      const header = scope.getByRole('columnheader').filter({ hasText: new RegExp('^' + key + '(?:ENUM|SET|$)', 'i') });
      await expect(header).toBeVisible();
      const index = await header.getAttribute('aria-colindex');
      return scope.locator(`[role="row"][aria-rowindex="${row}"] [role="gridcell"][aria-colindex="${index}"]`);
    };
    const modal = (key: string) => page.getByRole('dialog', { name: formatText(recordText.cellTitle, key), exact: true });
    const pick = (key: string) => modal(key).getByRole('combobox', { name: text.enum, exact: true });
    const stage = async (key: string) => {
      await modal(key).getByRole('button', { name: recordText.stageCell, exact: true }).click();
      await expect(modal(key)).toHaveCount(0);
    };
    const status = await cell('status'), flags = await cell('flags'), nullable = await cell('status', 3);
    await expect(status).toHaveText('new');
    const baseline = [['new', 'beta', 'new'], [null, '', null]];
    expect(await readServer()).toEqual(baseline);

    await status.dblclick();
    await expect(pick('status')).toBeFocused();
    await expect(pick('status').locator('option')).toHaveText(['new', text.empty, "O'Reilly", 'C:\\temp', 'JSON ready', 'a,b', '汉字']);
    await pick('status').selectOption({ label: 'C:\\temp' });
    await page.screenshot({ path: info.outputPath('ENUM成员下拉.png') });
    await stage('status');
    await expect(status).toHaveText('C:\\temp');
    await flags.click();
    await page.keyboard.press('Enter');
    const set = modal('flags');
    await expect(set.getByRole('checkbox', { name: 'beta', exact: true })).toBeChecked();
    await set.getByRole('checkbox', { name: 'omega', exact: true }).check();
    await set.getByRole('checkbox', { name: 'alpha', exact: true }).check();
    await set.getByRole('checkbox', { name: 'beta', exact: true }).uncheck();
    await page.screenshot({ path: info.outputPath('SET成员勾选.png') });
    await stage('flags');
    await expect(flags).toHaveText('alpha,omega');

    // SQL NULL 与空枚举标签用两种明确输入模式，右键入口同样进入原字段弹窗。
    await nullable.click({ button: 'right' });
    await page.getByRole('menuitem', { name: text.choose, exact: true }).click();
    const mode = modal('status').getByRole('combobox', { name: recordText.mode, exact: true });
    await expect(mode).toHaveValue('null');
    await expect(pick('status')).toHaveCount(0);
    await mode.selectOption('text');
    await expect(pick('status').locator('option:checked')).toHaveText(text.empty);
    await stage('status');
    await expect(nullable).toHaveText('');
    await status.click();
    await (await navigationMenuItem(scope, { name: recordText.title, exact: true })).click();
    const form = scope.getByRole('complementary', { name: recordText.title, exact: true });
    const statusField = form.getByRole('region', { name: 'status', exact: true });
    await statusField.getByRole('button', { name: recordText.editField, exact: true }).click();
    const formChoice = statusField.getByRole('combobox', { name: text.enum, exact: true });
    await expect(formChoice.locator('option:checked')).toHaveText('C:\\temp');
    await formChoice.selectOption({ label: "O'Reilly" });
    await form.getByRole('button', { name: recordText.stage, exact: true }).click();
    await form.getByRole('button', { name: recordText.close, exact: true }).click();
    await expect(status).toHaveText("O'Reilly");
    expect(await readServer()).toEqual(baseline);
    await (await navigationMenuItem(scope, { name: '预览并提交', exact: true })).click();
    const preview = page.getByRole('dialog', { name: '确认数据修改', exact: true });
    await expect(preview.locator('.monaco-editor .view-lines')).toContainText('UPDATE');
    expect(await readServer()).toEqual(baseline);
    await preview.getByRole('button', { name: '确认提交', exact: true }).click();
    await expect(preview).toHaveCount(0);
    await expect.poll(readServer).toEqual([["O'Reilly", 'alpha,omega', "O'Reilly"], ['', '', '']]);
    await expect(scope.locator('.row-modified')).toHaveCount(0);
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  }
});
