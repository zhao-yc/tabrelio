import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { desktop, page, dataDir, expect, test, confirmOwnedDesktopExit, retainOwnedDesktopResources, pageErrors } from './desktop-fixture';
import { sqliteEditWorkspaceZh as workspaceText } from '../../src/renderer/locales/sqliteEditWorkspace.zh-CN';
import { sqliteTableBrowseZh as browseText } from '../../src/renderer/locales/sqliteTableBrowse.zh-CN';
import { sqliteTableEditZh as editText } from '../../src/renderer/locales/sqliteTableEdit.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import { installTableWorkspaceConfirmation, readTableWorkspaceConfirmations } from './table-workspace-live-gate';

const active = process.env.DBARK_SQLITE_CHECKED_DELETE_NATIVE_TEST === '1';
test.skip(!active, '需要显式启用隔离 SQLite 原生验收');
test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });

for (const mode of ['commit', 'rollback'] as const) {
  test('SQLite 跨页勾选删除、逐页撤销及集中事务 ' + mode, async ({}, info) => {
    if (process.env.DBARK_INTEGRATION_ENABLED !== '0' || process.env.DBARK_EXECUTABLE_PATH || process.env.DBARK_DEV_URL)
      throw Error('只允许本例离线 SQLite 源码验收');
    const path = join(realpathSync(dataDir), '跨页勾选删除.sqlite'), id = 'sqlite-checked-delete';
    const db = new DatabaseSync(path);
    try { db.exec(`CREATE TABLE subject(id INTEGER PRIMARY KEY, note TEXT);
      INSERT INTO subject VALUES (1, '记录 1'), (2, '记录 2'), (3, '记录 3'), (4, '记录 4'), (5, '记录 5');`); }
    finally { db.close(); }
    /** 观察端只读取本例磁盘文件的实际行，不从产品预览推导事务结果。 */
    function disk() {
      const reader = new DatabaseSync(path, { readOnly: true });
      try { return reader.prepare('SELECT id, note FROM subject ORDER BY id').all(); }
      finally { reader.close(); }
    }
    const before = disk();
    try {
      await desktop.evaluate(({ dialog, BrowserWindow }, path) => {
        const original = dialog.showOpenDialog;
        dialog.showOpenDialog = (async (...args: unknown[]) => {
          dialog.showOpenDialog = original;
          if (args[0] !== BrowserWindow.getAllWindows()[0] || !(args.at(-1) as Electron.OpenDialogOptions).filters?.[0]?.extensions.includes('sqlite'))
            throw Error('只允许本窗口选择合成 SQLite 文件');
          return { canceled: false, filePaths: [path] };
        }) as typeof original;
      }, path);
      await page.evaluate(async id => {
        const file = await window.dbark.invoke('files.choose', { purpose: 'sqlite-database', sqliteConnectionId: id });
        if (!file) throw Error('本例文件未获授权');
        const profile = await window.dbark.invoke('connections.save', { id, name: 'SQLite 跨页勾选专项', dialect: 'sqlite', group: '', color: '#123456',
          sqlite: { fileToken: file.token, readOnly: false, busyTimeoutMs: 1000 } });
        const settings = await window.dbark.invoke('settings.get', {});
        await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'checked-delete',
          tabs: [{ id: 'checked-delete', title: '跨页删除', kind: 'table', connectionId: profile.id, database: 'main', table: 'subject' }] });
      }, id);
      await page.reload();
      const tab = page.locator('.sqlite-table-tab:visible'), workspace = tab.getByRole('region', { name: workspaceText.region, exact: true });
      const row = (number: number) => tab.getByRole('gridcell', { name: 'INTEGER · ' + number, exact: true }).locator('..');
      const check = (number: number) => row(number).getByRole('checkbox');
      const pageButton = (offset: number) => workspace.getByRole('button', { name: workspaceText.page(offset, 2), exact: true });
      const deleteChecked = workspace.getByRole('button', { name: workspaceText.deleteChecked, exact: true });
      const preview = page.getByRole('dialog', { name: editText.previewTitle, exact: true });
      const button = (name: string) => tab.getByRole('button', { name, exact: true });
      const tasks = () => page.evaluate(() => window.dbark.invoke('tasks.list', {}));
      await expect(row(1)).toBeVisible();
      await tab.getByRole('textbox', { name: browseText.pageSizeLabel, exact: true }).fill('2');
      await button(browseText.pageSizeApply).click();
      await expect(row(3)).toHaveCount(0);
      await check(2).check();
      await button(browseText.next).click();
      await check(3).check();
      await expect(pageButton(0)).toContainText(workspaceText.checked(1));
      await expect(pageButton(2)).toContainText(workspaceText.checked(1));
      const cached = await tasks();
      await pageButton(0).click();
      await expect(check(2)).toBeChecked();
      await pageButton(2).click();
      await expect(check(3)).toBeChecked();
      expect(await tasks()).toEqual(cached);

      const owner = 'dbark-table-workspace:' + randomBytes(16).toString('hex');
      const expected = workspaceText.deleteConfirm([{ index: 1, count: 1 }, { index: 2, count: 1 }]);
      await desktop.evaluate(installTableWorkspaceConfirmation, { owner, expected, choice: 'reject' as const });
      await deleteChecked.click();
      await expect(workspace).toContainText(workspaceText.summary(2, 0));
      await expect(check(3)).toBeChecked();
      await desktop.evaluate(installTableWorkspaceConfirmation, { owner, expected, choice: 'accept' as const });
      await deleteChecked.click();
      expect((await desktop.evaluate(readTableWorkspaceConfirmations, owner)).map(item => item.choice)).toEqual(['reject', 'accept']);
      await expect(workspace).toContainText(workspaceText.summary(2, 2));
      await expect(row(3)).toHaveClass(/row-deleted/);
      await expect(check(3)).not.toBeChecked();
      expect(await tasks()).toEqual(cached);
      expect(disk()).toEqual(before);
      await page.screenshot({ path: info.outputPath('SQLite跨页勾选删除-' + mode + '.png') });

      await pageButton(0).click();
      await expect(row(2)).toHaveClass(/row-deleted/);
      await button(editText.undo).click();
      await expect(row(2)).not.toHaveClass(/row-deleted/);
      await expect(workspace).toContainText(workspaceText.summary(2, 1));
      await button(editText.redo).click();
      await expect(workspace).toContainText(workspaceText.summary(2, 2));
      await button(editText.preview).click();
      await expect(preview).toContainText(workspaceText.previewPages(2));
      await expect(preview).toContainText(editText.counts(0, 0, 2));
      expect(disk()).toEqual(before);

      if (mode === 'rollback') {
        const writer = new DatabaseSync(path);
        try { writer.exec("UPDATE subject SET note='外部修改' WHERE id=3"); }
        finally { writer.close(); }
      }
      await preview.getByRole('checkbox', { name: editText.confirmation, exact: true }).check();
      await preview.getByRole('button', { name: editText.submit, exact: true }).click();
      if (mode === 'rollback') {
        await expect(preview.locator('.error-box')).toContainText('整批回滚');
        expect(disk()).toEqual(before.map(item => item.id === 3 ? { id: 3, note: '外部修改' } : item));
        await preview.getByRole('button', { name: editText.closePreview, exact: true }).click();
        await expect(workspace).toContainText(workspaceText.summary(2, 2));
        await pageButton(2).click();
        await expect(row(3)).toHaveClass(/row-deleted/);
        await desktop.evaluate(installTableWorkspaceConfirmation, { owner, expected: zh.app.text002, choice: 'accept' as const });
      } else {
        await expect(preview).toBeHidden();
        await expect(row(4)).toBeVisible();
        expect(disk()).toEqual(before.filter(item => item.id !== 2 && item.id !== 3));
      }
      await expect.poll(async () => (await tasks()).filter(task => task.kind === 'sqlite.tableEdit.apply').map(task => task.sqliteWrite?.phase))
        .toEqual([mode === 'rollback' ? 'rolled-back' : 'committed']);
      expect(pageErrors).toEqual([]);
      await confirmOwnedDesktopExit(info);
    } catch (reason) {
      retainOwnedDesktopResources(info);
      throw reason;
    }
  });
}
