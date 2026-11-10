import type { NetworkConnectionProfile } from '../../src/shared/contracts';
import { referenceZh as text } from '../../src/renderer/locales/references.zh-CN';
import { confirmOwnedDesktopExit, expect, page, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });

const table = 'child';
test('从外键格限定约束并将复合父键暂存到右键命中的记录', async ({}, info) => {
  const dialect = process.env.DBARK_CELL_REF_DIALECT;
  test.skip(!dialect, '需要显式启用独占外键选择实库');
  const database = process.env.DBARK_CELL_REF_DATABASE ?? '', password = process.env.DBARK_CELL_REF_PASSWORD ?? '';
  const port = Number(process.env.DBARK_CELL_REF_PORT);
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
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'cell-ref-table',
        tabs: [{ id: 'cell-ref-table', kind: 'table', title: table, connectionId: connection.id, database, table }] });
      return connection.id;
    }, { profile, database, table });
    await page.reload();
    const scope = page.locator('.table-tab:visible');
    const readServer = () => page.evaluate(async ({ connectionId, database, table }) => {
      const result = await window.dbark.invoke('table.page', {
        connectionId, database, table, page: 1, pageSize: 20, filters: [], sort: [{ column: 'id', direction: 'ASC' }],
      });
      return result.rows.map(row => [row.a, String(row.b), row.note]);
    }, { connectionId, database, table });
    const cell = (value: string) => scope.getByRole('gridcell', { name: value, exact: true });
    const modal = page.getByRole('dialog', { name: text.choose, exact: true });
    const constraint = modal.getByRole('combobox', { name: text.constraint, exact: true });
    const constraints = constraint.locator('option');
    const menu = page.getByRole('menuitem', { name: text.choose, exact: true });
    const shortcut = process.platform === 'darwin' ? 'Meta' : 'Control';
    const baseline = [['甲组', '9007199254740993', '第一条'], ['乙组', '9007199254740995', '第二条']];
    await expect(cell('9007199254740993')).toBeVisible();
    expect(await readServer()).toEqual(baseline);

    await cell('9007199254740993').click();
    await page.keyboard.press(shortcut + '+Enter');
    await expect(constraints).toHaveCount(2);
    await expect(constraints.filter({ hasText: /^fk_pair$/ })).toHaveCount(1);
    await expect(constraints.filter({ hasText: /^fk_alternative$/ })).toHaveCount(1);
    // 实际切换到另一约束并等待读取完成，避免把关闭时的取消结算误当成网格已空闲。
    await constraint.selectOption('fk_alternative');
    await expect(modal.getByRole('columnheader', { name: /^id\b/ })).toBeVisible();
    await modal.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(modal).toHaveCount(0);
    await expect(scope.locator('.loading-overlay')).toHaveCount(0);

    await cell('第一条').click({ button: 'right' });
    await expect(page.getByRole('menu')).toBeVisible();
    await expect(menu).toHaveCount(0);
    await page.keyboard.press('Escape');

    await cell('甲组').click();
    await cell('乙组').click({ button: 'right' });
    await expect(menu).toBeVisible();
    await page.screenshot({ path: info.outputPath('命中外键单元格菜单.png') });
    await menu.click();
    await expect(constraints).toHaveText(['fk_pair']);
    await expect(modal.getByText(text.columnScope('a'), { exact: true })).toBeVisible();
    const candidate = modal.getByRole('gridcell', { name: '目标配对', exact: true });
    await modal.getByRole('gridcell', { name: '起始一', exact: true }).click();
    await page.screenshot({ path: info.outputPath('命中字段的父键候选.png') });
    await candidate.dblclick();
    await expect(modal).toHaveCount(0);

    // 仅命中的第二条记录改变，且超出 JS 安全整数范围的键值保持精确。
    await expect(cell('第二条').locator('..')).toContainText('目标组');
    await expect(cell('第二条').locator('..')).toContainText('9007199254740997');
    await expect(cell('第一条').locator('..')).toContainText('9007199254740993');
    expect(await readServer()).toEqual(baseline);

    await cell('目标组').click();
    await page.keyboard.press(shortcut + '+z');
    await expect(cell('乙组')).toBeVisible();
    await expect(cell('9007199254740995')).toBeVisible();
    await page.keyboard.press(shortcut + '+Shift+z');
    await expect(cell('目标组')).toBeVisible();

    await cell('目标组').click();
    await page.keyboard.press(shortcut + '+Shift+Enter');
    const preview = page.getByRole('dialog', { name: '确认数据修改', exact: true });
    await expect(preview.locator('.monaco-editor .view-lines')).toContainText('9007199254740997');
    expect(await readServer()).toEqual(baseline);
    await preview.getByRole('button', { name: '确认提交', exact: true }).click();
    await expect(preview).toHaveCount(0);
    await expect.poll(readServer).toEqual([baseline[0], ['目标组', '9007199254740997', '第二条']]);
    await expect(scope.locator('.row-modified')).toHaveCount(0);
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  }
});
