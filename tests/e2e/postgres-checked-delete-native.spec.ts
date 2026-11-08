import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { desktop, page, expect, test, confirmOwnedDesktopExit, retainOwnedDesktopResources, pageErrors } from './desktop-fixture';
import { postgresBatchDeleteZh as text } from '../../src/renderer/locales/postgresBatchDelete.zh-CN';
import { postgresTableZh as tableText } from '../../src/renderer/locales/postgresTable.zh-CN';
import { draftHistoryZh as history } from '../../src/renderer/locales/draftHistory.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import { installTableWorkspaceConfirmation } from './table-workspace-live-gate';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });
test.skip(process.env.DBARK_POSTGRES_CHECKED_DELETE_NATIVE !== '1', '需要本轮隔离 PostgreSQL');

for (const mode of ['commit', 'rollback'] as const) {
  test('PostgreSQL 跨页删除保留原令牌并整批事务 ' + mode, async ({}, info) => {
    const database = process.env.DBARK_POSTGRES_TEST_DATABASE ?? '', user = process.env.DBARK_POSTGRES_TEST_USER;
    const password = process.env.DBARK_POSTGRES_TEST_PASSWORD ?? '', port = Number(process.env.DBARK_POSTGRES_TEST_PORT);
    if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pg_[a-f0-9]{12}$/.test(database) || user !== database ||
        !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('需要本轮独占回环库');
    const observer = new Client({ host: '127.0.0.1', port, database, user, password, connectionTimeoutMillis: 5000 });
    const target = mode === 'commit' ? '"public"."checked_commit"' : '"public"."checked_rollback"';
    const readIds = async () => (await observer.query('SELECT id::int AS id FROM ' + target + ' ORDER BY id')).rows.map(row => row.id);
    try {
      await observer.connect();
      await observer.query('CREATE TABLE ' + target + ' (id bigint PRIMARY KEY, note text)');
      await observer.query("INSERT INTO " + target + " SELECT id, '记录 ' || id FROM generate_series(1,5) id");
      if (mode === 'rollback') {
        await observer.query(`CREATE FUNCTION public.fail_second_checked_delete() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN
            IF OLD.id = 3 THEN
              IF EXISTS (SELECT 1 FROM public.checked_rollback WHERE id = 2) THEN
                RAISE EXCEPTION '首条删除尚未执行';
              END IF;
              RAISE EXCEPTION '已执行首条，第二条删除被拒绝';
            END IF;
            RETURN OLD;
          END $$;
          CREATE TRIGGER fail_second BEFORE DELETE ON public.checked_rollback
          FOR EACH ROW EXECUTE FUNCTION public.fail_second_checked_delete();`);
      }
      const connectionId = await page.evaluate(async profile => (await window.dbark.invoke('connections.save', profile)).id, {
        id: '', name: '跨页删除专项', dialect: 'postgresql' as const, group: '', color: '#123456', host: '127.0.0.1',
        port, user, password, database, rememberPassword: false,
      });
      await page.evaluate(async ({ connectionId, database, target }) => {
        const settings = await window.dbark.invoke('settings.get', {});
        await window.dbark.invoke('settings.save', { ...settings, pageSize: 2, activeTabId: 'checked-delete',
          tabs: [{ id: 'checked-delete', title: '跨页删除', kind: 'table', connectionId, database, table: target }] });
      }, { connectionId, database, target });
      await page.reload();

      const tab = page.locator('.postgres-table-tab:visible');
      const controls = tab.getByRole('group', { name: text.collectRegion, exact: true });
      const row = (n: number) => tab.getByRole('gridcell', { name: '记录 ' + n, exact: true }).locator('..');
      const button = (name: string) => tab.getByRole('button', { name, exact: true });
      const modal = page.getByRole('dialog', { name: text.collectedTitle, exact: true });
      const preview = page.getByRole('dialog', { name: tableText.preview, exact: true });
      const tasks = () => page.evaluate(() => window.dbark.invoke('tasks.list', {}));
      const baseline = [1, 2, 3, 4, 5];

      await row(2).getByRole('checkbox').check();
      await button(text.collect).click();
      await expect(controls.getByRole('status')).toHaveText(text.collectedCount(1, 1));
      await button(tableText.next).click();
      await row(3).getByRole('checkbox').check();
      await button(text.collect).click();
      await expect(controls.getByRole('status')).toHaveText(text.collectedCount(2, 2));
      const before = await tasks();
      await button(text.collectedAction).click();
      await expect(modal.getByRole('cell', { name: 'id = 2', exact: true })).toBeVisible();
      await expect(modal.getByRole('cell', { name: 'id = 3', exact: true })).toBeVisible();
      await modal.getByRole('button', { name: tableText.cancel, exact: true }).click();
      await expect(controls.getByRole('status')).toHaveText(text.collectedCount(2, 2));
      expect(await readIds()).toEqual(baseline);
      await button(text.collectedAction).click();
      await page.screenshot({ path: info.outputPath('PostgreSQL跨页删除确认-' + mode + '.png') });
      await modal.getByRole('button', { name: text.stage, exact: true }).click();
      await expect(tab).toContainText(tableText.changes(2));
      await expect(controls.getByRole('status')).toHaveCount(0);
      await expect(row(3).locator('.pg-grid-deleted')).not.toHaveCount(0);
      expect(await tasks()).toEqual(before);
      expect(await readIds()).toEqual(baseline);

      await button(text.undo).click();
      await expect(row(3).locator('.pg-grid-deleted')).toHaveCount(0);
      await button(tableText.next).click();
      await expect(row(5)).toBeVisible();
      await tab.getByRole('button', { name: new RegExp('^' + history.redo) }).click();
      await expect(tab).toContainText(tableText.changes(2));
      await button(tableText.preview).click();
      await expect(preview.locator('pre')).toHaveCount(2);
      await expect(preview.locator('pre').first()).toContainText('DELETE');
      await expect(preview.locator('pre').last()).toContainText('DELETE');
      expect(await readIds()).toEqual(baseline);
      await preview.getByRole('button', { name: tableText.apply, exact: true }).click();
      await expect(preview).toBeHidden();
      if (mode === 'rollback') {
        await expect(tab).toContainText('整批已回滚');
        await expect(tab).toContainText('已执行首条，第二条删除被拒绝');
        expect(await readIds()).toEqual(baseline);
        await expect(tab).toContainText(tableText.changes(2));
        const owner = 'dbark-table-workspace:' + randomBytes(16).toString('hex');
        await desktop.evaluate(installTableWorkspaceConfirmation, { owner, expected: zh.app.text002, choice: 'accept' as const });
      } else {
        await expect(tab).toContainText('PostgreSQL已确认整批提交');
        expect(await readIds()).toEqual([1, 4, 5]);
      }
      expect(pageErrors).toEqual([]);
      await confirmOwnedDesktopExit(info);
    } catch (reason) {
      retainOwnedDesktopResources(info);
      throw reason;
    } finally { await observer.end(); }
  });
}
