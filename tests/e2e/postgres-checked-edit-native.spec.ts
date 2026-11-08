import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { desktop, page, expect, test, confirmOwnedDesktopExit, retainOwnedDesktopResources, pageErrors } from './desktop-fixture';
import { postgresBatchFillZh as collectText } from '../../src/renderer/locales/postgresBatchFill.zh-CN';
import { postgresBatchEditZh as text } from '../../src/renderer/locales/postgresBatchEdit.zh-CN';
import { postgresTableZh as tableText } from '../../src/renderer/locales/postgresTable.zh-CN';
import { draftHistoryZh as history } from '../../src/renderer/locales/draftHistory.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import { installTableWorkspaceConfirmation } from './table-workspace-live-gate';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });
test.skip(process.env.DBARK_POSTGRES_CHECKED_EDIT_NATIVE !== '1', '需要本轮隔离 PostgreSQL');

for (const mode of ['commit', 'rollback'] as const) {
  test('PostgreSQL 跨页逐条编辑保留原令牌并整批事务 ' + mode, async ({}, info) => {
    const database = process.env.DBARK_POSTGRES_TEST_DATABASE ?? '', user = process.env.DBARK_POSTGRES_TEST_USER;
    const password = process.env.DBARK_POSTGRES_TEST_PASSWORD ?? '', port = Number(process.env.DBARK_POSTGRES_TEST_PORT);
    if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pg_[a-f0-9]{12}$/.test(database) || user !== database ||
        !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('需要本轮独占回环库');
    const observer = new Client({ host: '127.0.0.1', port, database, user, password, connectionTimeoutMillis: 5000 });
    const target = mode === 'commit' ? '"public"."checked_edit_commit"' : '"public"."checked_edit_rollback"';
    const disk = async () => (await observer.query("SELECT id::int AS id, note, amount::text AS amount, encode(payload, 'hex') AS payload FROM " + target + ' ORDER BY id')).rows;
    try {
      await observer.connect();
      await observer.query('CREATE TABLE ' + target + ' (id bigint PRIMARY KEY, note text, amount numeric(28,12), payload bytea)');
      await observer.query("INSERT INTO " + target + " SELECT id, '记录 ' || id, CASE WHEN id = 2 THEN 1234567890123456.123456789012 END, CASE WHEN id = 2 THEN decode('00ff','hex') END FROM generate_series(1,5) id");
      if (mode === 'rollback') {
        await observer.query(`CREATE FUNCTION public.fail_second_checked_edit() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN
            IF OLD.id = 4 THEN
              IF EXISTS (SELECT 1 FROM public.checked_edit_rollback WHERE id = 2 AND note = '记录 2') THEN
                RAISE EXCEPTION '首条更新尚未执行';
              END IF;
              RAISE EXCEPTION '已执行首条，第二条更新被拒绝';
            END IF;
            RETURN NEW;
          END $$;
          CREATE TRIGGER fail_second BEFORE UPDATE ON public.checked_edit_rollback
          FOR EACH ROW EXECUTE FUNCTION public.fail_second_checked_edit();`);
      }
      const connectionId = await page.evaluate(async profile => (await window.dbark.invoke('connections.save', profile)).id, {
        id: '', name: '跨页逐条编辑专项', dialect: 'postgresql' as const, group: '', color: '#123456', host: '127.0.0.1',
        port, user, password, database, rememberPassword: false,
      });
      await page.evaluate(async ({ connectionId, database, target }) => {
        const settings = await window.dbark.invoke('settings.get', {});
        await window.dbark.invoke('settings.save', { ...settings, pageSize: 2, activeTabId: 'checked-edit',
          tabs: [{ id: 'checked-edit', title: '跨页逐条编辑', kind: 'table', connectionId, database, table: target }] });
      }, { connectionId, database, target });
      await page.reload();

      const tab = page.locator('.postgres-table-tab:visible');
      const controls = tab.getByRole('group', { name: collectText.collectRegion, exact: true });
      const row = (n: number) => tab.getByRole('gridcell', { name: '记录 ' + n, exact: true }).locator('..');
      const button = (name: string) => tab.getByRole('button', { name, exact: true });
      const modal = page.getByRole('dialog', { name: text.collectedTitle, exact: true });
      const preview = page.getByRole('dialog', { name: tableText.preview, exact: true });
      const tasks = () => page.evaluate(() => window.dbark.invoke('tasks.list', {}));
      const baseline = await disk(), firstNote = '第一页独立值', secondNote = '第二页独立值', amount = '9007199254740993.123456789012';
      expect(baseline).toEqual([1, 2, 3, 4, 5].map(id => ({ id, note: '记录 ' + id,
        amount: id === 2 ? '1234567890123456.123456789012' : null, payload: id === 2 ? '00ff' : null })));

      await row(2).getByRole('checkbox').check();
      await button(collectText.collect).click();
      await expect(controls.getByRole('status')).toHaveText(collectText.collectedCount(1, 1));
      await button(tableText.next).click();
      await row(4).getByRole('checkbox').check();
      await button(collectText.collect).click();
      await expect(controls.getByRole('status')).toHaveText(collectText.collectedCount(2, 2));
      const before = await tasks();
      const open = () => button(text.collectedAction).click();
      const select = (sourcePage: number) => modal.getByRole('button', { name: text.pageRow(sourcePage, 2), exact: true }).click();
      const field = (name: string) => modal.getByRole('textbox', { name: name + ' ' + tableText.value, exact: true });
      async function edit(name: string, value: string) {
        await modal.getByRole('combobox', { name: name + ' ' + tableText.valueMode, exact: true }).selectOption('text');
        await field(name).fill(value);
      }
      await open();
      await expect(modal).toContainText(collectText.pageCount(1, 1));
      await expect(modal).toContainText(collectText.pageCount(2, 1));
      await edit('note', '取消时丢弃');
      await select(2);
      await modal.getByRole('button', { name: tableText.cancel, exact: true }).click();
      await expect(controls.getByRole('status')).toHaveText(collectText.collectedCount(2, 2));
      expect(await disk()).toEqual(baseline);

      await open();
      await expect(modal).toContainText('记录 2');
      await edit('note', firstNote);
      await select(2);
      await expect(modal).toContainText('记录 4');
      await edit('note', secondNote);
      await edit('amount', amount);
      await select(1);
      await expect(field('note')).toHaveValue(firstNote);
      await select(2);
      await expect(field('note')).toHaveValue(secondNote);
      await expect(field('amount')).toHaveValue(amount);
      const stage = modal.getByRole('button', { name: text.stage, exact: true });
      await expect(stage).toBeInViewport();
      await page.screenshot({ path: info.outputPath('PostgreSQL跨页逐条编辑-' + mode + '.png') });
      await stage.click();
      await expect(tab).toContainText(tableText.changes(2));
      await expect(controls.getByRole('status')).toHaveText(collectText.collectedCount(2, 2));
      await expect(tab.getByRole('gridcell', { name: secondNote, exact: true })).toBeVisible();
      expect(await tasks()).toEqual(before);
      expect(await disk()).toEqual(baseline);

      await button(text.undo).click();
      await expect(row(4)).toBeVisible();
      await button(tableText.next).click();
      await expect(row(5)).toBeVisible();
      await tab.getByRole('button', { name: new RegExp('^' + history.redo) }).click();
      await expect(tab).toContainText(tableText.changes(2));
      await button(tableText.preview).click();
      await expect(preview.locator('pre')).toHaveCount(2);
      await expect(preview.locator('pre').first()).toContainText('UPDATE');
      await expect(preview.locator('pre').last()).toContainText('UPDATE');
      expect(await disk()).toEqual(baseline);
      await preview.getByRole('button', { name: tableText.apply, exact: true }).click();
      await expect(preview).toBeHidden();
      if (mode === 'rollback') {
        await expect(tab).toContainText('整批已回滚');
        await expect(tab).toContainText('已执行首条，第二条更新被拒绝');
        expect(await disk()).toEqual(baseline);
        await expect(tab).toContainText(tableText.changes(2));
        const owner = 'dbark-table-workspace:' + randomBytes(16).toString('hex');
        await desktop.evaluate(installTableWorkspaceConfirmation, { owner, expected: zh.app.text002, choice: 'accept' as const });
      } else {
        await expect(tab).toContainText('PostgreSQL已确认整批提交');
        expect(await disk()).toEqual(baseline.map(row => row.id === 2 ? { ...row, note: firstNote }
          : row.id === 4 ? { ...row, note: secondNote, amount } : row));
      }
      expect(pageErrors).toEqual([]);
      await confirmOwnedDesktopExit(info);
    } catch (reason) {
      retainOwnedDesktopResources(info);
      throw reason;
    } finally { await observer.end(); }
  });
}
