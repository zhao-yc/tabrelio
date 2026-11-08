import { randomBytes } from 'node:crypto';
import { createConnection, type RowDataPacket } from 'mysql2/promise';
import { desktop, page, expect, test, confirmOwnedDesktopExit, retainOwnedDesktopResources, pageErrors } from './desktop-fixture';
import { tableEditWorkspaceZh as text } from '../../src/renderer/locales/tableEditWorkspace.zh-CN';
import { recordBatchFillZh as fill } from '../../src/renderer/locales/recordBatchFill.zh-CN';
import { recordViewZh as record } from '../../src/renderer/locales/recordViews.zh-CN';
import { draftHistoryZh as history } from '../../src/renderer/locales/draftHistory.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import { navigationMenuItem } from './navigation-menu';
import { installTableWorkspaceConfirmation } from './table-workspace-live-gate';
import type { NetworkConnectionProfile } from '../../src/shared/contracts';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });
test.skip(process.env.DBARK_WORKSPACE_CHECKED_FILL_NATIVE !== '1', '需要本轮回环隔离网络库');

test('跨页填充保留勾选范围，取消无修改，逐页撤销并集中提交', async ({}, info) => {
  const dialect = process.env.DBARK_CHECKED_FILL_DIALECT, database = process.env.DBARK_CHECKED_FILL_DATABASE ?? '';
  const user = process.env.DBARK_CHECKED_FILL_USER, password = process.env.DBARK_CHECKED_FILL_PASSWORD ?? '';
  const mode = process.env.DBARK_CHECKED_FILL_MODE;
  const port = Number(process.env.DBARK_CHECKED_FILL_PORT), host = '127.0.0.1';
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_cmp_[a-f0-9]{12}$/.test(database) ||
    user !== database || !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535 ||
    (dialect !== 'mysql' && dialect !== 'mariadb') || (mode !== 'commit' && mode !== 'rollback')) throw Error('需要本轮独占回环库');
  const profile: NetworkConnectionProfile = { id: '', name: '跨页填充专项', dialect, group: '', color: '#123456', host, port, user, password, database, rememberPassword: false };
  const observer = await createConnection({ host, port, user, password, database, connectTimeout: 5000 });
  const read = async () => (await observer.query<RowDataPacket[]>('SELECT id, note, amount, HEX(payload) AS payload FROM checked_rows ORDER BY id'))[0]
    .map(row => ({ id: Number(row.id), note: row.note, amount: row.amount, payload: row.payload }));
  try {
    const baseline = await read(), note = '填充统一值', amount = '42.123456789012';
    expect(baseline).toEqual([1, 2, 3, 4, 5].map(id => ({ id, note: '记录 ' + id,
      amount: id === 2 ? '1234567890123456.123456789012' : null, payload: id === 2 ? '00FF' : null })));
    const connectionId = await page.evaluate(async input => (await window.dbark.invoke('connections.save', input)).id, profile);
    await page.evaluate(async ({ connectionId, database }) => {
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, pageSize: 2, activeTabId: 'checked-fill',
        tabs: [{ id: 'checked-fill', title: '跨页填充', kind: 'table', connectionId, database, table: 'checked_rows' }] });
    }, { connectionId, database });
    await page.reload();
    const tab = page.locator('.table-tab:visible'), workspace = tab.getByRole('region', { name: text.region, exact: true });
    const row = (n: number) => tab.getByRole('gridcell', { name: '记录 ' + n, exact: true }).locator('..');
    const check = (n: number) => row(n).getByRole('checkbox');
    const pageButton = (n: number) => workspace.getByRole('button', { name: text.page(n), exact: true });
    const fillChecked = workspace.getByRole('button', { name: text.fillChecked, exact: true });
    const dialog = page.getByRole('dialog', { name: fill.title, exact: true });
    const filledRow = () => tab.getByRole('gridcell', { name: note, exact: true }).locator('..');
    const apply = tab.getByRole('button', { name: zh.table.text019, exact: true });
    const preview = page.getByRole('dialog', { name: zh.table.text031, exact: true });
    const tasks = () => page.evaluate(() => window.dbark.invoke('tasks.list', {}));
    await check(2).check();
    await tab.getByRole('button', { name: zh.common.pageNext, exact: true }).click();
    await check(3).check();
    await expect(pageButton(1)).toHaveText('1 · ' + text.checked(1));
    await expect(pageButton(2)).toHaveText('2 · ' + text.checked(1));
    const before = await tasks();
    const owner = 'dbark-table-workspace:' + randomBytes(16).toString('hex');
    await fillChecked.click();
    await expect(dialog).toContainText(text.fillGroup(1, 1));
    await expect(dialog).toContainText(text.fillGroup(2, 1));
    await expect(dialog).toContainText('本次记录数：2');
    await dialog.getByRole('button', { name: zh.common.cancel, exact: true }).click();
    await expect(check(3)).toBeChecked();
    await expect(workspace).toContainText(text.summary(2, 0));
    expect(await tasks()).toEqual(before);

    await fillChecked.click();
    await dialog.getByRole('combobox', { name: fill.field, exact: true }).selectOption('note');
    await dialog.getByRole('textbox', { name: 'note · ' + record.value, exact: true }).fill(note);
    await dialog.getByRole('button', { name: fill.add, exact: true }).click();
    await dialog.getByRole('combobox', { name: fill.fieldAt(2), exact: true }).selectOption('amount');
    await dialog.getByRole('textbox', { name: 'amount · ' + record.value, exact: true }).fill(amount);
    await page.screenshot({ path: info.outputPath('跨页填充范围-' + dialect + '-' + mode + '.png') });
    await dialog.getByRole('button', { name: fill.stage, exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(workspace).toContainText(text.summary(2, 2));
    await expect(filledRow()).toHaveClass(/row-modified/);
    await expect(filledRow().getByRole('checkbox')).toBeChecked();
    expect(await tasks()).toEqual(before);
    expect(await read()).toEqual(baseline);

    await pageButton(1).click();
    await expect(filledRow()).toHaveClass(/row-modified/);
    await (await navigationMenuItem(tab, { name: history.undo, exact: true })).click();
    await expect(row(2)).not.toHaveClass(/row-modified/);
    await expect(workspace).toContainText(text.summary(2, 1));
    await pageButton(2).click();
    await expect(filledRow()).toHaveClass(/row-modified/);
    await pageButton(1).click();
    await (await navigationMenuItem(tab, { name: history.redo, exact: true })).click();
    await expect(workspace).toContainText(text.summary(2, 2));

    await apply.click();
    await expect(preview).toContainText(text.preview(2));
    expect(await read()).toEqual(baseline);
    await preview.getByRole('button', { name: zh.common.backToEdit, exact: true }).click();
    await expect(preview).toBeHidden();
    await apply.click();
    await expect(preview).toContainText(text.preview(2));
    await preview.getByRole('button', { name: zh.common.confirmApply, exact: true }).click();
    const receipt = () => page.evaluate(async () => (await window.dbark.invoke('table.applyReceipt.list', {})).items[0]);
    if (mode === 'rollback') {
      await expect(preview).toContainText('已确认目标表事务回滚');
      await expect.poll(receipt).toMatchObject({ outcome: 'rolled-back',
        evidence: { dmlAcknowledged: 1, rollbackAcknowledged: true, commitAcknowledged: false } });
      expect(await read()).toEqual(baseline);
      await preview.getByRole('button', { name: zh.common.backToEdit, exact: true }).click();
      await expect(workspace).toContainText(text.summary(2, 2));
      await expect(filledRow()).toHaveClass(/row-modified/);
      await pageButton(2).click();
      await expect(filledRow()).toHaveClass(/row-modified/);
      // 关闭测试窗口时仅处理本例剩余草稿的明确确认。
      await desktop.evaluate(installTableWorkspaceConfirmation, { owner, expected: zh.app.text002, choice: 'accept' as const });
    } else {
      await expect(preview).toBeHidden();
      await expect.poll(receipt).toMatchObject({ outcome: 'committed',
        evidence: { dmlAcknowledged: 2, commitAcknowledged: true } });
      expect(await read()).toEqual(baseline.map(row => row.id === 2 || row.id === 3 ? { ...row, note, amount } : row));
      await expect(filledRow()).toBeVisible();
      await expect(filledRow()).not.toHaveClass(/row-modified/);
    }
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  } finally { await observer.end(); }
});
