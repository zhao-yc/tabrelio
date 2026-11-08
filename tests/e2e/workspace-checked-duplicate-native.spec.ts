import { randomBytes } from 'node:crypto';
import { createConnection, type RowDataPacket } from 'mysql2/promise';
import { desktop, page, expect, test, confirmOwnedDesktopExit, retainOwnedDesktopResources, pageErrors } from './desktop-fixture';
import { tableEditWorkspaceZh as text } from '../../src/renderer/locales/tableEditWorkspace.zh-CN';
import { draftHistoryZh as history } from '../../src/renderer/locales/draftHistory.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import { navigationMenuItem } from './navigation-menu';
import { installTableWorkspaceConfirmation, readTableWorkspaceConfirmations } from './table-workspace-live-gate';
import type { NetworkConnectionProfile } from '../../src/shared/contracts';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });
test.skip(process.env.DBARK_WORKSPACE_CHECKED_DUPLICATE_NATIVE !== '1', '需要本轮回环隔离网络库');

test('跨页复制保留勾选范围，取消无修改，逐页撤销并集中提交', async ({}, info) => {
  const dialect = process.env.DBARK_CHECKED_DUPLICATE_DIALECT, database = process.env.DBARK_CHECKED_DUPLICATE_DATABASE ?? '';
  const user = process.env.DBARK_CHECKED_DUPLICATE_USER, password = process.env.DBARK_CHECKED_DUPLICATE_PASSWORD ?? '';
  const mode = process.env.DBARK_CHECKED_DUPLICATE_MODE;
  const port = Number(process.env.DBARK_CHECKED_DUPLICATE_PORT), host = '127.0.0.1';
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_cmp_[a-f0-9]{12}$/.test(database) ||
    user !== database || !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535 ||
    (dialect !== 'mysql' && dialect !== 'mariadb') || (mode !== 'commit' && mode !== 'rollback')) throw Error('需要本轮独占回环库');
  const profile: NetworkConnectionProfile = { id: '', name: '跨页复制专项', dialect, group: '', color: '#123456', host, port, user, password, database, rememberPassword: false };
  const observer = await createConnection({ host, port, user, password, database, connectTimeout: 5000 });
  const read = async () => (await observer.query<RowDataPacket[]>('SELECT id, note, amount, HEX(payload) AS payload, note_size AS noteSize FROM checked_rows ORDER BY id'))[0]
    .map(row => ({ id: Number(row.id), note: row.note, amount: row.amount, payload: row.payload, noteSize: row.noteSize }));
  try {
    const baseline = await read();
    expect(baseline).toEqual([1, 2, 3, 4, 5].map(id => ({ id, note: '记录 ' + id,
      amount: id === 2 ? '1234567890123456.123456789012' : null, payload: id === 2 ? '00FF' : null, noteSize: 4 })));
    const connectionId = await page.evaluate(async input => (await window.dbark.invoke('connections.save', input)).id, profile);
    await page.evaluate(async ({ connectionId, database }) => {
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, pageSize: 2, activeTabId: 'checked-duplicate',
        tabs: [{ id: 'checked-duplicate', title: '跨页复制', kind: 'table', connectionId, database, table: 'checked_rows' }] });
    }, { connectionId, database });
    await page.reload();
    const tab = page.locator('.table-tab:visible'), workspace = tab.getByRole('region', { name: text.region, exact: true });
    const check = (n: number) => tab.locator('[role="row"]:not(.row-inserted)')
      .filter({ has: page.getByRole('gridcell', { name: '记录 ' + n, exact: true }) }).getByRole('checkbox');
    const pageButton = (n: number) => workspace.getByRole('button', { name: text.page(n), exact: true });
    const duplicate = workspace.getByRole('button', { name: text.duplicateChecked, exact: true });
    const copies = tab.locator('.row-inserted');
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
    const expected = text.duplicateConfirm([{ index: 1, count: 1 }, { index: 2, count: 1 }]);
    await desktop.evaluate(installTableWorkspaceConfirmation, { owner, expected, choice: 'reject' as const });
    await duplicate.click();
    await expect(check(3)).toBeChecked();
    await expect(workspace).toContainText(text.summary(2, 0));
    expect(await tasks()).toEqual(before);
    await desktop.evaluate(installTableWorkspaceConfirmation, { owner, expected, choice: 'accept' as const });
    await duplicate.click();
    expect((await desktop.evaluate(readTableWorkspaceConfirmations, owner)).map(item => item.choice)).toEqual(['reject', 'accept']);
    await expect(workspace).toContainText(text.summary(2, 2));
    await expect(copies).toHaveCount(1);
    await expect(copies).toContainText('记录 3');
    await expect(check(3)).toBeChecked();
    await expect(copies.getByRole('checkbox')).not.toBeChecked();
    expect(await tasks()).toEqual(before);
    expect(await read()).toEqual(baseline);
    await page.screenshot({ path: info.outputPath('跨页勾选复制-' + dialect + '-' + mode + '.png') });

    await pageButton(1).click();
    await expect(copies).toContainText('记录 2');
    await (await navigationMenuItem(tab, { name: history.undo, exact: true })).click();
    await expect(copies).toHaveCount(0);
    await expect(workspace).toContainText(text.summary(2, 1));
    await pageButton(2).click();
    await expect(copies).toContainText('记录 3');
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
      await expect(copies).toContainText('记录 2');
      await pageButton(2).click();
      await expect(copies).toContainText('记录 3');
      // 关闭测试窗口时仅处理本例剩余草稿的明确确认。
      await desktop.evaluate(installTableWorkspaceConfirmation, { owner, expected: zh.app.text002, choice: 'accept' as const });
    } else {
      await expect(preview).toBeHidden();
      await expect.poll(receipt).toMatchObject({ outcome: 'committed',
        evidence: { dmlAcknowledged: 2, commitAcknowledged: true } });
      expect(await read()).toEqual([...baseline, { ...baseline[1], id: 6 }, { ...baseline[2], id: 7 }]);
      await expect(copies).toHaveCount(0);
    }
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  } finally { await observer.end(); }
});
