import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { desktop, page, expect, test, confirmOwnedDesktopExit, retainOwnedDesktopResources, pageErrors } from './desktop-fixture';
import { postgresBatchDuplicateZh as text } from '../../src/renderer/locales/postgresBatchDuplicate.zh-CN';
import { postgresTableZh as tableText } from '../../src/renderer/locales/postgresTable.zh-CN';
import { draftHistoryZh as history } from '../../src/renderer/locales/draftHistory.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import { installTableWorkspaceConfirmation } from './table-workspace-live-gate';

test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });
test.skip(process.env.DBARK_POSTGRES_CHECKED_DUPLICATE_NATIVE !== '1', '需要本轮隔离 PostgreSQL');

for (const mode of ['manual', 'no-key', 'rollback'] as const) {
  test('PostgreSQL 跨页复制保留原令牌并整批事务 ' + mode, async ({}, info) => {
    const database = process.env.DBARK_POSTGRES_TEST_DATABASE ?? '', user = process.env.DBARK_POSTGRES_TEST_USER;
    const password = process.env.DBARK_POSTGRES_TEST_PASSWORD ?? '', port = Number(process.env.DBARK_POSTGRES_TEST_PORT);
    if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pg_[a-f0-9]{12}$/.test(database) || user !== database ||
        !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('需要本轮独占回环库');
    const observer = new Client({ host: '127.0.0.1', port, database, user, password, connectionTimeoutMillis: 5000 });
    const target = '"public"."checked_' + mode.replace('-', '_') + '"';
    const disk = async () => (await observer.query("SELECT id::int AS id, note, amount::text AS amount, encode(payload, 'hex') AS payload, ordinal::int AS ordinal, note_size::int AS size FROM " + target + ' ORDER BY id')).rows;
    try {
      await observer.connect();
      const identity = mode === 'manual' ? 'PRIMARY KEY' : 'GENERATED ALWAYS AS IDENTITY' + (mode === 'rollback' ? ' PRIMARY KEY' : '');
      await observer.query('CREATE TABLE ' + target + ' (id bigint ' + identity +
        ', note text, amount numeric(28,12), payload bytea, ordinal bigserial, note_size int GENERATED ALWAYS AS (length(note)) STORED)');
      if (mode === 'manual') {
        await observer.query("INSERT INTO " + target + " (id,note,amount,payload) SELECT id, '记录 ' || id, CASE WHEN id = 2 THEN 1234567890123456.123456789012 END, CASE WHEN id = 2 THEN decode('00ff','hex') END FROM generate_series(1,5) id");
      } else {
        await observer.query("INSERT INTO " + target + " (note,amount,payload) SELECT '记录 ' || id, CASE WHEN id = 2 THEN 1234567890123456.123456789012 END, CASE WHEN id = 2 THEN decode('00ff','hex') END FROM generate_series(1,5) id");
      }
      if (mode === 'rollback') {
        await observer.query(`CREATE FUNCTION public.fail_second_checked_duplicate() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN
            IF NEW.note = '记录 3' THEN
              IF (SELECT count(*) FROM public.checked_rollback WHERE note = '记录 2') <> 2 THEN
                RAISE EXCEPTION '首条复制尚未执行';
              END IF;
              RAISE EXCEPTION '已执行首条，第二条复制被拒绝';
            END IF;
            RETURN NEW;
          END $$;
          CREATE TRIGGER fail_second BEFORE INSERT ON public.checked_rollback
          FOR EACH ROW EXECUTE FUNCTION public.fail_second_checked_duplicate();`);
      }
      const connectionId = await page.evaluate(async profile => (await window.dbark.invoke('connections.save', profile)).id, {
        id: '', name: '跨页复制专项', dialect: 'postgresql' as const, group: '', color: '#123456', host: '127.0.0.1',
        port, user, password, database, rememberPassword: false,
      });
      await page.evaluate(async ({ connectionId, database, target }) => {
        const settings = await window.dbark.invoke('settings.get', {});
        await window.dbark.invoke('settings.save', { ...settings, pageSize: 2, activeTabId: 'checked-duplicate',
          tabs: [{ id: 'checked-duplicate', title: '跨页复制', kind: 'table', connectionId, database, table: target }] });
      }, { connectionId, database, target });
      await page.reload();

      const tab = page.locator('.postgres-table-tab:visible');
      const controls = tab.getByRole('group', { name: text.collectRegion, exact: true });
      const row = (n: number) => tab.getByRole('gridcell', { name: '记录 ' + n, exact: true }).locator('..');
      const button = (name: string) => tab.getByRole('button', { name, exact: true });
      const modal = page.getByRole('dialog', { name: text.collectedTitle, exact: true });
      const preview = page.getByRole('dialog', { name: tableText.preview, exact: true });
      const tasks = () => page.evaluate(() => window.dbark.invoke('tasks.list', {}));
      const baseline = await disk();
      expect(baseline).toEqual([1, 2, 3, 4, 5].map(id => ({ id, note: '记录 ' + id,
        amount: id === 2 ? '1234567890123456.123456789012' : null, payload: id === 2 ? '00ff' : null, ordinal: id, size: 4 })));

      await row(2).getByRole('checkbox').check();
      await button(text.collect).click();
      await expect(controls.getByRole('status')).toHaveText(text.collectedCount(1, 1));
      await button(tableText.next).click();
      await row(3).getByRole('checkbox').check();
      await button(text.collect).click();
      await expect(controls.getByRole('status')).toHaveText(text.collectedCount(2, 2));
      const before = await tasks();
      await button(text.collectedAction).click();
      await expect(modal).toContainText(text.pageCount(1, 1));
      await expect(modal).toContainText(text.pageCount(2, 1));
      await modal.getByRole('button', { name: tableText.cancel, exact: true }).click();
      await expect(controls.getByRole('status')).toHaveText(text.collectedCount(2, 2));
      expect(await disk()).toEqual(baseline);
      await button(text.collectedAction).click();
      const second = modal.getByRole('button', { name: text.pageRow(2, 1), exact: true });
      if (mode === 'manual') {
        await modal.getByRole('textbox', { name: 'id ' + tableText.value, exact: true }).fill('102');
        await second.click();
        await modal.getByRole('textbox', { name: 'id ' + tableText.value, exact: true }).fill('103');
        await modal.getByRole('button', { name: text.pageRow(1, 2), exact: true }).click();
        await expect(modal.getByRole('textbox', { name: 'id ' + tableText.value, exact: true })).toHaveValue('102');
      } else {
        await expect(modal.getByRole('textbox', { name: 'id ' + tableText.value, exact: true })).toHaveCount(0);
      }
      await page.screenshot({ path: info.outputPath('PostgreSQL跨页复制确认-' + mode + '.png') });
      await modal.getByRole('button', { name: text.stage, exact: true }).click();
      await expect(tab).toContainText(tableText.changes(2));
      await expect(controls.getByRole('status')).toHaveText(text.collectedCount(2, 2));
      expect(await tasks()).toEqual(before);
      expect(await disk()).toEqual(baseline);

      await button(text.undo).click();
      await expect(row(3)).toBeVisible();
      await button(tableText.next).click();
      await expect(row(5)).toBeVisible();
      await tab.getByRole('button', { name: new RegExp('^' + history.redo) }).click();
      await expect(tab).toContainText(tableText.changes(2));
      await button(tableText.preview).click();
      await expect(preview.locator('pre')).toHaveCount(2);
      await expect(preview.locator('pre').first()).toContainText('INSERT');
      await expect(preview.locator('pre').last()).toContainText('INSERT');
      expect(await disk()).toEqual(baseline);
      await preview.getByRole('button', { name: tableText.apply, exact: true }).click();
      await expect(preview).toBeHidden();
      if (mode === 'rollback') {
        await expect(tab).toContainText('整批已回滚');
        await expect(tab).toContainText('已执行首条，第二条复制被拒绝');
        expect(await disk()).toEqual(baseline);
        await expect(tab).toContainText(tableText.changes(2));
        const owner = 'dbark-table-workspace:' + randomBytes(16).toString('hex');
        await desktop.evaluate(installTableWorkspaceConfirmation, { owner, expected: zh.app.text002, choice: 'accept' as const });
      } else {
        await expect(tab).toContainText('PostgreSQL已确认整批提交');
        expect(await disk()).toEqual([...baseline,
        { ...baseline[1], id: mode === 'manual' ? 102 : 6, ordinal: 6 },
        { ...baseline[2], id: mode === 'manual' ? 103 : 7, ordinal: 7 }]);
      }
      expect(pageErrors).toEqual([]);
      await confirmOwnedDesktopExit(info);
    } catch (reason) {
      retainOwnedDesktopResources(info);
      throw reason;
    } finally { await observer.end(); }
  });
}
